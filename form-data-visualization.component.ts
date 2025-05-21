// form-data-visualization.component.ts
import { Component, Input, OnInit, OnChanges, SimpleChanges, ElementRef, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import Chart from 'chart.js/auto';

export interface FormDataSeries {
  name: string;
  data: number[];
  color?: string;
}

export interface FormDataVisualizationConfig {
  type: 'bar' | 'line' | 'pie' | 'doughnut';
  title: string;
  labels: string[];
  series: FormDataSeries[];
  height?: number;
  showLegend?: boolean;
  stacked?: boolean;
  theme?: 'light' | 'dark'; // Para suporte a dark mode
}

/**
 * Componente para visualização de dados de formulários
 * Implementa gráficos simples usando Chart.js
 */
@Component({
  selector: 'o-form-data-visualization',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="form-visualization-container" [class.dark]="config?.theme === 'dark'">
      <div class="chart-header" *ngIf="config?.title">
        <h3 class="chart-title">{{ config?.title }}</h3>
        <div class="chart-actions">
          <button
            *ngFor="let type of availableChartTypes"
            (click)="updateChartType(type)"
            class="chart-type-button"
            [class.active]="type === activeChartType"
          >
            {{ getChartTypeName(type) }}
          </button>
        </div>
      </div>
      <div class="chart-container">
        <div *ngIf="loading" class="chart-loading">
          <div class="loading-spinner"></div>
          <span>Carregando visualização...</span>
        </div>
        <canvas #chartCanvas></canvas>
      </div>
    </div>
  `,
  styles: [
    `
      .form-visualization-container {
        @apply rounded-lg shadow-md bg-white p-4 mb-6 w-full;
      }

      .dark {
        @apply bg-gray-800 text-white;
      }

      .chart-header {
        @apply flex justify-between items-center mb-4;
      }

      .chart-title {
        @apply text-lg font-semibold;
      }

      .chart-actions {
        @apply flex space-x-2;
      }

      .chart-type-button {
        @apply px-3 py-1 text-sm rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100;
      }

      .dark .chart-type-button {
        @apply bg-gray-700 text-gray-200 border-gray-600 hover:bg-gray-600;
      }

      .chart-type-button.active {
        @apply bg-blue-500 text-white border-blue-500 hover:bg-blue-600;
      }

      .dark .chart-type-button.active {
        @apply bg-blue-600 border-blue-600 hover:bg-blue-700;
      }

      .chart-container {
        @apply relative h-64 w-full;
      }

      .chart-loading {
        @apply absolute inset-0 flex flex-col items-center justify-center bg-white bg-opacity-80 z-10;
      }

      .dark .chart-loading {
        @apply bg-gray-800 bg-opacity-80;
      }

      .loading-spinner {
        @apply w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-2;
      }
    `,
  ],
})
export class FormDataVisualizationComponent implements OnInit, OnChanges {
  @Input() config?: FormDataVisualizationConfig;
  @ViewChild('chartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;

  // Estado do componente
  chart: Chart | null = null;
  loading = true;
  activeChartType: 'bar' | 'line' | 'pie' | 'doughnut' = 'bar';
  availableChartTypes = ['bar', 'line', 'pie', 'doughnut'];

  // Cores padrão para datasets
  private defaultColors = [
    '#4F46E5', // Indigo
    '#10B981', // Emerald
    '#F59E0B', // Amber
    '#EF4444', // Red
    '#8B5CF6', // Violet
    '#EC4899', // Pink
    '#06B6D4', // Cyan
    '#F97316', // Orange
  ];

  ngOnInit() {
    if (this.config) {
      this.activeChartType = this.config.type;
      setTimeout(() => this.initChart(), 0);
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['config'] && !changes['config'].firstChange) {
      if (this.chart) {
        this.chart.destroy();
      }
      this.initChart();
    }
  }

  /**
   * Inicializa o gráfico com as configurações fornecidas
   */
  private initChart() {
    if (!this.config || !this.chartCanvas) {
      this.loading = false;
      return;
    }

    this.loading = true;

    // Timeout para permitir que o DOM seja atualizado primeiro
    setTimeout(() => {
      const ctx = this.chartCanvas.nativeElement.getContext('2d');
      if (!ctx) {
        this.loading = false;
        return;
      }

      // Prepara dados para o Chart.js com base no tipo de gráfico
      let datasets;

      if (this.activeChartType === 'pie' || this.activeChartType === 'doughnut') {
        // Configuração para gráfico de pizza/rosca
        // Para este tipo, pegamos apenas o primeiro valor de cada série
        datasets = [
          {
            data: this.config!.series.map((s) => s.data[0] || 0),
            backgroundColor: this.config!.series.map((s, i) => s.color || this.defaultColors[i % this.defaultColors.length]),
            label: 'Dados',
          },
        ];
      } else {
        // Configuração para gráfico de barras ou linhas
        datasets = this.config!.series.map((series, index) => {
          return {
            label: series.name,
            data: series.data,
            backgroundColor: series.color || this.defaultColors[index % this.defaultColors.length],
            borderColor: series.color || this.defaultColors[index % this.defaultColors.length],
            borderWidth: this.activeChartType === 'line' ? 2 : 1,
            fill: this.activeChartType === 'line' ? false : true,
          };
        });
      }

      // Criar nova instância do Chart.js
      this.chart = new Chart(ctx, {
        type: this.activeChartType,
        data: {
          labels: this.config!.labels,
          datasets: datasets,
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: this.config!.showLegend !== false,
              position: 'top',
              labels: {
                color: this.config!.theme === 'dark' ? '#D1D5DB' : '#374151',
              },
            },
            title: {
              display: false,
            },
          },
          scales:
            this.activeChartType === 'pie' || this.activeChartType === 'doughnut'
              ? undefined
              : {
                  x: {
                    stacked: this.config!.stacked,
                    ticks: {
                      color: this.config!.theme === 'dark' ? '#D1D5DB' : '#374151',
                    },
                    grid: {
                      color: this.config!.theme === 'dark' ? '#374151' : '#E5E7EB',
                    },
                  },
                  y: {
                    stacked: this.config!.stacked,
                    beginAtZero: true,
                    ticks: {
                      color: this.config!.theme === 'dark' ? '#D1D5DB' : '#374151',
                    },
                    grid: {
                      color: this.config!.theme === 'dark' ? '#374151' : '#E5E7EB',
                    },
                  },
                },
        },
      });

      this.loading = false;
    }, 50);
  }

  /**
   * Atualiza o tipo de gráfico
   */
  updateChartType(type: string) {
    this.activeChartType = type as 'bar' | 'line' | 'pie' | 'doughnut';

    if (this.chart) {
      this.chart.destroy();
    }

    this.initChart();
  }

  /**
   * Obtém nome amigável para tipo de gráfico
   */
  getChartTypeName(type: string): string {
    const typeNames: Record<string, string> = {
      bar: 'Barras',
      line: 'Linhas',
      pie: 'Pizza',
      doughnut: 'Rosca',
    };

    return typeNames[type] || type;
  }
}

// Componente para painéis de métricas
@Component({
  selector: 'o-form-metric-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="metric-card" [class.dark]="theme === 'dark'">
      <div class="metric-icon" [class]="iconClass">
        <span>{{ icon }}</span>
      </div>
      <div class="metric-content">
        <h3 class="metric-title">{{ title }}</h3>
        <div class="metric-value">{{ value }}</div>
        <div class="metric-trend" *ngIf="trend !== undefined">
          <span class="trend-icon" [class.trend-up]="trend > 0" [class.trend-down]="trend < 0">
            {{ trend > 0 ? '↑' : trend < 0 ? '↓' : '→' }}
          </span>
          <span class="trend-value" [class.trend-up]="trend > 0" [class.trend-down]="trend < 0"> {{ trend > 0 ? '+' : '' }}{{ trend }}% </span>
          <span class="trend-period">{{ period }}</span>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .metric-card {
        @apply flex rounded-lg shadow-md p-4 bg-white;
      }

      .dark {
        @apply bg-gray-800 text-white;
      }

      .metric-icon {
        @apply flex items-center justify-center w-12 h-12 rounded-lg mr-4 text-xl;
      }

      .icon-blue {
        @apply bg-blue-100 text-blue-600;
      }

      .dark .icon-blue {
        @apply bg-blue-900 text-blue-300;
      }

      .icon-green {
        @apply bg-green-100 text-green-600;
      }

      .dark .icon-green {
        @apply bg-green-900 text-green-300;
      }

      .icon-yellow {
        @apply bg-yellow-100 text-yellow-600;
      }

      .dark .icon-yellow {
        @apply bg-yellow-900 text-yellow-300;
      }

      .icon-red {
        @apply bg-red-100 text-red-600;
      }

      .dark .icon-red {
        @apply bg-red-900 text-red-300;
      }

      .metric-content {
        @apply flex-1;
      }

      .metric-title {
        @apply text-sm text-gray-500 font-medium mb-1;
      }

      .dark .metric-title {
        @apply text-gray-400;
      }

      .metric-value {
        @apply text-2xl font-bold mb-1;
      }

      .metric-trend {
        @apply flex items-center text-sm;
      }

      .trend-icon {
        @apply mr-1;
      }

      .trend-value {
        @apply font-medium mr-1;
      }

      .trend-period {
        @apply text-gray-500;
      }

      .dark .trend-period {
        @apply text-gray-400;
      }

      .trend-up {
        @apply text-green-600;
      }

      .dark .trend-up {
        @apply text-green-400;
      }

      .trend-down {
        @apply text-red-600;
      }

      .dark .trend-down {
        @apply text-red-400;
      }
    `,
  ],
})
export class FormMetricCardComponent {
  @Input() title: string = '';
  @Input() value: string | number = '';
  @Input() icon: string = '📊';
  @Input() iconClass: string = 'icon-blue';
  @Input() trend?: number;
  @Input() period: string = 'vs. último mês';
  @Input() theme: 'light' | 'dark' = 'light';
}
