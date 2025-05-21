import { Component, OnInit, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ExportColumn, ExportConfig, FormExportService } from '@vai/services';

@Component({
  selector: 'o-form-export-buttons',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="export-buttons-container">
      <button type="button" class="export-button" [class.disabled]="!hasData" (click)="exportCSV()" [disabled]="!hasData">
        <span class="icon">📄</span>
        <span>CSV</span>
      </button>

      <button type="button" class="export-button excel-button" [class.disabled]="!hasData" (click)="exportExcel()" [disabled]="!hasData">
        <span class="icon">📊</span>
        <span>Excel</span>
      </button>

      <button type="button" class="export-button pdf-button" [class.disabled]="!hasData" (click)="exportPDF()" [disabled]="!hasData">
        <span class="icon">📑</span>
        <span>PDF</span>
      </button>
    </div>
  `,
  styles: [
    `
      .export-buttons-container {
        @apply flex space-x-2;
      }

      .export-button {
        @apply flex items-center px-3 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500;
      }

      .export-button.excel-button {
        @apply bg-green-600 hover:bg-green-700 focus:ring-green-500;
      }

      .export-button.pdf-button {
        @apply bg-red-600 hover:bg-red-700 focus:ring-red-500;
      }

      .export-button.disabled {
        @apply opacity-50 cursor-not-allowed;
      }

      .icon {
        @apply mr-1;
      }
    `,
  ],
})
export class FormExportButtonsComponent {
  readonly data = input<any[]>([]);
  readonly columns = input<ExportColumn[]>([]);
  readonly config = input<Partial<ExportConfig>>(undefined);

  private exportService = inject(FormExportService);

  get hasData(): boolean {
    const data = this.data();
    return data && data.length > 0;
  }

  exportCSV(): void {
    if (this.hasData) {
      this.exportService.exportToCSV(this.data(), this.columns(), this.config());
    }
  }

  exportExcel(): void {
    if (this.hasData) {
      this.exportService.exportToExcel(this.data(), this.columns(), this.config());
    }
  }

  exportPDF(): void {
    if (this.hasData) {
      this.exportService.exportToPDF(this.data(), this.columns(), this.config());
    }
  }
}
