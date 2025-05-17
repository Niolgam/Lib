import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, model, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { FormBuilder, FormControl, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';

import { AuthStore, LoginCredentials } from '@auth/data-access';
import { AuthConfigService } from '@auth/utils';

// Modelo para os provedores externos
interface ExternalProviders {
  googleEnabled: boolean;
  googleAuthUrl: string;
  govBrEnabled: boolean;
  govBrAuthUrl: string;
  customEnabled: boolean;
  customAuthUrl: string;
  customName: string;
}

// Interface para o formulário de login usando controles fortemente tipados
interface LoginForm {
  username: FormControl<string>;
  password: FormControl<string>;
  rememberMe: FormControl<boolean>;
}

@Component({
  selector: 'auth-login',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './auth-login.component.html',
  styles: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthLoginComponent implements OnInit {
  private fb = inject(NonNullableFormBuilder);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private authStore = inject(AuthStore);
  private authConfigService = inject(AuthConfigService);

  // Signals para estado do componente
  redirectUrl = signal<string | null>(null);
  loginError = signal<string | null>(null);
  loginForm = this.createLoginForm();

  // Signal para provedores externos
  externalProviders = signal<ExternalProviders>({
    googleEnabled: false,
    googleAuthUrl: '',
    govBrEnabled: false,
    govBrAuthUrl: '',
    customEnabled: false,
    customAuthUrl: '',
    customName: '',
  });

  // Converter isLoading de Observable para Signal
  isLoading = this.authStore.isLoadingByKeySignal('login');
  // Computed para verificar se o botão deve estar desabilitado
  disableLoginButton = computed(() => this.isLoading() || this.loginForm.invalid);
  // Computed para verificar se o formulário tem erro de nome de usuário
  hasUsernameError = computed(() => {
    const control = this.loginForm.controls.username;
    return control.touched && control.invalid;
  });

  // Computed para verificar se o formulário tem erro de senha
  hasPasswordError = computed(() => {
    const control = this.loginForm.controls.password;
    return control.touched && control.invalid;
  });

  // Effect para lidar com os erros de login
  constructor() {
    effect(() => {
      // Obter erros de carregamento do AuthStore e atualizar o signal loginError
      const error = this.authStore.getErrorByKeySignal('login')();
      if (error) {
        this.loginError.set(error);
      }
    });
  }

  ngOnInit() {
    // Verificar se há um returnUrl na query string
    this.route.queryParams.subscribe((params) => {
      const returnUrl = params['returnUrl'] as string | undefined;
      if (returnUrl) {
        this.redirectUrl.set(returnUrl);
        this.authStore.setReturnUrl(returnUrl);
      }
    });

    // Verificar se o usuário já está autenticado
    if (this.authStore.isUserAuthenticated()) {
      this.authStore.redirectAfterLogin();
      return;
    }

    // Configurar provedores externos
    this.setupExternalProviders();
  }

  // Criar formulário fortemente tipado
  private createLoginForm() {
    return this.fb.group<LoginForm>({
      username: this.fb.control('', [Validators.required, Validators.email]),
      password: this.fb.control('', [Validators.required, Validators.minLength(6)]),
      rememberMe: this.fb.control(false),
    });
  }

  // Método para submeter o formulário
  onSubmit() {
    if (this.loginForm.invalid) {
      this.markFormGroupTouched();
      return;
    }

    this.loginError.set(null);

    const formValue = this.loginForm.getRawValue();
    const credentials: LoginCredentials = {
      username: formValue.username,
      password: formValue.password,
      rememberMe: formValue.rememberMe,
    };

    // Chamar o método de login do AuthStore
    this.authStore.login(credentials);
  }

  // Métodos para login com provedores externos
  loginWithGoogle() {
    if (!this.externalProviders().googleEnabled) return;
    window.location.href = this.externalProviders().googleAuthUrl;
  }

  loginWithGovBr() {
    if (!this.externalProviders().govBrEnabled) return;
    window.location.href = this.externalProviders().govBrAuthUrl;
  }

  loginWithCustomProvider() {
    if (!this.externalProviders().customEnabled) return;
    window.location.href = this.externalProviders().customAuthUrl;
  }

  // Configurar provedores externos
  private setupExternalProviders() {
    const authConfig = this.authConfigService.config();

    this.externalProviders.update((current) => ({
      ...current,
      // Google Auth
      googleEnabled: authConfig.googleAuthEnabled || false,
      googleAuthUrl: authConfig.googleAuthEnabled && authConfig.googleAuthUrl ? authConfig.googleAuthUrl : '',

      // GovBr Auth
      govBrEnabled: authConfig.govBrAuthEnabled || false,
      govBrAuthUrl: authConfig.govBrAuthEnabled && authConfig.govBrAuthUrl ? authConfig.govBrAuthUrl : '',

      // Custom Provider
      customEnabled: authConfig.customProviderEnabled || false,
      customAuthUrl: authConfig.customProviderEnabled && authConfig.customProviderUrl ? authConfig.customProviderUrl : '',
      customName: authConfig.customProviderName || 'Login Alternativo',
    }));
  }

  // Utilitário para marcar todos os campos como tocados
  private markFormGroupTouched() {
    Object.values(this.loginForm.controls).forEach((control) => {
      control.markAsTouched();
      control.updateValueAndValidity();
    });
  }
}
