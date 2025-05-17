import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, PLATFORM_ID, Signal, WritableSignal, computed, inject, signal } from '@angular/core';
import { Observable, of, tap, map, catchError, throwError, shareReplay, finalize, switchMap, timer } from 'rxjs';
import { AuthConfigService } from './auth-config.service';
import { CryptoService, LoggingService } from '@vai/services';
import { isPlatformBrowser } from '@angular/common';
import { SecurityMonitorService } from './security-monitor.service';

/**
 * Serviço responsável por gerenciar tokens CSRF
 * Implementa cache, rotação automática e proteções contra falhas
 */
@Injectable({
  providedIn: 'root',
})
export class CsrfService {
  private http = inject(HttpClient);
  private loggingService = inject(LoggingService);
  private authConfigService = inject(AuthConfigService);
  private cryptoService = inject(CryptoService);
  private securityMonitor = inject(SecurityMonitorService);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  // Token atual armazenado em um signal
  private readonly currentCsrfTokenState = signal<string | null>(null);

  // Timestamp de obtenção do token (para rotação periódica)
  private readonly tokenObtainedAtState = signal<number>(0);

  // Token exposes como readonly signal
  public readonly csrfToken = this.currentCsrfTokenState.asReadonly();

  // Timestamp que o token expira
  private readonly tokenExpiryState = computed(() => {
    const obtainedAt = this.tokenObtainedAtState();
    // O token CSRF expira em 2 horas (ou conforme configuração)
    return obtainedAt + (this.authConfigService.config()?.csrfTokenLifetime || 7200000);
  });

  // Sinal para verificar se token está expirado
  public readonly isTokenExpired = computed(() => {
    const expiry = this.tokenExpiryState();
    return !this.currentCsrfTokenState() || (expiry > 0 && Date.now() > expiry);
  });

  // Contadores para detecção de problemas
  private requestFailures = 0;
  private readonly MAX_REQUEST_FAILURES = 5;
  private lastFailureTime = 0;
  private readonly FAILURE_RESET_TIME = 300000; // 5 minutos

  // Observable para token em andamento
  private tokenRequestObservable: Observable<string> | null = null;

  // URL calculada do endpoint CSRF
  private readonly resolvedCsrfRequestUrl = computed(() => {
    const url = this.authConfigService.csrfUrl();
    if (!url) this.loggingService.warn('CSRF URL não está disponível via AuthConfigService.');
    return url;
  });

  /**
   * Busca o token CSRF atual ou solicita um novo se necessário
   * Implementa cache, rotação automática e proteção contra falhas
   */
  getToken(): Observable<string> {
    // Se já tem token válido e não expirado, retorna ele
    const currentToken = this.currentCsrfTokenState();
    if (currentToken && !this.isTokenExpired()) {
      return of(currentToken);
    }

    // Se já tem uma requisição em andamento, retorna ela
    if (this.tokenRequestObservable) {
      return this.tokenRequestObservable;
    }

    // Verifica backoff por excesso de falhas
    if (this._shouldBackoff()) {
      return throwError(() => new Error('CSRF token service temporarily unavailable due to too many failures'));
    }

    const url = this.resolvedCsrfRequestUrl();
    if (!url) {
      const errorMsg = 'CSRF endpoint URL não está configurada ou disponível.';
      this.loggingService.error(errorMsg, { service: 'CsrfService' });
      return throwError(() => new Error(errorMsg));
    }

    // Não adiciona headers manualmente - serão adicionados pelo interceptor
    // Cria uma requisição compartilhada para evitar múltiplas chamadas
    this.tokenRequestObservable = this.http
      .get<{ token: string }>(url, {
        withCredentials: true,
      })
      .pipe(
        tap((response) => {
          if (response && response.token) {
            // Salva o token e timestamp de obtenção
            this.currentCsrfTokenState.set(response.token);
            this.tokenObtainedAtState.set(Date.now());

            // Reset contador de falhas
            this._resetFailureCount();

            this.loggingService.debug('Token CSRF obtido e armazenado no signal');
          } else {
            this._incrementFailureCount();
            this.loggingService.warn('Resposta do token CSRF inválida', response);

            // Registra evento de segurança
            this.securityMonitor.logCsrfFailure(url, {
              issue: 'invalid_response',
              response,
            });
          }
        }),
        map((response) => {
          if (!response || !response.token) {
            this._incrementFailureCount();
            this.securityMonitor.logCsrfFailure(url, { issue: 'missing_token' });
            throw new Error('Token CSRF não encontrado na resposta do servidor.');
          }

          // Verifica se o token tem formato válido (básico)
          if (!this._validateTokenFormat(response.token)) {
            this._incrementFailureCount();
            this.securityMonitor.logCsrfFailure(url, {
              issue: 'invalid_format',
              token: response.token.substring(0, 10) + '...', // Não logar token inteiro
            });
            throw new Error('Token CSRF recebido tem formato inválido');
          }

          return response.token;
        }),
        catchError((error) => {
          this._incrementFailureCount();
          this.loggingService.error('Falha ao obter token CSRF', { error });
          this.securityMonitor.logCsrfFailure(url, {
            issue: 'request_error',
            error: error.message,
          });
          this.tokenRequestObservable = null;
          return throwError(() => error);
        }),
        // Limpa referência ao observable quando concluído
        finalize(() => {
          this.tokenRequestObservable = null;
        }),
        // Share para evitar múltiplas requisições
        shareReplay(1),
      );

    return this.tokenRequestObservable;
  }

