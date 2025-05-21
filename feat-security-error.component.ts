import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';

@Component({
  selector: 'auth-security-error',
  imports: [CommonModule, RouterModule],
  template: `./feat-security-error.component.html`,
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatSecurityErrorComponent implements OnInit {
  private route = inject(ActivatedRoute);

  errorCode = 'UNKNOWN';

  ngOnInit() {
    // Obter código de erro da URL (se existir)
    this.route.queryParams.subscribe((params) => {
      if (params['code']) {
        this.errorCode = params['code'];
      } else if (params['reason']) {
        this.errorCode = params['reason'].toUpperCase();
      }
    });
  }
}
