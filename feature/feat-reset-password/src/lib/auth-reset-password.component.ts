import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthStore } from '@auth/data-access';

// Interface para o formulário de redefinição de senha
interface ResetPasswordForm {
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
export class AuthResetPasswordComponent implements OnInit {
  private fb = inject(NonNullableFormBuilder);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private authStore = inject(AuthStore);

  // Signals para estado do componente
  token = signal<string | null>(null);
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);
  isLoading = signal<boolean>(false);

  // Formulário de redefinição de senha
  resetPasswordForm = this.createResetPasswordForm();

  // Computed para verificar se o botão deve estar desabilitado
  disableSubmitButton = computed(() => this.isLoading() || this.resetPasswordForm.invalid);

  // Computed para verificar erros nos campos
  hasPasswordError = computed(() => {
    const control = this.resetPasswordForm.controls.password;
    return control.touched && control.invalid;
  });

  hasConfirmPasswordError = computed(() => {
    const control = this.resetPasswordForm.controls.confirmPassword;
    return (control.touched && control.invalid) || this.resetPasswordForm.errors?.['passwordMismatch'];
  });

  ngOnInit() {
    // Obter token da URL
    this.route.queryParams.subscribe((params) => {
      const tokenParam = params['token'];
      if (tokenParam) {
        this.token.set(tokenParam);
      } else {
        this.errorMessage.set('Token de redefinição não encontrado na URL.');
      }
    });
  }

  private createResetPasswordForm() {
    const form = this.fb.group<ResetPasswordForm>(
      {
        password: this.fb.control('', [
          Validators.required,
          Validators.minLength(6),
          Validators.pattern(/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{6,}$/), // pelo menos uma letra e um número
        ]),
        confirmPassword: this.fb.control('', [Validators.required]),
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
    if (this.resetPasswordForm.invalid || !this.token()) {
      this.markFormGroupTouched();
      return;
    }

    this.errorMessage.set(null);
    this.isLoading.set(true);

    const formValue = this.resetPasswordForm.getRawValue();

    // Chamar o serviço de redefinição de senha
    this.authStore.resetPassword({
      token: this.token()!,
      newPassword: formValue.password,
      confirmPassword: formValue.confirmPassword,
    });
  }

  // Navegação para a página de login
  navigateToLogin() {
    this.router.navigate(['/auth/login']);
  }

  // Navegação para a página de recuperação de senha
  navigateToForgotPassword() {
    this.router.navigate(['/auth/forgot-password']);
  }

  // Utilitário para marcar todos os campos como tocados
  private markFormGroupTouched() {
    Object.values(this.resetPasswordForm.controls).forEach((control) => {
      control.markAsTouched();
      control.updateValueAndValidity();
    });
  }
}
