import { Injectable, inject } from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpInterceptor, HttpErrorResponse, HttpResponse, HttpHeaders } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, switchMap, finalize, tap } from 'rxjs/operators';
import { Router } from '@angular/router';

import { AuthStore } from '@auth/data-access';
import { CryptoService, LoggingService } from '@vai/services';
import { AuthConfigService, HttpCacheService } from '../services';
import { SecurityMonitorService } from '../services/security-monitor.service';
import { toObservable } from '@angular/core/rxjs-interop';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private authStore = inject(AuthStore);
  private loggingService = inject(LoggingService);
  private router = inject(Router);
  private authConfigService = inject(AuthConfigService);
  private securityMonitor = inject(SecurityMonitorService);
  private cryptoService = inject(CryptoService);
  private httpCache = inject(HttpCacheService); // Injeção do serviço de cache

  // Controle de refresh de token
  private isRefreshing = false;
  private refreshAttempts = 0;
  private readonly MAX_REFRESH_ATTEMPTS = 1;

  intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const effectiveApiBaseForAuth = this.authConfigService.effectiveAuthApiBaseUrl();
    let clonedRequest = request;

    // Adiciona headers de segurança para endpoints de API
    if (effectiveApiBaseForAuth && request.url.startsWith(effectiveApiBaseForAuth)) {
      // Usar o cache centralizado para headers de segurança
      const cacheKey = `${request.method}:${request.url}`;
      const cachedHeaders = this.httpCache.get<HttpHeaders>('header', cacheKey);

      if (cachedHeaders) {
        clonedRequest = request.clone({ headers: cachedHeaders });
      } else {
        clonedRequest = this._addSecurityHeaders(request);

        // Armazenar no cache
        this.httpCache.set('header', cacheKey, clonedRequest.headers, {
          tags: ['auth', 'security'],
        });
      }
    }

    // Detecta requisições sensíveis para monitoramento adicional
    const isSensitiveRequest = this._isSensitiveRequest(clonedRequest);
    if (isSensitiveRequest) {
      // Adiciona nonce para prevenção de replay attacks em requisições sensíveis
      clonedRequest = this._addNonceHeader(clonedRequest);
    }

    return next.handle(clonedRequest).pipe(
      tap((event: HttpEvent<any>) => {
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
            this.securityMonitor?.logSecurityEvent('auth.unauthorized', 'warning', { url: request.url });

            // Em caso de erro 401, invalidar caches relacionados a autenticação
            this.httpCache.invalidateByTag('auth');

            if (!this._isAuthRelatedEndpoint(request.url)) {
              return this._handleUnauthorizedError(clonedRequest, next);
            }

            // Para endpoints de autenticação que retornam 401 (ex: /auth/status falhou, refresh já tentado)
            this.loggingService.info('AuthInterceptor: 401 on auth endpoint, performing full logout.', { url: request.url });

            // Registra evento de segurança
            this.securityMonitor?.logSecurityEvent('auth.unauthorized_auth_endpoint', 'warning', { url: request.url });

            // Chamada ao logout público, que cuidará de clearAuthState e redirecionamento
            return this.authStore.logout$();
          }

          // Trata erros 403 (Forbidden)
          if (error.status === 403 && !(error.error?.code === 'INVALID_CSRF_TOKEN')) {
            this.loggingService.warn('AuthInterceptor: Received 403 forbidden', { url: request.url });

            // Registra evento de segurança
            this.securityMonitor?.logSecurityEvent('auth.forbidden', 'warning', { url: request.url });

            const accessDeniedRoute = authConfigSnapshot?.accessDeniedRoute || '/access-denied';
            this.router.navigate([accessDeniedRoute]);
            // Não precisa de logout aqui, apenas redireciona
          }

          // Trata erros CSRF (código específico retornado pelo backend)
          if (error.status === 403 && error.error?.code === 'INVALID_CSRF_TOKEN') {
            this.loggingService.warn('AuthInterceptor: Invalid CSRF token', { url: request.url });

            // Registra evento de segurança
            this.securityMonitor?.logSecurityEvent('security.csrf_failure', 'warning', { url: request.url });
          }

          // Trata erros de segurança (códigos específicos)
          if (error.status === 400 && error.error?.code === 'SECURITY_VIOLATION') {
            this.loggingService.error('AuthInterceptor: Security violation detected', {
              url: request.url,
              details: error.error?.details,
            });

            // Registra evento de segurança
            this.securityMonitor?.logSecurityEvent('security.violation', 'critical', {
              url: request.url,
              details: error.error?.details,
            });

            // Caso seja crítico, pode forçar logout
            if (error.error?.action === 'LOGOUT') {
              return this.authStore.logout$();
            }
          }

          // Detecção de possíveis ataques de injeção/XSS nas respostas
          if (this._detectMaliciousResponse(error)) {
            this.loggingService.error('AuthInterceptor: Potentially malicious response detected', {
              url: request.url,
            });

            // Registra evento de segurança
            this.securityMonitor?.logSecurityEvent('security.malicious_response', 'critical', { url: request.url });
          }
        }

        return throwError(() => error);
      }),
    ) as Observable<HttpEvent<any>>;
  }

  private _handleUnauthorizedError(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    if (!this.isRefreshing && this.refreshAttempts < this.MAX_REFRESH_ATTEMPTS) {
      this.isRefreshing = true;
      this.refreshAttempts++;
      this.loggingService.debug('AuthInterceptor: Attempting token refresh.', { attempt: this.refreshAttempts });

      return this.authStore.refreshToken$().pipe(
        switchMap(() => {
          this.loggingService.debug('AuthInterceptor: Token refreshed, retrying original request.');

          // Adiciona headers de segurança atualizados
          const updatedRequest = this._addSecurityHeaders(request);

          return next.handle(updatedRequest);
        }),
        catchError((refreshError) => {
          this.loggingService.error('AuthInterceptor: Token refresh failed. Performing full logout.', { refreshError });

          // Registra evento de segurança
          this.securityMonitor?.logSecurityEvent('auth.refresh_failed', 'warning', {
            error: refreshError instanceof Error ? refreshError.message : String(refreshError),
          });

          return this.authStore.logout$() as Observable<HttpEvent<any>>;
        }),
        finalize(() => {
          this.isRefreshing = false;
        }),
      );
    }

    if (this.refreshAttempts >= this.MAX_REFRESH_ATTEMPTS && !this.isRefreshing) {
      this.loggingService.warn('AuthInterceptor: Max refresh attempts reached. Performing full logout.');

      // Registra evento de segurança
      this.securityMonitor?.logSecurityEvent('auth.max_refresh_attempts', 'warning', { attempts: this.refreshAttempts });

      this.refreshAttempts = 0; // Reset para futuras sequências

      // O logout do AuthService já faz o clearAuthState e redireciona.
      return this.authStore.logout$();
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
    const cacheKey = `auth_related:${urlToCompare}`;
    const cachedResult = this.httpCache.get<boolean>('header', cacheKey);

    if (cachedResult !== null) {
      return cachedResult;
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

    const isAuthEndpoint = authUrls.some((authUrl) => authUrl && urlToCompare.includes(authUrl));

    // Armazenar no cache
    this.httpCache.set('header', cacheKey, isAuthEndpoint, {
      tags: ['auth', 'endpoint'],
    });

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
    const fingerprint = this.securityMonitor?.generateBrowserFingerprint();
    if (fingerprint) {
      secureRequest = secureRequest.clone({
        headers: secureRequest.headers.set('X-Browser-Fingerprint', fingerprint),
      });
    }

    return secureRequest;
  }

  /**
   * Verifica se a requisição é para um endpoint sensível
   * Utiliza cache centralizado para melhorar performance
   * @private
   */
  private _isSensitiveRequest(request: HttpRequest<any>): boolean {
    const url = request.url;
    const method = request.method;

    // Cria uma chave de cache composta por URL + método
    const cacheKey = `sensitive:${method}:${url}`;

    // Verificar cache primeiro
    const cachedResult = this.httpCache.get<boolean>('header', cacheKey);
    if (cachedResult !== null) {
      return cachedResult;
    }

    // Lista de padrões sensíveis para detecção
    const sensitiveUrlPatterns = [/\/login$/i, /\/auth\//i, /\/user/i, /\/profile/i, /\/password/i];

    // Verifica se a URL corresponde a algum padrão sensível
    const matchesSensitivePattern = sensitiveUrlPatterns.some((pattern) => pattern.test(url));

    // Métodos não-GET geralmente são sensíveis
    const isSensitiveMethod = method !== 'GET';

    // Análise do corpo só é necessária para métodos não-GET
    let hasSensitiveBody = false;
    if (isSensitiveMethod && request.body && typeof request.body === 'object') {
      hasSensitiveBody = this._containsSensitiveData(request.body);
    }

    // Resultado final
    const result = matchesSensitivePattern || (isSensitiveMethod && hasSensitiveBody);

    // Armazenar no cache
    this.httpCache.set('header', cacheKey, result, {
      tags: ['sensitive', isSensitiveMethod ? 'mutation' : 'query'],
    });

    return result;
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

          this.securityMonitor?.logSecurityEvent('auth.suspicious_response', 'warning', { url: request.url, issue: 'missing_token' });
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

        this.securityMonitor?.logSecurityEvent('security.large_response', 'warning', { url: request.url, size: length });
      }
    }

    // 3. Verifica scripts ou conteúdo executável em respostas JSON
    if (event.body && typeof event.body === 'object') {
      if (this._detectPotentialXSS(event.body)) {
        this.loggingService.error('AuthInterceptor: Potential XSS in response', { url: request.url });

        this.securityMonitor?.logSecurityEvent('security.xss_detected', 'critical', { url: request.url });
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

    // Implementação mais robusta de detecção de XSS usando padrões mais abrangentes
    const suspiciousPatterns = [
      // Scripts e eventos
      /<script[^>]*>[\s\S]*?<\/script>/i, // Scripts HTML
      /<\s*script\b/i, // Início de tags script com espaços
      /<\s*\/\s*script\s*>/i, // Final de tags script com espaços
      /<\s*iframe/i, // IFrames
      /<\s*object/i, // Objetos
      /<\s*embed/i, // Embed
      /javascript\s*:/i, // Protocolo javascript:
      /data\s*:/i, // Protocolo data: (pode conter código JS)
      /vbscript\s*:/i, // Protocolo vbscript:

      // Eventos comuns de execução de código
      /\bon\w+\s*=\s*['"]/i, // Todos os eventos on* como onclick, onload, etc.

      // Funções perigosas de JS
      /\beval\s*\(/i, // eval()
      /\bfunction\s*\(/i, // Construtor Function
      /\bsetTimeout\s*\(/i, // setTimeout
      /\bsetInterval\s*\(/i, // setInterval
      /document\s*\.\s*cookie/i, // Acesso a cookies
      /document\s*\.\s*write/i, // document.write
      /document\s*\.\s*location/i, // manipulação de location
      /document\s*\.\s*domain/i, // manipulação de domain
      /document\s*\.\s*createElement\s*\(\s*('|")script\1\s*\)/i, // criação dinâmica de scripts

      // Expressões regulares para sanitização de HTML
      /<\s*\/?\s*[a-z]\s*[^>]*\s*style\s*=\s*['"]\s*[^'">]*\bexpression\s*\(/i, // CSS expressions
      /<\s*\/?\s*[a-z][^>]*\s*style\s*=\s*['"]\s*[^'">]*\burl\s*\(/i, // CSS url()

      // Caracteres suspeitos de obfuscação
      /&#x[0-9a-f]{2,};/i, // Entidades hexadecimais
      /&#[0-9]{2,};/i, // Entidades decimais
      /\\u[0-9a-f]{4}/i, // Unicode escapes
      /\\x[0-9a-f]{2}/i, // Hex escapes

      // Base64 (se parecer com código executável)
      /data:.*?;base64,[a-zA-Z0-9+/]+=*/i, // Data URIs com base64

      // Exfiltração de dados
      /new\s+XMLHttpRequest\s*\(\s*\)/i, // XHR
      /fetch\s*\(/i, // Fetch API
    ];

    // Verifica cada padrão, mas limita o tempo de execução
    const startTime = Date.now();
    const EXECUTION_TIMEOUT = 100; // Limitar a 100ms para não impactar performance

    for (const pattern of suspiciousPatterns) {
      if (Date.now() - startTime > EXECUTION_TIMEOUT) {
        this.loggingService.warn('AuthInterceptor: XSS pattern matching timed out');
        break;
      }

      if (pattern.test(bodyStr)) {
        // Log detalhado do padrão encontrado (sem expor o conteúdo completo)
        this.loggingService.warn('AuthInterceptor: Potential XSS pattern detected', {
          pattern: pattern.toString(),
          match: true,
        });
        return true;
      }
    }

    return false;
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

    // Reutiliza o código de detecção de XSS aprimorado
    return this._detectPotentialXSS(errorContent);
  }

  /**
   * Logs estatísticas de cache
   */
  logCacheStats(): void {
    const stats = this.httpCache.getAndResetStats('header');
    this.loggingService.debug('AuthInterceptor: Cache stats', stats);
  }

  /**
   * Limpa todos os caches do interceptor
   */
  clearCache(): void {
    this.httpCache.clear('header');
    this.loggingService.debug('AuthInterceptor: Cache cleared');
  }
}
