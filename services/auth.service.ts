import { Injectable, inject, PLATFORM_ID, Signal } from '@angular/core'; // Adicionado Signal
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpResponse, HttpErrorResponse } from '@angular/common/http'; // Adicionado HttpResponse, HttpErrorResponse
import { Observable, throwError, of, timer } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { AuthConfigService } from './auth-config.service';
import { CsrfService } from './csrf.service';
import { AuthToken, ChangePasswordRequest, ForgotPasswordRequest, LoginCredentials, ResetPasswordRequest, User } from '@auth/data-access';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private http = inject(HttpClient);
  private csrfService = inject(CsrfService);
  private authConfigService = inject(AuthConfigService);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  loginRequest(credentials: LoginCredentials): Observable<AuthToken> {
    const url = this.authConfigService.loginUrl();
    if (!url) {
      return throwError(() => new Error('Login URL not configured.'));
    }
    this.csrfService.clearToken();
    return this.http
      .post<AuthToken>(url, credentials, {
        withCredentials: true,
        observe: 'response',
      })
      .pipe(
        map((response: HttpResponse<AuthToken>) => {
          if (!response.body) {
            throw new Error('Login response body is null.');
          }
          return response.body;
        }),
        catchError((error: HttpErrorResponse) => throwError(() => error)),
      );
  }

  logoutRequest(): Observable<void> {
    const url = this.authConfigService.logoutUrl();
    if (!url) {
      return throwError(() => new Error('Logout URL not configured.'));
    }
    return this.http.post<void>(url, {}, { withCredentials: true }).pipe(catchError((error: HttpErrorResponse) => throwError(() => error)));
  }

  refreshTokenRequest(): Observable<AuthToken> {
    const url = this.authConfigService.refreshTokenUrl();
    if (!url) {
      return throwError(() => new Error('Refresh token URL not configured.'));
    }
    return this.http.post<AuthToken>(url, {}, { withCredentials: true }).pipe(catchError((error: HttpErrorResponse) => throwError(() => error)));
  }

  verifyAuthStatusRequest(): Observable<boolean> {
    const url = this.authConfigService.authStatusUrl();
    if (!url) {
      return of(false);
    }
    return this.http.get<{ authenticated: boolean }>(url, { withCredentials: true }).pipe(
      map((response) => response.authenticated),
      catchError(() => of(false)),
    );
  }

  fetchUserDataRequest(): Observable<User> {
    const url = this.authConfigService.userEndpointUrl();
    if (!url) {
      return throwError(() => new Error('User endpoint URL not configured.'));
    }
    return this.http.get<User>(url, { withCredentials: true }).pipe(catchError((error: HttpErrorResponse) => throwError(() => error)));
  }

  forgotPasswordRequest(request: ForgotPasswordRequest): Observable<void> {
    const url = this.authConfigService.forgotPasswordUrl();
    if (!url) {
      return throwError(() => new Error('Forgot password URL not configured.'));
    }
    return this.http.post<void>(url, request).pipe(catchError((error: HttpErrorResponse) => throwError(() => error)));
  }

  resetPasswordRequest(request: ResetPasswordRequest): Observable<void> {
    const url = this.authConfigService.resetPasswordUrl();
    if (!url) {
      return throwError(() => new Error('Reset password URL not configured.'));
    }
    return this.http.post<void>(url, request).pipe(catchError((error: HttpErrorResponse) => throwError(() => error)));
  }

  changePasswordRequest(request: ChangePasswordRequest): Observable<void> {
    const url = this.authConfigService.changePasswordUrl();
    if (!url) {
      return throwError(() => new Error('Change password URL not configured.'));
    }
    return this.http.post<void>(url, request, { withCredentials: true }).pipe(catchError((error: HttpErrorResponse) => throwError(() => error)));
  }

  handleAuthCallbackRequest(code: string, provider: 'google' | 'govbr' | 'custom', nonce?: string): Observable<AuthToken> {
    const url = this.authConfigService.authCallbackUrl();
    if (!url) {
      return throwError(() => new Error(`${provider} auth callback URL not configured.`));
    }
    return this.http
      .post<AuthToken>(url, { code, provider, nonce }, { withCredentials: true })
      .pipe(catchError((error: HttpErrorResponse) => throwError(() => error)));
  }

  simulateDelayedError(error: Error | HttpErrorResponse | string | Record<string, unknown>, delayMs: number = 500): Observable<never> {
    return timer(delayMs).pipe(
      switchMap(() =>
        throwError(() =>
          error instanceof Error || error instanceof HttpErrorResponse ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error)),
        ),
      ),
    );
  }

  registerUserRequest(
    userData: Omit<User, 'id' | 'roles' | 'lastLogin' | 'createdAt' | 'updatedAt' | 'isActive'> & { password?: string },
  ): Observable<User> {
    const registrationUrl = this._createFullUrl(this.authConfigService.effectiveAuthApiBaseUrl, '/auth/register');
    if (!registrationUrl) {
      return throwError(() => new Error('User registration URL not configured.'));
    }
    return this.http
      .post<User>(registrationUrl, userData, { withCredentials: true })
      .pipe(catchError((error: HttpErrorResponse) => throwError(() => error)));
  }

  private _createFullUrl(baseSignal: Signal<string | undefined>, endpointPathOrFullUrl?: string): string | null {
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
}
