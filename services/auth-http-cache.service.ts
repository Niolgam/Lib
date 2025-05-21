import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { HttpHeaders } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { LoggingService } from '@vai/services';

/**
 * Interface para entradas de cache
 */
export interface CacheEntry<T> {
  data: T;
  expires: number;
  metadata?: Record<string, any>;
}

/**
 * Opções para operações de cache
 */
export interface CacheOptions {
  ttl?: number; // Tempo de vida em ms
  key?: string; // Chave de cache personalizada
  tags?: string[]; // Tags para invalidação seletiva
  metadata?: Record<string, any>; // Metadados adicionais
}

/**
 * Estatísticas de cache
 */
export interface CacheStats {
  cacheHits: number;
  cacheMisses: number;
  cacheSize: number;
  hitRatio: number;
}

/**
 * Serviço centralizado de cache HTTP para todos os interceptors
 * Implementa features comuns como TTL, invalidação por tag e monitoramento
 */
@Injectable({
  providedIn: 'root',
})
export class HttpCacheService {
  private loggingService = inject(LoggingService);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  // Caches para diferentes interceptors
  private headerCache = new Map<string, CacheEntry<HttpHeaders>>();
  private csrfRequirementsCache = new Map<string, CacheEntry<boolean>>();
  private securityHeadersCache = new Map<string, CacheEntry<HttpHeaders>>();

  // Registro de tags para invalidação rápida
  private tagRegistry = new Map<string, Set<string>>();

  // Estatísticas por cache
  private stats: Record<string, { hits: number; misses: number }> = {
    header: { hits: 0, misses: 0 },
    csrf: { hits: 0, misses: 0 },
    security: { hits: 0, misses: 0 },
  };

  // Configurações padrão
  private readonly DEFAULT_TTL = 300000; // 5 minutos
  private readonly MAX_CACHE_SIZE = 1000; // limite global
  private readonly CACHE_CLEANUP_INTERVAL = 3600000; // 1 hora

  constructor() {
    // Configurar limpeza automática do cache
    if (this.isBrowser) {
      setInterval(() => this.cleanExpiredEntries(), this.CACHE_CLEANUP_INTERVAL);
    }
  }

  /**
   * Interface genérica para obter dados do cache
   */
  get<T>(cacheType: 'header' | 'csrf' | 'security', key: string): T | null {
    const cache = this.getCache<T>(cacheType);
    const entry = cache.get(key);

    // Verificar se existe e não expirou
    if (entry && entry.expires > Date.now()) {
      this.stats[cacheType].hits++;
      return entry.data;
    }

    // Remove se existir mas estiver expirado
    if (entry) {
      cache.delete(key);
    }

    this.stats[cacheType].misses++;
    return null;
  }

  /**
   * Interface genérica para armazenar dados no cache
   */
  set<T>(cacheType: 'header' | 'csrf' | 'security', key: string, data: T, options?: CacheOptions): void {
    const cache = this.getCache<T>(cacheType);
    const ttl = options?.ttl || this.DEFAULT_TTL;

    // Criar entrada de cache
    const entry: CacheEntry<T> = {
      data,
      expires: Date.now() + ttl,
      metadata: options?.metadata,
    };

    // Adicionar entry ao cache
    cache.set(key, entry);

    // Registrar tags para invalidação
    if (options?.tags && options.tags.length > 0) {
      options.tags.forEach((tag) => {
        if (!this.tagRegistry.has(tag)) {
          this.tagRegistry.set(tag, new Set());
        }
        this.tagRegistry.get(tag)!.add(`${cacheType}:${key}`);
      });
    }

    // Gerenciar tamanho do cache
    this.enforceCacheSizeLimit(cacheType);
  }

  /**
   * Remove entrada do cache
   */
  remove(cacheType: 'header' | 'csrf' | 'security', key: string): void {
    const cache = this.getCache(cacheType);
    cache.delete(key);

    // Remover das tags
    this.tagRegistry.forEach((entries, tag) => {
      entries.delete(`${cacheType}:${key}`);
      if (entries.size === 0) {
        this.tagRegistry.delete(tag);
      }
    });
  }

  /**
   * Limpa todas as entradas de um cache específico
   */
  clear(cacheType: 'header' | 'csrf' | 'security'): void {
    const cache = this.getCache(cacheType);
    const cacheSize = cache.size;

    cache.clear();

    // Atualiza o registro de tags
    this.tagRegistry.forEach((entries, tag) => {
      const updatedEntries = new Set<string>();
      entries.forEach((entry) => {
        if (!entry.startsWith(`${cacheType}:`)) {
          updatedEntries.add(entry);
        }
      });

      if (updatedEntries.size === 0) {
        this.tagRegistry.delete(tag);
      } else {
        this.tagRegistry.set(tag, updatedEntries);
      }
    });

    this.loggingService.debug(`HttpCacheService: Cleared ${cacheSize} entries from ${cacheType} cache`);
  }

