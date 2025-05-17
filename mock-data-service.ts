import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { delay } from 'rxjs/operators';
import { User, Role, Module, Permission, PermissionGroup } from '../models';

/**
 * Serviço para prover dados mockados para a aplicação
 * Simula chamadas HTTP a um backend
 */
@Injectable({ providedIn: 'root' })
export class MockDataService {
  // Delay padrão para simular latência de rede
  private readonly DEFAULT_DELAY = 300;

  // Mock de dados de usuários
  private users: User[] = [
    {
      id: '1',
      name: 'Admin User',
      email: 'admin@example.com',
      cpf: '111.111.111-11',
      roles: [{ moduleId: 'core', role: 'admin' }],
      isActive: true,
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-01'),
      lastLogin: new Date('2023-05-10')
    },
    {
      id: '2',
      name: 'Manager User',
      email: 'manager@example.com',
      cpf: '222.222.222-22',
      roles: [
        { moduleId: 'users', role: 'manager' },
        { moduleId: 'reports', role: 'creator' }
      ],
      isActive: true,
      createdAt: new Date('2023-01-15'),
      updatedAt: new Date('2023-03-20'),
      lastLogin: new Date('2023-05-15')
    },
    {
      id: '3',
      name: 'Editor User',
      email: 'editor@example.com',
      cpf: '333.333.333-33',
      roles: [
        { moduleId: 'content', role: 'editor' },
        { moduleId: 'reports', role: 'viewer' }
      ],
      isActive: true,
      createdAt: new Date('2023-02-10'),
      updatedAt: new Date('2023-04-05'),
      lastLogin: new Date('2023-05-12')
    },
    {
      id: '4',
      name: 'Viewer User',
      email: 'viewer@example.com',
      cpf: '444.444.444-44',
      roles: [
        { moduleId: 'content', role: 'viewer' },
        { moduleId: 'reports', role: 'viewer' }
      ],
      isActive: true,
      createdAt: new Date('2023-03-01'),
      updatedAt: new Date('2023-03-01'),
      lastLogin: new Date('2023-05-08')
    },
    {
      id: '5',
      name: 'Inactive User',
      email: 'inactive@example.com',
      cpf: '555.555.555-55',
      roles: [{ moduleId: 'users', role: 'viewer' }],
      isActive: false,
      createdAt: new Date('2023-01-20'),
      updatedAt: new Date('2023-04-10'),
      lastLogin: new Date('2023-04-10')
    }
  ];

  // Mock de dados de módulos
  private modules: Module[] = [
    {
      id: 'core',
      name: 'Core',
      description: 'Core system functionality',
      code: 'core',
      isActive: true,
      uiRoute: '/admin',
      icon: 'settings'
    },
    {
      id: 'users',
      name: 'User Management',
      description: 'User and role management',
      code: 'users',
      isActive: true,
      uiRoute: '/admin/users',
      icon: 'people'
    },
    {
      id: 'content',
      name: 'Content Management',
      description: 'Content creation and management',
      code: 'content',
      isActive: true,
      uiRoute: '/content',
      icon: 'article'
    },
    {
      id: 'reports',
      name: 'Reports',
      description: 'Analytics and reporting',
      code: 'reports',
      isActive: true,
      uiRoute: '/reports',
      icon: 'bar_chart'
    },
    {
      id: 'settings',
      name: 'Settings',
      description: 'System settings and configurations',
      code: 'settings',
      isActive: true,
      uiRoute: '/settings',
      icon: 'tune'
    }
  ];

