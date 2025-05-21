import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthStore, ResetPasswordRequest } from '@auth/data-access';
import { AuthFormBaseComponent } from '@auth/base-form';

// Interface para o formulário de redefinição de senha
interface ResetPasswordFormData {
  password: FormControl<string>;
  confirmPassword: FormControl<string>;
}

@Component({
  selector: 'auth-reset-password',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: `./auth-reset-password.component.html`,
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthResetPasswordComponent extends AuthFormBaseComponent<ResetPasswordRequest> implements OnInit {
  private fb = inject(NonNullableFormBuilder);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  // AuthStore já é injetado em AuthFormBaseComponent
  // AuthConfigService já é injetado em AuthFormBaseComponent

  // Signals para estado do componente
  private readonly token = signal<string | null>(null);
  // errorMessage, successMessage, isLoading, disableSubmitButton são gerenciados pela classe base

  // Formulário de redefinição de senha
  override form = this.createResetPasswordForm();

  // Computed para verificar erros nos campos
  readonly hasPasswordError = computed(() => {
    const control = this.form.controls.password;
    return control.touched && control.invalid;
  });

  readonly hasConfirmPasswordError = computed(() => {
    const control = this.form.controls.confirmPassword;
    return (control.touched && control.invalid) || this.form.errors?.['passwordMismatch'];
  });

  constructor() {
    super();
  }

  override ngOnInit(): void {
    super.ngOnInit();
    // Obter token da URL
    this.route.queryParams.subscribe((params) => {
      const tokenParam = params['token'];
      if (tokenParam) {
        this.token.set(tokenParam);
      } else {
        this.generalError.set('Token de redefinição não encontrado ou inválido.');
        this.logger.warn('ResetPasswordComponent: Token de redefinição não encontrado na URL.');
      }
    });
  }

  private createResetPasswordForm(): FormGroup<{
    password: FormControl<string>;
    confirmPassword: FormControl<string>;
  }> {
    const form = this.fb.group(
      {
        // Usando os validadores de senha do AuthConfigService, acessados via classe base
        password: this.fb.control('', this.authConfigService.passwordValidators()),
        confirmPassword: this.fb.control('', [Validators.required]),
      },
      { validators: this.passwordMatchValidator.bind(this) }, // Garante o 'this' correto
    );
    return form;
  }

  // Validador personalizado para confirmar senha
  private passwordMatchValidator(formGroup: FormGroup) {
    const password = formGroup.get('password')?.value;
    const confirmPassword = formGroup.get('confirmPassword')?.value;

    if (password === confirmPassword) {
      return null;
    } else {
      formGroup.get('confirmPassword')?.setErrors({ passwordMismatch: true });
      return { passwordMismatch: true };
    }
  }

  protected override getFormValue(): ResetPasswordRequest {
    const formValue = this.form.getRawValue();
    const currentToken = this.token();
    if (!currentToken) {
      // Isso não deveria acontecer se o formulário só é mostrado com token válido, mas é uma salvaguarda.
      this.logger.error('ResetPasswordComponent: Tentativa de submissão sem token.');
      throw new Error('Token de redefinição é necessário.');
    }
    return {
      token: currentToken,
      newPassword: formValue.password,
      confirmPassword: formValue.confirmPassword,
    };
  }

  protected override authenticateUser(credentials: ResetPasswordRequest): void {
    this.logger.info('Reset password attempt');

    // Chamar o método resetPassword do AuthStore
    this.authStore.resetPassword(credentials);

    // Similar ao forgotPassword, precisamos de uma forma de saber se a operação foi bem-sucedida
    // para exibir a mensagem correta e redirecionar.
    this.authStore.resetPassword$(credentials).subscribe({
      next: (success) => {
        if (success) {
          this.setSuccess('Sua senha foi redefinida com sucesso! Você pode fazer login agora.');
          // Opcionalmente, redirecionar após um pequeno delay
          // setTimeout(() => this.navigateToLogin(), 3000);
        }
        // O erro já é tratado pelo handleSubmissionError via trackCall no AuthStore
      },
      // O erro já é tratado pelo handleSubmissionError via trackCall no AuthStore
    });
  }

  // Navegação para a página de login
  navigateToLogin() {
    this.router.navigate([this.authConfigService.config().loginRoute || '/login']);
  }

  // Navegação para a página de recuperação de senha
  navigateToForgotPassword() {
    this.router.navigate([this.authConfigService.config().forgotPasswordEndpoint || '/auth/forgot-password']);
  }
}
