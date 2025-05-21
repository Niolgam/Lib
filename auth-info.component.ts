import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthStore } from '@auth/data-access';
import { TokenService } from '@auth/utils';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'auth-info',
  imports: [CommonModule],
  templateUrl: `./auth-info.component.html`,
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthInfoComponent {
  private authStore = inject(AuthStore);
  private tokenService = inject(TokenService);

  user = this.authStore.currentUser;
  isAuthenticated = this.authStore.isUserAuthenticated;
  decodedToken = this.tokenService.decodedToken;

  // Computed para informações de expiração do token
  expirationInfo = computed(() => {
    const token = this.decodedToken();
    if (!token || !token.exp) return null;

    const expiresAt = new Date(token.exp * 1000);
    const now = new Date();
    const minutesRemaining = Math.floor((expiresAt.getTime() - now.getTime()) / 60000);

    return {
      expiresAt,
      minutesRemaining,
      isExpiringSoon: minutesRemaining <= 5,
      formattedExpiry: expiresAt.toLocaleTimeString(),
    };
  });

  // Computed para último login
  lastLoginInfo = computed(() => {
    const user = this.user();
    if (!user || !user.lastLogin) return null;

    const lastLogin = new Date(user.lastLogin);
    return {
      date: lastLogin.toLocaleDateString(),
      time: lastLogin.toLocaleTimeString(),
      fromNow: this.getTimeFromNow(lastLogin),
    };
  });

  // Formata tempo relativo
  private getTimeFromNow(date: Date): string {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);

    if (seconds < 60) return `${seconds} segundos atrás`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutos atrás`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} horas atrás`;

    return `${Math.floor(seconds / 86400)} dias atrás`;
  }
}
