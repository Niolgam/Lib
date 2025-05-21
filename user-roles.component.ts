import { ChangeDetectionStrategy, Component, OnInit, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { UserStore, RoleStore, Module, Role, UserRoleAssignmentInfo } from '@auth/data-access';
import { computed, effect, signal } from '@angular/core';
import { LoggingService } from '@vai/services';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

interface AssignRoleFormModel {
  moduleId: string | null; // Permitir null para estado inicial
  role: string | null; // Permitir null para estado inicial
}

@Component({
  selector: 'user-roles',
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './user-roles.component.html',
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserRolesComponent implements OnInit {
  @Input({ required: true }) userId!: string;

  private userStore = inject(UserStore);
  private roleStore = inject(RoleStore);
  private fb = inject(FormBuilder);
  private loggingService = inject(LoggingService);
  private destroyRef = inject(DestroyRef);

  readonly user = this.userStore.selectedUser;
  readonly modules = this.roleStore.activeModules;

  assignRoleForm: FormGroup<AssignRoleFormShape>;

  // Chaves dinâmicas para o CallState
  // A chave para assignRole é única para este componente/operação.
  readonly assignCallKey = computed(() => `component_assignRole_${this.userId}`);

  // Signals derivados do CallState do UserStore para a operação de atribuição
  readonly isAssigningRole = computed(() => this.userStore.getCallStatusSignal(this.assignCallKey())() === 'pending');
  readonly assignRoleError = computed(() => this.userStore.getErrorByKeySignal(this.assignCallKey())());

  // Gerenciamento de estado para operações de remoção individuais
  // A chave será `component_removeRole_${this.userId}_${moduleId}_${roleName}`
  readonly removingRoleState = signal<Record<string, boolean>>({});
  readonly removeRoleErrorState = signal<Record<string, string | null>>({});

  readonly showAssignForm = signal(false);

  readonly rolesForSelectedModule = computed(() => {
    const moduleId = this.assignRoleForm.get('moduleId')?.value;
    if (!moduleId) return [];
    return this.roleStore.rolesByModuleSync(moduleId);
  });

  readonly assignedRolesByModule = computed(() => {
    const currentUser = this.user();
    if (!currentUser?.roles) return new Map<string, UserRoleAssignmentInfo[]>();

    const result = new Map<string, UserRoleAssignmentInfo[]>();
    currentUser.roles.forEach((userRole) => {
      const moduleRoles = result.get(userRole.moduleId) || [];
      if (!moduleRoles.some((r) => r.role === userRole.role)) {
        moduleRoles.push(userRole);
      }
      result.set(userRole.moduleId, moduleRoles);
    });
    return result;
  });

  constructor() {
    this.assignRoleForm = this.fb.group<AssignRoleFormShape>({
      moduleId: this.fb.control<string | null>(null, Validators.required),
      role: this.fb.control<string | null>(null, Validators.required),
    });

    // Efeito para limpar erros de remoção quando o usuário é atualizado (indicando sucesso)
    effect(() => {
      this.user(); // Dependência para re-executar o effect
      this.removeRoleErrorState.set({});
    });
  }

  ngOnInit() {
    this.loggingService.debug(`UserRolesComponent initialized for userId: ${this.userId}`);
    if (this.modules().length === 0) {
      this.roleStore.loadModules();
    }
    this.assignRoleForm
      .get('moduleId')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.assignRoleForm.get('role')?.setValue(null);
      });
  }

  toggleAssignForm() {
    this.showAssignForm.update((value) => !value);
    if (!this.showAssignForm()) {
      this.assignRoleForm.reset();
      // Limpar o estado de erro específico desta operação no store, se o store permitir.
      // Ex: this.userStore.clearCallState(this.assignCallKey());
    }
  }

  assignRole() {
    if (this.assignRoleForm.invalid) {
      this.assignRoleForm.markAllAsTouched();
      return;
    }
    const formValue = this.assignRoleForm.getRawValue();
    const moduleId = formValue.moduleId;
    const role = formValue.role;

    if (!moduleId || !role) {
      this.loggingService.warn('Module ID or Role is null in assignRole');
      return;
    }

    this.loggingService.debug(`UI: Attempting to assign role: ${role} in module ${moduleId} to user ${this.userId}`);

    // O UserStore.assignRole DEVE ser um rxMethod que usa trackCall com a chave `this.assignCallKey()`
    // Assim, isAssigningRole e assignRoleError serão atualizados automaticamente.
    this.userStore
      .assignRole({ userId: this.userId, moduleId, role }, this.assignCallKey()) // Passa a chave da operação
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loggingService.info(
            `UI: Role ${role} assignment call for user ${this.userId} completed (check store state for actual success/failure).`,
          );
          // A lógica de UI (fechar form, etc.) pode acontecer aqui se a chamada ao store for bem-sucedida.
          // O `effect` que observa o `CallState` do store (se existir para esta chave) ou o `selectedUser`
          // deve lidar com a atualização da UI baseada no sucesso real da operação no backend.
          // Se o `assignRole` do store já atualiza `selectedUser` e o `CallState` corretamente,
          // o `effect` no construtor deste componente (ou no UserDetailComponent) deve reagir.
          this.toggleAssignForm(); // Fecha o formulário na tentativa de submissão.
        },
        error: (err) => {
          // O `trackCall` no store já deve ter tratado o erro e atualizado o signal `assignRoleError`.
          this.loggingService.error(`UI: Error subscribing to assignRole outcome for user ${this.userId}`, err);
        },
      });
  }

  removeRole(moduleId: string, roleName: string) {
    const roleKeyForState = `${moduleId}:${roleName}`; // Chave para o estado local de UI
    const operationCallKey = `${this.removeCallKeyPrefix()}${moduleId}_${roleName}`; // Chave para o trackCall no store

    this.removingRoleState.update((s) => ({ ...s, [roleKeyForState]: true }));
    this.removeRoleErrorState.update((s) => ({ ...s, [roleKeyForState]: null }));

    this.loggingService.debug(`UI: Attempting to remove role: ${roleName} in module ${moduleId} from user ${this.userId}`);

    // O UserStore.removeRole DEVE ser um rxMethod que usa trackCall com a chave `operationCallKey`
    this.userStore
      .removeRole({ userId: this.userId, moduleId, roleId: roleName }, operationCallKey)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loggingService.info(`UI: Role ${roleName} removal call for user ${this.userId} completed.`);
          // O estado do usuário (e consequentemente `assignedRolesByModule`) será atualizado pelo store.
        },
        error: (err: any) => {
          this.loggingService.error(`UI: Error subscribing to removeRole outcome for user ${this.userId}, role ${roleName}`, err);
          this.removeRoleErrorState.update((s) => ({ ...s, [roleKeyForState]: err?.message || `Falha ao remover o papel ${roleName}.` }));
        },
        complete: () => {
          this.removingRoleState.update((s) => ({ ...s, [roleKeyForState]: false }));
        },
      });
  }

  isRoleCurrentlyBeingRemoved(moduleId: string, roleName: string): boolean {
    const operationCallKey = `${this.removeCallKeyPrefix()}${moduleId}_${roleName}`;
    // Verifica o estado da chamada no UserStore
    return this.userStore.getCallStatusSignal(operationCallKey)() === 'pending';
  }

  getRemoveRoleError(moduleId: string, roleName: string): string | null {
    const operationCallKey = `${this.removeCallKeyPrefix()}${moduleId}_${roleName}`;
    // Obtém o erro do UserStore
    const storeError = this.userStore.getErrorByKeySignal(operationCallKey)();
    return storeError ? storeError.message || 'Erro desconhecido' : null;
  }

  isRoleAssigned(moduleId: string, roleName: string): boolean {
    const assignedModuleRoles = this.assignedRolesByModule().get(moduleId);
    return !!assignedModuleRoles && assignedModuleRoles.some((r) => r.role === roleName);
  }

  getModuleName(module: Module): string {
    return module.name || module.id;
  }

  getRoleDetails(moduleId: string, roleName: string): Role | undefined {
    return this.roleStore.rolesByModuleSync(moduleId).find((r) => r.name === roleName);
  }

  getRoleBadgeClass(roleName: string): string {
    const roleNameLower = roleName.toLowerCase();
    if (roleNameLower.includes('admin')) return 'bg-red-100 text-red-800';
    if (roleNameLower.includes('manager')) return 'bg-purple-100 text-purple-800';
    if (roleNameLower.includes('creator')) return 'bg-blue-100 text-blue-800';
    if (roleNameLower.includes('editor')) return 'bg-green-100 text-green-800';
    return 'bg-gray-100 text-gray-800';
  }
}
