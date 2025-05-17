import { Injectable, inject, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { CryptoService, LoggingService } from '@vai/services';
import { AuthConfigService } from './auth-config.service';

export interface SecurityEvent {
  type: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: number;
  details?: any;
}

export interface SecurityStats {
  lastEvents: SecurityEvent[];
  suspiciousIpDetected: boolean;
  bruteForceAttempts: number;
  csrfFailures: number;
  lastUpdated: number;
}

/**
 * Serviço para monitoramento de segurança e detecção de ataques
 * Centraliza alertas e detecção de comportamentos suspeitos
 */
@Injectable({
  providedIn: 'root',
})
export class SecurityMonitorService {
  private http = inject(HttpClient);
  private loggingService = inject(LoggingService);
  private authConfigService = inject(AuthConfigService);
  private cryptoService = inject(CryptoService);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  // Buffer de eventos recentes
  private readonly eventsState = signal<SecurityEvent[]>([]);

  // Contadores de eventos suspeitos
  private readonly statsState = signal<SecurityStats>({
    lastEvents: [],
    suspiciousIpDetected: false,
    bruteForceAttempts: 0,
    csrfFailures: 0,
    lastUpdated: Date.now(),
  });

  // Flag de modo de segurança elevada
  private readonly enhancedSecurityState = signal<boolean>(false);

  // Limites de eventos (thresholds)
  private readonly MAX_EVENTS_BUFFER = 50;
  private readonly BRUTE_FORCE_THRESHOLD = 5;
  private readonly CSRF_FAILURES_THRESHOLD = 3;

  // Lista de fingerprints suspeitos ou bloqueados
  private readonly bannedFingerprintsState = signal<string[]>([]);

  constructor() {
    // Auto-limpeza do buffer de eventos (a cada 24h)
    if (this.isBrowser) {
      setInterval(() => this._pruneOldEvents(), 86400000);
    }
  }

  /**
   * Registra evento de segurança
   */
  logSecurityEvent(type: string, severity: 'info' | 'warning' | 'critical' = 'info', details?: any): void {
    const event: SecurityEvent = {
      type,
      severity,
      timestamp: Date.now(),
      details,
    };

    // Adiciona evento ao buffer
    this.eventsState.update((events) => {
      const updatedEvents = [event, ...events];
      // Limita tamanho do buffer
      return updatedEvents.slice(0, this.MAX_EVENTS_BUFFER);
    });

    // Atualiza estatísticas
    this._updateStats(event);

    // Loga o evento
    const logFn =
      severity === 'critical'
        ? this.loggingService.error.bind(this.loggingService)
        : severity === 'warning'
          ? this.loggingService.warn.bind(this.loggingService)
          : this.loggingService.info.bind(this.loggingService);

    logFn(`[Security] ${type}`, details);

    // Envia eventos críticos para o servidor imediatamente
    if (severity === 'critical') {
      this._reportToServer(event);
      this._checkEnhancedSecurityMode();
    }
  }

  /**
   * Registra tentativa de login suspeita
   */
  logLoginAttempt(username: string, success: boolean, ip?: string): void {
    this.logSecurityEvent(success ? 'login.success' : 'login.failure', success ? 'info' : 'warning', { username, ip });
  }

  /**
   * Registra falha de CSRF
   */
  logCsrfFailure(url: string, details?: any): void {
    this.logSecurityEvent('csrf.failure', 'warning', { url, ...details });

    // Atualiza contador de falhas CSRF
    this.statsState.update((stats) => ({
      ...stats,
      csrfFailures: stats.csrfFailures + 1,
      lastUpdated: Date.now(),
    }));

    // Verifica necessidade de elevar segurança
    this._checkEnhancedSecurityMode();
  }

  /**
   * Registra potencial ataque de força bruta
   */
  logBruteForceAttempt(username: string, attemptCount: number): void {
    const severity = attemptCount >= this.BRUTE_FORCE_THRESHOLD ? 'critical' : 'warning';

    this.logSecurityEvent('brute_force.attempt', severity, {
      username,
      attemptCount,
      threshold: this.BRUTE_FORCE_THRESHOLD,
    });

    // Atualiza contador de tentativas de força bruta
    this.statsState.update((stats) => ({
      ...stats,
      bruteForceAttempts: stats.bruteForceAttempts + 1,
      lastUpdated: Date.now(),
    }));

    // Verifica necessidade de elevar segurança
    this._checkEnhancedSecurityMode();
  }

  /**
   * Verifica se fingerprint está banido
   */
  isFingerPrintBanned(fingerprint: string): boolean {
    return this.bannedFingerprintsState().includes(fingerprint);
  }

  /**
   * Adiciona fingerprint à lista de banidos
   */
  banFingerprint(fingerprint: string): void {
    this.bannedFingerprintsState.update((fps) => {
      if (!fps.includes(fingerprint)) {
        return [...fps, fingerprint];
      }
      return fps;
    });

    this.logSecurityEvent('fingerprint.banned', 'warning', { fingerprint });
  }

  /**
   * Gera fingerprint do ambiente atual
   */
  generateBrowserFingerprint(): string {
    if (!this.isBrowser) return '';

    try {
      // Coleta dados para fingerprint
      const screenData = `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`;
      const timezoneOffset = new Date().getTimezoneOffset();
      const language = navigator.language;
      const platform = navigator.platform;
      const userAgent = navigator.userAgent;

      // Combina dados
      const fingerprintData = `${screenData}|${timezoneOffset}|${language}|${platform}|${userAgent}`;

      // Gera hash do fingerprint
      return this.cryptoService.hashString(fingerprintData);
    } catch (error) {
      this.loggingService.error('Error generating browser fingerprint', { error });
      return '';
    }
  }

  /**
   * Retorna se está em modo de segurança elevada
   */
  isEnhancedSecurityMode(): boolean {
    return this.enhancedSecurityState();
  }

  /**
   * Obtém estatísticas de segurança
   */
  getSecurityStats(): SecurityStats {
    return this.statsState();
  }

  /**
   * Obtém eventos recentes
   */
  getRecentEvents(): SecurityEvent[] {
    return this.eventsState();
  }

  /**
   * Reporta evento de segurança para o servidor
   * @private
   */
  private _reportToServer(event: SecurityEvent): void {
    if (!this.isBrowser) return;

    const config = this.authConfigService.config();

    // Verifica se tem endpoint configurado
    if (!config.securityReportEndpoint) {
      return;
    }

    const url = `${config.authApiBaseUrl || ''}${config.securityReportEndpoint}`;

    // Headers de segurança
    const headers = new HttpHeaders({
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/json',
    });

    // Adiciona fingerprint e metadados
    const reportData = {
      ...event,
      fingerprint: this.generateBrowserFingerprint(),
      userAgent: navigator.userAgent,
      url: window.location.href,
    };

    this.http
      .post(url, reportData, { headers })
      .pipe(
        catchError((error) => {
          this.loggingService.error('Failed to report security event to server', { error });
          return of(null);
        }),
      )
      .subscribe();
  }

  /**
   * Remove eventos antigos do buffer
   * @private
   */
  private _pruneOldEvents(): void {
    const now = Date.now();
    const ONE_DAY_MS = 86400000;

    // Remove eventos com mais de 24h
    this.eventsState.update((events) => events.filter((event) => now - event.timestamp < ONE_DAY_MS));

    // Reset estatísticas diárias
    this.statsState.update((stats) => ({
      ...stats,
      lastEvents: this.eventsState().slice(0, 5),
      bruteForceAttempts: 0,
      csrfFailures: 0,
      lastUpdated: now,
    }));
  }

  /**
   * Atualiza estatísticas com base em novo evento
   * @private
   */
  private _updateStats(event: SecurityEvent): void {
    this.statsState.update((stats) => ({
      ...stats,
      lastEvents: [event, ...stats.lastEvents].slice(0, 5),
      lastUpdated: Date.now(),
    }));
  }

  /**
   * Verifica se deve elevar segurança
   * @private
   */
  private _checkEnhancedSecurityMode(): void {
    const stats = this.statsState();

    // Ativa modo de segurança elevada se passar dos limites
    const shouldElevate =
      stats.bruteForceAttempts >= this.BRUTE_FORCE_THRESHOLD || stats.csrfFailures >= this.CSRF_FAILURES_THRESHOLD || stats.suspiciousIpDetected;

    if (shouldElevate && !this.enhancedSecurityState()) {
      this.enhancedSecurityState.set(true);
      this.logSecurityEvent('security.enhanced_mode_activated', 'warning', {
        reason: {
          bruteForce: stats.bruteForceAttempts >= this.BRUTE_FORCE_THRESHOLD,
          csrf: stats.csrfFailures >= this.CSRF_FAILURES_THRESHOLD,
          suspiciousIp: stats.suspiciousIpDetected,
        },
      });
    }
  }

  /**
   * Configura monitoramento de segurança em tempo real
   * Pode ser chamado durante a inicialização da aplicação
   * @returns Uma Promise que resolve quando o monitoramento está configurado
   */
  setupRealtimeMonitoring(): Promise<void> {
    if (!this.isBrowser) return Promise.resolve();

    try {
      this.loggingService.debug('Iniciando monitoramento de segurança em tempo real');

      // Configuração de monitoramento de localStorage e sessionStorage
      window.addEventListener('storage', (event) => {
        if (!event.key) return;

        const isSensitiveKey = /token|auth|user|login|password|credential/i.test(event.key);

        if (isSensitiveKey) {
          this.logSecurityEvent('security.sensitive_storage_change', 'warning', {
            key: event.key,
            storageArea: event.storageArea === localStorage ? 'localStorage' : 'sessionStorage',
            newValue: event.newValue ? 'present' : 'null',
            oldValue: event.oldValue ? 'present' : 'null',
          });
        }
      });

      // Monitoramento de cookies
      let lastCookieValue = document.cookie;

      setInterval(() => {
        const currentCookie = document.cookie;
        if (currentCookie !== lastCookieValue) {
          // Verificação básica de alterações de cookies
          if (lastCookieValue.length < currentCookie.length) {
            this.logSecurityEvent('security.cookie_added', 'info', { before: lastCookieValue.length, after: currentCookie.length });
          } else if (lastCookieValue.length > currentCookie.length) {
            this.logSecurityEvent('security.cookie_removed', 'info', { before: lastCookieValue.length, after: currentCookie.length });
          }

          lastCookieValue = currentCookie;
        }
      }, 5000); // Verificar a cada 5 segundos

      // Verificações de segurança periódicas
      const config = this.authConfigService.config();
      const interval = config.securityCheckInterval || 300000; // 5 minutos padrão

      setInterval(() => {
        // Verificar se está em um iframe (proteção contra clickjacking)
        if (window.self !== window.top) {
          this.logSecurityEvent('security.iframe_detected', 'warning', { url: window.location.href });
        }

        // Verificar se está em HTTPS em produção
        if (window.location.hostname !== 'localhost' && !window.location.hostname.includes('127.0.0.1') && window.location.protocol !== 'https:') {
          this.logSecurityEvent('security.non_https_production', 'critical', {
            protocol: window.location.protocol,
            hostname: window.location.hostname,
          });
        }
      }, interval);

      this.loggingService.info('Monitoramento de segurança em tempo real configurado com sucesso');

      return Promise.resolve();
    } catch (error) {
      this.loggingService.error('Erro ao configurar monitoramento em tempo real', { error });
      return Promise.reject(error);
    }
  }
}
