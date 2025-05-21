// form-field.directive.ts
import { Directive, Input, ElementRef, HostListener, Optional, Host, SkipSelf, OnInit, AfterViewInit, ContentChild } from '@angular/core';
import { NgControl, ControlContainer, AbstractControl } from '@angular/forms';

/**
 * Diretiva para campos de formulário que automatiza vários comportamentos:
 * - Adiciona classes de estado (invalid, valid, touched, dirty)
 * - Gerencia o fluxo de validação e feedback visual
 * - Simplifica a conexão entre controles e validação
 */
@Directive({
  selector: '[formField]',
  standalone: true,
  host: {
    '[class.form-field]': 'true',
    '[class.invalid]': 'isInvalid',
    '[class.valid]': 'isValid',
    '[class.touched]': 'isTouched',
    '[class.dirty]': 'isDirty',
    '[class.focused]': 'isFocused',
    '[class.required]': 'isRequired',
    '[class.disabled]': 'isDisabled',
    '[class.with-value]': 'hasValue',
  },
})
export class FormFieldDirective implements OnInit, AfterViewInit {
  @Input() fieldGroup?: string;
  @Input() fieldName?: string;
  @Input() showValidationIcon = true;
  @Input() markTouchedOnFocus = true;

  // Estado do campo
  isInvalid = false;
  isValid = false;
  isTouched = false;
  isDirty = false;
  isFocused = false;
  isRequired = false;
  isDisabled = false;
  hasValue = false;

  // Referência ao controle do form
  private control: AbstractControl | null = null;

  constructor(
    private el: ElementRef<HTMLElement>,
    @Optional() private ngControl: NgControl,
    @Optional() @Host() @SkipSelf() private controlContainer: ControlContainer,
  ) {}

  ngOnInit(): void {
    // Encontrar o controle do formulário
    this.resolveFormControl();

    // Configurar validação inicial
    if (this.control) {
      this.updateValidationState();
    }
  }

  ngAfterViewInit(): void {
    // Segunda tentativa de resolver o controle
    if (!this.control) {
      setTimeout(() => {
        this.resolveFormControl();
        if (this.control) {
          this.updateValidationState();
        }
      }, 0);
    }
  }

  /**
   * Resolve o controle do formulário baseado em várias estratégias
   */
  private resolveFormControl(): void {
    // Caso 1: Controle diretamente injetado pelo Angular
    if (this.ngControl && this.ngControl.control) {
      this.control = this.ngControl.control;
      this.setupControlListeners();
      return;
    }

    // Caso 2: Campo dentro de um formGroup e nome especificado via input
    if (this.controlContainer && this.fieldName) {
      const path = this.fieldGroup ? `${this.fieldGroup}.${this.fieldName}` : this.fieldName;

      this.control = this.controlContainer.control?.get(path) || null;

      if (this.control) {
        this.setupControlListeners();
        return;
      }
    }

    // Caso 3: Tentar encontrar o controle pelo nome do atributo formControlName
    if (this.controlContainer && !this.control) {
      const element = this.el.nativeElement;
      const controls = element.querySelectorAll('[formControlName]');

      if (controls.length === 1) {
        const controlName = controls[0].getAttribute('formControlName');
        if (controlName) {
          const path = this.fieldGroup ? `${this.fieldGroup}.${controlName}` : controlName;

          this.control = this.controlContainer.control?.get(path) || null;

          if (this.control) {
            this.setupControlListeners();
            return;
          }
        }
      }
    }

    console.warn('FormFieldDirective: Could not resolve form control for', this.el.nativeElement);
  }

  /**
   * Configura os listeners para mudanças de estado no controle
   */
  private setupControlListeners(): void {
    if (!this.control) return;

    // Verificar se o campo é obrigatório
    this.isRequired = this.checkIfRequired();

    // Estado inicial
    this.updateValidationState();

    // Monitorar mudanças no controle
    this.control.statusChanges.subscribe(() => {
      this.updateValidationState();
    });

    this.control.valueChanges.subscribe(() => {
      this.hasValue = this.control?.value !== null && this.control?.value !== undefined && this.control?.value !== '';

      this.isDirty = this.control?.dirty ?? false;
    });
  }

  /**
   * Atualiza o estado de validação com base no controle
   */
  private updateValidationState(): void {
    if (!this.control) return;

    this.isValid = this.control.valid && (this.control.touched || this.control.dirty);
    this.isInvalid = this.control.invalid && (this.control.touched || this.control.dirty);
    this.isTouched = this.control.touched;
    this.isDirty = this.control.dirty;
    this.isDisabled = this.control.disabled;
    this.hasValue = this.control.value !== null && this.control.value !== undefined && this.control.value !== '';
  }

  /**
   * Verifica se o campo é obrigatório através das validações
   */
  private checkIfRequired(): boolean {
    if (!this.control) return false;

    // Verificar por Validators.required
    if (this.control.validator) {
      const validatorFn = this.control.validator;
      const validatorErrors = validatorFn(this.control);
      if (validatorErrors && validatorErrors['required']) {
        return true;
      }
    }

    // Verificar por validators em array
    // Isso é importante para quando o formulário foi construído com formBuilder.group
    const controlAsAny = this.control as any;
    if (controlAsAny._rawValidators) {
      return controlAsAny._rawValidators.some((validator: any) => {
        if (validator.name === 'required') return true;

        // Handle RequiredValidator (Validators.required) from Angular
        if (typeof validator === 'function') {
          const validatorErrors = validator({ value: null } as AbstractControl);
          return validatorErrors && validatorErrors['required'];
        }

        return false;
      });
    }

    return false;
  }

