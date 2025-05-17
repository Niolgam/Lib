export interface CoreAuthEndpoints {
  loginEndpoint: string;
  logoutEndpoint?: string;
  refreshTokenEndpoint?: string;
  authStatusEndpoint: string;
  userEndpoint: string;
}

export interface PasswordManagementEndpoints {
  forgotPasswordEndpoint?: string;
  resetPasswordEndpoint?: string;
  changePasswordEndpoint?: string;
}

export interface CsrfProtectionEndpoints {
  csrfEndpoint?: string;
  // NOVO: Duração do token CSRF em milissegundos
  csrfTokenLifetime?: number;
}

export interface OAuthEndpoints {
  authCallbackEndpoint?: string;
}

export interface UserRoleEndpoints {
  userRolesEndpoint?: string;
}

export interface AuthApiBaseEndpoints {
  authApiBaseUrl?: string;
}

export interface UserManagementPaths {
  userManagementApiBaseUrl?: string;
  usersBasePath?: string;
  rolesBasePath?: string;
  modulesBasePath?: string;
}

export interface SecurityEndpoints {
  // NOVO: Endpoint para reportar eventos de segurança
  securityReportEndpoint?: string;
}

export type AuthEndpointConfig = CoreAuthEndpoints &
  PasswordManagementEndpoints &
  CsrfProtectionEndpoints &
  OAuthEndpoints &
  UserRoleEndpoints &
  AuthApiBaseEndpoints &
  UserManagementPaths &
  SecurityEndpoints;

export interface AuthExternalProvidersConfig {
  type?: string;
  googleAuthEnabled?: boolean;
  googleAuthUrl?: string;
  govBrAuthEnabled?: boolean;
  govBrAuthUrl?: string;
  customProviderEnabled?: boolean;
  customProviderUrl?: string;
  customProviderName?: string;
}

export interface AuthRoutingConfig {
  redirectAfterLogin?: string;
  redirectAfterLogout?: string;
  accessDeniedRoute?: string;
  securityErrorRoute?: string;
  loginRoute?: string;
  signupRoute?: string;
}

export interface SessionManagementConfig {
  tokenStorageKey?: string;
  sessionDuration?: number;
  tokenRefreshInterval?: number;
  tokenRefreshThreshold?: number;
  cookieDomain?: string;
  csrfHeaderName?: string;
  // NOVO: Flag para habilitar cookies seguros (Secure, HttpOnly, SameSite)
  secureCookiesEnabled?: boolean;
}

export interface SecurityConfig {
  // NOVO: Configurações de CORS
  corsAllowedOrigins?: string[];
  // NOVO: Flag para controlar modo de segurança elevada
  enhancedSecurityEnabled?: boolean;
  // NOVO: Intervalo para verificações de segurança (ms)
  securityCheckInterval?: number;
  // NOVO: Lista de IPs banidos
  bannedIPs?: string[];
  // NOVO: Limite de tentativas de login
  maxLoginAttempts?: number;
  // NOVO: Tempo de bloqueio após exceder tentativas (ms)
  loginBlockDuration?: number;
  // Número máximo de falhas de refresh antes de bloquear
  maxRefreshFails?: number;
  // Atraso artificial durante login para dificultar ataques (ms)
  loginDelay?: number;
  // Multiplicador para limite de requisições por IP
  maxIpRequestMultiplier: number;
}

export interface AuthPasswordConfig {
  passwordStrengthLevel?: number;
  passwordMinLength?: number;
  passwordRequireUppercase?: boolean;
  passwordRequireLowercase?: boolean;
  passwordRequireNumbers?: boolean;
  passwordRequireSpecialChars?: boolean;
  passwordSpecialCharsPattern?: string;
  passwordProhibitCommonPasswords?: boolean;
  passwordProhibitPersonalInfo?: boolean;
  passwordHistorySize?: number;
}

export interface AuthFeatureConfig {
  enableRBAC?: boolean;
  enableUserManagement?: boolean;
  enableSignup?: boolean;
  enableForgotPassword?: boolean;
  enableRememberMe?: boolean;
  enableAutoLogin?: boolean;
  roleHierarchy?: Record<string, number>;
}

export type AuthConfig = AuthEndpointConfig &
  AuthExternalProvidersConfig &
  AuthRoutingConfig &
  SessionManagementConfig &
  SecurityConfig &
  AuthPasswordConfig &
  AuthFeatureConfig;
