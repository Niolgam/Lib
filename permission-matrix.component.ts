import { Component, OnInit, inject, signal, computed, effect, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { RoleStore, AuthStore } from '@auth/data-access';
import { LoggingService } from '@vai/services';
import { Role, Permission, RolePermissionAssignment, PermissionAction, Module } from '@auth/data-access';

interface MatrixData {
  roles: Role[];
  permissions: Permission[];
  assignments: Map<string, RolePermissionAssignment>;
}

interface PermissionMatrixFilters {
  moduleId: string | null;
  roleFilter: string | null;
  permissionFilter: string | null;
  showSystemRoles: boolean;
  showOnlyAssigned: boolean;
}

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'permission-matrix',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './permission-matrix.component.html',
  styleUrls: ['./permission-matrix.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PermissionMatrixComponent implements OnInit {
  private roleStore = inject(RoleStore);
  private authStore = inject(AuthStore);
  private loggingService = inject(LoggingService);
  private router = inject(Router);
  private formBuilder = inject(FormBuilder);

  // Signals para estado da matriz
  private readonly filtersState = signal<PermissionMatrixFilters>({
    moduleId: null,
    roleFilter: null,
    permissionFilter: null,
    showSystemRoles: true,
    showOnlyAssigned: false,
  });

  private readonly selectedCellsState = signal<Set<string>>(new Set());
  private readonly isEditingState = signal(false);
  private readonly hasChangesState = signal(false);

  // Form para filtros
  readonly filtersForm: FormGroup;

  // Computed signals
  readonly modules = this.roleStore.activeModules;
  readonly allRoles = this.roleStore.roles;
  readonly allPermissions = this.roleStore.permissions;
  readonly isLoading = this.roleStore.isLoading;

  readonly filteredRoles = computed(() => {
    const roles = this.allRoles();
    const filters = this.filtersState();
    let filtered = roles;

    // Filtro por módulo
    if (filters.moduleId) {
      filtered = filtered.filter((role) => role.moduleId === filters.moduleId);
    }

    // Filtro por papel do sistema
    if (!filters.showSystemRoles) {
      filtered = filtered.filter((role) => !role.isSystemRole);
    }

    // Filtro por texto no nome do papel
    if (filters.roleFilter) {
      const searchTerm = filters.roleFilter.toLowerCase();
      filtered = filtered.filter((role) => role.name.toLowerCase().includes(searchTerm));
    }

    return filtered.filter((role) => role.isActive);
  });

  readonly filteredPermissions = computed(() => {
    const permissions = this.allPermissions();
    const filters = this.filtersState();
    let filtered = permissions;

    // Filtro por módulo
    if (filters.moduleId) {
      filtered = filtered.filter((permission) => permission.moduleId === filters.moduleId);
    }

    // Filtro por texto no nome da permissão
    if (filters.permissionFilter) {
      const searchTerm = filters.permissionFilter.toLowerCase();
      filtered = filtered.filter(
        (permission) => permission.name.toLowerCase().includes(searchTerm) || permission.code.toLowerCase().includes(searchTerm),
      );
    }

    // Filtro por apenas atribuídas
    if (filters.showOnlyAssigned) {
      const assignedPermissionIds = new Set<string>();
      this.filteredRoles().forEach((role) => {
        role.permissionAssignments?.forEach((assignment) => {
          assignedPermissionIds.add(assignment.permissionId);
        });
      });
      filtered = filtered.filter((permission) => assignedPermissionIds.has(permission.id));
    }

    return filtered;
  });

  readonly matrixData = computed<MatrixData>(() => {
    const roles = this.filteredRoles();
    const permissions = this.filteredPermissions();
    const assignments = new Map<string, RolePermissionAssignment>();

    // Mapeia todas as atribuições existentes
    roles.forEach((role) => {
      role.permissionAssignments?.forEach((assignment) => {
        const key = `${role.id}-${assignment.permissionId}`;
        assignments.set(key, assignment);
      });
    });

    return { roles, permissions, assignments };
  });

  readonly stats = computed(() => {
    const data = this.matrixData();
    const totalCells = data.roles.length * data.permissions.length;
    const assignedCells = data.assignments.size;
    const assignmentPercentage = totalCells > 0 ? (assignedCells / totalCells) * 100 : 0;

    // Calcula ações por tipo
    let actionCounts = {
      view: 0,
      create: 0,
      update: 0,
      delete: 0,
      approve: 0,
      export: 0,
      import: 0,
    };

    data.assignments.forEach((assignment) => {
      Object.entries(assignment.actions).forEach(([action, enabled]) => {
        if (enabled && action in actionCounts) {
          actionCounts[action as keyof typeof actionCounts]++;
        }
      });
    });

    return {
      totalRoles: data.roles.length,
      totalPermissions: data.permissions.length,
      totalCells,
      assignedCells,
      assignmentPercentage: Math.round(assignmentPercentage),
      actionCounts,
    };
  });

  readonly canEditPermissions = computed(() => this.authStore.checkUserHasPermissionForAction('roles', 'permissions', 'update'));

  readonly selectedModule = computed(() => {
    const moduleId = this.filtersState().moduleId;
    return moduleId ? this.modules().find((m) => m.id === moduleId) : null;
  });

  // Available actions for permissions
  readonly availableActions: (keyof PermissionAction)[] = ['view', 'create', 'update', 'delete', 'approve', 'export', 'import'];

  constructor() {
    // Inicializa formulário de filtros
    this.filtersForm = this.formBuilder.group({
      moduleId: [null],
      roleFilter: [''],
      permissionFilter: [''],
      showSystemRoles: [true],
      showOnlyAssigned: [false],
    });

    // Effect para sincronizar formulário com state
    effect(() => {
      const filters = this.filtersState();
      this.filtersForm.patchValue(filters, { emitEvent: false });
    });

    // Effect para atualizar filtros quando formulário muda
    this.filtersForm.valueChanges.subscribe((value) => {
      this.filtersState.set(value);
    });
  }

  ngOnInit(): void {
    this.loggingService.debug('PermissionMatrixComponent: Inicializando');
    this.initializeData();
  }

  private initializeData(): void {
    // Carrega módulos se necessário
    if (this.modules().length === 0) {
      this.roleStore.loadModules();
    }

    // Effect para carregar dados quando módulos estiverem prontos
    effect(() => {
      const modules = this.modules();
      if (modules.length > 0) {
        // Carrega papéis e permissões para módulos ativos
        modules
          .filter((m) => m.isActive)
          .forEach((module) => {
            if (this.roleStore.rolesByModuleSync(module.id).length === 0) {
              this.roleStore.loadRolesByModule(module.id);
            }
            if (this.roleStore.permissionsByModuleSync(module.id).length === 0) {
              this.roleStore.loadPermissionsByModule(module.id);
            }
          });
      }
    });
  }

  onModuleFilterChange(moduleId: string | null): void {
    this.filtersForm.patchValue({ moduleId });

    // Carrega dados específicos do módulo se necessário
    if (moduleId) {
      if (this.roleStore.rolesByModuleSync(moduleId).length === 0) {
        this.roleStore.loadRolesByModule(moduleId);
      }
      if (this.roleStore.permissionsByModuleSync(moduleId).length === 0) {
        this.roleStore.loadPermissionsByModule(moduleId);
      }
    }
  }

  getAssignment(roleId: string, permissionId: string): RolePermissionAssignment | null {
    const key = `${roleId}-${permissionId}`;
    return this.matrixData().assignments.get(key) || null;
  }

  hasPermission(roleId: string, permissionId: string): boolean {
    return this.getAssignment(roleId, permissionId) !== null;
  }

  hasAction(roleId: string, permissionId: string, action: keyof PermissionAction): boolean {
    const assignment = this.getAssignment(roleId, permissionId);
    return assignment ? assignment.actions[action] || false : false;
  }

  togglePermission(roleId: string, permissionId: string): void {
    if (!this.canEditPermissions()) return;

    const hasPermission = this.hasPermission(roleId, permissionId);

    if (hasPermission) {
      this.removePermissionFromRole(roleId, permissionId);
    } else {
      this.addPermissionToRole(roleId, permissionId);
    }
  }

  toggleAction(roleId: string, permissionId: string, action: keyof PermissionAction): void {
    if (!this.canEditPermissions()) return;

    let assignment = this.getAssignment(roleId, permissionId);

    if (!assignment) {
      // Cria nova atribuição com esta ação
      assignment = {
        permissionId,
        actions: {
          view: action === 'view',
          create: action === 'create',
          update: action === 'update',
          delete: action === 'delete',
          approve: action === 'approve',
          export: action === 'export',
          import: action === 'import',
        },
      };
    } else {
      // Alterna a ação específica
      assignment = {
        ...assignment,
        actions: {
          ...assignment.actions,
          [action]: !assignment.actions[action],
        },
      };
    }

    this.updateRolePermission(roleId, assignment);
  }

  private addPermissionToRole(roleId: string, permissionId: string): void {
    const assignment: RolePermissionAssignment = {
      permissionId,
      actions: {
        view: true,
        create: false,
        update: false,
        delete: false,
        approve: false,
        export: false,
        import: false,
      },
    };

    this.updateRolePermission(roleId, assignment);
  }

  private removePermissionFromRole(roleId: string, permissionId: string): void {
    // Remove a atribuição
    const role = this.allRoles().find((r) => r.id === roleId);
    if (!role || !role.permissionAssignments) return;

    const updatedAssignments = role.permissionAssignments.filter((a) => a.permissionId !== permissionId);

    this.roleStore.assignPermissionsToRole({
      roleId,
      permissionAssignments: updatedAssignments,
    });

    this.hasChangesState.set(true);
    this.loggingService.debug('Permission removed from role', { roleId, permissionId });
  }

  private updateRolePermission(roleId: string, assignment: RolePermissionAssignment): void {
    const role = this.allRoles().find((r) => r.id === roleId);
    if (!role) return;

    const assignments = role.permissionAssignments || [];
    const existingIndex = assignments.findIndex((a) => a.permissionId === assignment.permissionId);

    let updatedAssignments;
    if (existingIndex >= 0) {
      // Atualiza existente
      updatedAssignments = [...assignments];
      updatedAssignments[existingIndex] = assignment;
    } else {
      // Adiciona nova
      updatedAssignments = [...assignments, assignment];
    }

    this.roleStore.assignPermissionsToRole({
      roleId,
      permissionAssignments: updatedAssignments,
    });

    this.hasChangesState.set(true);
    this.loggingService.debug('Permission assignment updated', { roleId, assignment });
  }

  selectAllPermissionsForRole(roleId: string): void {
    if (!this.canEditPermissions()) return;

    const permissions = this.filteredPermissions();
    const assignments: RolePermissionAssignment[] = permissions.map((permission) => ({
      permissionId: permission.id,
      actions: {
        view: true,
        create: true,
        update: true,
        delete: true,
        approve: true,
        export: true,
        import: true,
      },
    }));

    this.roleStore.assignPermissionsToRole({ roleId, permissionAssignments: assignments });
    this.hasChangesState.set(true);
    this.loggingService.debug('All permissions assigned to role', { roleId, count: assignments.length });
  }

  clearAllPermissionsForRole(roleId: string): void {
    if (!this.canEditPermissions()) return;

    this.roleStore.assignPermissionsToRole({ roleId, permissionAssignments: [] });
    this.hasChangesState.set(true);
    this.loggingService.debug('All permissions cleared for role', { roleId });
  }

  selectAllRolesForPermission(permissionId: string): void {
    if (!this.canEditPermissions()) return;

    this.filteredRoles().forEach((role) => {
      if (!this.hasPermission(role.id, permissionId)) {
        this.addPermissionToRole(role.id, permissionId);
      }
    });

    this.loggingService.debug('Permission assigned to all roles', { permissionId });
  }

  clearAllRolesForPermission(permissionId: string): void {
    if (!this.canEditPermissions()) return;

    this.filteredRoles().forEach((role) => {
      if (this.hasPermission(role.id, permissionId)) {
        this.removePermissionFromRole(role.id, permissionId);
      }
    });

    this.loggingService.debug('Permission cleared from all roles', { permissionId });
  }

  exportMatrix(): void {
    const data = this.matrixData();
    const exportData = {
      timestamp: new Date().toISOString(),
      module: this.selectedModule()?.name || 'All Modules',
      roles: data.roles.map((role) => ({
        id: role.id,
        name: role.name,
        isSystemRole: role.isSystemRole,
      })),
      permissions: data.permissions.map((permission) => ({
        id: permission.id,
        name: permission.name,
        code: permission.code,
      })),
      assignments: Array.from(data.assignments.entries()).map(([key, assignment]) => {
        const [roleId, permissionId] = key.split('-');
        return {
          roleId,
          permissionId,
          actions: assignment.actions,
        };
      }),
    };

    // Cria arquivo JSON para download
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `permission-matrix-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);

    this.loggingService.debug('Permission matrix exported', {
      roles: data.roles.length,
      permissions: data.permissions.length,
    });
  }

  resetFilters(): void {
    this.filtersForm.reset({
      moduleId: null,
      roleFilter: '',
      permissionFilter: '',
      showSystemRoles: true,
      showOnlyAssigned: false,
    });
  }

  getActionColor(action: keyof PermissionAction): string {
    const colors: Record<string, string> = {
      view: 'bg-blue-100 text-blue-800',
      create: 'bg-green-100 text-green-800',
      update: 'bg-yellow-100 text-yellow-800',
      delete: 'bg-red-100 text-red-800',
      approve: 'bg-purple-100 text-purple-800',
      export: 'bg-indigo-100 text-indigo-800',
      import: 'bg-orange-100 text-orange-800',
    };
    return colors[action] || 'bg-gray-100 text-gray-800';
  }

  getActionIcon(action: keyof PermissionAction): string {
    const icons: Record<string, string> = {
      view: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
      create: 'M12 4v16m8-8H4',
      update: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
      delete: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
      approve: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
      export: 'M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
      import: 'M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10',
    };
    return icons[action] || 'M12 4v16m8-8H4';
  }

  trackByRoleId(index: number, role: Role): string {
    return role.id;
  }

  trackByPermissionId(index: number, permission: Permission): string {
    return permission.id;
  }

  trackByAction(index: number, action: keyof PermissionAction): string {
    return action;
  }
}
