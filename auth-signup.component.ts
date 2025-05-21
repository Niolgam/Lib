import { ChangeDetectionStrategy, Component, computed, effect, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AbstractControl, FormControl, FormGroup, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SignupFormData, SignupFormShape, SignupRequestPayload, User } from '@auth/data-access';
import { AuthFormBaseComponent } from '@auth/base-form';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'auth-signup',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './auth-signup.component.html',
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthSignupComponent extends AuthFormBaseComponent<SignupFormData, SignupRequestPayload> implements OnInit {
  private fb = inject(NonNullableFormBuilder);
  private router = inject(Router);

  // Criar formulário de registro fortemente tipado
  override form = this.createSignupForm();

  // Computed para verificar erros nos campos
  readonly hasNameError = computed(() => {
    const control = this.form.controls.name;
    return control.touched && control.invalid;
  });

  readonly hasEmailError = computed(() => {
    const control = this.form.controls.email;
    return control.touched && control.invalid;
  });

  readonly hasPasswordError = computed(() => {
    const control = this.form.controls.password;
    return control.touched && control.invalid;
  });

  readonly hasConfirmPasswordError = computed(() => {
    const control = this.form.controls.confirmPassword;
    return (control.touched && control.invalid) || this.form.errors?.['passwordMismatch'];
  });

  readonly hasTermsError = computed(() => {
    const control = this.form.controls.terms;
    return control.touched && control.invalid;
  });

  // Computed para mensagem de requisitos de senha
  readonly passwordRequirements = computed(() => this.getPasswordRequirementsMessage());

  constructor() {
    super({
      formId: 'signup-form',
      enablePersistence: true,
      enableHistory: true,
      debounceTime: 300,
    });
  }

  override ngOnInit(): void {
    super.ngOnInit();

    // Verificar se o usuário já está autenticado
    if (this.checkAuthenticationStatus()) {
      return;
    }

    // Verificar se signup está habilitado
    if (!this.isSignupEnabled()) {
      this.logger.warn('Signup is disabled');
      this.router.navigate([this.authConfigService.config().loginRoute || '/login']);
    }
  }

  // Implementação específica do createArrayItem se necessário
  protected override createArrayItem(arrayName: string, initialValue?: unknown): AbstractControl {
    // Para este componente, podemos usar a implementação padrão
    return super.createArrayItem(arrayName, initialValue);
  }

  // Criar formulário com validações
  private createSignupForm(): FormGroup<SignupFormShape> {
    const form = this.fb.group(
      {
        name: this.fb.control('', [Validators.required, Validators.minLength(3)]),
        email: this.fb.control('', [Validators.required, Validators.email]),
        password: this.fb.control('', this.getPasswordValidators()),
        confirmPassword: this.fb.control('', [Validators.required]),
        terms: this.fb.control(false, [Validators.requiredTrue]),
      },
      { validators: this.passwordMatchValidator.bind(this) },
    );
    return form;
  }

  // Validador personalizado para confirmar senha
  private passwordMatchValidator(formGroup: FormGroup) {
    const password = formGroup.get('password')?.value;
    const confirmPassword = formGroup.get('confirmPassword')?.value;

    if (password === confirmPassword) {
      // Remove o erro se as senhas coincidem
      const confirmPasswordControl = formGroup.get('confirmPassword');
      if (confirmPasswordControl?.hasError('passwordMismatch')) {
        const errors = confirmPasswordControl.errors;
        delete errors!['passwordMismatch'];
        confirmPasswordControl.setErrors(Object.keys(errors!).length ? errors : null);
      }
      return null;
    } else {
      // Adiciona o erro ao controle confirmPassword
      formGroup.get('confirmPassword')?.setErrors({ passwordMismatch: true });
      return { passwordMismatch: true };
    }
  }

  protected override getFormValue(): SignupRequestPayload {
    const formValue = this.form.getRawValue() as SignupFormData;
    // Remove confirmPassword e terms antes de enviar
    const { confirmPassword, terms, ...requestPayload } = formValue;
    return requestPayload;
  }

  protected override authenticateUser(credentials: SignupRequestPayload): void {
    this.logger.info('Signup attempt', { email: credentials.email });

    const operationKey = 'signup';

    this.authStore.trackCall(operationKey, this.authService.registerUserRequest(credentials)).subscribe({
      next: (response: User | null) => {
        if (response) {
          this.logger.info('Signup successful', { email: credentials.email, userId: response.id });
          this.setSuccess('Registro realizado com sucesso! Você será redirecionado para o login.');

          // Redirecionar para login após delay
          setTimeout(() => {
            this.router.navigate([this.authConfigService.config().loginRoute || '/login'], {
              queryParams: { registered: 'true', email: credentials.email },
            });
          }, 2000);
        } else {
          this.handleSubmissionError(new Error('Resposta inesperada do servidor durante o registro.'));
        }
      },
      error: (error) => {
        this.handleSubmissionError(error);
      },
    });
  }

  // Métodos auxiliares para o template
  getFieldError(fieldName: keyof SignupFormShape): string | null {
    return super.getFieldError(fieldName);
  }

  // Método para obter mensagem de erro específica para confirmação de senha
  getConfirmPasswordErrorMessage(): string | null {
    const control = this.form.controls.confirmPassword;
    if (control.hasError('required') && control.touched) {
      return 'Confirmação de senha é obrigatória';
    }
    if (control.hasError('passwordMismatch') || this.form.hasError('passwordMismatch')) {
      return 'As senhas não coincidem';
    }
    return null;
  }
}
