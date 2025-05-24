import { computed, Signal } from '@angular/core';
import { patchState, signalStoreFeature, withComputed, withMethods, withState } from '@ngrx/signals';
import { catchError, finalize, Observable, tap, throwError } from 'rxjs';

export type CallStatus = 'idle' | 'pending' | 'success' | 'error';

// Tipos específicos para diferentes tipos de erro
export interface ApiError {
  message: string;
  code?: string;
  details?: Record<string, unknown>;
}

export interface NetworkError {
  message: string;
  type: 'network';
  offline?: boolean;
}

export interface ValidationError {
  message: string;
  type: 'validation';
  fields?: Record<string, string[]>;
}

export type CallError = ApiError | NetworkError | ValidationError | Error;

export interface CallStateData {
  status: Record<string, CallStatus>;
  data: Record<string, unknown>;
  error: Record<string, CallError | null>;
  timestamp: Record<string, number>;
  duration: Record<string, number>;
}

export interface TrackCallOptions<T = unknown> {
  optimistic?: boolean;
  optimisticData?: T;
  errorHandler?: (error: CallError) => CallError;
  onSuccess?: (data: T) => void;
  onError?: (error: CallError) => void;
  timeout?: number;
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
        const errors: Record<string, CallError> = {};
        Object.entries(error()).forEach(([key, value]) => {
          if (value) errors[key] = value;
        });
        return errors;
      }),
      errorCount: computed(() => Object.values(error()).filter((e) => e !== null).length),
      successCount: computed(() => Object.values(status()).filter((s) => s === 'success').length),
    })),
    withMethods((store) => {
      const methods = {
        trackCall<T = unknown>(key: string, observable: Observable<T>, options: TrackCallOptions<T> = {}): Observable<T> {
          const startTime = Date.now();

          // Update otimístico se configurado
          if (options.optimistic && options.optimisticData !== undefined) {
            patchState(store, (state) => ({
              status: { ...state.status, [key]: 'pending' as CallStatus },
              timestamp: { ...state.timestamp, [key]: startTime },
              data: { ...state.data, [key]: options.optimisticData },
              error: { ...state.error, [key]: null },
            }));
          } else {
            patchState(store, (state) => ({
              status: { ...state.status, [key]: 'pending' as CallStatus },
              timestamp: { ...state.timestamp, [key]: startTime },
              error: { ...state.error, [key]: null },
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

              options.onSuccess?.(data);
            }),
            catchError((error: unknown) => {
              const endTime = Date.now();
              const duration = endTime - startTime;

              // Converter erro para tipo conhecido
              let processedError: CallError;
              if (error instanceof Error) {
                processedError = error;
              } else if (typeof error === 'object' && error !== null) {
                const errorObj = error as Record<string, unknown>;
                processedError = {
                  message: typeof errorObj.message === 'string' ? errorObj.message : 'Unknown error',
                  code: typeof errorObj.code === 'string' ? errorObj.code : undefined,
                  details: errorObj,
                } as ApiError;
              } else {
                processedError = new Error(String(error));
              }

              // Aplicar handler customizado se existir
              const finalError = options.errorHandler ? options.errorHandler(processedError) : processedError;

              patchState(store, (state) => ({
                status: { ...state.status, [key]: 'error' as CallStatus },
                error: { ...state.error, [key]: finalError },
                duration: { ...state.duration, [key]: duration },
              }));

              options.onError?.(finalError);

              return throwError(() => finalError);
            }),
            finalize(() => {
              // Cleanup se necessário
            }),
          );
        },

        getCallStatus(key: string): CallStatus {
          return store.status()[key] ?? 'idle';
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

        getCallSuccessSignal(key: string): Signal<boolean> {
          return computed(() => methods.isCallSuccess(key));
        },

        getCallData<T = unknown>(key: string): T | null {
          const data = store.data()[key];
          return (data as T) ?? null;
        },

        getCallDataSignal<T = unknown>(key: string): Signal<T | null> {
          return computed(() => methods.getCallData<T>(key));
        },

        getCallError(key: string): CallError | null {
          return store.error()[key] ?? null;
        },

        getCallErrorSignal(key: string): Signal<CallError | null> {
          return computed(() => methods.getCallError(key));
        },

        getCallDuration(key: string): number | null {
          return store.duration()[key] ?? null;
        },

        getCallDurationSignal(key: string): Signal<number | null> {
          return computed(() => methods.getCallDuration(key));
        },

        // Métodos para múltiplas calls
        getCallsByStatus(status: CallStatus): string[] {
          return Object.entries(store.status())
            .filter(([, callStatus]) => callStatus === status)
            .map(([key]) => key);
        },

        getAllPendingCalls(): string[] {
          return methods.getCallsByStatus('pending');
        },

        getAllErrorCalls(): string[] {
          return methods.getCallsByStatus('error');
        },

        resetCall(key: string): void {
          patchState(store, (state) => ({
            status: { ...state.status, [key]: 'idle' as CallStatus },
            data: { ...state.data, [key]: null },
            error: { ...state.error, [key]: null },
            timestamp: { ...state.timestamp, [key]: 0 },
            duration: { ...state.duration, [key]: 0 },
          }));
        },

        resetCallsByStatus(status: CallStatus): void {
          const keysToReset = methods.getCallsByStatus(status);
          keysToReset.forEach((key) => methods.resetCall(key));
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

        // Métodos utilitários
        hasAnyPendingCalls(): boolean {
          return methods.getAllPendingCalls().length > 0;
        },

        hasAnyErrors(): boolean {
          return methods.getAllErrorCalls().length > 0;
        },

        getCallMetrics(): {
          total: number;
          pending: number;
          success: number;
          error: number;
          averageDuration: number;
        } {
          const statuses = Object.values(store.status());
          const durations = Object.values(store.duration()).filter((d) => d > 0);

          return {
            total: statuses.length,
            pending: statuses.filter((s) => s === 'pending').length,
            success: statuses.filter((s) => s === 'success').length,
            error: statuses.filter((s) => s === 'error').length,
            averageDuration: durations.length > 0 ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length : 0,
          };
        },
      };
      return methods;
    }),
  );
}
