import { Injectable, Signal, inject } from '@angular/core';
import { EnhancedLRUSignalCache } from '@vai/utils';
import { LoggingService } from '@vai/services';
import { CacheMonitorService } from '@vai/services';

/**
 * Interface de opções de cache
 */
export interface CacheOptions {
  name: string;
  maxSize?: number;
  maxTotalBytes?: number;
  expiryTimeMs?: number;
  tags?: string[];
}

/**
 * Factory para criar configurações padrão
 */
export function createDefaultCacheOptions(name: string): CacheOptions {
  return {
    name,
    maxSize: 100,
    maxTotalBytes: 10 * 1024 * 1024, // 10MB
    expiryTimeMs: 60 * 60 * 1000, // 1 hora
  };
}

/**
 * Serviço centralizado para gerenciar caches em toda a aplicação
 * Fornece uma interface única para criação e gerenciamento de caches
 */
@Injectable({
  providedIn: 'root',
})
export class CentralizedCacheService {
  private loggingService = inject(LoggingService);
  private cacheMonitor = inject(CacheMonitorService);

  // Registro de caches
  private caches = new Map<string, EnhancedLRUSignalCache<any>>();

  // Registro de tags para invalidação rápida
  private tagRegistry = new Map<string, Set<string>>();

  /**
   * Obtém ou cria um cache com as opções especificadas
   */
  getOrCreateCache<T>(options: CacheOptions): EnhancedLRUSignalCache<T> {
    // Se o cache já existe, retorna a instância
    if (this.caches.has(options.name)) {
      return this.caches.get(options.name) as EnhancedLRUSignalCache<T>;
    }

    // Cria um novo cache com as opções fornecidas
    const cache = new EnhancedLRUSignalCache<T>(
      options.maxSize,
      options.maxTotalBytes,
      options.expiryTimeMs,
      5, // frequencyThreshold padrão
      this.loggingService,
    );

    // Registra o cache
    this.caches.set(options.name, cache);

    // Registra o cache no monitor
    this.cacheMonitor.registerCache(options.name, cache);

    // Registra tags para este cache
    if (options.tags && options.tags.length > 0) {
      options.tags.forEach((tag) => {
        if (!this.tagRegistry.has(tag)) {
          this.tagRegistry.set(tag, new Set());
        }
        this.tagRegistry.get(tag)!.add(options.name);
      });
    }

    this.loggingService.debug(`CentralizedCacheService: Created cache "${options.name}"`);
    return cache;
  }

  /**
   * Armazena um valor no cache
   */
  set<T>(options: CacheOptions, key: string, value: Signal<T>, tags: string[] = []): void {
    const cache = this.getOrCreateCache<T>(options);

    // Registra tags para a chave específica para invalidação seletiva
    const fullTags = [...(options.tags || []), ...tags];

    // Armazena o valor no cache
    cache.set(key, value, fullTags);

    this.loggingService.debug(`CentralizedCacheService: Set value in cache "${options.name}" with key "${key}"`);
  }

  /**
   * Obtém um valor do cache
   */
  get<T>(options: CacheOptions, key: string): Signal<T> | undefined {
    const cache = this.getOrCreateCache<T>(options);
    return cache.get(key);
  }

  /**
   * Invalida valores de cache por tag
   */
  invalidateByTag(tag: string): void {
    // Obtém todos os caches que têm essa tag
    const cacheNames = this.tagRegistry.get(tag);
    if (!cacheNames || cacheNames.size === 0) return;

    let totalInvalidated = 0;

    cacheNames.forEach((cacheName) => {
      const cache = this.caches.get(cacheName);
      if (cache) {
        cache.invalidateByTag(tag);
        totalInvalidated++;
      }
    });

    if (totalInvalidated > 0) {
      this.loggingService.debug(`CentralizedCacheService: Invalidated tag "${tag}" in ${totalInvalidated} caches`);
    }
  }

  /**
   * Invalida valores de cache por prefixo de chave
   */
  invalidateByPrefix(cacheName: string, prefix: string): void {
    const cache = this.caches.get(cacheName);
    if (!cache) return;

    cache.invalidateByPrefix(prefix);
    this.loggingService.debug(`CentralizedCacheService: Invalidated prefix "${prefix}" in cache "${cacheName}"`);
  }

  /**
   * Limpa um cache específico
   */
  clearCache(cacheName: string): void {
    const cache = this.caches.get(cacheName);
    if (!cache) return;

    cache.clear();
    this.loggingService.debug(`CentralizedCacheService: Cleared cache "${cacheName}"`);
  }

  /**
   * Limpa todos os caches
   */
  clearAllCaches(): void {
    this.caches.forEach((cache, name) => {
      cache.clear();
    });

    this.loggingService.debug(`CentralizedCacheService: Cleared all caches (${this.caches.size} caches)`);
  }

  /**
   * Limpa entradas expiradas em todos os caches
   */
  cleanExpiredEntries(): number {
    let totalRemoved = 0;

    this.caches.forEach((cache, name) => {
      const removed = cache.cleanExpired();
      if (removed > 0) {
        this.loggingService.debug(`CentralizedCacheService: Removed ${removed} expired entries from cache "${name}"`);
        totalRemoved += removed;
      }
    });

    return totalRemoved;
  }

  /**
   * Obtém estatísticas de todos os caches
   */
  getAllCacheStats(): Record<string, any> {
    const stats: Record<string, any> = {};

    this.caches.forEach((cache, name) => {
      stats[name] = cache.getStats();
    });

    return stats;
  }

  /**
   * Obtém estatísticas de um cache específico
   */
  getCacheStats(cacheName: string): any {
    const cache = this.caches.get(cacheName);
    if (!cache) return null;

    return cache.getStats();
  }

  /**
   * Obtém lista de caches registrados
   */
  getRegisteredCaches(): string[] {
    return Array.from(this.caches.keys());
  }
}
