import { computed, Signal } from '@angular/core';
import { Router } from '@angular/router';
import { User } from '@auth/data-access';
import { patchState } from '@ngrx/signals';
import { AuthConfigService, TokenService } from '../services';
import { LoggingService, LocalStorageService } from '@vai/services';

// === SERVIÇO DE PROCESSAMENTO DE ERROS ===

export class AuthErrorService {
  private static readonly ERROR_MAPPING: Readonly<Record<number, { message: string; reason: string; level: 'info' | 'warn' | 'error' }>> = {
    401: {
      message: 'Invalid username or password',
      reason: 'invalid_credentials',
      level: 'warn',
    },
    403: {
      message: 'Account is locked or access denied',
      reason: 'account_locked',
      level: 'warn',
    },
    429: {
      message: 'Too many login attempts. Please try again later',
      reason: 'rate_limited',
      level: 'warn',
    },
    400: {
      message: 'Invalid request format',
      reason: 'bad_request',
      level: 'warn',
    },
    0: {
      message: 'Unable to connect to authentication service. Please check your network',
      reason: 'connection_error',
      level: 'error',
    },
    500: {
      message: 'Authentication service unavailable. Please try again later',
      reason: 'server_error',
      level: 'error',
    },
  } as const;

  static parseAuthError(error: any): {
    message: string;
    reason: string;
    level: 'info' | 'warn' | 'error';
    details: Record<string, any>;
  } {
    const errorInfo = {
      message: 'Authentication failed',
      reason: 'unknown_error',
      level: 'error' as const,
      details: { originalError: error } as Record<string, any>,
    };

    // Tratar diferentes tipos de erro
    if (error?.name === 'TimeoutError') {
      return {
        ...errorInfo,
        message: 'Authentication request timed out. Please check your connection and try again',
        reason: 'timeout',
        level: 'warn',
      };
    }

    if (error?.name === 'CancelledError') {
      return {
        ...errorInfo,
        message: 'Authentication request was cancelled',
        reason: 'cancelled',
        level: 'info',
      };
    }

    // Erro de conexão
    if (!error?.status || error.status === 0) {
      const connectionError = this.ERROR_MAPPING[0];
      return {
        ...errorInfo,
        message: connectionError.message,
        reason: connectionError.reason,
        level: connectionError.level,
        details: {
          ...errorInfo.details,
          networkError: true,
        },
      };
    }

    // Verificar mapeamento específico por status
    const statusMapping = this.ERROR_MAPPING[error.status];
    if (statusMapping) {
      return {
        ...errorInfo,
        message: statusMapping.message,
        reason: statusMapping.reason,
        level: statusMapping.level,
      };
    }

    // Enriquecer com informações do servidor
    if (error?.error && typeof error.error === 'object') {
      if (error.error.message) {
        errorInfo.message = error.error.message;
      }

      if (error.error.code) {
        errorInfo.reason = error.error.code;
      }

      errorInfo.details = {
        ...errorInfo.details,
        serverDetails: error.error,
      };
    }

    return errorInfo;
  }
}

// === HELPERS DE RATE LIMITING ===

export interface RateLimitingHelpers {
  registerLoginAttempt: (username: string, authConfigService: AuthConfigService) => void;
  incrementLoginAttempts: (username: string) => void;
  resetLoginAttempts: (username: string) => void;
  isLoginRateLimited: (username: string, authConfigService: AuthConfigService) => boolean;
  getLoginAttemptCount: (username: string) => number;
  getRemainingBlockTime: (username: string, authConfigService: AuthConfigService) => number;
}

