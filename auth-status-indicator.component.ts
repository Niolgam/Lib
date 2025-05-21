import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';

import { AuthStore } from '@auth/data-access';
import { AuthInfoComponent } from '@auth/feat-info';

@Component({
  selector: 'ws-auth-status-indicator',
  imports: [CommonModule, RouterModule, AuthInfoComponent],
  templateUrl: `./auth-status-indicator.component.html`,
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthStatusIndicatorComponent {
  private authStore = inject(AuthStore);

  isAuthenticated = this.authStore.isUserAuthenticated;
  currentUser = this.authStore.currentUser;
  isMenuOpen = signal(false);

  // Format display name
  displayName = computed(() => {
    const user = this.currentUser();
    if (!user) return '';

    // If name exists, use initials
    if (user.name) {
      const names = user.name.split(' ');
      if (names.length > 1) {
        return `${names[0].charAt(0)}${names[names.length - 1].charAt(0)}`.toUpperCase();
      }
      return user.name.substring(0, 2).toUpperCase();
    }

    // Fallback to email
    return user.email.substring(0, 2).toUpperCase();
  });

  // Toggle menu
  toggleMenu(): void {
    this.isMenuOpen.update((value) => !value);
  }

  // Close menu
  closeMenu(): void {
    this.isMenuOpen.set(false);
  }

  // Logout
  logout(): void {
    this.closeMenu();
    this.authStore.logout();
  }
}
