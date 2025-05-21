import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { LoginCredentials } from '@auth/data-access';
import { ValidationErrorsComponent } from '@component/validation-error';
import { AuthFormBaseComponent } from '@auth/base-form';

@Component({
  selector: 'auth-login',
  imports: [CommonModule, ReactiveFormsModule, ValidationErrorsComponent],
  templateUrl: './auth-login.component.html',
  styles: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthLoginComponent extends AuthFormBaseComponent<LoginCredentials> implements OnInit {
  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);

  // Status específicos deste componente
  readonly rememberMe = signal(false);
  readonly externalProvidersEnabled = computed(() => {
    const config = this.authStore.authConfigService.config();
    return config.googleAuthEnabled || config.govBrAuthEnabled || config.customProviderEnabled;
  });

  // Formulário
  override form = this.fb.group({
    username: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    rememberMe: [false],
  });

  // Utilitários para o template
  readonly usernameControl = computed(() => this.form.get('username'));
  readonly passwordControl = computed(() => this.form.get('password'));

  ngOnInit(): void {
    // Configurar inscrições
    this.setupFormSubscriptions();

    // Verificar se o usuário já está autenticado
    if (this.checkAuthenticationStatus()) {
      return;
    }

    // Verificar se há um returnUrl na query string
    this.route.queryParams.pipe(takeUntilDestroyed()).subscribe((params) => {
      const returnUrl = params['returnUrl'];
      if (returnUrl) {
        this.authStore.setReturnUrl(returnUrl);
      }
    });

    // Verificar outros parâmetros de url
    const urlParams = new URLSearchParams(window.location.search);
    const errorParam = urlParams.get('error');

    if (errorParam) {
      this.generalError.set(
        errorParam === 'unauthorized' ? 'Your session has expired. Please login again.' : 'Authentication error. Please try again.',
      );
    }
  }

  protected getFormValue(): LoginCredentials {
    return this.form.getRawValue();
  }

  protected authenticateUser(credentials: LoginCredentials): void {
    this.authStore.login(credentials);
  }

  // Métodos para login com provedores externos
  loginWithGoogle(): void {
    const url = this.authStore.initiateGoogleAuth();
    window.location.href = url;
  }

  loginWithGovBr(): void {
    const url = this.authStore.initiateGovBrAuth();
    window.location.href = url;
  }
}
