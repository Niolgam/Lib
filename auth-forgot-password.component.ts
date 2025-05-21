import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormControl, FormGroup, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthStore, ForgotPasswordRequest } from '@auth/data-access';
import { AuthFormBaseComponent } from '@auth/base-form';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'auth-forgot-password',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: `./auth-forgot-password.component.html`,
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthForgotPasswordComponent extends AuthFormBaseComponent<ForgotPasswordRequest> implements OnInit {
  private fb = inject(NonNullableFormBuilder);
  private router = inject(Router);
  // AuthStore já é injetado em AuthFormBaseComponent

  // Signals para estado do componente
  // errorMessage, successMessage, isLoading, disableSubmitButton são gerenciados pela classe base

  // Formulário de recuperação de senha
  override form = this.createForgotPasswordForm();

  // Computed para verificar erros no campo de email
  readonly hasEmailError = computed(() => {
    const control = this.form.controls.email;
    return control.touched && control.invalid;
  });

  constructor() {
    super();
  }

  override ngOnInit(): void {
    super.ngOnInit();
    // Lógica específica de ngOnInit do AuthForgotPasswordComponent, se houver
  }

  // Criar formulário
  private createForgotPasswordForm(): FormGroup<{
    email: FormControl<string>;
  }> {
    return this.fb.group({
      email: this.fb.control('', [Validators.required, Validators.email]),
    });
  }

  protected override getFormValue(): ForgotPasswordRequest {
    return this.form.getRawValue();
  }

  protected override authenticateUser(credentials: ForgotPasswordRequest): void {
    this.logger.info('Forgot password attempt', { email: credentials.email });

    // Chamar o método forgotPassword do AuthStore
    // O rxMethod no AuthStore cuidará do trackCall e do estado de submissão
    this.authStore.forgotPassword(credentials);

    // O AuthStore.forgotPassword é um rxMethod, então o estado de submissão
    // e erros/sucesso serão tratados pelos signals (isSubmitting, generalError, successMessage)
    // que são atualizados pelo trackCall dentro do rxMethod.
    // Precisamos observar o resultado da chamada para definir a mensagem de sucesso.

    // TODO: Idealmente, o rxMethod no AuthStore deveria permitir um callback de sucesso/erro,
    // ou o componente deveria observar o resultado da chamada para definir a mensagem de sucesso.
    // Por agora, vamos simular a observação do estado do store.
    // Esta parte pode precisar de ajuste dependendo de como o rxMethod no AuthStore é implementado
    // para notificar o componente sobre o sucesso da operação.

    // Exemplo de como poderia ser (assumindo que o store emite um evento ou atualiza um signal de sucesso específico):
    // this.authStore.forgotPasswordCallState.pipe(take(1)).subscribe(state => {
    //   if (state.status === 'success') {
    //      this.setSuccess(`Se um email ${credentials.email} estiver registrado, um link de recuperação foi enviado.`);
    //   }
    // });
    // Como alternativa, se o `trackCall` no `AuthStore` já define `successMessage` ou um estado similar,
    // não precisaríamos fazer nada aqui além de chamar o método do store.
    // Por ora, vamos assumir que o `AuthStore.forgotPassword` internamente no `onSuccess` do `trackCall`
    // pode definir uma mensagem de sucesso que o `AuthFormBaseComponent` possa ler.
    // Se não, o `setSuccess` pode ser chamado aqui baseado em um observable retornado pelo `forgotPassword`
    // ou um `effect` no componente que observa o estado de `callState` do store.

    // Para simplificar e alinhar com a estrutura do BaseFormComponent,
    // vamos assumir que o `AuthStore.forgotPassword` (sendo um rxMethod)
    // irá atualizar o `generalError` ou um `successMessage` no próprio store,
    // e o `AuthFormBaseComponent` já observa `generalError`.
    // Se o `AuthStore` não definir um `successMessage` global, precisaremos de uma forma de
    // o componente saber que a operação foi bem-sucedida para exibir a mensagem correta.

    // Solução temporária: definir a mensagem de sucesso aqui, mas idealmente
    // o store deveria prover um mecanismo mais robusto para isso.
    // O `trackCall` no `AuthStore` deveria ser configurado para atualizar um `successMessageSignal`
    // ou o `AuthFormBaseComponent` deveria ter uma forma de reagir ao sucesso do `trackCall`.

    // Assumindo que o `AuthStore.forgotPassword` é um rxMethod que usa `trackCall`
    // e que o `trackCall` atualiza `generalError` em caso de falha.
    // Para o sucesso, o `AuthFormBaseComponent` não tem um `successMessage` genérico.
    // Portanto, este componente precisa definir sua própria mensagem de sucesso.
    // Vamos usar o `successMessage` local (herdado) e o `setSuccess` herdado.

    // A lógica de sucesso/erro agora é gerenciada pelo AuthStore via rxMethod e trackCall.
    // O BaseFormComponent já escuta o `generalError`.
    // Para a mensagem de sucesso, o `AuthStore` precisaria de um `successSignal` ou
    // o `forgotPassword` (rxMethod) deveria retornar um Observable que o componente possa subscrever
    // para então chamar `this.setSuccess()`.

    // Vamos simular que o `AuthStore.forgotPassword` retorna um Observable que podemos subscrever.
    // (Esta é uma suposição, o código do AuthStore não foi fornecido para esta parte)
    this.authStore.forgotPassword$(credentials).subscribe({
      next: (success) => {
        // Supondo que o Observable emite um booleano ou objeto indicando sucesso
        if (success) {
          this.setSuccess(`Se um email ${credentials.email} estiver registrado, um link de recuperação foi enviado.`);
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
}
