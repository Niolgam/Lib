// user.store.ts
import { inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withProps, withState } from '@ngrx/signals';
import { computed } from '@angular/core';

import { withCallState, withDataService, withEntityHelpers, withImmutableState, withPagination } from '@vai/store-feature';

import { UserFilters, UserService } from '@auth/utils';
import { LoggingService } from '@vai/services';
import { User, UserRoleAssignmentInfo } from './models';

interface UserStoreState {
  users: User[];
  selectedUser: User | null;
  total: number;
  filters: UserFilters;
}

const initialState: UserStoreState = {
  users: [],
  selectedUser: null,
  total: 0,
  filters: {
    search: '',
    active: null,
    roleId: null,
    moduleId: null,
  },
};

/**
 * UserStore - Centraliza toda lógica relacionada aos usuários
 * Implementa BaseStore e EntityStore para garantir interface consistente
 */
export const UserStore = signalStore(
  withState(initialState),
  withProps(() => ({
    dataService: inject(UserService),
    loggingService: inject(LoggingService),
  })),
  withCallState(),
  withPagination(),
  withImmutableState(),
  withEntityHelpers<User>('users'),
  withDataService<User>({
    entityName: 'user',
    entitiesKey: 'users',
    methods: {
      getAll: 'getUsers',
      getById: 'getUserById',
      create: 'createUser',
      update: 'updateUser',
      delete: 'deleteUser',
      search: 'searchUsers',
    },
  }),
  withComputed(({ users, filters, selectedUser }) => ({
    // Computeds existentes
    activeUsers: computed(() => users().filter((user) => user.isActive)),
    inactiveUsers: computed(() => users().filter((user) => !user.isActive)),
    hasActiveFilters: computed(() => {
      const f = filters();
      return !!f.search || f.active !== null || !!f.roleId || !!f.moduleId;
    }),
    // Para implementar BaseStore interface
    state: computed(() => ({
      users: users(),
      selectedUser: selectedUser(),
      filters: filters(),
    })),
  })),

  // Métodos públicos
  withMethods((store) => {
    return {
      // Implementação da interface BaseStore
      initialize() {
        store.loggingService.debug('UserStore: Initializing');
        this.loadUsers();
      },

      reset() {
        patchState(store, initialState);
        store.loggingService.debug('UserStore: Reset to initial state');
      },

      // Implementação de EntityStore
      getById(id: string) {
        return computed(() => store.users().find((user) => user.id === id) || null);
      },

      getByIdSync(id: string) {
        return this.getById(id)();
      },

      // Carregar usuários com filtros e paginação
      loadUsers() {
        const { page, pageSize, filters } = store;

        store.loggingService.debug('UserStore: Loading users', {
          page: page(),
          pageSize: pageSize(),
          filters: filters(),
        });

        // Usar search do DataService com os parâmetros corretos
        this.search({
          page: page(),
          pageSize: pageSize(),
          ...filters(),
        });
      },

      // Definir filtros
      setFilters(filters: Partial<UserFilters>) {
        patchState(store, (state) => ({
          filters: { ...state.filters, ...filters },
          page: 1, // Reseta para a primeira página
        }));

        this.loadUsers();
      },

      // Limpar filtros
      clearFilters() {
        patchState(store, {
          filters: { search: '', active: null, roleId: null, moduleId: null },
          page: 1,
        });

        this.loadUsers();
      },

      // Obter usuário específico e definir como selecionado
      loadUser(userId: string) {
        store.loggingService.debug('UserStore: Loading user', { userId });

        store.trackCall(`loadUser_${userId}`, store.dataService.getUserById(userId), {
          onSuccess: (user: User) => {
            // Atualiza o usuário na lista de usuários
            this.upsertEntity(user);
            // Define o usuário como selecionado
            patchState(store, { selectedUser: user });
          },
        });
      },

      // Métodos específicos para papéis de usuário
      getUsersByRole(moduleId: string, roleName: string): User[] {
        return store.users().filter((user) => user.roles.some((r) => r.moduleId === moduleId && r.role === roleName));
      },

      getUsersInModule(moduleId: string): User[] {
        return store.users().filter((user) => user.roles.some((r) => r.moduleId === moduleId));
      },

      // Versões síncronas para uso em templates
      getUsersByRoleSync(moduleId: string, roleName: string): User[] {
        return this.getUsersByRole(moduleId, roleName);
      },

      getUsersInModuleSync(moduleId: string): User[] {
        return this.getUsersInModule(moduleId);
      },

      // Atribuição de papel
      assignRole(params: { userId: string; moduleId: string; role: string }) {
        const { userId, moduleId, role } = params;
        const operationKey = `assignRole_${userId}_${moduleId}_${role}`;

        store.loggingService.debug('UserStore: Assigning role', params);

        return store.trackCall(operationKey, store.dataService.assignRole(userId, moduleId, role), {
          onSuccess: (updatedUser: User) => {
            // Atualizar o usuário na lista
            this.upsertEntity(updatedUser);

            // Se for o usuário selecionado, atualizar também
            if (store.selectedUser()?.id === userId) {
              patchState(store, { selectedUser: updatedUser });
            }

            store.loggingService.debug('UserStore: Role assigned successfully', {
              userId,
              role: `${moduleId}:${role}`,
            });
          },
        });
      },

      // Remoção de papel
      removeRole(params: { userId: string; moduleId: string; roleId: string }) {
        const { userId, moduleId, roleId } = params;
        const operationKey = `removeRole_${userId}_${moduleId}_${roleId}`;

        store.loggingService.debug('UserStore: Removing role', params);

        return store.trackCall(operationKey, store.dataService.removeRole(userId, moduleId, roleId), {
          onSuccess: (updatedUser: User) => {
            // Atualizar o usuário na lista
            this.upsertEntity(updatedUser);

            // Se for o usuário selecionado, atualizar também
            if (store.selectedUser()?.id === userId) {
              patchState(store, { selectedUser: updatedUser });
            }

            store.loggingService.debug('UserStore: Role removed successfully', {
              userId,
              role: `${moduleId}:${roleId}`,
            });
          },
        });
      },

      // Atualizar com novo papéis (para uso em formulários com múltiplos papéis)
      updateUserRoles(userId: string, roles: UserRoleAssignmentInfo[]) {
        const operationKey = `updateUserRoles_${userId}`;
        store.loggingService.debug('UserStore: Updating user roles', { userId, roleCount: roles.length });

        return store.trackCall(operationKey, store.dataService.updateUserRoles(userId, roles), {
          onSuccess: (updatedUser: User) => {
            // Atualizar o usuário na lista
            this.upsertEntity(updatedUser);

            // Se for o usuário selecionado, atualizar também
            if (store.selectedUser()?.id === userId) {
              patchState(store, { selectedUser: updatedUser });
            }

            store.loggingService.debug('UserStore: User roles updated successfully', { userId });
          },
        });
      },
    };
  }),
);
