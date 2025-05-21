import { patchState, signalStoreFeature, withMethods } from '@ngrx/signals';

export function withEntityHelpers<T extends { [key: string]: any }>(entitiesKey: string = 'entities', idKey: keyof T = 'id' as keyof T) {
  return signalStoreFeature(
    withMethods((store) => ({
      addEntity(entity: T): void {
        patchState(store, (state) => {
          const entities = state[entitiesKey] || [];
          return {
            [entitiesKey]: [...entities, entity],
          };
        });
      },

      updateEntity(id: any, entity: T): void {
        patchState(store, (state) => {
          const entities = state[entitiesKey] || [];
          return {
            [entitiesKey]: entities.map((item: T) => (item[idKey] === id ? entity : item)),
          };
        });
      },

      removeEntity(id: any): void {
        patchState(store, (state) => {
          const entities = state[entitiesKey] || [];
          return {
            [entitiesKey]: entities.filter((item: T) => item[idKey] !== id),
          };
        });
      },

      upsertEntity(entity: T): void {
        patchState(store, (state) => {
          const entities = state[entitiesKey] || [];
          const id = entity[idKey];
          const index = entities.findIndex((item: T) => item[idKey] === id);

          if (index >= 0) {
            // Update
            const updatedEntities = [...entities];
            updatedEntities[index] = entity;
            return { [entitiesKey]: updatedEntities };
          } else {
            // Insert
            return { [entitiesKey]: [...entities, entity] };
          }
        });
      },

      upsertEntities(entities: T[]): void {
        if (!entities.length) return;

        patchState(store, (state) => {
          const currentEntities = state[entitiesKey] || [];
          const result = [...currentEntities];

          entities.forEach((entity) => {
            const id = entity[idKey];
            const index = result.findIndex((item: T) => item[idKey] === id);

            if (index >= 0) {
              // Update
              result[index] = entity;
            } else {
              // Insert
              result.push(entity);
            }
          });

          return { [entitiesKey]: result };
        });
      },

      setEntities(entities: T[]): void {
        patchState(store, {
          [entitiesKey]: entities,
        });
      },
    })),
  );
}
