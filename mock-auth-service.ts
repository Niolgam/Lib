import { Injectable } from '@angular/core';
import { MockDataService } from './mock-data.service';
import { Observable } from 'rxjs';
import { LoginCredentials, AuthToken } from '../models';

/**
 * Serviço que utiliza o MockDataService para sobrescrever o AuthService real
 * Utilizado para testes e desenvolvimento sem backend
 */
@Injectable()
export class MockAuthService {
  constructor(private mockDataService: MockDataService) {}

  /**
   * Login de usuário
   */
  login(credentials: LoginCredentials): Observable<any> {
    return this.mockDataService.loginUser(credentials.username, credentials.password);
  }

  /**
   * Logout de usuário
   */
  logout(): Observable<any> {
    return this.mockDataService.logout();
  }

  /**
   * Renovação de token
   */
  refreshToken(): Observable<AuthToken | any> {
    return this.mockDataService.refreshToken();
  }

  /**
   * Verificação de status de autenticação
   */
  verifyAuthStatus(): Observable<boolean> {
    return this.mockDataService.checkAuthStatus();
  }
}
