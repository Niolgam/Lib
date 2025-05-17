import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormControl, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthStore } from '@auth/data-access';

// Interface para formulário de recuperação de senha
interface ForgotPasswordForm {
  email: FormControl<string>;
}

@Component({
  selector: 'forgot-password',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: `./auth-forgot-password.component.html`,
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthForgotPasswordComponent {
  private fb = inject(NonNullableFormBuilder);
  private router = inject(Router);
  private authStore = inject(AuthStore);

  // Signals para estado do componente
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);
  isLoading = signal<boolean>(false);

  // Formulário de recuperação de senha
  forgotPasswordForm = this.createForgotPasswordForm();

  // Computed para verificar se o botão deve estar desabilitado
  disableSubmitButton = computed(() => this.isLoading() || this.forgotPasswordForm.invalid);

  // Computed para verificar erros no campo de email
  hasEmailError = computed(() => {
    const control = this.forgotPasswordForm.controls.email;
    return control.touched && control.invalid;
  });

  // Criar formulário
  private createForgotPasswordForm() {
    return this.fb.group<ForgotPasswordForm>({
      email: this.fb.control('', [Validators.required, Validators.email]),
    });
  }

  onSubmit() {
    if (this.forgotPasswordForm.invalid) {
      this.markFormGroupTouched();
      return;
    }

    this.errorMessage.set(null);
    this.isLoading.set(true);

    const email = this.forgotPasswordForm.controls.email.value;

    // Chamar o serviço de recuperação de senha
    this.authStore.forgotPassword({ email });
  }

  // Navegação para a página de login
  navigateToLogin() {
    this.router.navigate(['/auth/login']);
  }

  // Utilitário para marcar todos os campos como tocados
  private markFormGroupTouched() {
    Object.values(this.forgotPasswordForm.controls).forEach((control) => {
      control.markAsTouched();
      control.updateValueAndValidity();
    });
  }
}
