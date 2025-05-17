import { computed, Signal } from '@angular/core';
import { signalStoreFeature, withState, withComputed, patchState, withMethods } from '@ngrx/signals';
import { catchError, Observable, tap } from 'rxjs';

export type LoadingStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface LoadingState {
  loading: Record<string, boolean>;
  status: Record<string, LoadingStatus>;
  errors: Record<string, string | null>;
  timestamps: Record<string, number>;
  durations: Record<string, number>;
}

const initialState: LoadingState = {
  loading: {},
  status: {},
  errors: {},
  timestamps: {},
  durations: {},
};

const IDLE: LoadingStatus = 'idle';
const LOADING: LoadingStatus = 'loading';
const LOADED: LoadingStatus = 'loaded';
const ERROR: LoadingStatus = 'error';

export function withLoading() {
  // Type-safe status constants

  return signalStoreFeature(
    withState(initialState),
    withComputed(({ loading, errors, status }) => ({
      isLoading: computed(() => Object.values(loading()).some((isLoading) => isLoading)),
      hasErrors: computed(() => Object.values(errors()).some((error) => !!error)),
      isAllLoaded: computed(() => {
        const keys = Object.keys(status());
        return keys.length > 0 && keys.every((key) => status()[key] === LOADED);
      }),
    })),
    withMethods((store) => {
      return {
        /**
         * Checks if a specific resource is loading
         */
        isLoadingByKey(key: string): boolean {
          const loadingValue = store.loading();
          return !!loadingValue[key];
        },

        isLoadingByKeySignal(key: string): Signal<boolean> {
          return computed(() => {
            const loadingValue = store.loading();
            return !!loadingValue[key];
          });
        },

        /**
         * Gets the error for a specific key
         */
        getErrorByKeySignal(key: string) {
          return computed(() => {
            const errorsValue = store.errors();
            return errorsValue[key] || null;
          });
        },

        getErrorByKey(key: string) {
          const errorsValue = store.errors();
          return errorsValue[key] || null;
        },

        /**
         * Gets the loading status for a specific key
         */
        getStatusByKey(key: string): LoadingStatus {
          const statusValue = store.status();
          return statusValue[key] || IDLE;
        },

        /**
         * Gets the loading duration for a specific key in milliseconds
         */
        getDurationByKey(key: string): number {
          const durationsValue = store.durations();
          return durationsValue[key] || 0;
        },

        /**
         * Sets the loading state for a specific key
         */
        setLoading(key: string, isLoading: boolean): void {
          const now = Date.now();

          if (isLoading) {
            // Set to loading
            patchState(store, (state) => ({
              loading: { ...state.loading, [key]: true },
              status: { ...state.status, [key]: LOADING },
              timestamps: { ...state.timestamps, [key]: now },
            }));
          } else {
            // Calculate duration
            const startTime = store.timestamps()[key] || now;
            const duration = now - startTime;

            // Set to loaded
            patchState(store, (state) => ({
              loading: { ...state.loading, [key]: false },
              status: { ...state.status, [key]: LOADED },
              durations: { ...state.durations, [key]: duration },
            }));
          }
        },

        /**
         * Sets an error for a specific key
         */
        setError(key: string, error: string | null): void {
          const now = Date.now();

          if (error) {
            // Calculate duration if there's an error
            const startTime = store.timestamps()[key] || now;
            const duration = now - startTime;

            patchState(store, (state) => ({
              loading: { ...state.loading, [key]: false },
              status: { ...state.status, [key]: ERROR },
              errors: { ...state.errors, [key]: error },
              durations: { ...state.durations, [key]: duration },
            }));
          } else {
            // Just update the error
            patchState(store, (state) => ({
              errors: { ...state.errors, [key]: error },
            }));
          }
        },

        /**
         * Clears the error for a specific key
         */
        clearError(key: string): void {
          patchState(store, (state) => ({
            errors: { ...state.errors, [key]: null },
          }));
        },

        /**
         * Clears all errors
         */
        clearAllErrors(): void {
          patchState(store, { errors: {} });
        },

        /**
         * Resets the state for a specific key to idle
         */
        resetState(key: string): void {
          patchState(store, (state) => ({
            loading: { ...state.loading, [key]: false },
            status: { ...state.status, [key]: IDLE },
            errors: { ...state.errors, [key]: null },
            timestamps: { ...state.timestamps, [key]: Date.now() },
            durations: { ...state.durations, [key]: 0 },
          }));
        },

        /**
         * Tracks loading state for an observable operation
         */
        trackLoadingWithError<T>(key: string, observable: Observable<T>): Observable<T> {
          this.setLoading(key, true);
          this.clearError(key);

          return observable.pipe(
            tap((response: T) => {
              this.setLoading(key, false);
              return response;
            }),
            catchError((error: Error) => {
              this.setError(key, error.message || `Error in ${key}`);
              throw error;
            }),
          );
        },
      };
    }),
  );
}
