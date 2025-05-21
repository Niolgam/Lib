import { Injectable, inject, signal, computed, WritableSignal, Signal, PLATFORM_ID } from '@angular/core';
import { AuthConfigService } from './auth-config.service';
import { CryptoService, LocalStorageService } from '@vai/services';
import { LoggingService } from '@vai/services';
import { isPlatformBrowser } from '@angular/common';
import { SecurityMonitorService } from './security-monitor.service';
import { AuthToken } from '@auth/data-access';

export interface DecodedToken {
  sub: string;
  exp: number;
  iat: number;
  roles?: string[];
  [key: string]: any;
}

/**
 * Serviço para gerenciamento de tokens JWT
 * Armazena, valida e decodifica tokens de autenticação
 */
@Injectable({
  providedIn: 'root',
})
export class TokenService {
  private localStorageService = inject(LocalStorageService);
  private loggingService = inject(LoggingService);
  private authConfigService = inject(AuthConfigService);
  private cryptoService = inject(CryptoService);
  private securityMonitor = inject(SecurityMonitorService);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly defaultTokenKey = 'auth_token';
  private readonly tokenVersion = '1'; // Para invalidação forçada de tokens

  // Contador de tokens inválidos em tentativas seguidas - para detecção de potenciais ataques
  private invalidTokenAttempts = 0;
  private lastInvalidAttemptTime = 0;
  private readonly MAX_INVALID_ATTEMPTS = 5;
  private readonly INVALID_ATTEMPT_RESET_MS = 60000; // 1 minuto

  private _loadInitialTokenFromStorage(): AuthToken | null {
    if (!this.isBrowser) return null;

    const tokenKey = this.authConfigService.tokenStorageKey() || this.defaultTokenKey;
    const token = this.localStorageService.getItem<AuthToken>(tokenKey, { encrypt: true });

    // Verifica integridade do token inicial
    if (token && !this._validateTokenIntegrity(token)) {
      this.loggingService.warn('TokenService: Token inválido encontrado no armazenamento inicial');
      this.securityMonitor.logSecurityEvent('token.invalid_storage', 'critical', { source: 'initial_load' });
      return null;
    }

    return token;
  }

  private readonly currentTokenState = signal(this._loadInitialTokenFromStorage());
  public readonly token = this.currentTokenState.asReadonly();

  public readonly decodedToken = computed<DecodedToken | null>(() => {
    const currentToken = this.currentTokenState();
    return currentToken ? this._decodeTokenInternal(currentToken.accessToken) : null;
  });

  public readonly isTokenEffectivelyExpired = computed(() => {
    const decoded = this.decodedToken();
    if (!decoded) return true;

    // Adiciona um buffer de segurança de 30 segundos para evitar problemas de relógio dessincronizado
    const safetyBuffer = 30;
    return decoded.exp - safetyBuffer <= Math.floor(Date.now() / 1000);
  });

  public readonly isAuthenticated = computed(() => {
    const currentToken = this.currentTokenState();
    return !!currentToken && !this.isTokenEffectivelyExpired() && this._validateTokenIntegrity(currentToken);
  });

  public readonly userId = computed(() => this.decodedToken()?.sub ?? null);
  public readonly userRoles = computed(() => this.decodedToken()?.roles ?? []);

  constructor() {
    // Verifica validade do token inicial para evitar ataques de token injetado
    const initialToken = this.currentTokenState();
    if (initialToken && !this._validateTokenIntegrity(initialToken)) {
      this.clearToken();
      this.loggingService.warn('Token inválido encontrado no armazenamento e removido');
      this.securityMonitor.logSecurityEvent('token.tampered', 'critical', { action: 'removed_on_init' });
    }
  }

  /**
   * Armazena token no localStorage/sessionStorage e no state
   */
  storeToken(token: AuthToken, remember = false) {
    if (!token.issuedAt) token.issuedAt = new Date().toISOString();

    // Adiciona hash de integridade
    token = this._addTokenIntegrityHash(token);

    const authConfig = this.authConfigService.config();
    const sessionDuration = authConfig?.sessionDuration;
    const tokenStorageKey = this.authConfigService.tokenStorageKey();

    // Aumenta segurança com encrypt: true sempre
    const storageOptions = {
      expiresIn: remember ? sessionDuration || 2592000 : undefined,
      encrypt: true,
    }; // 2592000s = 30 dias

    if (this.isBrowser) {
      this.localStorageService.setItem(tokenStorageKey, token, storageOptions);
    }

    this.currentTokenState.set(token);
    this.loggingService.debug('Token stored and signal updated', { remember });

    // Reset contador de tentativas inválidas após sucesso
    this.invalidTokenAttempts = 0;

    // Registra evento de login bem-sucedido (token armazenado)
    this.securityMonitor.logSecurityEvent('token.stored', 'info', {
      userId: this._extractUserId(token),
      remember,
    });
  }

  /**
   * Extrai ID do usuário do token para logging
   * @private
   */
  private _extractUserId(token: AuthToken): string | null {
    try {
      const decoded = this._decodeTokenInternal(token.accessToken);
      return decoded?.sub || null;
    } catch {
      return null;
    }
  }

