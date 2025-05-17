import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthStore } from '@auth/data-access';
@Component({
  selector: 'access-denied',
  imports: [CommonModule],
  templateUrl: `./access-denied.component.html`,
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatAccessDeniedComponent {
  private authStore = inject(AuthStore);

  isAuthenticated() {
    return this.authStore.isUserAuthenticated();
  }
}
