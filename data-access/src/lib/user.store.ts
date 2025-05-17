import { inject, computed, Signal } from '@angular/core';
import { patchState, signalStore, withMethods, withComputed, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap, catchError, of } from 'rxjs'; // Adicionado of e catchError

import { LoggingService } from '@vai/services';
import { withLoading, withPagination } from '@vai/store-feature'; // Seus features
import { UserFilters, UserService } from '@auth/utils';
import { User } from './models';

interface UserState {
  users: User[];
  selectedUser: User | null;
  total: number;
  filters: UserFilters;
}

const initialState: UserState = {
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

export const UserStore = signalStore(
  withState(initialState),
  withLoading(),
  withPagination(),
  withComputed(({ users, filters }) => ({
    activeUsers: computed(() => users().filter((user) => user.isActive)),
    inactiveUsers: computed(() => users().filter((user) => !user.isActive)),
    hasActiveFilters: computed(() => {
      const f = filters();
      return !!f.search || f.active !== null || !!f.roleId || !!f.moduleId;
    }),
  })),
  withMethods((store) => {
    const userService = inject(UserService);
    const loggingService = inject(LoggingService);

    const usersByRoleCache = new Map<string, Signal<User[]>>();
    const usersInModuleCache = new Map<string, Signal<User[]>>();

    const methods = {
      getUsersByRole(moduleId: string, roleName: string): Signal<User[]> {
        const cacheKey = `${moduleId}:${roleName}`;
        if (!usersByRoleCache.has(cacheKey)) {
          usersByRoleCache.set(
            cacheKey,
            computed(() => store.users().filter((user) => user.roles.some((r) => r.moduleId === moduleId && r.role === roleName))),
          );
        }
        return usersByRoleCache.get(cacheKey)!;
      },
      getUsersInModule(moduleId: string): Signal<User[]> {
        if (!usersInModuleCache.has(moduleId)) {
          usersInModuleCache.set(
            moduleId,
            computed(() => store.users().filter((user) => user.roles.some((r) => r.moduleId === moduleId))),
          );
        }
        return usersInModuleCache.get(moduleId)!;
      },

      getUsersByRoleSync(moduleId: string, roleName: string): User[] {
        return methods.getUsersByRole(moduleId, roleName)();
      },
      getUsersInModuleSync(moduleId: string): User[] {
        return methods.getUsersInModule(moduleId)();
      },

      loadUsers: rxMethod<void>(
        pipe(
          tap(() =>
            loggingService.debug('UserStore: Carregando usuários', {
              page: store.page(),
              pageSize: store.pageSize(),
              filters: store.filters(),
            }),
          ),
          switchMap(() => {
            const { page, pageSize } = store;
            const currentFilters = store.filters();
            return store.trackLoadingWithError(
              'users',
              userService.getUsers(page(), pageSize(), currentFilters).pipe(
                tap({
                  next: (response) => {
                    patchState(store, { users: response.users, total: response.total });
                    loggingService.debug('UserStore: Usuários carregados', { count: response.users.length, total: response.total });
                  },
                }),
              ),
            );
          }),
        ),
      ),

      loadUser: rxMethod<string>(
        pipe(
          tap((userId) => loggingService.debug('UserStore: Carregando usuário', { userId })),
          switchMap((userId) =>
            store.trackLoadingWithError(
              `user-${userId}`,
              userService.getUserById(userId).pipe(
                tap({
                  next: (user) => patchState(store, { selectedUser: user }),
                }),
              ),
            ),
          ),
        ),
      ),

      createUser: rxMethod<Partial<User>>(
        pipe(
          tap((userData) => loggingService.debug('UserStore: Criando usuário', userData)),
          switchMap((userData) =>
            store.trackLoadingWithError(
              'create-user',
              userService.createUser(userData).pipe(
                tap({
                  next: (newUser) => {
                    patchState(store, (state) => ({
                      users: [...state.users, newUser],
                      total: state.total + 1,
                      selectedUser: newUser,
                    }));
                  },
                }),
              ),
            ),
          ),
        ),
      ),

      updateUser: rxMethod<{ userId: string; data: Partial<User> }>(
        pipe(
          tap((payload) => loggingService.debug('UserStore: Atualizando usuário', payload)),
          switchMap(({ userId, data }) =>
            store.trackLoadingWithError(
              `update-user-${userId}`,
              userService.updateUser(userId, data).pipe(
                tap({
                  next: (updatedUser) => {
                    patchState(store, (state) => ({
                      users: state.users.map((u) => (u.id === userId ? updatedUser : u)),
                      selectedUser: state.selectedUser?.id === userId ? updatedUser : state.selectedUser,
                    }));
                  },
                }),
              ),
            ),
          ),
        ),
      ),

      deleteUser: rxMethod<string>(
        pipe(
          tap((userId) => loggingService.debug('UserStore: Excluindo usuário', { userId })),
          switchMap((userId) =>
            store.trackLoadingWithError(
              `delete-user-${userId}`,
              userService.deleteUser(userId).pipe(
                tap({
                  next: () => {
                    patchState(store, (state) => ({
                      users: state.users.filter((u) => u.id !== userId),
                      total: state.total > 0 ? state.total - 1 : 0,
                      selectedUser: state.selectedUser?.id === userId ? null : state.selectedUser,
                    }));
                  },
                }),
              ),
            ),
          ),
        ),
      ),

      assignRole: rxMethod<{ userId: string; moduleId: string; role: string }>(
        pipe(
          tap((payload) => loggingService.debug('UserStore: Atribuindo papel', payload)),
          switchMap(({ userId, moduleId, role }) =>
            store.trackLoadingWithError(
              `assign-role-${userId}-${moduleId}-${role}`,
              userService.assignRole(userId, moduleId, role).pipe(
                tap({
                  next: (updatedUser) => {
                    // API retorna o User atualizado
                    patchState(store, (state) => ({
                      users: state.users.map((u) => (u.id === userId ? updatedUser : u)),
                      selectedUser: state.selectedUser?.id === userId ? updatedUser : state.selectedUser,
                    }));
                  },
                }),
              ),
            ),
          ),
        ),
      ),

      removeRole: rxMethod<{ userId: string; moduleId: string; roleId: string }>(
        pipe(
          tap((payload) => loggingService.debug('UserStore: Removendo papel', payload)),
          switchMap(({ userId, moduleId, roleId }) =>
            store.trackLoadingWithError(
              `remove-role-${userId}-${moduleId}-${roleId}`,
              userService.removeRole(userId, moduleId, roleId).pipe(
                tap({
                  next: (updatedUser) => {
                    patchState(store, (state) => ({
                      users: state.users.map((u) => (u.id === userId ? updatedUser : u)),
                      selectedUser: state.selectedUser?.id === userId ? updatedUser : state.selectedUser,
                    }));
                  },
                }),
              ),
            ),
          ),
        ),
      ),

      setFilters(filters: Partial<UserFilters>) {
        patchState(store, (state) => ({
          filters: { ...state.filters, ...filters },
          page: 1, // Reseta para a primeira página ao aplicar filtros
        }));
        methods.loadUsers(); // Recarrega os usuários com os novos filtros/página
      },
      clearFilters() {
        patchState(store, {
          filters: { search: '', active: null, roleId: null, moduleId: null },
          page: 1,
        });
        methods.loadUsers();
      },
      clearSelection() {
        patchState(store, { selectedUser: null });
      },
    };
    return methods;
  }),
);
