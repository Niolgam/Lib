import { Injectable, inject } from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpInterceptor, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { AuthConfigService } from '../services/auth-config.service';
import { CsrfService } from '../services/csrf.service';
import { LoggingService } from '@vai/services';
import { SecurityMonitorService } from '../services/security-monitor.service';
import { HttpCacheService } from '../services';

@Injectable()
export class CsrfInterceptor implements HttpInterceptor {
  private csrfService = inject(CsrfService);
  private authConfigService = inject(AuthConfigService);
  private loggingService = inject(LoggingService);
  private securityMonitor = inject(SecurityMonitorService);
  private httpCache = inject(HttpCacheService); // Injeção do serviço de cache

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    // Verifica se a URL da requisição é para uma das suas APIs que requerem CSRF
    if (this._isUnsafeMethod(request.method) && this._requiresCsrfProtection(request.url)) {
      return this.csrfService.getToken().pipe(
        // getToken do CsrfService já foi refatorado
        switchMap((token) => {
          // Usa o csrfHeaderName do AuthConfigService (que é um computed signal ou lido do config())
          const headerName = this.authConfigService.csrfHeaderName() || 'X-XSRF-TOKEN';

          // Adiciona token CSRF ao request
          // withCredentials já adicionado pelo SecurityHeadersInterceptor
          const csrfRequest = request.clone({
            headers: request.headers.set(headerName, token),
          });

          return next.handle(csrfRequest).pipe(catchError((error) => this._handleCsrfError(error, csrfRequest, next)));
        }),
        catchError((error) => {
          // Erro ao obter o token CSRF inicial do CsrfService
          this.loggingService.error('CsrfInterceptor: Failed to get initial CSRF token.', { error });

          // Registra evento de segurança
          this.securityMonitor.logCsrfFailure(request.url, {
            issue: 'initial_token_fetch_failed',
            error: error.message,
          });

          // Deixa o erro original fluir, o AuthInterceptor pode tratar 401/403 genéricos
          return throwError(() => error);
        }),
      );
    }

    // Para requisições que não precisam de CSRF, passa adiante
    return next.handle(request);
  }

  /**
   * Trata erros relacionados a CSRF
   * @private
   */
  private _handleCsrfError(error: any, request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    if (error instanceof HttpErrorResponse && error.status === 403 && error.error?.code === 'INVALID_CSRF_TOKEN') {
      this.loggingService.warn('CsrfInterceptor: Invalid CSRF token, attempting to get new token and retry.');

      // Registra evento de segurança
      this.securityMonitor.logCsrfFailure(request.url, {
        issue: 'invalid_token_rejected',
        status: error.status,
        errorCode: error.error?.code,
      });

      // Limpa o token antigo no CsrfService
      this.csrfService.clearToken();

      // Limpa cache de CSRF para esta URL
      this.httpCache.invalidateByUrlPattern('csrf', request.url);
      // Também invalida o cache de headers CSRF
      this.httpCache.invalidateByTag('csrf');

      // Tenta obter um novo token e repetir a requisição
      return this.csrfService.getToken().pipe(
        switchMap((newToken) => {
          const headerName = this.authConfigService.csrfHeaderName() || 'X-XSRF-TOKEN';
          const retryRequest = request.clone({
            headers: request.headers.set(headerName, newToken),
          });
          return next.handle(retryRequest);
        }),
        catchError((retryError) => {
          this.loggingService.error('CsrfInterceptor: Failed to get new CSRF token after error or retry failed.', { retryError });

          // Registra evento de segurança crítico - falha no retry
          this.securityMonitor.logCsrfFailure(request.url, {
            issue: 'retry_failed',
            originalError: error.error?.code,
            retryError: retryError.message,
          });

          return throwError(() => retryError);
        }),
      );
    }

    // Se não for erro relacionado a CSRF, passa adiante
    return throwError(() => error);
  }

  /**
   * Verifica método HTTP é inseguro (requer CSRF)
   * @private
   */
  private _isUnsafeMethod(method: string): boolean {
    return ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase());
  }

  /**
   * Verifica se URL requer proteção CSRF
   * Usa cache para melhorar performance
   * @private
   */
  private _requiresCsrfProtection(url: string): boolean {
    // Usar o serviço centralizado de cache
    const cachedResult = this.httpCache.get<boolean>('csrf', url);
    if (cachedResult !== null) {
      return cachedResult;
    }

    // Verifica se a URL da requisição é para a sua API principal ou de autenticação
    // que requer proteção CSRF.
    const authApiBase = this.authConfigService.effectiveAuthApiBaseUrl();
    const userManagementApiBase = this.authConfigService.effectiveUserManagementApiBaseUrl();

    let requiresProtection = false;

    // URL da API de autenticação
    if (authApiBase && url.startsWith(authApiBase)) {
      requiresProtection = true;
    }

    // URL da API de gerenciamento de usuários (se diferente da API de auth)
    else if (userManagementApiBase && url.startsWith(userManagementApiBase) && userManagementApiBase !== authApiBase) {
      requiresProtection = true;
    }

    // Configuração adicional - CORS
    else {
      const config = this.authConfigService.config();
      const enhancedSecurity = config?.enhancedSecurityEnabled ?? false;

      // Em modo de segurança elevada, verifica outras APIs
      if (enhancedSecurity) {
        // Configuração adicional aqui para APIs específicas
        // ...
      }
    }

    // Armazenar resultado no cache com tags para invalidação seletiva
    this.httpCache.set('csrf', url, requiresProtection, {
      tags: ['csrf', url.includes('auth') ? 'auth' : 'api'],
    });

    return requiresProtection;
  }

  /**
   * Logs estatísticas de cache
   */
  logCacheStats(): void {
    const stats = this.httpCache.getAndResetStats('csrf');
    this.loggingService.debug('CsrfInterceptor: Cache stats', stats);
  }

  /**
   * Limpa todos os caches do interceptor
   */
  clearCache(): void {
    this.httpCache.clear('csrf');
    this.loggingService.debug('CsrfInterceptor: Cache cleared');
  }
}
