import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthConfigService } from './auth-config.service';
import { LoggingService } from '@vai/services';
import { SecurityMonitorService } from './security-monitor.service';
import { User, UserRoleAssignmentInfo } from '@auth/data-access';

export interface UserFilters {
  search?: string;
  active?: boolean | null;
  roleId?: string | null;
  moduleId?: string | null;
}

/**
 * Serviço para gerenciamento de usuários
 * Implementa CRUD de usuários e gerenciamento de papéis
 */
@Injectable({
  providedIn: 'root',
})
export class UserService {
  private http = inject(HttpClient);
  private authConfigService = inject(AuthConfigService);
  private loggingService = inject(LoggingService);
  private securityMonitor = inject(SecurityMonitorService);

  /**
   * Constrói URL para endpoints de usuário
   * @private
   */
  private _buildUrl(pathSuffix = ''): string | null {
    const baseUrl = this.authConfigService.effectiveUserManagementApiBaseUrl(); // Ex: https://api.com/v1
    const usersPath = this.authConfigService.usersBasePath(); // Ex: /users ou /admin/users

    if (!baseUrl || !usersPath) {
      this.loggingService.error('UserService: User Management API Base URL ou Users Base Path não configurado.');
      return null;
    }

    const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const cleanPathSuffix = pathSuffix.startsWith('/') ? pathSuffix : pathSuffix ? `/${pathSuffix}` : '';

    return `${cleanBaseUrl}${usersPath}${cleanPathSuffix}`;
  }

  /**
   * Lista usuários com paginação e filtros
   */
  getUsers(page = 1, pageSize = 10, filters?: UserFilters): Observable<{ users: User[]; total: number }> {
    const url = this._buildUrl(); // Path para listar usuários (ex: /api/management/users)
    if (!url) return throwError(() => new Error('URL para getUsers não pôde ser construída.'));

    let params = new HttpParams().set('page', String(page)).set('limit', String(pageSize));
    if (filters) {
      if (filters.search) params = params.set('search', filters.search);
      if (filters.active !== null && filters.active !== undefined) params = params.set('active', String(filters.active));
      if (filters.roleId) params = params.set('roleId', filters.roleId);
      if (filters.moduleId) params = params.set('moduleId', filters.moduleId);
    }

    // Headers adicionados pelo interceptor, não é necessário adicionar aqui
    return this.http
      .get<{ users: User[]; total: number }>(url, {
        params,
        withCredentials: true,
      })
      .pipe(
        catchError((error) => {
          this.loggingService.error('Erro ao buscar usuários', { error });
          return throwError(() => error);
        }),
      );
  }

  /**
   * Busca usuário pelo ID
   */
  getUserById(id: string): Observable<User> {
    const url = this._buildUrl(`/${id}`);
    if (!url) return throwError(() => new Error('URL para getUserById não pôde ser construída.'));

    // Headers adicionados pelo interceptor, não é necessário adicionar aqui
    return this.http
      .get<User>(url, {
        withCredentials: true,
      })
      .pipe(
        catchError((error) => {
          this.loggingService.error('Erro ao buscar usuário por ID', { id, error });
          return throwError(() => error);
        }),
      );
  }

  /**
   * Cria novo usuário
   */
  createUser(userData: Partial<User>): Observable<User> {
    const url = this._buildUrl();
    if (!url) return throwError(() => new Error('URL para createUser não pôde ser construída.'));

    // Headers adicionados pelo interceptor, não é necessário adicionar aqui
    // Registra evento de segurança - criação de usuário é operação sensível
    this.securityMonitor.logSecurityEvent('user.create_attempt', 'info', { email: userData.email });

    return this.http
      .post<User>(url, userData, {
        withCredentials: true,
      })
      .pipe(
        catchError((error) => {
          this.loggingService.error('Erro ao criar usuário', { userData, error });
          return throwError(() => error);
        }),
      );
  }

  /**
   * Atualiza usuário existente
   */
  updateUser(id: string, userData: Partial<User>): Observable<User> {
    const url = this._buildUrl(`/${id}`);
    if (!url) return throwError(() => new Error('URL para updateUser não pôde ser construída.'));

    // Headers adicionados pelo interceptor, não é necessário adicionar aqui
    // Registra evento de segurança - atualização de usuário é operação sensível
    this.securityMonitor.logSecurityEvent('user.update_attempt', 'info', { userId: id });

    return this.http
      .put<User>(url, userData, {
        withCredentials: true,
      })
      .pipe(
        catchError((error) => {
          this.loggingService.error('Erro ao atualizar usuário', { id, userData, error });
          return throwError(() => error);
        }),
      );
  }