  /**
   * Retorna snapshot do token atual
   */
  getTokenSnapshot() {
    return this.currentTokenState();
  }

  /**
   * Limpa token de todos os storages
   */
  clearToken() {
    const tokenStorageKey = this.authConfigService.tokenStorageKey() || this.defaultTokenKey;

    if (this.isBrowser) {
      this.localStorageService.removeItem(tokenStorageKey, { encrypt: true });
    }

    this.currentTokenState.set(null);
    this.loggingService.debug('Token cleared and signal updated');
  }

  /**
   * Verifica se token expira em breve
   */
  isTokenExpiringSoon(minutesThreshold = 5) {
    const decoded = this.decodedToken();
    if (!decoded) return false;
    const now = Math.floor(Date.now() / 1000);
    const thresholdInSeconds = minutesThreshold * 60;
    return decoded.exp - now < thresholdInSeconds && decoded.exp - now > 0;
  }

  /**
   * Decodifica payload do JWT
   * @private
   */
  private _decodeTokenInternal(accessTokenValue?: string): DecodedToken | null {
    if (!accessTokenValue) return null;

    try {
      const parts = accessTokenValue.split('.');
      if (parts.length !== 3) {
        this._registerInvalidTokenAttempt();
        return null; // JWT deve ter 3 partes
      }

      const base64Url = parts[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join(''),
      );

      const decoded = JSON.parse(jsonPayload) as DecodedToken;

      // Verificações básicas de segurança do JWT
      const now = Math.floor(Date.now() / 1000);
      if (!decoded.exp || !decoded.iat || decoded.exp < now || decoded.iat > now) {
        this._registerInvalidTokenAttempt();
        return null;
      }

      return decoded;
    } catch (error) {
      this._registerInvalidTokenAttempt();
      this.loggingService.error('Failed to decode token', { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  /**
   * Obtém claim específica do token
   */
  getClaimFromToken(claim: string) {
    const decoded = this.decodedToken();
    return decoded ? decoded[claim] : null;
  }

  /**
   * Adiciona hash de integridade ao token para prevenir manipulação
   * @private
   */
  private _addTokenIntegrityHash(token: AuthToken): AuthToken {
    const newToken = { ...token };
    // Criamos um fingerprint único para o token atual
    const tokenFingerprint = `${token.accessToken}|${token.issuedAt}|${this.tokenVersion}`;

    // Gera uma assinatura usando o serviço de crypto
    const integrity = this.cryptoService.hashString(tokenFingerprint);

    // Armazena o valor de integridade em uma propriedade "escondida"
    (newToken as any)._integrity = integrity;

    return newToken;
  }

  /**
   * Valida integridade do token usando comparação de tempo constante
   * CORRIGIDO: Agora trabalha com o token passado como parâmetro
   * @private
   */
  private _validateTokenIntegrity(token: AuthToken): boolean {
    try {
      if (!token) return false;
      if (!token.accessToken || !token.issuedAt) return false;

      // Recalcula o fingerprint do token
      const tokenFingerprint = `${token.accessToken}|${token.issuedAt}|${this.tokenVersion}`;

      // Gera hash novamente
      const calculatedIntegrity = this.cryptoService.hashString(tokenFingerprint);

      // Obtém o hash armazenado
      const storedIntegrity = (token as any)._integrity;

      if (!storedIntegrity) {
        this._registerInvalidTokenAttempt();
        return false;
      }

      // Usa comparação de tempo constante para evitar timing attacks
      const isValid = this.cryptoService.compareStringsSecurely(calculatedIntegrity, storedIntegrity);

      if (!isValid) {
        this._registerInvalidTokenAttempt();
      }

      return isValid;
    } catch (error) {
      this._registerInvalidTokenAttempt();
      this.loggingService.error('Error validating token integrity', { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  /**
   * Registra tentativa de token inválido e detecta possíveis ataques
   * @private
   */
  private _registerInvalidTokenAttempt() {
    const now = Date.now();

    // Reseta contador se passou tempo suficiente desde a última tentativa
    if (now - this.lastInvalidAttemptTime > this.INVALID_ATTEMPT_RESET_MS) {
      this.invalidTokenAttempts = 0;
    }

    this.invalidTokenAttempts++;
    this.lastInvalidAttemptTime = now;

    // Loga possível ataque se muitas tentativas
    if (this.invalidTokenAttempts >= this.MAX_INVALID_ATTEMPTS) {
      this.loggingService.warn('Possível ataque detectado: múltiplas tentativas de token inválido', { attempts: this.invalidTokenAttempts });

      // Registra evento de segurança
      this.securityMonitor.logSecurityEvent('token.multiple_invalid_attempts', 'critical', {
        attempts: this.invalidTokenAttempts,
        timeWindow: this.INVALID_ATTEMPT_RESET_MS,
      });

      // Reset para não ficar logando infinitamente
      this.invalidTokenAttempts = 0;
    }
  }
}
