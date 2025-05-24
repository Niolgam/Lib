// with-data-service.ts - versão corrigida
import { SignalStoreFeature, patchState, signalStoreFeature, withMethods } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { debounceTime, distinctUntilChanged, Observable, of, pipe, switchMap } from 'rxjs';
import { createDualMethods, createParametrizedDualMethods } from '@vai/utils';

export interface DataServiceConfig<T> {
  idKey?: keyof T;
  entitiesKey?: string;
  entityName?: string;
  serviceKey?: string;
  methods?: {
    getAll?: string;
    getById?: string;
    create?: string;
    update?: string;
    delete?: string;
    search?: string;
  };
  logging?: boolean;
}

export function withDataService<T extends object, IdType = string>(config: DataServiceConfig<T> = {}): SignalStoreFeature {
  const {
    idKey = 'id' as keyof T,
    entitiesKey = 'entities',
    entityName = 'item',
    serviceKey = 'dataService',
    methods = {
      getAll: 'getAll',
      getById: 'getById',
      create: 'create',
      update: 'update',
      delete: 'delete',
      search: 'search',
    },
    logging = true,
  } = config;

  return signalStoreFeature(
    withMethods((store: any) => {
      // Acesso aos serviços injetados via props
      const dataService = store[serviceKey];

      if (!dataService) {
        throw new Error(`Service '${serviceKey}' not found in store. Make sure to inject it in withProps().`);
      }

      const logger =
        logging && store.loggingService
          ? store.loggingService
          : {
              debug: () => {},
              info: () => {},
              warn: () => {},
              error: () => {},
            };

      // Verifica se o store tem trackCall
      const trackCall = store.trackCall?.bind(store) || ((key: string, obs: Observable<any>) => obs);

      return {
        // Carregar todos os itens
        ...createDualMethods(store, {
          operationName: 'loadAll',
          serviceCall: dataService[methods.getAll](),
          onSuccess: (items: T[]) => {
            if (store[entitiesKey]) {
              patchState(store, { [entitiesKey]: items });
              logger.debug(`DataService: Loaded ${items.length} ${entityName}s`);
            }
          },
          logMessage: `Loading all ${entityName}s`,
        }),

        // Gera: loadById(id) e loadById$(id)
        ...createParametrizedDualMethods<T, IdType>(
          store,
          'loadById',
          (id: IdType) => {
            if (!dataService[methods.getById]) {
              logger.warn(`DataService: Method ${methods.getById} not found in service`);
              throw new Error(`Method ${methods.getById} not found`);
            }
            return dataService[methods.getById](id);
          },
          (item: T, id: IdType) => {
            if (item && store[entitiesKey]) {
              store.upsertEntity(item);
              logger.debug(`DataService: Loaded ${entityName} with id: ${id}`);
            }
          },
          (id: IdType) => `Loading ${entityName} by id: ${id}`,
        ),

        // Gera: create(data) e create$(data)
        ...createParametrizedDualMethods<T, Partial<T>>(
          store,
          'create',
          (data: Partial<T>) => {
            if (!dataService[methods.create]) {
              logger.warn(`DataService: Method ${methods.create} not found in service`);
              throw new Error(`Method ${methods.create} not found`);
            }
            return dataService[methods.create](data);
          },
          (newItem: T, data: Partial<T>) => {
            if (newItem && store[entitiesKey]) {
              store.addEntity(newItem);
              logger.debug(`DataService: Created ${entityName} with id: ${String(newItem[idKey])}`);
            }
          },
          () => `Creating new ${entityName}`,
        ),

        // Gera: update(id, data) e update$(id, data)
        ...createParametrizedDualMethods<T, { id: IdType; data: Partial<T> }>(
          store,
          'update',
          ({ id, data }) => {
            if (!dataService[methods.update]) {
              logger.warn(`DataService: Method ${methods.update} not found in service`);
              throw new Error(`Method ${methods.update} not found`);
            }
            return dataService[methods.update](id, data);
          },
          (updatedItem: T, { id }) => {
            if (updatedItem && store[entitiesKey]) {
              store.updateEntity(id, updatedItem);
              logger.debug(`DataService: Updated ${entityName} with id: ${id}`);
            }
          },
          ({ id }) => `Updating ${entityName} with id: ${id}`,
        ),

        // Gera: delete(id) e delete$(id)
        ...createParametrizedDualMethods<void, IdType>(
          store,
          'delete',
          (id: IdType) => {
            if (!dataService[methods.delete]) {
              logger.warn(`DataService: Method ${methods.delete} not found in service`);
              throw new Error(`Method ${methods.delete} not found`);
            }
            return dataService[methods.delete](id);
          },
          (_, id: IdType) => {
            if (store[entitiesKey]) {
              store.removeEntity(id);
              logger.debug(`DataService: Deleted ${entityName} with id: ${id}`);
            }
          },
          (id: IdType) => `Deleting ${entityName} with id: ${id}`,
        ),

        // 🔍 rxMethod: Para search com debounce + cancelamento
        search: rxMethod<any>(
          pipe(
            debounceTime(300),
            distinctUntilChanged((prev, curr) => JSON.stringify(prev) === JSON.stringify(curr)),
            switchMap((params) => {
              const operationKey = `search_${entityName}`;

              logger.debug(`DataService: Searching ${entityName}s with params:`, params);

              if (!dataService[methods.search]) {
                logger.warn(`DataService: Method ${methods.search} not found in service`);
                return of({ items: [], total: 0 });
              }

              return trackCall(operationKey, dataService[methods.search](params), {
                onSuccess: (result: any) => {
                  if (store[entitiesKey]) {
                    // Assumindo que o resultado tem formato { items, total }
                    if (result.items) {
                      patchState(store, {
                        [entitiesKey]: result.items,
                        total: result.total || result.items.length,
                      });
                    } else {
                      // Caso o resultado seja apenas um array
                      patchState(store, {
                        [entitiesKey]: result,
                        total: result.length,
                      });
                    }

                    logger.debug(`DataService: Found ${result.items?.length || result.length} ${entityName}s`);
                  }
                },
              });
            }),
          ),
        ),
      };
    }),
  );
}
