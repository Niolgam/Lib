import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export type RawAppConfig = Record<string, any>;

@Injectable({
  providedIn: 'root',
})
export class ConfigService {
  private http = inject(HttpClient);
  private readonly _appConfigState = signal<RawAppConfig | null>(null);
  public readonly appConfig = this._appConfigState.asReadonly();

  async loadConfig(configUrl = 'assets/config.json') {
    try {
      const loadedConfig = await firstValueFrom(this.http.get<RawAppConfig>(configUrl));
      console.log(loadedConfig);
      if (!loadedConfig) {
        console.error('ConfigService: Configuration could not be loaded or is empty!');
        throw new Error('Configuration could not be loaded or is empty!');
      }
      this._appConfigState.set(loadedConfig);
    } catch (error) {
      console.error(`ConfigService: Error loading configuration from ${configUrl}`, error);
      throw error;
    }
  }

  getAppConfigSnapshot() {
    return this._appConfigState();
  }
}
