import { inject } from '@angular/core';
import { Router, CanActivateFn, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router';
import { Observable, of } from 'rxjs';
import { map, switchMap, catchError, first, tap } from 'rxjs/operators';
import { toObservable } from '@angular/core/rxjs-interop';

import { LoggingService } from '@vai/services';
import { AuthService, AuthConfigService } from '../services';
import { AuthStore } from '@auth/data-access';

export const authGuard: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
): Observable<boolean | UrlTree> | boolean | UrlTree => {
  const authStore = inject(AuthStore); // Instância do seu signalStore
  const router = inject(Router);
  const loggingService = inject(LoggingService);
  const authConfigService = inject(AuthConfigService);

  const config = authConfigService.config(); // Lê o valor do signal (snapshot)

  const redirectUrlPath = (route.data['redirectUrl'] as string) || config?.redirectAfterLogout || '/login';
  const skipRedirect = (route.data['skipRedirect'] as boolean) || false;
  const requireUserLoaded = route.data['requireUserLoaded'] === true;

  if (!skipRedirect && state.url !== '/' && state.url !== redirectUrlPath && state.url !== (config?.loginRoute || '/login')) {
    loggingService.debug('AuthGuard: Storing return URL', { returnUrl: state.url });
    localStorage.setItem('auth_return_url', state.url);
  }

  const redirectToLogin = (): UrlTree => {
    loggingService.warn('AuthGuard: Access denied, redirecting to login.', { targetUrl: state.url, redirectPath: redirectUrlPath });
    if (redirectUrlPath === (config?.loginRoute || '/login')) {
      localStorage.removeItem('auth_return_url');
    }
    return router.createUrlTree([redirectUrlPath]);
  };

  if (authStore.isAuthenticated()) {
    // Lê o signal isAuthenticated do AuthStore
    loggingService.debug('AuthGuard: Authenticated (AuthStore signal).', { url: state.url });
    if (requireUserLoaded && !authStore.currentUser()) {
      // Lê o signal currentUser do AuthStore
      loggingService.debug('AuthGuard: User required but not in store, triggering loadUser and waiting.');
      authStore.loadUser(); // Dispara o rxMethod
      return toObservable(authStore.currentUser).pipe(
        first((user) => !!user),
        map((user) => !!user || (skipRedirect ? false : redirectToLogin())),
        catchError(() => {
          loggingService.error('AuthGuard: Error loading user after initial auth check.');
          return of(skipRedirect ? false : redirectToLogin());
        }),
      );
    }
    return true;
  }

  // Lógica de refresh removida daqui, pois AuthInterceptor e AuthService.verifyAuthStatus no construtor já cuidam disso.
  // Se authStore.isAuthenticated() é false, é o estado final após essas tentativas.
  loggingService.warn('AuthGuard: Not authenticated (AuthStore signal). Redirecting.', { url: state.url });
  return skipRedirect ? false : redirectToLogin();
};
