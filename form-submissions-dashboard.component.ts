// form-submissions-dashboard.component.ts
import { Component, OnInit, Input, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';

import {} from '@component/form-submissions-dashboard';
import { FormDataVisualizationComponent, FormDataVisualizationConfig, FormMetricCardComponent } from '@component/form-data-visualization';
import { FormExportButtonsComponent } from '@component/form-export-button';

export interface FormSubmissionMetrics {
  totalSubmissions: number;
  completionRate: number;
  averageCompletionTime: number;
  errorRate: number;
  submissionsToday: number;
  submissionsGrowth: number;
  abandonmentRate: number;
  topErrors: { field: string; count: number }[];
}

export interface FormUsageData {
  periodLabels: string[];
  submissions: number[];
  completions: number[];
  abandonments: number[];
  errors: number[];
}

export interface FormFieldUsageData {
  field: string;
  completionRate: number;
  errorRate: number;
  averageTimeSpent: number;
}

@Component({
  selector: 'o-form-submissions-dashboard',
  standalone: true,
  imports: [CommonModule, FormMetricCardComponent, FormDataVisualizationComponent, FormExportButtonsComponent],
  template: `
    <div class="dashboard-container" [class.dark]="theme === 'dark'">
      <div class="dashboard-header">
        <h1 class="dashboard-title">{{ title() }}</h1>
        <div class="dashboard-actions">
          <button class="refresh-button" (click)="refreshData()"><span class="icon">🔄</span> Atualizar</button>
          <div class="theme-toggle">
            <button class="theme-button" [class.active]="theme === 'light'" (click)="theme = 'light'">☀️</button>
            <button class="theme-button" [class.active]="theme === 'dark'" (click)="theme = 'dark'">🌙</button>
          </div>
        </div>
      </div>

      <!-- Métricas principais -->
      <div class="metrics-grid">
        <o-form-metric-card title="Total de Submissões" [value]="metrics.totalSubmissions" icon="📝" iconClass="icon-blue" [theme]="theme" />

        <o-form-metric-card
          title="Taxa de Conclusão"
          [value]="formatPercent(metrics.completionRate)"
          icon="✓"
          iconClass="icon-green"
          [theme]="theme"
        />

        <o-form-metric-card
          title="Tempo Médio de Preenchimento"
          [value]="formatTime(metrics.averageCompletionTime)"
          icon="⏱️"
          iconClass="icon-blue"
          [theme]="theme"
        />

        <o-form-metric-card title="Taxa de Erro" [value]="formatPercent(metrics.errorRate)" icon="⚠️" iconClass="icon-red" [theme]="theme" />
      </div>

      <!-- Segunda linha de métricas -->
      <div class="metrics-grid">
        <o-form-metric-card
          title="Submissões Hoje"
          [value]="metrics.submissionsToday"
          [trend]="metrics.submissionsGrowth"
          period="vs. ontem"
          icon="📅"
          iconClass="icon-blue"
          [theme]="theme"
        />

        <o-form-metric-card
          title="Taxa de Abandono"
          [value]="formatPercent(metrics.abandonmentRate)"
          icon="🚶"
          iconClass="icon-yellow"
          [theme]="theme"
        />

        <o-form-metric-card title="Campos Mais Problemáticos" [value]="topErrorField" icon="🔍" iconClass="icon-red" [theme]="theme" />
      </div>

      <!-- Gráficos -->
      <div class="charts-container">
        <div class="chart-item">
          <o-form-data-visualization [config]="submissionsChartConfig" />
        </div>

        <div class="chart-item">
          <o-form-data-visualization [config]="fieldErrorsChartConfig" />
        </div>
      </div>

      <!-- Tabela de desempenho dos campos -->
      <div class="fields-performance-section">
        <div class="section-header">
          <h2 class="section-title">Desempenho por Campo</h2>
          <o-form-export-buttons
            [data]="fieldsData"
            [columns]="fieldsColumns"
            [config]="{ filename: 'desempenho_campos', title: 'Relatório de Desempenho por Campo' }"
          />
        </div>

        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Campo</th>
                <th>Taxa de Preenchimento</th>
                <th>Taxa de Erro</th>
                <th>Tempo Médio (s)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let field of fieldsData">
                <td>{{ field.field }}</td>
                <td>{{ formatPercent(field.completionRate) }}</td>
                <td>{{ formatPercent(field.errorRate) }}</td>
                <td>{{ field.averageTimeSpent.toFixed(1) }}</td>
                <td>
                  <span
                    class="status-badge"
                    [class.status-good]="field.errorRate < 0.05"
                    [class.status-warning]="field.errorRate >= 0.05 && field.errorRate < 0.15"
                    [class.status-bad]="field.errorRate >= 0.15"
                  >
                    {{ getFieldStatus(field.errorRate) }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .dashboard-container {
        @apply w-full p-4 max-w-7xl mx-auto;
      }

      .dark {
        @apply bg-gray-900 text-white;
      }

      .dashboard-header {
        @apply flex justify-between items-center mb-6;
      }

      .dashboard-title {
        @apply text-2xl font-bold;
      }

      .dashboard-actions {
        @apply flex items-center space-x-4;
      }

      .refresh-button {
        @apply px-4 py-2 bg-blue-600 text-white rounded-md flex items-center hover:bg-blue-700 transition;
      }

      .dark .refresh-button {
        @apply bg-blue-800 hover:bg-blue-700;
      }

      .theme-toggle {
        @apply flex bg-gray-200 rounded-lg overflow-hidden;
      }

      .dark .theme-toggle {
        @apply bg-gray-700;
      }

      .theme-button {
        @apply px-3 py-2 border-none;
      }

      .theme-button.active {
        @apply bg-white;
      }

      .dark .theme-button.active {
        @apply bg-gray-800;
      }

      .metrics-grid {
        @apply grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6;
      }

      .charts-container {
        @apply grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6;
      }

      .fields-performance-section {
        @apply bg-white rounded-lg shadow-md p-4 mb-6;
      }

      .dark .fields-performance-section {
        @apply bg-gray-800;
      }

      .section-header {
        @apply flex justify-between items-center mb-4;
      }

      .section-title {
        @apply text-lg font-semibold;
      }

      .table-container {
        @apply overflow-x-auto;
      }

      .data-table {
        @apply w-full border-collapse text-sm;
      }

      .data-table th {
        @apply px-4 py-3 text-left bg-gray-100 font-medium text-gray-700;
      }

      .dark .data-table th {
        @apply bg-gray-700 text-gray-200;
      }

      .data-table td {
        @apply px-4 py-3 border-t border-gray-200;
      }

      .dark .data-table td {
        @apply border-gray-700;
      }

      .data-table tr:hover td {
        @apply bg-gray-50;
      }

      .dark .data-table tr:hover td {
        @apply bg-gray-700;
      }

      .status-badge {
        @apply inline-block px-2 py-1 rounded-full text-xs font-medium;
      }

      .status-good {
        @apply bg-green-100 text-green-800;
      }

      .dark .status-good {
        @apply bg-green-900 text-green-200;
      }

      .status-warning {
        @apply bg-yellow-100 text-yellow-800;
      }

      .dark .status-warning {
        @apply bg-yellow-900 text-yellow-200;
      }

      .status-bad {
        @apply bg-red-100 text-red-800;
      }

      .dark .status-bad {
        @apply bg-red-900 text-red-200;
      }

      .icon {
        @apply mr-1;
      }
    `,
  ],
})
export class FormSubmissionsDashboardComponent implements OnInit {
  readonly formId = input<string>(undefined);
  readonly title = input<string>('Dashboard de Formulários');
  @Input() theme: 'light' | 'dark' = 'light';

