// form-validation-sync.service.ts
import { Injectable, inject, NgZone, OnDestroy } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { LoggingService } from '@vai/services';

/**
 * Tipo de evento de sincronização
 */
export enum SyncEventType {
  VALID_VALUE = 'valid_value',
  VALIDATION_ERROR = 'validation_error',
  CLEAR_CACHE = 'clear_cache',
  INVALIDATE_FORM = 'invalidate_form',
  INVALIDATE_TAGS = 'invalidate_tags',
}

/**
 * Interface para eventos de sincronização
 */
export interface ValidationSyncEvent {
  type: SyncEventType;
  formId?: string;
  key?: string;
  data?: any;
  timestamp: number;
  tags?: string[];
}

/**
 * Serviço para sincronizar validações entre múltiplas guias do navegador
 * Permite compartilhar resultados de validação entre diferentes instâncias do aplicativo
 */
@Injectable({
  providedIn: 'root',
})
export class FormValidationSync implements OnDestroy {
  private readonly logger = inject(LoggingService);
  private readonly ngZone = inject(NgZone);

  // Canal para comunicação entre guias (BroadcastChannel API)
  private channel: BroadcastChannel | null = null;

  // Subject para eventos recebidos
  private eventSubject = new Subject<ValidationSyncEvent>();

  // Prefixo para tornar o canal único à aplicação
  private readonly CHANNEL_PREFIX = 'vai_form_validation_';

  constructor() {
    this.initChannel();
  }

  ngOnDestroy(): void {
    this.closeChannel();
  }

  /**
   * Inicializa o canal para comunicação entre guias
   */
  private initChannel(): void {
    // Verificar suporte à BroadcastChannel API
    if (typeof BroadcastChannel === 'undefined') {
      this.logger.warn('[FormValidationSync] BroadcastChannel API not supported in this browser. Sync disabled.');
      return;
    }

    try {
      this.channel = new BroadcastChannel(`${this.CHANNEL_PREFIX}sync`);

      // Configurar handler para mensagens recebidas
      this.channel.onmessage = (event: MessageEvent) => {
        // Executar em NgZone para garantir detecção de mudanças
        this.ngZone.run(() => {
          if (this.isValidSyncEvent(event.data)) {
            this.eventSubject.next(event.data);
          }
        });
      };

      this.logger.debug('[FormValidationSync] BroadcastChannel initialized');
    } catch (error) {
      this.logger.error('[FormValidationSync] Error initializing BroadcastChannel', { error });
    }
  }

  /**
   * Fecha o canal de comunicação
   */
  private closeChannel(): void {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
  }

  /**
   * Verifica se um evento é válido
   */
  private isValidSyncEvent(data: any): boolean {
    return data && typeof data === 'object' && 'type' in data && 'timestamp' in data;
  }

  /**
   * Envia um evento pelo canal
   */
  private broadcastEvent(event: ValidationSyncEvent): void {
    if (!this.channel) {
      return;
    }

    try {
      this.channel.postMessage(event);
    } catch (error) {
      this.logger.error('[FormValidationSync] Error broadcasting event', { error, event });
    }
  }

  /**
   * Obtém observable de eventos recebidos
   */
  onEvent(): Observable<ValidationSyncEvent> {
    return this.eventSubject.asObservable();
  }

  /**
   * Publica um valor válido para outras guias
   */
  broadcastValidValue(formId: string, key: string, value: any): void {
    const event: ValidationSyncEvent = {
      type: SyncEventType.VALID_VALUE,
      formId,
      key,
      data: value,
      timestamp: Date.now(),
    };

    this.broadcastEvent(event);
    this.logger.debug(`[FormValidationSync] Broadcasting valid value for ${formId}:${key}`);
  }

  /**
   * Publica erros de validação para outras guias
   */
  broadcastValidationErrors(formId: string, key: string, errors: Record<string, string>): void {
    const event: ValidationSyncEvent = {
      type: SyncEventType.VALIDATION_ERROR,
      formId,
      key,
      data: errors,
      timestamp: Date.now(),
    };

    this.broadcastEvent(event);
    this.logger.debug(`[FormValidationSync] Broadcasting validation errors for ${formId}:${key}`);
  }

  /**
   * Publica comando para limpar cache
   */
  broadcastClearCache(): void {
    const event: ValidationSyncEvent = {
      type: SyncEventType.CLEAR_CACHE,
      timestamp: Date.now(),
    };

    this.broadcastEvent(event);
    this.logger.debug('[FormValidationSync] Broadcasting clear cache command');
  }

  /**
   * Publica comando para invalidar formulário
   */
  broadcastInvalidateForm(formId: string): void {
    const event: ValidationSyncEvent = {
      type: SyncEventType.INVALIDATE_FORM,
      formId,
      timestamp: Date.now(),
    };

    this.broadcastEvent(event);
    this.logger.debug(`[FormValidationSync] Broadcasting invalidate form command for ${formId}`);
  }

  /**
   * Publica comando para invalidar tags
   */
  broadcastInvalidateTags(tags: string[]): void {
    const event: ValidationSyncEvent = {
      type: SyncEventType.INVALIDATE_TAGS,
      tags,
      timestamp: Date.now(),
    };

    this.broadcastEvent(event);
    this.logger.debug(`[FormValidationSync] Broadcasting invalidate tags command for [${tags.join(', ')}]`);
  }
}
