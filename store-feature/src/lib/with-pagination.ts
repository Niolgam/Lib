import { computed } from '@angular/core';
import { signalStoreFeature, withState, withComputed, patchState, withMethods } from '@ngrx/signals';

export interface PaginationState {
  page: number;
  pageSize: number;
  pageSizeOptions: number[];
  total: number;
}

export const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export function withPagination(initialPageSize = 10) {
  return signalStoreFeature(
    withState<PaginationState>({
      page: 1,
      pageSize: initialPageSize,
      pageSizeOptions: DEFAULT_PAGE_SIZE_OPTIONS,
      total: 0, // Inicializando com 0 em vez de 1
    }),
    withComputed((state) => {
      // Retorna objeto diretamente em vez de usar 'as const'
      return {
        totalPages: computed(() => {
          if (!state.total()) return 1;
          return Math.ceil(state.total() / state.pageSize());
        }),
        hasNextPage: computed(() => {
          // Usando referência local para totalPages para evitar recomputação
          const totalPagesValue = Math.ceil(state.total() / state.pageSize());
          return state.page() < totalPagesValue;
        }),
        hasPreviousPage: computed(() => state.page() > 1),
        rangeStart: computed(() => (state.page() - 1) * state.pageSize() + 1),
        rangeEnd: computed(() => {
          const end = state.page() * state.pageSize();
          return end > state.total() ? state.total() : end;
        }),
        pageSizes: computed(() => state.pageSizeOptions()),
      };
    }),
    withMethods((store) => {
      // Usando constante para o objeto de métodos
      const methods = {
        goToPage(page: number) {
          // Usando uma referência local para totalPages para evitar problemas
          const totalPages = Math.ceil(store.total() / store.pageSize());
          if (page < 1 || page > totalPages) {
            return;
          }
          patchState(store, { page });
        },
        nextPage() {
          const totalPages = Math.ceil(store.total() / store.pageSize());
          if (store.page() < totalPages) {
            patchState(store, { page: store.page() + 1 });
          }
        },
        previousPage() {
          if (store.page() > 1) {
            patchState(store, { page: store.page() - 1 });
          }
        },
        setPageSize(size: number) {
          if (store.pageSizeOptions().includes(size)) {
            // Calculando nova página para manter aproximadamente a mesma posição
            const currentFirstItem = (store.page() - 1) * store.pageSize() + 1;
            const newPage = Math.ceil(currentFirstItem / size);
            patchState(store, {
              pageSize: size,
              page: newPage,
            });
          }
        },
        setPageSizeOptions(options: number[]) {
          patchState(store, { pageSizeOptions: options });
        },
      };

      return methods; // Retorna diretamente o objeto, sem spread
    }),
  );
}
