import { inject } from '@angular/core';
import { CanActivateFn, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree, Router } from '@angular/router';
import { LoggingService } from '@vai/services';
import { Observable } from 'rxjs';
import { AuthConfigService } from '../services';
import { AuthStore, RoleStore } from '@auth/data-access';

export const permissionGuard: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
): Observable<boolean | UrlTree> | boolean | UrlTree => {
  const authStore = inject(AuthStore);
  const roleStore = inject(RoleStore); // Injetar RoleStore centralizado
  const router = inject(Router);
  const loggingService = inject(LoggingService);
  const authConfigService = inject(AuthConfigService);

  const config = authConfigService.config();
  const requiredPermission = route.data['permission'] as string;
  let moduleId = route.data['moduleId'] as string;
  const action = (route.data['action'] as string) || 'view';
  const accessDeniedRoutePath = config?.accessDeniedRoute || '/access-denied';
  const loginRoutePath = config?.redirectAfterLogout || '/login';

  if (!requiredPermission) {
    loggingService.warn('PermissionGuard: No required permission specified.', { url: state.url });
    return true;
  }

  if (!moduleId && requiredPermission.includes(':')) moduleId = requiredPermission.split(':')[0];
  if (!moduleId) {
    loggingService.error('PermissionGuard: ModuleId required and not determined.', { requiredPermission });
    return router.createUrlTree([accessDeniedRoutePath]);
  }

  if (!authStore.isAuthenticated()) {
    loggingService.warn('PermissionGuard: User not authenticated, redirecting to login.', { url: state.url });
    localStorage.setItem('auth_return_url', state.url);
    return router.createUrlTree([loginRoutePath]);
  }

  // Obter o usuário atual
  const user = authStore.currentUser();
  if (!user) {
    loggingService.warn('PermissionGuard: No user data available.', { url: state.url });
    return router.createUrlTree([loginRoutePath]);
  }

  // Usar o RoleStore centralizado para verificar a permissão
  const hasPermission = roleStore.checkUserHasPermissionForAction(user, moduleId, requiredPermission, action);

  if (hasPermission) {
    loggingService.debug('PermissionGuard: Access granted', {
      url: state.url,
      moduleId,
      permission: requiredPermission,
      action,
    });
    return true;
  }

  loggingService.warn('PermissionGuard: Access denied', {
    url: state.url,
    moduleId,
    permission: requiredPermission,
    action,
  });
  return router.createUrlTree([accessDeniedRoutePath]);
};
