import { Injectable, ChangeDetectorRef, signal, WritableSignal, Signal, inject, DestroyRef } from '@angular/core';
import { FormGroup, FormArray, AbstractControl, ValidationErrors } from '@angular/forms';
import { fromEvent } from 'rxjs';
import { debounceTime, throttleTime } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LoggingService } from './logging.service'; // Importar o LoggingService

/**
 * Interface para medidas de performance
 */
export interface FormPerformanceMetrics {
  renderTime: number;
  validationTime: number; // Média do tempo de execução dos validadores cacheados
  memoryUsage?: number;
  fieldCount: number;
  validatorCount: number;
  changeDetectionCount: number; // Contado por applyDebouncedChangeDetection, se usado
  eventHandlersCount: number; // Estimativa
}

/**
 * Interface para configuração de chunking
 */
export interface ChunkConfig {
  enabled: boolean;
  size: number;
  debounceTime: number; // Tempo entre o processamento de chunks
}

// Limite para considerar um formulário grande. Pode ser ajustado conforme a necessidade.
const IS_LARGE_FORM_THRESHOLD = 50;
const VERY_LARGE_FORM_THRESHOLD = 100; // Limite para otimizações mais agressivas (se houver)

/**
 * Serviço para otimização de performance em formulários grandes.
 * Recomenda-se fortemente o uso de ChangeDetectionStrategy.OnPush nos componentes
 * que utilizam esses formulários, em conjunto com a FormOnPushDirective.
 * Também é crucial configurar a estratégia `updateOn: 'blur'` ou `updateOn: 'submit'`
 * na criação dos FormControls/FormGroups para reduzir a frequência de validações.
 */
@Injectable({
  providedIn: 'root',
})
export class FormPerformanceService {
  private changeDetectionCount = 0;
  private validationTimes: number[] = [];
  private validatorExecutionCount = 0;

  private performanceMetricsSignal: WritableSignal<FormPerformanceMetrics | null> = signal(null);
  public readonly performanceMetrics: Signal<FormPerformanceMetrics | null> = this.performanceMetricsSignal.asReadonly();

  private isProcessingChunk = false;
  private destroyRef = inject(DestroyRef);
  private logger = inject(LoggingService); // Injetar o LoggingService

  /**
   * Determina se um formulário é considerado grande com base no número de controles.
   * @param form O FormGroup ou FormArray a ser avaliado.
   * @param threshold Opcional. Limite customizado para considerar o formulário grande.
   */
  isLargeForm(form: FormGroup | FormArray, threshold: number = IS_LARGE_FORM_THRESHOLD): boolean {
    const count = this.countFormControls(form);
    const isLarge = count > threshold;
    if (isLarge) {
      this.logger.debug(`[FormPerformanceService] Form is considered large. Control count: ${count}, Threshold: ${threshold}`);
    }
    return isLarge;
  }

  /**
   * Aplica um conjunto de técnicas de otimização a um formulário.
   * O sucesso dessas otimizações depende também da arquitetura do componente (OnPush)
   * e da configuração do formulário (updateOn).
   * @param form Formulário a ser otimizado.
   * @param changeDetectorRef ChangeDetectorRef do componente (necessário para applyDebouncedChangeDetection).
   * @param options Opções de otimização.
   * @returns Signal com métricas de performance.
   */
  optimizeForm(
    form: FormGroup,
    changeDetectorRef: ChangeDetectorRef,
    options?: { applyDebouncedCd?: boolean },
  ): Signal<FormPerformanceMetrics | null> {
    this.logger.info(`[FormPerformanceService] Starting optimization for form.`);
    this.resetMetrics();

    const fieldCount = this.countFormControls(form);
    const validatorCount = this.countValidators(form);
    this.logger.debug(`[FormPerformanceService] Form details - Fields: ${fieldCount}, Validators: ${validatorCount}`);

    if (options?.applyDebouncedCd && fieldCount > VERY_LARGE_FORM_THRESHOLD) {
      this.logger.debug(`[FormPerformanceService] Applying debounced change detection as form is very large and option is enabled.`);
      this.applyDebouncedChangeDetection(form, changeDetectorRef);
    }

    this.measureFormPerformance(form, fieldCount, validatorCount);

    return this.performanceMetrics;
  }

  private resetMetrics(): void {
    this.changeDetectionCount = 0;
    this.validationTimes = [];
    this.validatorExecutionCount = 0;
    this.performanceMetricsSignal.set(null);
    this.logger.debug(`[FormPerformanceService] Metrics reset.`);
  }