  // Mock de permissões
  private permissions: Permission[] = [
    // Core module permissions
    { id: 'perm_core_1', name: 'Access Admin Panel', description: 'Access to admin panel', code: 'access_admin', moduleId: 'core' },
    { id: 'perm_core_2', name: 'Manage System Settings', description: 'Manage system-wide settings', code: 'manage_settings', moduleId: 'core' },
    { id: 'perm_core_3', name: 'View Audit Logs', description: 'View system audit logs', code: 'view_logs', moduleId: 'core' },
    
    // Users module permissions
    { id: 'perm_users_1', name: 'View Users', description: 'View user list and details', code: 'view_users', moduleId: 'users' },
    { id: 'perm_users_2', name: 'Create Users', description: 'Create new users', code: 'create_users', moduleId: 'users' },
    { id: 'perm_users_3', name: 'Edit Users', description: 'Edit existing users', code: 'edit_users', moduleId: 'users' },
    { id: 'perm_users_4', name: 'Delete Users', description: 'Delete users from the system', code: 'delete_users', moduleId: 'users' },
    { id: 'perm_users_5', name: 'Manage Roles', description: 'Assign and manage user roles', code: 'manage_roles', moduleId: 'users' },
    
    // Content module permissions
    { id: 'perm_content_1', name: 'View Content', description: 'View content items', code: 'view_content', moduleId: 'content' },
    { id: 'perm_content_2', name: 'Create Content', description: 'Create new content', code: 'create_content', moduleId: 'content' },
    { id: 'perm_content_3', name: 'Edit Content', description: 'Edit existing content', code: 'edit_content', moduleId: 'content' },
    { id: 'perm_content_4', name: 'Delete Content', description: 'Delete content items', code: 'delete_content', moduleId: 'content' },
    { id: 'perm_content_5', name: 'Publish Content', description: 'Publish content to live', code: 'publish_content', moduleId: 'content' },
    
    // Reports module permissions
    { id: 'perm_reports_1', name: 'View Reports', description: 'View reports and analytics', code: 'view_reports', moduleId: 'reports' },
    { id: 'perm_reports_2', name: 'Create Reports', description: 'Create new reports', code: 'create_reports', moduleId: 'reports' },
    { id: 'perm_reports_3', name: 'Export Reports', description: 'Export reports to various formats', code: 'export_reports', moduleId: 'reports' },
    
    // Settings module permissions
    { id: 'perm_settings_1', name: 'View Settings', description: 'View system settings', code: 'view_settings', moduleId: 'settings' },
    { id: 'perm_settings_2', name: 'Edit Settings', description: 'Edit system settings', code: 'edit_settings', moduleId: 'settings' }
  ];

  // Mock de grupos de permissões
  private permissionGroups: PermissionGroup[] = [
    {
      id: 'pg_core_1',
      name: 'Administration',
      description: 'Core admin functionality',
      moduleId: 'core',
      permissions: this.permissions.filter(p => p.moduleId === 'core')
    },
    {
      id: 'pg_users_1',
      name: 'User Management',
      description: 'User-related permissions',
      moduleId: 'users',
      permissions: this.permissions.filter(p => p.moduleId === 'users')
    },
    {
      id: 'pg_content_1',
      name: 'Content Management',
      description: 'Content-related permissions',
      moduleId: 'content',
      permissions: this.permissions.filter(p => p.moduleId === 'content')
    },
    {
      id: 'pg_reports_1',
      name: 'Reporting',
      description: 'Report-related permissions',
      moduleId: 'reports',
      permissions: this.permissions.filter(p => p.moduleId === 'reports')
    },
    {
      id: 'pg_settings_1',
      name: 'Settings Management',
      description: 'Settings-related permissions',
      moduleId: 'settings',
      permissions: this.permissions.filter(p => p.moduleId === 'settings')
    }
  ];

