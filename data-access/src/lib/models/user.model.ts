export type Roles = 'admin' | 'manager' | 'creator' | 'editor' | 'viewer';

export interface UserRoleAssignmentInfo {
  moduleId: string;
  role: Roles;
}

export interface User {
  id: string;
  name: string;
  email: string;
  cpf?: string;
  roles: UserRoleAssignmentInfo[];
  lastLogin?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
