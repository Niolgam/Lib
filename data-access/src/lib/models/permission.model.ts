export interface Permission {
  id: string;
  name: string;
  description: string;
  code: string;
  moduleId: string;
}

export interface PermissionGroup {
  id: string;
  name: string;
  description: string;
  moduleId: string;
  permissions: Permission[];
}

export interface PermissionAction {
  view: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
  approve?: boolean;
  export?: boolean;
  import?: boolean;
  [key: string]: boolean | undefined;
}
