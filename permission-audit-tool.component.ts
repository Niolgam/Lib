import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'ws-permission-audit-tool',
  imports: [CommonModule],
  template: `<p>PermissionAuditTool works!</p>`,
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PermissionAuditToolComponent {}
