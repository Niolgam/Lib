import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthStore } from '@auth/data-access';

@Component({
  selector: 'auth-logout',
  imports: [CommonModule],
  templateUrl: `./auth-logout.component.html`,
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthLogoutComponent implements OnInit {
  private authStore = inject(AuthStore);
  private router = inject(Router);

  // Converter isLoading e error do Observable para property
  isLoading = this.authStore.isLoadingByKeySignal('logout');
  error = this.authStore.getErrorByKeySignal('logout');

  // Computado para verificar se há erro
  get hasError(): boolean {
    return !!this.error();
  }

  ngOnInit() {
    // Verificar se o usuário já está autenticado
    if (!this.authStore.isUserAuthenticated()) {
      // Se não estiver autenticado, redirecionar para login
      // TODO: Tem que pegar o caminho do authconfig
      this.router.navigate(['/auth/login']);
      return;
    }

    // Iniciar processo de logout
    this.logout();
  }

  // Método para fazer logout
  logout() {
    // Chamar o método de logout do AuthStore que já faz o redirecionamento
    this.authStore.logout();
  }
}
