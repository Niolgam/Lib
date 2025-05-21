import { ChangeDetectionStrategy, Component, ElementRef, inject, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, interval, takeUntil } from 'rxjs';

import { AuthStore } from '@auth/data-access';
import { TokenService } from '@auth/utils';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'session-timeout',
  imports: [CommonModule],
  templateUrl: `./auth-session-timeout.component.html`,
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthSessionTimeoutComponent implements OnInit, OnDestroy {
  private authStore = inject(AuthStore);
  private tokenService = inject(TokenService);
  private destroy$ = new Subject<void>();

  readonly dialogElement = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  // Control signals
  isVisible = signal(false);
  countdownValue = signal(0);

  // Config
  private readonly WARNING_THRESHOLD = 120; // Show dialog 2 minutes before expiry
  private readonly CHECK_INTERVAL = 5000; // Check every 5 seconds

  ngOnInit(): void {
    // Start monitoring token expiration
    this.startTokenMonitoring();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private startTokenMonitoring(): void {
    interval(this.CHECK_INTERVAL)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        // Skip if not authenticated
        if (!this.authStore.isUserAuthenticated()) {
          this.hideDialog();
          return;
        }

        // Get token and check expiration
        const decodedToken = this.tokenService.decodedToken();
        if (!decodedToken || !decodedToken.exp) return;

        const now = Math.floor(Date.now() / 1000);
        const timeRemaining = decodedToken.exp - now;

        if (timeRemaining <= this.WARNING_THRESHOLD && timeRemaining > 0) {
          this.countdownValue.set(Math.floor(timeRemaining));
          this.showDialog();
        } else {
          this.hideDialog();
        }
      });
  }

  showDialog(): void {
    if (this.isVisible()) return;
    this.isVisible.set(true);
    requestAnimationFrame(() => {
      const dialogElement = this.dialogElement();
      if (dialogElement?.nativeElement && !dialogElement.nativeElement.open) {
        dialogElement.nativeElement.showModal();
      }
    });
  }

  hideDialog(): void {
    this.isVisible.set(false);
    const dialogElement = this.dialogElement();
    if (dialogElement?.nativeElement?.open) {
      dialogElement.nativeElement.close();
    }
  }

  extendSession(): void {
    this.authStore.refreshToken();
    this.hideDialog();
  }

  logout(): void {
    this.hideDialog();
    this.authStore.logout();
  }
}
