import { FormControl } from '@angular/forms';

export interface LoginCredentials {
  username: string;
  password: string;
  rememberMe?: boolean;
}

export interface AuthToken {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  issuedAt?: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
  confirmPassword: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  // user: User | null;
}

export interface SignupRequestPayload {
  // Exportado para ser usado no AuthStore
  name: string;
  email: string;
  password: string;
}

export interface SignupFormData {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  terms: boolean;
  [key: string]: any; // Index signature para satisfazer Record<string, unknown>
}

// Interface para o payload de request (dados enviados para API)
export interface SignupRequestPayload {
  name: string;
  email: string;
  password: string;
  [key: string]: any; // Index signature para satisfazer Record<string, unknown>
}

// Interface alternativa mais restritiva (se preferir não usar index signature)
export type SignupFormDataStrict = {
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly confirmPassword: string;
  readonly terms: boolean;
};

export type SignupRequestPayloadStrict = {
  readonly name: string;
  readonly email: string;
  readonly password: string;
};

export interface SignupFormShape {
  name: FormControl<string>;
  email: FormControl<string>;
  password: FormControl<string>;
  confirmPassword: FormControl<string>;
  terms: FormControl<boolean>;
}
// Utility type para converter tipos estritos em Record<string, unknown>
export type ToRecord<T> = T & Record<string, unknown>;
