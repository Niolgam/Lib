import { Injectable, inject, PLATFORM_ID, WritableSignal, signal, Signal, computed, effect } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { extractTyped } from '@vai/utils';
import { ConfigService, RawAppConfig } from './config.service';
import { CoreService } from '@vai/services';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
}

export type LogLevelString = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogConfig {
  level?: LogLevelString;
  notifyServerOnLevel?: LogLevelString;
  loggingApiBaseUrl?: string;
  logToServer?: boolean;
  logToConsole?: boolean;
  includeTimestamp?: boolean;
  loggingEndpoint?: string;
  loggingEnabled?: boolean;
}

const LOG_LEVEL_MAP: Record<LogLevelString, LogLevel> = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR,
  fatal: LogLevel.FATAL,
};

const LOG_LEVEL_NAME: Record<LogLevel, LogLevelString> = {
  [LogLevel.DEBUG]: 'debug',
  [LogLevel.INFO]: 'info',
  [LogLevel.WARN]: 'warn',
  [LogLevel.ERROR]: 'error',
  [LogLevel.FATAL]: 'fatal',
};

export interface LogEntry {
  level: LogLevel;
  message: string;
  data?: any;
  userId?: string;
  sessionId?: string;
  url?: string;
  userAgent?: string;
  timestamp?: string;
}

