import { inject, Signal } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withProps, withState } from '@ngrx/signals';
import { computed } from '@angular/core';

import { RoleService } from '@auth/utils';
import { LoggingService } from '@vai/services';
import { Role, Module, Permission, PermissionGroup, RolePermissionAssignment, User, UserRoleAssignmentInfo } from './models';
import { EnhancedLRUSignalCache } from '@vai/utils';
import { CacheMonitorService } from '@vai/services';
import { withCallState, withImmutableState, withEntityHelpers, withDataService } from '@vai/store-feature';
import { AuthConfigService } from '@auth/utils';

// Estado inicial
interface RoleStoreState {
  roles: Role[];
  modules: Module[];
  permissions: Permission[];
  permissionGroups: PermissionGroup[];
  permissionsCache: Map<string, boolean>;
}

const initialState: RoleStoreState = {
  roles: [],
  modules: [],
  permissions: [],
  permissionGroups: [],
  permissionsCache: new Map<string, boolean>(),
};

export const RoleStore = signalStore(
  withState(initialState),
  withProps(() => ({
    dataService: inject(RoleService),
    loggingService: inject(LoggingService),
    cacheMonitor: inject(CacheMonitorService),
    authConfigService: inject(AuthConfigService),
  })),
  withCallState(),
  withImmutableState(),
  withEntityHelpers<Role>('roles'),
  withDataService<Role>({
    entityName: 'role',
    entitiesKey: 'roles',
    methods: {
      getAll: 'getRoles',
      getById: 'getRoleById',
      create: 'createRole',
      update: 'updateRole',
      delete: 'deleteRole',
      search: 'searchRoles',
    },
  }),
  withComputed(({ roles, modules, permissions }) => ({
    activeRoles: computed(() => roles().filter((role) => role.isActive)),
    activeModules: computed(() => modules().filter((module) => module.isActive)),
    state: computed(() => ({ roles: roles(), modules: modules(), permissions: permissions() })),
  })),

  withMethods((store) => {
    const selectorCache = new EnhancedLRUSignalCache<any>(
      100, // maxSize
      undefined,
      30 * 60 * 1000, // TTL: 30 minutos
      undefined,
      store.loggingService,
    );

    store.cacheMonitor.registerCache('roleStore', selectorCache);

    return {
      initialize() {
        store.loggingService.debug('RoleStore: Initializing');
        this.loadModules();
      },

      reset() {
        patchState(store, initialState);
        selectorCache.clear();
        store.loggingService.debug('RoleStore: Reset to initial state');
      },

      loadModules() {
        const operationKey = 'loadModules';

        store.loggingService.debug('RoleStore: Loading modules');

        return store.trackCall(operationKey, store.dataService.getModules(), {
          onSuccess: (modules: any) => {
            patchState(store, { modules });
            store.loggingService.debug(`RoleStore: Loaded ${modules.length} modules`);

            modules.filter((m: any) => m.isActive).forEach((module: any) => this.loadRolesByModule(module.id));
          },
        });
      },

      loadRolesByModule(moduleId: string) {
        const operationKey = `loadRolesByModule_${moduleId}`;

        store.loggingService.debug(`RoleStore: Loading roles for module ${moduleId}`);

        return store.trackCall(operationKey, store.dataService.getRolesByModule(moduleId), {
          onSuccess: (rolesData: any) => {
            const currentRoles = store.roles().filter((role) => role.moduleId !== moduleId);
            patchState(store, { roles: [...currentRoles, ...rolesData] });

            store.loggingService.debug(`RoleStore: Loaded ${rolesData.length} roles for module ${moduleId}`);

            this.invalidateCache(`module:${moduleId}`);
          },
        });
      },

      loadPermissionsByModule(moduleId: string) {
        const operationKey = `loadPermissionsByModule_${moduleId}`;

        store.loggingService.debug(`RoleStore: Loading permissions for module ${moduleId}`);

        return store.trackCall(operationKey, store.dataService.getPermissionsByModule(moduleId), {
          onSuccess: (permissionsData: any) => {
            const currentPermissions = store.permissions().filter((p) => p.moduleId !== moduleId);
            patchState(store, { permissions: [...currentPermissions, ...permissionsData] });

            store.loggingService.debug(`RoleStore: Loaded ${permissionsData.length} permissions for module ${moduleId}`);

            this.invalidateCache(`permissions:${moduleId}`);
            this.clearPermissionsCache();
          },
        });
      },

      loadPermissionGroupsByModule(moduleId: string) {
        const operationKey = `loadPermissionGroupsByModule_${moduleId}`;

        store.loggingService.debug(`RoleStore: Loading permission groups for module ${moduleId}`);

        return store.trackCall(operationKey, store.dataService.getPermissionGroupsByModule(moduleId), {
          onSuccess: (groupsData: any) => {
            const currentGroups = store.permissionGroups().filter((g) => g.moduleId !== moduleId);
            patchState(store, { permissionGroups: [...currentGroups, ...groupsData] });

            store.loggingService.debug(`RoleStore: Loaded ${groupsData.length} permission groups for module ${moduleId}`);

            this.invalidateCache(`permissionGroups:${moduleId}`);
          },
        });
      },

      // Atribuir permissões a um papel
      assignPermissionsToRole(params: { roleId: string; permissionAssignments: RolePermissionAssignment[] }) {
        const { roleId, permissionAssignments } = params;
        const operationKey = `assignPermissionsToRole_${roleId}`;

        store.loggingService.debug(`RoleStore: Assigning permissions to role ${roleId}`, {
          count: permissionAssignments.length,
        });

        return store.trackCall(operationKey, store.dataService.assignPermissionsToRole(roleId, permissionAssignments), {
          onSuccess: (updatedRole: any) => {
            this.upsertEntity(updatedRole);

            store.loggingService.debug(`RoleStore: Permissions assigned to role ${roleId}`);

            this.invalidateCache(`role:${roleId}`);
            this.clearPermissionsCache();
          },
        });
      },

      initializeRoleManagement() {
        store.loggingService.debug('RoleStore: Initializing role management');
        this.loadModules();
      },

      hasPermission(moduleId: string, permission: string, action = 'view'): Signal<boolean> {
        const cacheKey = `permission:${moduleId}:${permission}:${action}`;
        const cached = selectorCache.get(cacheKey);
        if (cached) return cached;

        const signal = computed(() => {
          const user = this.getCurrentUser();
          if (!user) return false;

          return this.checkUserHasPermissionForAction(user, moduleId, permission, action);
        });

        selectorCache.set(cacheKey, signal, [`module:${moduleId}`, `permission:${permission}`]);
        return signal;
      },

      hasPermissionSync(moduleId: string, permission: string, action: string = 'view'): boolean {
        return this.hasPermission(moduleId, permission, action)();
      },

      checkUserHasPermissionForAction(user: User, moduleIdToCheck: string, permissionInput: string, actionToCheck: string): boolean {
        if (!user?.roles || user.roles.length === 0) {
          return false;
        }

        if (this.hasRoleSync(user, 'core', 'admin')) {
          return true;
        }

        const cacheKey = `${user.id}_${moduleIdToCheck}_${permissionInput}_${actionToCheck}`;
        const permissionsCache = store.permissionsCache();
        if (permissionsCache.has(cacheKey)) {
          return permissionsCache.get(cacheKey)!;
        }

        const moduleRoles = user.roles.filter((role) => role.moduleId === moduleIdToCheck);
        if (moduleRoles.length === 0) {
          this._cacheResult(cacheKey, false);
          return false;
        }

        const normalizedPermission = this._normalizePermissionInput(moduleIdToCheck, permissionInput);
        const hasPermission = moduleRoles.some((userRole) => this._checkRoleHasPermission(userRole, normalizedPermission, actionToCheck));

        this._cacheResult(cacheKey, hasPermission);

        return hasPermission;
      },

      getCurrentUser(): User | null {
        // Este é um método mock para demonstração - deve ser substituído pelo acesso real ao usuário
        // Normalmente seria algo como: return inject(AuthStore).currentUser();
        return null;
      },

      clearPermissionsCache(): void {
        patchState(store, { permissionsCache: new Map<string, boolean>() });
      },

      _cacheResult(key: string, result: boolean): void {
        patchState(store, (state) => {
          const newCache = new Map(state.permissionsCache);
          newCache.set(key, result);

          if (newCache.size > 1000) {
            const oldestKey = newCache.keys().next().value;
            newCache.delete(oldestKey);
          }

          return { permissionsCache: newCache };
        });
      },

      _normalizePermissionInput(moduleId: string, permissionInput: string): string {
        if (permissionInput.includes(':')) {
          return permissionInput;
        }
        return `${moduleId}:${permissionInput}`;
      },

      _checkRoleHasPermission(userRole: UserRoleAssignmentInfo, normalizedPermission: string, action: string): boolean {
        const systemRoleDefinition = this.getRoleByIdSync(`${userRole.moduleId}:${userRole.role}`);
        if (!systemRoleDefinition?.permissionAssignments?.length) {
          return false;
        }

        return systemRoleDefinition.permissionAssignments.some((assignment: any) => {
          const permissionDefinition = store.permissions().find((p) => p.id === assignment.permissionId);
          if (!permissionDefinition) return false;

          const permissionId = `${permissionDefinition.moduleId}:${permissionDefinition.code}`;
          if (permissionId !== normalizedPermission) return false;

          return !!assignment.actions[action];
        });
      },

      hasRole(moduleId: string, roleName: string): Signal<boolean> {
        const cacheKey = `role:${moduleId}:${roleName}`;

        const cached = selectorCache.get(cacheKey);
        if (cached) return cached;

        const signal = computed(() => {
          const user = this.getCurrentUser();
          if (!user) return false;

          return this.hasRoleSync(user, moduleId, roleName);
        });

        selectorCache.set(cacheKey, signal, [`module:${moduleId}`, `role:${roleName}`]);
        return signal;
      },

      hasRoleSync(user: User | null, moduleId: string, roleName: string): boolean {
        if (!user?.roles) return false;

        if (user.roles.some((r) => r.moduleId === 'core' && r.role === 'admin')) {
          return true;
        }

        return user.roles.some((r) => r.moduleId === moduleId && r.role === roleName);
      },

      getHighestRoleInModule(moduleId: string): Signal<string | null> {
        const cacheKey = `highestRole:${moduleId}`;

        const cached = selectorCache.get(cacheKey);
        if (cached) return cached;

        const signal = computed(() => {
          const user = this.getCurrentUser();
          if (!user?.roles) return null;

          const moduleRoles = user.roles.filter((r: any) => r.moduleId === moduleId);
          if (!moduleRoles.length) return null;

          const roleHierarchy = store.authConfigService.roleHierarchy();

          let highestRole = null;
          let highestLevel = -1;

          moduleRoles.forEach((role: any) => {
            const level = roleHierarchy[role.role] || 0;
            if (level > highestLevel) {
              highestLevel = level;
              highestRole = role.role;
            }
          });

          return highestRole;
        });

        selectorCache.set(cacheKey, signal, [`module:${moduleId}`]);
        return signal;
      },

      getHighestRoleInModuleSync(moduleId: string): string | null {
        return this.getHighestRoleInModule(moduleId)();
      },

      canPerformAction(moduleId: string, resourceName: string, action: string): Signal<boolean> {
        return this.hasPermission(moduleId, resourceName, action);
      },

      canPerformActionSync(moduleId: string, resourceName: string, action: string): boolean {
        return this.canPerformAction(moduleId, resourceName, action)();
      },

      rolesByModule(moduleId: string) {
        const cacheKey = `rolesByModule:${moduleId}`;

        const cached = selectorCache.get(cacheKey);
        if (cached) return cached;

        const signal = computed(() => store.roles().filter((role) => role.moduleId === moduleId));

        selectorCache.set(cacheKey, signal, [`module:${moduleId}`]);
        return signal;
      },

      permissionsByModule(moduleId: string) {
        const cacheKey = `permissionsByModule:${moduleId}`;

        const cached = selectorCache.get(cacheKey);
        if (cached) return cached;

        const signal = computed(() => store.permissions().filter((permission) => permission.moduleId === moduleId));

        selectorCache.set(cacheKey, signal, [`module:${moduleId}`, `permissions:${moduleId}`]);
        return signal;
      },

      permissionGroupsByModule(moduleId: string) {
        const cacheKey = `permissionGroupsByModule:${moduleId}`;

        const cached = selectorCache.get(cacheKey);
        if (cached) return cached;

        const signal = computed(() => store.permissionGroups().filter((group) => group.moduleId === moduleId));

        selectorCache.set(cacheKey, signal, [`module:${moduleId}`, `permissionGroups:${moduleId}`]);
        return signal;
      },

      hasCustomRolesInModule(moduleId: string) {
        const cacheKey = `hasCustomRolesInModule:${moduleId}`;

        const cached = selectorCache.get(cacheKey);
        if (cached) return cached;

        const signal = computed(() => store.roles().some((role) => role.moduleId === moduleId && !role.isSystemRole));

        selectorCache.set(cacheKey, signal, [`module:${moduleId}`]);
        return signal;
      },

      getRoleById(roleId: string) {
        const cacheKey = `role:${roleId}`;

        const cached = selectorCache.get(cacheKey);
        if (cached) return cached;

        const signal = computed(() => store.roles().find((role) => role.id === roleId) || null);

        selectorCache.set(cacheKey, signal, [`role:${roleId}`]);
        return signal;
      },

      getModuleById(moduleId: string) {
        const cacheKey = `module:${moduleId}`;

        const cached = selectorCache.get(cacheKey);
        if (cached) return cached;

        const signal = computed(() => store.modules().find((module) => module.id === moduleId) || null);

        selectorCache.set(cacheKey, signal, [`module:${moduleId}`]);
        return signal;
      },

      invalidateCache(pattern: string) {
        selectorCache.invalidateByTag(pattern);
      },

      rolesByModuleSync(moduleId: string) {
        return this.rolesByModule(moduleId)();
      },

      permissionsByModuleSync(moduleId: string) {
        return this.permissionsByModule(moduleId)();
      },

      permissionGroupsByModuleSync(moduleId: string) {
        return this.permissionGroupsByModule(moduleId)();
      },

      hasCustomRolesInModuleSync(moduleId: string) {
        return this.hasCustomRolesInModule(moduleId)();
      },

      getRoleByIdSync(roleId: string) {
        return this.getRoleById(roleId)();
      },

      getModuleByIdSync(moduleId: string) {
        return this.getModuleById(moduleId)();
      },
    };
  }),
);
