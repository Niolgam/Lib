import { ChangeDetectionStrategy, Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { signal, computed } from '@angular/core';

interface Activity {
  id: string;
  userId: string;
  action: string;
  details: string;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
  resource?: string;
  resourceId?: string;
  status: 'success' | 'failure' | 'warning';
}

// Service for activity logs (mock implementation)
class ActivityLogService {
  getActivityLogs(userId: string, page: number = 1, pageSize: number = 10): Promise<{ activities: Activity[]; total: number }> {
    // This would be replaced with actual API call
    const mockActivities: Activity[] = [
      {
        id: '1',
        userId,
        action: 'login',
        details: 'Usuário realizou login com sucesso',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        timestamp: new Date(Date.now() - 3600000), // 1 hour ago
        status: 'success',
      },
      {
        id: '2',
        userId,
        action: 'password_change',
        details: 'Usuário alterou sua senha',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        timestamp: new Date(Date.now() - 86400000), // 1 day ago
        status: 'success',
      },
      {
        id: '3',
        userId,
        action: 'role_assigned',
        details: 'Papel "editor" atribuído ao usuário no módulo "content"',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        timestamp: new Date(Date.now() - 172800000), // 2 days ago
        resource: 'role',
        resourceId: 'editor',
        status: 'success',
      },
      {
        id: '4',
        userId,
        action: 'login_failed',
        details: 'Tentativa de login falhou: credenciais inválidas',
        ipAddress: '192.168.1.2',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        timestamp: new Date(Date.now() - 259200000), // 3 days ago
        status: 'failure',
      },
      {
        id: '5',
        userId,
        action: 'profile_update',
        details: 'Perfil atualizado: nome e email',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        timestamp: new Date(Date.now() - 432000000), // 5 days ago
        status: 'success',
      },
    ];

    return Promise.resolve({
      activities: mockActivities,
      total: mockActivities.length,
    });
  }
}

@Component({
  selector: 'user-activity-log',
  imports: [CommonModule, FormsModule],
  templateUrl: './user-activity-log.component.html',
  providers: [ActivityLogService],
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserActivityLogComponent implements OnInit {
  @Input() userId!: string;

  private activityLogService = inject(ActivityLogService);

  // State signals
  activities = signal<Activity[]>([]);
  loading = signal(false);
  page = signal(1);
  pageSize = signal(10);
  total = signal(0);

  // Computed for pagination
  totalPages = computed(() => Math.ceil(this.total() / this.pageSize()));

  ngOnInit() {
    this.loadActivities();
  }

  // Load activities
  loadActivities() {
    this.loading.set(true);

    this.activityLogService
      .getActivityLogs(this.userId, this.page(), this.pageSize())
      .then((result) => {
        this.activities.set(result.activities);
        this.total.set(result.total);
        this.loading.set(false);
      })
      .catch(() => {
        this.loading.set(false);
      });
  }

  // Page change
  goToPage(newPage: number) {
    if (newPage < 1 || newPage > this.totalPages()) return;

    this.page.set(newPage);
    this.loadActivities();
  }

  // Format date relative to now
  getRelativeTime(date: Date): string {
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return `${diffInSeconds} segundos atrás`;
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minutos atrás`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} horas atrás`;
    if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)} dias atrás`;

    // Format with date if older than a month
    return date.toLocaleDateString();
  }

  // Get icon for activity
  getActivityIcon(activity: Activity): string {
    switch (activity.action) {
      case 'login':
        return `
          <svg class="h-5 w-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"></path>
          </svg>
        `;
      case 'login_failed':
        return `
          <svg class="h-5 w-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
          </svg>
        `;
      case 'logout':
        return `
          <svg class="h-5 w-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
          </svg>
        `;
      case 'password_change':
        return `
          <svg class="h-5 w-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"></path>
          </svg>
        `;
      case 'role_assigned':
        return `
          <svg class="h-5 w-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"></path>
          </svg>
        `;
      case 'profile_update':
        return `
          <svg class="h-5 w-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
          </svg>
        `;
      default:
        return `
          <svg class="h-5 w-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
        `;
    }
  }

  // Get status indicator class
  getStatusClass(status: string): string {
    switch (status) {
      case 'success':
        return 'bg-green-100 text-green-800';
      case 'failure':
        return 'bg-red-100 text-red-800';
      case 'warning':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  }
}
