import { Directive, OnDestroy, inject, signal, computed, OnInit, DestroyRef, effect } from '@angular/core';
import { FormGroup, FormArray, AbstractControl, FormBuilder, FormControl, ValidatorFn, AsyncValidatorFn, ValidationErrors } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, Subject, Observable } from 'rxjs';
import { ErrorHandlingService, FormUtilsService, LoggingService, LocalStorageService, FormPerformanceService } from '@vai/services';
import { HttpErrorResponse } from '@angular/common/http';

export interface FormHistoryEntry<T extends Record<string, unknown>> {
  value: T;
  timestamp: string;
  label?: string;
}

export interface FormState<T extends Record<string, unknown>> {
  currentStep: number;
  values: T;
  isDirty: boolean;
  isSubmitted: boolean;
  history: FormHistoryEntry<T>[];
  historyPosition: number;
  formId: string;
  lastUpdate: number;
  metadata?: Record<string, unknown>;
}

export interface WizardStepConfig {
  key: string;
  label: string;
  fields: string[];
  optional?: boolean;
  validators?: ((control: AbstractControl) => ValidationErrors | null)[];
}

export interface ControlConfig {
  value: unknown;
  validators?: ValidatorFn | ValidatorFn[] | null;
  asyncValidators?: AsyncValidatorFn | AsyncValidatorFn[] | null;
  controls?: Record<string, ControlConfig> | ControlConfig[];
  options?: {
    updateOn?: 'change' | 'blur' | 'submit';
  };
}

export interface BaseFormOptions {
  formId: string;
  enablePersistence?: boolean;
  enableHistory?: boolean;
  maxHistory?: number;
  debounceTime?: number; // Debounce para valueChanges e autoCapture
  includeDisabled?: boolean; // Se getFormValue() deve incluir campos desabilitados
  autoCapture?: boolean; // Se o histórico deve capturar automaticamente em valueChanges
  autosaveEnabled?: boolean;
  saveDebounceTimeMs?: number; // Debounce específico para autosave
  storageKeyPrefix?: string;
  metadata?: Record<string, unknown>;
}

@Directive()
export abstract class BaseFormComponent<SubmitPayload extends Record<string, unknown> = Record<string, unknown>> implements OnInit, OnDestroy {
  protected formUtils = inject(FormUtilsService);
  protected errorHandler = inject(ErrorHandlingService);
  protected logger = inject(LoggingService);
  protected localStorageService = inject(LocalStorageService);
  protected formBuilder = inject(FormBuilder);
  protected destroyRef = inject(DestroyRef);
  protected formPerformanceService = inject(FormPerformanceService);

  abstract form: FormGroup;

  // Estado local do formulário gerenciado pela BaseFormComponent
  protected readonly submitting = signal(false);
  protected readonly submitted = signal(false); // Indica se o formulário já foi submetido com sucesso uma vez
  protected readonly validationErrors = signal<Record<string, string>>({});
  protected readonly generalError = signal<string | null>(null);
  protected readonly successMessage = signal<string | null>(null);

  protected readonly currentStep = signal(0);
  protected readonly wizardConfig = signal<WizardStepConfig[]>([]);
  private controlGroupsForWizard: Record<string, string[]> = {};

  protected readonly formHistory = signal<FormHistoryEntry<SubmitPayload>[]>([]);
  protected readonly historyPosition = signal(-1);

  protected options: BaseFormOptions;

  protected readonly dynamicFieldsConfig = signal<Record<string, ControlConfig>>({});
  protected readonly valueChanges = new Subject<SubmitPayload>();

  readonly isSubmitting = this.submitting.asReadonly(); // True durante a chamada assíncrona
  readonly isSubmitted = this.submitted.asReadonly(); // True após um submit bem-sucedido
  readonly hasError = computed(() => this.generalError() !== null || Object.keys(this.validationErrors()).length > 0);
  readonly isValid = computed(() => this.form?.valid || false);
  readonly isDirty = computed(() => this.form?.dirty || false);
  readonly canSubmit = computed(() => this.isValid() && !this.isSubmitting());

