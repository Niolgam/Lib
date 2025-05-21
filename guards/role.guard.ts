import { inject } from '@angular/core';
import { Router, CanActivateFn, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router';
import { Observable, of, switchMap, map, filter, take, catchError, first } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
import { LoggingService } from '@vai/services';
import { AuthConfigService, AuthService } from '../services';
import { AuthStore, RoleStore } from '@auth/data-access';

type AuthStoreType = InstanceType<typeof AuthStore>;

export const roleGuard: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree => {
  const authStore = inject(AuthStore);
  const roleStore = inject(RoleStore); // Injetar RoleStore centralizado
  const router = inject(Router);
  const loggingService = inject(LoggingService);
  const authConfigService = inject(AuthConfigService);

  const config = authConfigService.config(); // Leitura do signal
  const requiredRole = route.data['role'] as string;
  const moduleId = route.data['moduleId'] as string;
  const exactRoleMatch = (route.data['exactRoleMatch'] as boolean) || false;
  const accessDeniedRoutePath = (route.data['accessDeniedRoute'] as string) || config?.accessDeniedRoute || '/access-denied';
  const loginRoutePath = config?.redirectAfterLogout || '/login';

  if (!requiredRole || !moduleId) {
    loggingService.warn('RoleGuard: No required role or moduleId specified.', { url: state.url });
    return true;
  }

  if (!authStore.isAuthenticated()) {
    loggingService.warn('RoleGuard: User not authenticated, redirecting to login.', { url: state.url });
    localStorage.setItem('auth_return_url', state.url);
    return router.createUrlTree([loginRoutePath]);
  }

  if (authStore.currentUser()) {
    return checkUserRoleLogic(authStore, roleStore, requiredRole, moduleId, exactRoleMatch, state.url, router, accessDeniedRoutePath, loggingService);
  }

  loggingService.debug('RoleGuard: User authenticated, loading user data for role check.', { url: state.url });
  authStore.loadUser();

  return toObservable(authStore.currentUser).pipe(
    first((user) => !!user),
    map(() =>
      checkUserRoleLogic(authStore, roleStore, requiredRole, moduleId, exactRoleMatch, state.url, router, accessDeniedRoutePath, loggingService),
    ),
    catchError(() => {
      loggingService.error('RoleGuard: Error or timeout loading user for role check.');
      return of(router.createUrlTree([accessDeniedRoutePath]));
    }),
  );
};

/**
 * Helper function to check if user has required role
 * Agora usando o RoleStore centralizado
 */
function checkUserRoleLogic(
  authStore: any,
  roleStore: any,
  requiredRole: string,
  moduleId: string,
  exactRoleMatch: boolean,
  url: string,
  router: Router,
  accessDeniedRoutePath: string,
  loggingService: LoggingService,
): boolean | UrlTree {
  const user = authStore.currentUser();

  if (!user) {
    loggingService.warn('RoleGuard: No user data for role check.', { url });
    return router.createUrlTree([accessDeniedRoutePath]);
  }

  // Usar RoleStore para verificar se o usuário tem papel de admin global
  if (roleStore.hasRoleSync(user, 'core', 'admin')) {
    loggingService.debug('RoleGuard: Access granted (global admin).', { url });
    return true;
  }

  let hasAccess = false;
  if (exactRoleMatch) {
    // Usar RoleStore para verificação exata de papel
    hasAccess = roleStore.hasRoleSync(user, moduleId, requiredRole);
  } else {
    // Obter o papel mais alto do módulo do usuário
    const userHighestRoleName = roleStore.getHighestRoleInModuleSync(moduleId);
    if (userHighestRoleName) {
      // Obter a hierarquia de papéis
      const roleHierarchy = authStore.authConfigService.roleHierarchy();
      const userLevel = roleHierarchy[userHighestRoleName] || 0;
      const requiredLevel = roleHierarchy[requiredRole] || 0;
      hasAccess = userLevel >= requiredLevel;
    }
  }

  if (hasAccess) {
    loggingService.debug('RoleGuard: Access granted.', { url, moduleId, requiredRole });
    return true;
  }

  loggingService.warn('RoleGuard: Access denied, insufficient role.', { url, moduleId, requiredRole });
  return router.createUrlTree([accessDeniedRoutePath]);
}
