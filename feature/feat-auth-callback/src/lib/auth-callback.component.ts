import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthStore } from '@auth/data-access';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'auth-callback',
  imports: [CommonModule],
  templateUrl: `./auth-callback.component.html`,
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthCallbackComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private authStore = inject(AuthStore);

  // Signals para estado do componente
  isProcessing = signal<boolean>(true);
  error = signal<boolean>(false);
  title = signal<string>('Autenticando...');
  message = signal<string>('Por favor, aguarde enquanto processamos sua autenticação.');

  ngOnInit() {
    // Obter parâmetros da URL
    this.route.queryParams.subscribe((params) => {
      // Verificar se há um código de autorização
      const code = params['code'];
      const state = params['state']; // Pode conter o provedor ou outras informações
      const nonce = params['nonce']; // Para proteção contra CSRF
      const error = params['error'];
      const errorDescription = params['error_description'];

      // Se houver erro nos parâmetros
      if (error) {
        this.handleError(error, errorDescription);
        return;
      }

      // Se não houver código
      if (!code) {
        this.handleError('no_code', 'Código de autorização não encontrado.');
        return;
      }

      // Determinar o provedor com base no state ou em outras informações
      const provider = this.determineProvider(state);

      // Processar o callback
      this.processCallback(code, provider, nonce);
    });
  }

  // Método para determinar o provedor com base no state ou outras informações
  private determineProvider(state: string | undefined): 'google' | 'govbr' | 'custom' {
    if (!state) {
      // Se não houver state, assume Google como padrão
      return 'google';
    }

    // Verificar o conteúdo do state para determinar o provedor
    if (state.includes('google')) {
      return 'google';
    } else if (state.includes('govbr')) {
      return 'govbr';
    } else {
      return 'custom';
    }
  }

  // Método para processar o callback
  private processCallback(code: string, provider: 'google' | 'govbr' | 'custom', nonce?: string) {
    this.authService.handleAuthCallback(code, provider, nonce).subscribe({
      next: (token) => {
        this.isProcessing.set(false);
        this.title.set('Autenticação bem-sucedida!');
        this.message.set('Você será redirecionado em instantes...');

        // Verificar se o token foi salvo corretamente
        if (this.authStore.isUserAuthenticated()) {
          // Carregar dados do usuário e redirecionar
          this.authStore.loadUser().subscribe({
            next: () => {
              this.authStore.redirectAfterLogin();
            },
            error: () => {
              // Mesmo com erro ao carregar usuário, redirecionar
              this.authStore.redirectAfterLogin();
            },
          });
        } else {
          this.handleError('auth_error', 'Falha ao processar autenticação.');
        }
      },
      error: (error) => {
        this.handleError('auth_error', error.message || 'Ocorreu um erro durante a autenticação.');
      },
    });
  }

  // Método para lidar com erros
  private handleError(errorCode: string, errorMessage?: string) {
    this.isProcessing.set(false);
    this.error.set(true);
    this.title.set('Falha na autenticação');
    this.message.set(errorMessage || 'Ocorreu um erro durante o processo de autenticação. Por favor, tente novamente.');
  }

  // Navegação para a página de login
  navigateToLogin() {
    this.router.navigate(['/auth/login']);
  }
}