  // Dados de métricas
  metrics: FormSubmissionMetrics = {
    totalSubmissions: 0,
    completionRate: 0,
    averageCompletionTime: 0,
    errorRate: 0,
    submissionsToday: 0,
    submissionsGrowth: 0,
    abandonmentRate: 0,
    topErrors: [],
  };

  // Dados de uso
  usageData: FormUsageData = {
    periodLabels: [],
    submissions: [],
    completions: [],
    abandonments: [],
    errors: [],
  };

  // Dados de campos
  fieldsData: FormFieldUsageData[] = [];

  // Configurações de gráficos
  submissionsChartConfig: FormDataVisualizationConfig = {
    type: 'line',
    title: 'Submissões de Formulário',
    labels: [],
    series: [],
    showLegend: true,
  };

  fieldErrorsChartConfig: FormDataVisualizationConfig = {
    type: 'bar',
    title: 'Campos com Mais Erros',
    labels: [],
    series: [],
    showLegend: false,
  };

  // Configuração para exportação
  fieldsColumns = [
    { field: 'field', header: 'Campo' },
    { field: 'completionRate', header: 'Taxa de Preenchimento', format: (value: number) => `${(value * 100).toFixed(1)}%` },
    { field: 'errorRate', header: 'Taxa de Erro', format: (value: number) => `${(value * 100).toFixed(1)}%` },
    { field: 'averageTimeSpent', header: 'Tempo Médio (s)', format: (value: number) => value.toFixed(1) },
  ];

