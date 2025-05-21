import { Component, OnInit, inject, signal, computed, effect, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { Router } from '@angular/router';

import { RoleStore, AuthStore } from '@auth/data-access';
import { LoggingService } from '@vai/services';
import { Permission, PermissionGroup, Module } from '@auth/data-access';

interface PermissionListFilters {
  moduleId: string | null;
  groupId: string | null;
  search: string;
}

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'permission-list',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './permission-list.component.html',
  styleUrls: ['./permission-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PermissionListComponent implements OnInit {
  private roleStore = inject(RoleStore);
  private authStore = inject(AuthStore);
  private loggingService = inject(LoggingService);
  private router = inject(Router);

  // Signals para filtros
  private readonly filtersState = signal<PermissionListFilters>({
    moduleId: null,
    groupId: null,
    search: '',
  });

  // Form controls para os filtros
  readonly moduleFilterControl = new FormControl<string | null>(null);
  readonly groupFilterControl = new FormControl<string | null>(null);
  readonly searchControl = new FormControl('');

  // Computed signals para lógica de negócio
  readonly modules = this.roleStore.activeModules;
  readonly permissions = this.roleStore.permissions;
  readonly permissionGroups = this.roleStore.permissionGroups;
  readonly isLoading = this.roleStore.isLoading;

  readonly filteredPermissions = computed(() => {
    const permissionsData = this.permissions();
    const filters = this.filtersState();
    let filtered = permissionsData;

    // Filtro por módulo
    if (filters.moduleId) {
      filtered = filtered.filter((permission) => permission.moduleId === filters.moduleId);
    }

    // Filtro por grupo
    if (filters.groupId) {
      const group = this.permissionGroups().find((g) => g.id === filters.groupId);
      if (group) {
        const groupPermissionIds = group.permissions.map((p) => p.id);
        filtered = filtered.filter((permission) => groupPermissionIds.includes(permission.id));
      }
    }

    // Filtro por busca textual
    if (filters.search) {
      const searchTerm = filters.search.toLowerCase();
      filtered = filtered.filter(
        (permission) =>
          permission.name.toLowerCase().includes(searchTerm) ||
          permission.description.toLowerCase().includes(searchTerm) ||
          permission.code.toLowerCase().includes(searchTerm),
      );
    }

    return filtered;
  });

  readonly permissionsByModule = computed(() => {
    const filtered = this.filteredPermissions();
    const grouped = new Map<string, Permission[]>();

    filtered.forEach((permission) => {
      const moduleId = permission.moduleId;
      if (!grouped.has(moduleId)) {
        grouped.set(moduleId, []);
      }
      grouped.get(moduleId)!.push(permission);
    });

    return grouped;
  });

  readonly permissionsByGroup = computed(() => {
    const filtered = this.filteredPermissions();
    const groups = this.permissionGroups();
    const grouped = new Map<string, Permission[]>();

    // Agrupa por grupos definidos
    groups.forEach((group) => {
      const groupPermissions = filtered.filter((p) => group.permissions.some((gp) => gp.id === p.id));
      if (groupPermissions.length > 0) {
        grouped.set(group.id, groupPermissions);
      }
    });

    // Adiciona permissões sem grupo
    const ungroupedPermissions = filtered.filter((p) => !groups.some((g) => g.permissions.some((gp) => gp.id === p.id)));

    if (ungroupedPermissions.length > 0) {
      grouped.set('ungrouped', ungroupedPermissions);
    }

    return grouped;
  });

  readonly availableGroups = computed(() => {
    const filters = this.filtersState();
    const groups = this.permissionGroups();

    if (filters.moduleId) {
      return groups.filter((g) => g.moduleId === filters.moduleId);
    }

    return groups;
  });

  readonly canViewPermissions = computed(() => this.authStore.checkUserHasPermissionForAction('permissions', 'view', 'view'));

  readonly canCreatePermissions = computed(() => this.authStore.checkUserHasPermissionForAction('permissions', 'create', 'create'));

  readonly canManageMatrix = computed(() => this.authStore.checkUserHasPermissionForAction('permissions', 'matrix', 'view'));

  // Statistics
  readonly stats = computed(() => {
    const filtered = this.filteredPermissions();
    const allPermissions = this.permissions();
    const modules = this.modules();

    return {
      total: allPermissions.length,
      filtered: filtered.length,
      byModule: modules.reduce(
        (acc, module) => {
          acc[module.id] = allPermissions.filter((p) => p.moduleId === module.id).length;
          return acc;
        },
        {} as Record<string, number>,
      ),
      groups: this.permissionGroups().length,
    };
  });

  // View state
  readonly viewMode = signal<'module' | 'group'>('module');

  constructor() {
    // Efeito para atualizar filtros quando os form controls mudam
    effect(() => {
      const moduleId = this.moduleFilterControl.value;
      const groupId = this.groupFilterControl.value;
      const search = this.searchControl.value || '';

      this.filtersState.set({
        moduleId,
        groupId,
        search,
      });
    });
  }

  ngOnInit(): void {
    this.loggingService.debug('PermissionListComponent: Inicializando');

    // Carrega módulos, permissões e grupos se necessário
    this.initializePermissions();
  }

  initializePermissions(): void {
    // Carrega módulos se não existirem
    if (this.modules().length === 0) {
      this.roleStore.loadModules();
    }

    // Efeito para carregar permissões quando módulos estiverem prontos
    effect(() => {
      const modules = this.modules();
      if (modules.length > 0 && this.permissions().length === 0) {
        // Carrega permissões para todos os módulos ativos
        modules
          .filter((m) => m.isActive)
          .forEach((module) => {
            this.roleStore.loadPermissionsByModule(module.id);
            this.roleStore.loadPermissionGroupsByModule(module.id);
          });
      }
    });
  }

  onModuleChange(moduleId: string | null): void {
    this.moduleFilterControl.setValue(moduleId);
    this.groupFilterControl.setValue(null); // Reset grupo quando módulo muda

    // Carrega permissões específicas do módulo se necessário
    if (moduleId) {
      const modulePermissions = this.roleStore.permissionsByModuleSync(moduleId);
      if (modulePermissions.length === 0) {
        this.roleStore.loadPermissionsByModule(moduleId);
      }

      const moduleGroups = this.roleStore.permissionGroupsByModuleSync(moduleId);
      if (moduleGroups.length === 0) {
        this.roleStore.loadPermissionGroupsByModule(moduleId);
      }
    }
  }

  onGroupChange(groupId: string | null): void {
    this.groupFilterControl.setValue(groupId);
  }

  onSearchChange(search: string): void {
    this.searchControl.setValue(search);
  }

  onViewModeChange(mode: 'module' | 'group'): void {
    this.viewMode.set(mode);
  }

  viewPermissionMatrix(): void {
    this.router.navigate(['/admin/permissions/matrix']);
  }

  viewPermissionGroups(): void {
    this.router.navigate(['/admin/permissions/groups']);
  }

  createPermission(): void {
    this.router.navigate(['/admin/permissions/new']);
  }

  editPermission(permission: Permission): void {
    this.router.navigate(['/admin/permissions', permission.id, 'edit']);
  }

  clearFilters(): void {
    this.moduleFilterControl.setValue(null);
    this.groupFilterControl.setValue(null);
    this.searchControl.setValue('');
  }

  getModuleName(moduleId: string): string {
    const module = this.modules().find((m) => m.id === moduleId);
    return module?.name || moduleId;
  }

  getGroupName(groupId: string): string {
    if (groupId === 'ungrouped') return 'Sem Grupo';
    const group = this.permissionGroups().find((g) => g.id === groupId);
    return group?.name || groupId;
  }

  getGroupDescription(groupId: string): string | undefined {
    if (groupId === 'ungrouped') return 'Permissões não agrupadas';
    const group = this.permissionGroups().find((g) => g.id === groupId);
    return group?.description;
  }

  trackByPermissionId(index: number, permission: Permission): string {
    return permission.id;
  }

  trackByModuleId(index: number, item: [string, Permission[]]): string {
    return item[0];
  }

  trackByGroupId(index: number, item: [string, Permission[]]): string {
    return item[0];
  }
}
