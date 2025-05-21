import { Component, OnInit, input, output, inject, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

import { UserStore, RoleStore, AuthStore } from '@auth/data-access';
import { User, Module, Role } from '@auth/data-access';
import { LoggingService } from '@vai/services';

interface BulkAction {
  id: string;
  label: string;
  icon: string;
  description: string;
  requiresConfirmation: boolean;
  destructive?: boolean;
  permissionRequired?: string;
}

interface BulkActionResult {
  action: string;
  successful: number;
  failed: number;
  errors: Array<{ userId: string; error: string }>;
}

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'user-bulk-actions',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './user-bulk-actions.component.html',
  styleUrls: ['./user-bulk-actions.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserBulkActionsComponent implements OnInit {
  // Injeção de dependências
  private fb = inject(FormBuilder);
  private userStore = inject(UserStore);
  private roleStore = inject(RoleStore);
  private authStore = inject(AuthStore);
  private loggingService = inject(LoggingService);

  readonly selectedUsers = input<User[]>([]);

  readonly actionCompleted = output<BulkActionResult>();
  readonly selectionCleared = output<void>();

  // Signals internos
  readonly isExecuting = signal(false);
  readonly showConfirmation = signal(false);
  readonly currentAction = signal<BulkAction | null>(null);
  readonly actionForm = signal<FormGroup>(this.createForm());
  readonly executionResults = signal<BulkActionResult | null>(null);
  readonly showResults = signal(false);

  // Computed values
  readonly selectedCount = computed(() => this.selectedUsers().length);
  readonly hasSelection = computed(() => this.selectedCount() > 0);

  readonly availableActions = computed((): BulkAction[] => {
    const actions: BulkAction[] = [
      {
        id: 'activate',
        label: 'Activate Users',
        icon: 'user-check',
        description: 'Activate selected users',
        requiresConfirmation: true,
        permissionRequired: 'users:update',
      },
      {
        id: 'deactivate',
        label: 'Deactivate Users',
        icon: 'user-x',
        description: 'Deactivate selected users',
        requiresConfirmation: true,
        destructive: true,
        permissionRequired: 'users:update',
      },
      {
        id: 'assign-role',
        label: 'Assign Role',
        icon: 'user-plus',
        description: 'Assign role to selected users',
        requiresConfirmation: true,
        permissionRequired: 'users:roles',
      },
      {
        id: 'remove-role',
        label: 'Remove Role',
        icon: 'user-minus',
        description: 'Remove role from selected users',
        requiresConfirmation: true,
        destructive: true,
        permissionRequired: 'users:roles',
      },
      {
        id: 'export',
        label: 'Export Users',
        icon: 'download',
        description: 'Export selected users data',
        requiresConfirmation: false,
        permissionRequired: 'users:export',
      },
      {
        id: 'send-notification',
        label: 'Send Notification',
        icon: 'mail',
        description: 'Send notification to selected users',
        requiresConfirmation: true,
        permissionRequired: 'users:notify',
      },
      {
        id: 'reset-password',
        label: 'Reset Passwords',
        icon: 'key',
        description: 'Force password reset for selected users',
        requiresConfirmation: true,
        destructive: true,
        permissionRequired: 'users:password',
      },
      {
        id: 'delete',
        label: 'Delete Users',
        icon: 'trash',
        description: 'Permanently delete selected users',
        requiresConfirmation: true,
        destructive: true,
        permissionRequired: 'users:delete',
      },
    ];

    // Filtrar ações baseadas em permissões
    return actions.filter((action) => {
      if (!action.permissionRequired) return true;

      const [module, permission] = action.permissionRequired.split(':');
      return this.authStore.checkUserHasPermissionForAction(module, permission, 'update');
    });
  });

  readonly filteredActions = computed(() => {
    const users = this.selectedUsers();
    const actions = this.availableActions();

    // Filtrar ações baseadas na seleção atual
    return actions.filter((action) => {
      switch (action.id) {
        case 'activate':
          return users.some((user) => !user.isActive);
        case 'deactivate':
          return users.some((user) => user.isActive);
        default:
          return true;
      }
    });
  });

  readonly availableModules = computed(() => this.roleStore.activeModules());

  readonly availableRoles = computed(() => {
    const moduleId = this.actionForm().get('roleAction.moduleId')?.value;
    if (!moduleId) return [];
    return this.roleStore.rolesByModuleSync(moduleId);
  });

  ngOnInit() {
    // Carregar módulos se necessário
    if (this.availableModules().length === 0) {
      this.roleStore.loadModules();
    }
  }

  private createForm(): FormGroup {
    return this.fb.group({
      roleAction: this.fb.group({
        moduleId: [''],
        roleId: [''],
      }),
      notification: this.fb.group({
        subject: [''],
        message: [''],
        type: ['email'],
      }),
    });
  }

  // Executar ação
  executeAction(actionId: string): void {
    const action = this.availableActions().find((a) => a.id === actionId);
    if (!action) return;

    this.currentAction.set(action);

    if (action.requiresConfirmation) {
      this.showConfirmation.set(true);
    } else {
      this.confirmAction();
    }
  }

  // Confirmar execução da ação
  async confirmAction(): Promise<void> {
    const action = this.currentAction();
    if (!action || this.isExecuting()) return;

    this.showConfirmation.set(false);
    this.isExecuting.set(true);

    try {
      const result = await this.performBulkAction(action);
      this.executionResults.set(result);
      this.showResults.set(true);
      this.actionCompleted.emit(result);

      this.loggingService.info('Bulk action completed', {
        action: action.id,
        successful: result.successful,
        failed: result.failed,
      });

      // Auto-hide results after 10 seconds
      setTimeout(() => {
        this.showResults.set(false);
      }, 10000);
    } catch (error) {
      this.loggingService.error('Bulk action failed', { action: action.id, error });

      const errorResult: BulkActionResult = {
        action: action.id,
        successful: 0,
        failed: this.selectedUsers().length,
        errors: this.selectedUsers().map((user) => ({
          userId: user.id,
          error: 'Operation failed',
        })),
      };

      this.executionResults.set(errorResult);
      this.showResults.set(true);
    } finally {
      this.isExecuting.set(false);
    }
  }

  // Cancelar ação
  cancelAction(): void {
    this.showConfirmation.set(false);
    this.currentAction.set(null);
    this.actionForm.set(this.createForm());
  }

  private async performBulkAction(action: BulkAction): Promise<BulkActionResult> {
    const users = this.selectedUsers();
    const results: BulkActionResult = {
      action: action.id,
      successful: 0,
      failed: 0,
      errors: [],
    };

    for (const user of users) {
      try {
        await this.performSingleAction(action, user);
        results.successful++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          userId: user.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  }

  private async performSingleAction(action: BulkAction, user: User): Promise<void> {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // Simular delay para operações
    await delay(Math.random() * 1000 + 500);

    switch (action.id) {
      case 'activate':
        if (!user.isActive) {
          this.userStore.updateUser({
            userId: user.id,
            data: { isActive: true },
          });
        }
        break;

      case 'deactivate':
        if (user.isActive) {
          this.userStore.updateUser({
            userId: user.id,
            data: { isActive: false },
          });
        }
        break;

      case 'assign-role':
        const assignForm = this.actionForm().get('roleAction');
        const moduleId = assignForm?.get('moduleId')?.value;
        const roleId = assignForm?.get('roleId')?.value;

        if (moduleId && roleId) {
          this.userStore.assignRole({
            userId: user.id,
            moduleId,
            role: roleId,
          });
        }
        break;

      case 'remove-role':
        const removeForm = this.actionForm().get('roleAction');
        const removeModuleId = removeForm?.get('moduleId')?.value;
        const removeRoleId = removeForm?.get('roleId')?.value;

        if (removeModuleId && removeRoleId) {
          this.userStore.removeRole({
            userId: user.id,
            moduleId: removeModuleId,
            roleId: removeRoleId,
          });
        }
        break;

      case 'export':
        // Mock export - em implementação real, geraria arquivo
        this.loggingService.info('Exporting user', { userId: user.id });
        break;

      case 'send-notification':
        // Mock notification - em implementação real, enviaria notificação
        this.loggingService.info('Sending notification to user', { userId: user.id });
        break;

      case 'reset-password':
        // Mock password reset - em implementação real, resetaria senha
        this.loggingService.info('Resetting password for user', { userId: user.id });
        break;

      case 'delete':
        // Simulação com chance de falha para usuários com roles importantes
        if (user.roles.some((r) => r.role === 'admin')) {
          throw new Error('Cannot delete admin user');
        }
        this.userStore.deleteUser(user.id);
        break;

      default:
        throw new Error(`Unknown action: ${action.id}`);
    }
  }

  // Limpar seleção
  clearSelection(): void {
    this.selectionCleared.emit();
  }

  // Fechar resultados
  closeResults(): void {
    this.showResults.set(false);
    this.executionResults.set(null);
  }

  // Getters para o template
  getActionIcon(iconName: string): string {
    const icons: Record<string, string> = {
      'user-check': 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
      'user-x': 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
      'user-plus': 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
      'user-minus': 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
      download: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
      mail: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
      key: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z',
      trash: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
    };
    return icons[iconName] || icons['user-check'];
  }

  // Export dos dados selecionados
  exportSelectedUsers(): void {
    const users = this.selectedUsers();
    const csv = this.convertToCSV(users);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `users-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();

    window.URL.revokeObjectURL(url);

    this.loggingService.info('Users exported', { count: users.length });
  }

  private convertToCSV(users: User[]): string {
    const headers = ['ID', 'Name', 'Email', 'CPF', 'Status', 'Roles', 'Created At'];
    const rows = users.map((user) => [
      user.id,
      user.name,
      user.email,
      user.cpf || '',
      user.isActive ? 'Active' : 'Inactive',
      user.roles.map((r) => `${r.moduleId}:${r.role}`).join('; '),
      user.createdAt.toISOString(),
    ]);

    return [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n');
  }
}