  // Mock de papéis (roles)
  private roles: Role[] = [
    // Core roles
    {
      id: 'role_core_admin',
      name: 'admin',
      description: 'System Administrator',
      moduleId: 'core',
      isSystemRole: true,
      isActive: true,
      permissionAssignments: this.permissions
        .filter(p => p.moduleId === 'core')
        .map(p => ({
          permissionId: p.id,
          actions: { view: true, create: true, update: true, delete: true, approve: true, export: true, import: true }
        })),
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-01')
    },
    
    // Users module roles
    {
      id: 'role_users_manager',
      name: 'manager',
      description: 'User Manager',
      moduleId: 'users',
      isSystemRole: true,
      isActive: true,
      permissionAssignments: this.permissions
        .filter(p => p.moduleId === 'users')
        .map(p => ({
          permissionId: p.id,
          actions: { view: true, create: true, update: true, delete: true, approve: true, export: true, import: true }
        })),
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-01')
    },
    {
      id: 'role_users_creator',
      name: 'creator',
      description: 'Can create users',
      moduleId: 'users',
      isSystemRole: true,
      isActive: true,
      permissionAssignments: this.permissions
        .filter(p => p.moduleId === 'users')
        .map(p => ({
          permissionId: p.id,
          actions: { 
            view: true, 
            create: true, 
            update: p.code !== 'delete_users' && p.code !== 'manage_roles', 
            delete: false, 
            approve: false, 
            export: true, 
            import: false 
          }
        })),
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-01')
    },
    {
      id: 'role_users_viewer',
      name: 'viewer',
      description: 'View only access for users',
      moduleId: 'users',
      isSystemRole: true,
      isActive: true,
      permissionAssignments: this.permissions
        .filter(p => p.moduleId === 'users' && p.code === 'view_users')
        .map(p => ({
          permissionId: p.id,
          actions: { view: true, create: false, update: false, delete: false, approve: false, export: true, import: false }
        })),
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-01')
    },
    
    // Content module roles
    {
      id: 'role_content_manager',
      name: 'manager',
      description: 'Content Manager',
      moduleId: 'content',
      isSystemRole: true,
      isActive: true,
      permissionAssignments: this.permissions
        .filter(p => p.moduleId === 'content')
        .map(p => ({
          permissionId: p.id,
          actions: { view: true, create: true, update: true, delete: true, approve: true, export: true, import: true }
        })),
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-01')
    },
    {
      id: 'role_content_creator',
      name: 'creator',
      description: 'Content Creator',
      moduleId: 'content',
      isSystemRole: true,
      isActive: true,
      permissionAssignments: this.permissions
        .filter(p => p.moduleId === 'content')
        .map(p => ({
          permissionId: p.id,
          actions: { 
            view: true, 
            create: true, 
            update: true, 
            delete: p.code !== 'publish_content', 
            approve: false, 
            export: true, 
            import: false 
          }
        })),
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-01')
    },
    {
      id: 'role_content_editor',
      name: 'editor',
      description: 'Content Editor',
      moduleId: 'content',
      isSystemRole: true,
      isActive: true,
      permissionAssignments: this.permissions
        .filter(p => p.moduleId === 'content')
        .map(p => ({
          permissionId: p.id,
          actions: { 
            view: true, 
            create: false, 
            update: true, 
            delete: false, 
            approve: p.code === 'publish_content', 
            export: true, 
            import: false 
          }
        })),
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-01')
    },
    {
      id: 'role_content_viewer',
      name: 'viewer',
      description: 'Content Viewer',
      moduleId: 'content',
      isSystemRole: true,
      isActive: true,
      permissionAssignments: this.permissions
        .filter(p => p.moduleId === 'content' && p.code === 'view_content')
        .map(p => ({
          permissionId: p.id,
          actions: { view: true, create: false, update: false, delete: false, approve: false, export: true, import: false }
        })),
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-01')
    },
    
    // Reports module roles
    {
      id: 'role_reports_manager',
      name: 'manager',
      description: 'Reports Manager',
      moduleId: 'reports',
      isSystemRole: true,
      isActive: true,
      permissionAssignments: this.permissions
        .filter(p => p.moduleId === 'reports')
        .map(p => ({
          permissionId: p.id,
          actions: { view: true, create: true, update: true, delete: true, approve: true, export: true, import: true }
        })),
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-01')
    },
    {
      id: 'role_reports_creator',
      name: 'creator',
      description: 'Reports Creator',
      moduleId: 'reports',
      isSystemRole: true,
      isActive: true,
      permissionAssignments: this.permissions
        .filter(p => p.moduleId === 'reports')
        .map(p => ({
          permissionId: p.id,
          actions: { view: true, create: true, update: true, delete: false, approve: false, export: true, import: false }
        })),
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-01')
    },
    {
      id: 'role_reports_viewer',
      name: 'viewer',
      description: 'Reports Viewer',
      moduleId: 'reports',
      isSystemRole: true,
      isActive: true,
      permissionAssignments: this.permissions
        .filter(p => p.moduleId === 'reports' && p.code === 'view_reports')
        .map(p => ({
          permissionId: p.id,
          actions: { view: true, create: false, update: false, delete: false, approve: false, export: true, import: false }
        })),
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-01')
    }
  ];

  // Mock de dados de autenticação
  private authData = {
    validCredentials: [
      { username: 'admin@example.com', password: 'admin123' },
      { username: 'manager@example.com', password: 'manager123' },
      { username: 'editor@example.com', password: 'editor123' },
      { username: 'viewer@example.com', password: 'viewer123' }
    ],
    loginAttempts: new Map<string, number>()
  };

  // Métodos para simulação de APIs