  /**
   * Eventos de foco para gerenciar estado
   */
  @HostListener('focusin')
  onFocusIn(): void {
    this.isFocused = true;

    if (this.markTouchedOnFocus && this.control && !this.control.touched) {
      this.control.markAsTouched();
      this.updateValidationState();
    }
  }

  @HostListener('focusout')
  onFocusOut(): void {
    this.isFocused = false;

    if (this.control && !this.control.touched) {
      this.control.markAsTouched();
      this.updateValidationState();
    }
  }
}

/**
 * Componente de campo de formulário com label e validação automática
 */
@Component({
  selector: 'o-form-field',
  standalone: true,
  imports: [CommonModule, FormFieldDirective, ValidationErrorsComponent],
  template: `
    <div class="form-field-container" [class.has-error]="isInvalid" [class.required]="isRequired">
      <label *ngIf="label" [for]="id" class="form-field-label">
        {{ label }}
        <span class="required-indicator" *ngIf="isRequired">*</span>
      </label>

      <div class="form-field-input" oFormField [fieldName]="controlName">
        <ng-content></ng-content>

        <div class="form-field-icons" *ngIf="showValidationIcon">
          <div class="validation-icon validation-icon-valid" *ngIf="isValid">✓</div>
          <div class="validation-icon validation-icon-invalid" *ngIf="isInvalid">✕</div>
        </div>
      </div>

      <div class="form-field-error">
        <o-validation-errors
          [control]="control"
          [controlName]="controlName"
          [fieldName]="label || fieldName"
          [displayType]="errorDisplayType"
          [styleType]="errorStyleType"
        ></o-validation-errors>
      </div>

      <div class="form-field-hint" *ngIf="hint">
        {{ hint }}
      </div>
    </div>
  `,
  styles: [
    `
      .form-field-container {
        margin-bottom: 20px;
      }

      .form-field-label {
        display: block;
        margin-bottom: 8px;
        font-weight: 500;
        color: #4b5563;
      }

      .required-indicator {
        color: #ef4444;
        margin-left: 2px;
      }

      .form-field-input {
        position: relative;
      }

      .form-field-icons {
        position: absolute;
        right: 10px;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        align-items: center;
      }

      .validation-icon {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        color: white;
      }

      .validation-icon-valid {
        background-color: #10b981;
      }

      .validation-icon-invalid {
        background-color: #ef4444;
      }

      .form-field-hint {
        margin-top: 6px;
        font-size: 12px;
        color: #6b7280;
      }

      .has-error .form-field-label {
        color: #ef4444;
      }

      /* Estilos para campos internos */
      ::ng-deep .form-field-input input,
      ::ng-deep .form-field-input select,
      ::ng-deep .form-field-input textarea {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 16px;
        transition:
          border-color 0.15s ease-in-out,
          box-shadow 0.15s ease-in-out;
      }

      ::ng-deep .form-field-input input:focus,
      ::ng-deep .form-field-input select:focus,
      ::ng-deep .form-field-input textarea:focus {
        border-color: #4f46e5;
        outline: none;
        box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
      }

      ::ng-deep .has-error .form-field-input input,
      ::ng-deep .has-error .form-field-input select,
      ::ng-deep .has-error .form-field-input textarea {
        border-color: #ef4444;
      }

      ::ng-deep .has-error .form-field-input input:focus,
      ::ng-deep .has-error .form-field-input select:focus,
      ::ng-deep .has-error .form-field-input textarea:focus {
        box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.2);
      }
    `,
  ],
})
export class FormFieldComponent {
  @Input() label?: string;
  @Input() hint?: string;
  @Input() controlName?: string;
  @Input() fieldName?: string;
  @Input() showValidationIcon = true;
  @Input() id = '';
  @Input() errorDisplayType: ErrorDisplayType = 'inline';
  @Input() errorStyleType: ErrorStyleType = 'default';

  @ContentChild(NgControl) ngControl?: NgControl;

  // Estat para derivar de NGControl ou do controle diretamente
  private _control: AbstractControl | null = null;

  constructor(@Optional() @Host() @SkipSelf() private controlContainer: ControlContainer) {}

  ngAfterContentInit() {
    // Tentar obter controle do ContentChild
    if (this.ngControl && this.ngControl.control) {
      this._control = this.ngControl.control;
    }
    // Controle só disponível após o próximo ciclo
    setTimeout(() => {
      if (!this._control && this.controlContainer && this.controlName) {
        this._control = this.controlContainer.control?.get(this.controlName) || null;
      }
    });
  }

  get control(): AbstractControl | null {
    return this._control;
  }

  get isValid(): boolean {
    return this._control ? this._control.valid && (this._control.touched || this._control.dirty) : false;
  }

  get isInvalid(): boolean {
    return this._control ? this._control.invalid && (this._control.touched || this._control.dirty) : false;
  }

  get isRequired(): boolean {
    if (!this._control) return false;

    // Verificar validadores
    if (this._control.validator) {
      const validator = this._control.validator;
      const errors = validator(this._control);
      return errors && 'required' in errors;
    }

    return false;
  }
}

/**
 * Exemplo de uso:
 *
 * 1. Com a diretiva:
 * <div oFormField fieldName="email">
 *   <input type="email" formControlName="email">
 * </div>
 *
 * 2. Com o componente:
 * <o-form-field label="Email" controlName="email">
 *   <input type="email" formControlName="email">
 * </o-form-field>
 */