export const createAuthRateLimitingHelpers = (store: any): RateLimitingHelpers => {
  return {
    registerLoginAttempt(username: string, authConfigService: AuthConfigService): void {
      const now = Date.now();
      const loginAttempts = store.loginAttempts();
      let userRecord = loginAttempts.get(username);
      const loginBlockDuration = authConfigService.loginBlockDuration();

      if (!userRecord) {
        userRecord = { count: 0, lastAttempt: now };
      } else if (now - userRecord.lastAttempt > loginBlockDuration) {
        // Reset contador se passou o tempo de bloqueio
        userRecord.count = 0;
      }

      userRecord.lastAttempt = now;
      loginAttempts.set(username, userRecord);

      // Atualizar estado para reatividade
      patchState(store, { loginAttempts: new Map(loginAttempts) });
    },

    incrementLoginAttempts(username: string): void {
      const loginAttempts = store.loginAttempts();
      const userRecord = loginAttempts.get(username);

      if (userRecord) {
        userRecord.count++;
        userRecord.lastAttempt = Date.now();

        // Atualizar estado para reatividade
        patchState(store, { loginAttempts: new Map(loginAttempts) });
      }
    },

    resetLoginAttempts(username: string): void {
      const loginAttempts = store.loginAttempts();

      if (username) {
        loginAttempts.delete(username);
      } else {
        // Limpar todas as tentativas
        loginAttempts.clear();
      }

      // Atualizar estado para reatividade
      patchState(store, { loginAttempts: new Map(loginAttempts) });
    },

    isLoginRateLimited(username: string, authConfigService: AuthConfigService): boolean {
      const loginAttempts = store.loginAttempts();
      const userRecord = loginAttempts.get(username);
      const loginBlockDuration = authConfigService.loginBlockDuration();
      const maxLoginAttempts = authConfigService.maxLoginAttempts();

      if (!userRecord) return false;

      const now = Date.now();

      // Se passou o período de reset, não está limitado
      if (now - userRecord.lastAttempt > loginBlockDuration) {
        return false;
      }

      // Bloqueia se excedeu tentativas máximas
      return userRecord.count >= maxLoginAttempts;
    },

    getLoginAttemptCount(username: string): number {
      const loginAttempts = store.loginAttempts();
      const userRecord = loginAttempts.get(username);
      return userRecord?.count || 0;
    },

    getRemainingBlockTime(username: string, authConfigService: AuthConfigService): number {
      const loginAttempts = store.loginAttempts();
      const userRecord = loginAttempts.get(username);
      const loginBlockDuration = authConfigService.loginBlockDuration();

      if (!userRecord) return 0;

      const now = Date.now();
      const timeSinceLastAttempt = now - userRecord.lastAttempt;
      const remainingTime = loginBlockDuration - timeSinceLastAttempt;

      return Math.max(0, remainingTime);
    },
  };
};

// === HELPERS DE TOKEN ===

export interface TokenHelpers {
  scheduleTokenRefresh: (
    tokenService: TokenService,
    authConfigService: AuthConfigService,
    loggingService: LoggingService,
    refreshCallback: () => void,
  ) => void;
  clearTokenRefreshScheduler: () => void;
  clearAuthState: (tokenService: TokenService, csrfService: any) => void;
  isTokenExpiringSoon: (tokenService: TokenService, thresholdMinutes?: number) => boolean;
}

