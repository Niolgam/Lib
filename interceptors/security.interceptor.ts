import { Injectable, inject } from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpInterceptor, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthConfigService } from '../services/auth-config.service';
import { LoggingService } from '@vai/services';
import { HttpCacheService } from '../services';

/**
 * Interceptor para adicionar headers de segurança padrão a todas as requisições HTTP
 * Separado do AuthInterceptor para melhor separação de responsabilidades
 */
@Injectable()
export class SecurityHeadersInterceptor implements HttpInterceptor {
  private authConfigService = inject(AuthConfigService);
  private loggingService = inject(LoggingService);
  private httpCache = inject(HttpCacheService); // Injeção do serviço de cache centralizado

  intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Chave de cache baseada no método e URL
    const cacheKey = `${request.method}:${request.url}`;

    // Verificar se há headers em cache para esta requisição
    const cachedHeaders = this.httpCache.get<HttpHeaders>('security', cacheKey);
    if (cachedHeaders) {
      const secureRequest = request.clone({ headers: cachedHeaders });
      return next.handle(secureRequest);
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

    // Armazenar os headers computados em cache com tags apropriadas
    this.httpCache.set('security', cacheKey, secureHeaders, {
      tags: ['security', isEnhancedSecurityEnabled ? 'enhanced-security' : 'standard-security', request.url.includes('auth') ? 'auth' : 'api'],
    });

    const secureRequest = request.clone({ headers: secureHeaders });
    return next.handle(secureRequest);
  }

  /**
   * Logs estatísticas de cache
   */
  logCacheStats(): void {
    const stats = this.httpCache.getAndResetStats('security');
    this.loggingService.debug('SecurityHeadersInterceptor: Cache stats', stats);
  }

  /**
   * Limpa todos os caches do interceptor
   */
  clearCache(): void {
    this.httpCache.clear('security');
    this.loggingService.debug('SecurityHeadersInterceptor: Cache cleared');
  }

  /**
   * Invalida cache para uma URL específica
   * @param url URL para invalidar no cache
   */
  invalidateUrlCache(url: string): void {
    this.httpCache.invalidateByUrlPattern('security', url);
  }
}
