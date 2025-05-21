import { Directive, effect, inject, TemplateRef, ViewContainerRef, OnChanges, SimpleChanges, Input } from '@angular/core';
import { RoleStore } from '@auth/data-access';

@Directive({
  // eslint-disable-next-line @angular-eslint/directive-selector
  selector: '[hasPermission]',
  standalone: true,
})
export class HasPermissionDirective implements OnChanges {
  private roleStore = inject(RoleStore);
  private templateRef = inject(TemplateRef<unknown>);
  private viewContainer = inject(ViewContainerRef);
  private hasView = false;

  @Input() hasPermission!: string;
  @Input() hasPermissionModule: string = 'core';
  @Input() hasPermissionAction: string = 'view';

  constructor() {
    // Effect que monitora as mudanças de permissão
    effect(() => {
      this.updateView();
    });
  }

  // Detecta mudanças nos inputs
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['hasPermission'] || changes['hasPermissionModule'] || changes['hasPermissionAction']) {
      this.updateView();
    }
  }

  private updateView(): void {
    // Verificação de permissão usando o RoleStore
    const hasPermission = this.roleStore.hasPermissionSync(this.hasPermissionModule, this.hasPermission, this.hasPermissionAction);

    if (hasPermission && !this.hasView) {
      this.viewContainer.createEmbeddedView(this.templateRef);
      this.hasView = true;
    } else if (!hasPermission && this.hasView) {
      this.viewContainer.clear();
      this.hasView = false;
    }
  }
}