  /**
   * Remove usuário
   */
  deleteUser(id: string): Observable<any> {
    const url = this._buildUrl(`/${id}`);
    if (!url) return throwError(() => new Error('URL para deleteUser não pôde ser construída.'));

    // Headers adicionados pelo interceptor, não é necessário adicionar aqui
    // Registra evento de segurança - remoção de usuário é operação crítica
    this.securityMonitor.logSecurityEvent('user.delete_attempt', 'warning', { userId: id });

    return this.http
      .delete<any>(url, {
        withCredentials: true,
      })
      .pipe(
        catchError((error) => {
          this.loggingService.error('Erro ao excluir usuário', { id, error });
          return throwError(() => error);
        }),
      );
  }

  /**
   * Atribui papel a um usuário
   */
  assignRole(userId: string, moduleId: string, role: string): Observable<User> {
    // 'role' aqui é o nome/código do papel
    const url = this._buildUrl(`/${userId}/roles`);
    if (!url) return throwError(() => new Error('URL para assignRole não pôde ser construída.'));

    // Headers adicionados pelo interceptor, não é necessário adicionar aqui
    // Registra evento de segurança - atribuição de papel é operação sensível
    this.securityMonitor.logSecurityEvent('user.role_assign_attempt', 'info', { userId, moduleId, role });

    return this.http
      .post<User>(
        url,
        { moduleId, role },
        {
          withCredentials: true,
        },
      )
      .pipe(
        catchError((error) => {
          this.loggingService.error('Erro ao atribuir papel ao usuário', { userId, moduleId, role, error });
          return throwError(() => error);
        }),
      );
  }

  /**
   * Remove papel de um usuário
   */
  removeRole(userId: string, moduleId: string, roleId: string): Observable<User> {
    // Corrigindo a URL com formato errado
    const url = this._buildUrl(`/${userId}/roles/${roleId}?moduleId=${moduleId}`);
    if (!url) return throwError(() => new Error('URL para removeRole não pôde ser construída.'));

    // Headers adicionados pelo interceptor, não é necessário adicionar aqui
    // Registra evento de segurança - remoção de papel é operação sensível
    this.securityMonitor.logSecurityEvent('user.role_remove_attempt', 'info', { userId, moduleId, roleId });

    return this.http
      .delete<User>(url, {
        withCredentials: true,
      })
      .pipe(
        catchError((error) => {
          this.loggingService.error('Erro ao remover papel do usuário', { userId, moduleId, roleId, error });
          return throwError(() => error);
        }),
      );
  }

  /**
   * Atualiza perfil de usuário - por administrador
   */
  updateUserProfileByAdmin(userId: string, userData: Partial<User>): Observable<User> {
    const url = this._buildUrl(`/${userId}/profile`);
    if (!url) return throwError(() => new Error('URL para updateUserProfileByAdmin não pôde ser construída.'));

    // Headers adicionados pelo interceptor, não é necessário adicionar aqui
    // Registra evento de segurança - alteração de perfil por admin é operação sensível
    this.securityMonitor.logSecurityEvent('user.admin_profile_update', 'warning', { userId, fields: Object.keys(userData) });

    return this.http
      .put<User>(url, userData, {
        withCredentials: true,
      })
      .pipe(
        catchError((error) => {
          this.loggingService.error('Erro ao atualizar perfil de usuário (admin)', { userId, userData, error });
          return throwError(() => error);
        }),
      );
  }

  /**
   * Atualiza os papéis de um usuário
   * @param userId ID do usuário
   * @param roles Lista de papéis para atribuir
   */
  updateUserRoles(userId: string, roles: UserRoleAssignmentInfo[]): Observable<User> {
    const url = this._buildUrl(`/${userId}/roles/batch`);
    if (!url) return throwError(() => new Error('URL para updateUserRoles não pôde ser construída.'));

    // Registra evento de segurança - atualização em lote de papéis é operação sensível
    this.securityMonitor.logSecurityEvent('user.roles_batch_update', 'warning', {
      userId,
      roleCount: roles.length,
      modules: [...new Set(roles.map((r) => r.moduleId))],
    });

    return this.http
      .put<User>(
        url,
        { roles },
        {
          withCredentials: true,
        },
      )
      .pipe(
        catchError((error) => {
          this.loggingService.error('Erro ao atualizar papéis do usuário', { userId, roles, error });
          return throwError(() => error);
        }),
      );
  }
}