  /**
   * Invalida cache baseado em um padrão de URL
   */
  invalidateByUrlPattern(cacheType: 'header' | 'csrf' | 'security', pattern: string): void {
    const cache = this.getCache(cacheType);
    const keysToDelete: string[] = [];

    cache.forEach((_, key) => {
      if (key.includes(pattern)) {
        keysToDelete.push(key);
      }
    });

    let count = 0;
    keysToDelete.forEach((key) => {
      this.remove(cacheType, key);
      count++;
    });

    if (count > 0) {
      this.loggingService.debug(`HttpCacheService: Invalidated ${count} entries by pattern "${pattern}"`);
    }
  }

  /**
   * Invalida cache baseado em tags
   */
  invalidateByTag(tag: string): void {
    const entries = this.tagRegistry.get(tag);
    if (!entries || entries.size === 0) return;

    let count = 0;

    entries.forEach((entry) => {
      const [cacheType, key] = entry.split(':', 2) as ['header' | 'csrf' | 'security', string];

      const cache = this.getCache(cacheType);
      if (cache.has(key)) {
        cache.delete(key);
        count++;
      }
    });

    // Limpa a tag após invalidação
    this.tagRegistry.delete(tag);

    if (count > 0) {
      this.loggingService.debug(`HttpCacheService: Invalidated ${count} entries by tag "${tag}"`);
    }
  }

  /**
   * Limpa entradas expiradas de todos os caches
   */
  cleanExpiredEntries(): void {
    const now = Date.now();
    let totalRemoved = 0;

    // Limpar cada cache
    ['header', 'csrf', 'security'].forEach((cacheType) => {
      const cache = this.getCache(cacheType as 'header' | 'csrf' | 'security');
      const keysToDelete: string[] = [];

      cache.forEach((entry, key) => {
        if (entry.expires < now) {
          keysToDelete.push(key);
        }
      });

      keysToDelete.forEach((key) => {
        this.remove(cacheType as 'header' | 'csrf' | 'security', key);
      });

      totalRemoved += keysToDelete.length;
    });

    if (totalRemoved > 0) {
      this.loggingService.debug(`HttpCacheService: Removed ${totalRemoved} expired entries`);
    }
  }

  /**
   * Retorna estatísticas sobre o uso do cache
   */
  getStats(): Record<string, CacheStats> {
    const result: Record<string, CacheStats> = {};

    ['header', 'csrf', 'security'].forEach((cacheType) => {
      const cache = this.getCache(cacheType as 'header' | 'csrf' | 'security');
      const { hits, misses } = this.stats[cacheType];
      const total = hits + misses || 1; // Evitar divisão por zero

      result[cacheType] = {
        cacheHits: hits,
        cacheMisses: misses,
        cacheSize: cache.size,
        hitRatio: hits / total,
      };
    });

    return result;
  }

  /**
   * Reinicia estatísticas
   */
  resetStats(): void {
    Object.keys(this.stats).forEach((key) => {
      this.stats[key] = { hits: 0, misses: 0 };
    });
  }

  /**
   * Retorna estatísticas de um cache específico e reseta contadores
   */
  getAndResetStats(cacheType: 'header' | 'csrf' | 'security'): CacheStats {
    const cache = this.getCache(cacheType);
    const { hits, misses } = this.stats[cacheType];
    const total = hits + misses || 1; // Evitar divisão por zero

    // Resetar estatísticas
    this.stats[cacheType] = { hits: 0, misses: 0 };

    return {
      cacheHits: hits,
      cacheMisses: misses,
      cacheSize: cache.size,
      hitRatio: hits / total,
    };
  }

  /**
   * Retorna o cache apropriado para o tipo
   */
  private getCache<T>(cacheType: 'header' | 'csrf' | 'security'): Map<string, CacheEntry<T>> {
    switch (cacheType) {
      case 'header':
        return this.headerCache as Map<string, CacheEntry<T>>;
      case 'csrf':
        return this.csrfRequirementsCache as Map<string, CacheEntry<T>>;
      case 'security':
        return this.securityHeadersCache as Map<string, CacheEntry<T>>;
      default:
        throw new Error(`Cache type ${cacheType} not supported`);
    }
  }

  /**
   * Garante que o cache não exceda o limite de tamanho
   */
  private enforceCacheSizeLimit(cacheType: 'header' | 'csrf' | 'security'): void {
    const cache = this.getCache(cacheType);

    if (cache.size <= this.MAX_CACHE_SIZE) return;

    // Remover 20% das entradas mais antigas
    const keysToRemove = Math.floor(this.MAX_CACHE_SIZE * 0.2);
    const keys = Array.from(cache.keys()).slice(0, keysToRemove);

    keys.forEach((key) => {
      this.remove(cacheType, key);
    });

    this.loggingService.debug(`HttpCacheService: Removed ${keys.length} entries from ${cacheType} cache due to size limit`);
  }
}