  /**
   * Simula login de usuário
   */
  loginUser(username: string, password: string): Observable<any> {
    const credential = this.authData.validCredentials.find(
      cred => cred.username === username && cred.password === password
    );

    if (!credential) {
      // Registra tentativa falha
      const attempts = (this.authData.loginAttempts.get(username) || 0) + 1;
      this.authData.loginAttempts.set(username, attempts);
      
      return throwError(() => ({ 
        message: 'Invalid credentials', 
        code: 'INVALID_CREDENTIALS',
        attempts 
      })).pipe(delay(this.DEFAULT_DELAY));
    }

    // Encontra o usuário correspondente
    const user = this.users.find(u => u.email === username);
    
    if (!user || !user.isActive) {
      return throwError(() => ({ 
        message: user ? 'User is inactive' : 'User not found', 
        code: user ? 'USER_INACTIVE' : 'USER_NOT_FOUND'
      })).pipe(delay(this.DEFAULT_DELAY));
    }

    // Reset tentativas de login
    this.authData.loginAttempts.delete(username);

    // Atualiza data de último login
    user.lastLogin = new Date();

    // Gera token fictício
    const token = {
      accessToken: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIke3VzZXIuaWR9IiwibmFtZSI6IiR7dXNlci5uYW1lfSIsInJvbGVzIjpbXSwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE2MTYyMzkwMjJ9.signature`,
      refreshToken: `refresh_${Math.random().toString(36).substring(2, 15)}`,
      expiresIn: 3600,
      tokenType: 'Bearer',
      issuedAt: new Date().toISOString()
    };

    return of({ 
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        roles: user.roles
      }
    }).pipe(delay(this.DEFAULT_DELAY));
  }

  /**
   * Simula verificação de status de autenticação
   */
  checkAuthStatus(): Observable<{ authenticated: boolean }> {
    // Simulando uma verificação sempre bem-sucedida
    return of({ authenticated: true }).pipe(delay(this.DEFAULT_DELAY));
  }

  /**
   * Simula logout
   */
  logout(): Observable<{ success: boolean }> {
    return of({ success: true }).pipe(delay(this.DEFAULT_DELAY));
  }

  /**
   * Simula renovação de token
   */
  refreshToken(): Observable<any> {
    const token = {
      accessToken: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwicm9sZXMiOltdLCJpYXQiOjE1MTYyMzkwMjIsImV4cCI6MTYxNjIzOTAyMn0.signature_refreshed`,
      refreshToken: `refresh_${Math.random().toString(36).substring(2, 15)}`,
      expiresIn: 3600,
      tokenType: 'Bearer',
      issuedAt: new Date().toISOString()
    };

    return of(token).pipe(delay(this.DEFAULT_DELAY));
  }

  // Métodos para simulação de APIs de usuários

  /**
   * Retorna lista de usuários
   */
  getUsers(page: number, limit: number, filters?: any): Observable<{ users: User[], total: number }> {
    let filteredUsers = [...this.users];
    
    // Aplicar filtros se existirem
    if (filters) {
      if (filters.search) {
        const search = filters.search.toLowerCase();
        filteredUsers = filteredUsers.filter(user => 
          user.name.toLowerCase().includes(search) || 
          user.email.toLowerCase().includes(search)
        );
      }
      
      if (filters.active !== null && filters.active !== undefined) {
        filteredUsers = filteredUsers.filter(user => user.isActive === filters.active);
      }
      
      if (filters.roleId) {
        filteredUsers = filteredUsers.filter(user => 
          user.roles.some(r => r.role === filters.roleId)
        );
      }
      
      if (filters.moduleId) {
        filteredUsers = filteredUsers.filter(user => 
          user.roles.some(r => r.moduleId === filters.moduleId)
        );
      }
    }
    
    // Calcula total após filtrar
    const total = filteredUsers.length;
    
    // Aplica paginação
    const startIndex = (page - 1) * limit;
    const paginatedUsers = filteredUsers.slice(startIndex, startIndex + limit);
    
    return of({ users: paginatedUsers, total }).pipe(delay(this.DEFAULT_DELAY));
  }

  /**
   * Retorna usuário por ID
   */
  getUserById(id: string): Observable<User> {
    const user = this.users.find(u => u.id === id);
    
    if (!user) {
      return throwError(() => ({ 
        message: 'User not found', 
        code: 'USER_NOT_FOUND' 
      })).pipe(delay(this.DEFAULT_DELAY));
    }
    
    return of(user).pipe(delay(this.DEFAULT_DELAY));
  }

