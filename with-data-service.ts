// with-data-service.ts - versão corrigida
import { SignalStoreFeature, patchState, signalStoreFeature, withMethods } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { Observable, of, pipe, switchMap } from 'rxjs';

export interface DataServiceConfig<T> {
  idKey?: keyof T;
  entitiesKey?: string;
  entityName?: string;
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
      const dataService = store.dataService;
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
        loadAll: rxMethod<void | { silent?: boolean }>(
          pipe(
            switchMap((options) => {
              // Garantir que options é um objeto
              const opts = options || {};
              const operationKey = `loadAll_${entityName}`;

              if (!opts.silent) {
                logger.debug(`DataService: Loading all ${entityName}s`);
              }

              if (!dataService[methods.getAll]) {
                logger.warn(`DataService: Method ${methods.getAll} not found in service`);
                return of([]);
              }

              return trackCall(operationKey, dataService[methods.getAll](), {
                onSuccess: (items: T[]) => {
                  if (store[entitiesKey]) {
                    patchState(store, { [entitiesKey]: items });

                    if (!opts.silent) {
                      logger.debug(`DataService: Loaded ${items.length} ${entityName}s`);
                    }
                  }
                },
              });
            }),
          ),
        ),

        // Carregar um item por ID
        loadById: rxMethod<IdType>(
          pipe(
            switchMap((id) => {
              const operationKey = `loadById_${entityName}_${id}`;

              logger.debug(`DataService: Loading ${entityName} by id: ${id}`);

              if (!dataService[methods.getById]) {
                logger.warn(`DataService: Method ${methods.getById} not found in service`);
                return of(null);
              }

              return trackCall(operationKey, dataService[methods.getById](id), {
                onSuccess: (item: T) => {
                  if (item && store[entitiesKey]) {
                    store.upsertEntity(item);
                    logger.debug(`DataService: Loaded ${entityName} with id: ${id}`);
                  }
                },
              });
            }),
          ),
        ),

        // Criar um novo item
        create: rxMethod<Partial<T>>(
          pipe(
            switchMap((data) => {
              const operationKey = `create_${entityName}`;

              logger.debug(`DataService: Creating new ${entityName}`, data);

              if (!dataService[methods.create]) {
                logger.warn(`DataService: Method ${methods.create} not found in service`);
                return of(null);
              }

              return trackCall(operationKey, dataService[methods.create](data), {
                onSuccess: (newItem: T) => {
                  if (newItem && store[entitiesKey]) {
                    store.addEntity(newItem);
                    logger.debug(`DataService: Created ${entityName} with id: ${String(newItem[idKey])}`);
                  }
                },
              });
            }),
          ),
        ),

        // Atualizar um item existente
        update: rxMethod<{ id: IdType; data: Partial<T> }>(
          pipe(
            switchMap(({ id, data }) => {
              const operationKey = `update_${entityName}_${id}`;

              logger.debug(`DataService: Updating ${entityName} with id: ${id}`, data);

              if (!dataService[methods.update]) {
                logger.warn(`DataService: Method ${methods.update} not found in service`);
                return of(null);
              }

              return trackCall(operationKey, dataService[methods.update](id, data), {
                onSuccess: (updatedItem: T) => {
                  if (updatedItem && store[entitiesKey]) {
                    store.updateEntity(id, updatedItem);
                    logger.debug(`DataService: Updated ${entityName} with id: ${id}`);
                  }
                },
              });
            }),
          ),
        ),

        // Excluir um item
        delete: rxMethod<IdType>(
          pipe(
            switchMap((id) => {
              const operationKey = `delete_${entityName}_${id}`;

              logger.debug(`DataService: Deleting ${entityName} with id: ${id}`);

              if (!dataService[methods.delete]) {
                logger.warn(`DataService: Method ${methods.delete} not found in service`);
                return of(null);
              }

              return trackCall(operationKey, dataService[methods.delete](id), {
                onSuccess: () => {
                  if (store[entitiesKey]) {
                    store.removeEntity(id);
                    logger.debug(`DataService: Deleted ${entityName} with id: ${id}`);
                  }
                },
              });
            }),
          ),
        ),

        // Pesquisar itens
        search: rxMethod<any>(
          pipe(
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
