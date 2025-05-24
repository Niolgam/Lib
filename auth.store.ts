import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { computed } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState, withProps } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap, catchError, finalize, of } from 'rxjs';

import { withCallState, withImmutableState } from '@vai/store-feature';
import { LocalStorageService, LoggingService } from '@vai/services';
import {
  AuthService,
  AuthConfigService,
  TokenService,
  CsrfService,
  SecurityMonitorService,
  PermissionService,
  createRoleCheckHelpers,
  createAuthRateLimitingHelpers,
  createAuthTokenHelpers,
  createAuthRedirectHelpers,
  AuthErrorService,
} from '@auth/utils';
import {
  User,
  LoginCredentials,
  AuthToken,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  ChangePasswordRequest,
  SignupRequestPayload,
} from './models';

// Estado da store
interface AuthStoreState {
  currentUser: User | null;
  isInitialized: boolean;
  loginAttempts: Map<string, { count: number; lastAttempt: number }>;
  returnUrl: string;
  refreshTokenTimerId: number | null;
  lastLoginTime: number | null;
  lastRefreshTime: number | null;
  rememberUser: boolean;
}

const initialState: AuthStoreState = {
  currentUser: null,
  isInitialized: false,
  loginAttempts: new Map(),
  returnUrl: '',
  refreshTokenTimerId: null,
  lastLoginTime: null,
  lastRefreshTime: null,
  rememberUser: false,
};