  /**
   * Otimiza um formulário em abas/wizard aplicando lazy loading de validadores.
   * Desabilita validadores para grupos de controle inativos e os reabilita quando o grupo se torna ativo.
   * @param form Formulário principal.
   * @param controlGroups Objeto mapeando chaves de grupo (únicas para cada etapa) aos nomes dos controles daquela etapa.
   * @param initialActiveGroupKey Chave do grupo que deve estar ativo inicialmente.
   */
  optimizeWizardForm(form: FormGroup, controlGroups: { [key: string]: string[] }, initialActiveGroupKey?: string): void {
    if (!form || !controlGroups) {
      this.logger.warn('[FormPerformanceService] optimizeWizardForm: Form or controlGroups not provided.'); //
      return;
    }
    this.logger.debug(`[FormPerformanceService] Optimizing wizard form. Initial active group: ${initialActiveGroupKey || 'none'}`);
    Object.keys(controlGroups).forEach((groupKey) => {
      const controlsInGroup = controlGroups[groupKey];
      if (!Array.isArray(controlsInGroup)) {
        this.logger.warn(`[FormPerformanceService] Controls for group ${groupKey} is not an array.`); //
        return;
      }
      controlsInGroup.forEach((controlName) => {
        const control = form.get(controlName);
        if (control) {
          this.storeOriginalValidators(control); //
          if (groupKey !== initialActiveGroupKey) {
            control.clearValidators(); //
            control.clearAsyncValidators(); //
            control.updateValueAndValidity({ emitEvent: false }); //
            this.logger.debug(`[FormPerformanceService] Validators cleared for control '${controlName}' in inactive group '${groupKey}'.`);
          }
        } else {
          this.logger.warn(`[FormPerformanceService] Control ${controlName} not found in form for group ${groupKey}.`); //
        }
      });
    });
    if (initialActiveGroupKey && controlGroups[initialActiveGroupKey]) {
      controlGroups[initialActiveGroupKey].forEach((controlName) => {
        const control = form.get(controlName);
        if (control) {
          this.restoreOriginalValidators(control); //
          this.logger.debug(
            `[FormPerformanceService] Validators restored for control '${controlName}' in initial active group '${initialActiveGroupKey}'.`,
          );
        }
      });
    }
  }

  /**
   * Ativa um grupo específico de controles para validação em um wizard e desativa os outros.
   * @param form Formulário.
   * @param activeGroupKey Chave do grupo a ser ativado.
   * @param controlGroups Mapeamento de todos os grupos (chave de grupo para array de nomes de controle).
   */
  activateWizardStep(form: FormGroup, activeGroupKey: string, controlGroups: { [key: string]: string[] }): void {
    if (!form || !activeGroupKey || !controlGroups) {
      this.logger.warn('[FormPerformanceService] activateWizardStep: Form, activeGroupKey, or controlGroups not provided.'); //
      return;
    }
    this.logger.debug(`[FormPerformanceService] Activating wizard step: ${activeGroupKey}`);
    Object.keys(controlGroups).forEach((groupKey) => {
      const controlsInGroup = controlGroups[groupKey];
      if (!Array.isArray(controlsInGroup)) {
        this.logger.warn(`[FormPerformanceService] Controls for group ${groupKey} is not an array during activation.`); //
        return;
      }
      controlsInGroup.forEach((controlName) => {
        const control = form.get(controlName);
        if (control) {
          if (groupKey === activeGroupKey) {
            this.restoreOriginalValidators(control); //
            this.logger.debug(`[FormPerformanceService] Validators restored for control '${controlName}' in active group '${groupKey}'.`);
          } else {
            control.clearValidators(); //
            control.clearAsyncValidators(); //
            control.updateValueAndValidity({ emitEvent: false }); //
            // Não é necessário logar cada limpeza individual aqui para não poluir, o log da ativação do grupo é suficiente.
          }
        } else {
          this.logger.warn(`[FormPerformanceService] Control ${controlName} not found in form for group ${groupKey} during activation.`); //
        }
      });
    });
  }

