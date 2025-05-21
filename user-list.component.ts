import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule, ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { computed, Signal, effect } from '@angular/core';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { RoleStore, UserStore } from '@auth/data-access';
import { UserFilters } from '@auth/utils';

@Component({
  selector: 'user-list',
  imports: [CommonModule, RouterModule, FormsModule, ReactiveFormsModule],
  templateUrl: './user-list.component.html',
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserListComponent implements OnInit {
  private userStore = inject(UserStore);
  private roleStore = inject(RoleStore);
  private fb = inject(FormBuilder);

  // Data signals
  users = this.userStore.users;
  total = this.userStore.total;
  page = this.userStore.page;
  pageSize = this.userStore.pageSize;
  loading = this.userStore.isLoadingByKeySignal('users');
  filters = this.userStore.filters;
  modules = this.roleStore.modules;

  // Pagination signals
  pageSizes = this.userStore.pageSizes;
  totalPages = this.userStore.totalPages;
  hasNextPage = this.userStore.hasNextPage;
  hasPreviousPage = this.userStore.hasPreviousPage;
  rangeStart = this.userStore.rangeStart;
  rangeEnd = this.userStore.rangeEnd;

  // Computed for UI
  displayRange = computed(() => {
    if (this.total() === 0) return '0 de 0';
    return `${this.rangeStart()}-${this.rangeEnd()} de ${this.total()}`;
  });

  // Filter form
  filterForm = this.fb.group({
    search: [''],
    active: [null as boolean | null],
    moduleId: [null as string | null],
    roleId: [null as string | null],
  });

  // Computed for module roles
  rolesForSelectedModule: Signal<{ id: string; name: string }[]> = computed(() => {
    const moduleId = this.filterForm.get('moduleId')?.value;
    if (!moduleId) return [];

    return this.roleStore
      .rolesByModule(moduleId)()
      .map((role) => ({ id: role.id, name: role.name }));
  });

  ngOnInit() {
    // Load initial data
    this.roleStore.loadModules();
    this.loadUsers();

    // Setup filter change subscription with debounce
    this.filterForm.valueChanges
      .pipe(
        debounceTime(300),
        distinctUntilChanged((prev, curr) => JSON.stringify(prev) === JSON.stringify(curr)),
      )
      .subscribe((values) => {
        this.applyFilters(values as UserFilters);
      });

    // Effect to sync the form with store filters
    effect(() => {
      const storeFilters = this.filters();
      if (storeFilters) {
        this.filterForm.patchValue(
          {
            search: storeFilters.search || '',
            active: storeFilters.active,
            moduleId: storeFilters.moduleId,
            roleId: storeFilters.roleId,
          },
          { emitEvent: false },
        );
      }
    });
  }

  // Load users
  loadUsers() {
    this.userStore.loadUsers();
  }

  // Handle page change
  goToPage(page: number) {
    this.userStore.goToPage(page);
    this.loadUsers();
  }

  // Handle page size change
  onPageSizeChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const size = parseInt(select.value, 10);
    this.userStore.setPageSize(size);
    this.loadUsers();
  }

  // Apply filters
  applyFilters(filters: UserFilters) {
    this.userStore.setFilters(filters);
  }

  // Clear filters
  clearFilters() {
    this.filterForm.reset({
      search: '',
      active: null,
      moduleId: null,
      roleId: null,
    });
    this.userStore.clearFilters();
  }

  // Module selection change
  onModuleChange() {
    // Reset role when module changes
    this.filterForm.patchValue({ roleId: null });
  }

  // Delete user
  deleteUser(userId: string, event: Event) {
    event.preventDefault();
    event.stopPropagation();

    if (confirm('Tem certeza que deseja excluir este usuário?')) {
      // TODO:
      // this.userStore.deleteUser(userId).subscribe(() => {
      //   this.loadUsers();
      // });
    }
  }

  // Get user role badge class
  getRoleBadgeClass(role: string): string {
    switch (role) {
      case 'admin':
        return 'bg-red-100 text-red-800';
      case 'manager':
        return 'bg-purple-100 text-purple-800';
      case 'creator':
        return 'bg-blue-100 text-blue-800';
      case 'editor':
        return 'bg-green-100 text-green-800';
      case 'viewer':
      default:
        return 'bg-gray-100 text-gray-800';
    }
  }
}
