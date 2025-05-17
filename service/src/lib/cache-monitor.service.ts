import { Injectable, inject } from '@angular/core';
import { LoggingService } from '@vai/services';
import { EnhancedLRUSignalCache } from '@vai/utils';

/**
 * Serviço para monitoramento centralizado de todos os caches da aplicação
 */
@Injectable({
  providedIn: 'root',
})
export class CacheMonitorService {
  private readonly registeredCaches = new Map<string, EnhancedLRUSignalCache<any>>();
  private monitoringInterval: any;
  private loggingService = inject(LoggingService);

  /**
   * Registra um cache para monitoramento
   * @param name Nome identificador para o cache
   * @param cache Instância do cache a ser monitorada
   */
  registerCache(name: string, cache: EnhancedLRUSignalCache<any>): void {
    this.registeredCaches.set(name, cache);
    this.loggingService.debug(`Cache registered for monitoring: ${name}`);
  }

  /**
   * Inicia o monitoramento periódico dos caches
   * @param intervalMs Intervalo em milissegundos entre verificações (padrão: 5min)
   */
  startMonitoring(intervalMs = 5 * 60 * 1000): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.monitoringInterval = setInterval(() => {
      this.logAllCacheStats();
      this.cleanExpiredEntries();
    }, intervalMs);

    this.loggingService.info(`Cache monitoring started with interval ${intervalMs}ms`);
  }

  /**
   * Para o monitoramento periódico
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      this.loggingService.info('Cache monitoring stopped');
    }
  }

  /**
   * Registra as estatísticas de todos os caches no log
   */
  logAllCacheStats(): void {
    if (this.registeredCaches.size === 0) {
      this.loggingService.debug('Cache Monitor: No caches registered');
      return;
    }

    const stats: Record<string, any> = {};

    this.registeredCaches.forEach((cache, name) => {
      const cacheStats = cache.getStats();
      stats[name] = {
        entries: cacheStats.entries,
        sizeKB: Math.round(cacheStats.bytes / 1024),
        avgAccessCount: cacheStats.avgAccessCount,
        usagePercent: Math.round((cacheStats.entries / cacheStats.maxEntries) * 100),
        memoryPercent: Math.round((cacheStats.bytes / cacheStats.maxBytes) * 100),
      };

      // Incluir hot paths para cada cache
      stats[name].hotPaths = cache.getHotPaths(3);
    });

    this.loggingService.debug('Cache Monitor Report', stats);
  }

  /**
   * Limpa entradas expiradas em todos os caches
   * @returns Número total de entradas removidas
   */
  cleanExpiredEntries(): number {
    let totalRemoved = 0;

    this.registeredCaches.forEach((cache, name) => {
      const removed = cache.cleanExpired();
      if (removed > 0) {
        totalRemoved += removed;
      }
    });

    if (totalRemoved > 0) {
      this.loggingService.info(`Cache Monitor: Removed ${totalRemoved} expired entries from all caches`);
    }

    return totalRemoved;
  }

  /**
   * Limpa todos os caches registrados
   */
  clearAllCaches(): void {
    this.registeredCaches.forEach((cache, name) => {
      cache.clear();
    });
    this.loggingService.info(`All registered caches cleared (${this.registeredCaches.size} caches)`);
  }

  /**
   * Limpa caches específicos por um padrão de nome
   * @param pattern Padrão a ser usado para identificar caches a serem limpos
   */
  clearCachesByPattern(pattern: string): void {
    let clearedCount = 0;

    this.registeredCaches.forEach((cache, name) => {
      if (name.includes(pattern)) {
        cache.clear();
        clearedCount++;
      }
    });

    if (clearedCount > 0) {
      this.loggingService.info(`Cleared ${clearedCount} caches matching pattern: ${pattern}`);
    }
  }

  /**
   * Invalida entradas de cache por uma tag específica em todos os caches
   * @param tag Tag para invalidação
   */
  invalidateByTagInAllCaches(tag: string): void {
    this.registeredCaches.forEach((cache, name) => {
      cache.invalidateByTag(tag);
    });
    this.loggingService.info(`Invalidated entries with tag '${tag}' in all caches`);
  }
}