export const createAuthTokenHelpers = (store: any): TokenHelpers => {
  return {
    scheduleTokenRefresh(
      tokenService: TokenService,
      authConfigService: AuthConfigService,
      loggingService: LoggingService,
      refreshCallback: () => void,
    ): void {
      if (!tokenService || !authConfigService || !refreshCallback) {
        return;
      }

      // Limpar qualquer timer existente
      this.clearTokenRefreshScheduler();

      // Verificar token válido
      const token = tokenService.token();
      if (!token) {
        loggingService?.debug('Token refresh not scheduled: no token available');
        return;
      }

      const decodedToken = tokenService.decodedToken();
      if (!decodedToken?.exp) {
        loggingService?.debug('Token refresh not scheduled: no expiration time');
        return;
      }

      // Calcular tempo para expiração
      const expiresAt = decodedToken.exp * 1000;
      const now = Date.now();
      const timeUntilExpiry = expiresAt - now;

      // Refresh imediato se estiver próximo de expirar
      if (timeUntilExpiry < 10000) {
        loggingService?.debug('Token expiring very soon, refreshing immediately');
        refreshCallback();
        return;
      }

      // Configurar threshold de refresh
      const config = authConfigService.config();
      const refreshThreshold = config?.tokenRefreshThreshold || 600; // 10 minutos em segundos

      // Calcular delay com segurança mínima
      const refreshDelay = timeUntilExpiry - refreshThreshold * 1000;
      const safeRefreshDelay = Math.max(refreshDelay, 10000); // Mínimo 10 segundos

      loggingService?.debug('Scheduling token refresh', {
        expiresIn: Math.floor(timeUntilExpiry / 1000),
        refreshIn: Math.floor(safeRefreshDelay / 1000),
      });

      // Agendar refresh
      const timerId = setTimeout(() => {
        loggingService?.debug('Executing scheduled token refresh');
        refreshCallback();
      }, safeRefreshDelay);

      patchState(store, { refreshTokenTimerId: timerId });
    },

    clearTokenRefreshScheduler(): void {
      const timerId = store.refreshTokenTimerId();
      if (timerId) {
        clearTimeout(timerId);
        patchState(store, { refreshTokenTimerId: null });
      }
    },

    clearAuthState(tokenService: TokenService, csrfService: any): void {
      if (!tokenService || !csrfService) {
        return;
      }

      // Limpar tokens e CSRF
      tokenService.clearToken();
      csrfService.clearToken();

      // Limpar timer de refresh
      this.clearTokenRefreshScheduler();
    },

    isTokenExpiringSoon(tokenService: TokenService, thresholdMinutes: number = 5): boolean {
      return tokenService.isTokenExpiringSoon(thresholdMinutes);
    },
  };
};

// === HELPERS DE REDIRECIONAMENTO ===

export interface RedirectHelpers {
  saveReturnUrl: (url: string | null, localStorageService: LocalStorageService) => void;
  getReturnUrl: (localStorageService: LocalStorageService, authConfigService: AuthConfigService) => string;
  clearReturnUrl: (localStorageService: LocalStorageService) => void;
  redirectAfterLogin: (router: Router, localStorageService: LocalStorageService, authConfigService: AuthConfigService) => void;
  redirectAfterLogout: (router: Router, authConfigService: AuthConfigService) => void;
  isValidReturnUrl: (url: string) => boolean;
}

export const createAuthRedirectHelpers = (store: any, isBrowser: boolean): RedirectHelpers => {
  return {
    saveReturnUrl(url: string | null, localStorageService: LocalStorageService): void {
      if (!isBrowser || !url) return;

      // Validar URL antes de salvar
      if (this.isValidReturnUrl(url)) {
        localStorageService.setItem('auth_return_url', url);
        patchState(store, { returnUrl: url });
      }
    },

    getReturnUrl(localStorageService: LocalStorageService, authConfigService: AuthConfigService): string {
      if (!isBrowser) {
        return authConfigService.config().redirectAfterLogin || '/dashboard';
      }

      // Primeiro tenta obter do state
      let returnUrl = store.returnUrl();

      // Se não existir no state, tenta do localStorage
      if (!returnUrl) {
        returnUrl = localStorageService.getItem('auth_return_url') || '';
        if (returnUrl && this.isValidReturnUrl(returnUrl)) {
          patchState(store, { returnUrl });
        } else {
          returnUrl = '';
        }
      }

      // Se ainda não existir, usa o padrão da configuração
      return returnUrl || authConfigService.config().redirectAfterLogin || '/dashboard';
    },

    clearReturnUrl(localStorageService: LocalStorageService): void {
      if (!isBrowser) return;

      localStorageService.removeItem('auth_return_url');
      patchState(store, { returnUrl: '' });
    },

    redirectAfterLogin(router: Router, localStorageService: LocalStorageService, authConfigService: AuthConfigService): void {
      const returnUrl = this.getReturnUrl(localStorageService, authConfigService);
      router.navigateByUrl(returnUrl);
      this.clearReturnUrl(localStorageService);
    },

    redirectAfterLogout(router: Router, authConfigService: AuthConfigService): void {
      const redirectPath = authConfigService.config().redirectAfterLogout || '/login';
      router.navigateByUrl(redirectPath);
    },

    isValidReturnUrl(url: string): boolean {
      if (!url) return false;

      // Verificar se é uma URL relativa válida
      if (url.startsWith('/')) {
        // Evitar URLs maliciosas
        const forbiddenPatterns = [/javascript:/i, /data:/i, /vbscript:/i, /<script/i, /on\w+=/i];

        return !forbiddenPatterns.some((pattern) => pattern.test(url));
      }

      // Para URLs absolutas, verificar domínio
      try {
        const urlObj = new URL(url);
        // Adicionar aqui verificações de domínio se necessário
        return urlObj.protocol === 'https:' || urlObj.protocol === 'http:';
      } catch {
        return false;
      }
    },
  };
};