  /**
   * Cria novo usuário
   */
  createUser(userData: Partial<User>): Observable<User> {
    // Verifica se email já existe
    if (this.users.some(u => u.email === userData.email)) {
      return throwError(() => ({ 
        message: 'Email already in use', 
        code: 'EMAIL_ALREADY_EXISTS' 
      })).pipe(delay(this.DEFAULT_DELAY));
    }
    
    const newUser: User = {
      id: `${this.users.length + 1}`,
      name: userData.name || '',
      email: userData.email || '',
      cpf: userData.cpf || '',
      roles: userData.roles || [],
      isActive: userData.isActive !== undefined ? userData.isActive : true,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLogin: undefined
    };
    
    this.users.push(newUser);
    
    return of(newUser).pipe(delay(this.DEFAULT_DELAY));
  }

  /**
   * Atualiza usuário existente
   */
  updateUser(id: string, userData: Partial<User>): Observable<User> {
    const index = this.users.findIndex(u => u.id === id);
    
    if (index === -1) {
      return throwError(() => ({ 
        message: 'User not found', 
        code: 'USER_NOT_FOUND' 
      })).pipe(delay(this.DEFAULT_DELAY));
    }
    
    // Verifica se email já está em uso por outro usuário
    if (userData.email && 
        userData.email !== this.users[index].email && 
        this.users.some(u => u.email === userData.email)) {
      return throwError(() => ({ 
        message: 'Email already in use', 
        code: 'EMAIL_ALREADY_EXISTS' 
      })).pipe(delay(this.DEFAULT_DELAY));
    }
    
    // Atualiza usuário
    const updatedUser = {
      ...this.users[index],
      ...userData,
      updatedAt: new Date()
    };
    
    this.users[index] = updatedUser;
    
    return of(updatedUser).pipe(delay(this.DEFAULT_DELAY));
  }

  /**
   * Remove usuário
   */
  deleteUser(id: string): Observable<void> {
    const index = this.users.findIndex(u => u.id === id);
    
    if (index === -1) {
      return throwError(() => ({ 
        message: 'User not found', 
        code: 'USER_NOT_FOUND' 
      })).pipe(delay(this.DEFAULT_DELAY));
    }
    
    this.users.splice(index, 1);
    
    return of(undefined).pipe(delay(this.DEFAULT_DELAY));
  }

  /**
   * Atribui papel ao usuário
   */
  assignRole(userId: string, moduleId: string, roleName: string): Observable<User> {
    const userIndex = this.users.findIndex(u => u.id === userId);
    
    if (userIndex === -1) {
      return throwError(() => ({ 
        message: 'User not found', 
        code: 'USER_NOT_FOUND' 
      })).pipe(delay(this.DEFAULT_DELAY));
    }
    
    // Verifica se o papel existe
    const roleExists = this.roles.some(r => r.moduleId === moduleId && r.name === roleName);
    
    if (!roleExists) {
      return throwError(() => ({ 
        message: 'Role not found', 
        code: 'ROLE_NOT_FOUND' 
      })).pipe(delay(this.DEFAULT_DELAY));
    }
    
    // Verifica se usuário já possui este papel
    const hasRole = this.users[userIndex].roles.some(
      r => r.moduleId === moduleId && r.role === roleName
    );
    
    if (hasRole) {
      return throwError(() => ({ 
        message: 'User already has this role', 
        code: 'ROLE_ALREADY_ASSIGNED' 
      })).pipe(delay(this.DEFAULT_DELAY));
    }
    
    // Adiciona papel
    const updatedUser = {
      ...this.users[userIndex],
      roles: [
        ...this.users[userIndex].roles,
        { moduleId, role: roleName }
      ],
      updatedAt: new Date()
    };
    
    this.users[userIndex] = updatedUser;
    
    return of(updatedUser).pipe(delay(this.DEFAULT_DELAY));
  }

