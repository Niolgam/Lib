import { Permission, PermissionAction, PermissionGroup } from './permission.model';

export interface Module {
  id: string;
  name: string;
  description: string;
  code: string;
  isActive: boolean;
  uiRoute?: string;
  icon?: string;
}

export interface Role {
  id: string;
  name: string;
  description?: string;
  moduleId: string;
  isSystemRole: boolean;
  isActive: boolean;
  permissionAssignments: RolePermissionAssignment[];
  createdAt: Date;
  updatedAt: Date;
}

export interface RolePermissionAssignment {
  permissionId: string;
  actions: PermissionAction;
}

export interface UserRoleAssignment {
  userId: string;
  moduleId: string;
  roleId: string;
  createdAt: Date;
  assignedBy?: string;
}

export interface RoleState {
  roles: Role[];
  modules: Module[];
  permissions: Permission[];
  permissionGroups: PermissionGroup[];
  loading: boolean;
  error: string | null;
}
