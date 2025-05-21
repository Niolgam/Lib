// form-validation-cache.service.ts
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { FormValidationSync } from './form-validation-sync.service';
import { LoggingService } from './logging.service';

/**
 * Opções para itens de cache
 */
export interface ValidationCacheOptions {
  expires?: number;
  tags?: string[];
  formId?: string;
}

/**
 * Item de cache de validação
 */
export interface ValidationCacheItem<T = any> {
  value: T;
  timestamp: number;
  expires?: number;
  tags: string[];
  formId?: string;
}

/**
 * Tipo de resultado de validação
 */
export type ValidationResults = {
  isValid: boolean;
  [key: string]: any;
};

/**
 * Serviço para cache de resultados de validação
 * Evita consultas repetidas ao servidor e melhora a performance
 */
@Injectable({
  providedIn: 'root',
})
export class FormValidationCacheService {
  private readonly logger = inject(LoggingService);
  private readonly validationSync = inject(FormValidationSync);

  // Cache para valores válidos
  private validValuesCache = new Map<string, ValidationCacheItem<any>>();

  // Cache para erros de validação
  private validationErrorsCache = new Map<string, ValidationCacheItem<Record<string, string>>>();

  // Limite do cache
  private readonly MAX_CACHE_SIZE = 500;

  // Estatísticas
  private cacheHits = 0;
  private cacheMisses = 0;

  /**
   * Armazena um resultado de validação válido no cache
   */
  storeValidationResult(key: string, value: any, options: ValidationCacheOptions = {}): void {
    // Se o cache está cheio, liberar espaço
    if (this.validValuesCache.size >= this.MAX_CACHE_SIZE) {
      this.pruneCache();
    }

    const cacheItem: ValidationCacheItem<any> = {
      value,
      timestamp: Date.now(),
      expires: options.expires,
      tags: options.tags || [],
      formId: options.formId,
    };

    this.validValuesCache.set(key, cacheItem);

    this.logger.debug(`[FormValidationCache] Stored valid result for key: ${key}`, {
      formId: options.formId,
      tags: options.tags,
    });

    // Sincronizar com outros contextos/abas
    if (options.formId) {
      this.validationSync.broadcastValidValue(options.formId, key, value);
    }
  }

  /**
   * Armazena erros de validação no cache
   */
  storeValidationErrors(key: string, errors: Record<string, string>, options: ValidationCacheOptions = {}): void {
    // Limitar tamanho do cache
    if (this.validationErrorsCache.size >= this.MAX_CACHE_SIZE) {
      this.pruneErrorsCache();
    }

    const cacheItem: ValidationCacheItem<Record<string, string>> = {
      value: errors,
      timestamp: Date.now(),
      expires: options.expires || Date.now() + 5 * 60 * 1000, // 5 minutos por padrão
      tags: options.tags || [],
      formId: options.formId,
    };

    this.validationErrorsCache.set(key, cacheItem);

    this.logger.debug(`[FormValidationCache] Stored validation errors for key: ${key}`, {
      formId: options.formId,
      errorCount: Object.keys(errors).length,
    });

    // Sincronizar com outros contextos/abas
    if (options.formId) {
      this.validationSync.broadcastValidationErrors(options.formId, key, errors);
    }
  }

  /**
   * Obtém um valor válido do cache
   */
  getValidValue<T>(key: string): T | null {
    const cachedItem = this.validValuesCache.get(key);

    if (!cachedItem) {
      this.cacheMisses++;
      return null;
    }

    // Verificar expiração
    if (cachedItem.expires && Date.now() > cachedItem.expires) {
      this.validValuesCache.delete(key);
      this.cacheMisses++;
      return null;
    }

    this.cacheHits++;
    return cachedItem.value as T;
  }

  /**
   * Obtém erros de validação do cache
   */
  getValidationErrors(key: string): Record<string, string> | null {
    const cachedItem = this.validationErrorsCache.get(key);

    if (!cachedItem) {
      this.cacheMisses++;
      return null;
    }

    // Verificar expiração
    if (cachedItem.expires && Date.now() > cachedItem.expires) {
      this.validationErrorsCache.delete(key);
      this.cacheMisses++;
      return null;
    }

    this.cacheHits++;
    return cachedItem.value;
  }

  /**
   * Verifica se um valor precisa ser validado no servidor
   * com base no cache e na análise do valor
   */
  needsServerValidation(formId: string, fieldKey: string, value: any): boolean {
    // Gerar chave de cache
    const cacheKey = `${formId}:${fieldKey}:${JSON.stringify(value)}`;

    // Verificar se já temos um resultado válido no cache
    const cachedValue = this.getValidValue(cacheKey);
    if (cachedValue !== null) {
      return false; // Não precisa validar no servidor
    }

    // Verificar se já temos erros no cache para esse mesmo valor
    const cachedErrors = this.getValidationErrors(cacheKey);
    if (cachedErrors !== null) {
      return false; // Já sabemos que é inválido, não precisa revalidar
    }

    // Nenhuma informação no cache, precisa validar
    return true;
  }

