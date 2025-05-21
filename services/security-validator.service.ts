import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { Router } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';
import { AuthConfigService } from './auth-config.service';
import { CryptoService, LoggingService } from '@vai/services'; // Ajuste
import { CoreService } from '@vai/services';
import { CoreConfig } from '@core/data-access';
import { SecurityMonitorService } from './security-monitor.service';
import { AuthConfig } from '@auth/data-access';

function isProdEnvironment(): boolean {
  const platform = inject(PLATFORM_ID);
  if (!isPlatformBrowser(platform)) return true;
  return window.location.hostname !== 'localhost' && !window.location.hostname.includes('127.0.0.1') && !window.location.hostname.includes('.local');
}

@Injectable({ providedIn: 'root' })
export class SecurityValidatorService {
  private authConfigService = inject(AuthConfigService);
  private coreService = inject(CoreService);
  private router = inject(Router);
  private loggingService = inject(LoggingService);
  private cryptoService = inject(CryptoService);
  private securityMonitor = inject(SecurityMonitorService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /**
   * Validação completa de segurança
   * Realiza verificações críticas e redireciona em caso de problemas
   */
  validateSecurityConfig(): Promise<boolean> {
    const authConfig = this.authConfigService.config();
    const coreConfig = this.coreService.config();

    try {
      // Verifica issues críticos de configuração
      const securityIssues = this._checkSecurityIssues(authConfig, coreConfig);

      // Verifica issues relacionados ao ambiente
      const environmentIssues = this._checkEnvironmentSecurity();

      // Combina todas as issues
      const allIssues = [...securityIssues, ...environmentIssues];

      if (allIssues.length > 0) {
        const errorMessage = 'Problemas críticos de segurança detectados: ' + allIssues.join(', ');
        this.loggingService.error(errorMessage);

        // Registra evento de segurança
        this.securityMonitor.logSecurityEvent('security.config_validation_failed', 'critical', { issues: allIssues });

        // Redireciona para página de erro
        const securityErrorRoute = authConfig?.securityErrorRoute || '/security-error';
        this.router.navigate([securityErrorRoute], {
          queryParams: {
            reason: 'security_config_error',
            code: this._generateErrorCode(allIssues),
          },
        });

        return Promise.reject(new Error(errorMessage));
      }

      // Log de sucesso
      this.loggingService.info('Validação de segurança concluída com sucesso');

      // Registra evento de sucesso
      this.securityMonitor.logSecurityEvent('security.validation_success', 'info');

      return Promise.resolve(true);
    } catch (error) {
      // Log de erro
      this.loggingService.error('Erro durante validação de segurança', { error });

      // Registra evento de erro
      this.securityMonitor.logSecurityEvent('security.validation_error', 'critical', {
        error: error instanceof Error ? error.message : String(error),
      });

      return Promise.reject(error);
    }
  }

  /**
   * Versão segura da validação que não quebra o app
   */
  validateSecurityConfigSafe(): Promise<boolean> {
    try {
      const authConfig = this.authConfigService.config();
      const coreConfig = this.coreService.config();

      if (!authConfig || !coreConfig) {
        this.loggingService.warn('Configurações (Auth ou Core) não disponíveis para SecurityValidatorService.');
        if (!authConfig) return Promise.resolve(true); // ou false se crítico
      }

      return this.validateSecurityConfig();
    } catch (error) {
      console.error('Erro fatal durante inicialização de segurança', error);

      // Registra evento de erro
      if (this.isBrowser) {
        this.securityMonitor.logSecurityEvent('security.fatal_init_error', 'critical', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return Promise.resolve(true); // Não bloquear app, mas logado
    }
  }

  /**
   * Verifica problemas de configuração de segurança
   * @private
   */
  private _checkSecurityIssues(authConfig: AuthConfig | null, coreConfig: CoreConfig | null): string[] {
    const issues: string[] = [];

    if (!authConfig) {
      issues.push('AuthConfig não disponível.');
      return issues;
    }

    const effectiveApiBaseUrlForAuth = authConfig.authApiBaseUrl || coreConfig?.apiBaseUrl;
    const isProd = isProdEnvironment();

    // Verificações específicas de ambiente de produção
    if (isProd) {
      if (effectiveApiBaseUrlForAuth && !effectiveApiBaseUrlForAuth.startsWith('https://')) {
        issues.push('URL API Auth não usa HTTPS em produção.');
      } else if (!effectiveApiBaseUrlForAuth) {
        issues.push('URL API Auth não configurada para produção.');
      }

      if (authConfig.cookieDomain === 'localhost') {
        issues.push('Cookie domain é localhost em produção.');
      }

      // Verifica configuração de segurança de cookies
      if (!authConfig.secureCookiesEnabled) {
        issues.push('Cookies seguros não habilitados em produção.');
      }
    }

    // Verificações gerais
    if ((authConfig.googleAuthEnabled || authConfig.govBrAuthEnabled) && !authConfig.authCallbackEndpoint) {
      issues.push('Auth externo habilitado sem callback endpoint.');
    }

    if (!authConfig.csrfEndpoint) {
      issues.push('CSRF endpoint não configurado.');
    }

    // Verifica configurações de tokens
    if (
      authConfig.tokenRefreshInterval !== undefined &&
      authConfig.sessionDuration !== undefined &&
      authConfig.tokenRefreshInterval >= authConfig.sessionDuration
    ) {
      issues.push('Intervalo de refresh de token maior que duração da sessão.');
    }

    // Verifica configurações de CORS
    if (isProd && (!authConfig.corsAllowedOrigins || authConfig.corsAllowedOrigins.includes('*'))) {
      issues.push('Configuração de CORS insegura em produção.');
    }

    return issues;
  }

  /**
   * Verifica segurança do ambiente de execução
   * @private
   */
  private _checkEnvironmentSecurity(): string[] {
    const issues: string[] = [];

    if (!this.isBrowser) {
      return issues; // Skip em SSR
    }

    // Verifica se está em um iframe (risco de clickjacking)
    if (window.self !== window.top) {
      issues.push('Aplicação carregada em um iframe (risco de clickjacking).');
    }

    // Verifica se localStorage/sessionStorage estão disponíveis
    try {
      localStorage.setItem('security_test', '1');
      localStorage.removeItem('security_test');
    } catch (e) {
      issues.push('localStorage não disponível.');
    }

    try {
      sessionStorage.setItem('security_test', '1');
      sessionStorage.removeItem('security_test');
    } catch (e) {
      issues.push('sessionStorage não disponível.');
    }

    // Verifica se está em HTTPS (em produção)
    if (isProdEnvironment() && window.location.protocol !== 'https:') {
      issues.push('Aplicação não está usando HTTPS em produção.');
    }

    // Verifica se o navegador suporta recursos críticos de segurança
    if (!window.crypto || !window.crypto.subtle) {
      issues.push('Web Crypto API não disponível.');
    }

    return issues;
  }

  /**
   * Gera código de erro para rastreabilidade de problemas
   * @private
   */
  private _generateErrorCode(issues: string[]): string {
    const timestamp = Date.now();
    const issuesHash = this.cryptoService.hashString(issues.join('|'));
    return `SE-${timestamp.toString(36)}-${issuesHash.substring(0, 8)}`;
  }

  /**
   * Verificações avançadas de segurança do ambiente
   * Pode ser executada periodicamente ou sob demanda
   */
  runAdvancedSecurityChecks(): Promise<boolean> {
    if (!this.isBrowser) {
      return Promise.resolve(true);
    }

    try {
      // Verifica modificações suspeitas no DOM
      this._checkDOMTampering();

      // Verifica debugger
      this._checkDebuggerPresence();

      // Verifica manipulação de prototypes
      this._checkPrototypeManipulation();

      // Verifica redefinição de funções nativas
      this._checkNativeFunctions();

      return Promise.resolve(true);
    } catch (error) {
      this.loggingService.error('Falha nas verificações avançadas de segurança', { error });

      // Registra evento de segurança
      this.securityMonitor.logSecurityEvent('security.advanced_checks_failed', 'critical', {
        error: error instanceof Error ? error.message : String(error),
      });

      return Promise.reject(error);
    }
  }

  /**
   * Verifica modificações suspeitas no DOM
   * @private
   */
  private _checkDOMTampering(): void {
    if (!this.isBrowser) return;

    try {
      // Verifica inserção de scripts suspeitos
      const suspiciousScripts = Array.from(document.querySelectorAll('script')).filter((script) => {
        const src = script.getAttribute('src') || '';
        const content = script.textContent || '';

        // Regras para detecção de scripts suspeitos
        const suspiciousSrcPatterns = [/hacker/i, /malware/i, /steal/i, /inject/i];

        const suspiciousContentPatterns = [/localStorage/i, /sessionStorage/i, /document\.cookie/i, /\.cookie\s*=/i, /eval\(/i, /new\s+Function\(/i];

        return suspiciousSrcPatterns.some((pattern) => pattern.test(src)) || suspiciousContentPatterns.some((pattern) => pattern.test(content));
      });

      if (suspiciousScripts.length > 0) {
        this.securityMonitor.logSecurityEvent('security.suspicious_scripts_detected', 'critical', { count: suspiciousScripts.length });
      }

      // Verifica modificações em tags META de segurança
      const cspMeta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      if (cspMeta) {
        const cspContent = cspMeta.getAttribute('content') || '';
        if (!cspContent.includes('script-src') || cspContent.includes('unsafe-inline') || cspContent.includes('unsafe-eval')) {
          this.securityMonitor.logSecurityEvent('security.weak_csp_detected', 'warning', { csp: cspContent });
        }
      }
    } catch (error) {
      this.loggingService.error('Erro ao verificar DOM', { error });
    }
  }

  /**
   * Verifica presença de debugger
   * @private
   */
  private _checkDebuggerPresence(): void {
    if (!this.isBrowser) return;

    try {
      // Detecta se devtools está aberto
      const devtoolsOpen = window.outerWidth - window.innerWidth > 160 || window.outerHeight - window.innerHeight > 160;

      if (devtoolsOpen) {
        this.securityMonitor.logSecurityEvent('security.devtools_detected', 'warning', { timestamp: Date.now() });
      }
    } catch (error) {
      this.loggingService.error('Erro ao verificar debugger', { error });
    }
  }

  /**
   * Verifica manipulação de prototypes
   * @private
   */
  private _checkPrototypeManipulation(): void {
    if (!this.isBrowser) return;

    try {
      // Lista de funções críticas para verificar
      const criticalFunctions = [
        { obj: window.localStorage, name: 'setItem', context: 'localStorage' },
        { obj: window.localStorage, name: 'getItem', context: 'localStorage' },
        { obj: window.sessionStorage, name: 'setItem', context: 'sessionStorage' },
        { obj: window.sessionStorage, name: 'getItem', context: 'sessionStorage' },
        { obj: window.XMLHttpRequest.prototype, name: 'open', context: 'XMLHttpRequest' },
        { obj: window.XMLHttpRequest.prototype, name: 'send', context: 'XMLHttpRequest' },
        { obj: window.fetch, name: '', context: 'fetch' },
      ];

      const manipulatedFunctions = criticalFunctions.filter((func) => {
        if (!func.obj) return false;

        let functionToCheck: Function | any;
        if (func.name && typeof func.obj === 'object' && func.obj !== null) {
          functionToCheck = (func.obj as Record<string, any>)[func.name];
        } else {
          functionToCheck = func.obj;
        }
        const functionString = functionToCheck.toString();

        // Verifica características suspeitas na função
        return (
          // Funções nativas geralmente são curtas em toString()
          functionString.length > 500 ||
          // Funções nativas não devem ter certos padrões
          /cookie|localStorage|sessionStorage|password|login|token|auth/i.test(functionString)
        );
      });

      if (manipulatedFunctions.length > 0) {
        this.securityMonitor.logSecurityEvent('security.prototype_manipulation_detected', 'critical', {
          functions: manipulatedFunctions.map((f) => `${f.context}${f.name ? '.' + f.name : ''}`),
        });
      }
    } catch (error) {
      this.loggingService.error('Erro ao verificar manipulação de prototypes', { error });
    }
  }

  /**
   * Verifica manipulação de funções nativas
   * @private
   */
  private _checkNativeFunctions(): void {
    if (!this.isBrowser) return;

    try {
      // Verificações de funções de rede
      const originalFetch = window.fetch;
      if (originalFetch && originalFetch.toString().indexOf('[native code]') === -1) {
        this.securityMonitor.logSecurityEvent('security.overridden_native_function', 'critical', { function: 'fetch' });
      }

      // Verificações de timers
      const originalSetTimeout = window.setTimeout;
      if (originalSetTimeout && originalSetTimeout.toString().indexOf('[native code]') === -1) {
        this.securityMonitor.logSecurityEvent('security.overridden_native_function', 'warning', { function: 'setTimeout' });
      }

      // Verificações de funções de armazenamento
      const storageProto = Object.getPrototypeOf(localStorage);
      const originalGetItem = Object.getOwnPropertyDescriptor(storageProto, 'getItem')?.value;
      if (originalGetItem && originalGetItem.toString().indexOf('[native code]') === -1) {
        this.securityMonitor.logSecurityEvent('security.overridden_native_function', 'critical', { function: 'localStorage.getItem' });
      }
    } catch (error) {
      this.loggingService.error('Erro ao verificar funções nativas', { error });
    }
  }

  /**
   * Monitora alterações suspeitas em tempo real
   * Pode ser chamado uma vez durante a inicialização
   */
  setupRealtimeMonitoring(): void {
    if (!this.isBrowser) return;

    try {
      // Monitora solicitações de rede
      this._monitorNetworkRequests();

      // Monitora alterações de cookies
      this._monitorCookieChanges();

      // Monitora alterações no Local/SessionStorage
      this._monitorStorageChanges();

      this.loggingService.debug('Monitoramento de segurança em tempo real configurado');
    } catch (error) {
      this.loggingService.error('Erro ao configurar monitoramento em tempo real', { error });
    }
  }

  /**
   * Monitora solicitações de rede
   * @private
   */
  private _monitorNetworkRequests(): void {
    if (!this.isBrowser) return;

    try {
      // Não implementamos diretamente para evitar impacto na performance
      // Em uma implementação real, seria usado para detectar requisições suspeitas
      // Exemplo: Monkey patching de XMLHttpRequest ou fetch
      // Monitoramento avançado seria implementado aqui
    } catch (error) {
      this.loggingService.error('Erro ao configurar monitoramento de rede', { error });
    }
  }

  /**
   * Monitora alterações em cookies
   * @private
   */
  private _monitorCookieChanges(): void {
    if (!this.isBrowser) return;

    try {
      // Salva o valor inicial de document.cookie
      let lastCookieValue = document.cookie;

      // Verifica periodicamente por alterações
      setInterval(() => {
        const currentCookie = document.cookie;
        if (currentCookie !== lastCookieValue) {
          // Analisa as mudanças
          const added = this._findCookieDifferences(lastCookieValue, currentCookie);
          const removed = this._findCookieDifferences(currentCookie, lastCookieValue);

          if (added.length > 0 || removed.length > 0) {
            // Registra para cookies sensíveis
            const sensitiveChanges = [...added, ...removed].filter((cookie) => /token|auth|session|csrf|xsrf/i.test(cookie.name));

            if (sensitiveChanges.length > 0) {
              this.securityMonitor.logSecurityEvent('security.sensitive_cookie_change_detected', 'warning', {
                added: added.map((c) => c.name),
                removed: removed.map((c) => c.name),
              });
            }
          }

          lastCookieValue = currentCookie;
        }
      }, 5000); // Verifica a cada 5 segundos
    } catch (error) {
      this.loggingService.error('Erro ao configurar monitoramento de cookies', { error });
    }
  }

  /**
   * Encontra diferenças entre strings de cookies
   * @private
   */
  private _findCookieDifferences(cookieStr1: string, cookieStr2: string): Array<{ name: string; value: string }> {
    const cookies1 = this._parseCookieString(cookieStr1);
    const cookies2 = this._parseCookieString(cookieStr2);

    return Object.keys(cookies2)
      .filter((name) => cookies1[name] !== cookies2[name])
      .map((name) => ({ name, value: cookies2[name] }));
  }

  /**
   * Analisa string de cookies em um objeto
   * @private
   */
  private _parseCookieString(cookieStr: string): Record<string, string> {
    const cookies: Record<string, string> = {};

    if (!cookieStr) return cookies;

    cookieStr.split(';').forEach((cookie) => {
      const parts = cookie.split('=');
      if (parts.length >= 2) {
        const name = parts[0].trim();
        // Pega apenas o valor, ignorando atributos
        const value = parts[1].trim();
        cookies[name] = value;
      }
    });

    return cookies;
  }

  /**
   * Monitora alterações no localStorage e sessionStorage
   * @private
   */
  private _monitorStorageChanges(): void {
    if (!this.isBrowser) return;

    try {
      // Monitora localStorage
      window.addEventListener('storage', (event) => {
        if (!event.key) return;

        const isSensitiveKey = /token|auth|user|login|password|credential/i.test(event.key);

        if (isSensitiveKey) {
          this.securityMonitor.logSecurityEvent('security.sensitive_storage_change', 'warning', {
            key: event.key,
            storageArea: event.storageArea === localStorage ? 'localStorage' : 'sessionStorage',
            newValue: event.newValue ? 'present' : 'null',
            oldValue: event.oldValue ? 'present' : 'null',
          });
        }
      });

      // Para sessionStorage, precisaria de monkey patching mais invasivo
    } catch (error) {
      this.loggingService.error('Erro ao configurar monitoramento de storage', { error });
    }
  }
}
