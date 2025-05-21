// form-utils.service.ts
import { Injectable, inject } from '@angular/core';
import { FormGroup, FormArray, FormControl, AbstractControl, ValidatorFn, ValidationErrors, FormBuilder } from '@angular/forms';
import { LoggingService } from '@vai/services';

/**
 * Interface para serialização de formulário
 */
export interface FormSerialization<T = any> {
  values: T;
  errors: Record<string, any>;
  touched: string[];
  dirty: string[];
  disabled: string[];
  metadata?: Record<string, any>;
}

/**
 * Serviço aprimorado para manipulação de formulários
 * Foco em utilitários para operações estruturais e manipulação de formulários
 */
@Injectable({
  providedIn: 'root',
})
export class FormUtilsService {
  private logger = inject(LoggingService);
  private formBuilder = inject(FormBuilder);

  /**
   * === UTILITÁRIOS DE MARCAÇÃO DE CAMPO ===
   */

  /**
   * Marca todos os campos do formulário como tocados para mostrar erros
   */
  markFormGroupTouched(formGroup: FormGroup | FormArray): void {
    Object.keys(formGroup.controls).forEach((field) => {
      const control = formGroup.get(field);

      // Marcar como tocado
      control?.markAsTouched({ onlySelf: true });

      // Se for um subgrupo ou array, marcar seus campos também
      if (control instanceof FormGroup || control instanceof FormArray) {
        this.markFormGroupTouched(control);
      }
    });
  }

  /**
   * Marca um controle específico como tocado
   */
  markControlTouched(control: AbstractControl): void {
    control.markAsTouched({ onlySelf: false });

    if (control instanceof FormGroup || control instanceof FormArray) {
      this.markFormGroupTouched(control);
    }
  }

  /**
   * Marca todos os campos do formulário como dirty
   */
  markFormGroupDirty(formGroup: FormGroup | FormArray): void {
    Object.keys(formGroup.controls).forEach((field) => {
      const control = formGroup.get(field);

      // Marcar como dirty
      control?.markAsDirty({ onlySelf: true });

      // Se for um subgrupo ou array, marcar seus campos também
      if (control instanceof FormGroup || control instanceof FormArray) {
        this.markFormGroupDirty(control);
      }
    });
  }

  /**
   * Marca todos os campos do formulário como pristine
   */
  markFormGroupPristine(formGroup: FormGroup | FormArray): void {
    Object.keys(formGroup.controls).forEach((field) => {
      const control = formGroup.get(field);

      // Marcar como pristine
      control?.markAsPristine({ onlySelf: true });

      // Se for um subgrupo ou array, marcar seus campos também
      if (control instanceof FormGroup || control instanceof FormArray) {
        this.markFormGroupPristine(control);
      }
    });
  }

  /**
   * Verifica se um formulário tem erros e marca todos os campos se tiver
   */
  validateFormAndMarkFields(form: FormGroup): boolean {
    if (form.invalid) {
      this.markFormGroupTouched(form);
      return false;
    }
    return true;
  }

  /**
   * Marca campos específicos como tocados
   */
  markFieldsTouched(form: FormGroup, fieldNames: string[]): void {
    fieldNames.forEach((field) => {
      const control = form.get(field);
      if (control) {
        control.markAsTouched({ onlySelf: false });
      }
    });
  }

  /**
   * === UTILITÁRIOS DE RESET E LIMPEZA ===
   */

  /**
   * Reset completo do formulário incluindo validadores
   */
  resetFormWithValidators(form: FormGroup): void {
    form.reset();
    Object.keys(form.controls).forEach((key) => {
      const control = form.get(key);
      if (control) {
        control.setErrors(null);
        control.updateValueAndValidity();
      }
    });
  }

  /**
   * Limpa apenas campos específicos do formulário
   */
  clearFormFields(form: FormGroup, fields: string[]): void {
    fields.forEach((field) => {
      const control = form.get(field);
      if (control) {
        control.reset();
        control.setErrors(null);
        control.updateValueAndValidity();
      }
    });
  }

