// form-state-manager.service.ts
import { Injectable, inject, DestroyRef, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormGroup } from '@angular/forms';
import { debounceTime, skip } from 'rxjs/operators';
import { LocalStorageService, LoggingService } from '@vai/services';

/**
 * Interface para um snapshopt de formulário
 */
export interface FormStateSnapshot<T = any> {
  data: T;
  timestamp: number;
  label?: string;
}

/**
 * Interface para o histórico completo do formulário
 */
export interface FormHistory<T = any> {
  snapshots: FormStateSnapshot<T>[];
  currentIndex: number;
  formId: string;
  lastUpdate: number;
  metadata?: Record<string, any>;
}

/**
 * Opções para configurar o FormStateManager
 */
export interface FormStateOptions {
  formId: string;
  /** Habilitar persistência usando localStorage */
  enablePersistence?: boolean;
  /** Habilitar histórico de alterações (desfazer/refazer) */
  enableHistory?: boolean;
  /** Número máximo de snapshots a manter no histórico */
  maxHistory?: number;
  /** Tempo em milissegundos para debounce entre salvamentos */
  debounceTime?: number;
  /** Incluir campos desabilitados nas capturas */
  includeDisabled?: boolean;
  /** Habilitar captura automática em alterações */
  autoCapture?: boolean;
  /** Prefixo para chave de armazenamento */
  storageKeyPrefix?: string;
  /** Metadata adicional a ser salva com o estado */
  metadata?: Record<string, any>;
}

/**
 * Tipo de evento de alteração de estado
 */
export enum StateChangeEventType {
  CAPTURE = 'capture',
  UNDO = 'undo',
  REDO = 'redo',
  RESET = 'reset',
  RESTORE = 'restore',
  CLEAR = 'clear',
}

/**
 * Interface para evento de alteração de estado
 */
export interface StateChangeEvent<T = any> {
  type: StateChangeEventType;
  formId: string;
  timestamp: number;
  currentSnapshot?: FormStateSnapshot<T>;
  prevSnapshot?: FormStateSnapshot<T>;
}

/**
 * Serviço para gerenciamento de estado de formulário
 * Implementa funcionalidades de desfazer/refazer e persistência
 */
@Injectable()
export class FormStateManager<T = any> {
  private readonly destroyRef = inject(DestroyRef);
  private readonly localStorage = inject(LocalStorageService);
  private readonly logger = inject(LoggingService);

  // Formulário gerenciado
  private form!: FormGroup;

  // Opções
  private options: FormStateOptions = {
    formId: '',
    enablePersistence: true,
    enableHistory: true,
    maxHistory: 50,
    debounceTime: 500,
    includeDisabled: true,
    autoCapture: true,
    storageKeyPrefix: 'form_state_',
  };

  // Sinal para o histórico
  private readonly historyState = signal<FormHistory<T>>({
    snapshots: [],
    currentIndex: -1,
    formId: '',
    lastUpdate: Date.now(),
  });

  // Computed signals
  readonly snapshots = computed(() => this.historyState().snapshots);
  readonly currentIndex = computed(() => this.historyState().currentIndex);
  readonly canUndo = computed(() => {
    const { snapshots, currentIndex } = this.historyState();
    return snapshots.length > 0 && currentIndex > 0;
  });
  readonly canRedo = computed(() => {
    const { snapshots, currentIndex } = this.historyState();
    return snapshots.length > 0 && currentIndex < snapshots.length - 1;
  });
  readonly currentSnapshot = computed(() => {
    const { snapshots, currentIndex } = this.historyState();
    return currentIndex >= 0 && currentIndex < snapshots.length ? snapshots[currentIndex] : null;
  });
  readonly hasSavedState = computed(() => {
    return this.options.enablePersistence && this.localStorage.getItem<FormHistory<T>>(this.getStorageKey()) !== null;
  });