  /**
   * Limpa token CSRF atual e cache
   */
  clearToken() {
    this.currentCsrfTokenState.set(null);
    this.tokenObtainedAtState.set(0);
    this.tokenRequestObservable = null;
    this.loggingService.debug('Token CSRF e requisição em cache limpos.');
  }

  /**
   * Força renovação do token CSRF
   */
  refreshToken(): Observable<string> {
    this.clearToken();
    return this.getToken();
  }

  /**
   * Configura rotação automática do token CSRF
   * @param intervalMs Intervalo para renovação automática
   */
  setupAutoRotation(intervalMs = 3600000) {
    // Padrão: 1 hora
    if (!this.isBrowser) return;

    // Usa timer do RxJS para renovar periodicamente
    timer(intervalMs, intervalMs)
      .pipe(
        switchMap(() => {
          this.loggingService.debug('Rotação automática do token CSRF');
          return this.refreshToken();
        }),
        // Ignora erros para não quebrar o timer
        catchError((err) => {
          this.loggingService.error('Erro na rotação automática do token CSRF', { err });
          return of(null);
        }),
      )
      .subscribe();
  }

  /**
   * Verifica se o token tem formato válido
   * @private
   */
  private _validateTokenFormat(token: string): boolean {
    // Verifica se o token tem um tamanho mínimo razoável e não contém caracteres inválidos
    return token.length >= 8 && /^[a-zA-Z0-9\-_]+$/.test(token);
  }

  /**
   * Incrementa contador de falhas
   * @private
   */
  private _incrementFailureCount(): void {
    const now = Date.now();

    // Reset contador se passou tempo suficiente
    if (now - this.lastFailureTime > this.FAILURE_RESET_TIME) {
      this.requestFailures = 0;
    }

    this.requestFailures++;
    this.lastFailureTime = now;

    if (this.requestFailures >= this.MAX_REQUEST_FAILURES) {
      this.loggingService.warn('Múltiplas falhas no serviço CSRF detectadas', {
        count: this.requestFailures,
        backoffUntil: new Date(now + this.FAILURE_RESET_TIME).toISOString(),
      });
    }
  }

  /**
   * Reset contador de falhas
   * @private
   */
  private _resetFailureCount(): void {
    this.requestFailures = 0;
  }

  /**
   * Verifica se deve fazer backoff por muitas falhas
   * @private
   */
  private _shouldBackoff(): boolean {
    const now = Date.now();

    // Reset contador se passou tempo suficiente
    if (now - this.lastFailureTime > this.FAILURE_RESET_TIME) {
      this.requestFailures = 0;
      return false;
    }

    return this.requestFailures >= this.MAX_REQUEST_FAILURES;
  }
}
