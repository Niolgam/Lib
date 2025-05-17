import { Injectable, inject } from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpInterceptor, HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, switchMap, finalize, tap } from 'rxjs/operators';
import { Router } from '@angular/router';

import { CryptoService, LoggingService } from '@vai/services';
import { AuthService, AuthConfigService } from '../services';
import { SecurityMonitorService } from '../services/security-monitor.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private authService = inject(AuthService);
  private loggingService = inject(LoggingService);
  private router = inject(Router);
  private authConfigService = inject(AuthConfigService);
  private securityMonitor = inject(SecurityMonitorService);
  private cryptoService = inject(CryptoService);

  // Controle de refresh de token
  private isRefreshing = false;
  private refreshAttempts = 0;
  private readonly MAX_REFRESH_ATTEMPTS = 1;

  // Lista de padrões sensíveis para detecção
  private readonly sensitiveUrlPatterns = [/\/login$/i, /\/auth\//i, /\/user/i, /\/profile/i, /\/password/i];

  // Cache para URLs sensíveis
  private readonly sensitivityCache = new Map<string, { result: boolean; expires: number }>();
  private readonly CACHE_TTL = 60000; // 1 minuto em milissegundos
  private readonly MAX_CACHE_SIZE = 100; // Limitar tamanho para evitar memory leak

  // Cache para resultados de verificações de padrões sensíveis
  private readonly patternMatchCache = new Map<string, boolean>();

  // Para contabilidade de cache hit/miss
  private cacheHits = 0;
  private cacheMisses = 0;

  // Cache de URLs relacionadas à autenticação
  private readonly authRelatedUrlsCache = new Map<string, boolean>();

  // Cache para prevenção de ataques de replay
  private processedNonces = new Set<string>();
  private readonly MAX_NONCE_CACHE = 1000;

  intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const effectiveApiBaseForAuth = this.authConfigService.effectiveAuthApiBaseUrl();
    let clonedRequest = request;

    // Adiciona headers de segurança para endpoints de API
    if (effectiveApiBaseForAuth && request.url.startsWith(effectiveApiBaseForAuth)) {
      clonedRequest = this._addSecurityHeaders(request);
    }

    // Detecta requisições sensíveis para monitoramento adicional
    const isSensitiveRequest = this._isSensitiveRequest(clonedRequest);
    if (isSensitiveRequest) {
      // Adiciona nonce para prevenção de replay attacks em requisições sensíveis
      clonedRequest = this._addNonceHeader(clonedRequest);
    }

    return next.handle(clonedRequest).pipe(
      tap((event) => {
        // Monitora respostas para detecção de anomalias
        if (isSensitiveRequest && event instanceof HttpResponse) {
          this._monitorResponse(event, clonedRequest);
        }
      }),
      catchError((error) => {
        if (error instanceof HttpErrorResponse) {
          const authConfigSnapshot = this.authConfigService.config();

          // Trata erros 401 (Unauthorized)
          if (error.status === 401) {
            this.loggingService.warn('AuthInterceptor: Received 401 unauthorized', { url: request.url });

            // Registra evento de segurança
            this.securityMonitor.logSecurityEvent('auth.unauthorized', 'warning', { url: request.url });

            if (!this._isAuthRelatedEndpoint(request.url)) {
              return this._handleUnauthorizedError(clonedRequest, next);
            }

            // Para endpoints de autenticação que retornam 401 (ex: /auth/status falhou, refresh já tentado)
            this.loggingService.info('AuthInterceptor: 401 on auth endpoint, performing full logout.', { url: request.url });

            // Registra evento de segurança
            this.securityMonitor.logSecurityEvent('auth.unauthorized_auth_endpoint', 'warning', { url: request.url });

            // Chamada ao logout público, que cuidará de clearAuthState e redirecionamento
            return this.authService.logout().pipe(
              switchMap(() => throwError(() => error)), // Propaga o erro 401 original após logout
            );
          }

          // Trata erros 403 (Forbidden)
          if (error.status === 403 && !(error.error?.code === 'INVALID_CSRF_TOKEN')) {
            this.loggingService.warn('AuthInterceptor: Received 403 forbidden', { url: request.url });

            // Registra evento de segurança
            this.securityMonitor.logSecurityEvent('auth.forbidden', 'warning', { url: request.url });

            const accessDeniedRoute = authConfigSnapshot?.accessDeniedRoute || '/access-denied';
            this.router.navigate([accessDeniedRoute]);
            // Não precisa de logout aqui, apenas redireciona
          }

          // Trata erros CSRF (código específico retornado pelo backend)
          if (error.status === 403 && error.error?.code === 'INVALID_CSRF_TOKEN') {
            this.loggingService.warn('AuthInterceptor: Invalid CSRF token', { url: request.url });

            // Registra evento de segurança
            this.securityMonitor.logSecurityEvent('security.csrf_failure', 'warning', { url: request.url });
          }

          // Trata erros de segurança (códigos específicos)
          if (error.status === 400 && error.error?.code === 'SECURITY_VIOLATION') {
            this.loggingService.error('AuthInterceptor: Security violation detected', {
              url: request.url,
              details: error.error?.details,
            });

            // Registra evento de segurança
            this.securityMonitor.logSecurityEvent('security.violation', 'critical', {
              url: request.url,
              details: error.error?.details,
            });

            // Caso seja crítico, pode forçar logout
            if (error.error?.action === 'LOGOUT') {
              return this.authService.logout().pipe(switchMap(() => throwError(() => error)));
            }
          }

          // Detecção de possíveis ataques de injeção/XSS nas respostas
          if (this._detectMaliciousResponse(error)) {
            this.loggingService.error('AuthInterceptor: Potentially malicious response detected', {
              url: request.url,
            });

            // Registra evento de segurança
            this.securityMonitor.logSecurityEvent('security.malicious_response', 'critical', { url: request.url });
          }
        }

        return throwError(() => error);
      }),
    );
  }

  /**
   * Lida com erros 401, tentando refresh de token
   * @private
   */
  private _handleUnauthorizedError(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    if (!this.isRefreshing && this.refreshAttempts < this.MAX_REFRESH_ATTEMPTS) {
      this.isRefreshing = true;
      this.refreshAttempts++;
      this.loggingService.debug('AuthInterceptor: Attempting token refresh.', { attempt: this.refreshAttempts });

      return this.authService.refreshToken().pipe(
        switchMap(() => {
          this.loggingService.debug('AuthInterceptor: Token refreshed, retrying original request.');

          // Adiciona headers de segurança atualizados
          const updatedRequest = this._addSecurityHeaders(request);

          return next.handle(updatedRequest);
        }),
        catchError((refreshError) => {
          this.loggingService.error('AuthInterceptor: Token refresh failed. Performing full logout.', { refreshError });

          // Registra evento de segurança
          this.securityMonitor.logSecurityEvent('auth.refresh_failed', 'warning', {
            error: refreshError instanceof Error ? refreshError.message : String(refreshError),
          });

          // O logout do AuthService já faz o clearAuthState e redireciona.
          // Retornamos o observable do logout para encadear, e depois o erro original.
          return this.authService.logout().pipe(
            switchMap(() => throwError(() => refreshError)), // Propaga o erro do refresh
          );
        }),
        finalize(() => {
          this.isRefreshing = false;
        }),
      );
    }

    if (this.refreshAttempts >= this.MAX_REFRESH_ATTEMPTS && !this.isRefreshing) {
      this.loggingService.warn('AuthInterceptor: Max refresh attempts reached. Performing full logout.');

      // Registra evento de segurança
      this.securityMonitor.logSecurityEvent('auth.max_refresh_attempts', 'warning', { attempts: this.refreshAttempts });

      this.refreshAttempts = 0; // Reset para futuras sequências

      // O logout do AuthService já faz o clearAuthState e redireciona.
      return this.authService.logout().pipe(
        // Após o logout, ainda queremos que a cadeia de erro original continue,
        // mas indicando que a sessão expirou.
        switchMap(() =>
          throwError(
            () =>
              new HttpErrorResponse({
                error: 'Max refresh attempts reached, session terminated.',
                status: 401,
                url: request.url,
              }),
          ),
        ),
      );
    }

    // Se já estiver atualizando, apenas propaga um erro indicando para esperar ou que a sessão expirou.
    return throwError(
      () =>
        new HttpErrorResponse({
          error: 'Refresh in progress or session definitively expired.',
          status: 401,
          url: request.url,
        }),
    );
  }

  /**
   * Verifica se URL é relacionada à autenticação
   * @private
   */
  private _isAuthRelatedEndpoint(urlToCompare: string): boolean {
    // Verificar cache primeiro
    if (this.authRelatedUrlsCache.has(urlToCompare)) {
      return this.authRelatedUrlsCache.get(urlToCompare)!;
    }

    const authUrls = [
      this.authConfigService.loginUrl(),
      this.authConfigService.refreshTokenUrl(),
      this.authConfigService.authCallbackUrl(),
      this.authConfigService.csrfUrl(),
      this.authConfigService.authStatusUrl(),
      this.authConfigService.userEndpointUrl(), // Endpoint do usuário logado
      this.authConfigService.logoutUrl(),
    ].filter((url) => !!url) as string[];

    const isAuthEndpoint = authUrls.some((authUrl) => urlToCompare.includes(authUrl));

    // Limitar tamanho do cache
    if (this.authRelatedUrlsCache.size >= this.MAX_CACHE_SIZE) {
      const oldestKeys = Array.from(this.authRelatedUrlsCache.keys()).slice(0, 10);
      oldestKeys.forEach((key) => this.authRelatedUrlsCache.delete(key));
    }

    // Armazenar no cache
    this.authRelatedUrlsCache.set(urlToCompare, isAuthEndpoint);

    return isAuthEndpoint;
  }

  /**
   * Adiciona headers de segurança à requisição
   * @private
   */
  private _addSecurityHeaders(request: HttpRequest<any>): HttpRequest<any> {
    // Cria uma cópia da requisição com os headers adicionais
    let secureRequest = request.clone({
      withCredentials: true, // Garante envio de cookies para autenticação
      headers: request.headers.set('X-Requested-With', 'XMLHttpRequest'), // Proteção CSRF básica
    });

    // Adiciona header de prevenção de cache para requisições sensíveis
    if (this._isSensitiveRequest(request)) {
      secureRequest = secureRequest.clone({
        headers: secureRequest.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate').set('Pragma', 'no-cache'),
      });
    }

    // Adiciona fingerprint do navegador para prevenção de session hijacking
    const fingerprint = this.securityMonitor.generateBrowserFingerprint();
    if (fingerprint) {
      secureRequest = secureRequest.clone({
        headers: secureRequest.headers.set('X-Browser-Fingerprint', fingerprint),
      });
    }

    return secureRequest;
  }

  /**
   * Verifica se a requisição é para um endpoint sensível
   * Utiliza cache para melhorar performance
   * @private
   */
  private _isSensitiveRequest(request: HttpRequest<any>): boolean {
    const url = request.url;
    const method = request.method;

    // Cria uma chave de cache composta por URL + método
    // Isso é importante pois a sensibilidade pode depender do método
    const cacheKey = `${method}:${url}`;

    // Verifica primeiro no cache
    const cachedResult = this.sensitivityCache.get(cacheKey);
    if (cachedResult && cachedResult.expires > Date.now()) {
      this.cacheHits++;
      return cachedResult.result;
    }

    this.cacheMisses++;

    // Se o cache está muito grande, remove entradas antigas
    if (this.sensitivityCache.size >= this.MAX_CACHE_SIZE) {
      this._pruneCache();
    }

    // Verifica se a URL corresponde a algum padrão sensível
    // Usa cache para padrões também
    let matchesSensitivePattern = this.patternMatchCache.get(url);
    if (matchesSensitivePattern === undefined) {
      matchesSensitivePattern = this.sensitiveUrlPatterns.some((pattern) => pattern.test(url));
      this.patternMatchCache.set(url, matchesSensitivePattern);
    }

    // Métodos não-GET geralmente são sensíveis
    const isSensitiveMethod = method !== 'GET';

    // Análise do corpo só é necessária para métodos não-GET
    let hasSensitiveBody = false;
    if (isSensitiveMethod && request.body && typeof request.body === 'object') {
      hasSensitiveBody = this._containsSensitiveData(request.body);
    }

    // Resultado final
    const result = matchesSensitivePattern || (isSensitiveMethod && hasSensitiveBody);

    // Armazena no cache com timestamp de expiração
    this.sensitivityCache.set(cacheKey, {
      result,
      expires: Date.now() + this.CACHE_TTL,
    });

    return result;
  }

  /**
   * Remove entradas antigas do cache
   * @private
   */
  private _pruneCache(): void {
    const now = Date.now();
    let removedCount = 0;

    // Remover entradas expiradas
    this.sensitivityCache.forEach((value, key) => {
      if (value.expires < now) {
        this.sensitivityCache.delete(key);
        removedCount++;
      }
    });

    // Se ainda estiver muito grande, remover as entradas mais antigas
    if (this.sensitivityCache.size >= this.MAX_CACHE_SIZE) {
      const keysToDelete = Array.from(this.sensitivityCache.keys()).slice(0, Math.floor(this.MAX_CACHE_SIZE * 0.2)); // Remove 20% das entradas

      keysToDelete.forEach((key) => {
        this.sensitivityCache.delete(key);
        removedCount++;
      });
    }

    // Limitar tamanho do cache de padrões também
    let patternRemoved = 0;
    if (this.patternMatchCache.size > this.MAX_CACHE_SIZE) {
      const patternKeysToDelete = Array.from(this.patternMatchCache.keys()).slice(0, Math.floor(this.MAX_CACHE_SIZE * 0.2));

      patternKeysToDelete.forEach((key) => {
        this.patternMatchCache.delete(key);
        patternRemoved++;
      });
    }

    // Log para monitoramento
    if (removedCount > 0 || patternRemoved > 0) {
      this.loggingService.debug('AuthInterceptor: Cache cleaned', {
        removedEntries: removedCount,
        removedPatterns: patternRemoved,
        sensitivitySize: this.sensitivityCache.size,
        patternSize: this.patternMatchCache.size,
      });
    }
  }

  /**
   * Verifica se objeto contém dados sensíveis
   * @private
   */
  private _containsSensitiveData(obj: any): boolean {
    // Lista de nomes de campos sensíveis
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'credential', 'auth', 'jwt', 'api_key', 'apiKey'];

    if (!obj) return false;

    // Converte objeto em string para verificação rápida
    const objString = JSON.stringify(obj).toLowerCase();

    // Verifica se contém algum dos campos sensíveis
    return sensitiveFields.some((field) => objString.includes(`"${field}"`) || objString.includes(`"${field.toLowerCase()}"`));
  }

  /**
   * Adiciona nonce para prevenção de replay attacks
   * @private
   */
  private _addNonceHeader(request: HttpRequest<any>): HttpRequest<any> {
    // Gera nonce aleatório
    const nonce = this.cryptoService.generateSecureId(16);
    const timestamp = Date.now();

    // Combina nonce com timestamp e URL para unicidade
    const uniqueNonce = `${nonce}_${timestamp}_${request.url.split('?')[0]}`;

    // Limpa cache de nonces antigos se ficar muito grande
    if (this.processedNonces.size > this.MAX_NONCE_CACHE) {
      this.processedNonces.clear();
    }

    // Adiciona à lista de nonces processados
    this.processedNonces.add(uniqueNonce);

    // Clona a requisição com o header de nonce
    return request.clone({
      headers: request.headers.set('X-Request-Nonce', nonce).set('X-Request-Timestamp', timestamp.toString()),
    });
  }

  /**
   * Monitora respostas para detecção de anomalias
   * @private
   */
  private _monitorResponse(event: HttpResponse<any>, request: HttpRequest<any>): void {
    // Verifica respostas, procurando por anomalias

    // 1. Verifica respostas vindas de login
    if (request.url.includes('/login') || request.url.includes('/auth')) {
      // Detecta campos obrigatórios em respostas de autenticação
      if (event.body && typeof event.body === 'object') {
        const hasToken = !!event.body.accessToken || !!event.body.token;

        if (!hasToken) {
          this.loggingService.warn('AuthInterceptor: Auth response missing token', { url: request.url });

          this.securityMonitor.logSecurityEvent('auth.suspicious_response', 'warning', { url: request.url, issue: 'missing_token' });
        }
      }
    }

    // 2. Monitora tamanho anormal das respostas
    const contentLength = event.headers.get('content-length');
    if (contentLength) {
      const length = parseInt(contentLength, 10);
      // Verificação básica para respostas extremamente grandes
      if (length > 5000000) {
        // 5MB
        this.loggingService.warn('AuthInterceptor: Unusually large response detected', {
          url: request.url,
          size: length,
        });

        this.securityMonitor.logSecurityEvent('security.large_response', 'warning', { url: request.url, size: length });
      }
    }

    // 3. Verifica scripts ou conteúdo executável em respostas JSON
    if (event.body && typeof event.body === 'object') {
      if (this._detectPotentialXSS(event.body)) {
        this.loggingService.error('AuthInterceptor: Potential XSS in response', { url: request.url });

        this.securityMonitor.logSecurityEvent('security.xss_detected', 'critical', { url: request.url });
      }
    }
  }

  /**
   * Detecta potenciais ataques XSS em respostas
   * @private
   */
  private _detectPotentialXSS(body: any): boolean {
    if (!body) return false;

    // Converte para string para facilitar detecção
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);

    // Padrões suspeitos de XSS
    const suspiciousPatterns = [
      /<script\b[^>]*>(.*?)<\/script>/i,
      /javascript:/i,
      /on(load|error|click|mouse|focus)\s*=/i,
      /document\.(cookie|write|location)/i,
      /eval\s*\(/i,
      /Function\s*\(/i,
    ];

    return suspiciousPatterns.some((pattern) => pattern.test(bodyStr));
  }

  /**
   * Detecta respostas maliciosas em erros HTTP
   * @private
   */
  private _detectMaliciousResponse(error: HttpErrorResponse): boolean {
    if (!error.error) return false;

    let errorContent = '';

    // Extrai conteúdo do erro
    if (typeof error.error === 'string') {
      errorContent = error.error;
    } else if (typeof error.error === 'object') {
      errorContent = JSON.stringify(error.error);
    }

    if (!errorContent) return false;

    // Padrões de detecção avançados
    const suspiciousPatterns = [
      /<script\b[^>]*>/i,
      /javascript:/i,
      /onerror=/i,
      /onload=/i,
      /eval\(/i,
      /document\.cookie/i,
      /iframe src=/i,
      /base64/i,
      /String\.fromCharCode/i,
    ];

    return suspiciousPatterns.some((pattern) => pattern.test(errorContent));
  }

  /**
   * Logs estatísticas de cache periodicamente
   */
  logCacheStats(): void {
    this.loggingService.debug('AuthInterceptor: Cache stats', {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRatio: this.cacheHits / (this.cacheHits + this.cacheMisses || 1),
      sensitivityCacheSize: this.sensitivityCache.size,
      patternCacheSize: this.patternMatchCache.size,
      authRelatedUrlsCacheSize: this.authRelatedUrlsCache.size,
    });

    // Reset contadores após log
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Limpa todos os caches do interceptor
   * Útil para testes ou em grandes mudanças de contexto
   */
  clearCaches(): void {
    this.sensitivityCache.clear();
    this.patternMatchCache.clear();
    this.authRelatedUrlsCache.clear();
    this.processedNonces.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;

    this.loggingService.debug('AuthInterceptor: All caches cleared');
  }
}
