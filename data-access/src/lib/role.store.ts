import { inject, computed, Signal } from '@angular/core';
import { signalStore, withState, withComputed, patchState, withMethods } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap, catchError, of } from 'rxjs';

import { withLoading } from '@vai/store-feature';
import { LoggingService } from '@vai/services';
import { RoleService } from '@auth/utils';
import { Role, Module, Permission, PermissionGroup } from './models';

interface RoleStoreSpecificState {
  roles: Role[];
  modules: Module[];
  permissions: Permission[];
  permissionGroups: PermissionGroup[];
}

const initialState: RoleStoreSpecificState = {
  roles: [],
  modules: [],
  permissions: [],
  permissionGroups: [],
};

export const RoleStore = signalStore(
  withState(initialState),
  withLoading(),
  withComputed(({ roles, modules }) => ({
    activeRoles: computed(() => roles().filter((role) => role.isActive)),
    activeModules: computed(() => modules().filter((module) => module.isActive)),
  })),
  withMethods((store) => {
    const roleService = inject(RoleService);
    const loggingService = inject(LoggingService);

    const rolesByModuleCache = new Map<string, Signal<Role[]>>();
    const permissionsByModuleCache = new Map<string, Signal<Permission[]>>();
    const permissionGroupsByModuleCache = new Map<string, Signal<PermissionGroup[]>>();
    const hasCustomRolesCache = new Map<string, Signal<boolean>>();
    const roleByIdCache = new Map<string, Signal<Role | null>>();
    const moduleByIdCache = new Map<string, Signal<Module | null>>();

    const methods = {
      rolesByModule(moduleId: string): Signal<Role[]> {
        if (!rolesByModuleCache.has(moduleId)) {
          rolesByModuleCache.set(
            moduleId,
            computed(() => store.roles().filter((role) => role.moduleId === moduleId)),
          );
        }
        return rolesByModuleCache.get(moduleId)!;
      },
      permissionsByModule(moduleId: string): Signal<Permission[]> {
        if (!permissionsByModuleCache.has(moduleId)) {
          permissionsByModuleCache.set(
            moduleId,
            computed(() => store.permissions().filter((permission) => permission.moduleId === moduleId)),
          );
        }
        return permissionsByModuleCache.get(moduleId)!;
      },
      permissionGroupsByModule(moduleId: string): Signal<PermissionGroup[]> {
        if (!permissionGroupsByModuleCache.has(moduleId)) {
          permissionGroupsByModuleCache.set(
            moduleId,
            computed(() => store.permissionGroups().filter((group) => group.moduleId === moduleId)),
          );
        }
        return permissionGroupsByModuleCache.get(moduleId)!;
      },
      hasCustomRolesInModule(moduleId: string): Signal<boolean> {
        if (!hasCustomRolesCache.has(moduleId)) {
          hasCustomRolesCache.set(
            moduleId,
            computed(() => store.roles().some((role) => role.moduleId === moduleId && !role.isSystemRole)),
          );
        }
        return hasCustomRolesCache.get(moduleId)!;
      },
      getRoleById(roleId: string): Signal<Role | null> {
        if (!roleByIdCache.has(roleId)) {
          roleByIdCache.set(
            roleId,
            computed(() => store.roles().find((role) => role.id === roleId) || null),
          );
        }
        return roleByIdCache.get(roleId)!;
      },
      getModuleById(moduleId: string): Signal<Module | null> {
        if (!moduleByIdCache.has(moduleId)) {
          moduleByIdCache.set(
            moduleId,
            computed(() => store.modules().find((module) => module.id === moduleId) || null),
          );
        }
        return moduleByIdCache.get(moduleId)!;
      },

      rolesByModuleSync(moduleId: string): Role[] {
        return methods.rolesByModule(moduleId)();
      },
      permissionsByModuleSync(moduleId: string): Permission[] {
        return methods.permissionsByModule(moduleId)();
      },
      permissionGroupsByModuleSync(moduleId: string): PermissionGroup[] {
        return methods.permissionGroupsByModule(moduleId)();
      },
      hasCustomRolesInModuleSync(moduleId: string): boolean {
        return methods.hasCustomRolesInModule(moduleId)();
      },
      getRoleByIdSync(roleId: string): Role | null {
        return methods.getRoleById(roleId)();
      },
      getModuleByIdSync(moduleId: string): Module | null {
        return methods.getModuleById(moduleId)();
      },

      loadModules: rxMethod<void>(
        pipe(
          switchMap(() =>
            store.trackLoadingWithError(
              'modules',
              roleService.getModules().pipe(
                tap({
                  next: (modulesData) => {
                    patchState(store, { modules: modulesData });
                    loggingService.debug('RoleStore: Módulos carregados', { count: modulesData.length });
                    // store.setLoaded?.('modules', true); // Se seu withLoading tiver setLoaded
                  },
                }),
              ),
            ),
          ),
        ),
      ),

      loadRolesByModule: rxMethod<string>(
        pipe(
          tap((moduleId) => loggingService.debug('RoleStore: Iniciando carregamento de papéis para o módulo', { moduleId })),
          switchMap((moduleId) =>
            store.trackLoadingWithError(
              `roles-${moduleId}`,
              roleService.getRolesByModule(moduleId).pipe(
                tap({
                  next: (rolesData) => {
                    const currentRoles = store.roles().filter((role) => role.moduleId !== moduleId);
                    patchState(store, { roles: [...currentRoles, ...rolesData] });
                    loggingService.debug('RoleStore: Papéis do módulo carregados', { moduleId, count: rolesData.length });
                  },
                }),
              ),
            ),
          ),
        ),
      ),

      loadRole: rxMethod<string>(
        pipe(
          tap((roleId) => loggingService.debug('RoleStore: Iniciando carregamento do papel', { roleId })),
          switchMap((roleId) =>
            store.trackLoadingWithError(
              `role-${roleId}`,
              roleService.getRoleById(roleId).pipe(
                tap({
                  next: (roleData) => {
                    const currentRoles = store.roles();
                    const roleIndex = currentRoles.findIndex((r) => r.id === roleId);
                    if (roleIndex >= 0) {
                      const updatedRoles = [...currentRoles];
                      updatedRoles[roleIndex] = roleData;
                      patchState(store, { roles: updatedRoles });
                    } else {
                      patchState(store, { roles: [...currentRoles, roleData] });
                    }
                    loggingService.debug('RoleStore: Papel carregado', { roleId });
                  },
                }),
              ),
            ),
          ),
        ),
      ),

      createRole: rxMethod<Partial<Role>>(
        pipe(
          tap((roleData) => loggingService.debug('RoleStore: Iniciando criação de papel', roleData)),
          switchMap((roleData) =>
            store.trackLoadingWithError(
              'create-role',
              roleService.createRole(roleData).pipe(
                tap({
                  next: (newRole) => {
                    patchState(store, (state) => ({ roles: [...state.roles, newRole] }));
                    loggingService.debug('RoleStore: Novo papel criado', { roleId: newRole.id });
                  },
                }),
              ),
            ),
          ),
        ),
      ),

      initializeRoleManagement: rxMethod<void>(
        pipe(
          tap(() => loggingService.debug('RoleStore: Inicializando gerenciamento de papéis')),
          switchMap(() =>
            store.trackLoadingWithError(
              'initializeRoleManagement', // Chave única para esta operação
              roleService.getModules().pipe(
                tap({
                  next: (modulesData) => {
                    patchState(store, { modules: modulesData });
                    loggingService.debug('RoleStore: Módulos carregados na inicialização', { count: modulesData.length });
                    // Aqui você poderia disparar o carregamento de papéis para os módulos ativos, por exemplo
                    // modulesData.filter(m => m.isActive).forEach(m => methods.loadRolesByModule(m.id));
                  },
                }),
              ),
            ),
          ),
        ),
      ),
    };
    return methods;
  }),
);
