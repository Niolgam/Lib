import { computed } from '@angular/core';
import { User } from '@auth/data-access';
import { patchState } from '@ngrx/signals';
import { AuthConfigService, TokenService } from '../services';
import { LoggingService } from '@vai/services';

export class AuthErrorService {
  private static ERROR_MAPPING: Record<number, { message: string; reason: string; level: 'info' | 'warn' | 'error' }> = {
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
  };

  static parseAuthError(error: any): {
    message: string;
    reason: string;
    level: 'info' | 'warn' | 'error';
    details: Record<string, any>;
  } {
    // Valores padrão
    const errorInfo = {
      message: 'Authentication failed',
      reason: 'unknown_error',
      level: 'error' as const,
      details: { originalError: error } as Record<string, any>,
    };

    // Erro de timeout
    if (error.name === 'TimeoutError') {
      return {
        ...errorInfo,
        message: 'Authentication request timed out. Please check your connection and try again',
        reason: 'timeout',
        level: 'warn' as const,
      };
    }

    // Erro de cancelamento
    if (error.name === 'CancelledError') {
      return {
        ...errorInfo,
        message: 'Authentication request was cancelled',
        reason: 'cancelled',
        level: 'info' as const,
      };
    }

    // Erro de conexão
    if (!error.status || error.status === 0) {
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

    // Verificar se existe um mapeamento específico para o status de erro
    const statusMapping = this.ERROR_MAPPING[error.status];
    if (statusMapping) {
      return {
        ...errorInfo,
        message: statusMapping.message,
        reason: statusMapping.reason,
        level: statusMapping.level,
      };
    }

    // Enriquecer com info adicional do corpo da resposta se disponível
    if (error.error && typeof error.error === 'object') {
      if (error.error.message) {
        errorInfo.message = error.error.message;
      }

      if (error.error.code) {
        errorInfo.reason = error.error.code;
      }

      // Adicionar detalhes adicionais do erro
      errorInfo.details = {
        ...errorInfo.details,
        serverDetails: error.error,
      };
    }

    return errorInfo;
  }
}

/**
 * Funções auxiliares para gerenciamento de tentativas de login
 */
export const createAuthRateLimitingHelpers = (store: any) => {
  return {
    /**
     * Registra uma tentativa de login
     */
    registerLoginAttempt: (username: string, authConfigService: any): void => {
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

      // Atualiza o estado para reatividade
      patchState(store, { loginAttempts: new Map(loginAttempts) });
    },

    /**
     * Incrementa o contador de tentativas de login falhas
     */
    incrementLoginAttempts: (username: string): void => {
      const loginAttempts = store.loginAttempts();
      const userRecord = loginAttempts.get(username);

      if (userRecord) {
        userRecord.count++;
        userRecord.lastAttempt = Date.now();

        // Atualiza o estado para reatividade
        patchState(store, { loginAttempts: new Map(loginAttempts) });
      }
    },

    /**
     * Reseta o contador de tentativas de login
     */
    resetLoginAttempts: (username: string): void => {
      const loginAttempts = store.loginAttempts();
      loginAttempts.delete(username);

      // Atualiza o estado para reatividade
      patchState(store, { loginAttempts: new Map(loginAttempts) });
    },

    /**
     * Verifica se o login está bloqueado por excesso de tentativas
     */
    isLoginRateLimited: (username: string, authConfigService: any): boolean => {
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
  };
};

/**
 * Funções auxiliares para gerenciamento de token
 */
export const createAuthTokenHelpers = (store: any) => {
  const methods = {
    /**
     * Agenda o próximo refresh de token
     */
    scheduleTokenRefresh: (
      tokenService: TokenService,
      authConfigService: AuthConfigService,
      loggingService: LoggingService,
      refreshCallback: () => void,
    ): void => {
      if (!tokenService || !authConfigService || !refreshCallback) {
        return;
      }

      // Limpar qualquer timer existente
      methods.clearTokenRefreshScheduler();

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
      store.refreshTokenTimerId = setTimeout(() => {
        loggingService?.debug('Executing scheduled token refresh');
        refreshCallback();
      }, safeRefreshDelay);
    },

    /**
     * Limpa o agendamento de refresh de token
     */
    clearTokenRefreshScheduler: (): void => {
      const timerId = store.refreshTokenTimerId();
      if (timerId) {
        clearTimeout(timerId);
        patchState(store, { refreshTokenTimerId: null });
      }
    },

    /**
     * Limpa o estado de autenticação
     */
    clearAuthState: (tokenService: any, csrfService: any): void => {
      if (!tokenService || !csrfService) {
        return;
      }

      // Limpa token e CSRF
      tokenService.clearToken();
      csrfService.clearToken();

      // Limpa timer de refresh
      methods.clearTokenRefreshScheduler();
    },
  };
  return methods;
};

/**
 * Funções auxiliares para gerenciamento de URL de redirecionamento
 */
export const createAuthRedirectHelpers = (store: any, isBrowser: boolean) => {
  const helpers = {
    /**
     * Salva a URL de retorno
     */
    saveReturnUrl: (url: string | null, localStorageService: any): void => {
      if (!isBrowser) return;

      if (url) {
        localStorageService.setItem('auth_return_url', url);
        patchState(store, { returnUrl: url });
      }
    },

    /**
     * Obtém a URL de retorno
     */
    getReturnUrl: (localStorageService: any, authConfigService: any): string => {
      if (!isBrowser) return authConfigService.config().redirectAfterLogin || '/dashboard';

      // Primeiro tenta obter do state
      let returnUrl = store.returnUrl();

      // Se não existir no state, tenta do localStorage
      if (!returnUrl) {
        returnUrl = localStorageService.getItem('auth_return_url') || '/dashboard';
        if (returnUrl) {
          patchState(store, { returnUrl });
        }
      }

      // Se ainda não existir, usa o padrão da configuração
      return returnUrl || authConfigService.config().redirectAfterLogin || '/dashboard';
    },

    /**
     * Limpa a URL de retorno
     */
    clearReturnUrl: (localStorageService: any): void => {
      if (!isBrowser) return;
      localStorageService.removeItem('auth_return_url');
      patchState(store, { returnUrl: '' });
    },

    /**
     * Redireciona após login bem-sucedido
     */
    redirectAfterLogin: (router: any, localStorageService: any, authConfigService: any): void => {
      const returnUrl = helpers.getReturnUrl(localStorageService, authConfigService);
      router.navigateByUrl(returnUrl);
      helpers.clearReturnUrl(localStorageService);
    },

    /**
     * Redireciona após logout
     */
    redirectAfterLogout: (router: any, authConfigService: any): void => {
      const redirectPath = authConfigService.config().redirectAfterLogout || '/login';
      router.navigateByUrl(redirectPath);
    },
  };
  return helpers;
};

/**
 * Cria helpers para verificação de papéis
 */
export const createRoleCheckHelpers = (store: { user: () => User | null }) => {
  // Caches para melhorar performance em consultas repetidas
  const roleSignalsCache = new Map<string, any>();
  const highestRoleCache = new Map<string, any>();

  const helpers = {
    /**
     * Verifica se o usuário tem um determinado papel
     */
    hasRole: (moduleId: string, roleName: string, roleHierarchy: any): any => {
      const cacheKey = `role:${moduleId}:${roleName}`;
      if (!roleSignalsCache.has(cacheKey)) {
        roleSignalsCache.set(
          cacheKey,
          computed(() => {
            const userObj = store.user();
            if (!userObj?.roles) return false;

            const isGlobalAdmin = userObj.roles.some(
              (r: any) => r.moduleId === 'core' && roleHierarchy[r.role as keyof typeof roleHierarchy] === roleHierarchy['admin'],
            );

            if (isGlobalAdmin) return true;

            return userObj.roles.some((r: any) => r.moduleId === moduleId && r.role === roleName);
          }),
        );
      }
      return roleSignalsCache.get(cacheKey);
    },

    /**
     * Versão síncrona do hasRole
     */
    hasRoleSync: (moduleId: string, roleName: string, roleHierarchy: any): boolean => {
      const signal = helpers.hasRole(moduleId, roleName, roleHierarchy);
      return signal ? signal() : false;
    },

    /**
     * Limpa o cache de papéis
     */
    clearRoleCache: (): void => {
      roleSignalsCache.clear();
      highestRoleCache.clear();
    },
  };

  return helpers;
};
