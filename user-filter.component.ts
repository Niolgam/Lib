import { Component, OnInit, output, inject, computed, signal, effect, ChangeDetectionStrategy } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

import { UserStore, RoleStore } from '@auth/data-access';
import { UserFilters } from '@auth/utils';
import { LoggingService } from '@vai/services';

interface FilterOption {
  value: any;
  label: string;
  count?: number;
}

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'user-filter',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './user-filter.component.html',
  styleUrls: ['./user-filter.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserFilterComponent implements OnInit {
  // Injeção de dependências
  private fb = inject(FormBuilder);
  private userStore = inject(UserStore);
  private roleStore = inject(RoleStore);
  private loggingService = inject(LoggingService);

  // Outputs
  readonly filtersChanged = output<UserFilters>();
  readonly filtersCleared = output<void>();

  // Signals internos
  readonly filterForm = signal<FormGroup>(this.createForm());
  readonly isExpanded = signal(false);
  readonly activeFilterCount = signal(0);

  // Computed values para opções de filtro
  readonly statusOptions = computed((): FilterOption[] => [
    { value: null, label: 'All Users' },
    { value: true, label: 'Active', count: this.userStore.activeUsers().length },
    { value: false, label: 'Inactive', count: this.userStore.inactiveUsers().length },
  ]);

  readonly moduleOptions = computed((): FilterOption[] => {
    const modules = this.roleStore.activeModules();
    return [
      { value: null, label: 'All Modules' },
      ...modules.map((module) => ({
        value: module.id,
        label: module.name,
        count: this.userStore.getUsersInModuleSync(module.id).length,
      })),
    ];
  });

  readonly roleOptions = computed((): FilterOption[] => {
    const selectedModuleId = this.filterForm().get('moduleId')?.value;
    if (!selectedModuleId) {
      return [{ value: null, label: 'Select module first' }];
    }

    const roles = this.roleStore.rolesByModuleSync(selectedModuleId);
    return [
      { value: null, label: 'All Roles' },
      ...roles.map((role) => ({
        value: role.name,
        label: role.name,
        count: this.userStore.getUsersByRoleSync(selectedModuleId, role.name).length,
      })),
    ];
  });

  readonly currentFilters = computed(() => this.userStore.filters());
  readonly hasActiveFilters = computed(() => this.userStore.hasActiveFilters());

  ngOnInit() {
    // Carregar dados necessários se não estiverem disponíveis
    if (this.roleStore.activeModules().length === 0) {
      this.roleStore.loadModules();
    }

    // Sincronizar form com filtros atuais do store
    this.syncFormWithStoreFilters();

    // Effect para atualizar contagem de filtros ativos
    effect(() => {
      const form = this.filterForm();
      const formValue = form.value;
      let count = 0;

      if (formValue.search) count++;
      if (formValue.active !== null) count++;
      if (formValue.moduleId) count++;
      if (formValue.roleId) count++;

      this.activeFilterCount.set(count);
    });

    // Effect para resetar roleId quando moduleId muda
    effect(() => {
      const form = this.filterForm();
      const moduleControl = form.get('moduleId');
      const roleControl = form.get('roleId');

      if (moduleControl && roleControl) {
        moduleControl.valueChanges.subscribe(() => {
          roleControl.setValue(null);
        });
      }
    });
  }

  private createForm(): FormGroup {
    return this.fb.group({
      search: [''],
      active: [null],
      moduleId: [null],
      roleId: [null],
    });
  }

  private syncFormWithStoreFilters(): void {
    const currentFilters = this.currentFilters();
    const form = this.filterForm();

    form.patchValue(currentFilters, { emitEvent: false });
  }

  // Aplicar filtros
  applyFilters(): void {
    const form = this.filterForm();
    const filters: UserFilters = form.value;

    this.loggingService.debug('Applying user filters', filters);

    // Aplicar no store
    this.userStore.setFilters(filters);

    // Emitir evento
    this.filtersChanged.emit(filters);
  }

  // Limpar filtros
  clearFilters(): void {
    const form = this.filterForm();

    form.reset({
      search: '',
      active: null,
      moduleId: null,
      roleId: null,
    });

    // Aplicar filtros limpos
    this.applyFilters();

    this.loggingService.debug('User filters cleared');
    this.filtersCleared.emit();
  }

  // Toggle expansão do painel de filtros
  toggleExpanded(): void {
    this.isExpanded.set(!this.isExpanded());
  }

  // Aplicar filtro rápido de status
  quickFilter(filter: 'all' | 'active' | 'inactive'): void {
    const form = this.filterForm();

    switch (filter) {
      case 'all':
        form.patchValue({ active: null });
        break;
      case 'active':
        form.patchValue({ active: true });
        break;
      case 'inactive':
        form.patchValue({ active: false });
        break;
    }

    this.applyFilters();
  }

  // Aplicar filtro por módulo específico
  filterByModule(moduleId: string): void {
    const form = this.filterForm();
    form.patchValue({
      moduleId,
      roleId: null, // Reset role quando módulo muda
    });
    this.applyFilters();
  }

  // Eventos do formulário
  onSearchChange(): void {
    // Aplicar filtro com debounce
    setTimeout(() => {
      this.applyFilters();
    }, 500);
  }

  onFilterChange(): void {
    this.applyFilters();
  }

  // Métodos auxiliares para template
  getFilterSummary(): string {
    const filters = this.currentFilters();
    const parts: string[] = [];

    if (filters.search) {
      parts.push(`Search: "${filters.search}"`);
    }

    if (filters.active !== null) {
      parts.push(`Status: ${filters.active ? 'Active' : 'Inactive'}`);
    }

    if (filters.moduleId) {
      const module = this.roleStore.getModuleByIdSync(filters.moduleId);
      if (module) {
        parts.push(`Module: ${module.name}`);
      }
    }

    if (filters.roleId) {
      parts.push(`Role: ${filters.roleId}`);
    }

    return parts.length > 0 ? parts.join(', ') : 'No filters applied';
  }

  // Preset filters comuns
  applyPresetFilter(preset: 'recent' | 'admins' | 'managers' | 'inactive'): void {
    const form = this.filterForm();

    switch (preset) {
      case 'recent':
        // Filtrar usuários mais recentes (mock - na prática seria baseado em data)
        form.patchValue({
          search: '',
          active: true,
          moduleId: null,
          roleId: null,
        });
        break;

      case 'admins':
        form.patchValue({
          search: '',
          active: true,
          moduleId: 'core',
          roleId: 'admin',
        });
        break;

      case 'managers':
        form.patchValue({
          search: '',
          active: true,
          moduleId: null,
          roleId: 'manager',
        });
        break;

      case 'inactive':
        form.patchValue({
          search: '',
          active: false,
          moduleId: null,
          roleId: null,
        });
        break;
    }

    this.applyFilters();
  }

  // Exportar filtros atuais (para salvar como preset)
  exportCurrentFilters(): UserFilters {
    return { ...this.currentFilters() };
  }

  // Importar filtros (para aplicar preset salvo)
  importFilters(filters: UserFilters): void {
    const form = this.filterForm();
    form.patchValue(filters);
    this.applyFilters();
  }
}
