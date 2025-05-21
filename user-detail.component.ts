import { ChangeDetectionStrategy, Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { UserStore, User, RoleStore } from '@auth/data-access';
import { computed, signal } from '@angular/core';
import { Subscription, Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'user-detail',
  imports: [CommonModule, RouterModule, UserRolesComponent, UserActivityLogComponent],
  templateUrl: './user-detail.component.html',
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserDetailComponent implements OnInit, OnDestroy {
  private userStore = inject(UserStore);
  private roleStore = inject(RoleStore);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroy$ = new Subject<void>();

  // State signals
  loading = this.userStore.isLoadingByKeySignal('user');
  user = this.userStore.selectedUser;
  selectedTab = signal('profile'); // 'profile', 'roles', 'activity'

  // Computed for module display name
  moduleNames = computed(() => {
    const modules = this.roleStore.modules();
    const map = new Map<string, string>();

    modules.forEach((module) => {
      map.set(module.id, module.name);
    });

    return map;
  });

  ngOnInit() {
    // Load the user by ID from the route
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const userId = params.get('id');
      if (userId) {
        this.loadUser(userId);
        this.roleStore.loadModules();
      } else {
        this.router.navigate(['/admin/users']);
      }
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Load user
  loadUser(id: string) {
    this.userStore.loadUser(id);
  }

  // Change tab
  setTab(tab: 'profile' | 'roles' | 'activity') {
    this.selectedTab.set(tab);
  }

  // Get module name by ID
  getModuleName(moduleId: string): string {
    return this.moduleNames().get(moduleId) || moduleId;
  }

  // Get formatted date
  formatDate(date: Date | string | undefined): string {
    if (!date) return 'N/A';
    return new Date(date).toLocaleString();
  }

  // Get badge class for role
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