// === HELPERS DE VERIFICAÇÃO DE PAPÉIS ===

export interface RoleCheckHelpers {
  hasRole: (moduleId: string, roleName: string, roleHierarchy: Record<string, number>) => Signal<boolean>;
  hasRoleSync: (moduleId: string, roleName: string, roleHierarchy: Record<string, number>) => boolean;
  getHighestRoleInModule: (moduleId: string, roleHierarchy: Record<string, number>) => Signal<string | null>;
  getHighestRoleInModuleSync: (moduleId: string, roleHierarchy: Record<string, number>) => string | null;
  getUserRolesInModule: (moduleId: string) => Signal<string[]>;
  getUserRolesInModuleSync: (moduleId: string) => string[];
  clearRoleCache: () => void;
  isGlobalAdmin: (roleHierarchy: Record<string, number>) => Signal<boolean>;
  isGlobalAdminSync: (roleHierarchy: Record<string, number>) => boolean;
}

export const createRoleCheckHelpers = (store: { user: () => User | null }): RoleCheckHelpers => {
  // Caches para melhorar performance
  const roleSignalsCache = new Map<string, Signal<boolean>>();
  const highestRoleCache = new Map<string, Signal<string | null>>();
  const userRolesCache = new Map<string, Signal<string[]>>();

  return {
    hasRole(moduleId: string, roleName: string, roleHierarchy: Record<string, number>): Signal<boolean> {
      const cacheKey = `role:${moduleId}:${roleName}`;

      if (!roleSignalsCache.has(cacheKey)) {
        roleSignalsCache.set(
          cacheKey,
          computed(() => {
            const userObj = store.user();
            if (!userObj?.roles) return false;

            // Verificar admin global
            const isGlobalAdmin = userObj.roles.some((r) => r.moduleId === 'core' && roleHierarchy[r.role] === roleHierarchy['admin']);

            if (isGlobalAdmin) return true;

            // Verificar papel específico no módulo
            return userObj.roles.some((r) => r.moduleId === moduleId && r.role === roleName);
          }),
        );
      }

      return roleSignalsCache.get(cacheKey)!;
    },

    hasRoleSync(moduleId: string, roleName: string, roleHierarchy: Record<string, number>): boolean {
      const signal = this.hasRole(moduleId, roleName, roleHierarchy);
      return signal();
    },

    getHighestRoleInModule(moduleId: string, roleHierarchy: Record<string, number>): Signal<string | null> {
      const cacheKey = `highest:${moduleId}`;

      if (!highestRoleCache.has(cacheKey)) {
        highestRoleCache.set(
          cacheKey,
          computed(() => {
            const userObj = store.user();
            if (!userObj?.roles) return null;

            const moduleRoles = userObj.roles.filter((r) => r.moduleId === moduleId).map((r) => r.role);

            if (moduleRoles.length === 0) return null;

            // Encontrar papel com maior hierarquia
            let highestRole = moduleRoles[0];
            let highestLevel = roleHierarchy[highestRole] || 0;

            for (const role of moduleRoles) {
              const level = roleHierarchy[role] || 0;
              if (level > highestLevel) {
                highestLevel = level;
                highestRole = role;
              }
            }

            return highestRole;
          }),
        );
      }

      return highestRoleCache.get(cacheKey)!;
    },

    getHighestRoleInModuleSync(moduleId: string, roleHierarchy: Record<string, number>): string | null {
      const signal = this.getHighestRoleInModule(moduleId, roleHierarchy);
      return signal();
    },

    getUserRolesInModule(moduleId: string): Signal<string[]> {
      const cacheKey = `userRoles:${moduleId}`;

      if (!userRolesCache.has(cacheKey)) {
        userRolesCache.set(
          cacheKey,
          computed(() => {
            const userObj = store.user();
            if (!userObj?.roles) return [];

            return userObj.roles.filter((r) => r.moduleId === moduleId).map((r) => r.role);
          }),
        );
      }

      return userRolesCache.get(cacheKey)!;
    },

    getUserRolesInModuleSync(moduleId: string): string[] {
      const signal = this.getUserRolesInModule(moduleId);
      return signal();
    },

    isGlobalAdmin(roleHierarchy: Record<string, number>): Signal<boolean> {
      return computed(() => {
        const userObj = store.user();
        if (!userObj?.roles) return false;

        return userObj.roles.some((r) => r.moduleId === 'core' && roleHierarchy[r.role] === roleHierarchy['admin']);
      });
    },

    isGlobalAdminSync(roleHierarchy: Record<string, number>): boolean {
      const signal = this.isGlobalAdmin(roleHierarchy);
      return signal();
    },

    clearRoleCache(): void {
      roleSignalsCache.clear();
      highestRoleCache.clear();
      userRolesCache.clear();
    },
  };
};

