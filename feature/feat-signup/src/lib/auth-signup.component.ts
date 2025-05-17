import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormControl, FormGroup, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthStore } from '@auth/data-access';
import { AuthService, AuthConfigService } from '@auth/utils';

interface SignupForm {
  name: FormControl<string>;
  email: FormControl<string>;
  password: FormControl<string>;
  confirmPassword: FormControl<string>;
  terms: FormControl<boolean>;
}

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'auth-signup',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './auth-signup.component.html',
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthSignupComponent {
  private fb = inject(NonNullableFormBuilder);
  private router = inject(Router);
  private authStore = inject(AuthStore);
  private authConfig = inject(AuthConfigService);

  // Signals para estado do componente
  signupError = signal<string | null>(null);

  // Criar formulário de registro fortemente tipado
  signupForm = this.createSignupForm();

  // Loading state
  isLoading = signal<boolean>(false);

  // Computed para verificar se o botão deve estar desabilitado
  disableSignupButton = computed(() => this.isLoading() || this.signupForm.invalid);

  // Computed para verificar erros nos campos
  hasNameError = computed(() => {
    const control = this.signupForm.controls.name;
    return control.touched && control.invalid;
  });

  hasEmailError = computed(() => {
    const control = this.signupForm.controls.email;
    return control.touched && control.invalid;
  });

  hasPasswordError = computed(() => {
    const control = this.signupForm.controls.password;
    return control.touched && control.invalid;
  });

  hasConfirmPasswordError = computed(() => {
    const control = this.signupForm.controls.confirmPassword;
    return (control.touched && control.invalid) || this.signupForm.errors?.['passwordMismatch'];
  });

  // Criar formulário com validações
  private createSignupForm() {
    const form = this.fb.group<SignupForm>(
      {
        name: this.fb.control('', [Validators.required, Validators.minLength(3)]),
        email: this.fb.control('', [Validators.required, Validators.email]),
        password: this.fb.control('', this.authConfig.passwordValidators()),
        confirmPassword: this.fb.control('', [Validators.required]),
        terms: this.fb.control(false, [Validators.requiredTrue]),
      },
      { validators: this.passwordMatchValidator },
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
      return { passwordMismatch: true };
    }
  }

  // Método para submeter o formulário
  onSubmit() {
    if (this.signupForm.invalid) {
      this.markFormGroupTouched();
      return;
    }

    this.signupError.set(null);
    this.isLoading.set(true);

    const formValue = this.signupForm.getRawValue();

    // Remover confirmPassword
    const { confirmPassword, ...userData } = formValue;

    // TODO: AuthStore
    // this.authService.register(userData).subscribe({
    //   next: () => {
    //     this.isLoading.set(false);
    //
    //     // Redirecionar para login ou página de confirmação
    //     this.router.navigate(['/auth/login'], {
    //       queryParams: { registered: 'true' },
    //     });
    //   },
    //   error: (error) => {
    //     this.isLoading.set(false);
    //     this.signupError.set(error.message || 'Ocorreu um erro durante o registro.');
    //   },
    // });
  }

  // Utilitário para marcar todos os campos como tocados
  private markFormGroupTouched() {
    Object.values(this.signupForm.controls).forEach((control) => {
      control.markAsTouched();
      control.updateValueAndValidity();
    });
  }
}
