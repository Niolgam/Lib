import { Injectable } from '@angular/core';
import { MockDataService } from './mock-data.service';
import { Observable } from 'rxjs';
import { Role, Module, Permission, PermissionGroup } from '../models';

/**
 * Serviço que utiliza o MockDataService para sobrescrever o RoleService real
 * Utilizado para testes e desenvolvimento sem backend
 */
@Injectable()
export class MockRoleService {
  constructor(private mockDataService: MockDataService) {}

  /**
   * Busca todos os módulos
   */
  getModules(): Observable<Module[]> {
    return this.mockDataService.getModules();
  }

  /**
   * Busca papéis por módulo
   */
  getRolesByModule(moduleId: string): Observable<Role[]> {
    return this.mockDataService.getRolesByModule(moduleId);
  }

  /**
   * Busca papel por ID
   */
  getRoleById(roleId: string): Observable<Role> {
    return this.mockDataService.getRoleById(roleId);
  }

  /**
   * Cria novo papel
   */
  createRole(roleData: Partial<Role>): Observable<Role> {
    return this.mockDataService.createRole(roleData);
  }

  /**
   * Atualiza papel existente
   */
  updateRole(roleId: string, roleData: Partial<Role>): Observable<Role> {
    return this.mockDataService.updateRole(roleId, roleData);
  }

  /**
   * Remove papel
   */
  deleteRole(roleId: string): Observable<void> {
    return this.mockDataService.deleteRole(roleId);
  }

  /**
   * Busca permissões por módulo
   */
  getPermissionsByModule(moduleId: string): Observable<Permission[]> {
    return this.mockDataService.getPermissionsByModule(moduleId);
  }

  /**
   * Busca grupos de permissões por módulo
   */
  getPermissionGroupsByModule(moduleId: string): Observable<PermissionGroup[]> {
    return this.mockDataService.getPermissionGroupsByModule(moduleId);
  }

  /**
   * Atribui permissões a um papel
   */
  assignPermissionsToRole(roleId: string, permissionAssignments: any[]): Observable<Role> {
    return this.mockDataService.assignPermissionsToRole(roleId, permissionAssignments);
  }
}
