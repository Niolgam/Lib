import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthConfigService } from './auth-config.service';
import { LoggingService } from '@vai/services';
import { SecurityMonitorService } from './security-monitor.service';
import { Module, Role, Permission, PermissionGroup, RolePermissionAssignment } from '@auth/data-access';

@Injectable({
  providedIn: 'root',
})
export class RoleService {
  private http = inject(HttpClient);
  private authConfigService = inject(AuthConfigService);
  private loggingService = inject(LoggingService);
  private securityMonitor = inject(SecurityMonitorService);

  /**
   * Constrói URL para endpoints de papéis
   * @private
   */
  private _buildUrl(moduleBasePathValue: string | undefined, pathSuffix = ''): string | null {
    const baseUrl = this.authConfigService.effectiveUserManagementApiBaseUrl();

    if (!baseUrl || !moduleBasePathValue) {
      this.loggingService.error('RoleService: Base URL ou Base Path para Role/Module Management não configurado.');
      return null;
    }

    const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const cleanPathSuffix = pathSuffix.startsWith('/') ? pathSuffix : pathSuffix ? `/${pathSuffix}` : '';

    return `${cleanBaseUrl}${moduleBasePathValue}${cleanPathSuffix}`;
  }

  /**
   * Lista todos os módulos disponíveis
   */
  getModules(): Observable<Module[]> {
    const url = this._buildUrl(this.authConfigService.modulesBasePath());
    if (!url) return throwError(() => new Error('URL para getModules não pôde ser construída.'));

    // Headers adicionados pelo interceptor, não é necessário adicionar aqui
    return this.http
      .get<Module[]>(url, {
        withCredentials: true,
      })
      .pipe(
        catchError((error) => {
          this.loggingService.error('Erro ao obter módulos', { error });
          return throwError(() => error);
        }),
      );
  }

  /**
   * Lista papéis por módulo
   */
  getRolesByModule(moduleId: string): Observable<Role[]> {
    // Path: {effectiveUserManagementApiBaseUrl}{modulesBasePath}/{moduleId}/roles
    const url = this._buildUrl(this.authConfigService.modulesBasePath(), `/${moduleId}/roles`);
    if (!url) return throwError(() => new Error('URL para getRolesByModule não pôde ser construída.'));

    // Headers adicionados pelo interceptor, não é necessário adicionar aqui
    return this.http
      .get<Role[]>(url, {
        withCredentials: true,
      })
      .pipe(
        catchError((error) => {
          this.loggingService.error('Erro ao obter papéis por módulo', { moduleId, error });
          return throwError(() => error);
        }),
      );
  }

  /**
   * Busca papel por ID
   */
  getRoleById(roleId: string): Observable<Role> {
    // Path: {effectiveUserManagementApiBaseUrl}{rolesBasePath}/{roleId}
    const url = this._buildUrl(this.authConfigService.rolesBasePath(), `/${roleId}`);
    if (!url) return throwError(() => new Error('URL para getRoleById não construída.'));

    // Headers adicionados pelo interceptor, não é necessário adicionar aqui
    return this.http
      .get<Role>(url, {
        withCredentials: true,
      })
      .pipe(
        catchError((error) => {
          this.loggingService.error('Erro ao obter papel por ID', { roleId, error });
          return throwError(() => error);
        }),
      );
  }

  /**
   * Cria novo papel
   */
  createRole(roleData: Partial<Role>): Observable<Role> {
    // Renomeado parâmetro para clareza
    const url = this._buildUrl(this.authConfigService.rolesBasePath());
    if (!url) return throwError(() => new Error('URL para createRole não construída.'));

    // Headers adicionados pelo interceptor, não é necessário adicionar aqui
    // Registra evento de segurança - criação de papel é operação sensível
    this.securityMonitor.logSecurityEvent('role.create_attempt', 'warning', { moduleId: roleData.moduleId, name: roleData.name });

    return this.http
      .post<Role>(url, roleData, {
        withCredentials: true,
      })
      .pipe(
        catchError((error) => {
          this.loggingService.error('Erro ao criar papel', { roleData, error });
          return throwError(() => error);
        }),
      );
  }