  /**
   * Processa os controles de um FormArray em chunks (lotes) para melhorar a responsividade
   * da UI durante operações em massa (ex: adicionar muitos controles de uma vez).
   * @param formArray FormArray a ser processado.
   * @param processFn Função a ser aplicada a cada controle no chunk.
   * @param config Configuração de chunking.
   */
  async processInChunks(
    formArray: FormArray,
    processFn: (control: AbstractControl, index: number) => void,
    config: ChunkConfig = { enabled: true, size: 10, debounceTime: 10 },
  ): Promise<void> {
    if (!config.enabled) {
      this.logger.debug('[FormPerformanceService] Chunk processing disabled. Processing all items at once.');
      formArray.controls.forEach(processFn);
      return Promise.resolve();
    }
    if (this.isProcessingChunk) {
      this.logger.debug('[FormPerformanceService] Chunk processing already in progress. Skipping new request.');
      return Promise.resolve();
    }

    this.isProcessingChunk = true;
    this.logger.debug(`[FormPerformanceService] Starting chunk processing for FormArray. Size: ${config.size}, Debounce: ${config.debounceTime}ms.`);
    try {
      const totalItems = formArray.length;
      let processedCount = 0;

      while (processedCount < totalItems) {
        const chunkSize = Math.min(config.size, totalItems - processedCount);
        if (chunkSize <= 0) break;
        this.logger.debug(`[FormPerformanceService] Processing chunk: ${processedCount} to ${processedCount + chunkSize - 1}`);
        for (let i = 0; i < chunkSize; i++) {
          const idx = processedCount + i;
          if (idx < totalItems) {
            processFn(formArray.at(idx), idx);
          }
        }
        processedCount += chunkSize;

        if (processedCount < totalItems && config.debounceTime > 0) {
          await new Promise((resolve) => setTimeout(resolve, config.debounceTime));
        }
      }
      this.logger.debug('[FormPerformanceService] Chunk processing completed.');
    } catch (error) {
      this.logger.error('[FormPerformanceService] Error during chunk processing.', { error });
    } finally {
      this.isProcessingChunk = false;
    }
  }

  /**
   * Aplica virtualização para renderizar listas muito grandes de forma eficiente.
   * Escuta eventos de scroll no elemento container e chama `renderFn` apenas para os itens visíveis.
   * @param element Elemento HTML container com overflow.
   * @param itemHeight Altura de cada item (em pixels). Assumindo altura fixa.
   * @param totalItems Número total de itens na lista.
   * @param renderFn Função chamada para renderizar os itens visíveis (passa índice inicial e final).
   */
  applyVirtualization(element: HTMLElement, itemHeight: number, totalItems: number, renderFn: (startIndex: number, endIndex: number) => void): void {
    if (!element || itemHeight <= 0 || totalItems <= 0) {
      this.logger.warn('[FormPerformanceService] applyVirtualization: Invalid parameters provided.', {
        hasElement: !!element,
        itemHeight,
        totalItems,
      });
      return;
    }
    this.logger.debug(`[FormPerformanceService] Applying virtualization. Items: ${totalItems}, Item Height: ${itemHeight}px.`);

    element.style.position = 'relative';

    let lastStart = -1;
    let lastEnd = -1;

    const updateVisibleItems = () => {
      const scrollTop = element.scrollTop;
      const viewportHeight = element.clientHeight;
      const bufferItems = 5;

      const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - bufferItems);
      const endIndex = Math.min(totalItems - 1, Math.ceil((scrollTop + viewportHeight) / itemHeight) - 1 + bufferItems);

      if (startIndex !== lastStart || endIndex !== lastEnd) {
        // this.logger.debug(`[FormPerformanceService] Virtualization: Rendering items ${startIndex} to ${endIndex}`);
        renderFn(startIndex, endIndex);
        lastStart = startIndex;
        lastEnd = endIndex;
      }
    };

    updateVisibleItems();