@Injectable({
  providedIn: 'root',
})
export class LoggingService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly configService = inject(ConfigService); // Para config global
  private readonly coreService = inject(CoreService); // Para apiBaseUrl global

  private readonly isBrowser: boolean;
  private readonly sessionId: string;

  private readonly INITIAL_LOG_DEFAULTS: LogConfig = {
    level: 'info',
    notifyServerOnLevel: 'error',
    loggingApiBaseUrl: undefined, // Não tem um default, usará o do Core ou o do AppConfig
    logToServer: false,
    logToConsole: true, // Default para true pode ser mais útil
    includeTimestamp: true, // Default para true pode ser mais útil
    loggingEndpoint: '/api/logs', // Um default mais completo
    loggingEnabled: true, // Default para true
  };

  private readonly _configState = signal<LogConfig>(this.INITIAL_LOG_DEFAULTS);
  public readonly config = this._configState.asReadonly();

  public readonly effectiveLogLevel = computed(() => LOG_LEVEL_MAP[this._configState().level ?? 'info'] ?? LogLevel.INFO);
  public readonly serverNotifyLevel = computed(() => LOG_LEVEL_MAP[this._configState().notifyServerOnLevel ?? 'error'] ?? LogLevel.ERROR);

  private readonly bufferState: WritableSignal<LogEntry[]> = signal([]);
  private readonly bufferSizeState = signal(10); // Um bufferSize default mais realista
  private readonly userIdState: WritableSignal<string | undefined> = signal(undefined);

  public readonly loggingUrl: Signal<string | null> = computed(() => {
    const logCfg = this._configState();
    const coreCfg = this.coreService.config(); // Lê o CoreConfig

    const endpointPath = logCfg.loggingEndpoint;
    if (!endpointPath) return null;

    // Lógica de fallback para baseUrl: logCfg.loggingApiBaseUrl -> coreCfg.apiBaseUrl
    const baseUrlToUse = logCfg.loggingApiBaseUrl || coreCfg?.apiBaseUrl;
    if (!baseUrlToUse) return null;

    // Tratamento para URLs que já são absolutas (se loggingEndpoint puder ser absoluto)
    if (endpointPath.startsWith('http://') || endpointPath.startsWith('https://')) {
      return endpointPath;
    }

    const finalBaseUrl = baseUrlToUse.endsWith('/') ? baseUrlToUse.slice(0, -1) : baseUrlToUse;
    const finalEndpointPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
    return `${finalBaseUrl}${finalEndpointPath}`;
  });

  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
    this.sessionId = this._generateSessionId();

    // Effect para inicializar a config a partir do ConfigService
    effect(() => {
      const loadedAppConfig = this.configService.appConfig();
      if (loadedAppConfig) {
        this._initializeFromRawConfig(loadedAppConfig);
      }
    });

    // Effect para auto-flush baseado no tamanho do buffer (como você tinha)
    effect(() => {
      const buffer = this.bufferState();
      const bufferSize = this.bufferSizeState();
      const currentLogConfig = this._configState(); // Usa o sinal interno _configState

      if (this.isBrowser && currentLogConfig.logToServer && buffer.length > 0 && buffer.length >= bufferSize) {
        this.flushLogs();
      }
    });
  }

  private _initializeFromRawConfig(loadedAppConfig: RawAppConfig) {
    const newLogConfig = extractTyped(loadedAppConfig, this.INITIAL_LOG_DEFAULTS);
    // Garante que booleanos tenham um valor se não vierem da config
    if (newLogConfig.loggingEnabled === undefined) newLogConfig.loggingEnabled = this.INITIAL_LOG_DEFAULTS.loggingEnabled;
    if (newLogConfig.logToConsole === undefined) newLogConfig.logToConsole = this.INITIAL_LOG_DEFAULTS.logToConsole;
    if (newLogConfig.logToServer === undefined) newLogConfig.logToServer = this.INITIAL_LOG_DEFAULTS.logToServer;
    if (newLogConfig.includeTimestamp === undefined) newLogConfig.includeTimestamp = this.INITIAL_LOG_DEFAULTS.includeTimestamp;

    this._configState.set(newLogConfig);
  }

  // Método público para permitir override externo da config, se necessário (ex: por APP_INITIALIZER ou testes)
  // Mas a inicialização principal agora é via effect no construtor.
  public setConfig(newConfigData: Partial<LogConfig>): void {
    this._configState.update((currentConfig) => extractTyped(newConfigData, currentConfig));
  }

  getConfigSnapshot(): LogConfig {
    return { ...this._configState() };
  }

  debug(message: string, data?: any) {
    this._log(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: any) {
    this._log(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: any) {
    this._log(LogLevel.WARN, message, data);
  }

  error(message: string, data?: any) {
    this._log(LogLevel.ERROR, message, data);
  }

  fatal(message: string, data?: any) {
    this._log(LogLevel.FATAL, message, data);
  }

  setLogLevel(level: LogLevel) {
    const levelName = LOG_LEVEL_NAME[level];
    if (levelName) this._configState.update((cfg) => ({ ...cfg, level: levelName }));
  }

  setLogLevelByName(levelName: LogLevelString) {
    this._configState.update((cfg) => ({ ...cfg, level: levelName }));
  }

  getLogLevel() {
    return this.effectiveLogLevel();
  }

  getLogLevelName() {
    return LOG_LEVEL_NAME[this.effectiveLogLevel()];
  }

  enableLogging(enabled: boolean) {
    this._configState.update((cfg) => ({ ...cfg, loggingEnabled: enabled }));
  }

  isLoggingEnabled() {
    return this._configState().loggingEnabled !== false;
  }

  private _shouldLog(level: LogLevel) {
    return level >= this.effectiveLogLevel();
  }

  private _shouldNotifyServer(level: LogLevel) {
    if (!this._configState().logToServer) return false;
    return level >= this.serverNotifyLevel();
  }

  private _log(level: LogLevel, message: string, data?: any) {
    if (!this.isLoggingEnabled() || !this._shouldLog(level)) return;

    const currentConfig = this._configState();
    const entry: LogEntry = {
      timestamp: currentConfig.includeTimestamp ? new Date().toISOString() : undefined,
      level,
      message,
      data: data ? JSON.parse(JSON.stringify(data)) : undefined,
      sessionId: this.sessionId,
      userId: this.userIdState(),
      url: this.isBrowser ? window.location.href : undefined,
      userAgent: this.isBrowser ? navigator.userAgent : undefined,
    };

    if (this.isBrowser && currentConfig.logToConsole) this._logToConsole(entry);

    // Apenas adiciona ao buffer se logToServer estiver habilitado
    if (currentConfig.logToServer) {
      this.bufferState.update((currentBuffer) => [...currentBuffer, entry]);
      // A lógica de flush por tamanho agora é tratada pelo effect.
      // Mantemos o flush por nível de notificação aqui.
      if (this._shouldNotifyServer(level)) {
        this.flushLogs();
      }
    }
  }

  flushLogs() {
    const url = this.loggingUrl(); // Usa o computed signal
    const logToServerEnabled = this._configState().logToServer;
    const logsToSend = [...this.bufferState()]; // Pega uma cópia

    if (!url || !logToServerEnabled || !logsToSend.length) {
      // Limpa o buffer mesmo se não puder enviar, se logToServer estava intencionado mas URL falta,
      // ou se logToServer foi desabilitado e ainda há logs.
      if (logsToSend.length > 0 && (!logToServerEnabled || !url)) {
        this.bufferState.set([]);
      }
      return;
    }

    this.bufferState.set([]); // Limpa o buffer ANTES da chamada HTTP

    if (this.isBrowser) {
      this.http
        .post(url, { logs: logsToSend })
        .pipe(
          catchError((err) => {
            console.error('Error sending logs to server. Logs might be lost or restored depending on strategy.', err);
            // Opcional: this.bufferState.update(currentBuffer => [...logsToSend, ...currentBuffer]);
            return of(null);
          }),
        )
        .subscribe();
    }
  }

  setBufferSize(size: number) {
    if (size > 0) this.bufferSizeState.set(size);
  }

  setUserId(userId: string | null) {
    this.userIdState.set(userId || undefined);
  }

  private _generateSessionId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  private _logToConsole(entry: LogEntry) {
    const styles: Record<LogLevel, string> = {
      [LogLevel.DEBUG]: 'color:#6c757d',
      [LogLevel.INFO]: 'color:#17a2b8',
      [LogLevel.WARN]: 'color:#ffc107',
      [LogLevel.ERROR]: 'color:#dc3545',
      [LogLevel.FATAL]: 'color:#dc3545;font-weight:bold',
    };
    const levelName = LOG_LEVEL_NAME[entry.level] || 'LOG';
    const style = styles[entry.level] || '';
    const timestamp = entry.timestamp ? `[${new Date(entry.timestamp).toLocaleTimeString()}]` : '';

    if (entry.data !== undefined && entry.data !== null) {
      console.groupCollapsed(`%c${timestamp}[${levelName}] ${entry.message}`, style);
      console.log('Data:', entry.data);
      console.groupEnd();
    } else {
      console.log(`%c${timestamp}[${levelName}] ${entry.message}`, style);
    }
  }

  getLogs(): LogEntry[] {
    return [...this.bufferState()];
  }
}