  /**
   * Atualiza papel existente
   */
  updateRole(roleId: string, roleData: Partial<Role>): Observable<Role> {
    const url = this._buildUrl(this.authConfigService.rolesBasePath(), `/${roleId}`);
    if (!url) return throwError(() => new Error('URL para updateRole não construída.'));

    // Headers adicionados pelo interceptor, não é necessário adicionar aqui
    // Registra evento de segurança - atualização de papel é operação sensível
    this.securityMonitor.logSecurityEvent('role.update_attempt', 'warning', { roleId, moduleId: roleData.moduleId });

    return this.http
      .put<Role>(url, roleData, {
        withCredentials: true,
      })
      .pipe(
        catchError((error) => {
          this.loggingService.error('Erro ao atualizar papel', { roleId, roleData, error });
          return throwError(() => error);
        }),
      );
  }

  /**
   * Remove papel
   */
  deleteRole(roleId: string): Observable<void> {
    const url = this._buildUrl(this.authConfigService.rolesBasePath(), `/${roleId}`);
    if (!url) return throwError(() => new Error('URL para deleteRole não construída.'));

    // Headers adicionados pelo interceptor, não é necessário adicionar aqui
    // Registra evento de segurança - remoção de papel é operação crítica
    this.securityMonitor.logSecurityEvent('role.delete_attempt', 'critical', { roleId });

    return this.http
      .delete<void>(url, {
        withCredentials: true,
      })
      .pipe(
        catchError((error) => {
          this.loggingService.error('Erro ao excluir papel', { roleId, error });
          return throwError(() => error);
        }),
      );
  }

  /**
   * Lista permissões por módulo
   */
  getPermissionsByModule(moduleId: string): Observable<Permission[]> {
    const url = this._buildUrl(this.authConfigService.modulesBasePath(), `/${moduleId}/permissions`);
    if (!url) return throwError(() => new Error('URL para getPermissionsByModule não construída.'));

    // Headers adicionados pelo interceptor, não é necessário adicionar aqui
    return this.http
      .get<Permission[]>(url, {
        withCredentials: true,
      })
      .pipe(
        catchError((error) => {
          this.loggingService.error('Erro ao obter permissões por módulo', { moduleId, error });
          return throwError(() => error);
        }),
      );
  }

  /**
   * Lista grupos de permissões por módulo
   */
  getPermissionGroupsByModule(moduleId: string): Observable<PermissionGroup[]> {
    const url = this._buildUrl(this.authConfigService.modulesBasePath(), `/${moduleId}/permission-groups`);
    if (!url) return throwError(() => new Error('URL para getPermissionGroupsByModule não construída.'));

    // Headers adicionados pelo interceptor, não é necessário adicionar aqui
    return this.http
      .get<PermissionGroup[]>(url, {
        withCredentials: true,
      })
      .pipe(
        catchError((error) => {
          this.loggingService.error('Erro ao obter grupos de permissões', { moduleId, error });
          return throwError(() => error);
        }),
      );
  }

  /**
   * Atribui permissões a um papel
   */
  assignPermissionsToRole(roleId: string, permissionAssignments: RolePermissionAssignment[]): Observable<Role> {
    const url = this._buildUrl(this.authConfigService.rolesBasePath(), `/${roleId}/permissions`);
    if (!url) return throwError(() => new Error('URL para assignPermissionsToRole não construída.'));

    // Headers adicionados pelo interceptor, não é necessário adicionar aqui
    // Registra evento de segurança - atribuição de permissões é operação crítica
    this.securityMonitor.logSecurityEvent('role.permissions_assign_attempt', 'warning', {
      roleId,
      permissionCount: permissionAssignments.length,
    });

    return this.http
      .post<Role>(
        url,
        { permissionAssignments },
        {
          withCredentials: true,
        },
      )
      .pipe(
        catchError((error) => {
          this.loggingService.error('Erro ao atribuir permissões ao papel', { roleId, error });
          return throwError(() => error);
        }),
      );
  }
}