  /**
   * Inicializa o gerenciador de estado com um formulário e opções
   */
  initialize(form: FormGroup, options: FormStateOptions): void {
    this.form = form;
    this.options = { ...this.options, ...options };

    // Inicializar histórico
    this.historyState.set({
      snapshots: [],
      currentIndex: -1,
      formId: this.options.formId,
      lastUpdate: Date.now(),
      metadata: this.options.metadata,
    });

    // Tentar restaurar estado salvo
    if (this.options.enablePersistence) {
      this.restoreSavedState();
    }

    // Configurar captura automática se habilitada
    if (this.options.autoCapture) {
      this.setupAutoCapture();
    }

    this.logger.debug(`FormStateManager initialized for form "${this.options.formId}"`, {
      enablePersistence: this.options.enablePersistence,
      enableHistory: this.options.enableHistory,
      autoCapture: this.options.autoCapture,
    });
  }

  /**
   * Configura a captura automática de alterações no formulário
   */
  private setupAutoCapture(): void {
    if (!this.form) {
      this.logger.error('Cannot setup auto capture: form not initialized');
      return;
    }

    // Escutar alterações no formulário
    this.form.valueChanges
      .pipe(
        skip(1), // Ignorar primeira emissão
        debounceTime(this.options.debounceTime || 500),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        if (this.form.dirty) {
          this.captureState('Auto capture');
        }
      });
  }

  /**
   * Captura o estado atual do formulário
   */
  captureState(label?: string): void {
    if (!this.form) {
      this.logger.error('Cannot capture state: form not initialized');
      return;
    }

    if (!this.options.enableHistory) {
      return;
    }

    // Obter valor atual
    const formData = this.options.includeDisabled ? (this.form.getRawValue() as T) : (this.form.value as T);

    // Criar snapshot
    const snapshot: FormStateSnapshot<T> = {
      data: formData,
      timestamp: Date.now(),
      label,
    };

    // Atualizar histórico
    this.historyState.update((history) => {
      // Obter snapshots atuais
      let snapshots = [...history.snapshots];
      let currentIndex = history.currentIndex;

      // Remover snapshots depois do índice atual se estamos no meio do histórico
      if (currentIndex >= 0 && currentIndex < snapshots.length - 1) {
        snapshots = snapshots.slice(0, currentIndex + 1);
      }

      // Adicionar novo snapshot
      snapshots.push(snapshot);

      // Limitar tamanho do histórico
      if (snapshots.length > (this.options.maxHistory || 50)) {
        snapshots = snapshots.slice(snapshots.length - (this.options.maxHistory || 50));
      }

      // Atualizar índice atual
      currentIndex = snapshots.length - 1;

      return {
        ...history,
        snapshots,
        currentIndex,
        lastUpdate: snapshot.timestamp,
      };
    });

    // Persistir estado se habilitado
    if (this.options.enablePersistence) {
      this.persistState();
    }

    // Emitir evento
    this.emitStateChangeEvent(StateChangeEventType.CAPTURE, this.currentSnapshot());

    this.logger.debug(`State captured for form "${this.options.formId}"`, {
      snapshotCount: this.snapshots().length,
      currentIndex: this.currentIndex(),
    });
  }

  /**
   * Desfaz a última alteração
   */
  undo(): boolean {
    if (!this.canUndo()) {
      return false;
    }

    const prevIndex = this.currentIndex();
    const prevSnapshot = this.snapshots()[prevIndex];

    // Atualizar índice
    this.historyState.update((history) => ({
      ...history,
      currentIndex: history.currentIndex - 1,
      lastUpdate: Date.now(),
    }));

    // Aplicar snapshot
    const newIndex = this.currentIndex();
    const newSnapshot = this.snapshots()[newIndex];
    this.applySnapshot(newSnapshot);

    // Persistir estado
    if (this.options.enablePersistence) {
      this.persistState();
    }

    // Emitir evento
    this.emitStateChangeEvent(StateChangeEventType.UNDO, newSnapshot, prevSnapshot);

    this.logger.debug(`Undo performed for form "${this.options.formId}"`, {
      fromIndex: prevIndex,
      toIndex: newIndex,
    });

    return true;
  }

  /**
   * Refaz a última alteração desfeita
   */
  redo(): boolean {
    if (!this.canRedo()) {
      return false;
    }

    const prevIndex = this.currentIndex();
    const prevSnapshot = this.snapshots()[prevIndex];

    // Atualizar índice
    this.historyState.update((history) => ({
      ...history,
      currentIndex: history.currentIndex + 1,
      lastUpdate: Date.now(),
    }));

    // Aplicar snapshot
    const newIndex = this.currentIndex();
    const newSnapshot = this.snapshots()[newIndex];
    this.applySnapshot(newSnapshot);

    // Persistir estado
    if (this.options.enablePersistence) {
      this.persistState();
    }

    // Emitir evento
    this.emitStateChangeEvent(StateChangeEventType.REDO, newSnapshot, prevSnapshot);

    this.logger.debug(`Redo performed for form "${this.options.formId}"`, {
      fromIndex: prevIndex,
      toIndex: newIndex,
    });

    return true;
  }

  /**
   * Aplica um snapshot ao formulário
   */
  private applySnapshot(snapshot: FormStateSnapshot<T>): void {
    if (!this.form || !snapshot) {
      return;
    }

    // Atualizar valores do formulário sem disparar eventos
    this.form.patchValue(snapshot.data, { emitEvent: false });

    // Marcar o formulário como pristine
    this.form.markAsPristine();
  }

  /**
   * Persiste o estado atual no localStorage
   */
  private persistState(): void {
    if (!this.options.enablePersistence || !this.options.formId) {
      return;
    }

    const storageKey = this.getStorageKey();
    const history = this.historyState();

    try {
      this.localStorage.setItem(storageKey, history);
      this.logger.debug(`State persisted for form "${this.options.formId}"`, {
        snapshots: history.snapshots.length,
        storageKey,
      });
    } catch (error) {
      this.logger.error(`Failed to persist state for form "${this.options.formId}"`, { error });
    }
  }

  /**
   * Restaura o estado salvo do localStorage
   */
  restoreSavedState(): boolean {
    if (!this.options.enablePersistence || !this.options.formId || !this.form) {
      return false;
    }

    const storageKey = this.getStorageKey();

    try {
      const savedHistory = this.localStorage.getItem<FormHistory<T>>(storageKey);

      if (savedHistory && savedHistory.snapshots.length > 0) {
        // Atualizar histórico
        this.historyState.set(savedHistory);

        // Aplicar último snapshot
        const lastIndex = savedHistory.currentIndex;
        const lastSnapshot = savedHistory.snapshots[lastIndex];

        if (lastSnapshot) {
          this.applySnapshot(lastSnapshot);

          // Emitir evento
          this.emitStateChangeEvent(StateChangeEventType.RESTORE, lastSnapshot);

          this.logger.debug(`State restored for form "${this.options.formId}"`, {
            snapshots: savedHistory.snapshots.length,
            currentIndex: lastIndex,
          });

          return true;
        }
      }
    } catch (error) {
      this.logger.error(`Failed to restore state for form "${this.options.formId}"`, { error });
    }

    return false;
  }

  /**
   * Limpa o histórico e o estado salvo
   */
  clearState(): void {
    // Limpar histórico
    this.historyState.set({
      snapshots: [],
      currentIndex: -1,
      formId: this.options.formId,
      lastUpdate: Date.now(),
      metadata: this.options.metadata,
    });

    // Limpar do localStorage
    if (this.options.enablePersistence) {
      const storageKey = this.getStorageKey();
      this.localStorage.removeItem(storageKey);
    }

    // Emitir evento
    this.emitStateChangeEvent(StateChangeEventType.CLEAR);

    this.logger.debug(`State cleared for form "${this.options.formId}"`);
  }

  /**
   * Reseta o formulário para um estado específico
   */
  resetToSnapshot(index: number): boolean {
    const history = this.historyState();

    if (index < 0 || index >= history.snapshots.length) {
      return false;
    }

    const prevIndex = history.currentIndex;
    const prevSnapshot = history.snapshots[prevIndex];

    // Atualizar índice
    this.historyState.update((state) => ({
      ...state,
      currentIndex: index,
      lastUpdate: Date.now(),
    }));

    // Aplicar snapshot
    const snapshot = history.snapshots[index];
    this.applySnapshot(snapshot);

    // Persistir estado
    if (this.options.enablePersistence) {
      this.persistState();
    }

    // Emitir evento
    this.emitStateChangeEvent(StateChangeEventType.RESET, snapshot, prevSnapshot);

    this.logger.debug(`Reset to snapshot ${index} for form "${this.options.formId}"`);

    return true;
  }

  /**
   * Obtém o valor da chave de armazenamento
   */
  private getStorageKey(): string {
    return `${this.options.storageKeyPrefix || 'form_state_'}${this.options.formId}`;
  }

  /**
   * Emite um evento de alteração de estado
   */
  private emitStateChangeEvent(type: StateChangeEventType, currentSnapshot?: FormStateSnapshot<T>, prevSnapshot?: FormStateSnapshot<T>): void {
    const event: StateChangeEvent<T> = {
      type,
      formId: this.options.formId,
      timestamp: Date.now(),
      currentSnapshot,
      prevSnapshot,
    };

    // Aqui você pode integrar com um sistema de eventos se necessário
    // Por exemplo, usando um EventEmitter ou um serviço de gerenciamento de eventos
    // Por enquanto, apenas registramos no console
    this.logger.debug(`Form state change: ${type}`, { formId: this.options.formId });
  }

  /**
   * Obtém o histórico atual
   */
  getHistory(): FormHistory<T> {
    return this.historyState();
  }

  /**
   * Obtém o estado atual (snapshot atual)
   */
  getCurrentState(): FormStateSnapshot<T> | null {
    return this.currentSnapshot();
  }

  /**
   * Obtém um snapshot específico pelo índice
   */
  getSnapshot(index: number): FormStateSnapshot<T> | null {
    const snapshots = this.snapshots();
    return index >= 0 && index < snapshots.length ? snapshots[index] : null;
  }

  /**
   * Atualiza metadados do histórico
   */
  updateMetadata(metadata: Record<string, any>): void {
    this.historyState.update((history) => ({
      ...history,
      metadata: { ...history.metadata, ...metadata },
      lastUpdate: Date.now(),
    }));

    // Persistir alterações
    if (this.options.enablePersistence) {
      this.persistState();
    }
  }

  /**
   * Configura um callback para ser executado quando o estado mudar
   * Pode ser usado para sincronizar com outro sistema
   */
  onStateChange(callback: (event: StateChangeEvent<T>) => void): void {
    // Esta é uma implementação simplificada
    // Um enfoque mais robusto usaria um Subject do RxJS
    this.emitStateChangeEvent = (type, currentSnapshot, prevSnapshot) => {
      const event: StateChangeEvent<T> = {
        type,
        formId: this.options.formId,
        timestamp: Date.now(),
        currentSnapshot,
        prevSnapshot,
      };

      callback(event);
      this.logger.debug(`Form state change: ${type}`, { formId: this.options.formId });
    };
  }
}