  /**
   * Valida um valor usando o cache primeiro e, se necessário, o servidor
   */
  validateValue(
    formId: string,
    fieldKey: string,
    value: any,
    serverValidationFn?: (value: any) => Observable<ValidationResults>,
  ): Observable<ValidationResults> {
    // Gerar chave de cache
    const cacheKey = `${formId}:${fieldKey}:${JSON.stringify(value)}`;

    // Tentar obter do cache primeiro
    const cachedValue = this.getValidValue<ValidationResults>(cacheKey);
    if (cachedValue !== null) {
      return of(cachedValue);
    }

    // Verificar se já temos erros no cache
    const cachedErrors = this.getValidationErrors(cacheKey);
    if (cachedErrors !== null) {
      // Converter erros para resultado de validação
      const validationResult: ValidationResults = {
        isValid: false,
        errors: cachedErrors,
      };
      return of(validationResult);
    }

    // Se não temos função de validação de servidor, retornar válido
    if (!serverValidationFn) {
      const defaultResult: ValidationResults = { isValid: true };
      return of(defaultResult);
    }

    // Executar validação no servidor
    return serverValidationFn(value);
  }

  /**
   * Invalida entradas no cache por tags
   */
  invalidateByTags(tags: string[]): number {
    let count = 0;

    // Criar um Set para pesquisa eficiente
    const tagSet = new Set(tags);

    // Invalidar cache de valores válidos
    this.validValuesCache.forEach((item, key) => {
      if (item.tags.some((tag) => tagSet.has(tag))) {
        this.validValuesCache.delete(key);
        count++;
      }
    });

    // Invalidar cache de erros
    this.validationErrorsCache.forEach((item, key) => {
      if (item.tags.some((tag) => tagSet.has(tag))) {
        this.validationErrorsCache.delete(key);
        count++;
      }
    });

    if (count > 0) {
      this.logger.debug(`[FormValidationCache] Invalidated ${count} entries by tags: ${tags.join(', ')}`);
    }

    return count;
  }

  /**
   * Invalida entradas no cache por formId
   */
  invalidateByFormId(formId: string): number {
    let count = 0;

    // Invalidar cache de valores válidos
    this.validValuesCache.forEach((item, key) => {
      if (item.formId === formId) {
        this.validValuesCache.delete(key);
        count++;
      }
    });

    // Invalidar cache de erros
    this.validationErrorsCache.forEach((item, key) => {
      if (item.formId === formId) {
        this.validationErrorsCache.delete(key);
        count++;
      }
    });

    if (count > 0) {
      this.logger.debug(`[FormValidationCache] Invalidated ${count} entries for form: ${formId}`);
    }

    return count;
  }

  /**
   * Limpa todo o cache
   */
  clearCache(): void {
    const valuesCount = this.validValuesCache.size;
    const errorsCount = this.validationErrorsCache.size;

    this.validValuesCache.clear();
    this.validationErrorsCache.clear();

    this.logger.debug(`[FormValidationCache] Cleared entire cache (${valuesCount} values, ${errorsCount} errors)`);
  }

  /**
   * Obtém estatísticas do cache
   */
  getStats(): any {
    return {
      validValuesSize: this.validValuesCache.size,
      errorsSize: this.validationErrorsCache.size,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: this.cacheHits / (this.cacheHits + this.cacheMisses || 1),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Limpa entradas expiradas do cache
   */
  cleanExpired(): number {
    const now = Date.now();
    let count = 0;

    // Limpar cache de valores válidos
    this.validValuesCache.forEach((item, key) => {
      if (item.expires && now > item.expires) {
        this.validValuesCache.delete(key);
        count++;
      }
    });

    // Limpar cache de erros
    this.validationErrorsCache.forEach((item, key) => {
      if (item.expires && now > item.expires) {
        this.validationErrorsCache.delete(key);
        count++;
      }
    });

    if (count > 0) {
      this.logger.debug(`[FormValidationCache] Removed ${count} expired entries`);
    }

    return count;
  }

  /**
   * Libera espaço no cache de valores válidos eliminando entradas mais antigas
   */
  private pruneCache(): void {
    // Ordenar por timestamp (mais antigos primeiro)
    const entries = Array.from(this.validValuesCache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);

    // Remover os 20% mais antigos
    const toRemove = Math.max(Math.floor(entries.length * 0.2), 1);

    for (let i = 0; i < toRemove; i++) {
      this.validValuesCache.delete(entries[i][0]);
    }

    this.logger.debug(`[FormValidationCache] Pruned ${toRemove} oldest valid values entries`);
  }

  /**
   * Libera espaço no cache de erros eliminando entradas mais antigas
   */
  private pruneErrorsCache(): void {
    // Ordenar por timestamp (mais antigos primeiro)
    const entries = Array.from(this.validationErrorsCache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);

    // Remover os 20% mais antigos
    const toRemove = Math.max(Math.floor(entries.length * 0.2), 1);

    for (let i = 0; i < toRemove; i++) {
      this.validationErrorsCache.delete(entries[i][0]);
    }

    this.logger.debug(`[FormValidationCache] Pruned ${toRemove} oldest validation errors entries`);
  }
}
