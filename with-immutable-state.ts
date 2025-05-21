import { signalStoreFeature, patchState, withMethods } from '@ngrx/signals';

export function withImmutableState() {
  return signalStoreFeature(
    withMethods((store) => ({
      updateDeep<T>(propertyPath: string | string[], value: T): void {
        const path = Array.isArray(propertyPath) ? propertyPath : propertyPath.split('.');

        patchState(store, (state) => {
          const clonedState = { ...state };
          let current = clonedState;

          // Navega até o penúltimo nível
          for (let i = 0; i < path.length - 1; i++) {
            const key = path[i];
            current[key] = current[key] !== null && typeof current[key] === 'object' ? { ...current[key] } : {};
            current = current[key];
          }

          // Define o valor final
          current[path[path.length - 1]] = value;

          return clonedState;
        });
      },

      updateCollectionItem<T>(collectionKey: string, itemId: any, updater: (item: T) => T, idKey: string = 'id'): void {
        patchState(store, (state) => {
          const collection = state[collectionKey] || [];
          return {
            [collectionKey]: collection.map((item: any) => (item[idKey] === itemId ? updater(item) : item)),
          };
        });
      },

      removeCollectionItem(collectionKey: string, itemId: any, idKey: string = 'id'): void {
        patchState(store, (state) => {
          const collection = state[collectionKey] || [];
          return {
            [collectionKey]: collection.filter((item: any) => item[idKey] !== itemId),
          };
        });
      },

      addCollectionItem<T>(collectionKey: string, item: T): void {
        patchState(store, (state) => {
          const collection = state[collectionKey] || [];
          return {
            [collectionKey]: [...collection, item],
          };
        });
      },

      batchUpdateCollection<T>(collectionKey: string, operation: (items: T[]) => T[]): void {
        patchState(store, (state) => {
          const collection = state[collectionKey] || [];
          return {
            [collectionKey]: operation([...collection]),
          };
        });
      },
    })),
  );
}
