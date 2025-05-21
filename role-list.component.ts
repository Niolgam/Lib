import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { Router } from '@angular/router';

import { RoleStore, AuthStore } from '@auth/data-access';
import { LoggingService } from '@vai/services';
import { Role, Module } from '@auth/data-access';
import { ChangeDetectionStrategy, Component, computed, effect, inject, OnInit, signal } from '@angular/core';

interface RoleListFilters {
  moduleId: string | null;
  isActive: boolean | null;
  search: string;
}
@Component({
  selector: 'role-list',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './role-list.component.html',
  styleUrls: ['./role-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoleListComponent implements OnInit {
  private roleStore = inject(RoleStore);
  private authStore = inject(AuthStore);
  private loggingService = inject(LoggingService);
  private router = inject(Router);

  // Signals para filtros
  private readonly filtersState = signal<RoleListFilters>({
    moduleId: null,
    isActive: null,
    search: '',
  });

  // Form controls para os filtros
  readonly moduleFilterControl = new FormControl<string | null>(null);
  readonly activeFilterControl = new FormControl<boolean | null>(null);
  readonly searchControl = new FormControl('');

  // Computed signals para lógica de negócio
  readonly modules = this.roleStore.activeModules;
  readonly roles = this.roleStore.roles;
  readonly isLoading = this.roleStore.isLoading;

  readonly filteredRoles = computed(() => {
    const rolesData = this.roles();
    const filters = this.filtersState();

    let filtered = rolesData;

    // Filtro por módulo
    if (filters.moduleId) {
      filtered = filtered.filter((role) => role.moduleId === filters.moduleId);
    }

    // Filtro por status ativo
    if (filters.isActive !== null) {
      filtered = filtered.filter((role) => role.isActive === filters.isActive);
    }

    // Filtro por busca textual
    if (filters.search) {
      const searchTerm = filters.search.toLowerCase();
      filtered = filtered.filter((role) => role.name.toLowerCase().includes(searchTerm) || role.description?.toLowerCase().includes(searchTerm));
    }

    return filtered;
  });

  readonly rolesByModule = computed(() => {
    const filtered = this.filteredRoles();
    const grouped = new Map<string, Role[]>();

    filtered.forEach((role) => {
      const moduleId = role.moduleId;
      if (!grouped.has(moduleId)) {
        grouped.set(moduleId, []);
      }
      grouped.get(moduleId)!.push(role);
    });

    return grouped;
  });

  readonly canCreateRole = computed(() => this.authStore.checkUserHasPermissionForAction('roles', 'create', 'create'));

  readonly canEditRole = computed(() => this.authStore.checkUserHasPermissionForAction('roles', 'update', 'update'));

  readonly canDeleteRole = computed(() => this.authStore.checkUserHasPermissionForAction('roles', 'delete', 'delete'));

  // Statistics
  readonly stats = computed(() => {
    const filtered = this.filteredRoles();
    return {
      total: filtered.length,
      active: filtered.filter((r) => r.isActive).length,
      inactive: filtered.filter((r) => !r.isActive).length,
      systemRoles: filtered.filter((r) => r.isSystemRole).length,
      customRoles: filtered.filter((r) => !r.isSystemRole).length,
    };
  });

  constructor() {
    // Efeito para atualizar filtros quando os form controls mudam
    effect(() => {
      const moduleId = this.moduleFilterControl.value;
      const isActive = this.activeFilterControl.value;
      const search = this.searchControl.value || '';

      this.filtersState.set({
        moduleId,
        isActive,
        search,
      });
    });
  }

  ngOnInit(): void {
    this.loggingService.debug('RoleListComponent: Inicializando');

    // Carrega módulos e papéis
    this.roleStore.loadModules();

    // Se não há papéis carregados, carrega todos
    if (this.roles().length === 0) {
      this.initializeRoleManagement();
    }
  }

  initializeRoleManagement(): void {
    this.roleStore.initializeRoleManagement();
  }

  onModuleChange(moduleId: string | null): void {
    this.moduleFilterControl.setValue(moduleId);

    // Carrega papéis específicos do módulo se necessário
    if (moduleId && this.roleStore.rolesByModuleSync(moduleId).length === 0) {
      this.roleStore.loadRolesByModule(moduleId);
    }
  }

  onActiveFilterChange(isActive: boolean | null): void {
    this.activeFilterControl.setValue(isActive);
  }

  onSearchChange(search: string): void {
    this.searchControl.setValue(search);
  }

  viewRoleDetail(role: Role): void {
    this.router.navigate(['/admin/roles', role.id]);
  }

  editRole(role: Role): void {
    this.router.navigate(['/admin/roles', role.id, 'edit']);
  }

  createRole(): void {
    this.router.navigate(['/admin/roles/new']);
  }

  toggleRoleStatus(role: Role): void {
    if (!this.canEditRole()) return;

    this.loggingService.debug('RoleListComponent: Alternando status do papel', {
      roleId: role.id,
      currentStatus: role.isActive,
    });

    // A lógica de atualização deve estar no store
    // Aqui apenas dispara a ação
    const updatedRole = { ...role, isActive: !role.isActive };
    //TODO:
    // this.roleStore.updateRole({ roleId: role.id, data: updatedRole });
  }

  deleteRole(role: Role): void {
    if (!this.canDeleteRole() || role.isSystemRole) return;

    if (confirm(`Tem certeza que deseja excluir o papel "${role.name}"?`)) {
      this.loggingService.debug('RoleListComponent: Excluindo papel', { roleId: role.id });
      // TODO:
      // this.roleStore.deleteRole(role.id);
    }
  }

  clearFilters(): void {
    this.moduleFilterControl.setValue(null);
    this.activeFilterControl.setValue(null);
    this.searchControl.setValue('');
  }

  getModuleName(moduleId: string): string {
    const module = this.modules().find((m) => m.id === moduleId);
    return module?.name || moduleId;
  }

  trackByRoleId(index: number, role: Role): string {
    return role.id;
  }

  trackByModuleId(index: number, item: [string, Role[]]): string {
    return item[0];
  }
}
