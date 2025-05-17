import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { MockDataService } from './mock-data.service';

/**
 * Serviço que utiliza o MockDataService para sobrescrever o CsrfService real
 * Utilizado para testes e desenvolvimento sem backend
 */
@Injectable()
export class MockCsrfService {
  constructor(private mockDataService: MockDataService) {}

  /**
   * Retorna token CSRF
   */
  getToken(): Observable<string> {
    return this.mockDataService.getCsrfToken().pipe(
      // Extrai apenas o token da resposta
      data => of(data.token)
    );
  }

  /**
   * Limpa token CSRF
   */
  clearToken() {
    // Não faz nada em ambiente de mock
  }

  /**
   * Renova token CSRF
   */
  refreshToken(): Observable<string> {
    return this.getToken();
  }
}
