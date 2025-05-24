import { Observable } from 'rxjs';

export interface DualMethodConfig<T> {
  operationName: string;
  serviceCall: Observable<T>;
  onSuccess: (data: T) => void;
  logMessage?: string;
}

export function createDualMethods<T>(store: any, config: DualMethodConfig<T>): { [key: string]: any } {
  const { operationName, serviceCall, onSuccess, logMessage } = config;

  const _internalMethod = (returnResult = false) => {
    const operationKey = operationName;
    const message = logMessage || `${operationName}${returnResult ? '' : ' (fire-and-forget)'}`;

    store.loggingService.debug(`Store: ${message}`);

    const operation = store.trackCall(operationKey, serviceCall, {
      onSuccess: (data: T) => {
        onSuccess(data);
        store.loggingService.debug(`Store: ${operationName} completed`);
      },
    });

    return returnResult ? operation : undefined;
  };

  return {
    // Método SYNC
    [operationName]: () => _internalMethod(true),

    // Método FIRE-AND-FORGET
    [`${operationName}$`]: (): void => _internalMethod(false),
  };
}

// 🏭 FACTORY com Parâmetros
export function createParametrizedDualMethods<T, P>(
  store: any,
  operationName: string,
  serviceCallFactory: (params: P) => Observable<T>,
  onSuccessFactory: (data: T, params: P) => void,
  logMessageFactory?: (params: P) => string,
): { [key: string]: any } {
  const _internalMethod = (params: P, returnResult = false) => {
    const operationKey = `${operationName}_${JSON.stringify(params)}`;
    const message = logMessageFactory ? logMessageFactory(params) : `${operationName}${returnResult ? '' : ' (fire-and-forget)'}`;

    store.loggingService.debug(`Store: ${message}`);

    const operation = store.trackCall(operationKey, serviceCallFactory(params), {
      onSuccess: (data: T) => {
        onSuccessFactory(data, params);
        store.loggingService.debug(`Store: ${operationName} completed`);
      },
    });

    return returnResult ? operation : undefined;
  };

  return {
    // Método SYNC
    [operationName]: (params: P) => _internalMethod(params, true),

    // Método FIRE-AND-FORGET
    [`${operationName}$`]: (params: P): void => _internalMethod(params, false),
  };
}
