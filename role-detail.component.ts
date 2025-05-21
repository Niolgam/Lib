import { Component, OnInit, inject, signal, computed, effect, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';

import { RoleStore, AuthStore } from '@auth/data-access';
import { LoggingService } from '@vai/services';
import { Role, Module, Permission, RolePermissionAssignment } from '@auth/data-access';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'role-detail',
  imports: [CommonModule],
  templateUrl: './role-detail.component.html',
  styleUrls: ['./role-detail.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoleDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private roleStore = inject(RoleStore);
  private authStore = inject(AuthStore);
  private loggingService = inject(LoggingService);

  // Signal para o ID do papel atual
  private readonly roleIdState = signal<string | null>(null);

  // Computed signals para dados do papel
  readonly role = computed(() => {
    const roleId = this.roleIdState();
    return roleId ? this.roleStore.getRoleByIdSync(roleId) : null;
  });

  readonly module = computed(() => {
    const currentRole = this.role();
    return currentRole ? this.roleStore.getModuleByIdSync(currentRole.moduleId) : null;
  });

  readonly permissions = computed(() => {
    const currentRole = this.role();
    if (!currentRole || !currentRole.permissionAssignments) return [];

    // Busca as permissões completas baseadas nos IDs
    return currentRole.permissionAssignments
      .map((assignment) => {
        const permission = this.roleStore.permissions().find((p) => p.id === assignment.permissionId);
        return {
          permission,
          assignment,
        };
      })
      .filter((item) => item.permission);
  });

  readonly isLoading = computed(() => this.roleStore.isLoadingKey(`role-${this.roleIdState()}`));

  readonly canEdit = computed(() => this.authStore.checkUserHasPermissionForAction('roles', 'update', 'update'));

  readonly canDelete = computed(() => {
    const currentRole = this.role();
    return currentRole && !currentRole.isSystemRole && this.authStore.checkUserHasPermissionForAction('roles', 'delete', 'delete');
  });

  readonly canManagePermissions = computed(() => this.authStore.checkUserHasPermissionForAction('roles', 'permissions', 'update'));

  // Estatísticas do papel
  readonly stats = computed(() => {
    const perms = this.permissions();
    const currentRole = this.role();

    if (!currentRole) return null;

    const totalActions = perms.reduce((total, item) => {
      const actions = Object.values(item.assignment.actions);
      return total + actions.filter((action) => action === true).length;
    }, 0);

    return {
      totalPermissions: perms.length,
      totalActions,
      createdAt: currentRole.createdAt,
      updatedAt: currentRole.updatedAt,
      isSystemRole: currentRole.isSystemRole,
      isActive: currentRole.isActive,
    };
  });

  // Permissions agrupadas por categoria/grupo
  readonly permissionsByGroup = computed(() => {
    const perms = this.permissions();
    const grouped = new Map<string, typeof perms>();

    perms.forEach((item) => {
      if (!item.permission) return;

      const group = item.permission.moduleId;
      if (!grouped.has(group)) {
        grouped.set(group, []);
      }
      grouped.get(group)!.push(item);
    });

    return grouped;
  });

  constructor() {
    // Effect para carregar o papel quando o ID muda
    effect(() => {
      const roleId = this.roleIdState();
      if (roleId) {
        this.loadRoleData(roleId);
      }
    });
  }

  ngOnInit(): void {
    const roleId = this.route.snapshot.paramMap.get('id');
    if (roleId) {
      this.roleIdState.set(roleId);
      this.loggingService.debug('RoleDetailComponent: Inicializando', { roleId });
    } else {
      this.loggingService.error('RoleDetailComponent: ID do papel não encontrado na rota');
      this.goBack();
    }
  }

  private loadRoleData(roleId: string): void {
    // Carrega o papel específico
    this.roleStore.loadRole(roleId);

    // Carrega módulos se não estiverem presentes
    if (this.roleStore.modules().length === 0) {
      this.roleStore.loadModules();
    }
  }

  editRole(): void {
    const roleId = this.roleIdState();
    if (roleId && this.canEdit()) {
      this.router.navigate(['/admin/roles', roleId, 'edit']);
    }
  }

  deleteRole(): void {
    const currentRole = this.role();
    if (!currentRole || !this.canDelete()) return;

    const confirmMessage = `Tem certeza que deseja excluir o papel "${currentRole.name}"?\n\nEsta ação não pode ser desfeita.`;

    if (confirm(confirmMessage)) {
      this.loggingService.debug('RoleDetailComponent: Excluindo papel', { roleId: currentRole.id });

      // Aqui devemos adicionar o método deleteRole no RoleStore
      // this.roleStore.deleteRole(currentRole.id);

      // Redireciona após exclusão
      this.router.navigate(['/admin/roles']);
    }
  }

  toggleRoleStatus(): void {
    const currentRole = this.role();
    if (!currentRole || !this.canEdit()) return;

    this.loggingService.debug('RoleDetailComponent: Alternando status do papel', {
      roleId: currentRole.id,
      currentStatus: currentRole.isActive,
    });

    // Aqui devemos adicionar o método updateRole no RoleStore
    // this.roleStore.updateRole({
    //   roleId: currentRole.id,
    //   data: { ...currentRole, isActive: !currentRole.isActive }
    // });
  }

  managePermissions(): void {
    const roleId = this.roleIdState();
    if (roleId && this.canManagePermissions()) {
      this.router.navigate(['/admin/roles', roleId, 'permissions']);
    }
  }

  goBack(): void {
    this.location.back();
  }

  goToRolesList(): void {
    this.router.navigate(['/admin/roles']);
  }

  getActionName(action: string): string {
    const actionNames: Record<string, string> = {
      view: 'Visualizar',
      create: 'Criar',
      update: 'Atualizar',
      delete: 'Excluir',
      approve: 'Aprovar',
      export: 'Exportar',
      import: 'Importar',
    };
    return actionNames[action] || action;
  }

  getActionColor(action: string): string {
    const actionColors: Record<string, string> = {
      view: 'bg-blue-100 text-blue-800',
      create: 'bg-green-100 text-green-800',
      update: 'bg-yellow-100 text-yellow-800',
      delete: 'bg-red-100 text-red-800',
      approve: 'bg-purple-100 text-purple-800',
      export: 'bg-indigo-100 text-indigo-800',
      import: 'bg-orange-100 text-orange-800',
    };
    return actionColors[action] || 'bg-gray-100 text-gray-800';
  }

  getModuleName(moduleId: string): string {
    const module = this.roleStore.getModuleByIdSync(moduleId);
    return module?.name || moduleId;
  }

  trackByPermissionId(index: number, item: { permission: Permission | undefined; assignment: RolePermissionAssignment }): string {
    return item.permission?.id || index.toString();
  }

  trackByGroupId(index: number, item: [string, any[]]): string {
    return item[0];
  }
}
