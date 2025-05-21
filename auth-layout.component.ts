import { ChangeDetectionStrategy, Component, inject, Input, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthStore } from '@auth/data-access';
import { AuthStatusIndicatorComponent } from '@auth/feat-status-indicator';

@Component({
  selector: 'auth-layout',
  imports: [CommonModule, AuthStatusIndicatorComponent],
  templateUrl: `./auth-layout.component.html`,
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthLayoutComponent {
  readonly showHeader = input(true);
  readonly showFooter = input(true);
  @Input() title = 'Autenticação';
  @Input() subtitle?: string;
  readonly fullscreen = input(false);

  private authStore = inject(AuthStore);

  isAuthenticated = this.authStore.isUserAuthenticated;
  currentUser = this.authStore.currentUser;
}
