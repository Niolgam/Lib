import { Injectable, signal, computed, inject, effect, Signal } from '@angular/core';
import { AbstractControl, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { AuthConfig } from '@auth/data-access';
import { CoreService, ValidationService } from '@vai/services';
import { ConfigService, RawAppConfig } from '@vai/services';
import { extractTyped } from '@vai/utils';

@Injectable({ providedIn: 'root' })
export class AuthConfigService {
  private coreService = inject(CoreService);
  private configService = inject(ConfigService);

  private readonly INITIAL_AUTH_DEFAULTS: AuthConfig = {
    authApiBaseUrl: undefined,
    userManagementApiBaseUrl: undefined,
    loginEndpoint: '/auth/login',
    logoutEndpoint: '/auth/logout',
    refreshTokenEndpoint: '/auth/refresh',
    authStatusEndpoint: '/auth/status',
    userEndpoint: '/auth/me',
    forgotPasswordEndpoint: '/auth/password/forgot',
    resetPasswordEndpoint: '/auth/password/reset',
    changePasswordEndpoint: '/auth/password/change',
    csrfEndpoint: '/auth/csrf-token',
    authCallbackEndpoint: '/auth/callback',
    userRolesEndpoint: undefined,
    usersBasePath: '/users',
    rolesBasePath: '/roles',
    modulesBasePath: '/modules',
    // NOVO: Endpoint para relatórios de segurança
    securityReportEndpoint: '/auth/security/report',

    // Configurações de providers externos
    googleAuthEnabled: false,
    googleAuthUrl: undefined,
    govBrAuthEnabled: false,
    govBrAuthUrl: undefined,
    customProviderEnabled: false,
    customProviderUrl: undefined,
    customProviderName: undefined,

    // Configurações de rotas
    redirectAfterLogin: '/dashboard',
    redirectAfterLogout: '/login',
    accessDeniedRoute: '/access-denied',
    securityErrorRoute: '/security-error',
    loginRoute: '/login',
    signupRoute: '/signup',

    // Configurações de sessão
    tokenStorageKey: 'authToken',
    sessionDuration: 3600,
    tokenRefreshInterval: 2700,
    tokenRefreshThreshold: 600,
    cookieDomain: undefined,
    csrfHeaderName: 'X-CSRF-Token',
    // NOVO: Duração do token CSRF
    csrfTokenLifetime: 7200000, // 2 horas
    // NOVO: Habilitar cookies seguros
    secureCookiesEnabled: true,

    corsAllowedOrigins: ['https://app.example.com', 'https://api.example.com'],
    enhancedSecurityEnabled: false,
    securityCheckInterval: 300000, // 5 minutos
    bannedIPs: [],
    maxLoginAttempts: 5,
    loginBlockDuration: 300000, // 5 minutos
    maxRefreshFails: 3,
    maxIpRequestMultiplier: 20, // 20x o limite de login
    loginDelay: 1000, // 1 segundo

    passwordStrengthLevel: 3,
    passwordMinLength: 8,
    passwordRequireUppercase: false,
    passwordRequireLowercase: false,
    passwordRequireNumbers: true,
    passwordRequireSpecialChars: false,
    passwordSpecialCharsPattern: '!@#$%^&*(),.?":{}|<>',
    passwordProhibitCommonPasswords: false,
    passwordProhibitPersonalInfo: false,
    passwordHistorySize: 0,

    enableRBAC: false,
    enableUserManagement: false,
    enableSignup: true,
    enableForgotPassword: true,
    enableRememberMe: false,
    enableAutoLogin: true,
    roleHierarchy: { admin: 5, manager: 4, creator: 3, editor: 2, viewer: 1 },
  };

  private validationService = inject(ValidationService);
  private readonly _configState = signal<AuthConfig>(this.INITIAL_AUTH_DEFAULTS);
  public readonly config = this._configState.asReadonly();

  public readonly effectiveAuthApiBaseUrl = computed<string | undefined>(() => this._configState().authApiBaseUrl || this.coreService.apiBaseUrl());
  public readonly effectiveUserManagementApiBaseUrl = computed<string | undefined>(
    () => this._configState().userManagementApiBaseUrl || this.effectiveAuthApiBaseUrl(),
  );

  // Base paths para CRUD, com defaults
  public readonly usersBasePath = computed(() => this._configState().usersBasePath || '/users');
  public readonly rolesBasePath = computed(() => this._configState().rolesBasePath || '/roles');
  public readonly modulesBasePath = computed(() => this._configState().modulesBasePath || '/modules');

  private _createFullUrl(baseSignal: Signal<string | undefined>, endpointPathOrFullUrl: string | undefined): string | null {
    if (!endpointPathOrFullUrl) return null;
    if (endpointPathOrFullUrl.startsWith('http://') || endpointPathOrFullUrl.startsWith('https://')) {
      return endpointPathOrFullUrl;
    }
    const baseUrl = baseSignal();
    if (!baseUrl) return null;
    const finalBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const finalEndpointPath = endpointPathOrFullUrl.startsWith('/') ? endpointPathOrFullUrl : `/${endpointPathOrFullUrl}`;
    return `${finalBaseUrl}${finalEndpointPath}`;
  }

  // URLs calculadas
  public readonly loginUrl = computed(() => this._createFullUrl(this.effectiveAuthApiBaseUrl, this._configState().loginEndpoint));
  public readonly logoutUrl = computed(() => this._createFullUrl(this.effectiveAuthApiBaseUrl, this._configState().logoutEndpoint));
  public readonly refreshTokenUrl = computed(() => this._createFullUrl(this.effectiveAuthApiBaseUrl, this._configState().refreshTokenEndpoint));
  public readonly userEndpointUrl = computed(() => this._createFullUrl(this.effectiveAuthApiBaseUrl, this._configState().userEndpoint));
  public readonly forgotPasswordUrl = computed(() => this._createFullUrl(this.effectiveAuthApiBaseUrl, this._configState().forgotPasswordEndpoint));
  public readonly resetPasswordUrl = computed(() => this._createFullUrl(this.effectiveAuthApiBaseUrl, this._configState().resetPasswordEndpoint));
  public readonly changePasswordUrl = computed(() => this._createFullUrl(this.effectiveAuthApiBaseUrl, this._configState().changePasswordEndpoint));
  public readonly authStatusUrl = computed(() => this._createFullUrl(this.effectiveAuthApiBaseUrl, this._configState().authStatusEndpoint));
  public readonly authCallbackUrl = computed(() => this._createFullUrl(this.effectiveAuthApiBaseUrl, this._configState().authCallbackEndpoint));
  public readonly csrfUrl = computed(() => this._createFullUrl(this.effectiveAuthApiBaseUrl, this._configState().csrfEndpoint));
  public readonly userRolesListEndpointUrl = computed(() => this._createFullUrl(this.effectiveAuthApiBaseUrl, this._configState().userRolesEndpoint));

  // NOVO: URL para relatórios de segurança
  public readonly securityReportUrl = computed(() => this._createFullUrl(this.effectiveAuthApiBaseUrl, this._configState().securityReportEndpoint));
  public readonly resolvedGoogleAuthUrl = computed(() => this._createFullUrl(this.effectiveAuthApiBaseUrl, this._configState().googleAuthUrl));
  public readonly resolvedGovBrAuthUrl = computed(() => this._createFullUrl(this.effectiveAuthApiBaseUrl, this._configState().govBrAuthUrl));
  public readonly resolvedCustomProviderUrl = computed(() =>
    this._createFullUrl(this.effectiveAuthApiBaseUrl, this._configState().customProviderUrl),
  );

  public readonly securityCheckInterval = computed(() => this._configState().securityCheckInterval || 60000);
  public readonly maxLoginAttempts = computed(() => this._configState().maxLoginAttempts || 5);
  public readonly maxRefreshFails = computed(() => this._configState().maxLoginAttempts || 3);
  public readonly loginBlockDuration = computed(() => this._configState().loginBlockDuration || 300000);
  public readonly loginDelay = computed(() => this._configState().loginDelay || 1000);
  public readonly maxIpRequestMultiplier = computed(() => this._configState().maxIpRequestMultiplier || 20);

  // Computed derivado para limite máximo de requisições por IP
  public readonly maxIpRequests = computed(() => this.maxLoginAttempts() * this.maxIpRequestMultiplier());

  public readonly isSignupEnabled = computed(() => this._configState().enableSignup ?? false);
  public readonly tokenStorageKey = computed(() => this._configState().tokenStorageKey || 'authToken');
  public readonly csrfHeaderName = computed(() => this._configState().csrfHeaderName || 'X-CSRF-Token');
  public readonly roleHierarchy = computed(() => this._configState().roleHierarchy || { admin: 5, manager: 4, creator: 3, editor: 2, viewer: 1 });
  public readonly areSecureCookiesEnabled = computed(() => this._configState().secureCookiesEnabled ?? true);
  public readonly isEnhancedSecurityEnabled = computed(() => this._configState().enhancedSecurityEnabled ?? false);

  public readonly passwordMinLength = computed(() => this._configState().passwordMinLength || 8);
  public readonly passwordRequireUppercase = computed(() => this._configState().passwordRequireUppercase || false);
  public readonly passwordRequireLowercase = computed(() => this._configState().passwordRequireLowercase || false);
  public readonly passwordRequireNumbers = computed(() => this._configState().passwordRequireNumbers || false);
  public readonly passwordRequireSpecialChars = computed(() => this._configState().passwordRequireSpecialChars || false);
  public readonly passwordSpecialCharsPattern = computed(() => this._configState().passwordSpecialCharsPattern || '!@#$%^&*(),.?":{}|<>');
  public readonly passwordHistorySize = computed(() => this._configState().passwordHistorySize || 0);

  // FUNCIONALIDADES DE SENHA COMO PROPRIEDADES COMPUTADAS
  public readonly passwordValidators = computed(() => {
    const validators: ValidatorFn[] = [Validators.required];
    const config = this._configState();

    // Construa um único padrão de validação com todos os requisitos
    let patternParts: string[] = [];
    let fullPattern = '';

    // Adiciona validação de comprimento mínimo
    validators.push(Validators.minLength(config.passwordMinLength));

    // Construção de padrão regex otimizado
    if (config.passwordRequireLowercase) {
      patternParts.push('(?=.*[a-z])');
    }

    if (config.passwordRequireUppercase) {
      patternParts.push('(?=.*[A-Z])');
    }

    if (config.passwordRequireNumbers) {
      patternParts.push('(?=.*\\d)');
    }

    if (config.passwordRequireSpecialChars) {
      // Escapa caracteres especiais para a regex
      const escapedSpecialChars = config.passwordSpecialCharsPattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      patternParts.push(`(?=.*[${escapedSpecialChars}])`);
    }

    // Se tem requisitos específicos, adiciona uma única regex combinando todos
    if (patternParts.length > 0) {
      // Define caracteres permitidos
      const allowedChars = `[A-Za-z\\d${config.passwordSpecialCharsPattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}]`;
      // Combina requisitos + verificação de comprimento
      fullPattern = `^${patternParts.join('')}${allowedChars}{${config.passwordMinLength},}$`;
      // Adiciona validador de padrão único que verifica todos os requisitos
      validators.push(Validators.pattern(new RegExp(fullPattern)));
    }

    return validators;
  });

  // Mensagem de requisitos de senha como propriedade computada
  public readonly passwordRequirementsMessage = computed(() => {
    const config = this._configState();
    const requirements: string[] = [`Pelo menos ${config.passwordMinLength} caracteres`];

    if (config.passwordRequireUppercase) {
      requirements.push('Pelo menos uma letra maiúscula');
    }

    if (config.passwordRequireLowercase) {
      requirements.push('Pelo menos uma letra minúscula');
    }

    if (config.passwordRequireNumbers) {
      requirements.push('Pelo menos um número');
    }

    if (config.passwordRequireSpecialChars) {
      requirements.push(`Pelo menos um caractere especial (${config.passwordSpecialCharsPattern})`);
    }

    return `A senha deve conter: ${requirements.join(', ')}`;
  });

  // Verificador de login rate-limited como propriedade computada
  public readonly isLoginAttemptExceeded = computed(() => {
    return (attemptCount: number) => attemptCount >= this.maxLoginAttempts();
  });

  constructor() {
    effect(() => {
      const loadedAppConfig = this.configService.appConfig();
      if (loadedAppConfig) this._initializeFromRawConfig(loadedAppConfig);
    });
  }

  private _initializeFromRawConfig(loadedAppConfig: RawAppConfig) {
    const newAuthConfig = extractTyped(loadedAppConfig, this.INITIAL_AUTH_DEFAULTS);
    this._configState.set(newAuthConfig);
  }

  getConfigSnapshot() {
    return { ...this._configState() };
  }

  createPasswordStrengthValidator(): ValidatorFn {
    const config = this._configState();

    // Usar o ValidationService passando as configurações atuais
    return this.validationService.strongPasswordValidator({
      minLength: config.passwordMinLength,
      requireUppercase: config.passwordRequireUppercase,
      requireLowercase: config.passwordRequireLowercase,
      requireNumbers: config.passwordRequireNumbers,
      requireSpecialChars: config.passwordRequireSpecialChars,
      specialCharsPattern: config.passwordSpecialCharsPattern,
    });
  }

  isPasswordInHistory(newPassword: string, passwordHistory: string[]): boolean {
    const historySize = this.passwordHistorySize();
    if (!historySize || historySize <= 0) {
      return false;
    }

    return passwordHistory.slice(0, historySize).includes(newPassword);
  }
}
