// error-handling.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormGroup } from '@angular/forms';
import { LoggingService } from '@vai/services';
import { FormUtilsService } from './form-util.service';

export interface ErrorInfo {
  message: string;
  reason: string;
  level: 'info' | 'warn' | 'error';
  details?: Record<string, any>;
  validationErrors?: Record<string, string>;
}

@Injectable({
  providedIn: 'root',
})
export class ErrorHandlingService {
  private logger = inject(LoggingService);
  private formUtils = inject(FormUtilsService);

  private static ERROR_MAPPING: Record<number, Omit<ErrorInfo, 'details'>> = {
    400: {
      message: 'Bad request. Please check your input.',
      reason: 'bad_request',
      level: 'warn',
    },
    401: {
      message: 'Authentication required. Please log in.',
      reason: 'unauthorized',
      level: 'warn',
    },
    403: {
      message: 'You do not have permission to perform this action.',
      reason: 'forbidden',
      level: 'warn',
    },
    404: {
      message: 'The requested resource was not found.',
      reason: 'not_found',
      level: 'warn',
    },
    409: {
      message: 'Conflict occurred. The resource might have been modified.',
      reason: 'conflict',
      level: 'warn',
    },
    422: {
      message: 'Validation failed. Please check the provided data.',
      reason: 'validation_error',
      level: 'warn',
    },
    429: {
      message: 'Too many requests. Please try again later.',
      reason: 'rate_limited',
      level: 'warn',
    },
    500: {
      message: 'Server error. Please try again later.',
      reason: 'server_error',
      level: 'error',
    },
    0: {
      message: 'Network error. Please check your connection.',
      reason: 'network_error',
      level: 'error',
    },
  };

  /**
   * Processa um erro HTTP e retorna informações estruturadas
   */
  parseHttpError(error: HttpErrorResponse): ErrorInfo {
    // Valores padrão
    const errorInfo: ErrorInfo = {
      message: 'An error occurred',
      reason: 'unknown_error',
      level: 'error',
      details: { originalError: error },
    };

    // Processa timeout e erros de rede
    if (error.status === 0 && error.error instanceof ProgressEvent) {
      return {
        ...errorInfo,
        message: 'Request timed out. Please try again.',
        reason: 'timeout',
        level: 'warn',
      };
    }

    if (!error.status || error.status === 0) {
      return {
        ...errorInfo,
        ...ErrorHandlingService.ERROR_MAPPING[0],
        details: { ...errorInfo.details, networkError: true },
      };
    }

    // Verifica se temos um mapeamento específico para o código HTTP
    const statusMapping = ErrorHandlingService.ERROR_MAPPING[error.status];
    if (statusMapping) {
      errorInfo.message = statusMapping.message;
      errorInfo.reason = statusMapping.reason;
      errorInfo.level = statusMapping.level;
    }

    // Extrai erros de validação
    let validationErrors: Record<string, string> | undefined;

    if (error.error) {
      if (typeof error.error === 'object') {
        // Extrai mensagem e código
        if (error.error.message) {
          errorInfo.message = error.error.message;
        }

        if (error.error.code || error.error.reason) {
          errorInfo.reason = error.error.code || error.error.reason;
        }

        // Extrai erros de validação
        if (error.error.validationErrors || error.error.errors) {
          validationErrors = error.error.validationErrors || error.error.errors;
          errorInfo.validationErrors = validationErrors;
        }

        // Detalhes adicionais
        errorInfo.details = {
          ...errorInfo.details,
          serverDetails: error.error,
        };
      } else if (typeof error.error === 'string') {
        try {
          // Tenta analisar como JSON
          const parsedError = JSON.parse(error.error);
          if (parsedError.message) {
            errorInfo.message = parsedError.message;
          }

          if (parsedError.validationErrors || parsedError.errors) {
            validationErrors = parsedError.validationErrors || parsedError.errors;
            errorInfo.validationErrors = validationErrors;
          }
        } catch {
          // Não é JSON, usar como mensagem
          errorInfo.message = error.error;
        }
      }
    }

    // Log do erro com nível apropriado
    this.logger[errorInfo.level](`HTTP Error: ${errorInfo.message}`, {
      status: error.status,
      reason: errorInfo.reason,
      validationErrors: validationErrors ? Object.keys(validationErrors).length : 0,
    });

    return errorInfo;
  }

  /**
   * Manipula erros de formulário, aplicando erros aos campos apropriados
   */
  handleFormError(error: any, form: FormGroup): ErrorInfo {
    const errorInfo = this.parseHttpError(error);

    // Aplicar erros de validação se existirem
    if (errorInfo.validationErrors) {
      Object.entries(errorInfo.validationErrors).forEach(([fieldName, errorMessage]) => {
        const control = form.get(fieldName);
        if (control) {
          control.setErrors({ serverError: errorMessage });
          control.markAsTouched();
        }
      });

      // Marcar para mostrar erros
      this.formUtils.markFormGroupTouched(form);
    }

    return errorInfo;
  }

  /**
   * Manipulador de erros genérico para contextos não-HTTP
   */
  handleError(error: any, context: string = 'Application'): ErrorInfo {
    if (error instanceof HttpErrorResponse) {
      return this.parseHttpError(error);
    }

    // Erros não-HTTP
    const errorInfo: ErrorInfo = {
      message: error.message || 'An unexpected error occurred',
      reason: 'unknown_error',
      level: 'error',
      details: { error },
    };

    this.logger.error(`${context} Error: ${errorInfo.message}`, error);

    return errorInfo;
  }

  /**
   * Formata um erro para exibição
   */
  getErrorDisplayMessage(error: any): string {
    if (!error) return '';

    if (typeof error === 'string') {
      return error;
    }

    const errorInfo = error instanceof HttpErrorResponse ? this.parseHttpError(error) : (error as ErrorInfo);

    return errorInfo.message || 'An unexpected error occurred';
  }
}
