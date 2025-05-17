import { Directive, input, signal, effect, inject, Injector, TemplateRef, ViewContainerRef } from '@angular/core';
import { LoggingService } from '@vai/services'; // Ajuste o caminho
import { AuthStore, User } from '@auth/data-access';

@Directive({
  // eslint-disable-next-line @angular-eslint/directive-selector
  selector: '[hasPermission]',
  standalone: true,
})
export class HasPermissionDirective {
  permission = input<string>(''); // "roleName" ou "resource:permissionCode"
  moduleId = input<string>('');
  action = input<string>('view');

  private authStore = inject(AuthStore);
  private loggingService = inject(LoggingService);
  private templateRef = inject(TemplateRef<unknown>);
  private viewContainer = inject(ViewContainerRef);
  private injector = inject(Injector);
  // private authConfigService = inject(AuthConfigService); // Se for buscar roleHierarchy daqui

  private hasView = signal(false);
  // A hierarquia de papéis agora é lida do AuthStore (que a pega do AuthConfigService)
  // private roleHierarchy: Record<string, number> = { admin: 5, manager: 4, creator: 3, editor: 2, viewer: 1 };

  constructor() {
    effect(
      () => {
        const currentUser = this.authStore.currentUser(); // Signal<User | null>
        const permissionVal = this.permission();
        const moduleIdVal = this.moduleId();
        const actionVal = this.action();

        // Limpa a view se o usuário for nulo (deslogado) ou se as entradas mudarem e reavaliarem
        if (!currentUser) {
          this._updateView(false);
          return;
        }

        let hasAccess = false;
        // Se não há permissão específica (formato "resource:code"), usar a verificação de papel
        if (!permissionVal || !permissionVal.includes(':')) {
          hasAccess = this._checkRoleBasedPermission(currentUser, permissionVal, moduleIdVal, actionVal);
        } else {
          // Se há permissão específica, verificar permissão
          hasAccess = this._checkFineGrainedPermission(currentUser, permissionVal, moduleIdVal, actionVal);
        }
        this._updateView(hasAccess);
      },
      { injector: this.injector }, // injector é necessário se o effect for criado no construtor
    );
  }

  private _getRoleHierarchy(): Record<string, number> {
    // Assume que AuthStore expõe roleHierarchy (que ele pega do AuthConfigService)
    // Se AuthStore não expor, injete AuthConfigService aqui e use this.authConfigService.roleHierarchy()
    return this.authStore.authConfigService.roleHierarchy(); // Exemplo de acesso
  }

  private _checkRoleBasedPermission(
    user: User,
    requiredRoleName: string, // O input 'permission' é usado como nome do papel aqui
    moduleId: string,
    action: string, // Ação pode ser usada para lógica mais fina mesmo em modo de papel
  ): boolean {
    if (!requiredRoleName || !moduleId) {
      this.loggingService.debug('HasPermissionDirective: Role or ModuleId not provided for role check, defaulting to show.');
      return true; // Comportamento legado de mostrar se não especificado
    }

    // Admin Global
    // authStore.hasRoleSync já deve considerar o usuário atual do store
    if (this.authStore.hasRoleSync('core', 'admin')) return true;

    // Verifica usando a hierarquia de papéis
    // O AuthStore já tem getHighestRoleInModuleSync que usa a hierarquia
    const userHighestRole = this.authStore.getHighestRoleInModuleSync(moduleId);
    if (!userHighestRole) return false;

    const hierarchy = this._getRoleHierarchy();
    const userLevel = hierarchy[userHighestRole] || 0;
    const requiredLevel = hierarchy[requiredRoleName] || 0;

    // Adicionalmente, pode-se ter uma lógica de ação vs nível de papel aqui,
    // similar à sua implementação original de userHasPermission.
    // Exemplo: se requiredRoleName for 'editor', e action for 'delete', pode falhar mesmo se o nível for >=.
    // Por ora, focando na hierarquia de papel principal:
    return userLevel >= requiredLevel;
  }

  private _checkFineGrainedPermission(
    user: User,
    permissionCode: string, // Ex: "users:create" ou "VIEW_REPORTS"
    moduleId: string, // Módulo de contexto
    action: string, // Ação específica: "create", "view"
  ): boolean {
    let targetModuleId = moduleId;
    let targetPermissionCode = permissionCode;

    // Se moduleId não fornecido na diretiva e permissionCode é "recurso:codigo", extrai o recurso
    if (!targetModuleId && permissionCode.includes(':')) {
      const parts = permissionCode.split(':');
      targetModuleId = parts[0]; // "users"
      // targetPermissionCode pode ser mantido como "users:create" ou só "create"
      // Depende de como seu método no AuthStore espera.
    }

    if (!targetModuleId) {
      this.loggingService.warn('HasPermissionDirective: ModuleId could not be determined for specific permission check.', { permissionCode });
      return false;
    }

    // Admin Global
    if (this.authStore.hasRoleSync('core', 'admin')) return true;

    // CHAMA UM MÉTODO NO AUTHSTORE QUE VOCÊ PRECISARÁ IMPLEMENTAR
    // Este método no AuthStore precisaria:
    // 1. Pegar user.roles (que são UserRole[])
    // 2. Para cada UserRole, buscar as definições do Role no RoleStore (incluindo RolePermissionAssignment[])
    // 3. Verificar se alguma combinação permite a 'permissionCode' com a 'action' no 'targetModuleId'.
    const hasPermission = this.authStore.checkUserHasPermissionForAction(targetModuleId, targetPermissionCode, action);
    if (!hasPermission) {
      this.loggingService.debug('HasPermissionDirective: Access denied by AuthStore.checkUserHasPermissionForAction', {
        userId: user.id,
        targetModuleId,
        targetPermissionCode,
        action,
      });
    }
    return hasPermission;
  }

  private _updateView(hasAccess: boolean): void {
    if (hasAccess && !this.hasView()) {
      this.viewContainer.createEmbeddedView(this.templateRef);
      this.hasView.set(true);
    } else if (!hasAccess && this.hasView()) {
      this.viewContainer.clear();
      this.hasView.set(false);
    }
  }
}
