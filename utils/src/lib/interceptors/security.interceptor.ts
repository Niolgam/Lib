import { Injectable, inject } from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpInterceptor, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthConfigService } from '../services/auth-config.service';
import { LoggingService } from '@vai/services';

/**
 * Interceptor para adicionar headers de segurança padrão a todas as requisições HTTP
 * Separado do AuthInterceptor para melhor separação de responsabilidades
 */
@Injectable()
export class SecurityHeadersInterceptor implements HttpInterceptor {
  private authConfigService = inject(AuthConfigService);
  private loggingService = inject(LoggingService);

  // Cache para headers de segurança
  private readonly securityHeadersCache = new Map<string, { headers: HttpHeaders; expires: number }>();
  private readonly CACHE_TTL = 300000; // 5 minutos
  private readonly MAX_CACHE_SIZE = 100;

  // Estatísticas de cache
  private cacheHits = 0;
  private cacheMisses = 0;

  intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Chave de cache baseada no método e URL
    const cacheKey = `${request.method}:${request.url}`;

    // Verificar se há headers em cache para esta requisição
    const cachedEntry = this.securityHeadersCache.get(cacheKey);
    if (cachedEntry && cachedEntry.expires > Date.now()) {
      this.cacheHits++;
      const secureRequest = request.clone({ headers: cachedEntry.headers });
      return next.handle(secureRequest);
    }

    this.cacheMisses++;

    // Limpar cache se ficar muito grande
    if (this.securityHeadersCache.size >= this.MAX_CACHE_SIZE) {
      this._pruneCache();
    }

    const config = this.authConfigService.config();

    // Verifica se o modo de segurança elevada está ativado
    const isEnhancedSecurityEnabled = config?.enhancedSecurityEnabled ?? false;

    // Headers básicos de segurança
    let secureHeaders = request.headers.set('X-Requested-With', 'XMLHttpRequest').set('X-Content-Type-Options', 'nosniff');

    // Não sobrescrever o Content-Type se já estiver definido
    if (!request.headers.has('Content-Type')) {
      secureHeaders = secureHeaders.set('Content-Type', 'application/json');
    }

    // Adiciona headers mais rigorosos se o modo de segurança elevada estiver ativado
    if (isEnhancedSecurityEnabled) {
      secureHeaders = secureHeaders.set('X-Frame-Options', 'DENY').set('Referrer-Policy', 'strict-origin-when-cross-origin');

      // Adiciona proteção contra cache para todas as requisições em modo de segurança elevada
      if (!secureHeaders.has('Cache-Control')) {
        secureHeaders = secureHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate').set('Pragma', 'no-cache');
      }
    }

    // Armazenar os headers computados em cache
    this.securityHeadersCache.set(cacheKey, {
      headers: secureHeaders,
      expires: Date.now() + this.CACHE_TTL,
    });

    const secureRequest = request.clone({ headers: secureHeaders });
    return next.handle(secureRequest);
  }

  /**
   * Remove entradas antigas do cache
   * @private
   */
  private _pruneCache(): void {
    const now = Date.now();
    let removedCount = 0;

    // Remover entradas expiradas
    this.securityHeadersCache.forEach((value, key) => {
      if (value.expires < now) {
        this.securityHeadersCache.delete(key);
        removedCount++;
      }
    });

    // Se ainda estiver muito grande, remover as entradas mais antigas
    if (this.securityHeadersCache.size >= this.MAX_CACHE_SIZE) {
      const keysToDelete = Array.from(this.securityHeadersCache.keys()).slice(0, Math.floor(this.MAX_CACHE_SIZE * 0.2)); // Remove 20% das entradas

      keysToDelete.forEach((key) => {
        this.securityHeadersCache.delete(key);
        removedCount++;
      });
    }

    if (removedCount > 0) {
      this.loggingService.debug('SecurityHeadersInterceptor: Cache cleaned', {
        removedEntries: removedCount,
        remainingSize: this.securityHeadersCache.size,
      });
    }
  }

  /**
   * Logs estatísticas de cache
   */
  logCacheStats(): void {
    this.loggingService.debug('SecurityHeadersInterceptor: Cache stats', {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRatio: this.cacheHits / (this.cacheHits + this.cacheMisses || 1),
      cacheSize: this.securityHeadersCache.size,
    });

    // Reset contadores após log
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Limpa todos os caches do interceptor
   */
  clearCache(): void {
    this.securityHeadersCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;

    this.loggingService.debug('SecurityHeadersInterceptor: Cache cleared');
  }

  /**
   * Invalida cache para uma URL específica
   * @param url URL para invalidar no cache
   */
  invalidateUrlCache(url: string): void {
    const prefixToDelete = `:${url}`;

    this.securityHeadersCache.forEach((_, key) => {
      if (key.includes(prefixToDelete)) {
        this.securityHeadersCache.delete(key);
      }
    });
  }
}