  /**
   * Remove papel do usuário
   */
  removeRole(userId: string, moduleId: string, roleId: string): Observable<User> {
    const userIndex = this.users.findIndex(u => u.id === userId);
    
    if (userIndex === -1) {
      return throwError(() => ({ 
        message: 'User not found', 
        code: 'USER_NOT_FOUND' 
      })).pipe(delay(this.DEFAULT_DELAY));
    }
    
    // Verifica se usuário possui este papel
    const roleIndex = this.users[userIndex].roles.findIndex(
      r => r.moduleId === moduleId && r.role === roleId
    );
    
    if (roleIndex === -1) {
      return throwError(() => ({ 
        message: 'User does not have this role', 
        code: 'ROLE_NOT_ASSIGNED' 
      })).pipe(delay(this.DEFAULT_DELAY));
    }
    
    // Remove papel
    const updatedRoles = [...this.users[userIndex].roles];
    updatedRoles.splice(roleIndex, 1);
    
    const updatedUser = {
      ...this.users[userIndex],
      roles: updatedRoles,
      updatedAt: new Date()
    };
    
    this.users[userIndex] = updatedUser;
    
    return of(updatedUser).pipe(delay(this.DEFAULT_DELAY));
  }

  // Métodos para simulação de APIs de papéis e permissões

  /**
   * Retorna lista de módulos
   */
  getModules(): Observable<Module[]> {
    return of(this.modules).pipe(delay(this.DEFAULT_DELAY));
  }

  /**
   * Retorna papéis por módulo
   */
  getRolesByModule(moduleId: string): Observable<Role[]> {
    const moduleExists = this.modules.some(m => m.id === moduleId);
    
    if (!moduleExists) {
      return throwError(() => ({ 
        message: 'Module not found', 
        code: 'MODULE_NOT_FOUND' 
      })).pipe(delay(this.DEFAULT_DELAY));
    }
    
    const moduleRoles = this.roles.filter(r => r.moduleId === moduleId);
    
    return of(moduleRoles).pipe(delay(this.DEFAULT_DELAY));
  }

  /**
   * Retorna papel por ID
   */
  getRoleById(roleId: string): Observable<Role> {
    const role = this.roles.find(r => r.id === roleId);
    
    if (!role) {
      return throwError(() => ({ 
        message: 'Role not found', 
        code: 'ROLE_NOT_FOUND' 
      })).pipe(delay(this.DEFAULT_DELAY));
    }
    
    return of(role).pipe(delay(this.DEFAULT_DELAY));
  }