  // Auxiliares
  get topErrorField(): string {
    return this.metrics.topErrors.length > 0 ? this.metrics.topErrors[0].field : 'Nenhum';
  }

  ngOnInit() {
    this.loadDashboardData();
  }

  /**
   * Carrega os dados do dashboard
   * Na implementação real, isso viria de uma API
   */
  loadDashboardData() {
    // Simular carga de dados
    setTimeout(() => {
      // Dados simulados para demonstração
      this.metrics = {
        totalSubmissions: 1247,
        completionRate: 0.68,
        averageCompletionTime: 183,
        errorRate: 0.12,
        submissionsToday: 53,
        submissionsGrowth: 12.5,
        abandonmentRate: 0.22,
        topErrors: [
          { field: 'CPF', count: 35 },
          { field: 'E-mail', count: 28 },
          { field: 'CEP', count: 22 },
          { field: 'Senha', count: 18 },
        ],
      };

      // Dados de uso para gráficos
      const labels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

      this.usageData = {
        periodLabels: labels,
        submissions: [42, 58, 69, 53, 48, 32, 39],
        completions: [28, 35, 42, 38, 30, 22, 27],
        abandonments: [14, 23, 27, 15, 18, 10, 12],
        errors: [8, 12, 15, 10, 7, 5, 8],
      };

      // Atualizar config do gráfico de submissões
      this.submissionsChartConfig = {
        type: 'line',
        title: 'Submissões de Formulário (Últimos 7 dias)',
        labels: this.usageData.periodLabels,
        series: [
          {
            name: 'Submissões',
            data: this.usageData.submissions,
            color: '#4F46E5', // Indigo
          },
          {
            name: 'Completados',
            data: this.usageData.completions,
            color: '#10B981', // Emerald
          },
          {
            name: 'Abandonados',
            data: this.usageData.abandonments,
            color: '#F59E0B', // Amber
          },
        ],
        showLegend: true,
        theme: this.theme,
      };

      // Dados de campos
      this.fieldsData = [
        { field: 'Nome', completionRate: 0.98, errorRate: 0.02, averageTimeSpent: 3.2 },
        { field: 'E-mail', completionRate: 0.95, errorRate: 0.08, averageTimeSpent: 5.7 },
        { field: 'CPF', completionRate: 0.88, errorRate: 0.18, averageTimeSpent: 8.3 },
        { field: 'Data de Nascimento', completionRate: 0.92, errorRate: 0.05, averageTimeSpent: 6.1 },
        { field: 'Telefone', completionRate: 0.9, errorRate: 0.07, averageTimeSpent: 7.4 },
        { field: 'CEP', completionRate: 0.85, errorRate: 0.15, averageTimeSpent: 9.2 },
        { field: 'Endereço', completionRate: 0.88, errorRate: 0.03, averageTimeSpent: 12.5 },
        { field: 'Senha', completionRate: 0.95, errorRate: 0.12, averageTimeSpent: 10.8 },
      ];

      // Atualizar config do gráfico de erros
      const sortedFields = [...this.fieldsData].sort((a, b) => b.errorRate - a.errorRate).slice(0, 5);

      this.fieldErrorsChartConfig = {
        type: 'bar',
        title: 'Top 5 Campos com Mais Erros',
        labels: sortedFields.map((f) => f.field),
        series: [
          {
            name: 'Taxa de Erro',
            data: sortedFields.map((f) => f.errorRate * 100),
            color: '#EF4444', // Red
          },
        ],
        showLegend: false,
        theme: this.theme,
      };
    }, 500);
  }

  /**
   * Atualiza os dados do dashboard
   */
  refreshData() {
    this.loadDashboardData();
  }

  /**
   * Formata valor percentual
   */
  formatPercent(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
  }

  /**
   * Formata tempo em segundos
   */
  formatTime(seconds: number): string {
    if (seconds < 60) {
      return `${seconds.toFixed(0)}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
  }

  /**
   * Determina status do campo com base na taxa de erro
   */
  getFieldStatus(errorRate: number): string {
    if (errorRate < 0.05) {
      return 'Bom';
    } else if (errorRate < 0.15) {
      return 'Atenção';
    } else {
      return 'Problema';
    }
  }
}
