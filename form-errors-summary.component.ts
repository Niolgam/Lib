// form-errors-summary.component.ts
import { Component, Input, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, FormArray, FormControl } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormUtilsService, ValidationService } from '@vai/services';
import { trigger, transition, style, animate, state, query, stagger } from '@angular/animations';

/**
 * Interface para estrutura de erro de formulário
 */
export interface FormError {
  message: string;
  field?: string;
  path?: string; // Caminho completo para o campo
  severity: 'error' | 'warning' | 'info';
  section?: string; // Seção do formulário (opcional)
}

/**
 * Interface para opções do componente
 */
export interface ErrorSummaryOptions {
  showIcon?: boolean;
  groupBySection?: boolean;
  maxErrors?: number;
  showSeverity?: boolean;
  collapsible?: boolean;
  autoScroll?: boolean;
  scrollOffset?: number;
  clickToFocus?: boolean;
}

/**
 * Componente que exibe um resumo dos erros em formulários complexos
 * Facilita a navegação e correção de erros em formulários grandes
 */
@Component({
  selector: 'o-form-errors-summary',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="errors-summary-container"
      *ngIf="shouldShowSummary()"
      [class.collapsed]="isCollapsed()"
      [@slideInOut]="isCollapsed() ? 'collapsed' : 'expanded'"
    >
      <div class="summary-header" (click)="toggleCollapse()">
        <div class="summary-header-content">
          <div class="summary-icon" *ngIf="options.showIcon">⚠️</div>
          <h3 class="summary-title">
            {{ title || 'Corrija os seguintes erros:' }}
            <span class="error-count">({{ totalErrors() }})</span>
          </h3>
        </div>

        <button
          type="button"
          class="collapse-button"
          *ngIf="options.collapsible"
          (click)="toggleCollapse(); $event.stopPropagation()"
        >
          {{ isCollapsed() ? '▼' : '▲' }}
        </button>
      </div>

      <div class="summary-content" *ngIf="!isCollapsed()" [@contentAnimation]>
        <!-- Agrupado por seção -->
        <ng-container *ngIf="options.groupBySection && hasSections(); else flatList">
          <div class="error-section" *ngFor="let section of sections()">
            <h4 class="section-title">{{ section.name }}</h4>
            <ul class="error-list">
              <li
                *ngFor="let error of section.errors; trackBy: trackByError"
                class="error-item"
                [class.error-severity-error]="error.severity === 'error'"
                [class.error-severity-warning]="error.severity === 'warning'"
                [class.error-severity-info]="error.severity === 'info'"
                (click)="focusField(error)"
                [class.clickable]="options.clickToFocus"
              >
                <div class="error-severity" *ngIf="options.showSeverity">
                  {{ getSeverityIcon(error.severity) }}
                </div>
                <div class="error-content">
                  <span class="error-field" *ngIf="error.field">{{ error.field }}:</span>
                  <span class="error-message">{{ error.message }}</span>
                </div>
              </li>
            </ul>
          </div>
        </ng-container>

        <!-- Lista simples -->
        <ng-template #flatList>
          <ul class="error-list">
            <li
              *ngFor="let error of visibleErrors(); trackBy: trackByError"
              class="error-item"
              [class.error-severity-error]="error.severity === 'error'"
              [class.error-severity-warning]="error.severity === 'warning'"
              [class.error-severity-info]="error.severity === 'info'"
              (click)="focusField(error)"
              [class.clickable]="options.clickToFocus"
            >
              <div class="error-severity" *ngIf="options.showSeverity">
                {{ getSeverityIcon(error.severity) }}
              </div>
              <div class="error-content">
                <span class="error-field" *ngIf="error.field">{{ error.field }}:</span>
                <span class="error-message">{{ error.message }}</span>
              </div>
            </li>
          </ul>

          <!-- Mostrar mais -->
          <div class="show-more" *ngIf="hasMoreErrors()">
            <button type="button" class="show-more-button" (click)="showAllErrors()">
              Mostrar mais {{ getHiddenErrorsCount() }} erros
            </button>
          </div>
        </ng-template>
      </div>
    </div>
  `,
  styles: [`
    .errors-summary-container {
      background-color: #fee2e2;
      border: 1px solid #fecaca;
      border-left: 4px solid #ef4444;
      border-radius: 6px;
      margin-bottom: 20px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    .summary-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      cursor: pointer;
    }

    .summary-header-content {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .summary-icon {
      font-size: 18px;
    }

    .summary-title {
      margin: 0;
      font-size: 16px;
      font-weight: 500;
      color: #b91c1c;
    }

    .error-count {
      font-weight: normal;
      margin-left: 5px;
      color: #ef4444;
    }

    .collapse-button {
      background: transparent;
      border: none;
      color: #b91c1c;
      font-size: 16px;
      cursor: pointer;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }

    .summary-content {
      padding: 0 16px 16px;
    }

    .error-section {
      margin-bottom: 16px;
    }

    .section-title {
      font-size: 14px;
      font-weight: 500;
      color: #b91c1c;
      margin: 12px 0 8px;
      padding-bottom: 4px;
      border-bottom: 1px solid #fecaca;
    }

    .error-list {
      list-style-type: none;
      padding: 0;
      margin: 0;
    }

    .error-item {
      display: flex;
      padding: 6px 0;
      align-items: flex-start;
      gap: 8px;
    }

    .error-item.clickable {
      cursor: pointer;
    }

    .error-item.clickable:hover {
      background-color: #fecaca;
      border-radius: 4px;
    }

    .error-severity {
      padding-top: 2px;
    }

    .error-content {
      flex: 1;
    }

    .error-field {
      font-weight: 500;
      margin-right: 4px;
    }

    .error-message {
      color: #b91c1c;
    }

    .error-severity-error {
      color: #b91c1c;
    }

    .error-severity-warning {
      color: #b45309;
    }

    .error-severity-info {
      color: #1e40af;
    }

    .show-more {
      text-align: center;
      padding-top: 8px;
    }

    .show-more-button {
      background: transparent;
      border: none;
      color: #b91c1c;
      font-size: 14px;
      text-decoration: underline;
      cursor: pointer;
      padding: 4px 8px;
    }

    .show-more-button:hover {
      background-color: #fecaca;
      border-radius: 4px;
    }
  `],
  animations: [
    trigger('slideInOut', [
      state('expanded', style({ height: '*' })),
      state('collapsed', style({ height: 'auto' })),
      transition('expanded <=> collapsed', [
        animate('200ms ease-in-out')
      ])
    ]),
    trigger('contentAnimation', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(-10px)' }),
        animate('200ms ease-out', style({ opacity: 1, transform: 'translateY(0)' }))
      ]),
      transition(':leave', [
        animate('150ms ease-in', style({ opacity: 0, transform: 'translateY(-10px)' }))
      ])
    ])
  ]
})
export class FormErrorsSummaryComponent implements OnInit, OnDestroy {
  private formUtils = inject(FormUtilsService);

  // Entradas
  @Input() form!: FormGroup;
  @Input() title?: string;
  @Input() options: ErrorSummaryOptions = {
    showIcon: true,
    groupBySection: false,
    maxErrors: 5,
    showSeverity: true,
    collapsible: true,
    autoScroll: true,
    scrollOffset: 50,
    clickToFocus: true
  };
  @Input() sectionMap?: Record<string, string>;

  // Signals
  private readonly errorsState = signal<FormError[]>([]);
  private readonly showAllErrorsState = signal(false);
  private readonly collapsedState = signal(false);

  // Computed
  readonly totalErrors = computed(() => this.errorsState().length);
  readonly visibleErrors = computed(() => {
    if (this.showAllErrorsState() || !this.options.maxErrors) {
      return this.errorsState();
    }
    return this.errorsState().slice(0, this.options.maxErrors);
  });
  readonly hasMoreErrors = computed(() => {
    return !this.showAllErrorsState() && this.errorsState().length > (this.options.maxErrors || 5);
  });
  readonly sections = computed(() => {
    const result: { name: string; errors: FormError[] }[] = [];
    const sectionErrors: Record<string, FormError[]> = {};

    // Agrupar erros por seção
    this.errorsState().forEach(error => {
      const section = error.section || 'Outros';
      if (!sectionErrors[section]) {
        sectionErrors[section] = [];
      }
      sectionErrors[section].push(error);
    });

    // Converter para array
    Object.entries(sectionErrors).forEach(([section, errors]) => {
      result.push({ name: section, errors });
    });

    return result;
  });
  readonly isCollapsed = this.collapsedState.asReadonly();

  // Estado privado
  private fieldsMap: Record<string, HTMLElement> = {};

  ngOnInit() {
    if (this.form) {
      // Observar alterações no formulário
      this.form.statusChanges
        .pipe(takeUntilDestroyed())
        .subscribe(() => {
          this.updateErrors();
        });

      // Análise inicial
      this.updateErrors();
    }
  }

  ngOnDestroy() {
    // Limpar referências
    this.fieldsMap = {};
  }

  /**
   * Atualiza a lista de erros baseada no formulário
   */
  updateErrors(): void {
    if (!this.form) return;

    const errors: FormError[] = [];

    // Extrai erros recursivamente
    this.extractFormErrors(this.form, '', errors);

    // Atualiza o estado
    this.errorsState.set(errors);

    // Auto-scroll se necessário
    if (this.options.autoScroll && errors.length > 0 && !this.collapsedState()) {
      setTimeout(() => {
        const container = document.querySelector('.errors-summary-container');
        if (container) {
          container.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
            inline: 'nearest'
          });

          // Aplicar offset
          if (this.options.scrollOffset) {
            window.scrollBy(0, -this.options.scrollOffset);
          }
        }
      }, 100);
    }
  }

  /**
   * Extrai erros recursivamente do formulário
   */
  private extractFormErrors(
    formGroup: FormGroup | FormArray,
    parentPath: string,
    errors: FormError[]
  ): void {
    if (formGroup instanceof FormGroup) {
      // Extrai erros do próprio formGroup (se houver)
      if (formGroup.errors) {
        Object.keys(formGroup.errors).forEach(errorKey => {
          const section = this.getSection(parentPath);
          errors.push({
            message: this.formUtils.getErrorMessage(errorKey, formGroup.errors?.[errorKey]),
            path: parentPath || '',
            severity: 'error',
            section
          });
        });
      }

      // Processa cada controle
      Object.keys(formGroup.controls).forEach(key => {
        const control = formGroup.get(key);
        const path = parentPath ? `${parentPath}.${key}` : key;

        if (control instanceof FormGroup || control instanceof FormArray) {
          // Recursão para grupos aninhados
          this.extractFormErrors(control, path, errors);
        } else if (control instanceof FormControl) {
          this.extractControlErrors(control, key, path, errors);
        }
      });
    } else if (formGroup instanceof FormArray) {
      // Processa cada item do array
      formGroup.controls.forEach((control, index) => {
        const path = `${parentPath}[${index}]`;

        if (control instanceof FormGroup || control instanceof FormArray) {
          this.extractFormErrors(control, path, errors);
        } else if (control instanceof FormControl) {
          this.extractControlErrors(control, `Item ${index + 1}`, path, errors);
        }
      });
    }
  }

  /**
   * Extrai erros de um controle individual
   */
  private extractControlErrors(
    control: FormControl,
    fieldName: string,
    path: string,
    errors: FormError[]
  ): void {
    if (control.invalid && (control.touched || control.dirty)) {
      if (control.errors) {
        // Processa cada erro do controle
        Object.keys(control.errors).forEach(errorKey => {
          const section = this.getSection(path);
          const displayName = this.formUtils.getFieldDisplayName(fieldName);

          errors.push({
            message: this.formUtils.getErrorMessage(errorKey, control.errors?.[errorKey], displayName),
            field: displayName,
            path,
            severity: 'error',
            section
          });
        });
      }
    }
  }

  /**
   * Obtém a seção baseada no caminho do campo
   */
  private getSection(path: string): string {
    if (!path || !this.sectionMap) return 'Formulário';

    // Verifica se o path começa com alguma das chaves do mapa
    for (const [prefix, sectionName] of Object.entries(this.sectionMap)) {
      if (path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`)) {
        return sectionName;
      }
    }

    // Default
    return 'Outros';
  }

  /**
   * Foca no campo com erro
   */
  focusField(error: FormError): void {
    if (!this.options.clickToFocus || !error.path) return;

    // Tenta encontrar o elemento no DOM
    const path = error.path;

    // Tenta encontrar o campo diretamente
    let field = this.fieldsMap[path];

    // Se não encontrou, tenta buscar no DOM
    if (!field) {
      // Para campos padrão
      let selector = `[formControlName="${path}"]`;

      // Para campos em arrays ou aninhados
      if (path.includes('.') || path.includes('[')) {
        // Extrai último segmento do path (para FormArrays e campos aninhados)
        const segments = path.split('.');
        const lastSegment = segments[segments.length - 1];

        if (lastSegment.includes('[')) {
          // Campo em array: extract o nome real e o índice
          const match = lastSegment.match(/([^\[]+)\[(\d+)\]/);
          if (match) {
            const arrayName = match[1];
            const index = match[2];
            selector = `[formArrayName="${arrayName}"] [formGroupName="${index}"]`;
          }
        } else {
          // Campo aninhado normal
          selector = `[formControlName="${lastSegment}"]`;
        }
      }

      // Tenta encontrar o campo
      field = document.querySelector(selector) as HTMLElement;

      // Armazena para reutilização
      if (field) {
        this.fieldsMap[path] = field;
      }
    }

    // Foca e destaca o campo
    if (field) {
      field.scrollIntoView({ behavior: 'smooth', block: 'center' });
      field.focus();

      // Adiciona highlight temporário
      field.classList.add('highlight-error');
      setTimeout(() => {
        field?.classList.remove('highlight-error');
      }, 2000);
    }
  }

  /**
   * Exibe todos os erros
   */
  showAllErrors(): void {
    this.showAllErrorsState.set(true);
  }

  /**
   * Alterna o estado de colapso
   */
  toggleCollapse(): void {
    if (!this.options.collapsible) return;
    this.collapsedState.update(state => !state);
  }

  /**
   * Verifica se deve mostrar o resumo
   */
  shouldShowSummary(): boolean {
    return this.totalErrors() > 0;
  }

  /**
   * Verifica se existem seções
   */
  hasSections(): boolean {
    return this.sections().length > 1;
  }

  /**
   * Retorna o número de erros escondidos
   */
  getHiddenErrorsCount(): number {
    return Math.max(0, this.errorsState().length - (this.options.maxErrors || 5));
  }

  /**
   * Retorna o ícone baseado na severidade
   */
  getSeverityIcon(severity: string): string {
    switch (severity) {
      case 'error': return '⚠️';
      case 'warning': return '⚠️';
      case 'info': return 'ℹ️';
      default: return '⚠️';
    }
  }

  /**
   * Função trackBy para otimizar ngFor
   */
  trackByError(index: number, error: FormError): string {
    return `${error.path || ''}:${error.message}`;
  }
}
