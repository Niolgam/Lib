// enhanced-validation-errors.component.ts
import { Component, input, computed, signal, effect, inject } from '@angular/core';
import { AbstractControl, FormGroup } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { FormUtilsService } from '@vai/services';
import { trigger, transition, style, animate, state, query, stagger } from '@angular/animations';

/**
 * Tipo de apresentação dos erros
 */
export type ErrorDisplayType = 'inline' | 'tooltip' | 'floating' | 'summary';

/**
 * Tipos de estilo para o componente de erros
 */
export type ErrorStyleType = 'default' | 'compact' | 'card' | 'minimal';

/**
 * Interface para configuração de ícones
 */
export interface ErrorIconConfig {
  error?: string;
  warning?: string;
  info?: string;
}

/**
 * Componente aprimorado para exibição de erros de validação
 * com suporte para diferentes estilos e animações
 */
@Component({
  selector: 'o-validation-errors',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- Estilo Inline (padrão) -->
    @if (shouldShowErrors() && displayType() === 'inline') {
      <div
        class="error-container"
        [class.error-container-compact]="styleType() === 'compact'"
        [class.error-container-card]="styleType() === 'card'"
        [class.error-container-minimal]="styleType() === 'minimal'"
        [@errorAnimation]="errorMessages().length"
      >
        @for (error of errorMessages(); track error) {
          <div class="error-message" [@messageAnimation]>
            @if (showIcons()) {
              <span class="error-icon">{{ getIconForError(error) }}</span>
            }
            <span class="error-text">{{ error }}</span>
          </div>
        }
      </div>
    }

    <!-- Estilo Tooltip -->
    @if (shouldShowErrors() && displayType() === 'tooltip') {
      <div class="error-tooltip" [class.error-tooltip-compact]="styleType() === 'compact'" [@tooltipAnimation]>
        @if (showIcons()) {
          <span class="error-icon">{{ getIconForError(errorMessages()[0]) }}</span>
        }
        <span class="error-text">{{ errorMessages()[0] }}</span>
        @if (errorMessages().length > 1) {
          <span class="error-count">+{{ errorMessages().length - 1 }}</span>
        }
      </div>
    }

    <!-- Estilo Floating -->
    @if (shouldShowErrors() && displayType() === 'floating') {
      <div class="error-floating" [class.error-floating-compact]="styleType() === 'compact'" [@floatingAnimation]>
        @for (error of errorMessages(); track error) {
          <div class="error-message" [@messageAnimation]>
            @if (showIcons()) {
              <span class="error-icon">{{ getIconForError(error) }}</span>
            }
            <span class="error-text">{{ error }}</span>
          </div>
        }
      </div>
    }

    <!-- Estilo Summary -->
    @if (shouldShowErrors() && displayType() === 'summary') {
      <div
        class="error-summary"
        [class.error-summary-compact]="styleType() === 'compact'"
        [class.error-summary-card]="styleType() === 'card'"
        [@summaryAnimation]
      >
        <div class="summary-header" *ngIf="title()">{{ title() }}</div>
        <ul class="summary-list">
          @for (error of errorMessages(); track error) {
            <li class="summary-item" [@messageAnimation]>
              @if (showIcons()) {
                <span class="error-icon">{{ getIconForError(error) }}</span>
              }
              <span class="error-text">{{ error }}</span>
            </li>
          }
        </ul>
      </div>
    }
  `,
  styles: [
    `
      /* Estilos base */
      .error-container {
        margin-top: 0.25rem;
        font-size: 0.875rem;
        color: #ef4444;
        overflow: hidden;
      }

      .error-message {
        display: flex;
        align-items: flex-start;
        margin-bottom: 0.25rem;
      }

      .error-icon {
        margin-right: 0.25rem;
        font-size: 0.75rem;
      }

      .error-text {
        flex: 1;
      }

      /* Estilos para Tooltip */
      .error-tooltip {
        position: absolute;
        z-index: 10;
        background-color: #fee2e2;
        border: 1px solid #ef4444;
        padding: 0.5rem;
        border-radius: 0.25rem;
        font-size: 0.75rem;
        max-width: 250px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        display: flex;
        align-items: center;
      }

      .error-count {
        margin-left: 0.5rem;
        background-color: #ef4444;
        color: white;
        border-radius: 9999px;
        padding: 0.125rem 0.375rem;
        font-size: 0.625rem;
      }

      /* Estilos para Floating */
      .error-floating {
        position: absolute;
        z-index: 10;
        background-color: #fee2e2;
        border: 1px solid #ef4444;
        padding: 0.75rem;
        border-radius: 0.25rem;
        font-size: 0.75rem;
        max-width: 250px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      }

      /* Estilos para Summary */
      .error-summary {
        margin-top: 1rem;
        border: 1px solid #ef4444;
        border-radius: 0.25rem;
        overflow: hidden;
      }

      .summary-header {
        background-color: #ef4444;
        color: white;
        padding: 0.5rem 1rem;
        font-weight: 500;
      }

      .summary-list {
        list-style-type: none;
        margin: 0;
        padding: 0.5rem 1rem;
      }

      .summary-item {
        display: flex;
        align-items: flex-start;
        padding: 0.25rem 0;
      }

      /* Variações de estilo */
      .error-container-compact {
        font-size: 0.75rem;
      }

      .error-container-card {
        background-color: #fee2e2;
        border: 1px solid #ef4444;
        border-radius: 0.25rem;
        padding: 0.5rem;
      }

      .error-container-minimal {
        font-size: 0.75rem;
        opacity: 0.8;
      }

      .error-tooltip-compact {
        padding: 0.25rem 0.5rem;
        font-size: 0.7rem;
      }

      .error-floating-compact {
        padding: 0.5rem;
        font-size: 0.7rem;
      }

      .error-summary-compact {
        font-size: 0.75rem;
      }

      .error-summary-card {
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      }
    `,
  ],
  animations: [
    trigger('errorAnimation', [
      transition(':enter', [style({ height: 0, opacity: 0 }), animate('200ms ease-out', style({ height: '*', opacity: 1 }))]),
      transition(':leave', [animate('200ms ease-in', style({ height: 0, opacity: 0 }))]),
    ]),
    trigger('messageAnimation', [
      transition(':enter', [
        style({ transform: 'translateX(-10px)', opacity: 0 }),
        animate('150ms 50ms ease-out', style({ transform: 'translateX(0)', opacity: 1 })),
      ]),
      transition(':leave', [animate('100ms ease-in', style({ transform: 'translateX(-10px)', opacity: 0 }))]),
    ]),
    trigger('tooltipAnimation', [
      transition(':enter', [
        style({ transform: 'translateY(10px)', opacity: 0 }),
        animate('200ms ease-out', style({ transform: 'translateY(0)', opacity: 1 })),
      ]),
      transition(':leave', [animate('150ms ease-in', style({ transform: 'translateY(10px)', opacity: 0 }))]),
    ]),
    trigger('floatingAnimation', [
      transition(':enter', [
        style({ transform: 'translateY(-10px) scale(0.95)', opacity: 0 }),
        animate('200ms ease-out', style({ transform: 'translateY(0) scale(1)', opacity: 1 })),
      ]),
      transition(':leave', [animate('150ms ease-in', style({ transform: 'translateY(-10px) scale(0.95)', opacity: 0 }))]),
    ]),
    trigger('summaryAnimation', [
      transition(':enter', [
        style({ transform: 'translateY(20px)', opacity: 0 }),
        animate('300ms ease-out', style({ transform: 'translateY(0)', opacity: 1 })),
        query(
          '.summary-item',
          [
            style({ opacity: 0, transform: 'translateX(-20px)' }),
            stagger(50, [animate('200ms ease-out', style({ opacity: 1, transform: 'translateX(0)' }))]),
          ],
          { optional: true },
        ),
      ]),
      transition(':leave', [animate('200ms ease-in', style({ transform: 'translateY(20px)', opacity: 0 }))]),
    ]),
  ],
})
export class FormValidationErrorsComponent {
  private formUtils = inject(FormUtilsService);

  // Inputs
  readonly controlName = input<string>('');
  readonly fieldName = input<string>('');
  readonly control = input<AbstractControl | null>(null);
  readonly form = input<FormGroup | undefined>(undefined);
  readonly customErrors = input<Record<string, string>>({});
  readonly showFirst = input<boolean>(false);
  readonly displayType = input<ErrorDisplayType>('inline');
  readonly styleType = input<ErrorStyleType>('default');
  readonly showIcons = input<boolean>(true);
  readonly title = input<string | null>(null);

  // Configuração de ícones
  private readonly defaultIconConfig: ErrorIconConfig = {
    error: '⚠️',
    warning: '⚠️',
    info: 'ℹ️',
  };

  private readonly iconConfig = signal<ErrorIconConfig>(this.defaultIconConfig);

  // Computed properties
  readonly displayName = computed(() => {
    const fieldName = this.fieldName();
    if (fieldName) return fieldName;
    const controlName = this.controlName();
    if (controlName) return this.formUtils.getFieldDisplayName(controlName);
    return 'This field';
  });

  readonly shouldShowErrors = computed(() => {
    const control = this.control();
    return !!control && control.invalid && (control.touched || control.dirty);
  });

  readonly errorMessages = computed(() => {
    const control = this.control();
    const customErrors = this.customErrors();
    const showOnlyFirst = this.showFirst();
    const messages: string[] = [];

    if (!control || !control.errors) {
      // Verificar erros customizados
      const controlName = this.controlName();
      if (controlName && customErrors[controlName]) {
        messages.push(customErrors[controlName]);
      }
      return messages;
    }

    // Processar erros do control
    Object.entries(control.errors).forEach(([errorType, errorValue]) => {
      messages.push(this.formUtils.getErrorMessage(errorType, errorValue, this.displayName()));

      // Se showFirst está ativo, parar após o primeiro erro
      if (showOnlyFirst) {
        return;
      }
    });

    // Adicionar erros customizados
    const controlName = this.controlName();
    if (controlName && customErrors[controlName]) {
      messages.push(customErrors[controlName]);
    }

    return showOnlyFirst ? messages.slice(0, 1) : messages;
  });

  /**
   * Configura ícones personalizados
   */
  setIconConfig(config: ErrorIconConfig): void {
    this.iconConfig.update((current) => ({
      ...current,
      ...config,
    }));
  }

  /**
   * Obtém o ícone apropriado para um erro
   */
  getIconForError(errorMessage: string): string {
    const config = this.iconConfig();

    // Lógica simples para determinar o tipo de erro
    if (errorMessage.toLowerCase().includes('required')) {
      return config.error || '⚠️';
    } else if (errorMessage.toLowerCase().includes('valid')) {
      return config.warning || '⚠️';
    }

    return config.info || 'ℹ️';
  }
}