  /**
   * Reset do formulário preservando valores iniciais
   */
  resetToInitialValues(form: FormGroup, initialValues: any): void {
    form.reset(initialValues);
    Object.keys(form.controls).forEach((key) => {
      const control = form.get(key);
      if (control) {
        control.setErrors(null);
        control.markAsPristine();
        control.markAsUntouched();
      }
    });
  }

  /**
   * === UTILITÁRIOS DE EXTRAÇÃO DE ERROS ===
   */

  /**
   * Extrai erros do formulário em um formato amigável
   */
  getFormErrors(form: FormGroup): Record<string, string> {
    const errors: Record<string, string> = {};
    this.extractControlErrors(form, '', errors);
    return errors;
  }

  /**
   * Obtém erros apenas para campos específicos
   */
  getFieldErrors(form: FormGroup, fields: string[]): Record<string, string> {
    const errors: Record<string, string> = {};

    fields.forEach((field) => {
      const control = form.get(field);
      if (control?.invalid && control?.touched) {
        if (control.errors) {
          const firstErrorKey = Object.keys(control.errors)[0];
          errors[field] = this.getErrorMessage(firstErrorKey, control.errors[firstErrorKey], this.getFieldDisplayName(field));
        }
      }
    });

    return errors;
  }

  /**
   * Extrai erros recursivamente de todos os controles
   */
  private extractControlErrors(formGroup: FormGroup | FormArray, parentPath: string, errors: Record<string, string>): void {
    if (formGroup instanceof FormGroup) {
      Object.keys(formGroup.controls).forEach((key) => {
        const control = formGroup.get(key);
        const path = parentPath ? `${parentPath}.${key}` : key;

        if (control instanceof FormGroup || control instanceof FormArray) {
          // Recursivamente extrair erros de subgrupos
          this.extractControlErrors(control, path, errors);
        } else if (control?.invalid && control?.touched) {
          // Adicionar erros de controle individual
          if (control.errors) {
            const firstErrorKey = Object.keys(control.errors)[0];
            errors[path] = this.getErrorMessage(firstErrorKey, control.errors[firstErrorKey], this.getFieldDisplayName(path));
          }
        }
      });
    } else if (formGroup instanceof FormArray) {
      formGroup.controls.forEach((control, index) => {
        const path = `${parentPath}[${index}]`;

        if (control instanceof FormGroup || control instanceof FormArray) {
          this.extractControlErrors(control, path, errors);
        } else if (control?.invalid && control?.touched) {
          if (control.errors) {
            const firstErrorKey = Object.keys(control.errors)[0];
            errors[path] = this.getErrorMessage(firstErrorKey, control.errors[firstErrorKey], `Item ${index + 1}`);
          }
        }
      });
    }
  }