  readonly isFirstStep = computed(() => this.currentStep() === 0);
  readonly isLastStep = computed(() => {
    const config = this.wizardConfig();
    if (config.length === 0) return true;
    return this.currentStep() === config.length - 1;
  });
  readonly totalSteps = computed(() => this.wizardConfig().length);
  readonly currentStepConfig = computed<WizardStepConfig | null>(() => {
    const config = this.wizardConfig();
    const index = this.currentStep();
    return index >= 0 && index < config.length ? config[index] : null;
  });

  readonly currentStepValid = computed(() => {
    const stepConfig = this.currentStepConfig();
    if (!stepConfig || !this.form) return true;
    return stepConfig.fields.every((fieldPath) => {
      const control = this.form.get(fieldPath);
      return control ? control.valid || control.disabled : true;
    });
  });

  readonly canUndo = computed(() => (this.options.enableHistory ?? true) && this.historyPosition() > 0);
  readonly canRedo = computed(() => (this.options.enableHistory ?? true) && this.historyPosition() < this.formHistory().length - 1);

  constructor(defaultOptions?: Partial<BaseFormOptions>) {
    this.options = {
      formId: '',
      enablePersistence: true,
      enableHistory: true,
      maxHistory: 20,
      debounceTime: 300,
      includeDisabled: false,
      autoCapture: true,
      autosaveEnabled: false,
      saveDebounceTimeMs: 2000,
      storageKeyPrefix: 'form_state_',
      metadata: {},
      ...defaultOptions,
    };

    effect(() => {
      const currentForm = this.form;
      const currentWizardConfig = this.wizardConfig();
      if (currentForm && currentWizardConfig.length > 0) {
        this.initializeWizardOptimizations(currentForm, currentWizardConfig);
      }
    });

    effect(() => {
      const currentForm = this.form;
      const stepConfig = this.currentStepConfig();
      if (currentForm && stepConfig && Object.keys(this.controlGroupsForWizard).length > 0) {
        this.formPerformanceService.activateWizardStep(currentForm, stepConfig.key, this.controlGroupsForWizard);
      }
    });
  }

  protected initializeOptions(options: Partial<BaseFormOptions>): void {
    this.options = { ...this.options, ...options };
    if (!this.options.formId) {
      this.logger.error("BaseFormComponent: 'formId' must be provided in options for persistence and other features to work correctly.");
    }
  }

  ngOnInit(): void {
    if (!this.form) {
      this.logger.error("BaseFormComponent: 'form' abstract property must be initialized by the subclass.");
      return;
    }
    if (!this.options.formId && (this.options.enablePersistence || this.options.autosaveEnabled)) {
      this.logger.warn("BaseFormComponent: 'formId' is not set in options. Persistence and autosave features require a 'formId'.");
    }
    this.setupFormSubscriptions();
    this.checkForSavedDraft();
    if (this.options.enableHistory && this.formHistory().length === 0) {
      this.addHistoryEntry('Initial state');
    }
  }

  private initializeWizardOptimizations(form: FormGroup, wizardConfig: WizardStepConfig[]): void {
    this.controlGroupsForWizard = wizardConfig.reduce(
      (acc, step) => {
        acc[step.key] = step.fields;
        return acc;
      },
      {} as Record<string, string[]>,
    );

    const initialStepKey = wizardConfig.length > 0 ? wizardConfig[this.currentStep()]?.key : undefined;
    if (initialStepKey) {
      this.formPerformanceService.optimizeWizardForm(form, this.controlGroupsForWizard, initialStepKey);
    }
  }

  ngOnDestroy(): void {
    this.valueChanges.complete();
    if (this.options.autosaveEnabled && this.isDirty() && this.options.formId && this.form) {
      this.saveFormState();
    }
  }

