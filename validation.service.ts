import { inject, Injectable } from '@angular/core';
import { AbstractControl, FormArray, FormGroup, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { LoggingService } from './logging.service';
import { Observable, of, timer, switchMap, map } from 'rxjs';

export interface ValidationResult {
  isValid: boolean;
  errors?: ValidationErrors;
  errorMessage?: string;
}

/**
 * Serviço centralizado para validação de formulários
 * Contém validações reutilizáveis em toda a aplicação
 */
@Injectable({
  providedIn: 'root',
})
export class ValidationService {
  private logger = inject(LoggingService);

  // Cache para validadores assíncronos
  private validationCache = new Map<string, ValidationResult>();

  /**
   * === VALIDADORES DE DOCUMENTOS ===
   */

  /**
   * Validador para CPF
   */
  cpfValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;

      const cpf = control.value.replace(/[^\d]/g, '');

      if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) {
        return { invalidCpf: true };
      }

      // Validação do dígito verificador
      let sum = 0;
      for (let i = 0; i < 9; i++) {
        sum += parseInt(cpf.charAt(i)) * (10 - i);
      }
      let digit = 11 - (sum % 11);
      if (digit >= 10) digit = 0;

      if (digit !== parseInt(cpf.charAt(9))) {
        return { invalidCpf: true };
      }

      sum = 0;
      for (let i = 0; i < 10; i++) {
        sum += parseInt(cpf.charAt(i)) * (11 - i);
      }
      digit = 11 - (sum % 11);
      if (digit >= 10) digit = 0;

      if (digit !== parseInt(cpf.charAt(10))) {
        return { invalidCpf: true };
      }

      return null;
    };
  }

  /**
   * Validador para CNPJ
   */
  cnpjValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;

      const cnpj = control.value.replace(/[^\d]/g, '');

      if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) {
        return { invalidCnpj: true };
      }

      // Validação do primeiro dígito verificador
      let size = cnpj.length - 2;
      let numbers = cnpj.substring(0, size);
      const digits = cnpj.substring(size);
      let sum = 0;
      let pos = size - 7;

      for (let i = size; i >= 1; i--) {
        sum += parseInt(numbers.charAt(size - i)) * pos--;
        if (pos < 2) pos = 9;
      }

      let result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
      if (result !== parseInt(digits.charAt(0))) {
        return { invalidCnpj: true };
      }

      // Validação do segundo dígito verificador
      size = size + 1;
      numbers = cnpj.substring(0, size);
      sum = 0;
      pos = size - 7;

      for (let i = size; i >= 1; i--) {
        sum += parseInt(numbers.charAt(size - i)) * pos--;
        if (pos < 2) pos = 9;
      }

      result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
      if (result !== parseInt(digits.charAt(1))) {
        return { invalidCnpj: true };
      }

      return null;
    };
  }

  /**
   * Validador para PIS/PASEP/NIS
   */
  pisValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;

      const pis = control.value.replace(/[^\d]/g, '');

      if (pis.length !== 11 || /^(\d)\1+$/.test(pis)) {
        return { invalidPis: true };
      }

      const multipliers = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

      let sum = 0;
      for (let i = 0; i < 10; i++) {
        sum += parseInt(pis.charAt(i)) * multipliers[i];
      }

      const remainder = sum % 11;
      const digit = remainder < 2 ? 0 : 11 - remainder;

      if (digit !== parseInt(pis.charAt(10))) {
        return { invalidPis: true };
      }

      return null;
    };
  }

  /**
   * Validador para RG
   * Nota: O RG varia por estado, esta é uma validação básica
   */
  rgValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;

      const rg = control.value.replace(/[^\dXx]/g, '');

      // Validação básica de comprimento (entre 8 e 11 caracteres)
      if (rg.length < 8 || rg.length > 11) {
        return { invalidRg: true };
      }

      return null;
    };
  }

  /**
   * === VALIDADORES DE CONTATO E LOCALIZAÇÃO ===
   */

  /**
   * Validador para e-mail
   * Mais completo que o padrão do Angular
   */
  emailValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;

      // Regex mais completa para validação de e-mail
      const pattern =
        /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

      if (!pattern.test(control.value)) {
        return { email: true };
      }

      return null;
    };
  }

  /**
   * Validador para telefone brasileiro
   */
  phoneValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;

      const phone = control.value.replace(/\D/g, '');

      // Verifica se é um número válido (8 a 11 dígitos)
      if (phone.length < 8 || phone.length > 11) {
        return { invalidPhone: true };
      }

      return null;
    };
  }

  /**
   * Validador para CEP
   */
  cepValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;

      const cep = control.value.replace(/\D/g, '');

      // CEP deve ter 8 dígitos
      if (cep.length !== 8) {
        return { invalidCep: true };
      }

      return null;
    };
  }

  /**
   * Validador para URL
   */
  urlValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;

      try {
        new URL(control.value);
        return null;
      } catch {
        return { invalidUrl: true };
      }
    };
  }

  /**
   * === VALIDADORES DE DATA ===
   */

  /**
   * Validador para data futura
   */
  futureDateValidator(options?: { includeToday?: boolean }): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;

      const inputDate = new Date(control.value);
      const currentDate = new Date();

      // Reset time para comparar apenas as datas
      currentDate.setHours(0, 0, 0, 0);
      inputDate.setHours(0, 0, 0, 0);

      // Se includeToday for true, permita a data atual
      if (options?.includeToday && inputDate.getTime() === currentDate.getTime()) {
        return null;
      }

      if (inputDate < currentDate) {
        return {
          futureDate: {
            required: currentDate.toISOString().split('T')[0],
            actual: inputDate.toISOString().split('T')[0],
          },
        };
      }

      return null;
    };
  }

  /**
   * Validador para data passada
   */
  pastDateValidator(options?: { includeToday?: boolean }): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;

      const inputDate = new Date(control.value);
      const currentDate = new Date();

      // Reset time para comparar apenas as datas
      currentDate.setHours(0, 0, 0, 0);
      inputDate.setHours(0, 0, 0, 0);

      // Se includeToday for true, permita a data atual
      if (options?.includeToday && inputDate.getTime() === currentDate.getTime()) {
        return null;
      }

      if (inputDate > currentDate) {
        return {
          pastDate: {
            required: currentDate.toISOString().split('T')[0],
            actual: inputDate.toISOString().split('T')[0],
          },
        };
      }

      return null;
    };
  }

  /**
   * Validador de data dentro de um intervalo
   */
  dateRangeValidator(minDate?: Date | string, maxDate?: Date | string): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;

      const inputDate = new Date(control.value);

      // Validação de data mínima
      if (minDate) {
        const min = new Date(minDate);
        min.setHours(0, 0, 0, 0);
        inputDate.setHours(0, 0, 0, 0);

        if (inputDate < min) {
          return {
            minDate: {
              required: min.toISOString().split('T')[0],
              actual: inputDate.toISOString().split('T')[0],
            },
          };
        }
      }

      // Validação de data máxima
      if (maxDate) {
        const max = new Date(maxDate);
        max.setHours(0, 0, 0, 0);
        inputDate.setHours(0, 0, 0, 0);

        if (inputDate > max) {
          return {
            maxDate: {
              required: max.toISOString().split('T')[0],
              actual: inputDate.toISOString().split('T')[0],
            },
          };
        }
      }

      return null;
    };
  }

  /**
   * Validador para idade mínima/máxima
   */
  ageValidator(minAge: number, maxAge: number = 120): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;

      const birthDate = new Date(control.value);
      const today = new Date();

      // Calcular idade
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();

      // Ajustar idade se aniversário ainda não ocorreu no ano atual
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }

      // Verificar se idade está dentro do intervalo permitido
      if (age < minAge) {
        return { minAge: { required: minAge, actual: age } };
      }

      if (age > maxAge) {
        return { maxAge: { required: maxAge, actual: age } };
      }

      return null;
    };
  }

  /**
   * === VALIDADORES DE NÚMERO E INTERVALOS ===
   */

  /**
   * Validador para número mínimo e máximo (inclusive)
   */
  rangeValidator(min: number, max: number): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value && control.value !== 0) return null;

      const value = parseFloat(control.value);

      if (isNaN(value)) {
        return { notANumber: true };
      }

      if (value < min) {
        return { min: { required: min, actual: value } };
      }

      if (value > max) {
        return { max: { required: max, actual: value } };
      }

      return null;
    };
  }

  /**
   * Validador de inteiro
   */
  integerValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value && control.value !== 0) return null;

      const value = parseFloat(control.value);

      if (isNaN(value)) {
        return { notANumber: true };
      }

      if (!Number.isInteger(value)) {
        return { notInteger: true };
      }

      return null;
    };
  }

  /**
   * Validador de número positivo
   */
  positiveNumberValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value && control.value !== 0) return null;

      const value = parseFloat(control.value);

      if (isNaN(value)) {
        return { notANumber: true };
      }

      if (value <= 0) {
        return { notPositive: true };
      }

      return null;
    };
  }

  /**
   * === VALIDADORES DE SENHA ===
   */

  /**
   * Validador para senhas fortes
   * Centralizado para evitar duplicação da lógica
   */
  strongPasswordValidator(
    options: {
      minLength?: number;
      requireUppercase?: boolean;
      requireLowercase?: boolean;
      requireNumbers?: boolean;
      requireSpecialChars?: boolean;
      specialCharsPattern?: string;
    } = {},
  ): ValidatorFn {
    // Valores padrão
    const config = {
      minLength: options.minLength || 8,
      requireUppercase: options.requireUppercase !== undefined ? options.requireUppercase : true,
      requireLowercase: options.requireLowercase !== undefined ? options.requireLowercase : true,
      requireNumbers: options.requireNumbers !== undefined ? options.requireNumbers : true,
      requireSpecialChars: options.requireSpecialChars !== undefined ? options.requireSpecialChars : true,
      specialCharsPattern: options.specialCharsPattern || '!@#$%^&*(),.?":{}|<>',
    };

    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;

      const errors: ValidationErrors = {};
      const value = control.value;

      // Uma única verificação para cada tipo de caractere (mais eficiente)
      const hasLowercase = /[a-z]/.test(value);
      const hasUppercase = /[A-Z]/.test(value);
      const hasNumbers = /\d/.test(value);
      const hasSpecialChars = new RegExp(`[${config.specialCharsPattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}]`).test(value);

      // Comprimento mínimo
      if (value.length < config.minLength) {
        errors['minLength'] = { required: config.minLength, actual: value.length };
      }

      // Requisitos de caracteres específicos
      if (config.requireLowercase && !hasLowercase) {
        errors['requireLowercase'] = true;
      }

      if (config.requireUppercase && !hasUppercase) {
        errors['requireUppercase'] = true;
      }

      if (config.requireNumbers && !hasNumbers) {
        errors['requireNumbers'] = true;
      }

      if (config.requireSpecialChars && !hasSpecialChars) {
        errors['requireSpecialChars'] = { pattern: config.specialCharsPattern };
      }

      return Object.keys(errors).length > 0 ? { passwordStrength: errors } : null;
    };
  }

  /**
   * Validador para correspondência entre campos (ex: senha e confirmação)
   */
  matchValidator(controlName: string, matchingControlName: string): ValidatorFn {
    return (formGroup: AbstractControl): ValidationErrors | null => {
      const control = formGroup.get(controlName);
      const matchingControl = formGroup.get(matchingControlName);

      if (!control || !matchingControl) {
        return null;
      }

      if (matchingControl.errors && !matchingControl.errors['passwordMismatch']) {
        return null;
      }

      // Retorna erro se os valores não corresponderem
      if (control.value !== matchingControl.value) {
        matchingControl.setErrors({ passwordMismatch: true });
        return { passwordMismatch: true };
      } else {
        matchingControl.setErrors(null);
        return null;
      }
    };
  }

  /**
   * === VALIDADORES DE ARQUIVO E MÍDIA ===
   */

  /**
   * Validador de tipo de arquivo
   */
  fileTypeValidator(allowedTypes: string[]): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;

      const file = control.value as File;

      if (!(file instanceof File)) {
        return { notAFile: true };
      }

      // Verificar o tipo MIME
      if (!allowedTypes.includes(file.type)) {
        return {
          invalidFileType: {
            allowedTypes,
            actual: file.type,
          },
        };
      }

      return null;
    };
  }

  /**
   * Validador de tamanho de arquivo
   */
  fileSizeValidator(maxSizeInBytes: number): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;

      const file = control.value as File;

      if (!(file instanceof File)) {
        return { notAFile: true };
      }

      if (file.size > maxSizeInBytes) {
        return {
          fileTooLarge: {
            maxSize: maxSizeInBytes,
            actual: file.size,
          },
        };
      }

      return null;
    };
  }

  /**
   * Validador de dimensões de imagem
   */
  imageValidator(options: { minWidth?: number; minHeight?: number; maxWidth?: number; maxHeight?: number }): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (!control.value) return null;

      const file = control.value as File;

      if (!(file instanceof File)) {
        return { notAFile: true };
      }

      // Verificar se é uma imagem
      if (!file.type.startsWith('image/')) {
        return { notAnImage: true };
      }

      // Para validar dimensões, precisamos carregar a imagem
      return new Promise<ValidationErrors | null>((resolve) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
          URL.revokeObjectURL(objectUrl);

          const errors: ValidationErrors = {};

          if (options.minWidth && img.width < options.minWidth) {
            errors['minWidth'] = { required: options.minWidth, actual: img.width };
          }

          if (options.minHeight && img.height < options.minHeight) {
            errors['minHeight'] = { required: options.minHeight, actual: img.height };
          }

          if (options.maxWidth && img.width > options.maxWidth) {
            errors['maxWidth'] = { required: options.maxWidth, actual: img.width };
          }

          if (options.maxHeight && img.height > options.maxHeight) {
            errors['maxHeight'] = { required: options.maxHeight, actual: img.height };
          }

          resolve(Object.keys(errors).length > 0 ? { imageDimensions: errors } : null);
        };

        img.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          resolve({ invalidImage: true });
        };

        img.src = objectUrl;
      }) as any; // Note: A validação assíncrona é mais complexa
    };
  }

  /**
   * === VALIDADORES ASSÍNCRONOS ===
   */

  /**
   * Factory para criar um validador assíncrono com cache
   */
  createAsyncValidator(
    validationFn: (value: any) => Observable<ValidationResult>,
    options: {
      cacheResults?: boolean;
      cacheKey?: (value: any) => string;
      debounceTime?: number;
    } = {},
  ) {
    const { cacheResults = true, cacheKey = (value) => String(value), debounceTime = 300 } = options;

    return (control: AbstractControl): Observable<ValidationErrors | null> => {
      if (!control.value) {
        return of(null);
      }

      // Gerar chave de cache
      const key = cacheKey(control.value);

      // Verificar cache
      if (cacheResults && this.validationCache.has(key)) {
        const result = this.validationCache.get(key)!;
        return of(result.isValid ? null : result.errors);
      }

      // Aplicar debounce
      return timer(debounceTime).pipe(
        switchMap(() => validationFn(control.value)),
        map((result) => {
          // Armazenar no cache
          if (cacheResults) {
            this.validationCache.set(key, result);
          }

          return result.isValid ? null : result.errors;
        }),
      );
    };
  }

  /**
   * Limpa o cache de validação assíncrona
   */
  clearValidationCache(): void {
    this.validationCache.clear();
    this.logger.debug('Validation cache cleared');
  }

  /**
   * Invalida entradas específicas do cache
   */
  invalidateCacheEntry(key: string): void {
    this.validationCache.delete(key);
  }

  /**
   * === VALIDADORES DE FORMULÁRIO COMPLEXOS ===
   */

  /**
   * Validador para verificar se pelo menos um campo em um grupo não está vazio
   */
  atLeastOneRequiredValidator(fields: string[]): ValidatorFn {
    return (formGroup: AbstractControl): ValidationErrors | null => {
      if (!(formGroup instanceof FormGroup)) {
        return null;
      }

      const hasValue = fields.some((field) => {
        const control = formGroup.get(field);
        return control && control.value;
      });

      return hasValue ? null : { atLeastOneRequired: { fields } };
    };
  }

  /**
   * Validador para verificar se todos os itens em um FormArray são válidos
   */
  allItemsValidValidator(): ValidatorFn {
    return (formArray: AbstractControl): ValidationErrors | null => {
      if (!(formArray instanceof FormArray)) {
        return null;
      }

      const invalidItems = formArray.controls.reduce((items, control, index) => {
        if (control.invalid) {
          items.push(index);
        }
        return items;
      }, [] as number[]);

      return invalidItems.length > 0 ? { invalidItems } : null;
    };
  }

  /**
   * Validador para formulários condicionais
   */
  conditionalValidator(predicate: (formGroup: FormGroup) => boolean, validator: ValidatorFn, elseValidator?: ValidatorFn): ValidatorFn {
    return (formGroup: AbstractControl): ValidationErrors | null => {
      if (!(formGroup instanceof FormGroup)) {
        return null;
      }

      if (predicate(formGroup)) {
        return validator(formGroup);
      } else if (elseValidator) {
        return elseValidator(formGroup);
      }

      return null;
    };
  }

  /**
   * Validador para dependência de campo
   */
  dependentFieldValidator(
    dependentField: string,
    primaryField: string,
    validationFn: (dependentValue: any, primaryValue: any) => ValidationErrors | null,
  ): ValidatorFn {
    return (formGroup: AbstractControl): ValidationErrors | null => {
      if (!(formGroup instanceof FormGroup)) {
        return null;
      }

      const dependentControl = formGroup.get(dependentField);
      const primaryControl = formGroup.get(primaryField);

      if (!dependentControl || !primaryControl) {
        return null;
      }

      const errors = validationFn(dependentControl.value, primaryControl.value);

      if (errors) {
        dependentControl.setErrors({
          ...dependentControl.errors,
          ...errors,
        });
        return { [dependentField]: errors };
      } else {
        // Remover apenas os erros de dependência, mantendo outros
        if (dependentControl.errors) {
          const { dependency, ...otherErrors } = dependentControl.errors;
          dependentControl.setErrors(Object.keys(otherErrors).length ? otherErrors : null);
        }
      }

      return null;
    };
  }
}
