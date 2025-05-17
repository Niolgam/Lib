import { inject } from '@angular/core';
import { CanActivateFn, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree, Router } from '@angular/router';
import { LoggingService } from '@vai/services';
import { Observable } from 'rxjs';
import { PermissionService, AuthConfigService } from '../services';
import { AuthStore } from '@auth/data-access';

export const permissionGuard: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
): Observable<boolean | UrlTree> | boolean | UrlTree => {
  const authStore = inject(AuthStore);
  const permissionService = inject(PermissionService);
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

  const hasPermission = permissionService.hasPermissionSync(moduleId, requiredPermission, action);

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