  /**
   * Obtém uma mensagem amigável para cada tipo de erro
   */
  getErrorMessage(errorType: string, errorValue: any, fieldName?: string): string {
    const field = fieldName || 'This field';

    switch (errorType) {
      // Erros padrão
      case 'required':
        return `${field} is required`;
      case 'email':
        return `Please enter a valid email address`;
      case 'minlength':
        return `${field} must be at least ${errorValue.requiredLength} characters`;
      case 'maxlength':
        return `${field} cannot be more than ${errorValue.requiredLength} characters`;
      case 'pattern':
        return `${field} has an invalid format`;
      case 'min':
        return `${field} must be at least ${errorValue.min}`;
      case 'max':
        return `${field} cannot exceed ${errorValue.max}`;

      // Erros de senha
      case 'passwordMismatch':
        return `Passwords do not match`;
      case 'passwordStrength':
        let pwdErrors = [];
        if (errorValue.minLength) {
          pwdErrors.push(`at least ${errorValue.minLength.required} characters`);
        }
        if (errorValue.requireUppercase) {
          pwdErrors.push(`an uppercase letter`);
        }
        if (errorValue.requireLowercase) {
          pwdErrors.push(`a lowercase letter`);
        }
        if (errorValue.requireNumbers) {
          pwdErrors.push(`a number`);
        }
        if (errorValue.requireSpecialChars) {
          pwdErrors.push(`a special character (${errorValue.requireSpecialChars.pattern || '!@#$%^&*(),.?":{}|<>'})`);
        }
        return `Password must contain ${pwdErrors.join(', ')}`;

      // Erros de documento
      case 'invalidCpf':
        return `Please enter a valid CPF`;
      case 'invalidCnpj':
        return `Please enter a valid CNPJ`;
      case 'invalidRg':
        return `Please enter a valid RG`;
      case 'invalidPis':
        return `Please enter a valid PIS/PASEP/NIS`;

      // Erros de contato
      case 'invalidPhone':
        return `Please enter a valid phone number`;
      case 'invalidCep':
        return `Please enter a valid ZIP code`;
      case 'invalidUrl':
        return `Please enter a valid URL`;

      // Erros de data
      case 'futureDate':
        return `${field} must be a future date`;
      case 'pastDate':
        return `${field} must be a past date`;
      case 'minDate':
        return `${field} cannot be before ${new Date(errorValue.required).toLocaleDateString()}`;
      case 'maxDate':
        return `${field} cannot be after ${new Date(errorValue.required).toLocaleDateString()}`;

      // Erros de idade
      case 'minAge':
        return `Person must be at least ${errorValue.required} years old`;
      case 'maxAge':
        return `Person cannot be older than ${errorValue.required} years`;

      // Erros de número
      case 'notANumber':
        return `${field} must be a valid number`;
      case 'notInteger':
        return `${field} must be a whole number`;
      case 'notPositive':
        return `${field} must be a positive number`;

      // Erros de arquivo
      case 'invalidFileType':
        return `File type not allowed. Accepted types: ${errorValue.allowedTypes.join(', ')}`;
      case 'fileTooLarge':
        return `File is too large. Maximum size: ${this.formatBytes(errorValue.maxSize)}`;
      case 'notAFile':
        return `${field} must be a valid file`;
      case 'notAnImage':
        return `${field} must be a valid image file`;

      // Erros de validação de grupo
      case 'atLeastOneRequired':
        return `At least one of these fields is required: ${errorValue.fields.join(', ')}`;

      // Erros do servidor
      case 'serverError':
        return errorValue || `${field} has a validation error`;

      // Erro genérico
      default:
        return `${field} is invalid`;
    }
  }

