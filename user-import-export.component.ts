import { Component, OnInit, output, inject, computed, signal, effect, ChangeDetectionStrategy } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

import { UserStore, RoleStore, AuthStore } from '@auth/data-access';
import { User, Module, Role } from '@auth/data-access';
import { LoggingService } from '@vai/services';

interface ImportResult {
  total: number;
  successful: number;
  failed: number;
  errors: Array<{ row: number; field?: string; error: string }>;
  warnings: Array<{ row: number; message: string }>;
}

interface ExportOptions {
  format: 'csv' | 'xlsx' | 'json';
  includeInactive: boolean;
  includeRoles: boolean;
  includePersonalData: boolean;
  moduleIds: string[];
  dateRange?: {
    from: Date;
    to: Date;
  };
}

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'user-import-export',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './user-import-export.component.html',
  styleUrls: ['./user-import-export.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserImportExportComponent implements OnInit {
  // Injeção de dependências
  private fb = inject(FormBuilder);
  private userStore = inject(UserStore);
  private roleStore = inject(RoleStore);
  private authStore = inject(AuthStore);
  private loggingService = inject(LoggingService);

  // Outputs
  readonly importCompleted = output<ImportResult>();
  readonly exportCompleted = output<{ format: string; count: number }>();

  // Signals internos
  readonly activeTab = signal<'import' | 'export'>('import');
  readonly isProcessing = signal(false);
  readonly uploadedFile = signal<File | null>(null);
  readonly previewData = signal<any[]>([]);
  readonly importResults = signal<ImportResult | null>(null);
  readonly showResults = signal(false);

  readonly importForm = signal<FormGroup>(this.createImportForm());
  readonly exportForm = signal<FormGroup>(this.createExportForm());

  // Computed values
  readonly availableModules = computed(() => this.roleStore.activeModules());
  readonly totalUsers = computed(() => this.userStore.users().length);
  readonly activeUsers = computed(() => this.userStore.activeUsers().length);
  readonly inactiveUsers = computed(() => this.userStore.inactiveUsers().length);

  readonly canImport = computed(() => this.authStore.checkUserHasPermissionForAction('users', 'import', 'create'));

  readonly canExport = computed(() => this.authStore.checkUserHasPermissionForAction('users', 'export', 'view'));

  readonly importProgress = signal(0);
  readonly exportProgress = signal(0);

  // CSV template headers
  readonly csvTemplate = [
    'name',
    'email',
    'cpf',
    'isActive',
    'modules_roles', // formato: "moduleId:role;moduleId:role"
  ];

  ngOnInit() {
    // Carregar módulos se necessário
    if (this.availableModules().length === 0) {
      this.roleStore.loadModules();
    }

    // Carregar usuários para contagens
    if (this.totalUsers() === 0) {
      this.userStore.loadUsers();
    }
  }

  private createImportForm(): FormGroup {
    return this.fb.group({
      file: [null, Validators.required],
      skipFirstRow: [true],
      updateExisting: [false],
      validateOnly: [false],
      notifyUsers: [false],
      defaultActive: [true],
      resetPasswords: [true],
    });
  }

  private createExportForm(): FormGroup {
    return this.fb.group({
      format: ['csv', Validators.required],
      includeInactive: [true],
      includeRoles: [true],
      includePersonalData: [true],
      moduleIds: [[]],
      dateRangeEnabled: [false],
      dateFrom: [null],
      dateTo: [null],
    });
  }

  // Tab navigation
  switchTab(tab: 'import' | 'export'): void {
    this.activeTab.set(tab);
    this.resetForms();
  }

  // Import functions
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (file) {
      this.uploadedFile.set(file);
      this.importForm().patchValue({ file });
      this.previewImportFile(file);
    }
  }

  private async previewImportFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      const lines = text.split('\n').slice(0, 6); // Preview first 5 rows + header
      const data = lines.map((line) => line.split(',').map((cell) => cell.trim()));

      this.previewData.set(data);
      this.loggingService.debug('File preview loaded', { rows: data.length });
    } catch (error) {
      this.loggingService.error('Error previewing file', error);
      this.previewData.set([]);
    }
  }

  async importUsers(): Promise<void> {
    const form = this.importForm();
    const file = this.uploadedFile();

    if (!form.valid || !file) return;

    this.isProcessing.set(true);
    this.importProgress.set(0);

    try {
      const text = await file.text();
      const lines = text.split('\n').filter((line) => line.trim());

      // Skip header if enabled
      const dataLines = form.value.skipFirstRow ? lines.slice(1) : lines;

      const result: ImportResult = {
        total: dataLines.length,
        successful: 0,
        failed: 0,
        errors: [],
        warnings: [],
      };

      // Process each row
      for (let i = 0; i < dataLines.length; i++) {
        try {
          this.importProgress.set(Math.round(((i + 1) / dataLines.length) * 100));

          const rowData = this.parseCSVRow(dataLines[i]);
          const userData = this.mapRowToUser(rowData, i + 1);

          if (!form.value.validateOnly) {
            await this.createOrUpdateUser(userData, form.value.updateExisting);
          }

          result.successful++;
        } catch (error) {
          result.failed++;
          result.errors.push({
            row: i + 2, // +2 because of 0-index and potential header
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }

        // Small delay to prevent UI blocking
        if (i % 10 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      this.importResults.set(result);
      this.showResults.set(true);
      this.importCompleted.emit(result);

      this.loggingService.info('Import completed', {
        total: result.total,
        successful: result.successful,
        failed: result.failed,
      });
    } catch (error) {
      this.loggingService.error('Import failed', error);

      const errorResult: ImportResult = {
        total: 0,
        successful: 0,
        failed: 1,
        errors: [{ row: 0, error: 'Failed to process file' }],
        warnings: [],
      };

      this.importResults.set(errorResult);
      this.showResults.set(true);
    } finally {
      this.isProcessing.set(false);
      this.importProgress.set(100);
    }
  }

  private parseCSVRow(row: string): string[] {
    // Simple CSV parser - in production, use a proper CSV library
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < row.length; i++) {
      const char = row[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current.trim());
    return result;
  }

  private mapRowToUser(rowData: string[], rowNumber: number): Partial<User> {
    const [name, email, cpf, isActive, rolesStr] = rowData;

    // Validate required fields
    if (!name || !email) {
      throw new Error(`Missing required fields (name, email)`);
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error(`Invalid email format: ${email}`);
    }

    // Parse roles
    const roles = this.parseRolesString(rolesStr || '');

    return {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      cpf: cpf?.trim() || undefined,
      isActive: isActive ? isActive.toLowerCase() === 'true' : true,
      // TODO:
      // roles,
    };
  }

  private parseRolesString(rolesStr: string): Array<{ moduleId: string; role: string }> {
    if (!rolesStr) return [];

    return rolesStr
      .split(';')
      .map((roleStr) => roleStr.trim())
      .filter((roleStr) => roleStr.includes(':'))
      .map((roleStr) => {
        const [moduleId, role] = roleStr.split(':');
        return { moduleId: moduleId.trim(), role: role.trim() };
      });
  }

  private async createOrUpdateUser(userData: Partial<User>, updateExisting: boolean): Promise<void> {
    // Check if user exists
    const existingUser = this.userStore.users().find((u) => u.email === userData.email);

    if (existingUser && !updateExisting) {
      throw new Error(`User already exists: ${userData.email}`);
    }

    if (existingUser && updateExisting) {
      // Update existing user
      this.userStore.updateUser({
        userId: existingUser.id,
        data: userData,
      });
    } else {
      // Create new user
      this.userStore.createUser(userData);
    }

    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Export functions
  async exportUsers(): Promise<void> {
    const form = this.exportForm();
    if (!form.valid) return;

    this.isProcessing.set(true);
    this.exportProgress.set(0);

    try {
      const options: ExportOptions = {
        format: form.value.format,
        includeInactive: form.value.includeInactive,
        includeRoles: form.value.includeRoles,
        includePersonalData: form.value.includePersonalData,
        moduleIds: form.value.moduleIds || [],
      };

      if (form.value.dateRangeEnabled) {
        options.dateRange = {
          from: form.value.dateFrom,
          to: form.value.dateTo,
        };
      }

      // Get filtered users
      let users = this.getFilteredUsers(options);

      this.exportProgress.set(30);

      // Generate export data
      const exportData = await this.generateExportData(users, options);

      this.exportProgress.set(60);

      // Create and download file
      await this.downloadFile(exportData, options.format);

      this.exportProgress.set(100);

      this.exportCompleted.emit({
        format: options.format,
        count: users.length,
      });

      this.loggingService.info('Export completed', {
        format: options.format,
        count: users.length,
      });
    } catch (error) {
      this.loggingService.error('Export failed', error);
    } finally {
      this.isProcessing.set(false);
      setTimeout(() => this.exportProgress.set(0), 2000);
    }
  }

  private getFilteredUsers(options: ExportOptions): User[] {
    let users = this.userStore.users();

    // Filter by active status
    if (!options.includeInactive) {
      users = users.filter((user) => user.isActive);
    }

    // Filter by modules
    if (options.moduleIds.length > 0) {
      users = users.filter((user) => user.roles.some((role) => options.moduleIds.includes(role.moduleId)));
    }

    // Filter by date range (mock implementation)
    if (options.dateRange) {
      users = users.filter((user) => {
        const userDate = new Date(user.createdAt);
        return userDate >= options.dateRange!.from && userDate <= options.dateRange!.to;
      });
    }

    return users;
  }

  private async generateExportData(users: User[], options: ExportOptions): Promise<any> {
    switch (options.format) {
      case 'csv':
        return this.generateCSV(users, options);
      case 'xlsx':
        return this.generateXLSX(users, options);
      case 'json':
        return this.generateJSON(users, options);
      default:
        throw new Error(`Unsupported format: ${options.format}`);
    }
  }

  private generateCSV(users: User[], options: ExportOptions): string {
    const headers = this.getExportHeaders(options);
    const rows = users.map((user) => this.userToExportRow(user, options));

    return [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n');
  }

  private generateXLSX(users: User[], options: ExportOptions): Blob {
    // Mock XLSX generation - in production, use a library like SheetJS
    const csv = this.generateCSV(users, options);
    return new Blob([csv], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  private generateJSON(users: User[], options: ExportOptions): string {
    const exportUsers = users.map((user) => {
      const exportUser: any = {
        id: user.id,
        name: user.name,
        email: user.email,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      };

      if (options.includePersonalData) {
        exportUser.cpf = user.cpf;
        exportUser.lastLogin = user.lastLogin;
      }

      if (options.includeRoles) {
        exportUser.roles = user.roles;
      }

      return exportUser;
    });

    return JSON.stringify(
      {
        exportDate: new Date().toISOString(),
        totalUsers: exportUsers.length,
        users: exportUsers,
      },
      null,
      2,
    );
  }

  private getExportHeaders(options: ExportOptions): string[] {
    const headers = ['ID', 'Name', 'Email', 'Status', 'Created At'];

    if (options.includePersonalData) {
      headers.push('CPF', 'Last Login');
    }

    if (options.includeRoles) {
      headers.push('Roles');
    }

    return headers;
  }

  private userToExportRow(user: User, options: ExportOptions): string[] {
    const row = [user.id, user.name, user.email, user.isActive ? 'Active' : 'Inactive', user.createdAt.toISOString()];

    if (options.includePersonalData) {
      row.push(user.cpf || '', user.lastLogin ? user.lastLogin.toISOString() : '');
    }

    if (options.includeRoles) {
      const rolesStr = user.roles.map((r) => `${r.moduleId}:${r.role}`).join('; ');
      row.push(rolesStr);
    }

    return row;
  }

  private async downloadFile(data: any, format: string): Promise<void> {
    let blob: Blob;
    let filename: string;
    const timestamp = new Date().toISOString().split('T')[0];

    switch (format) {
      case 'csv':
        blob = new Blob([data], { type: 'text/csv' });
        filename = `users-export-${timestamp}.csv`;
        break;
      case 'xlsx':
        blob = data;
        filename = `users-export-${timestamp}.xlsx`;
        break;
      case 'json':
        blob = new Blob([data], { type: 'application/json' });
        filename = `users-export-${timestamp}.json`;
        break;
      default:
        throw new Error(`Unsupported format: ${format}`);
    }

    // Create download link
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  // Utility functions
  downloadTemplate(): void {
    const headers = this.csvTemplate;
    const sampleData = ['John Doe', 'john.doe@example.com', '123.456.789-00', 'true', 'users:manager;content:creator'];

    const csv = [headers, sampleData].map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'user-import-template.csv';
    a.click();
    window.URL.revokeObjectURL(url);

    this.loggingService.info('Template downloaded');
  }

  resetForms(): void {
    this.importForm.set(this.createImportForm());
    this.exportForm.set(this.createExportForm());
    this.uploadedFile.set(null);
    this.previewData.set([]);
    this.importResults.set(null);
    this.showResults.set(false);
    this.importProgress.set(0);
    this.exportProgress.set(0);
  }

  closeResults(): void {
    this.showResults.set(false);
    this.importResults.set(null);
  }
}