  protected setupFormSubscriptions(): void {
    if (!this.form) return;

    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef), debounceTime(this.options.debounceTime)).subscribe((value: SubmitPayload) => {
      if (this.hasError()) {
        this.clearErrors();
      }
      this.valueChanges.next(value);
      if (this.options.autoCapture && this.options.enableHistory) {
        this.addHistoryEntry('Value changed');
      }
    });

    if (this.options.autosaveEnabled && this.options.formId) {
      this.form.valueChanges
        .pipe(
          debounceTime(this.options.saveDebounceTimeMs),
          distinctUntilChanged((prev, curr) => JSON.stringify(prev) === JSON.stringify(curr)),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe(() => {
          if (this.isDirty()) {
            this.saveFormState();
          }
        });
    }
  }

  protected checkForSavedDraft(): boolean {
    const draftKey = this.getStorageKey();
    if (!(this.options.enablePersistence ?? false) || !draftKey || !this.form) return false;

    try {
      const savedState = this.localStorageService.getItem<FormState<SubmitPayload>>(draftKey);
      if (savedState && savedState.formId === this.options.formId) {
        this.form.patchValue(savedState.values, { emitEvent: false });
        this.currentStep.set(savedState.currentStep);

        if (this.options.enableHistory && savedState.history?.length) {
          this.formHistory.set(savedState.history);
          this.historyPosition.set(savedState.historyPosition);
        } else {
          this.formHistory.set([]);
          this.historyPosition.set(-1);
        }
        this.form.markAsPristine({ emitEvent: false });
        this.form.markAsUntouched({ emitEvent: false });
        this.logger.debug(`Form draft loaded from "${draftKey}"`, { timestamp: new Date(savedState.lastUpdate) });
        return true;
      }
    } catch (error: unknown) {
      this.logger.error('Failed to load form draft', { error: error instanceof Error ? error.message : String(error), draftKey });
    }
    return false;
  }

  saveFormState(label?: string): void {
    const draftKey = this.getStorageKey();
    if (!(this.options.enablePersistence ?? false) || !draftKey || !this.form) return;

    try {
      const formValue = this.getFormValue();
      const formState: FormState<SubmitPayload> = {
        currentStep: this.currentStep(),
        values: formValue,
        isDirty: this.isDirty(),
        isSubmitted: this.isSubmitted(),
        history: (this.options.enableHistory ?? true) ? this.formHistory() : [],
        historyPosition: (this.options.enableHistory ?? true) ? this.historyPosition() : -1,
        formId: this.options.formId,
        lastUpdate: Date.now(),
        metadata: this.options.metadata,
      };
      this.localStorageService.setItem(draftKey, formState);
      this.logger.debug(`Form state saved to "${draftKey}"`, { timestamp: new Date(), label });
    } catch (error: unknown) {
      this.logger.error('Failed to save form state', { error: error instanceof Error ? error.message : String(error), draftKey });
    }
  }

  clearSavedState(): void {
    const draftKey = this.getStorageKey();
    if (draftKey && (this.options.enablePersistence ?? false)) {
      this.localStorageService.removeItem(draftKey);
      this.logger.debug(`Form state cleared from "${draftKey}"`);
    }
  }

  addHistoryEntry(label?: string): void {
    if (!(this.options.enableHistory ?? true) || !this.form) return;

    const formValue = this.options.includeDisabled ? (this.form.getRawValue() as SubmitPayload) : (this.form.value as SubmitPayload);
    const entry: FormHistoryEntry<SubmitPayload> = {
      value: formValue,
      timestamp: new Date().toISOString(),
      label,
    };

    this.formHistory.update((currentHistory) => {
      const historyPos = this.historyPosition();
      const newHistoryBase = historyPos < currentHistory.length - 1 ? currentHistory.slice(0, historyPos + 1) : [...currentHistory];

      newHistoryBase.push(entry);

      const maxHist = this.options.maxHistory ?? 20;
      const trimmedHistory = newHistoryBase.length > maxHist ? newHistoryBase.slice(newHistoryBase.length - maxHist) : newHistoryBase;

      this.historyPosition.set(trimmedHistory.length - 1);
      return trimmedHistory;
    });
    if (this.options.enablePersistence) {
      this.saveFormState(label || 'History entry added');
    }
  }

  undo(): boolean {
    if (!this.canUndo() || !this.form) return false;

    const newPos = this.historyPosition() - 1;
    const history = this.formHistory();
    const entry = history[newPos];

    this.form.patchValue(entry.value, { emitEvent: false });
    this.form.markAsDirty({ emitEvent: false });
    this.historyPosition.set(newPos);
    this.logger.debug('Undo performed', { newIndex: newPos, label: entry.label });
    this.valueChanges.next(entry.value);
    if (this.options.enablePersistence) {
      this.saveFormState('Undo performed');
    }
    return true;
  }

  redo(): boolean {
    if (!this.canRedo() || !this.form) return false;

    const newPos = this.historyPosition() + 1;
    const history = this.formHistory();
    const entry = history[newPos];

    this.form.patchValue(entry.value, { emitEvent: false });
    this.form.markAsDirty({ emitEvent: false });
    this.historyPosition.set(newPos);
    this.logger.debug('Redo performed', { newIndex: newPos, label: entry.label });
    this.valueChanges.next(entry.value);
    if (this.options.enablePersistence) {
      this.saveFormState('Redo performed');
    }
    return true;
  }

  nextStep(): boolean {
    if (!this.validateCurrentStep()) {
      return false;
    }
    if (this.options.enableHistory) {
      this.addHistoryEntry(`Completed step ${this.currentStepConfig()?.label || this.currentStep() + 1}`);
    }
    if (!this.isLastStep()) {
      this.currentStep.update((step) => step + 1);
      return true;
    }
    return false;
  }

  previousStep(): boolean {
    if (!this.isFirstStep()) {
      this.currentStep.update((step) => step - 1);
      return true;
    }
    return false;
  }

  validateCurrentStep(): boolean {
    const stepConfig = this.currentStepConfig();
    if (!stepConfig || !this.form) return true;
    if (stepConfig.optional) return true;

    let isStepValid = true;
    stepConfig.fields.forEach((fieldPath) => {
      const control = this.form.get(fieldPath);
      if (control && !control.disabled) {
        control.markAsTouched();
        control.updateValueAndValidity();
        if (control.invalid) {
          isStepValid = false;
        }
      }
    });

    const fieldErrors = this.formUtils.getFieldErrors(this.form, stepConfig.fields);
    this.validationErrors.update((errors) => ({ ...errors, ...fieldErrors }));

    if (stepConfig.validators?.length) {
      for (const validator of stepConfig.validators) {
        if (validator(this.form) !== null) {
          isStepValid = false;
        }
      }
    }
    return isStepValid;
  }

  goToStep(stepIndex: number): boolean {
    const wizardConfigVal = this.wizardConfig();
    if (stepIndex < 0 || stepIndex >= wizardConfigVal.length) return false;

    const currentIdx = this.currentStep();
    if (stepIndex > currentIdx) {
      for (let i = currentIdx; i < stepIndex; i++) {
        this.currentStep.set(i);
        if (!this.validateCurrentStep()) {
          this.currentStep.set(i);
          return false;
        }
      }
    }
    this.currentStep.set(stepIndex);
    return true;
  }

  validateForm(): boolean {
    if (!this.form) return false;
    this.formUtils.markFormGroupTouched(this.form);
    this.form.updateValueAndValidity();
    this.extractFormErrors();
    return this.form.valid;
  }

  extractFormErrors(): void {
    if (!this.form) return;
    const errors = this.formUtils.getFormErrors(this.form);
    this.validationErrors.set(errors);
  }

  getFieldError(fieldName: string): string | null {
    return this.validationErrors()[fieldName] || null;
  }

  hasFieldError(fieldName: string): boolean {
    return !!this.getFieldError(fieldName);
  }

  protected handleSubmissionError(error: Error | HttpErrorResponse | Record<string, unknown>): void {
    this.submitting.set(false);
    if (!this.form) {
      this.generalError.set('Form not available to handle submission error.');
      this.logger.error('Form submission error occurred but form is not initialized.', { error });
      return;
    }
    const errorInfo = this.errorHandler.handleFormError(error, this.form);
    if (errorInfo.validationErrors) {
      this.validationErrors.set(errorInfo.validationErrors);
    }
    this.generalError.set(errorInfo.message);
    this.logger.error('Form submission error', { error: errorInfo });
  }

  clearErrors(): void {
    this.validationErrors.set({});
    this.generalError.set(null);
  }

  resetForm(options?: { clearValues?: boolean; clearErrors?: boolean; resetHistory?: boolean }): void {
    if (!this.form) return;
    const { clearValues = true, clearErrors = true, resetHistory = true } = options || {};

    if (clearValues) {
      this.form.reset();
    }
    if (clearErrors) {
      this.clearErrors();
    }

    this.submitting.set(false);
    this.submitted.set(false);
    this.successMessage.set(null);
    this.currentStep.set(0);

    if (this.options.enableHistory && resetHistory) {
      this.formHistory.set([]);
      this.historyPosition.set(-1);
      this.addHistoryEntry('Form reset');
    }
    if (clearValues) {
      this.form.markAsPristine();
      this.form.markAsUntouched();
    }
  }

  protected setSuccess(message: string): void {
    this.submitting.set(false);
    this.submitted.set(true);
    this.successMessage.set(message);
    this.clearErrors();
    if (this.options.enableHistory) {
      this.addHistoryEntry('Form submitted successfully');
    }
    this.clearSavedState();
  }

  addArrayItem(arrayName: string, initialValue?: unknown, position?: number): void {
    if (!this.form) return;
    const formArray = this.form.get(arrayName) as FormArray | null;
    if (!formArray) {
      this.logger.error(`FormArray "${arrayName}" not found in form`);
      return;
    }
    const newItem = this.createArrayItem(arrayName, initialValue);
    if (position !== undefined && position >= 0 && position <= formArray.length) {
      formArray.insert(position, newItem);
    } else {
      formArray.push(newItem);
    }
    formArray.markAsDirty();
    if (this.options.enableHistory) {
      this.addHistoryEntry(`Added item to ${arrayName}`);
    }
  }

  removeArrayItem(arrayName: string, index: number): void {
    if (!this.form) return;
    const formArray = this.form.get(arrayName) as FormArray | null;
    if (!formArray) {
      this.logger.error(`FormArray "${arrayName}" not found in form`);
      return;
    }
    if (index < 0 || index >= formArray.length) {
      this.logger.error(`Invalid index ${index} for FormArray "${arrayName}"`);
      return;
    }
    formArray.removeAt(index);
    formArray.markAsDirty();
    if (this.options.enableHistory) {
      this.addHistoryEntry(`Removed item from ${arrayName} at index ${index}`);
    }
  }

  moveArrayItem(arrayName: string, fromIndex: number, toIndex: number): void {
    if (!this.form) return;
    const formArray = this.form.get(arrayName) as FormArray | null;
    if (!formArray) {
      this.logger.error(`FormArray "${arrayName}" not found in form`);
      return;
    }
    if (fromIndex < 0 || fromIndex >= formArray.length || toIndex < 0 || toIndex > formArray.length) {
      this.logger.error(`Invalid indices for moving item in "${arrayName}"`);
      return;
    }
    const item = formArray.at(fromIndex);
    formArray.removeAt(fromIndex);
    formArray.insert(toIndex, item);
    formArray.markAsDirty();
    if (this.options.enableHistory) {
      this.addHistoryEntry(`Moved item in ${arrayName} from ${fromIndex} to ${toIndex}`);
    }
  }

  protected abstract createArrayItem(arrayName: string, initialValue?: unknown): AbstractControl;

  addDynamicField(fieldName: string, controlConfig: ControlConfig): void {
    if (!this.form) return;
    if (this.form.contains(fieldName)) {
      this.logger.warn(`Field "${fieldName}" already exists in form`);
      return;
    }
    this.form.addControl(fieldName, this.createControlFromConfig(controlConfig));
    this.dynamicFieldsConfig.update((config) => ({
      ...config,
      [fieldName]: controlConfig,
    }));
    this.form.markAsDirty();
    if (this.options.enableHistory) {
      this.addHistoryEntry(`Added dynamic field "${fieldName}"`);
    }
  }

  removeDynamicField(fieldName: string): void {
    if (!this.form) return;
    if (!this.form.contains(fieldName)) {
      this.logger.warn(`Field "${fieldName}" not found in form`);
      return;
    }
    this.form.removeControl(fieldName);
    this.dynamicFieldsConfig.update((config) => {
      const { [fieldName]: _, ...newConfig } = config;
      return newConfig;
    });
    this.form.markAsDirty();
    if (this.options.enableHistory) {
      this.addHistoryEntry(`Removed dynamic field "${fieldName}"`);
    }
  }

  protected createControlFromConfig(config: ControlConfig): AbstractControl {
    if (config.controls) {
      if (Array.isArray(config.controls)) {
        return this.formBuilder.array(
          config.controls.map((c: ControlConfig) => this.createControlFromConfig(c)),
          { validators: config.validators, asyncValidators: config.asyncValidators, updateOn: config.options?.updateOn },
        );
      } else {
        const groupControls: Record<string, AbstractControl> = {};
        for (const key in config.controls) {
          if (Object.prototype.hasOwnProperty.call(config.controls, key)) {
            groupControls[key] = this.createControlFromConfig(config.controls[key]);
          }
        }
        return this.formBuilder.group(groupControls, {
          validators: config.validators,
          asyncValidators: config.asyncValidators,
          updateOn: config.options?.updateOn,
        });
      }
    } else {
      return this.formBuilder.control(
        { value: config.value, disabled: false }, // Assumindo que não está desabilitado por padrão
        {
          validators: config.validators,
          asyncValidators: config.asyncValidators,
          updateOn: config.options?.updateOn,
        },
      );
    }
  }

  private getStorageKey(): string {
    if (!this.options.formId) return '';
    return `${this.options.storageKeyPrefix}${this.options.formId}`;
  }

  protected getFormValue(): SubmitPayload {
    if (!this.form) {
      this.logger.error('getFormValue called but form is not initialized.');
      return {} as SubmitPayload; // Retorna um objeto vazio tipado para evitar mais erros
    }
    return (this.options.includeDisabled ? this.form.getRawValue() : this.form.value) as SubmitPayload;
  }

  protected abstract submitFormLogic(payload: SubmitPayload): void | Observable<unknown> | Promise<unknown>;

  public onSubmit(): void {
    if (!this.validateForm()) {
      this.logger.warn('Form validation failed.', { formId: this.options.formId, errors: this.validationErrors() });
      return;
    }

    this.submitting.set(true);
    this.generalError.set(null);
    this.successMessage.set(null);

    const payload = this.getFormValue();
    this.logger.debug('Submitting form with payload:', { formId: this.options.formId, payload });

    try {
      const submissionResult = this.submitFormLogic(payload);

      if (submissionResult instanceof Observable) {
        submissionResult.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: (response: unknown) => {
            this.setSuccess('Form submitted successfully!');
            this.logger.info('Form submission successful (Observable)', { formId: this.options.formId, response });
          },
          error: (error: unknown) => {
            this.handleSubmissionError(error as Error | HttpErrorResponse | Record<string, unknown>);
          },
          complete: () => this.submitting.set(false),
        });
      } else if (submissionResult instanceof Promise) {
        submissionResult
          .then((response: unknown) => {
            this.setSuccess('Form submitted successfully!');
            this.logger.info('Form submission successful (Promise)', { formId: this.options.formId, response });
          })
          .catch((error: unknown) => {
            this.handleSubmissionError(error as Error | HttpErrorResponse | Record<string, unknown>);
          })
          .finally(() => this.submitting.set(false));
      }
    } catch (error: unknown) {
      this.handleSubmissionError(error as Error | HttpErrorResponse | Record<string, unknown>);
    }
  }
}