export const AuthStore = signalStore(
  withState(initialState),
  withCallState(),
  withImmutableState(),
  withProps(() => ({
    authService: inject(AuthService),
    authConfigService: inject(AuthConfigService),
    tokenService: inject(TokenService),
    csrfService: inject(CsrfService),
    localStorageService: inject(LocalStorageService),
    loggingService: inject(LoggingService),
    securityMonitorService: inject(SecurityMonitorService),
    permissionService: inject(PermissionService),
    router: inject(Router),
    isBrowser: isPlatformBrowser(inject(PLATFORM_ID)),
  })),
  withComputed((store) => ({
    isAuthenticated: computed(() => {
      const token = store.tokenService.token();
      const isValid = store.tokenService.isAuthenticated();
      return !!token && isValid;
    }),
    config: computed(() => store.authConfigService.config()),
    isFullyInitialized: computed(() => store.isInitialized() && store.tokenService.token() !== null),
    currentToken: computed(() => store.tokenService.token()),
    decodedToken: computed(() => store.tokenService.decodedToken()),
    currentUserId: computed(() => store.tokenService.userId()),
    currentUserRoles: computed(() => store.tokenService.userRoles()),
    isTokenExpiringSoon: computed(() => store.tokenService.isTokenExpiringSoon()),
    isLoginBlocked: computed(() => {
      const attempts = store.loginAttempts();
      const maxAttempts = store.authConfigService.maxLoginAttempts();
      const blockDuration = store.authConfigService.loginBlockDuration();

      return Array.from(attempts.values()).some((attempt) => {
        const now = Date.now();
        const timeSinceLastAttempt = now - attempt.lastAttempt;
        return attempt.count >= maxAttempts && timeSinceLastAttempt < blockDuration;
      });
    }),
    roleHelpers: computed(() => {
      const user = store.currentUser();
      return createRoleCheckHelpers({ user: () => user });
    }),
    userName: computed(() => store.currentUser()?.name || ''),
    userEmail: computed(() => store.currentUser()?.email || ''),
    sessionAge: computed(() => {
      const loginTime = store.lastLoginTime();
      return loginTime ? Date.now() - loginTime : 0;
    }),
    timeSinceLastRefresh: computed(() => {
      const refreshTime = store.lastRefreshTime();
      return refreshTime ? Date.now() - refreshTime : 0;
    }),
  })),

  // Métodos
  withMethods((store) => {
    // Helpers auxiliares
    const rateLimitHelpers = createAuthRateLimitingHelpers(store);
    const tokenHelpers = createAuthTokenHelpers(store);
    const redirectHelpers = createAuthRedirectHelpers(store, store.isBrowser);

    const methods = {
      // === INICIALIZAÇÃO ===
      initialize: rxMethod<void>(
        pipe(
          tap(() => {
            store.loggingService.debug('AuthStore: Initializing authentication state');
          }),
          switchMap(() => {
            // Verificar se há token armazenado
            const token = store.tokenService.token();

            if (token && store.tokenService.isAuthenticated()) {
              // Token válido existe, carregar dados do usuário
              return methods.loadUser$();
            } else {
              // Sem token válido, verificar status no servidor
              return methods.verifyAuthStatus$();
            }
          }),
          tap(() => {
            patchState(store, { isInitialized: true });
            store.loggingService.debug('AuthStore: Initialization completed');

            // Configurar refresh automático se autenticado
            if (store.isAuthenticated()) {
              tokenHelpers.scheduleTokenRefresh(store.tokenService, store.authConfigService, store.loggingService, () => methods.refreshToken$());
            }
          }),
          catchError((error) => {
            store.loggingService.error('AuthStore: Initialization failed', { error });
            patchState(store, { isInitialized: true });
            return of(null);
          }),
        ),
      ),

      // === AUTENTICAÇÃO ===

      login$: rxMethod<LoginCredentials>(
        pipe(
          tap((credentials) => {
            store.loggingService.debug('AuthStore: Login attempt', { username: credentials.username });

            // Registrar tentativa de login
            rateLimitHelpers.registerLoginAttempt(credentials.username, store.authConfigService);

            // Verificar rate limiting
            if (rateLimitHelpers.isLoginRateLimited(credentials.username, store.authConfigService)) {
              throw new Error('Login temporariamente bloqueado devido a muitas tentativas');
            }
          }),
          switchMap((credentials) => {
            const operationKey = `login_${credentials.username}`;

            return store.trackCall(operationKey, store.authService.loginRequest(credentials), {
              onSuccess: (token: AuthToken) => {
                // Armazenar token
                store.tokenService.storeToken(token, credentials.rememberMe);

                // Resetar tentativas de login
                rateLimitHelpers.resetLoginAttempts(credentials.username);

                // Atualizar estado
                patchState(store, {
                  lastLoginTime: Date.now(),
                  rememberUser: credentials.rememberMe || false,
                });

                // Registrar evento de segurança
                store.securityMonitorService.logLoginAttempt(credentials.username, true);

                // Carregar dados do usuário
                methods.loadUser$();

                // Configurar refresh de token
                tokenHelpers.scheduleTokenRefresh(store.tokenService, store.authConfigService, store.loggingService, () => methods.refreshToken$());

                store.loggingService.info('AuthStore: Login successful', { username: credentials.username });
              },
              onError: (error: any) => {
                // Incrementar tentativas de login
                rateLimitHelpers.incrementLoginAttempts(credentials.username);

                // Registrar evento de segurança
                store.securityMonitorService.logLoginAttempt(credentials.username, false);

                // Processar erro
                const authError = AuthErrorService.parseAuthError(error);
                store.loggingService.warn('AuthStore: Login failed', {
                  username: credentials.username,
                  reason: authError.reason,
                  message: authError.message,
                });

                throw error;
              },
            });
          }),
        ),
      ),

      logout$: rxMethod<void>(
        pipe(
          tap(() => {
            store.loggingService.debug('AuthStore: Logout initiated');
          }),
          switchMap(() => {
            const operationKey = 'logout';

            return store.trackCall(operationKey, store.authService.logoutRequest(), {
              onSuccess: () => {
                store.loggingService.info('AuthStore: Logout successful');
              },
              onError: (error: any) => {
                store.loggingService.warn('AuthStore: Logout request failed, clearing local state anyway', { error });
              },
            });
          }),
          finalize(() => {
            // Sempre limpar estado local, independente do resultado do servidor
            methods.clearAuthState();
            redirectHelpers.redirectAfterLogout(store.router, store.authConfigService);
          }),
        ),
      ),

      refreshToken$: rxMethod<void>(
        pipe(
          tap(() => {
            store.loggingService.debug('AuthStore: Refreshing token');
          }),
          switchMap(() => {
            const operationKey = 'refreshToken';

            return store.trackCall(operationKey, store.authService.refreshTokenRequest(), {
              onSuccess: (newToken: AuthToken) => {
                // Armazenar novo token
                store.tokenService.storeToken(newToken, store.rememberUser());

                // Atualizar estado
                patchState(store, { lastRefreshTime: Date.now() });

                // Reagendar próximo refresh
                tokenHelpers.scheduleTokenRefresh(store.tokenService, store.authConfigService, store.loggingService, () => methods.refreshToken$());

                store.loggingService.debug('AuthStore: Token refreshed successfully');
              },
              onError: (error: any) => {
                store.loggingService.error('AuthStore: Token refresh failed', { error });

                // Se falha no refresh, fazer logout
                methods.clearAuthState();
                redirectHelpers.redirectAfterLogout(store.router, store.authConfigService);

                throw error;
              },
            });
          }),
        ),
      ),

      // === GERENCIAMENTO DE USUÁRIO ===

      loadUser$: rxMethod<void>(
        pipe(
          switchMap(() => {
            const operationKey = 'loadUser';

            return store.trackCall(operationKey, store.authService.fetchUserDataRequest(), {
              onSuccess: (user: User) => {
                patchState(store, { currentUser: user });
                store.loggingService.debug('AuthStore: User data loaded', { userId: user.id });
              },
              onError: (error: any) => {
                store.loggingService.error('AuthStore: Failed to load user data', { error });
                throw error;
              },
            });
          }),
        ),
      ),

      verifyAuthStatus$: rxMethod<void>(
        pipe(
          switchMap(() => {
            const operationKey = 'verifyAuthStatus';

            return store.trackCall(operationKey, store.authService.verifyAuthStatusRequest(), {
              onSuccess: (isAuthenticated: boolean) => {
                if (isAuthenticated) {
                  // Se autenticado no servidor, carregar dados do usuário
                  methods.loadUser$();
                } else {
                  // Não autenticado, limpar estado local
                  methods.clearAuthState();
                }

                store.loggingService.debug('AuthStore: Auth status verified', { isAuthenticated });
              },
              onError: (error: any) => {
                store.loggingService.warn('AuthStore: Failed to verify auth status', { error });
                // Em caso de erro, assumir não autenticado
                methods.clearAuthState();
              },
            });
          }),
        ),
      ),

      // === GERENCIAMENTO DE SENHA ===

      forgotPassword$: rxMethod<ForgotPasswordRequest>(
        pipe(
          switchMap((request) => {
            const operationKey = 'forgotPassword';

            return store.trackCall(operationKey, store.authService.forgotPasswordRequest(request), {
              onSuccess: () => {
                store.loggingService.info('AuthStore: Forgot password request sent', { email: request.email });
              },
            });
          }),
        ),
      ),

      resetPassword$: rxMethod<ResetPasswordRequest>(
        pipe(
          switchMap((request) => {
            const operationKey = 'resetPassword';

            return store.trackCall(operationKey, store.authService.resetPasswordRequest(request), {
              onSuccess: () => {
                store.loggingService.info('AuthStore: Password reset successful');
              },
            });
          }),
        ),
      ),

      changePassword$: rxMethod<ChangePasswordRequest>(
        pipe(
          switchMap((request) => {
            const operationKey = 'changePassword';

            return store.trackCall(operationKey, store.authService.changePasswordRequest(request), {
              onSuccess: () => {
                store.loggingService.info('AuthStore: Password changed successfully');
              },
            });
          }),
        ),
      ),

      // === REGISTRO DE USUÁRIO ===

      signup$: rxMethod<SignupRequestPayload>(
        pipe(
          switchMap((userData) => {
            const operationKey = 'signup';

            return store.trackCall(operationKey, store.authService.registerUserRequest(userData), {
              onSuccess: (user: User) => {
                store.loggingService.info('AuthStore: User registration successful', { userId: user.id });
              },
            });
          }),
        ),
      ),

      // === VERIFICAÇÕES DE PERMISSÃO ===

      hasRole(moduleId: string, roleName: string, exactMatch: boolean = false): boolean {
        const user = store.currentUser();
        if (!user?.roles) return false;

        // Admin global sempre tem acesso
        const roleHierarchy = store.authConfigService.roleHierarchy();
        const isGlobalAdmin = user.roles.some((r) => r.moduleId === 'core' && roleHierarchy[r.role] === roleHierarchy['admin']);

        if (isGlobalAdmin) return true;

        if (exactMatch) {
          return user.roles.some((r) => r.moduleId === moduleId && r.role === roleName);
        } else {
          const requiredLevel = roleHierarchy[roleName] || 0;
          return user.roles
            .filter((r) => r.moduleId === moduleId)
            .some((r) => {
              const roleLevel = roleHierarchy[r.role] || 0;
              return roleLevel >= requiredLevel;
            });
        }
      },

      hasRoleSync: (moduleId: string, roleName: string, exactMatch: boolean = false) => methods.hasRole(moduleId, roleName, exactMatch),

      hasPermission(moduleId: string, permissionCode: string, action: string = 'view'): boolean {
        const user = store.currentUser();
        if (!user) return false;

        return store.permissionService.checkUserHasPermission(user, moduleId, permissionCode, action);
      },

      hasPermissionSync: (moduleId: string, permissionCode: string, action: string = 'view') =>
        methods.hasPermission(moduleId, permissionCode, action),

      // === UTILITÁRIOS ===

      clearAuthState(): void {
        // Limpar tokens e CSRF
        tokenHelpers.clearAuthState(store.tokenService, store.csrfService);

        // Resetar estado da store
        patchState(store, {
          currentUser: null,
          returnUrl: '',
          lastLoginTime: null,
          lastRefreshTime: null,
          rememberUser: false,
        });

        // Limpar tentativas de login
        rateLimitHelpers.resetLoginAttempts('');

        store.loggingService.debug('AuthStore: Auth state cleared');
      },

      saveReturnUrl(url: string): void {
        redirectHelpers.saveReturnUrl(url, store.localStorageService);
      },

      getReturnUrl(): string {
        return redirectHelpers.getReturnUrl(store.localStorageService, store.authConfigService);
      },

      clearReturnUrl(): void {
        redirectHelpers.clearReturnUrl(store.localStorageService);
      },

      redirectAfterLogin(): void {
        redirectHelpers.redirectAfterLogin(store.router, store.localStorageService, store.authConfigService);
      },

      // === GETTERS SÍNCRONOS ===

      getCurrentUser(): User | null {
        return store.currentUser();
      },

      getCurrentUserId(): string | null {
        return store.currentUserId();
      },

      getIsAuthenticated(): boolean {
        return store.isAuthenticated();
      },

      getIsInitialized(): boolean {
        return store.isInitialized();
      },

      // === UTILITÁRIOS DE RATE LIMITING ===

      getLoginAttemptCount(username: string): number {
        return rateLimitHelpers.getLoginAttemptCount(username);
      },

      getRemainingBlockTime(username: string): number {
        return rateLimitHelpers.getRemainingBlockTime(username, store.authConfigService);
      },

      isUserBlocked(username: string): boolean {
        return rateLimitHelpers.isLoginRateLimited(username, store.authConfigService);
      },

      // === MÉTODOS DE CONTROLE DE SESSÃO ===

      extendSession(): void {
        if (store.isAuthenticated()) {
          methods.refreshToken$();
        }
      },

      checkSessionValidity(): boolean {
        const token = store.tokenService.token();
        if (!token) return false;

        const isValid = store.tokenService.isAuthenticated();
        const isExpiringSoon = store.tokenService.isTokenExpiringSoon();

        if (!isValid) {
          methods.clearAuthState();
          return false;
        }

        if (isExpiringSoon) {
          methods.refreshToken$();
        }

        return true;
      },
    };

    return methods;
  }),
);