// === HELPERS DE VALIDAÇÃO DE FORMULÁRIO ===

export interface FormValidationHelpers {
  createPasswordMatchValidator: (passwordFieldName: string, confirmPasswordFieldName: string) => any;
  createAsyncEmailValidator: (checkEmailFn: (email: string) => Promise<boolean>) => any;
  createUsernameValidator: (minLength?: number, maxLength?: number) => any;
}

export const createFormValidationHelpers = (): FormValidationHelpers => {
  return {
    createPasswordMatchValidator(passwordFieldName: string, confirmPasswordFieldName: string) {
      return (formGroup: any) => {
        const password = formGroup.get(passwordFieldName);
        const confirmPassword = formGroup.get(confirmPasswordFieldName);

        if (!password || !confirmPassword) {
          return null;
        }

        if (password.value !== confirmPassword.value) {
          confirmPassword.setErrors({ passwordMismatch: true });
          return { passwordMismatch: true };
        } else {
          const errors = confirmPassword.errors;
          if (errors) {
            delete errors['passwordMismatch'];
            confirmPassword.setErrors(Object.keys(errors).length > 0 ? errors : null);
          }
          return null;
        }
      };
    },

    createAsyncEmailValidator(checkEmailFn: (email: string) => Promise<boolean>) {
      return (control: any) => {
        if (!control.value) {
          return Promise.resolve(null);
        }

        return checkEmailFn(control.value)
          .then((isAvailable) => (isAvailable ? null : { emailTaken: true }))
          .catch(() => null); // Em caso de erro, não bloquear
      };
    },

    createUsernameValidator(minLength: number = 3, maxLength: number = 50) {
      return (control: any) => {
        if (!control.value) return null;

        const value = control.value.toString();
        const errors: any = {};

        // Verificar comprimento
        if (value.length < minLength) {
          errors.minLength = { requiredLength: minLength, actualLength: value.length };
        }

        if (value.length > maxLength) {
          errors.maxLength = { requiredLength: maxLength, actualLength: value.length };
        }

        // Verificar caracteres válidos (letras, números, underscore, hífen)
        if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
          errors.invalidCharacters = true;
        }

        // Deve começar com letra
        if (!/^[a-zA-Z]/.test(value)) {
          errors.mustStartWithLetter = true;
        }

        return Object.keys(errors).length > 0 ? errors : null;
      };
    },
  };
};
