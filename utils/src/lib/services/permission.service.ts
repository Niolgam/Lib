import { Injectable, inject } from '@angular/core';
import { computed, Signal } from '@angular/core';
import { AuthStore, RoleStore, PermissionAction, User, Permission } from '@auth/data-access';
import { LoggingService } from '@vai/services';

@Injectable({
  providedIn: 'root',
})
export class PermissionService {
  private readonly authStore = inject(AuthStore);
  private readonly roleStore = inject(RoleStore);
  private readonly loggingService = inject(LoggingService);

  // Hierarquia de papéis
  private _getRoleHierarchy(): Record<string, number> {
    return this.authStore.authConfigService.roleHierarchy();
  }

  /**
   * Verifica se o usuário atual tem uma determinada permissão
   * @param moduleId ID do módulo
   * @param permissionInput Código da permissão ou formato "recurso:codigo"
   * @param actionToCheck Ação a verificar (view, create, update, delete, etc)
   * @returns Signal<boolean> indicando se o usuário tem a permissão
   */
  hasPermission(moduleId: string, permissionInput: string, actionToCheck: keyof PermissionAction | string): Signal<boolean> {
    return computed(() => {
      const user = this.authStore.currentUser();
      if (!user) return false;

      return this.checkUserHasPermission(user, moduleId, permissionInput, actionToCheck);
    });
  }

  /**
   * Versão síncrona da verificação de permissão
   */
  hasPermissionSync(moduleId: string, permissionInput: string, actionToCheck: keyof PermissionAction | string): boolean {
    return this.hasPermission(moduleId, permissionInput, actionToCheck)();
  }

  /**
   * Verifica se o usuário tem um papel específico
   * @param moduleId ID do módulo
   * @param roleName Nome do papel
   * @param exactMatch Verificação exata (true) ou baseada em hierarquia (false)
   * @returns Signal<boolean> indicando se o usuário tem o papel
   */
  hasRole(moduleId: string, roleName: string, exactMatch: boolean = false): Signal<boolean> {
    return computed(() => {
      // Admin global sempre tem acesso
      if (this.authStore.hasRoleSync('core', 'admin')) return true;

      const user = this.authStore.currentUser();
      if (!user?.roles) return false;

      if (exactMatch) {
        return user.roles.some((r) => r.moduleId === moduleId && r.role === roleName);
      } else {
        const hierarchy = this._getRoleHierarchy();
        const requiredLevel = hierarchy[roleName] || 0;

        // Verificar o papel mais alto do usuário no módulo
        return user.roles
          .filter((r) => r.moduleId === moduleId)
          .some((r) => {
            const roleLevel = hierarchy[r.role] || 0;
            return roleLevel >= requiredLevel;
          });
      }
    });
  }

  /**
   * Versão síncrona da verificação de papel
   */
  hasRoleSync(moduleId: string, roleName: string, exactMatch: boolean = false): boolean {
    return this.hasRole(moduleId, roleName, exactMatch)();
  }

  /**
   * Implementação detalhada da verificação de permissão
   * @param user Objeto usuário
   * @param moduleIdToCheck ID do módulo
   * @param permissionInput Código da permissão
   * @param actionToCheck Ação a verificar
   * @returns boolean indicando se o usuário tem a permissão
   */
  checkUserHasPermission(user: User, moduleIdToCheck: string, permissionInput: string, actionToCheck: keyof PermissionAction | string): boolean {
    if (!user?.roles || user.roles.length === 0) {
      return false;
    }

    // Verificar admin global primeiro (caso comum de fast-path)
    const isGlobalAdmin = user.roles.some((r) => r.moduleId === 'core' && r.role === 'admin');
    if (isGlobalAdmin) return true;

    // Filtrar papéis apenas do módulo relevante
    const moduleRoles = user.roles.filter((r) => r.moduleId === moduleIdToCheck);
    if (moduleRoles.length === 0) return false;

    // Analisar input de permissão
    let targetModuleId = moduleIdToCheck;
    let permissionCode = permissionInput;

    if (permissionInput.includes(':')) {
      const [moduleFromInput, code] = permissionInput.split(':');
      targetModuleId = moduleFromInput;
      permissionCode = code;
    }

    // Buscar permissão
    const permission = this.findPermissionByCode(targetModuleId, permissionCode);
    if (!permission) return false;

    // Verificar se algum papel do usuário tem a permissão
    for (const userRole of moduleRoles) {
      const role = this.roleStore.getRoleByIdSync(userRole.role);
      if (!role) continue;

      // Verificar cada atribuição de permissão do papel
      for (const assignment of role.permissionAssignments || []) {
        if (assignment.permissionId === permission.id) {
          // Verificar se a ação específica é permitida
          if (assignment.actions[actionToCheck as keyof PermissionAction]) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Busca permissão por código e módulo
   */
  findPermissionByCode(moduleId: string, permissionCode: string): Permission | null {
    const permissions = this.roleStore.permissions();
    return permissions.find((p) => p.moduleId === moduleId && p.code === permissionCode) || null;
  }

  /**
   * Verifica acesso a uma rota protegida
   */
  checkRouteAccess(routeData: { permission?: string; moduleId?: string; action?: string; role?: string; exactRoleMatch?: boolean }): Signal<boolean> {
    return computed(() => {
      const user = this.authStore.currentUser();
      if (!user) return false;

      // Admin global sempre tem acesso
      if (user.roles.some((r) => r.moduleId === 'core' && r.role === 'admin')) {
        return true;
      }

      // Verificar com base no tipo de proteção da rota
      if (routeData.permission && routeData.moduleId) {
        return this.checkUserHasPermission(user, routeData.moduleId, routeData.permission, routeData.action || 'view');
      } else if (routeData.role && routeData.moduleId) {
        return this.hasRoleSync(routeData.moduleId, routeData.role, routeData.exactRoleMatch);
      }

      return false;
    });
  }
}