/**
 * Factory para gerenciamento de estado de formulário
 * Facilita a criação e configuração de um FormStateManager
 */
@Injectable({
  providedIn: 'root',
})
export class FormStateManagerFactory {
  private readonly logger = inject(LoggingService);

  // Mapa para reutilizar gerenciadores existentes
  private readonly managers = new Map<string, FormStateManager<any>>();

  /**
   * Cria ou reutiliza um gerenciador de estado para um formulário
   */
  create<T = any>(form: FormGroup, options: FormStateOptions): FormStateManager<T> {
    const formId = options.formId;

    // Verificar se já existe um gerenciador para este ID
    if (this.managers.has(formId)) {
      this.logger.debug(`Reusing existing FormStateManager for "${formId}"`);
      return this.managers.get(formId) as FormStateManager<T>;
    }

    // Criar novo gerenciador
    const manager = new FormStateManager<T>();
    manager.initialize(form, options);

    // Salvar para reutilização
    this.managers.set(formId, manager);

    return manager;
  }

  /**
   * Destrói um gerenciador de estado
   */
  destroy(formId: string): void {
    if (this.managers.has(formId)) {
      this.managers.delete(formId);
      this.logger.debug(`FormStateManager for "${formId}" destroyed`);
    }
  }

  /**
   * Obtém um gerenciador existente pelo ID
   */
  getManager<T = any>(formId: string): FormStateManager<T> | undefined {
    return this.managers.get(formId) as FormStateManager<T> | undefined;
  }

  /**
   * Limpa todos os gerenciadores
   */
  clearAll(): void {
    this.managers.clear();
    this.logger.debug('All FormStateManagers cleared');
  }
}
