import { inject, computed, PLATFORM_ID, Signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { patchState, signalStore, withComputed, withState, withProps, withMethods } from '@ngrx/signals';

import { RoleStore } from './role.store';
import {
  AuthService,
  TokenService,
  AuthConfigService,
  AuthErrorService,
  createAuthRateLimitingHelpers,
  createAuthRedirectHelpers,
  createAuthTokenHelpers,
} from '@auth/utils';
import { LoggingService, LocalStorageService, CryptoService } from '@vai/services';
import { User, LoginCredentials, ForgotPasswordRequest, ResetPasswordRequest, ChangePasswordRequest } from './models';
import { Router } from '@angular/router';
import { CsrfService } from '@auth/utils';
import { SecurityMonitorService } from '@auth/utils';
import { withCallState, withImmutableState } from '@vai/store-feature';
import { toObservable } from '@angular/core/rxjs-interop';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, throwError, Observable, EMPTY, of } from 'rxjs';

interface AuthStoreState {
  isAuthenticated: boolean;
  user: User | null;
  returnUrl: string;
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

const initialState: AuthStoreState = {
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

/**
 * AuthStore - Centraliza toda lógica relacionada a autenticação
 * Implementa BaseStore para garantir interface consistente
 */
export const AuthStore = signalStore(
  withState(initialState),
  withProps(() => ({
    authService: inject(AuthService),
    tokenService: inject(TokenService),
    loggingService: inject(LoggingService),
    authConfigService: inject(AuthConfigService),
    roleStore: inject(RoleStore),
    router: inject(Router),
    localStorageService: inject(LocalStorageService),
    csrfService: inject(CsrfService),
    cryptoService: inject(CryptoService),
    securityMonitor: inject(SecurityMonitorService),
    isBrowser: isPlatformBrowser(inject(PLATFORM_ID)),
  })),
  withCallState(),
  withImmutableState(),
  withComputed(({ user, serverAuthStatus, isAuthenticated }) => {
    const tokenService = inject(TokenService);

    return {
      // Estado principal para interface BaseStore
      state: computed(() => ({
        isAuthenticated: isAuthenticated(),
        user: user(),
        serverAuthStatus: serverAuthStatus(),
      })),
      // Outros computeds
      currentUser: computed(() => user()),
      isUserAuthenticated: computed(() => {
        const tokenAuth = tokenService.isAuthenticated();
        const serverAuth = serverAuthStatus();
        return serverAuth !== null ? serverAuth : tokenAuth;
      }),
      userName: computed(() => user()?.name ?? tokenService.decodedToken()?.['preferred_username'] ?? ''),
      userId: computed(() => user()?.id ?? tokenService.userId() ?? null),
      userRolesStructured: computed(() => user()?.roles ?? []),
    };
  }),

  // Métodos públicos
  withMethods((store) => {
    // Inicializando helpers
    const rateLimit = createAuthRateLimitingHelpers(store);
    const tokenHelpers = createAuthTokenHelpers(store);
    const redirectHelpers = createAuthRedirectHelpers(store, store.isBrowser);

    const methods = {
      initialize() {
        store.loggingService.debug('AuthStore: Initializing');

        methods.verifyAuthStatusOnInit().subscribe({
          next: (isAuthenticated: boolean) => {
            store.loggingService.debug('AuthStore: Initial auth status', { isAuthenticated });

            if (isAuthenticated) {
              methods.setupTokenRefreshScheduler();
              methods.loadUser({ forceLoad: true });
            }
          },
        });
      },

      reset() {
        tokenHelpers.clearAuthState(store.tokenService, store.csrfService);
        patchState(store, initialState);
        store.loggingService.debug('AuthStore: Reset to initial state');
      },

      // Verificar status de autenticação na inicialização
      verifyAuthStatusOnInit() {
        patchState(store, { isVerifyingStatus: true });

        const operationKey = 'verifyAuthOnInit';

        return store.trackCall(operationKey, store.authService.verifyAuthStatusRequest(), {
          onSuccess: (isAuthenticated: boolean) => {
            patchState(store, {
              serverAuthStatus: isAuthenticated,
              isAuthenticated,
              isVerifyingStatus: false,
            });

            store.loggingService.debug('Initial auth status verified', { isAuthenticated });
          },
          onError: (error: any) => {
            store.loggingService.warn('Initial auth status verification failed', { error });

            patchState(store, {
              serverAuthStatus: false,
              isAuthenticated: false,
              isVerifyingStatus: false,
            });
          },
        });
      },

      // Configurar agendador de refresh de token
      setupTokenRefreshScheduler(): void {
        if (!store.isBrowser) return;

        tokenHelpers.clearTokenRefreshScheduler();

        // Agendamento inicial se estiver autenticado
        if (store.isUserAuthenticated()) {
          tokenHelpers.scheduleTokenRefresh(store.tokenService, store.authConfigService, store.loggingService, () => methods.refreshToken);
        }
      },

      // Limpar agendador
      clearTokenRefreshScheduler: tokenHelpers.clearTokenRefreshScheduler,

      // Salvar URL de retorno
      setReturnUrl(url: string): void {
        redirectHelpers.saveReturnUrl(url, store.localStorageService);
      },

      // Login usando rxMethod para padronizar o uso de Signals e RxJS
      login: rxMethod<LoginCredentials>(
        pipe(
          switchMap((credentials) => {
            store.loggingService.info('Login attempt', { u: credentials.username });

            // Verificação de rate limiting
            if (rateLimit.isLoginRateLimited(credentials.username, store.authConfigService)) {
              store.loggingService.warn('Login rate limited', { u: credentials.username });
              store.securityMonitor?.logSecurityEvent('auth.rate_limited', 'warning', { username: credentials.username });

              return throwError(() => ({
                message: 'Too many login attempts. Please try again later',
                code: 'rate_limited',
                status: 429,
                timestamp: new Date().toISOString(),
                recoverable: true,
              }));
            }

            // Registrar tentativa
            rateLimit.registerLoginAttempt(credentials.username, store.authConfigService);

            // Enviar request de login
            return store.trackCall('login', store.authService.loginRequest(credentials), {
              onSuccess: (authToken: any) => {
                if (authToken && authToken.accessToken) {
                  // Reset contador de tentativas para este usuário
                  rateLimit.resetLoginAttempts(credentials.username);

                  store.tokenService.storeToken(authToken, credentials.rememberMe);
                  patchState(store, {
                    serverAuthStatus: true,
                    isAuthenticated: true,
                  });

                  store.loggingService.info('Login successful', { u: credentials.username });

                  // Registra evento de login bem-sucedido
                  store.securityMonitor?.logLoginAttempt(credentials.username, true);

                  // Carrega os dados do usuário imediatamente
                  methods.loadUser({ forceLoad: true });

                  // Redireciona após login
                  methods.redirectAfterLogin();

                  return authToken;
                } else {
                  // Incrementa contador de falhas
                  rateLimit.incrementLoginAttempts(credentials.username);

                  store.loggingService.warn('Token not in login response', { body: authToken });
                  tokenHelpers.clearAuthState(store.tokenService, store.csrfService);

                  // Registra evento de falha de login
                  store.securityMonitor?.logLoginAttempt(credentials.username, false);

                  throw new Error('Token not received post-login. Authentication response is missing required data.');
                }
              },
              onError: (error: any) => {
                // Incrementa contador de falhas mesmo em caso de erro
                rateLimit.incrementLoginAttempts(credentials.username);

                // Analisa e processa o erro de forma estruturada
                const errorInfo = AuthErrorService.parseAuthError(error);

                // Log dinâmico com nível apropriado
                store.loggingService[errorInfo.level](`Login failed: ${errorInfo.message}`, {
                  u: credentials.username,
                  status: error.status,
                  reason: errorInfo.reason,
                  details: errorInfo.details,
                });

                tokenHelpers.clearAuthState(store.tokenService, store.csrfService);

                store.securityMonitor?.logLoginAttempt(credentials.username, false);

                return throwError(() => errorInfo);
              },
            });
          }),
        ),
      ),

      // Versão Observable do login para compatibilidade com interceptors
      login$(credentials: LoginCredentials): Observable<any> {
        return toObservable(this.login(credentials));
      },

      // Logout
      logout: rxMethod(
        pipe(
          switchMap(() => {
            store.loggingService.info('Logout attempt');

            return store.trackCall('logout', store.authService.logoutRequest(), {
              onSuccess: () => {
                store.loggingService.info('Server logout successful');
                tokenHelpers.clearAuthState(store.tokenService, store.csrfService);
                methods.redirectAfterLogout();
                return true;
              },
              onError: (error: any) => {
                store.loggingService.error('Server logout error', { m: error.message });
                tokenHelpers.clearAuthState(store.tokenService, store.csrfService);
                methods.redirectAfterLogout();
                return false;
              },
            });
          }),
        ),
      ),

      // Versão Observable do logout para compatibilidade com interceptors
      logout$(): Observable<any> {
        return toObservable(this.logout());
      },

      // Renovar token usando rxMethod
      refreshToken: rxMethod(
        pipe(
          switchMap(() => {
            store.loggingService.debug('Refresh token attempt');
            const operationKey = 'refreshToken';

            return store.trackCall(operationKey, store.authService.refreshTokenRequest(), {
              onSuccess: (responseToken: any) => {
                if (responseToken && responseToken.accessToken) {
                  // Reset contador de falhas em sucesso
                  patchState(store, { refreshFailCount: 0 });

                  store.tokenService.storeToken(responseToken);
                  patchState(store, {
                    serverAuthStatus: true,
                    isAuthenticated: true,
                  });

                  store.loggingService.debug('Token refresh successful');

                  // Reagendar próximo refresh
                  tokenHelpers.scheduleTokenRefresh(store.tokenService, store.authConfigService, store.loggingService, () => methods.refreshToken);

                  return true;
                } else {
                  // Incrementa contador de falhas
                  patchState(store, {
                    refreshFailCount: store.refreshFailCount() + 1,
                  });

                  store.loggingService.warn('New token not in refresh response.');
                  tokenHelpers.clearAuthState(store.tokenService, store.csrfService);

                  throw new Error('Token not received post-refresh.');
                }
              },
              onError: (error: any) => {
                // Incrementa contador de falhas
                patchState(store, {
                  refreshFailCount: store.refreshFailCount() + 1,
                });

                store.loggingService.error('Token refresh failed', { m: error.message });
                tokenHelpers.clearAuthState(store.tokenService, store.csrfService);
                return false;
              },
            });
          }),
        ),
      ),

      // Versão Observable do refreshToken para compatibilidade com interceptors
      refreshToken$(): Observable<any> {
        return toObservable(this.refreshToken());
      },

      // Verificar status de autenticação usando rxMethod
      verifyAuthStatus: rxMethod(
        pipe(
          switchMap(() => {
            patchState(store, { isVerifyingStatus: true });
            store.loggingService.debug('Verifying auth status');

            return store.trackCall('verifyAuthStatus', store.authService.verifyAuthStatusRequest(), {
              onSuccess: (authenticated: boolean) => {
                patchState(store, {
                  serverAuthStatus: authenticated,
                  isAuthenticated: authenticated,
                  isVerifyingStatus: false,
                });

                if (!authenticated && store.tokenService.token()) {
                  store.tokenService.clearToken();
                  store.csrfService.clearToken();
                }

                store.loggingService.debug('Auth status verified', { authenticated });
                return authenticated;
              },
              onError: (error: any) => {
                store.loggingService.warn('Auth status verification failed', { error });

                patchState(store, {
                  serverAuthStatus: false,
                  isAuthenticated: false,
                  isVerifyingStatus: false,
                });

                if (store.tokenService.token()) {
                  store.tokenService.clearToken();
                  store.csrfService.clearToken();
                }

                return false;
              },
            });
          }),
        ),
      ),

      // Versão Observable de verifyAuthStatus para compatibilidade
      verifyAuthStatus$(): Observable<boolean> {
        return toObservable(this.verifyAuthStatus());
      },

      // Carregar dados do usuário usando rxMethod
      loadUser: rxMethod<{ forceLoad?: boolean } | void>(
        pipe(
          switchMap((options) => {
            const force = options && 'forceLoad' in options ? options.forceLoad : false;

            if (!store.isUserAuthenticated() && !force) {
              store.loggingService.warn('AuthStore: loadUser skipped, store not authenticated and not forced.');
              return EMPTY;
            }

            if (store.user() && !force) {
              store.loggingService.debug('AuthStore: User already in store and not forcing reload.');
              return of(store.user());
            }

            return store.trackCall('loadUser', store.authService.fetchUserDataRequest(), {
              onSuccess: (userData: User) => {
                patchState(store, { user: userData });
                store.loggingService.debug('User data loaded', { userId: userData?.id });
                return userData;
              },
              onError: (error: any) => {
                store.loggingService.error('Failed to load user data', { error });
                patchState(store, { user: null, isAuthenticated: false });
                return null;
              },
            });
          }),
        ),
      ),

      // Versão Observable de loadUser para compatibilidade
      loadUser$(options?: { forceLoad?: boolean }): Observable<User | null> {
        return toObservable(this.loadUser(options));
      },

      // Iniciar autenticação com Google
      initiateGoogleAuth(): string {
        const cfg = store.authConfigService.config();
        const url = store.authConfigService.resolvedGoogleAuthUrl();

        if (!(cfg?.googleAuthEnabled && url)) {
          throw new Error('Google auth not enabled/URL not configured');
        }

        // Adiciona nonce para proteção contra CSRF
        const nonce = store.cryptoService.generateSecureId();
        if (store.isBrowser) {
          store.localStorageService.setItem('auth_nonce', nonce);
        }

        store.loggingService.info('Google auth initiated');
        return `${url}${url.includes('?') ? '&' : '?'}nonce=${nonce}`;
      },

      // Iniciar autenticação com GovBR
      initiateGovBrAuth(): string {
        const cfg = store.authConfigService.config();
        const url = store.authConfigService.resolvedGovBrAuthUrl();

        if (!(cfg?.govBrAuthEnabled && url)) {
          throw new Error('GovBR auth not enabled/URL not configured');
        }

        // Adiciona nonce para proteção contra CSRF
        const nonce = store.cryptoService.generateSecureId();
        if (store.isBrowser) {
          store.localStorageService.setItem('auth_nonce', nonce);
        }

        store.loggingService.info('GovBR auth initiated');
        return `${url}${url.includes('?') ? '&' : '?'}nonce=${nonce}`;
      },

      // Processar callback de autenticação externa
      handleAuthCallback: rxMethod<{ code: string; provider: 'google' | 'govbr'; nonce?: string }>(
        pipe(
          switchMap((params) => {
            const { code, provider, nonce } = params;
            store.loggingService.debug(`Processing ${provider} auth callback`);

            // Verificar nonce para proteger contra CSRF
            let storedNonce = '';
            if (store.isBrowser) {
              storedNonce = store.localStorageService.getItem('auth_nonce') || '';
              store.localStorageService.removeItem('auth_nonce'); // Remove independente do resultado
            }

            // CORRIGIDO: Verificar CSRF adequadamente
            // Se o nonce foi fornecido na requisição original, ele DEVE corresponder ao armazenado
            // Se não houve nonce na requisição original (storedNonce vazio), o nonce do callback deve ser vazio também
            if ((storedNonce && (!nonce || nonce !== storedNonce)) || (nonce && !storedNonce)) {
              const errorMessage = 'Security validation failed for OAuth callback';
              store.loggingService.error(errorMessage, { provider });

              // Registra evento de segurança
              store.securityMonitor?.logSecurityEvent('auth.oauth_nonce_mismatch', 'critical', {
                provider,
                hasNonce: !!nonce,
                hasStoredNonce: !!storedNonce,
              });

              return store.trackCall(`handleAuthCallback_${provider}`, store.authService.simulateDelayedError(new Error(errorMessage)));
            }

            return store.trackCall(`handleAuthCallback_${provider}`, store.authService.handleAuthCallbackRequest(code, provider, nonce), {
              onSuccess: (responseToken: any) => {
                if (responseToken && responseToken.accessToken) {
                  store.tokenService.storeToken(responseToken);
                  patchState(store, {
                    serverAuthStatus: true,
                    isAuthenticated: true,
                  });

                  store.loggingService.info(`${provider} auth successful`);

                  methods.loadUser({ forceLoad: true });
                  methods.redirectAfterLogin();
                  return responseToken;
                } else {
                  store.loggingService.warn(`Token not in ${provider} callback response.`);
                  tokenHelpers.clearAuthState(store.tokenService, store.csrfService);

                  throw new Error(`Token not received post ${provider} callback.`);
                }
              },
              onError: (error: any) => {
                store.loggingService.error(`${provider} auth callback failed`, { m: error.message });
                tokenHelpers.clearAuthState(store.tokenService, store.csrfService);
                return error;
              },
            });
          }),
        ),
      ),

      // Versão Observable de handleAuthCallback para compatibilidade
      handleAuthCallback$(params: { code: string; provider: 'google' | 'govbr'; nonce?: string }): Observable<any> {
        return toObservable(this.handleAuthCallback(params));
      },

      // Solicitar recuperação de senha
      forgotPassword: rxMethod<ForgotPasswordRequest>(
        pipe(
          switchMap((request) => {
            store.loggingService.info('Password reset requested', { e: request.email });

            // Limita frequência de solicitações
            const key = `forgot_${request.email}`;
            let lastRequest = '';

            if (store.isBrowser) {
              lastRequest = store.localStorageService.getItem(key) || '';
            }

            if (lastRequest) {
              const lastTime = parseInt(lastRequest, 10);
              const now = Date.now();

              // Limita a 1 solicitação a cada 10 minutos
              if (now - lastTime < 600000) {
                // 10 minutos
                // Registra evento de segurança
                store.securityMonitor?.logSecurityEvent('auth.password_reset_throttled', 'warning', { email: request.email });

                return store.trackCall(
                  'forgotPassword',
                  store.authService.simulateDelayedError(new Error('Please wait before requesting another password reset')),
                );
              }
            }

            // Salva timestamp da solicitação
            if (store.isBrowser) {
              store.localStorageService.setItem(key, Date.now().toString());
            }

            return store.trackCall('forgotPassword', store.authService.forgotPasswordRequest(request), {
              onSuccess: () => {
                store.loggingService.info('Password reset email sent', { e: request.email });
                return true;
              },
              onError: (error: any) => {
                store.loggingService.error('Password reset request failed', { e: request.email, m: error.message });
                return false;
              },
            });
          }),
        ),
      ),

      // Versão Observable de forgotPassword para compatibilidade
      forgotPassword$(request: ForgotPasswordRequest): Observable<any> {
        return toObservable(this.forgotPassword(request));
      },

      // Redefinir senha com token de recuperação
      resetPassword: rxMethod<ResetPasswordRequest>(
        pipe(
          switchMap((request) => {
            store.loggingService.debug('Processing password reset with token');

            return store.trackCall('resetPassword', store.authService.resetPasswordRequest(request), {
              onSuccess: () => {
                store.loggingService.info('Password reset successful');
                return true;
              },
              onError: (error: any) => {
                store.loggingService.error('Password reset failed', { m: error.message });
                return false;
              },
            });
          }),
        ),
      ),

      // Versão Observable de resetPassword para compatibilidade
      resetPassword$(request: ResetPasswordRequest): Observable<any> {
        return toObservable(this.resetPassword(request));
      },

      // Alterar senha do usuário logado
      changePassword: rxMethod<ChangePasswordRequest>(
        pipe(
          switchMap((request) => {
            store.loggingService.debug('Processing password change for authenticated user');

            return store.trackCall('changePassword', store.authService.changePasswordRequest(request), {
              onSuccess: () => {
                store.loggingService.info('Password change successful');
                return true;
              },
              onError: (error: any) => {
                store.loggingService.error('Password change failed', { m: error.message });
                return false;
              },
            });
          }),
        ),
      ),

      // Versão Observable de changePassword para compatibilidade
      changePassword$(request: ChangePasswordRequest): Observable<any> {
        return toObservable(this.changePassword(request));
      },

      // Delegação para RoleStore das verificações de permissão
      hasRole(moduleId: string, roleName: string) {
        return store.roleStore.hasRole(moduleId, roleName);
      },

      // Versão síncrona
      hasRoleSync(moduleId: string, roleName: string): boolean {
        const user = store.user();
        return store.roleStore.hasRoleSync(user, moduleId, roleName);
      },

      // Verificação de permissões - DELEGADO PARA ROLESTORE
      checkUserHasPermissionForAction(moduleIdToCheck: string, permissionInput: string, actionToCheck: string): boolean {
        // Obter o usuário atual
        const user = store.user();
        if (!user) return false;

        return store.roleStore.checkUserHasPermissionForAction(user, moduleIdToCheck, permissionInput, actionToCheck);
      },

      // Papel mais alto em módulo
      getHighestRoleInModuleSync(moduleId: string): string | null {
        return store.roleStore.getHighestRoleInModuleSync(moduleId);
      },

      // Método auxiliar para redirecionamento após login
      redirectAfterLogin(): void {
        const returnUrl = redirectHelpers.getReturnUrl(store.localStorageService, store.authConfigService);
        store.loggingService.debug('AuthStore: Redirecting after login', { returnUrl });
        store.router.navigateByUrl(returnUrl);
        redirectHelpers.clearReturnUrl(store.localStorageService);
      },

      // Método auxiliar para redirecionamento após logout
      redirectAfterLogout(): void {
        const redirectPath = store.authConfigService.config()?.redirectAfterLogout || '/login';
        store.loggingService.debug('AuthStore: Redirecting after logout', { redirectPath });
        store.router.navigateByUrl(redirectPath);
      },

      // Método para converter um Signal para Observable quando necessário
      signalToObservable<T>(signal: Signal<T>): Observable<T> {
        return toObservable(signal);
      },
    };
    return methods;
  }),
);
