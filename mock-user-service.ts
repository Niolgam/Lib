import { Injectable } from '@angular/core';
import { MockDataService } from './mock-data.service';
import { Observable } from 'rxjs';
import { User } from '../models';

/**
 * Serviço que utiliza o MockDataService para sobrescrever o UserService real
 * Utilizado para testes e desenvolvimento sem backend
 */
@Injectable()
export class MockUserService {
  constructor(private mockDataService: MockDataService) {}

  /**
   * Busca usuários com paginação e filtros
   */
  getUsers(page: number = 1, pageSize: number = 10, filters?: any): Observable<{ users: User[]; total: number }> {
    return this.mockDataService.getUsers(page, pageSize, filters);
  }

  /**
   * Busca usuário por ID
   */
  getUserById(id: string): Observable<User> {
    return this.mockDataService.getUserById(id);
  }

  /**
   * Cria novo usuário
   */
  createUser(userData: Partial<User>): Observable<User> {
    return this.mockDataService.createUser(userData);
  }

  /**
   * Atualiza usuário existente
   */
  updateUser(id: string, userData: Partial<User>): Observable<User> {
    return this.mockDataService.updateUser(id, userData);
  }

  /**
   * Remove usuário
   */
  deleteUser(id: string): Observable<void> {
    return this.mockDataService.deleteUser(id);
  }

  /**
   * Atribui papel ao usuário
   */
  assignRole(userId: string, moduleId: string, role: string): Observable<User> {
    return this.mockDataService.assignRole(userId, moduleId, role);
  }

  /**
   * Remove papel do usuário
   */
  removeRole(userId: string, moduleId: string, roleId: string): Observable<User> {
    return this.mockDataService.removeRole(userId, moduleId, roleId);
  }
}
