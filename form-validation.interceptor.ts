// form-validation.interceptor.ts
import { Injectable } from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpInterceptor, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { FormValidationCacheService } from './form-validation-cache.service';
import { ErrorHandlingService } from '@vai/services';

/**
 * Interceptor especializado para processar erros de validação de formulários
 * retornados pelo servidor e integrá-los ao sistema de formulários do cliente
 */
@Injectable()
export class FormValidationInterceptor implements HttpInterceptor {
  // Padrões de URLs para identificar endpoints de formulários
  private readonly FORM_ENDPOINTS_PATTERNS = [/\/api\/v\d+\/form/, /\/api\/v\d+\/submit/, /\/api\/v\d+\/validate/];

  constructor(
    private formValidationCache: FormValidationCacheService,
    private errorHandler: ErrorHandlingService,
  ) {}

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    // Verificar se a requisição é relacionada a formulários
    const isFormEndpoint = this.isFormRelatedRequest(request);

    // Se não for um endpoint de formulário, apenas passar adiante
    if (!isFormEndpoint) {
      return next.handle(request);
    }

    // Para endpoints de formulário, adicionar headers específicos
    const formRequest = this.addFormHeaders(request);

    return next.handle(formRequest).pipe(
      // Capturar dados válidos para cache
      tap((event) => {
        if (event.type === 4 && this.isValidationResponse(request)) {
          // HttpEventType.Response = 4
          this.processValidResponse(request, event);
        }
      }),
      // Processar erros de validação
      catchError((error: HttpErrorResponse) => {
        if (this.isValidationError(error)) {
          return this.handleValidationError(error, request);
        }
        return throwError(() => error);
      }),
    );
  }

  /**
   * Verifica se a requisição está relacionada a formulários
   */
  private isFormRelatedRequest(request: HttpRequest<unknown>): boolean {
    const url = request.url;
    return this.FORM_ENDPOINTS_PATTERNS.some((pattern) => pattern.test(url));
  }

  /**
   * Adiciona headers específicos para requisições de formulário
   */
  private addFormHeaders(request: HttpRequest<unknown>): HttpRequest<unknown> {
    return request.clone({
      setHeaders: {
        'X-Form-Client-Validation': 'true',
        'X-Form-Version': '1.0.0',
      },
    });
  }

  /**
   * Verifica se é uma resposta de validação
   */
  private isValidationResponse(request: HttpRequest<unknown>): boolean {
    return request.url.includes('/validate') || request.method === 'GET';
  }

  /**
   * Processa resposta válida para possível cache
   */
  private processValidResponse(request: HttpRequest<unknown>, response: any): void {
    // Extrair informações da requisição para criar chave de cache
    const url = request.url;
    const method = request.method;
    const body = request.body;

    // Verificar se os dados podem ser cacheados
    if (this.isCacheable(request, response)) {
      const cacheKey = this.generateCacheKey(url, method, body);
      this.formValidationCache.storeValidationResult(cacheKey, response.body, {
        expires: this.calculateExpiryTime(response),
      });
    }
  }

  /**
   * Determina se uma resposta pode ser cacheada
   */
  private isCacheable(request: HttpRequest<unknown>, response: any): boolean {
    // Verificar cache-control headers
    const cacheControl = response.headers?.get('cache-control');
    if (cacheControl && cacheControl.includes('no-store')) {
      return false;
    }

    // Apenas cache GETs e validações específicas
    return request.method === 'GET' || request.url.includes('/validate');
  }

  /**
   * Gera uma chave de cache baseada na requisição
   */
  private generateCacheKey(url: string, method: string, body: any): string {
    const bodyHash = body ? this.hashObject(body) : '';
    return `${method}:${url}:${bodyHash}`;
  }

  /**
   * Cria um hash simples de um objeto para uso em chaves de cache
   */
  private hashObject(obj: any): string {
    return btoa(JSON.stringify(obj)).substring(0, 24);
  }

  /**
   * Calcula o tempo de expiração do cache baseado na resposta
   */
  private calculateExpiryTime(response: any): number {
    // Verificar se o servidor especificou um tempo de cache
    const cacheControl = response.headers?.get('cache-control');
    if (cacheControl && cacheControl.includes('max-age=')) {
      const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
      if (maxAgeMatch && maxAgeMatch[1]) {
        return Date.now() + parseInt(maxAgeMatch[1]) * 1000;
      }
    }

    // Padrão: 1 hora
    return Date.now() + 60 * 60 * 1000;
  }

  /**
   * Verifica se é um erro de validação
   */
  private isValidationError(error: HttpErrorResponse): boolean {
    return error.status === 422 || (error.status === 400 && error.error && (error.error.validationErrors || error.error.errors));
  }

  /**
   * Manipula erros de validação
   */
  private handleValidationError(error: HttpErrorResponse, request: HttpRequest<unknown>): Observable<never> {
    // Estruturar os erros de validação em um formato consistente
    const validationErrors = this.normalizeValidationErrors(error);

    // Armazenar no cache para uso futuro
    const cacheKey = this.generateCacheKey(request.url, request.method, request.body);
    this.formValidationCache.storeValidationErrors(cacheKey, validationErrors);

    // Criar um erro estruturado
    const structuredError = this.errorHandler.parseHttpError(error);

    // Enriquecer com informações adicionais
    structuredError.details = {
      ...structuredError.details,
      formValidation: true,
      validationErrors,
    };

    return throwError(() => structuredError);
  }

  /**
   * Normaliza os erros de validação para um formato padrão
   */
  private normalizeValidationErrors(error: HttpErrorResponse): Record<string, string> {
    const normalized: Record<string, string> = {};

    // Extrair erros do corpo da resposta
    const errorBody = error.error;

    if (errorBody) {
      // Formato 1: { validationErrors: { field: "message" } }
      if (errorBody.validationErrors) {
        Object.entries(errorBody.validationErrors).forEach(([field, message]) => {
          normalized[field] = message as string;
        });
      }
      // Formato 2: { errors: { field: "message" } }
      else if (errorBody.errors) {
        Object.entries(errorBody.errors).forEach(([field, message]) => {
          normalized[field] = message as string;
        });
      }
      // Formato 3: { field: { message: "error" } }
      else {
        Object.entries(errorBody).forEach(([field, value]) => {
          if (typeof value === 'object' && value !== null && 'message' in value) {
            normalized[field] = (value as any).message;
          }
        });
      }
    }

    return normalized;
  }
}
