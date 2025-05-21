import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { ConfigService, RawAppConfig } from '@vai/services';
import { extractTyped } from '@vai/utils';
import { CoreConfig } from '@core/data-access';

@Injectable({
  providedIn: 'root',
})
export class CoreService {
  private configService = inject(ConfigService);
  private readonly INITIAL_CORE_DEFAULTS: CoreConfig = {
    appName: 'DefaultAppName',
    version: '0.0.0',
    environment: 'development',
    apiBaseUrl: '/api',
  };
  private readonly _coreConfigState = signal<CoreConfig>(this.INITIAL_CORE_DEFAULTS);

  public readonly config = this._coreConfigState.asReadonly();
  public readonly appName = computed(() => this._coreConfigState().appName);
  public readonly version = computed(() => this._coreConfigState().version);
  public readonly environment = computed(() => this._coreConfigState().environment);
  public readonly apiBaseUrl = computed(() => this._coreConfigState().apiBaseUrl);

  constructor() {
    effect(() => {
      const loadedAppConfig = this.configService.appConfig();
      if (loadedAppConfig) {
        this._initializeFromRawConfig(loadedAppConfig);
      }
    });
  }

  private _initializeFromRawConfig(loadedAppConfig: RawAppConfig) {
    const newCoreConfig = extractTyped(loadedAppConfig, this.INITIAL_CORE_DEFAULTS);
    this._coreConfigState.set(newCoreConfig);
  }
}
