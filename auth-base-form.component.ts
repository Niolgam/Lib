import { Directive, inject, signal, computed } from '@angular/core';

import { BaseFormComponent, BaseFormOptions } from '@component/form-base'; // Ajuste o caminho se necessário
import { AuthStore } from '@auth/data-access';
import { AuthConfigService, AuthService } from '@auth/utils'; // Adicionado para acesso à config
import { AbstractControl, FormControl } from '@angular/forms';

// Tipagem genérica para o valor do formulário e o payload de submissão.
// FormValue é o tipo dos dados brutos do formulário.
// SubmitPayload é o tipo dos dados após qualquer transformação, antes de serem enviados.
@Directive()
export abstract class AuthFormBaseComponent<
  FormValue extends Record<string, unknown> = Record<string, unknown>,
  SubmitPayload extends Record<string, unknown> = FormValue,
> extends BaseFormComponent<SubmitPayload> {
  protected authStore = inject(AuthStore);
  protected authService = inject(AuthService);
  protected authConfigService = inject(AuthConfigService);

  protected readonly showPassword = signal(false);
  readonly passwordVisibility = computed(() => (this.showPassword() ? 'text' : 'password'));
  readonly authError = computed(() => this.generalError());

  constructor(defaultOptions?: Partial<BaseFormOptions>) {
    super(defaultOptions);
  }

  protected checkAuthenticationStatus(): boolean {
    if (this.authStore.isUserAuthenticated()) {
      this.logger.debug('User already authenticated, redirecting based on AuthStore logic.');
      this.authStore.redirectAfterLogin();
      return true;
    }
    return false;
  }

  togglePasswordVisibility(): void {
    this.showPassword.update((value) => !value);
  }

  protected override setupFormSubscriptions(): void {
    super.setupFormSubscriptions();
  }

  // Implementação padrão do método abstrato da BaseFormComponent
  // Pode ser sobrescrito nas classes filhas se necessário
  protected createArrayItem(arrayName: string, initialValue?: unknown): AbstractControl {
    // Implementação padrão simples - retorna um FormControl
    // Classes filhas podem sobrescrever para lógica mais específica
    return new FormControl(initialValue || '');
  }

  // Método abstrato que deve ser implementado pelas classes filhas
  protected abstract authenticateUser(payload: SubmitPayload): void;

  protected override getFormValue(): SubmitPayload {
    return this.form.getRawValue() as SubmitPayload;
  }

  protected override submitFormLogic(payload: SubmitPayload): void {
    this.authenticateUser(payload);
  }

  // Métodos auxiliares para formulários de autenticação
  protected getPasswordRequirementsMessage(): string {
    return this.authConfigService.passwordRequirementsMessage();
  }

  protected isSignupEnabled(): boolean {
    return this.authConfigService.isSignupEnabled();
  }

  protected getPasswordValidators() {
    return this.authConfigService.passwordValidators();
  }
}