    fromEvent(element, 'scroll')
      .pipe(
        throttleTime(16, undefined, { leading: true, trailing: true }),
        takeUntilDestroyed(this.destroyRef), //
      )
      .subscribe(updateVisibleItems);
  }

  /**
   * Cria uma função validadora que armazena em cache os resultados da validação original.
   * Útil para validadores caros que são chamados frequentemente com a mesma entrada.
   * @returns Uma função que recebe um validador original e retorna uma versão com cache.
   */
  createValidationCache(): <V, C extends AbstractControl>(
    originalValidator: (control: C) => ValidationErrors | null,
  ) => (control: C) => ValidationErrors | null {
    const cache = new Map<string, ValidationErrors | null>();
    this.logger.debug('[FormPerformanceService] Validation cache created.');

    return <V, C extends AbstractControl>(originalValidator: (control: C) => ValidationErrors | null) => {
      return (control: C): ValidationErrors | null => {
        const value = control.value;
        const key = typeof value === 'object' ? JSON.stringify(value) : String(value);

        if (cache.has(key)) {
          // this.logger.debug(`[FormPerformanceService] Validation cache hit for key: ${key}`);
          return cache.get(key)!;
        }
        // this.logger.debug(`[FormPerformanceService] Validation cache miss for key: ${key}. Executing validator.`);
        const startTime = performance.now();
        const result = originalValidator(control);
        const endTime = performance.now();

        this.validationTimes.push(endTime - startTime);
        this.validatorExecutionCount++;

        cache.set(key, result);
        return result;
      };
    };
  }

  /**
   * (USO COM CAUTELA) Aplica detecção de mudanças com debounce às mudanças de valor do formulário.
   * Isso pode ajudar em formulários muito grandes onde mesmo com OnPush, as atualizações são frequentes.
   * Geralmente, prefira a FormOnPushDirective e `updateOn: 'blur'/'submit'`.
   * @param form O FormGroup raiz.
   * @param cdRef ChangeDetectorRef do componente.
   * @param debounceMs Tempo de debounce em milissegundos.
   */
  public applyDebouncedChangeDetection(form: FormGroup, cdRef: ChangeDetectorRef, debounceMs: number = 50): void {
    if (!form || !cdRef) {
      this.logger.warn('[FormPerformanceService] applyDebouncedChangeDetection: Form or ChangeDetectorRef not provided.');
      return;
    }
    this.logger.debug(`[FormPerformanceService] Applying debounced change detection with ${debounceMs}ms debounce.`);

    form.valueChanges
      .pipe(
        debounceTime(debounceMs),
        takeUntilDestroyed(this.destroyRef), //
      )
      .subscribe(() => {
        this.logger.debug('[FormPerformanceService] Debounced change detection triggered.');
        this.changeDetectionCount++;
        cdRef.detectChanges();
      });
  }

  private countFormControls(form: FormGroup | FormArray): number {
    let count = 0;
    Object.values(form.controls).forEach((control) => {
      if (control instanceof FormGroup || control instanceof FormArray) {
        count += this.countFormControls(control);
      }
      count++;
    });
    return count;
  }

  private countValidators(form: FormGroup | FormArray): number {
    let count = 0;
    if (form.validator) count++;
    if (form.asyncValidator) count++;

    Object.values(form.controls).forEach((control) => {
      if (control instanceof FormGroup || control instanceof FormArray) {
        count += this.countValidators(control);
      } else if (control) {
        if (control.validator) count++;
        if (control.asyncValidator) count++;
      }
    });
    return count;
  }

  private storeOriginalValidators(control: AbstractControl): void {
    if (!control['_originalValidatorsStore'] && (control.validator || control.asyncValidator)) {
      //
      control['_originalValidatorsStore'] = {
        validator: control.validator,
        asyncValidator: control.asyncValidator,
      };
      // this.logger.debug(`[FormPerformanceService] Stored original validators for control.`);
    }
  }

  private restoreOriginalValidators(control: AbstractControl): void {
    if (control['_originalValidatorsStore']) {
      //
      const { validator, asyncValidator } = control['_originalValidatorsStore'];
      control.setValidators(validator); //
      control.setAsyncValidators(asyncValidator); //
      control.updateValueAndValidity({ emitEvent: false }); //
      // this.logger.debug(`[FormPerformanceService] Restored original validators for control.`);
    } else if (!control.validator && !control.asyncValidator) {
      control.updateValueAndValidity({ emitEvent: false }); //
    }
  }

  private measureFormPerformance(form: FormGroup, fieldCount: number, validatorCount: number): void {
    const renderStart = performance.now();
    requestAnimationFrame(() => {
      const renderTime = performance.now() - renderStart;
      const avgValidationTime = this.validationTimes.length
        ? this.validationTimes.reduce((sum, time) => sum + time, 0) / this.validationTimes.length
        : 0;

      const metrics: FormPerformanceMetrics = {
        renderTime,
        validationTime: avgValidationTime,
        fieldCount,
        validatorCount,
        changeDetectionCount: this.changeDetectionCount,
        eventHandlersCount: fieldCount,
      };

      if (typeof window !== 'undefined' && window.performance && 'memory' in window.performance) {
        const memory = (window.performance as any).memory;
        if (memory) {
          metrics.memoryUsage = memory.usedJSHeapSize;
        }
      }
      this.performanceMetricsSignal.set(metrics);
      this.logger.debug('[FormPerformanceService] Performance metrics measured and updated.', metrics);
    });
  }

  public applyEventDelegation(formElement: HTMLElement): void {
    this.logger.warn(
      '[FormPerformanceService] applyEventDelegation is a placeholder conceitual. A implementação real é complexa e dependente do caso de uso.',
      { element: formElement.tagName },
    ); //
  }
}
