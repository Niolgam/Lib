import { Component, OnInit, input, output, inject, computed, signal, effect, ChangeDetectionStrategy } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

import { UserStore, RoleStore, AuthStore } from '@auth/data-access';
import { User, UserRoleAssignmentInfo, Module, Role } from '@auth/data-access';
import { LoggingService } from '@vai/services';

@Component({
  selector: 'ws-user-form',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './user-form.component.html',
  styleUrls: ['./user-form.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserFormComponent implements OnInit {
  // Injeção de dependências
  private fb = inject(FormBuilder);
  private userStore = inject(UserStore);
  private roleStore = inject(RoleStore);
  private authStore = inject(AuthStore);
  private loggingService = inject(LoggingService);

  // Inputs
  readonly userId = input<string | null>(null);
  readonly mode = input<'create' | 'edit'>('create');

  // Outputs
  readonly userSaved = output<User>();
  readonly cancelled = output<void>();

  // Signals internos
  public readonly isEditMode = computed(() => this.mode() === 'edit');
  private readonly currentUserId = computed(() => this.userId());

  // Form state
  readonly userForm = signal<FormGroup>(this.createForm());
  readonly isSubmitting = signal(false);
  readonly validationErrors = signal<Record<string, string>>({});

  // Computed values
  readonly currentUser = computed(() => {
    const id = this.currentUserId();
    return id ? this.userStore.users().find((u) => u.id === id) : null;
  });

  readonly availableModules = computed(() => this.roleStore.activeModules());
  readonly canManageRoles = computed(() => this.authStore.hasRoleSync('users', 'manager') || this.authStore.hasRoleSync('core', 'admin'));

  readonly formTitle = computed(() => (this.isEditMode() ? 'Edit User' : 'Create New User'));

  readonly rolesByModule = computed(() => {
    const modules = this.availableModules();
    const rolesMap = new Map<string, Role[]>();

    modules.forEach((module) => {
      const roles = this.roleStore.rolesByModuleSync(module.id);
      rolesMap.set(module.id, roles);
    });

    return rolesMap;
  });

  ngOnInit() {
    // Carrega módulos se ainda não estiverem carregados
    if (this.availableModules().length === 0) {
      this.roleStore.loadModules();
    }

    // Effect para popular form quando usuário for carregado
    effect(() => {
      const user = this.currentUser();
      if (user && this.isEditMode()) {
        this.populateForm(user);
      }
    });

    // Effect para carregar usuário específico se estiver em modo edição
    effect(() => {
      const id = this.currentUserId();
      if (id && this.isEditMode()) {
        this.userStore.loadUser(id);
      }
    });
  }

  private createForm(): FormGroup {
    return this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      cpf: ['', [this.cpfValidator()]],
      isActive: [true],
      roles: this.fb.array([]),
    });
  }

  private populateForm(user: User): void {
    const form = this.userForm();
    form.patchValue({
      name: user.name,
      email: user.email,
      cpf: user.cpf || '',
      isActive: user.isActive,
    });

    // Popular roles
    this.populateRoles(user.roles);
  }

  private populateRoles(roles: UserRoleAssignmentInfo[]): void {
    // Implementação para popular os papéis no formulário
    roles.forEach((roleAssignment) => {
      this.addRoleAssignment(roleAssignment.moduleId, roleAssignment.role);
    });
  }

  // Validador customizado para CPF
  private cpfValidator() {
    return (control: any) => {
      if (!control.value) return null;

      const cpf = control.value.replace(/[^\d]/g, '');
      if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) {
        return { invalidCpf: true };
      }

      // Validação do dígito verificador
      let sum = 0;
      for (let i = 0; i < 9; i++) {
        sum += parseInt(cpf.charAt(i)) * (10 - i);
      }
      let digit = 11 - (sum % 11);
      if (digit >= 10) digit = 0;

      if (digit !== parseInt(cpf.charAt(9))) {
        return { invalidCpf: true };
      }

      sum = 0;
      for (let i = 0; i < 10; i++) {
        sum += parseInt(cpf.charAt(i)) * (11 - i);
      }
      digit = 11 - (sum % 11);
      if (digit >= 10) digit = 0;

      if (digit !== parseInt(cpf.charAt(10))) {
        return { invalidCpf: true };
      }

      return null;
    };
  }

  // Métodos para gerenciar papéis
  addRoleAssignment(moduleId: string, role: string): void {
    // Logic to add role assignment to form
    this.loggingService.debug('Adding role assignment', { moduleId, role });
  }

  removeRoleAssignment(moduleId: string, role: string): void {
    // Logic to remove role assignment from form
    this.loggingService.debug('Removing role assignment', { moduleId, role });
  }

  toggleRoleForModule(moduleId: string, roleName: string, event: Event): void {
    const target = event.target as HTMLInputElement;
    const isChecked = target.checked;

    if (isChecked) {
      this.addRoleAssignment(moduleId, roleName);
    } else {
      this.removeRoleAssignment(moduleId, roleName);
    }
  }

  // Submissão do formulário
  async onSubmit(): Promise<void> {
    const form = this.userForm();

    if (form.invalid) {
      this.markFormGroupTouched(form);
      this.validateForm();
      return;
    }

    this.isSubmitting.set(true);
    this.validationErrors.set({});

    try {
      const formValue = form.value;
      const userData = this.buildUserData(formValue);

      if (this.isEditMode()) {
        await this.updateUser(userData);
      } else {
        await this.createUser(userData);
      }
    } catch (error) {
      this.handleSubmissionError(error);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  private buildUserData(formValue: any): Partial<User> {
    return {
      name: formValue.name,
      email: formValue.email,
      cpf: formValue.cpf || undefined,
      isActive: formValue.isActive,
      roles: this.buildRoleAssignments(),
    };
  }

  private buildRoleAssignments(): UserRoleAssignmentInfo[] {
    // Construir array de role assignments baseado no form
    const assignments: UserRoleAssignmentInfo[] = [];
    // Logic to build role assignments from form
    return assignments;
  }

  private async createUser(userData: Partial<User>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.userStore.createUser(userData);

      // Simular observação do resultado
      setTimeout(() => {
        const error = this.userStore.error();
        if (error) {
          reject(error);
        } else {
          this.loggingService.info('User created successfully');
          const latestUser = this.userStore.users()[this.userStore.users().length - 1];
          this.userSaved.emit(latestUser);
          resolve();
        }
      }, 1000);
    });
  }

  private async updateUser(userData: Partial<User>): Promise<void> {
    const userId = this.currentUserId();
    if (!userId) throw new Error('User ID is required for update');

    return new Promise((resolve, reject) => {
      this.userStore.updateUser({ userId, data: userData });

      // Simular observação do resultado
      setTimeout(() => {
        const error = this.userStore.error();
        if (error) {
          reject(error);
        } else {
          this.loggingService.info('User updated successfully');
          const updatedUser = this.currentUser();
          if (updatedUser) {
            this.userSaved.emit(updatedUser);
          }
          resolve();
        }
      }, 1000);
    });
  }

  private handleSubmissionError(error: any): void {
    this.loggingService.error('Error submitting user form', error);

    // Tratar diferentes tipos de erro
    if (error.status === 422 && error.validationErrors) {
      this.validationErrors.set(error.validationErrors);
    } else if (error.message) {
      this.validationErrors.set({ general: error.message });
    } else {
      this.validationErrors.set({
        general: 'An unexpected error occurred. Please try again.',
      });
    }
  }

  private markFormGroupTouched(formGroup: FormGroup): void {
    Object.keys(formGroup.controls).forEach((field) => {
      const control = formGroup.get(field);
      control?.markAsTouched({ onlySelf: true });
    });
  }

  private validateForm(): void {
    const form = this.userForm();
    const errors: Record<string, string> = {};

    Object.keys(form.controls).forEach((field) => {
      const control = form.get(field);
      if (control && !control.valid && control.touched) {
        const fieldErrors = control.errors;
        if (fieldErrors?.['required']) {
          errors[field] = `${this.getFieldDisplayName(field)} is required`;
        } else if (fieldErrors?.['email']) {
          errors[field] = 'Please enter a valid email address';
        } else if (fieldErrors?.['minlength']) {
          const requiredLength = fieldErrors['minlength'].requiredLength;
          errors[field] = `${this.getFieldDisplayName(field)} must be at least ${requiredLength} characters`;
        } else if (fieldErrors?.['invalidCpf']) {
          errors[field] = 'Please enter a valid CPF';
        }
      }
    });

    this.validationErrors.set(errors);
  }

  private getFieldDisplayName(field: string): string {
    const displayNames: Record<string, string> = {
      name: 'Name',
      email: 'Email',
      cpf: 'CPF',
    };
    return displayNames[field] || field;
  }

  // Getters para o template
  get isFormValid(): boolean {
    return this.userForm().valid;
  }

  get hasValidationErrors(): boolean {
    return Object.keys(this.validationErrors()).length > 0;
  }

  // Método para cancelar
  onCancel(): void {
    this.cancelled.emit();
  }

  // Método para resetar o formulário
  resetForm(): void {
    this.userForm.set(this.createForm());
    this.validationErrors.set({});
  }
}
