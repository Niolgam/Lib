import { Component, OnInit, output, inject, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl } from '@angular/forms';
import { CommonModule } from '@angular/common';

import { AuthStore } from '@auth/data-access';
import { ChangePasswordRequest } from '@auth/data-access';
import { LoggingService } from '@vai/services';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'user-password-change',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './user-password-change.component.html',
  styleUrls: ['./user-password-change.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserPasswordChangeComponent implements OnInit {
  // Injeção de dependências
  private fb = inject(FormBuilder);
  private authStore = inject(AuthStore);
  private loggingService = inject(LoggingService);

  // Outputs
  readonly passwordChanged = output<void>();

  // Signals internos
  readonly passwordForm = signal<FormGroup>(this.createForm());
  readonly isSubmitting = signal(false);
  readonly validationErrors = signal<Record<string, string>>({});
  readonly successMessage = signal<string>('');
  readonly showSuccessMessage = signal(false);
  readonly showPasswords = signal({
    current: false,
    new: false,
    confirm: false,
  });

  // Computed values
  readonly isFormValid = computed(() => this.passwordForm().valid);
  readonly canSave = computed(() => this.isFormValid() && !this.isSubmitting());
  readonly passwordStrength = computed(() => this.calculatePasswordStrength());

  ngOnInit() {
    // Configurar validação reativa
    this.setupReactiveValidation();
  }

  private createForm(): FormGroup {
    return this.fb.group(
      {
        currentPassword: ['', [Validators.required]],
        newPassword: ['', [Validators.required, Validators.minLength(8), this.passwordStrengthValidator()]],
        confirmPassword: ['', [Validators.required]],
      },
      {
        validators: [this.passwordMatchValidator()],
      },
    );
  }

  private setupReactiveValidation(): void {
    const form = this.passwordForm();

    // Validação em tempo real para confirmação de senha
    form.get('confirmPassword')?.valueChanges.subscribe(() => {
      this.validatePasswordMatch();
    });

    form.get('newPassword')?.valueChanges.subscribe(() => {
      // Revalidar confirmação quando nova senha muda
      const confirmControl = form.get('confirmPassword');
      if (confirmControl?.value) {
        confirmControl.updateValueAndValidity();
      }
    });
  }

  // Validador customizado para força da senha
  private passwordStrengthValidator() {
    return (control: AbstractControl) => {
      if (!control.value) return null;

      const password = control.value;
      const hasUpperCase = /[A-Z]/.test(password);
      const hasLowerCase = /[a-z]/.test(password);
      const hasNumbers = /\d/.test(password);
      const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

      const strengthScore = [hasUpperCase, hasLowerCase, hasNumbers, hasSpecialChar].filter(Boolean).length;

      if (strengthScore < 3) {
        return { weakPassword: true };
      }

      // Verificar sequências comuns
      const commonSequences = ['123456', 'abcdef', 'qwerty', 'password'];
      if (commonSequences.some((seq) => password.toLowerCase().includes(seq))) {
        return { commonSequence: true };
      }

      return null;
    };
  }

  // Validador para confirmação de senha
  private passwordMatchValidator() {
    return (form: AbstractControl) => {
      const newPassword = form.get('newPassword')?.value;
      const confirmPassword = form.get('confirmPassword')?.value;

      if (!newPassword || !confirmPassword) return null;

      return newPassword === confirmPassword ? null : { passwordMismatch: true };
    };
  }

  private validatePasswordMatch(): void {
    const form = this.passwordForm();
    const errors = this.validationErrors();

    if (form.hasError('passwordMismatch')) {
      this.validationErrors.set({
        ...errors,
        confirmPassword: 'Passwords do not match',
      });
    } else {
      const { confirmPassword, ...otherErrors } = errors;
      this.validationErrors.set(otherErrors);
    }
  }

  // Calcular força da senha
  private calculatePasswordStrength(): { score: number; label: string; color: string } {
    const newPassword = this.passwordForm().get('newPassword')?.value || '';

    if (!newPassword) {
      return { score: 0, label: '', color: 'gray' };
    }

    let score = 0;
    const checks = [
      { test: /.{8,}/, points: 1 }, // Mínimo 8 caracteres
      { test: /[A-Z]/, points: 1 }, // Maiúscula
      { test: /[a-z]/, points: 1 }, // Minúscula
      { test: /\d/, points: 1 }, // Número
      { test: /[!@#$%^&*(),.?":{}|<>]/, points: 1 }, // Caractere especial
      { test: /.{12,}/, points: 1 }, // 12+ caracteres (bônus)
    ];

    score = checks.reduce((total, check) => total + (check.test.test(newPassword) ? check.points : 0), 0);

    // Definir label e cor baseado na pontuação
    if (score <= 2) return { score, label: 'Weak', color: 'red' };
    if (score <= 4) return { score, label: 'Medium', color: 'yellow' };
    return { score, label: 'Strong', color: 'green' };
  }

  // Toggle visibilidade das senhas
  togglePasswordVisibility(field: 'current' | 'new' | 'confirm'): void {
    this.showPasswords.update((state) => ({
      ...state,
      [field]: !state[field],
    }));
  }

  async onSubmit(): Promise<void> {
    const form = this.passwordForm();

    if (form.invalid) {
      this.markFormGroupTouched(form);
      this.validateForm();
      return;
    }

    this.isSubmitting.set(true);
    this.validationErrors.set({});
    this.showSuccessMessage.set(false);

    try {
      const formValue = form.value;
      const changeRequest: ChangePasswordRequest = {
        currentPassword: formValue.currentPassword,
        newPassword: formValue.newPassword,
        confirmPassword: formValue.confirmPassword,
      };

      await this.changePassword(changeRequest);

      // Exibir mensagem de sucesso
      this.successMessage.set('Password changed successfully!');
      this.showSuccessMessage.set(true);

      // Limpar formulário
      form.reset();

      // Esconder mensagem após 5 segundos
      setTimeout(() => {
        this.showSuccessMessage.set(false);
      }, 5000);

      // Emitir evento de sucesso
      this.passwordChanged.emit();
    } catch (error) {
      this.handleSubmissionError(error);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  private async changePassword(request: ChangePasswordRequest): Promise<void> {
    return new Promise((resolve, reject) => {
      this.authStore.changePassword(request);

      // Simular observação do resultado
      setTimeout(() => {
        // Simular possíveis erros
        const simulateError = Math.random() < 0.1; // 10% chance de erro

        if (simulateError) {
          const errorType = Math.random();
          if (errorType < 0.5) {
            reject({
              status: 400,
              message: 'Current password is incorrect',
            });
          } else {
            reject({
              status: 422,
              validationErrors: {
                newPassword: 'New password does not meet security requirements',
              },
            });
          }
        } else {
          this.loggingService.info('Password changed successfully');
          resolve();
        }
      }, 1500);
    });
  }

  private handleSubmissionError(error: any): void {
    this.loggingService.error('Error changing password', error);

    if (error.status === 400 && error.message?.includes('current password')) {
      this.validationErrors.set({
        currentPassword: 'Current password is incorrect',
      });
    } else if (error.status === 422 && error.validationErrors) {
      this.validationErrors.set(error.validationErrors);
    } else if (error.message) {
      this.validationErrors.set({ general: error.message });
    } else {
      this.validationErrors.set({
        general: 'An unexpected error occurred. Please try again.',
      });
    }
  }

  private markFormGroupTouched(formGroup: FormGroup): void {
    Object.keys(formGroup.controls).forEach((field) => {
      const control = formGroup.get(field);
      control?.markAsTouched({ onlySelf: true });
    });
  }

  private validateForm(): void {
    const form = this.passwordForm();
    const errors: Record<string, string> = {};

    Object.keys(form.controls).forEach((field) => {
      const control = form.get(field);
      if (control && !control.valid && control.touched) {
        const fieldErrors = control.errors;

        if (fieldErrors?.['required']) {
          errors[field] = `${this.getFieldDisplayName(field)} is required`;
        } else if (fieldErrors?.['minlength']) {
          const requiredLength = fieldErrors['minlength'].requiredLength;
          errors[field] = `Password must be at least ${requiredLength} characters`;
        } else if (fieldErrors?.['weakPassword']) {
          errors[field] = 'Password must contain uppercase, lowercase, numbers, and special characters';
        } else if (fieldErrors?.['commonSequence']) {
          errors[field] = 'Password contains common sequences that are not secure';
        }
      }
    });

    // Validação do formulário completo
    if (form.hasError('passwordMismatch')) {
      errors['confirmPassword'] = 'Passwords do not match';
    }

    this.validationErrors.set(errors);
  }

  private getFieldDisplayName(field: string): string {
    const displayNames: Record<string, string> = {
      currentPassword: 'Current password',
      newPassword: 'New password',
      confirmPassword: 'Password confirmation',
    };
    return displayNames[field] || field;
  }

  // Getters para o template
  get hasValidationErrors(): boolean {
    return Object.keys(this.validationErrors()).length > 0;
  }

  // Método para resetar o formulário
  resetForm(): void {
    this.passwordForm.set(this.createForm());
    this.validationErrors.set({});
    this.showSuccessMessage.set(false);
    this.showPasswords.set({
      current: false,
      new: false,
      confirm: false,
    });
  }

  // Método para gerar senha sugerida (futuro)
  generateSuggestedPassword(): void {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    this.passwordForm().patchValue({
      newPassword: password,
      confirmPassword: password,
    });

    this.loggingService.debug('Generated suggested password');
  }
}
