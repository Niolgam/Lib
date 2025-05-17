// auth.store.ts
import { inject, computed, Signal, effect, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { signalStore, withState, withComputed, patchState, withMethods, withHooks, withProps } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap, catchError, of, EMPTY, Observable, finalize, throwError, delay } from 'rxjs';

import { withLoading } from '@vai/store-feature';
import { RoleStore } from './role.store';
import { LocalStorageService, LoggingService, CryptoService } from '@vai/services';
import { User, LoginCredentials, PermissionAction, AuthToken, ForgotPasswordRequest, ResetPasswordRequest, ChangePasswordRequest } from './models';
import { AuthConfigService, AuthService, TokenService } from '@auth/utils';
import { Router } from '@angular/router';
import { CsrfService } from '@auth/utils';
import { SecurityMonitorService } from '@auth/utils';

// Interface para mapeamentos de erro de autenticação
interface AuthErrorMapping {
  message: string;
  reason: string;
  level: 'info' | 'warn' | 'error';
}

// Mapeamento de códigos de erro para mensagens amigáveis e códigos internos
const ERROR_MAPPING: Record<number, AuthErrorMapping> = {
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

interface AuthStoreState {
  isAuthenticated: boolean;
  user: User | null;
  returnUrl: string;
  // Novos estados movidos do service
  isVerifyingStatus: boolean;
  serverAuthStatus: boolean | null;
  loginAttempts: Map<string, { count: number; lastAttempt: number }>;
  refreshFailCount: number;
  lastRefreshAttempt: number;
  ipThrottleState: {
    count: number;
    resetTime: number;
  };
  refreshTokenTimerId: any;
}

const initialAuthState: AuthStoreState = {
  isAuthenticated: false,
  user: null,
  returnUrl: '/dashboard',
  isVerifyingStatus: false,
  serverAuthStatus: null,
  loginAttempts: new Map<string, { count: number; lastAttempt: number }>(),
  refreshFailCount: 0,
  lastRefreshAttempt: 0,
  ipThrottleState: { count: 0, resetTime: 0 },
  refreshTokenTimerId: null,
};

export const AuthStore = signalStore(
  withState(initialAuthState),

  // Adiciona suporte a indicadores de carregamento
  withLoading(),

  // Injeta dependências como propriedades
  withProps(() => ({
    authService: inject(AuthService),
    tokenService: inject(TokenService),
    loggingService: inject(LoggingService),
    authConfigService: inject(AuthConfigService),
    roleStore: inject(RoleStore),
    httpClient: inject(HttpClient),
    router: inject(Router),
    localStorageService: inject(LocalStorageService),
    csrfService: inject(CsrfService),
    cryptoService: inject(CryptoService),
    securityMonitor: inject(SecurityMonitorService),
    isBrowser: isPlatformBrowser(inject(PLATFORM_ID)),
  })),

  // Define propriedades computadas baseadas no estado
  withComputed(({ user, serverAuthStatus, tokenService }) => ({
    currentUser: computed(() => user()),
    isUserAuthenticated: computed(() => {
      const tokenAuth = tokenService.isAuthenticated();
      const serverAuth = serverAuthStatus();
      return serverAuth !== null ? serverAuth : tokenAuth;
    }),
    userName: computed(() => user()?.name ?? tokenService.decodedToken()?.['preferred_username'] ?? ''),
    userId: computed(() => user()?.id ?? tokenService.userId() ?? null),
    userRolesStructured: computed(() => user()?.roles ?? []),
  })),

  // Define métodos do store
  withMethods((store) => {
    const {
      authService,
      loggingService,
      tokenService,
      authConfigService,
      roleStore,
      router,
      localStorageService,
      cryptoService,
      securityMonitor,
      csrfService,
      isBrowser,
    } = store;

    // Caches para melhorar performance em consultas repetidas
    const roleSignalsCache = new Map<string, Signal<boolean>>();
    const highestRoleCache = new Map<string, Signal<string | null>>();

    const getRoleHierarchy = () => authConfigService.roleHierarchy();

    const _parseAuthError = (
      error: any,
    ): {
      message: string;
      reason: string;
      level: 'info' | 'warn' | 'error';
      details: Record<string, any>;
    } => {
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
        const connectionError = ERROR_MAPPING[0];
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
      const statusMapping = ERROR_MAPPING[error.status];
      if (statusMapping) {
        return {
          ...errorInfo,
          message: statusMapping.message,
          reason: statusMapping.reason,
          level: statusMapping.level,
        };
      }

      // Tratar intervalo 5xx (erros de servidor)
      if (error.status >= 500 && error.status < 600) {
        const serverError = ERROR_MAPPING[500];
        return {
          ...errorInfo,
          message: serverError.message,
          reason: serverError.reason,
          level: serverError.level,
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
    };

    /**
     * Registra tentativas de login para rate limiting
     * @private
     */
    const _registerLoginAttempt = (username: string): void => {
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
    };

    /**
     * Incrementa contador de tentativas de login falhas
     * @private
     */
    const _incrementLoginAttempts = (username: string): void => {
      const loginAttempts = store.loginAttempts();
      const userRecord = loginAttempts.get(username);

      if (userRecord) {
        userRecord.count++;
        userRecord.lastAttempt = Date.now();

        // Atualiza o estado para reatividade
        patchState(store, { loginAttempts: new Map(loginAttempts) });
      }
    };

    /**
     * Reseta contador de tentativas de login
     * @private
     */
    const _resetLoginAttempts = (username: string): void => {
      const loginAttempts = store.loginAttempts();
      loginAttempts.delete(username);

      // Atualiza o estado para reatividade
      patchState(store, { loginAttempts: new Map(loginAttempts) });
    };

    /**
     * Verifica se login está bloqueado por excesso de tentativas
     * @private
     */
    const _isLoginRateLimited = (username: string): boolean => {
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
    };

    /**
     * Verifica se refresh de token está bloqueado por excesso de falhas
     * @private
     */
    const _isRefreshRateLimited = (): boolean => {
      const now = Date.now();
      const refreshFailCount = store.refreshFailCount();
      const lastRefreshAttempt = store.lastRefreshAttempt();
      const refreshAttemptResetMs = authConfigService.securityCheckInterval();
      const maxRefreshFails = 3; // Poderíamos adicionar esta configuração específica
      //
      // Reset contador se passou o período
      if (now - lastRefreshAttempt > refreshAttemptResetMs) {
        patchState(store, { refreshFailCount: 0 });
        return false;
      }

      return refreshFailCount >= maxRefreshFails;
    };

    /**
     * Verifica throttling de IP (exemplo de implementação no cliente)
     * @private
     */
    const _checkIpThrottling = (): boolean => {
      const now = Date.now();
      const ipThrottleState = store.ipThrottleState();
      const ipThrottleResetMs = authConfigService.securityCheckInterval();
      const maxIpRequests = authConfigService.maxLoginAttempts() * 20; // Exemplo: 20x o limite de login

      // Reset contador se passou o período
      if (now > ipThrottleState.resetTime) {
        patchState(store, {
          ipThrottleState: {
            count: 1,
            resetTime: now + ipThrottleResetMs,
          },
        });
        return false;
      }

      // Incrementa contador
      patchState(store, {
        ipThrottleState: {
          count: ipThrottleState.count + 1,
          resetTime: ipThrottleState.resetTime,
        },
      });

      // Verifica se excedeu limite
      return ipThrottleState.count >= maxIpRequests;
    };

    /**
     * Agenda a próxima renovação de token com base na expiração
     * @private
     */
    const _scheduleTokenRefresh = (): void => {
      // Verifica se tem um token válido
      const token = tokenService.token();
      if (!token) return;

      const decodedToken = tokenService.decodedToken();
      if (!decodedToken?.exp) return;

      // Obter configs relevantes
      const authConfig = authConfigService.config();
      const refreshThreshold = authConfig?.tokenRefreshThreshold || 600; // Default: 10 minutos antes

      // Calcular quando fazer o refresh (em ms)
      const expiresAt = decodedToken.exp * 1000; // Converter para ms
      const now = Date.now();
      const timeUntilExpiry = expiresAt - now;

      // Se já expirado ou vai expirar muito em breve, fazer refresh imediato
      if (timeUntilExpiry < 10000) {
        // Menos de 10 segundos
        loggingService.debug('Token expiring very soon, refreshing immediately');
        methods.refreshToken();
        return;
      }

      // Calcular quando fazer o refresh (refreshThreshold segundos antes da expiração)
      const refreshDelay = timeUntilExpiry - refreshThreshold * 1000;

      // Garantir um valor mínimo para evitar loops rápidos em caso de erro de cálculo
      const safeRefreshDelay = Math.max(refreshDelay, 10000); // Mínimo 10 segundos

      loggingService.debug('Scheduling token refresh', {
        expiresIn: Math.floor(timeUntilExpiry / 1000),
        refreshIn: Math.floor(safeRefreshDelay / 1000),
      });

      // Limpar qualquer timer existente
      const currentTimerId = store.refreshTokenTimerId();
      if (currentTimerId) {
        clearTimeout(currentTimerId);
      }

      // Agendar refresh
      const timerId = setTimeout(() => {
        loggingService.debug('Executing scheduled token refresh');
        methods.refreshToken();
      }, safeRefreshDelay);

      // Armazenar o ID do timer
      patchState(store, { refreshTokenTimerId: timerId });
    };

    /**
     * Limpa o agendamento de refresh de token
     */
    const clearTokenRefreshScheduler = (): void => {
      const timerId = store.refreshTokenTimerId();
      if (timerId) {
        clearTimeout(timerId);
        patchState(store, { refreshTokenTimerId: null });
        loggingService.debug('Token refresh scheduler cleared');
      }
    };

    /**
     * Limpa estado de autenticação
     */
    const clearAuthState = (): void => {
      tokenService.clearToken();
      csrfService.clearToken();
      patchState(store, { serverAuthStatus: false, isAuthenticated: false, user: null });
    };

    // Método privado para salvar URL de retorno
    const _saveReturnUrl = (url: string | null): void => {
      if (!isBrowser) return;

      if (url) {
        localStorageService.setItem('auth_return_url', url);
        patchState(store, { returnUrl: url });
      }
    };

    // Método privado para obter URL de retorno
    const _getReturnUrl = (): string => {
      if (!isBrowser) return authConfigService.config().redirectAfterLogin || '/dashboard';

      // Primeiro tenta obter do state
      let returnUrl = store.returnUrl();

      // Se não existir no state, tenta do localStorage
      if (!returnUrl) {
        returnUrl = localStorageService.getItem<string>('auth_return_url') || '/dashboard';
        if (returnUrl) {
          patchState(store, { returnUrl });
        }
      }

      // Se ainda não existir, usa o padrão da configuração
      return returnUrl || authConfigService.config().redirectAfterLogin || '/dashboard';
    };

    // Método privado para limpar URL de retorno
    const _clearReturnUrl = (): void => {
      if (!isBrowser) return;
      localStorageService.removeItem('auth_return_url');
      patchState(store, { returnUrl: '' });
    };

    // Método privado para redirecionar após login bem-sucedido
    const _redirectAfterLogin = (): void => {
      const returnUrl = _getReturnUrl();
      loggingService.debug('AuthStore: Redirecting after login', { returnUrl });
      router.navigateByUrl(returnUrl);
      _clearReturnUrl();
    };

    // Método privado para redirecionar após logout
    const _redirectAfterLogout = (): void => {
      const redirectPath = authConfigService.config().redirectAfterLogout || '/login';
      loggingService.debug('AuthStore: Redirecting after logout', { redirectPath });
      router.navigateByUrl(redirectPath);
    };

    // Método interno para buscar dados do usuário
    const fetchUserDataInternal = (): Observable<User | null> => {
      if (!store.isUserAuthenticated()) {
        loggingService.debug('AuthStore.fetchUserDataInternal: Skipped, store is not authenticated.');
        return of(null);
      }

      loggingService.debug('AuthStore.fetchUserDataInternal: Fetching user data...');
      patchState(store, { isVerifyingStatus: true });

      return authService.fetchUserDataRequest().pipe(
        tap((userData) => {
          patchState(store, { user: userData });
        }),
        catchError((err) => {
          loggingService.error('AuthStore.fetchUserDataInternal: Failed to fetch user data.', { err });
          patchState(store, { user: null, isAuthenticated: false });
          return of(null);
        }),
        finalize(() => {
          patchState(store, { isVerifyingStatus: false });
        }),
      );
    };

    // Definição dos métodos públicos do store
    const methods = {
      // Método para verificar status de autenticação na inicialização
      verifyAuthStatusOnInit(): Observable<boolean> {
        patchState(store, { isVerifyingStatus: true });

        return authService.verifyAuthStatusRequest().pipe(
          tap((isAuthenticated) => {
            patchState(store, {
              serverAuthStatus: isAuthenticated,
              isAuthenticated,
            });
            loggingService.debug('Initial auth status verified', { isAuthenticated });
          }),
          catchError((error) => {
            loggingService.warn('Initial auth status verification failed', { error });
            patchState(store, { serverAuthStatus: false, isAuthenticated: false });
            return of(false);
          }),
          finalize(() => {
            patchState(store, { isVerifyingStatus: false });
          }),
        );
      },

      // Configurar agendador de refresh de token
      setupTokenRefreshScheduler(): void {
        if (!isBrowser) return;

        clearTokenRefreshScheduler();

        // Observa mudanças no token via effect
        effect(() => {
          const isAuthenticated = store.isUserAuthenticated();
          if (isAuthenticated) {
            _scheduleTokenRefresh();
          } else {
            clearTokenRefreshScheduler();
          }
        });
      },

      // Método público para limpar agendador
      clearTokenRefreshScheduler,

      // Método público para salvar URL de retorno
      setReturnUrl(url: string): void {
        _saveReturnUrl(url);
      },

      // Método para login
      login: rxMethod<LoginCredentials>(
        pipe(
          tap(() => store.setLoading('login', true)),
          tap((credentials) => {
            loggingService.info('Login attempt', { u: credentials.username });
          }),
          // Verificação de rate limiting
          switchMap((credentials) => {
            if (_isLoginRateLimited(credentials.username)) {
              loggingService.warn('Login rate limited', { u: credentials.username });
              securityMonitor.logSecurityEvent('auth.rate_limited', 'warning', { username: credentials.username });

              // Retorna um erro estruturado
              return throwError(() => ({
                message: 'Too many login attempts. Please try again later',
                code: 'rate_limited',
                status: 429,
                timestamp: new Date().toISOString(),
                recoverable: true,
              }));
            }

            // Registra tentativa
            _registerLoginAttempt(credentials.username);

            // Aplica delay para dificultar timing attacks
            return of(credentials).pipe(delay(authConfigService.loginDelay()));
          }),
          // Chama o service HTTP
          switchMap((credentials) =>
            authService.loginRequest(credentials).pipe(
              tap((authToken) => {
                if (authToken && authToken.accessToken) {
                  // Reset contador de tentativas para este usuário
                  _resetLoginAttempts(credentials.username);

                  tokenService.storeToken(authToken, credentials.rememberMe);
                  patchState(store, {
                    serverAuthStatus: true,
                    isAuthenticated: true,
                  });
                  loggingService.info('Login successful', { u: credentials.username });

                  // Registra evento de login bem-sucedido
                  securityMonitor.logLoginAttempt(credentials.username, true);

                  // Carrega os dados do usuário imediatamente
                  methods.loadUser({ forceLoad: true });
                } else {
                  // Incrementa contador de falhas
                  _incrementLoginAttempts(credentials.username);

                  loggingService.warn('Token not in login response', { body: authToken });
                  clearAuthState();

                  // Registra evento de falha de login
                  securityMonitor.logLoginAttempt(credentials.username, false);

                  throw new Error('Token not received post-login. Authentication response is missing required data.');
                }
              }),
              catchError((error) => {
                // Incrementa contador de falhas mesmo em caso de erro
                _incrementLoginAttempts(credentials.username);

                // Analisa e processa o erro de forma estruturada
                const errorInfo = _parseAuthError(error);

                // Log dinâmico com nível apropriado
                loggingService[errorInfo.level](`Login failed: ${errorInfo.message}`, {
                  u: credentials.username,
                  status: error.status,
                  reason: errorInfo.reason,
                  details: errorInfo.details,
                });

                clearAuthState();

                securityMonitor.logLoginAttempt(credentials.username, false);

                // Retorna um erro enriquecido que pode ser usado na UI
                return throwError(() => ({
                  message: errorInfo.message,
                  code: errorInfo.reason,
                  status: error.status,
                  timestamp: new Date().toISOString(),
                  recoverable: errorInfo.level !== 'error',
                }));
              }),
            ),
          ),
          tap(() => {
            store.setLoading('login', false);
            // Redirecionamos após login bem-sucedido
            if (store.isUserAuthenticated()) {
              _redirectAfterLogin();
            }
          }),
        ),
      ),

      // Método para logout
      logout: rxMethod<void>(
        pipe(
          tap(() => {
            store.setLoading('logout', true);
            loggingService.info('Logout attempt');
          }),
          switchMap(() =>
            authService.logoutRequest().pipe(
              tap(() => {
                loggingService.info('Server logout successful');
              }),
              catchError((error) => {
                loggingService.error('Server logout error', { m: error.message });
                return of(null); // Continue mesmo com erro
              }),
              finalize(() => {
                clearAuthState();
                loggingService.info('Local auth state cleared post-logout.');
                _redirectAfterLogout();
              }),
            ),
          ),
          tap(() => store.setLoading('logout', false)),
        ),
      ),

      // Método para renovar token
      refreshToken: rxMethod<void>(
        pipe(
          tap(() => {
            store.setLoading('refreshToken', true);
            loggingService.debug('Refresh token attempt');
          }),
          switchMap(() => {
            // Verifica se teve muitas falhas recentes
            if (_isRefreshRateLimited()) {
              const errorMessage = 'Too many failed refresh attempts. Please login again.';
              loggingService.warn('Refresh token rate limited');
              clearAuthState();

              return throwError(() => new Error(errorMessage));
            }

            // Registro do timestamp da tentativa
            patchState(store, { lastRefreshAttempt: Date.now() });

            return authService.refreshTokenRequest().pipe(
              tap((responseToken: AuthToken | any) => {
                if (responseToken && responseToken.accessToken) {
                  // Reset contador de falhas em sucesso
                  patchState(store, { refreshFailCount: 0 });

                  tokenService.storeToken(responseToken);
                  patchState(store, {
                    serverAuthStatus: true,
                    isAuthenticated: true,
                  });
                  loggingService.debug('Token refresh successful');

                  _scheduleTokenRefresh();
                } else {
                  // Incrementa contador de falhas
                  patchState(store, {
                    refreshFailCount: store.refreshFailCount() + 1,
                  });

                  loggingService.warn('New token not in refresh response.');
                  clearAuthState();
                  throw new Error('Token not received post-refresh.');
                }
              }),
              catchError((error) => {
                // Incrementa contador de falhas
                patchState(store, {
                  refreshFailCount: store.refreshFailCount() + 1,
                });

                loggingService.error('Token refresh failed', { m: error.message });
                clearAuthState();
                return throwError(() => error);
              }),
            );
          }),
          tap(() => store.setLoading('refreshToken', false)),
        ),
      ),

      // Método para verificar status de autenticação
      verifyAuthStatus: rxMethod<void>(
        pipe(
          tap(() => {
            patchState(store, { isVerifyingStatus: true });
            loggingService.debug('Verifying auth status');
          }),
          switchMap(() =>
            authService.verifyAuthStatusRequest().pipe(
              tap((authenticated) => {
                patchState(store, {
                  serverAuthStatus: authenticated,
                  isAuthenticated: authenticated,
                });

                if (!authenticated && tokenService.token()) {
                  tokenService.clearToken();
                  csrfService.clearToken();
                }

                loggingService.debug('Auth status verified', { authenticated });
              }),
              catchError((error) => {
                loggingService.warn('Auth status verification failed', { error });
                patchState(store, {
                  serverAuthStatus: false,
                  isAuthenticated: false,
                });

                if (tokenService.token()) {
                  tokenService.clearToken();
                  csrfService.clearToken();
                }

                return of(false);
              }),
              finalize(() => {
                patchState(store, { isVerifyingStatus: false });
              }),
            ),
          ),
        ),
      ),

      // Método para carregar dados do usuário
      loadUser: rxMethod<void | { forceLoad?: boolean }>(
        pipe(
          tap((options) => {
            const force = typeof options === 'object' && options?.forceLoad;
            if (!store.user() || force) {
              store.setLoading('loadUser', true);
            }
            loggingService.debug('AuthStore: loadUser method called.', { options });
          }),
          switchMap((options) => {
            const force = typeof options === 'object' && options?.forceLoad;
            if (!store.isUserAuthenticated() && !force) {
              loggingService.warn('AuthStore: loadUser skipped, store not authenticated and not forced.');
              store.setLoading('loadUser', false);
              return of(null);
            }
            if (store.user() && !force) {
              loggingService.debug('AuthStore: User already in store and not forcing reload.');
              store.setLoading('loadUser', false);
              return of(store.user());
            }
            return fetchUserDataInternal().pipe(
              tap((userData) => {
                patchState(store, { user: userData });
              }),
            );
          }),
          tap(() => store.setLoading('loadUser', false)),
        ),
      ),

      // Iniciar autenticação com Google
      initiateGoogleAuth(): string {
        const cfg = authConfigService.config();
        const url = authConfigService.resolvedGoogleAuthUrl();
        if (!(cfg?.googleAuthEnabled && url)) throw new Error('Google auth not enabled/URL not configured');

        // Adiciona nonce para proteção contra CSRF
        const nonce = cryptoService.generateSecureId();
        if (isBrowser) {
          localStorage.setItem('auth_nonce', nonce);
        }

        return `${url}${url.includes('?') ? '&' : '?'}nonce=${nonce}`;
      },

      // Iniciar autenticação com GovBR
      initiateGovBrAuth(): string {
        const cfg = authConfigService.config();
        const url = authConfigService.resolvedGovBrAuthUrl();
        if (!(cfg?.govBrAuthEnabled && url)) throw new Error('GovBR auth not enabled/URL not configured');

        // Adiciona nonce para proteção contra CSRF
        const nonce = cryptoService.generateSecureId();
        if (isBrowser) {
          localStorage.setItem('auth_nonce', nonce);
        }

        loggingService.info('GovBR auth initiated');
        return `${url}${url.includes('?') ? '&' : '?'}nonce=${nonce}`;
      },

      // Processar callback de autenticação externa
      handleAuthCallback: rxMethod<{ code: string; provider: 'google' | 'govbr'; nonce?: string }>(
        pipe(
          tap(() => store.setLoading('handleCallback', true)),
          switchMap(({ code, provider, nonce }) => {
            // Verifica nonce para proteger contra CSRF
            let storedNonce = '';
            if (isBrowser) {
              storedNonce = localStorage.getItem('auth_nonce') || '';
              localStorage.removeItem('auth_nonce'); // Remove independente do resultado
            }

            if (nonce && storedNonce && nonce !== storedNonce) {
              const errorMessage = 'Security validation failed for OAuth callback';
              loggingService.error(errorMessage, { provider });

              // Registra evento de segurança
              securityMonitor.logSecurityEvent('auth.oauth_nonce_mismatch', 'critical', { provider });

              return throwError(() => new Error(errorMessage));
            }

            return authService.handleAuthCallbackRequest(code, provider, nonce).pipe(
              tap((responseToken: AuthToken | any) => {
                if (responseToken && responseToken.accessToken) {
                  tokenService.storeToken(responseToken);
                  patchState(store, {
                    serverAuthStatus: true,
                    isAuthenticated: true,
                  });
                  loggingService.info(`${provider} auth successful`);

                  // Carrega os dados do usuário
                  methods.loadUser({ forceLoad: true });
                } else {
                  loggingService.warn(`Token not in ${provider} callback response.`);
                  clearAuthState();
                  throw new Error(`Token not received post ${provider} callback.`);
                }
              }),
              catchError((error) => {
                loggingService.error(`${provider} auth callback failed`, { m: error.message });
                clearAuthState();
                return throwError(() => error);
              }),
            );
          }),
          tap(() => {
            store.setLoading('handleCallback', false);
            // Redireciona após autenticação bem sucedida
            if (store.isUserAuthenticated()) {
              _redirectAfterLogin();
            }
          }),
        ),
      ),

      // Solicitar recuperação de senha
      forgotPassword: rxMethod<ForgotPasswordRequest>(
        pipe(
          tap(() => store.setLoading('forgotPassword', true)),
          switchMap((request) => {
            // Limita frequência de solicitações
            const key = `forgot_${request.email}`;
            let lastRequest = '';

            if (isBrowser) {
              lastRequest = localStorage.getItem(key) || '';
            }

            if (lastRequest) {
              const lastTime = parseInt(lastRequest, 10);
              const now = Date.now();

              // Limita a 1 solicitação a cada 10 minutos
              if (now - lastTime < 600000) {
                // 10 minutos
                // Registra evento de segurança
                securityMonitor.logSecurityEvent('auth.password_reset_throttled', 'warning', { email: request.email });

                return throwError(() => new Error('Please wait before requesting another password reset'));
              }
            }

            // Salva timestamp da solicitação
            if (isBrowser) {
              localStorage.setItem(key, Date.now().toString());
            }

            loggingService.info('Password reset requested', { e: request.email });

            return authService.forgotPasswordRequest(request).pipe(
              tap(() => loggingService.info('Password reset email sent', { e: request.email })),
              catchError((error) => {
                loggingService.error('Password reset request failed', { e: request.email, m: error.message });
                return throwError(() => error);
              }),
            );
          }),
          tap(() => store.setLoading('forgotPassword', false)),
        ),
      ),

      // Redefinir senha com token de recuperação
      resetPassword: rxMethod<ResetPasswordRequest>(
        pipe(
          tap(() => store.setLoading('resetPassword', true)),
          switchMap((request) =>
            authService.resetPasswordRequest(request).pipe(
              tap(() => loggingService.info('Password reset successful')),
              catchError((error) => {
                loggingService.error('Password reset failed', { m: error.message });
                return throwError(() => error);
              }),
            ),
          ),
          tap(() => store.setLoading('resetPassword', false)),
        ),
      ),

      // Alterar senha do usuário logado
      changePassword: rxMethod<ChangePasswordRequest>(
        pipe(
          tap(() => store.setLoading('changePassword', true)),
          switchMap((request) =>
            authService.changePasswordRequest(request).pipe(
              tap(() => loggingService.info('Password change successful')),
              catchError((error) => {
                loggingService.error('Password change failed', { m: error.message });
                return throwError(() => error);
              }),
            ),
          ),
          tap(() => store.setLoading('changePassword', false)),
        ),
      ),

      // --- Métodos de Verificação de Papel ---

      // Verifica se o usuário tem determinado papel (como Signal)
      hasRole(moduleId: string, roleName: string): Signal<boolean> {
        const cacheKey = `role:${moduleId}:${roleName}`;
        if (!roleSignalsCache.has(cacheKey)) {
          roleSignalsCache.set(
            cacheKey,
            computed(() => {
              const userObj = store.user();
              if (!userObj?.roles) return false;
              const hierarchy = getRoleHierarchy();
              const isGlobalAdmin = userObj.roles.some(
                (r) => r.moduleId === 'core' && hierarchy[r.role as keyof typeof hierarchy] === hierarchy['admin'],
              );
              if (isGlobalAdmin) return true;
              return userObj.roles.some((r) => r.moduleId === moduleId && r.role === roleName);
            }),
          );
        }
        return roleSignalsCache.get(cacheKey)!;
      },

      // Obtém papel mais alto do usuário em um módulo (como Signal)
      getHighestRoleInModule(moduleId: string): Signal<string | null> {
        const cacheKey = `highest:${moduleId}`;
        if (!highestRoleCache.has(cacheKey)) {
          highestRoleCache.set(
            cacheKey,
            computed(() => {
              const userObj = store.user();
              if (!userObj?.roles) return null;
              const hierarchy = getRoleHierarchy();
              let highestRole: string | null = null;
              let highestLevel = -1;
              const moduleUserRoles = userObj.roles.filter((r) => r.moduleId === moduleId);
              for (const userRole of moduleUserRoles) {
                const roleLevel = hierarchy[userRole.role as keyof typeof hierarchy] || 0;
                if (roleLevel > highestLevel) {
                  highestLevel = roleLevel;
                  highestRole = userRole.role;
                }
              }
              return highestRole;
            }),
          );
        }
        return highestRoleCache.get(cacheKey)!;
      },

      // Verifica se o usuário tem determinado papel (versão síncrona)
      hasRoleSync(moduleId: string, roleName: string): boolean {
        return methods.hasRole(moduleId, roleName)();
      },

      // Obtém papel mais alto do usuário em um módulo (versão síncrona)
      getHighestRoleInModuleSync(moduleId: string): string | null {
        return methods.getHighestRoleInModule(moduleId)();
      },

      // Verifica se o usuário tem permissão para executar uma ação
      checkUserHasPermissionForAction(moduleIdToCheck: string, permissionInput: string, actionToCheck: keyof PermissionAction | string): boolean {
        const user = store.currentUser();
        if (!user?.roles || user.roles.length === 0) {
          return false;
        }

        // Admin global sempre tem acesso
        if (methods.hasRoleSync('core', 'admin')) {
          return true;
        }

        // Iterar sobre os papéis atribuídos ao usuário
        for (const userRole of user.roles) {
          if (userRole.moduleId !== moduleIdToCheck) {
            continue;
          }

          const systemRoleDefinition = roleStore.roles().find((r) => r.moduleId === userRole.moduleId && r.name === userRole.role);

          if (systemRoleDefinition && systemRoleDefinition.permissionAssignments) {
            for (const assignment of systemRoleDefinition.permissionAssignments) {
              const permissionDefinition = roleStore.permissions().find((p) => p.id === assignment.permissionId);

              if (permissionDefinition) {
                let permissionMatches = false;
                if (permissionInput.includes(':')) {
                  if (`${permissionDefinition.moduleId}:${permissionDefinition.code}` === permissionInput) {
                    permissionMatches = true;
                  }
                } else {
                  if (permissionDefinition.code === permissionInput) {
                    permissionMatches = true;
                  }
                }

                if (permissionMatches) {
                  if (assignment.actions[actionToCheck as keyof PermissionAction]) {
                    return true;
                  }
                }
              }
            }
          }
        }
        return false;
      },

      // Método auxiliar para redirecionamento após login
      redirectAfterLogin(): void {
        _redirectAfterLogin();
      },

      // Método auxiliar para redirecionamento após logout
      redirectAfterLogout(): void {
        _redirectAfterLogout();
      },
    };

    return methods;
  }),

  // Define hooks do ciclo de vida
  withHooks({
    onInit(store) {
      const loggingService = inject(LoggingService);
      const isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

      loggingService.debug('AuthStore: Initializing...');

      // Tenta carregar a URL de retorno do localStorage se existir
      if (isBrowser) {
        const storedReturnUrl = store.localStorageService.getItem<string>('auth_return_url');
        if (storedReturnUrl) {
          patchState(store, { returnUrl: storedReturnUrl });
        }
      }

      // Verificar status de autenticação na inicialização
      store.verifyAuthStatusOnInit().subscribe({
        next: (isAuthenticated) => {
          loggingService.debug('AuthStore: Initial auth status check complete', { isAuthenticated });

          // Se estiver autenticado, configurar refresh de token e carregar usuário
          if (isAuthenticated) {
            store.setupTokenRefreshScheduler();
            store.loadUser({ forceLoad: true });
          }
        },
        error: (error) => {
          loggingService.error('AuthStore: Error in initial auth check', { error });
        },
      });

      // Effect para monitorar mudanças no status de autenticação
      effect(() => {
        const isAuthenticated = store.isUserAuthenticated();
        loggingService.debug('AuthStore: Authentication status changed', { isAuthenticated });

        if (isAuthenticated) {
          // Se o usuário foi autenticado e não temos dados, carregá-los
          if (!store.user()) {
            store.loadUser({ forceLoad: true });
          }
        } else {
          // Se foi desautenticado, garantir que não temos dados de usuário
          if (store.user() !== null) {
            patchState(store, { user: null });
          }
        }
      });
    },
  }),
);
