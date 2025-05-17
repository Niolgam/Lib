// auth.service.ts
import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { AuthConfigService } from './auth-config.service';
import { CsrfService } from './csrf.service';
import { AuthToken, ChangePasswordRequest, ForgotPasswordRequest, LoginCredentials, ResetPasswordRequest } from '@auth/data-access';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private http = inject(HttpClient);
  private csrfService = inject(CsrfService);
  private authConfigService = inject(AuthConfigService);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /**
   * Realiza requisição de login
   */
  loginRequest(credentials: LoginCredentials): Observable<AuthToken | any> {
    const url = this.authConfigService.loginUrl();
    if (!url) {
      return throwError(() => new Error('Login URL not configured.'));
    }

    // Limpa token CSRF antes do login
    this.csrfService.clearToken();

    return this.http
      .post<AuthToken | any>(url, credentials, {
        withCredentials: true,
        observe: 'response',
      })
      .pipe(
        map((response) => response.body),
        catchError((error) => throwError(() => error)),
      );
  }

  /**
   * Realiza requisição de logout
   */
  logoutRequest(): Observable<any> {
    const url = this.authConfigService.logoutUrl();
    if (!url) {
      return throwError(() => new Error('Logout URL not configured.'));
    }

    return this.http
      .post<any>(
        url,
        {},
        {
          withCredentials: true,
        },
      )
      .pipe(catchError((error) => throwError(() => error)));
  }

  /**
   * Realiza requisição de refresh token
   */
  refreshTokenRequest(): Observable<AuthToken | any> {
    const url = this.authConfigService.refreshTokenUrl();
    if (!url) {
      return throwError(() => new Error('Refresh token URL not configured.'));
    }

    return this.http
      .post<AuthToken | any>(
        url,
        {},
        {
          withCredentials: true,
        },
      )
      .pipe(catchError((error) => throwError(() => error)));
  }

  /**
   * Verifica status de autenticação no servidor
   */
  verifyAuthStatusRequest(): Observable<boolean> {
    const url = this.authConfigService.authStatusUrl();
    if (!url) {
      return of(false);
    }

    return this.http
      .get<{ authenticated: boolean }>(url, {
        withCredentials: true,
      })
      .pipe(
        map((response) => response.authenticated),
        catchError(() => of(false)),
      );
  }

  /**
   * Busca dados do usuário
   */
  fetchUserDataRequest(): Observable<any> {
    const url = this.authConfigService.userEndpointUrl();
    if (!url) {
      return throwError(() => new Error('User endpoint URL not configured.'));
    }

    return this.http
      .get<any>(url, {
        withCredentials: true,
      })
      .pipe(catchError((error) => throwError(() => error)));
  }

  /**
   * Solicita recuperação de senha
   */
  forgotPasswordRequest(request: ForgotPasswordRequest): Observable<any> {
    const url = this.authConfigService.forgotPasswordUrl();
    if (!url) {
      return throwError(() => new Error('Forgot password URL not configured.'));
    }

    return this.http.post<any>(url, request).pipe(catchError((error) => throwError(() => error)));
  }

  /**
   * Redefine senha com token de recuperação
   */
  resetPasswordRequest(request: ResetPasswordRequest): Observable<any> {
    const url = this.authConfigService.resetPasswordUrl();
    if (!url) {
      return throwError(() => new Error('Reset password URL not configured.'));
    }

    return this.http.post<any>(url, request).pipe(catchError((error) => throwError(() => error)));
  }

  /**
   * Altera senha do usuário logado
   */
  changePasswordRequest(request: ChangePasswordRequest): Observable<any> {
    const url = this.authConfigService.changePasswordUrl();
    if (!url) {
      return throwError(() => new Error('Change password URL not configured.'));
    }

    return this.http
      .post<any>(url, request, {
        withCredentials: true,
      })
      .pipe(catchError((error) => throwError(() => error)));
  }

  /**
   * Processa callback de autenticação externa
   */
  handleAuthCallbackRequest(code: string, provider: 'google' | 'govbr', nonce?: string): Observable<AuthToken | any> {
    const url = this.authConfigService.authCallbackUrl();
    if (!url) {
      return throwError(() => new Error(`${provider} auth callback URL not configured.`));
    }

    return this.http
      .post<AuthToken | any>(
        url,
        {
          code,
          provider,
          nonce,
        },
        {
          withCredentials: true,
        },
      )
      .pipe(catchError((error) => throwError(() => error)));
  }
}
