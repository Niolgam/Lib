import { Component, input, output, signal, computed, inject, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RoleStore } from '@auth/data-access';
import { LoggingService } from '@vai/services';
import { PermissionGroup, Permission, Module, PermissionAction } from '@auth/data-access';

interface PermissionGroupSelection {
  groupId: string;
  moduleId: string;
  permissions: {
    [permissionId: string]: {
      selected: boolean;
      actions: Partial<PermissionAction>;
    };
  };
}

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'permission-group',
  imports: [CommonModule, FormsModule],
  templateUrl: './permission-group.component.html',
  styleUrls: ['./permission-group.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PermissionGroupComponent implements OnInit {
  // Serviços injetados
  private roleStore = inject(RoleStore);
  private loggingService = inject(LoggingService);

  // Inputs
  readonly selectedModuleId = input<string | null>(null);
  readonly selectedRoleId = input<string | null>(null);
  readonly readOnly = input<boolean>(false);
  readonly showActions = input<boolean>(true);

  // Outputs
  readonly selectionChange = output<PermissionGroupSelection[]>();
  readonly permissionToggle = output<{
    permissionId: string;
    groupId: string;
    moduleId: string;
    actions: Partial<PermissionAction>;
  }>();

  // Estado local
  private readonly expandedGroupsState = signal<Set<string>>(new Set());
  private readonly searchTermState = signal<string>('');
  private readonly selectedPermissionsState = signal<
    Map<
      string,
      {
        selected: boolean;
        actions: PermissionAction;
      }
    >
  >(new Map());

  // Computed signals para reatividade
  readonly modules = computed(() => this.roleStore.activeModules());

  readonly filteredModules = computed(() => {
    const modules = this.modules();
    const selectedModuleId = this.selectedModuleId();

    if (selectedModuleId) {
      return modules.filter((m) => m.id === selectedModuleId);
    }

    return modules;
  });

  readonly permissionGroups = computed(() => {
    const modules = this.filteredModules();
    const searchTerm = this.searchTermState().toLowerCase();

    const groups: Array<{
      module: Module;
      groups: PermissionGroup[];
    }> = [];

    modules.forEach((module) => {
      let moduleGroups = this.roleStore.permissionGroupsByModuleSync(module.id);

      // Filtrar por termo de busca
      if (searchTerm) {
        moduleGroups = moduleGroups.filter(
          (group) =>
            group.name.toLowerCase().includes(searchTerm) ||
            group.description.toLowerCase().includes(searchTerm) ||
            group.permissions.some((p) => p.name.toLowerCase().includes(searchTerm) || p.description.toLowerCase().includes(searchTerm)),
        );
      }

      if (moduleGroups.length > 0) {
        groups.push({ module, groups: moduleGroups });
      }
    });

    return groups;
  });

  readonly expandedGroups = this.expandedGroupsState.asReadonly();
  readonly searchTerm = this.searchTermState.asReadonly();
  readonly selectedPermissions = this.selectedPermissionsState.asReadonly();

  // Computed para estatísticas
  readonly totalPermissions = computed(() => {
    return this.permissionGroups().reduce((total, moduleEntry) => {
      return (
        total +
        moduleEntry.groups.reduce((groupTotal, group) => {
          return groupTotal + group.permissions.length;
        }, 0)
      );
    }, 0);
  });

  readonly selectedPermissionsCount = computed(() => {
    const selected = this.selectedPermissions();
    return Array.from(selected.values()).filter((p) => p.selected).length;
  });

  ngOnInit() {
    this.loggingService.debug('PermissionGroupComponent: Initialized', {
      selectedModuleId: this.selectedModuleId(),
      selectedRoleId: this.selectedRoleId(),
    });

    // Auto-expand primeiro grupo se houver apenas um módulo
    const groups = this.permissionGroups();
    if (groups.length === 1 && groups[0].groups.length > 0) {
      this.toggleGroup(groups[0].groups[0].id);
    }
  }

  /**
   * Alterna expansão de um grupo
   */
  toggleGroup(groupId: string): void {
    this.expandedGroupsState.update((expanded) => {
      const newExpanded = new Set(expanded);
      if (newExpanded.has(groupId)) {
        newExpanded.delete(groupId);
      } else {
        newExpanded.add(groupId);
      }
      return newExpanded;
    });
  }

  /**
   * Verifica se um grupo está expandido
   */
  isGroupExpanded(groupId: string): boolean {
    return this.expandedGroups().has(groupId);
  }

  /**
   * Atualiza termo de busca
   */
  updateSearchTerm(term: string): void {
    this.searchTermState.set(term);
  }

  /**
   * Limpa busca
   */
  clearSearch(): void {
    this.searchTermState.set('');
  }

  /**
   * Seleciona/deseleciona uma permissão
   */
  togglePermission(permission: Permission, groupId: string, moduleId: string): void {
    if (this.readOnly()) return;

    const currentState = this.selectedPermissions().get(permission.id);
    const isCurrentlySelected = currentState?.selected ?? false;

    // Define ações padrão se estiver selecionando
    const defaultActions: PermissionAction = {
      view: true,
      create: false,
      update: false,
      delete: false,
    };

    const newActions = isCurrentlySelected ? { view: false, create: false, update: false, delete: false } : (currentState?.actions ?? defaultActions);

    this.selectedPermissionsState.update((selected) => {
      const newSelected = new Map(selected);
      newSelected.set(permission.id, {
        selected: !isCurrentlySelected,
        actions: newActions,
      });
      return newSelected;
    });

    // Emite evento
    this.permissionToggle.emit({
      permissionId: permission.id,
      groupId,
      moduleId,
      actions: newActions,
    });

    this.emitSelectionChange();
  }

  /**
   * Alterna uma ação específica para uma permissão
   */
  togglePermissionAction(permission: Permission, action: keyof PermissionAction, groupId: string, moduleId: string): void {
    if (this.readOnly()) return;

    const currentState = this.selectedPermissions().get(permission.id);
    if (!currentState?.selected) return;

    const newActions = { ...currentState.actions };
    newActions[action] = !newActions[action];

    // Se desmarcar 'view', desmarcar todas as outras
    if (action === 'view' && !newActions[action]) {
      Object.keys(newActions).forEach((key) => {
        newActions[key as keyof PermissionAction] = false;
      });
    }

    // Se marcar qualquer ação exceto 'view', marcar 'view' automaticamente
    if (action !== 'view' && newActions[action]) {
      newActions.view = true;
    }

    this.selectedPermissionsState.update((selected) => {
      const newSelected = new Map(selected);
      newSelected.set(permission.id, {
        selected: Object.values(newActions).some((v) => v),
        actions: newActions,
      });
      return newSelected;
    });

    this.permissionToggle.emit({
      permissionId: permission.id,
      groupId,
      moduleId,
      actions: newActions,
    });

    this.emitSelectionChange();
  }

  /**
   * Verifica se uma permissão está selecionada
   */
  isPermissionSelected(permissionId: string): boolean {
    return this.selectedPermissions().get(permissionId)?.selected ?? false;
  }

  /**
   * Verifica se uma ação específica está selecionada para uma permissão
   */
  isPermissionActionSelected(permissionId: string, action: keyof PermissionAction): boolean {
    const permissionState = this.selectedPermissions().get(permissionId);
    return permissionState?.selected && (permissionState.actions[action] ?? false);
  }

  /**
   * Seleciona/deseleciona todas as permissões de um grupo
   */
  toggleGroupPermissions(group: PermissionGroup, moduleId: string): void {
    if (this.readOnly()) return;

    const allSelected = group.permissions.every((p) => this.isPermissionSelected(p.id));

    group.permissions.forEach((permission) => {
      const defaultActions: PermissionAction = {
        view: !allSelected,
        create: false,
        update: false,
        delete: false,
      };

      this.selectedPermissionsState.update((selected) => {
        const newSelected = new Map(selected);
        newSelected.set(permission.id, {
          selected: !allSelected,
          actions: defaultActions,
        });
        return newSelected;
      });
    });

    this.emitSelectionChange();
  }

  /**
   * Verifica se todas as permissões de um grupo estão selecionadas
   */
  areAllGroupPermissionsSelected(group: PermissionGroup): boolean {
    return group.permissions.length > 0 && group.permissions.every((p) => this.isPermissionSelected(p.id));
  }

  /**
   * Verifica se alguma permissão de um grupo está selecionada
   */
  areSomeGroupPermissionsSelected(group: PermissionGroup): boolean {
    return group.permissions.some((p) => this.isPermissionSelected(p.id));
  }

  /**
   * Seleciona/deseleciona todas as permissões de um módulo
   */
  toggleModulePermissions(moduleEntry: { module: Module; groups: PermissionGroup[] }): void {
    if (this.readOnly()) return;

    const allPermissions = moduleEntry.groups.flatMap((g) => g.permissions);
    const allSelected = allPermissions.every((p) => this.isPermissionSelected(p.id));

    allPermissions.forEach((permission) => {
      const defaultActions: PermissionAction = {
        view: !allSelected,
        create: false,
        update: false,
        delete: false,
      };

      this.selectedPermissionsState.update((selected) => {
        const newSelected = new Map(selected);
        newSelected.set(permission.id, {
          selected: !allSelected,
          actions: defaultActions,
        });
        return newSelected;
      });
    });

    this.emitSelectionChange();
  }

  /**
   * Verifica se todas as permissões de um módulo estão selecionadas
   */
  areAllModulePermissionsSelected(moduleEntry: { module: Module; groups: PermissionGroup[] }): boolean {
    const allPermissions = moduleEntry.groups.flatMap((g) => g.permissions);
    return allPermissions.length > 0 && allPermissions.every((p) => this.isPermissionSelected(p.id));
  }

  /**
   * Verifica se alguma permissão de um módulo está selecionada
   */
  areSomeModulePermissionsSelected(moduleEntry: { module: Module; groups: PermissionGroup[] }): boolean {
    const allPermissions = moduleEntry.groups.flatMap((g) => g.permissions);
    return allPermissions.some((p) => this.isPermissionSelected(p.id));
  }

  /**
   * Emite mudanças na seleção
   */
  private emitSelectionChange(): void {
    const groups = this.permissionGroups();
    const selections: PermissionGroupSelection[] = [];

    groups.forEach((moduleEntry) => {
      moduleEntry.groups.forEach((group) => {
        const permissions: PermissionGroupSelection['permissions'] = {};

        group.permissions.forEach((permission) => {
          const state = this.selectedPermissions().get(permission.id);
          if (state?.selected) {
            permissions[permission.id] = {
              selected: true,
              actions: state.actions,
            };
          }
        });

        if (Object.keys(permissions).length > 0) {
          selections.push({
            groupId: group.id,
            moduleId: moduleEntry.module.id,
            permissions,
          });
        }
      });
    });

    this.selectionChange.emit(selections);
  }

  /**
   * Define seleções de permissões externamente
   */
  setPermissionSelections(selections: PermissionGroupSelection[]): void {
    const newSelectedMap = new Map<
      string,
      {
        selected: boolean;
        actions: PermissionAction;
      }
    >();

    selections.forEach((selection) => {
      Object.entries(selection.permissions).forEach(([permissionId, permState]) => {
        if (permState.selected && permState.actions) {
          newSelectedMap.set(permissionId, {
            selected: true,
            actions: {
              view: permState.actions.view ?? false,
              create: permState.actions.create ?? false,
              update: permState.actions.update ?? false,
              delete: permState.actions.delete ?? false,
            },
          });
        }
      });
    });

    this.selectedPermissionsState.set(newSelectedMap);
  }

  /**
   * Limpa todas as seleções
   */
  clearAllSelections(): void {
    this.selectedPermissionsState.set(new Map());
    this.emitSelectionChange();
  }

  /**
   * Expande todos os grupos
   */
  expandAllGroups(): void {
    const allGroupIds = this.permissionGroups().flatMap((m) => m.groups.map((g) => g.id));
    this.expandedGroupsState.set(new Set(allGroupIds));
  }

  /**
   * Colapsa todos os grupos
   */
  collapseAllGroups(): void {
    this.expandedGroupsState.set(new Set());
  }

  /**
   * Obtém ícone para um módulo
   */
  getModuleIcon(module: Module): string {
    return module.icon || 'folder';
  }

  /**
   * Obtém contagem de permissões selecionadas em um grupo
   */
  getGroupSelectedCount(group: PermissionGroup): number {
    return group.permissions.filter((p) => this.isPermissionSelected(p.id)).length;
  }

  /**
   * Obtém contagem de permissões selecionadas em um módulo
   */
  getModuleSelectedCount(moduleEntry: { module: Module; groups: PermissionGroup[] }): number {
    const allPermissions = moduleEntry.groups.flatMap((g) => g.permissions);
    return allPermissions.filter((p) => this.isPermissionSelected(p.id)).length;
  }
}
