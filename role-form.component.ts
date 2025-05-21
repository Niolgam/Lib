import { Component, OnInit, inject, signal, computed, effect, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormArray, AbstractControl } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';

import { RoleStore, AuthStore } from '@auth/data-access';
import { LoggingService } from '@vai/services';
import { Role, Module, Permission, RolePermissionAssignment, PermissionAction } from '@auth/data-access';
import { BaseFormComponent } from '@component/form-base';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

interface RoleFormData {
  name: string;
  description?: string;
  moduleId: string;
  isActive: boolean;
  permissionAssignments: RolePermissionAssignment[];
}

// Interface para o payload de criação/atualização de Role
// (pode ser igual a RoleFormData ou um subconjunto, dependendo da API)
type RolePayload = Partial<Omit<Role, 'id' | 'createdAt' | 'updatedAt' | 'isSystemRole'>>;

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'role-form',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './role-form.component.html',
  styleUrls: ['./role-form.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoleFormComponent extends BaseFormComponent<RolePayload> implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private fb = inject(FormBuilder); // Renomeado para fb para consistência
  private roleStore = inject(RoleStore);
  private authStore = inject(AuthStore);
  // LoggingService é injetado em BaseFormComponent

  // Signals para controle do formulário
  private readonly roleIdState = signal<string | null>(null);
  readonly isEditMode = computed(() => !!this.roleIdState()); // Mais simples
  // isSubmitting é herdado de BaseFormComponent

  // Form groups
  override form: FormGroup; // Definido no construtor
  readonly permissionsForm: FormGroup; // Formulário separado para permissões

  // Computed signals
  // currentRole, isLoading, canSave, pageTitle são gerenciados ou adaptados
  readonly currentRole = computed(() => {
    const roleId = this.roleIdState();
    return roleId ? this.roleStore.getRoleByIdSync(roleId) : null;
  });

  readonly modules = this.roleStore.activeModules;
  readonly selectedModule = computed(() => {
    const moduleId = this.form?.get('moduleId')?.value;
    return moduleId ? this.roleStore.getModuleByIdSync(moduleId) : null;
  });

  readonly modulePermissions = computed(() => {
    const moduleId = this.form?.get('moduleId')?.value;
    return moduleId ? this.roleStore.permissionsByModuleSync(moduleId) : [];
  });

  // isLoading agora é uma combinação do loading do papel e das permissões/módulos
  readonly isLoading = computed(() => {
    const roleId = this.roleIdState();
    const roleLoadingKey = roleId ? `loadRole_${roleId}` : 'loadModules'; // Ajustar chave conforme store
    return this.roleStore.isLoadingByKey(roleLoadingKey) || this.roleStore.isLoadingByKey('loadModules');
  });

  readonly pageTitle = computed(() => (this.isEditMode() ? `Editar Papel: ${this.currentRole()?.name || ''}` : 'Novo Papel'));

  // Available actions for permissions
  readonly availableActions: (keyof PermissionAction)[] = ['view', 'create', 'update', 'delete', 'approve', 'export', 'import'];

  constructor() {
    super();
    this.form = this.createRoleForm();
    this.permissionsForm = this.createPermissionsForm();

    // Effect para carregar dados do papel em modo de edição
    effect(() => {
      const roleId = this.roleIdState();
      if (roleId && this.isEditMode()) {
        this.loadRoleForEdit(roleId);
      }
    });

    // Effect para carregar permissões quando o módulo muda no formulário principal
    effect(() => {
      const moduleId = this.form?.get('moduleId')?.value;
      if (moduleId) {
        this.loadModulePermissions(moduleId);
      }
    });
  }

  override ngOnInit(): void {
    super.ngOnInit();
    const roleIdFromRoute = this.route.snapshot.paramMap.get('id');

    this.logger.debug('RoleFormComponent: Initializing', { roleIdFromRoute });

    if (roleIdFromRoute && roleIdFromRoute !== 'new') {
      this.roleIdState.set(roleIdFromRoute);
      // isEditMode será true automaticamente
    } else {
      this.roleIdState.set(null); // Garante que é modo de criação
    }

    this.loadInitialData();
  }

  private createRoleForm(): FormGroup {
    return this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(50)]],
      description: ['', [Validators.maxLength(500)]],
      moduleId: ['', [Validators.required]],
      isActive: [true],
      // permissionAssignments será gerenciado pelo permissionsForm
    });
  }

  private createPermissionsForm(): FormGroup {
    return this.fb.group({
      permissions: this.fb.array([]),
    });
  }

  get permissionsFormArray(): FormArray {
    return this.permissionsForm.get('permissions') as FormArray;
  }

  private loadInitialData(): void {
    if (this.modules().length === 0) {
      this.roleStore.loadModules(); // Dispara o carregamento de módulos
    }
  }

  private loadRoleForEdit(roleId: string): void {
    // Dispara o carregamento do papel. O effect no construtor irá popular o form quando estiver pronto.
    this.roleStore.loadRole(roleId);
  }

  private loadModulePermissions(moduleId: string): void {
    if (this.roleStore.permissionsByModuleSync(moduleId).length === 0) {
      this.roleStore.loadPermissionsByModule(moduleId);
    }
    // Um effect separado irá chamar updatePermissionsForm quando modulePermissions mudar
    // ou podemos chamar diretamente aqui se a lógica de effect for complexa.
    // Para simplificar, vamos assumir que o effect que observa modulePermissions fará o trabalho.
    // No entanto, para garantir que o formulário de permissões seja atualizado
    // imediatamente após a seleção do módulo (e o carregamento das permissões),
    // podemos chamar updatePermissionsForm aqui também, ou garantir que o effect reaja corretamente.
    this.updatePermissionsForm(this.currentRole()?.permissionAssignments);
  }

  private populateForm(role: Role): void {
    this.form.patchValue({
      name: role.name,
      description: role.description || '',
      moduleId: role.moduleId,
      isActive: role.isActive,
    });
    this.updatePermissionsForm(role.permissionAssignments);
    this.form.markAsPristine();
  }

  private updatePermissionsForm(existingAssignments: RolePermissionAssignment[] = []): void {
    const permissions = this.modulePermissions(); // Usa o computed signal
    const formArray = this.permissionsFormArray;

    formArray.clear(); // Limpa o array atual

    permissions.forEach((permission) => {
      const existingAssignment = existingAssignments.find((a) => a.permissionId === permission.id);
      const actionsGroup = this.fb.group({});
      this.availableActions.forEach((action) => {
        actionsGroup.addControl(action, this.fb.control(existingAssignment?.actions[action] || false));
      });

      formArray.push(
        this.fb.group({
          permissionId: [permission.id],
          permissionName: [permission.name], // Para exibição no template
          permissionCode: [permission.code], // Para exibição no template
          actions: actionsGroup,
        }),
      );
    });
    this.permissionsForm.markAsPristine();
  }

  protected override getFormValue(): RolePayload {
    return {
      ...this.form.value,
      permissionAssignments: this.getPermissionAssignmentsFromForm(),
    };
  }

  private getPermissionAssignmentsFromForm(): RolePermissionAssignment[] {
    return this.permissionsFormArray.controls
      .map((control) => {
        const actions = control.get('actions')?.value as PermissionAction;
        // Inclui apenas se alguma ação estiver selecionada
        if (Object.values(actions).some((v) => v === true)) {
          return {
            permissionId: control.get('permissionId')?.value,
            actions: actions,
          };
        }
        return null;
      })
      .filter((assignment) => assignment !== null) as RolePermissionAssignment[];
  }

  protected override submitForm(): void {
    const rolePayload = this.getFormValue();
    this.logger.debug('RoleFormComponent: Submitting role', { isEdit: this.isEditMode(), rolePayload });

    const operationKey = this.isEditMode() ? `updateRole_${this.roleIdState()}` : 'createRole';

    let submissionObservable;
    if (this.isEditMode()) {
      const roleId = this.roleIdState();
      if (!roleId) {
        this.handleSubmissionError(new Error('Role ID is missing for update.'));
        return;
      }
      submissionObservable = this.roleStore.updateRole({ roleId, data: rolePayload });
    } else {
      submissionObservable = this.roleStore.createRole(rolePayload);
    }

    submissionObservable.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (savedRole: Role | null) => {
        // O tipo de retorno dos métodos do store pode variar
        if (savedRole) {
          this.setSuccess(this.isEditMode() ? 'Papel atualizado com sucesso!' : 'Papel criado com sucesso!');
          this.form.markAsPristine();
          this.permissionsForm.markAsPristine();
          this.router.navigate(['/admin/roles', savedRole.id]);
        } else {
          // Se savedRole for null, mas não houve erro, pode ser um caso específico
          this.handleSubmissionError(new Error('Operação concluída, mas dados do papel não retornados.'));
        }
      },
      // error: (error) => this.handleSubmissionError(error) // Já tratado pelo trackCall no store e BaseFormComponent
    });
  }

  onModuleChange(): void {
    // O effect que observa form.get('moduleId').valueChanges já deve chamar loadModulePermissions
    // e subsequentemente updatePermissionsForm.
    // Se for necessário forçar, pode-se chamar this.updatePermissionsForm() aqui.
    this.permissionsFormArray.clear(); // Limpa permissões ao trocar de módulo
    this.permissionsForm.markAsPristine();
  }

  onSelectAllActions(permissionIndex: number, select: boolean): void {
    const permissionControl = this.permissionsFormArray.at(permissionIndex);
    const actionsGroup = permissionControl.get('actions') as FormGroup;

    this.availableActions.forEach((action) => {
      actionsGroup.get(action)?.setValue(select, { emitEvent: false }); // Evita loop de valueChanges
    });
    actionsGroup.markAsDirty();
    this.permissionsForm.markAsDirty();
  }

  onPermissionActionToggle(permissionIndex: number, action: keyof PermissionAction): void {
    const permissionControl = this.permissionsFormArray.at(permissionIndex);
    const actionsGroup = permissionControl.get('actions') as FormGroup;
    const actionControl = actionsGroup.get(action as string);

    if (actionControl) {
      // Se está desmarcando 'view', desmarca todas as outras
      if (action === 'view' && !actionControl.value) {
        this.availableActions.forEach((act) => {
          if (act !== 'view') {
            actionsGroup.get(act)?.setValue(false, { emitEvent: false });
          }
        });
      }
      // Se está marcando qualquer outra ação, garante que 'view' esteja marcada
      else if (action !== 'view' && actionControl.value) {
        actionsGroup.get('view')?.setValue(true, { emitEvent: false });
      }
    }
    actionsGroup.markAsDirty();
    this.permissionsForm.markAsDirty();
  }

  isPermissionSelected(permissionIndex: number): boolean {
    const actionsGroup = this.permissionsFormArray.at(permissionIndex)?.get('actions') as FormGroup;
    if (!actionsGroup) return false;
    return this.availableActions.some((action) => actionsGroup.get(action)?.value === true);
  }

  isActionSelected(permissionIndex: number, action: keyof PermissionAction): boolean {
    const actionControl = this.permissionsFormArray
      .at(permissionIndex)
      ?.get('actions')
      ?.get(action as string);
    return actionControl?.value === true;
  }

  override onCancel(): void {
    // Sobrescreve onCancel para usar BaseFormComponent
    if (this.isDirty() || this.permissionsForm.dirty) {
      // Verifica ambos os forms
      const confirmMessage = 'Você tem alterações não salvas. Deseja realmente sair?';
      if (!confirm(confirmMessage)) {
        return;
      }
    }
    this.goBack();
  }

  goBack(): void {
    if (this.isEditMode() && this.roleIdState()) {
      this.router.navigate(['/admin/roles', this.roleIdState()]);
    } else {
      this.router.navigate(['/admin/roles']);
    }
  }

  getActionName(action: string): string {
    const actionNames: Record<string, string> = {
      view: 'Visualizar',
      create: 'Criar',
      update: 'Atualizar',
      delete: 'Excluir',
      approve: 'Aprovar',
      export: 'Exportar',
      import: 'Importar',
    };
    return actionNames[action] || action;
  }

  trackByPermissionControl(index: number, item: AbstractControl): string {
    return item.get('permissionId')?.value || index.toString();
  }

  // Adiciona o getter para o template
  get nameControl() {
    return this.form.get('name');
  }
  get descriptionControl() {
    return this.form.get('description');
  }
  get moduleControl() {
    return this.form.get('moduleId');
  }
}