  /**
   * Formata bytes em unidades legíveis
   */
  private formatBytes(bytes: number, decimals: number = 2): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
  }

  /**
   * Obtém um nome de exibição para o campo
   */
  getFieldDisplayName(fieldPath: string): string {
    // Extrair o último segmento do caminho (para campos aninhados)
    const fieldName = fieldPath.split('.').pop()?.split('[')[0] || fieldPath;

    // Converte de camelCase para frases (ex: 'firstName' -> 'First name')
    return fieldName.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase());
  }

  /**
   * === UTILITÁRIOS PARA MANIPULAÇÃO DE FORMULÁRIOS DINÂMICOS ===
   */

  /**
   * Adiciona um controle dinamicamente a um FormGroup
   */
  addControl(form: FormGroup, name: string, control: AbstractControl): void {
    if (form.contains(name)) {
      this.logger.warn(`Control "${name}" already exists in form`);
      return;
    }

    form.addControl(name, control);
  }

  /**
   * Remove um controle dinamicamente de um FormGroup
   */
  removeControl(form: FormGroup, name: string): void {
    if (!form.contains(name)) {
      this.logger.warn(`Control "${name}" not found in form`);
      return;
    }

    form.removeControl(name);
  }

  /**
   * Adiciona um item a um FormArray
   */
  addArrayItem(formArray: FormArray, control: AbstractControl, index?: number): void {
    if (index !== undefined && index >= 0 && index <= formArray.length) {
      formArray.insert(index, control);
    } else {
      formArray.push(control);
    }
  }

  /**
   * Remove um item de um FormArray
   */
  removeArrayItem(formArray: FormArray, index: number): void {
    if (index < 0 || index >= formArray.length) {
      this.logger.warn(`Invalid index ${index} for FormArray`);
      return;
    }

    formArray.removeAt(index);
  }

  /**
   * Move um item dentro de um FormArray
   */
  moveArrayItem(formArray: FormArray, fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= formArray.length || toIndex < 0 || toIndex >= formArray.length) {
      this.logger.warn(`Invalid indices for moving item`);
      return;
    }

    const control = formArray.at(fromIndex);
    formArray.removeAt(fromIndex);
    formArray.insert(toIndex, control);
  }

  /**
   * Cria um FormArray a partir de uma lista de valores
   */
  createArrayFromValues<T>(values: T[], controlFactory: (value: T) => AbstractControl): FormArray {
    const controls = values.map((value) => controlFactory(value));
    return this.formBuilder.array(controls);
  }

  /**
   * === UTILITÁRIOS DE MANIPULAÇÃO DE ESTADO ===
   */

  /**
   * Clona um controle preservando seu estado
   */
  cloneControl(control: AbstractControl): AbstractControl {
    if (control instanceof FormControl) {
      return this.formBuilder.control(
        {
          value: control.value,
          disabled: control.disabled,
        },
        control.validator,
        control.asyncValidator,
      );
    }

    if (control instanceof FormGroup) {
      const controlsConfig: { [key: string]: AbstractControl } = {};

      Object.keys(control.controls).forEach((key) => {
        controlsConfig[key] = this.cloneControl(control.get(key)!);
      });

      return this.formBuilder.group(controlsConfig);
    }

    if (control instanceof FormArray) {
      const controlsArray: AbstractControl[] = [];

      control.controls.forEach((c) => {
        controlsArray.push(this.cloneControl(c));
      });

      return this.formBuilder.array(controlsArray);
    }

    throw new Error('Unknown control type');
  }

  /**
   * Serializa um FormGroup para armazenamento
   */
  serializeForm<T = any>(form: FormGroup): FormSerialization<T> {
    // Obter valores e estado
    const values = form.getRawValue() as T;
    const errors: Record<string, any> = {};
    const touched: string[] = [];
    const dirty: string[] = [];
    const disabled: string[] = [];

    // Função recursiva para extrair estado
    const processControl = (control: AbstractControl, path: string = '') => {
      if (control.disabled) {
        disabled.push(path);
      }

      if (control.touched) {
        touched.push(path);
      }

      if (control.dirty) {
        dirty.push(path);
      }

      if (control.errors) {
        errors[path] = control.errors;
      }

      if (control instanceof FormGroup) {
        Object.keys(control.controls).forEach((key) => {
          const childPath = path ? `${path}.${key}` : key;
          processControl(control.get(key)!, childPath);
        });
      } else if (control instanceof FormArray) {
        control.controls.forEach((c, index) => {
          const childPath = `${path}[${index}]`;
          processControl(c, childPath);
        });
      }
    };

    // Processar o formulário
    processControl(form);

    return { values, errors, touched, dirty, disabled };
  }

  /**
   * Reconstrói um FormGroup a partir de uma serialização
   */
  deserializeForm<T = any>(form: FormGroup, serialization: FormSerialization<T>): void {
    // Reset primeiro
    form.reset();

    // Definir valores
    form.patchValue(serialization.values);

    // Restaurar estado
    const processControl = (control: AbstractControl, path: string = '') => {
      // Definir estado desabilitado
      if (serialization.disabled.includes(path)) {
        control.disable({ emitEvent: false });
      } else {
        control.enable({ emitEvent: false });
      }

      // Definir estado tocado
      if (serialization.touched.includes(path)) {
        control.markAsTouched({ onlySelf: true });
      } else {
        control.markAsUntouched({ onlySelf: true });
      }

      // Definir estado sujo
      if (serialization.dirty.includes(path)) {
        control.markAsDirty({ onlySelf: true });
      } else {
        control.markAsPristine({ onlySelf: true });
      }

      // Definir erros
      if (serialization.errors[path]) {
        control.setErrors(serialization.errors[path]);
      }

      // Processar controles filhos
      if (control instanceof FormGroup) {
        Object.keys(control.controls).forEach((key) => {
          const childPath = path ? `${path}.${key}` : key;
          processControl(control.get(key)!, childPath);
        });
      } else if (control instanceof FormArray) {
        control.controls.forEach((c, index) => {
          const childPath = `${path}[${index}]`;
          processControl(c, childPath);
        });
      }
    };

    // Processar o formulário
    processControl(form);

    // Emitir alteração sem re-validação
    form.updateValueAndValidity({ emitEvent: false });
  }

  /**
   * === UTILITÁRIOS PARA MONITORAMENTO DE FORMULÁRIO ===
   */

  /**
   * Obtém os campos modificados em um formulário
   */
  getModifiedFields(form: FormGroup): string[] {
    const modifiedFields: string[] = [];

    const checkControl = (control: AbstractControl, path: string = '') => {
      if (control.dirty) {
        if (!(control instanceof FormGroup) && !(control instanceof FormArray)) {
          modifiedFields.push(path);
        }
      }

      if (control instanceof FormGroup) {
        Object.keys(control.controls).forEach((key) => {
          const childPath = path ? `${path}.${key}` : key;
          checkControl(control.get(key)!, childPath);
        });
      } else if (control instanceof FormArray) {
        control.controls.forEach((c, index) => {
          const childPath = `${path}[${index}]`;
          checkControl(c, childPath);
        });
      }
    };

    checkControl(form);
    return modifiedFields;
  }

  /**
   * Compara dois valores de formulário e retorna as diferenças
   */
  compareFormValues(original: any, current: any): Record<string, { original: any; current: any }> {
    const differences: Record<string, { original: any; current: any }> = {};

    const compare = (orig: any, curr: any, path: string = '') => {
      // Se ambos são objetos
      if (typeof orig === 'object' && orig !== null && typeof curr === 'object' && curr !== null) {
        // Arrays
        if (Array.isArray(orig) && Array.isArray(curr)) {
          // Comparar cada elemento do array
          const maxLength = Math.max(orig.length, curr.length);
          for (let i = 0; i < maxLength; i++) {
            // Se o índice existe em ambos
            if (i < orig.length && i < curr.length) {
              compare(orig[i], curr[i], `${path}[${i}]`);
            }
            // Se existe apenas no original
            else if (i < orig.length) {
              differences[`${path}[${i}]`] = { original: orig[i], current: undefined };
            }
            // Se existe apenas no atual
            else {
              differences[`${path}[${i}]`] = { original: undefined, current: curr[i] };
            }
          }
        }
        // Objetos
        else if (!Array.isArray(orig) && !Array.isArray(curr)) {
          // Combinar todas as chaves de ambos os objetos
          const allKeys = new Set([...Object.keys(orig), ...Object.keys(curr)]);

          allKeys.forEach((key) => {
            const newPath = path ? `${path}.${key}` : key;

            // Se a chave existe em ambos
            if (key in orig && key in curr) {
              compare(orig[key], curr[key], newPath);
            }
            // Se existe apenas no original
            else if (key in orig) {
              differences[newPath] = { original: orig[key], current: undefined };
            }
            // Se existe apenas no atual
            else {
              differences[newPath] = { original: undefined, current: curr[key] };
            }
          });
        }
        // Se um é array e outro objeto, tratar como diferentes
        else {
          differences[path] = { original: orig, current: curr };
        }
      }
      // Primitivos - comparar diretamente
      else if (orig !== curr) {
        differences[path] = { original: orig, current: curr };
      }
    };

    compare(original, current);
    return differences;
  }

  /**
   * Obtém um formControl com typesafety
   */
  getControl<T>(form: FormGroup, controlName: keyof T): AbstractControl | null {
    return form.get(controlName as string);
  }

  /**
   * Registra valores padrão em um formulário
   */
  patchFormValues<T>(form: FormGroup, values: Partial<T>): void {
    try {
      form.patchValue(values);
      this.logger.debug('Form values set', values);
    } catch (error) {
      this.logger.error('Failed to patch form values', error);
    }
  }
}
