import { computed, Signal } from '@angular/core';
import { signalStoreFeature, withState, withComputed, patchState, withMethods } from '@ngrx/signals';
import { Observable, catchError, finalize, tap, throwError } from 'rxjs';

export type CallStatus = 'idle' | 'pending' | 'success' | 'error';

export interface CallStateData {
  status: Record<string, CallStatus>;
  data: Record<string, any>;
  error: Record<string, any>;
  timestamp: Record<string, number>;
  duration: Record<string, number>;
}

const initialState: CallStateData = {
  status: {},
  data: {},
  error: {},
  timestamp: {},
  duration: {},
};

export function withCallState() {
  return signalStoreFeature(
    withState(initialState),
    withComputed(({ status, error }) => ({
      isPending: computed(() => Object.values(status()).some((s) => s === 'pending')),
      hasError: computed(() => Object.values(error()).some((e) => e !== null)),
      activeErrors: computed(() => {
        const errors: Record<string, any> = {};
        Object.entries(error()).forEach(([key, value]) => {
          if (value) errors[key] = value;
        });
        return errors;
      }),
    })),
    withMethods((store) => {
      const methods = {
        trackCall<T>(
          key: string,
          observable: Observable<T>,
          options?: {
            optimistic?: boolean;
            optimisticData?: T;
            errorHandler?: (error: any) => any;
            onSuccess?: (data: T) => void;
            onError?: (error: any) => void;
          },
        ): Observable<T> {
          const startTime = Date.now();

          // Suporte a updates otimistas
          if (options?.optimistic && options?.optimisticData) {
            patchState(store, (state) => ({
              status: { ...state.status, [key]: 'pending' as CallStatus },
              timestamp: { ...state.timestamp, [key]: startTime },
              data: { ...state.data, [key]: options.optimisticData },
            }));
          } else {
            patchState(store, (state) => ({
              status: { ...state.status, [key]: 'pending' as CallStatus },
              timestamp: { ...state.timestamp, [key]: startTime },
            }));
          }

          return observable.pipe(
            tap((data) => {
              const endTime = Date.now();
              const duration = endTime - startTime;

              patchState(store, (state) => ({
                status: { ...state.status, [key]: 'success' as CallStatus },
                data: { ...state.data, [key]: data },
                error: { ...state.error, [key]: null },
                duration: { ...state.duration, [key]: duration },
              }));

              if (options?.onSuccess) {
                options.onSuccess(data);
              }
            }),
            catchError((error) => {
              const endTime = Date.now();
              const duration = endTime - startTime;

              const processedError = options?.errorHandler ? options.errorHandler(error) : error;

              patchState(store, (state) => ({
                status: { ...state.status, [key]: 'error' as CallStatus },
                error: { ...state.error, [key]: processedError },
                duration: { ...state.duration, [key]: duration },
              }));

              if (options?.onError) {
                options.onError(processedError);
              }

              return throwError(() => processedError);
            }),
            finalize(() => {
              // Qualquer limpeza adicional necessária
            }),
          );
        },

        getCallStatus(key: string): CallStatus {
          return store.status()[key] || 'idle';
        },

        getCallStatusSignal(key: string): Signal<CallStatus> {
          return computed(() => methods.getCallStatus(key));
        },

        isCallPending(key: string): boolean {
          return methods.getCallStatus(key) === 'pending';
        },

        isCallSuccess(key: string): boolean {
          return methods.getCallStatus(key) === 'success';
        },

        isCallError(key: string): boolean {
          return methods.getCallStatus(key) === 'error';
        },

        getCallPendingSignal(key: string): Signal<boolean> {
          return computed(() => methods.isCallPending(key));
        },

        getCallData<T>(key: string): T | null {
          return (store.data()[key] as T) || null;
        },

        getCallDataSignal<T>(key: string): Signal<T | null> {
          return computed(() => methods.getCallData<T>(key));
        },

        getCallError(key: string): any {
          return store.error()[key] || null;
        },

        getCallErrorSignal(key: string): Signal<any> {
          return computed(() => methods.getCallError(key));
        },

        resetCall(key: string): void {
          patchState(store, (state) => ({
            status: { ...state.status, [key]: 'idle' as CallStatus },
            data: { ...state.data, [key]: null },
            error: { ...state.error, [key]: null },
          }));
        },

        resetAllCalls(): void {
          patchState(store, {
            status: {},
            data: {},
            error: {},
            timestamp: {},
            duration: {},
          });
        },
      };
      return methods;
    }),
  );
}