  /**
   * Cria novo papel
   */
  createRole(roleData: Partial<Role>): Observable<Role> {
    // Verifica se módulo existe
    if (!this.modules.some(m => m.id === roleData.moduleId)) {
      return throwError(() => ({ 
        message: 'Module not found', 
        code: 'MODULE_NOT_FOUND' 
      })).pipe(delay(this.DEFAULT_DELAY));
    }
    
    // Verifica se já existe um papel com mesmo nome no módulo
    if (this.roles.some(r => 
      r.moduleId === roleData.moduleId && r.name === roleData.name
    )) {
      return throwError(() => ({ 
        message: 'Role already exists in this module', 
        code: 'ROLE_ALREADY_EXISTS' 
      })).pipe(delay(this.DEFAULT_DELAY));
    }
    
    const newRole: Role = {
      id: `role_${roleData.moduleId}_${roleData.name || 'custom'}_${Date.now()}`,
      name: roleData.name || '',
      description: roleData.description || '',
      moduleId: roleData.moduleId || '',
      isSystemRole: roleData.isSystemRole !== undefined ? roleData.isSystemRole : false,
      isActive: roleData.isActive !== undefined ? roleData.isActive : true,
      permissionAssignments: roleData.permissionAssignments || [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    this.roles.push(newRole);
    
    return of(newRole).pipe(delay(this.DEFAULT_DELAY));
  }

  /**
   * Atualiza papel existente
   */
  updateRole(roleId: string, roleData: Partial<Role>): Observable<Role> {
    const index = this.roles.findIndex(r => r.id === roleId);
    
    if (index === -1) {
      return throwError(() => ({ 
        message: 'Role not found', 
        code: 'ROLE_NOT_FOUND' 
      })).pipe(delay(this.DEFAULT_DELAY));
    }
    
    // Verifica se é papel de sistema e está tentando mudar isso
    if (this.roles[index].isSystemRole && roleData.isSystemRole === false) {
      return throwError(() => ({ 
        message: 'Cannot change system role status', 
        code: 'SYSTEM_ROLE_IMMUTABLE' 
      })).pipe(delay(this.DEFAULT_DELAY));
    }
    
    // Atualiza papel
    const updatedRole = {
      ...this.roles[index],
      ...roleData,
      // Preserva valores que não devem ser alterados
      id: this.roles[index].id,
      moduleId: this.roles[index].moduleId,
      isSystemRole: this.roles[index].isSystemRole,
      updatedAt: new Date()
    };
    
    this.roles[index] = updatedRole;
    
    return of(updatedRole).pipe(delay(this.DEFAULT_DELAY));
  }

  /**
   * Remove papel
   */
  deleteRole(roleId: string): Observable<void> {
    const role = this.roles.find(r => r.id === roleId);
    
    if (!role) {
      return throwError(() => ({ 
        message: 'Role not found', 
        code: 'ROLE_NOT_FOUND' 
      })).pipe(delay(this.DEFAULT_DELAY));
    }
    
    // Verifica se é papel de sistema
    if (role.isSystemRole) {
      return throwError(() => ({ 
        message: 'Cannot delete system role', 
        code: 'SYSTEM_ROLE_IMMUTABLE' 
      })).pipe(delay(this.DEFAULT_DELAY));
    }
    
    // Verifica se há usuários com este papel
    const usersWithRole = this.users.some(user => 
      user.roles.some(r => r.moduleId === role.moduleId && r.role === role.name)
    );
    
    if (usersWithRole) {
      return throwError(() => ({ 
        message: 'Cannot delete role with assigned users', 
        code: 'ROLE_HAS_USERS' 
      })).pipe(delay(this.DEFAULT_DELAY));
    }
    
    // Remove papel
    const index = this.roles.findIndex(r => r.id === roleId);
    this.roles.splice(index, 1);
    
    return of(undefined).pipe(delay(this.DEFAULT_DELAY));
  }

  /**
   * Retorna permissões por módulo
   */
  getPermissionsByModule(moduleId: string): Observable<Permission[]> {
    if (!this.modules.some(m => m.id === moduleId)) {
      return throwError(() => ({ 
        message: 'Module not found', 
        code: 'MODULE_NOT_FOUND' 
      })).pipe(delay(this.DEFAULT_DELAY));
    }
    
    const modulePermissions = this.permissions.filter(p => p.moduleId === moduleId);
    
    return of(modulePermissions).pipe(delay(this.DEFAULT_DELAY));
  }

  /**
   * Retorna grupos de permissões por módulo
   */
  getPermissionGroupsByModule(moduleId: string): Observable<PermissionGroup[]> {
    if (!this.modules.some(m => m.id === moduleId)) {
      return throwError(() => ({ 
        message: 'Module not found', 
        code: 'MODULE_NOT_FOUND' 
      })).pipe(delay(this.DEFAULT_DELAY));
    }
    
    const modulePermissionGroups = this.permissionGroups.filter(pg => pg.moduleId === moduleId);
    
    return of(modulePermissionGroups).pipe(delay(this.DEFAULT_DELAY));
  }

  /**
   * Atribui permissões a um papel
   */
  assignPermissionsToRole(roleId: string, permissionAssignments: any[]): Observable<Role> {
    const roleIndex = this.roles.findIndex(r => r.id === roleId);
    
    if (roleIndex === -1) {
      return throwError(() => ({ 
        message: 'Role not found', 
        code: 'ROLE_NOT_FOUND' 
      })).pipe(delay(this.DEFAULT_DELAY));
    }
    
    // Verifica se todas as permissões existem
    const permissionIds = permissionAssignments.map(pa => pa.permissionId);
    const allPermissionsExist = permissionIds.every(id => 
      this.permissions.some(p => p.id === id)
    );
    
    if (!allPermissionsExist) {
      return throwError(() => ({ 
        message: 'One or more permissions not found', 
        code: 'PERMISSION_NOT_FOUND' 
      })).pipe(delay(this.DEFAULT_DELAY));
    }
    
    // Atualiza papel com novas permissões
    const updatedRole = {
      ...this.roles[roleIndex],
      permissionAssignments,
      updatedAt: new Date()
    };
    
    this.roles[roleIndex] = updatedRole;
    
    return of(updatedRole).pipe(delay(this.DEFAULT_DELAY));
  }

  /**
   * Mock para obtenção de token CSRF
   */
  getCsrfToken(): Observable<{ token: string }> {
    return of({ token: `csrf_${Math.random().toString(36).substring(2, 15)}` }).pipe(delay(this.DEFAULT_DELAY));
  }

  /**
   * Retorna dados do usuário atual (autenticado)
   */
  getCurrentUser(): Observable<User> {
    // Simula usuário logado como o primeiro da lista
    return of(this.users[0]).pipe(delay(this.DEFAULT_DELAY));
  }
}
        