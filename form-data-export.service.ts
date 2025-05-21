import { Injectable } from '@angular/core';
import * as FileSaver from 'file-saver';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

/**
 * Interface para configuração de exportação de dados
 */
export interface ExportConfig {
  filename: string;
  title?: string;
  sheetName?: string;
  includeTimestamp?: boolean;
  dateFormat?: string;
  companyName?: string;
  logoUrl?: string;
  creator?: string;
}

/**
 * Interface para configuração de colunas para exportação
 */
export interface ExportColumn {
  field: string;
  header: string;
  format?: (value: any) => string;
  width?: number;
}

/**
 * Serviço para exportação de dados de formulários
 * Oferece funcionalidades para exportar em CSV e PDF
 */
@Injectable({
  providedIn: 'root',
})
export class FormExportService {
  private defaultConfig: ExportConfig = {
    filename: 'export',
    includeTimestamp: true,
    dateFormat: 'dd/MM/yyyy HH:mm',
    companyName: 'Sistema de Formulários',
  };

  /**
   * Exporta dados para CSV
   */
  exportToCSV<T>(data: T[], columns: ExportColumn[], config?: Partial<ExportConfig>): void {
    // Mesclar com configurações padrão
    const mergedConfig = { ...this.defaultConfig, ...config };

    // Criar nome do arquivo com timestamp se necessário
    const filename = this.getFilename(mergedConfig, 'csv');

    // Criar cabeçalho
    const headers = columns.map((col) => col.header);

    // Criar linhas
    const rows = data.map((item) =>
      columns.map((col) => {
        const value = this.getNestedValue(item, col.field);
        return col.format ? col.format(value) : value;
      }),
    );

    // Combinar tudo em um CSV
    const csv = [headers.join(','), ...rows.map((row) => row.map((cell) => this.escapeCSVValue(cell)).join(','))].join('\n');

    // Criar blob e salvar
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    FileSaver.saveAs(blob, filename);
  }

  /**
   * Exporta dados para Excel
   * Nesta versão simplificada, usamos CSV que o Excel pode abrir
   */
  exportToExcel<T>(data: T[], columns: ExportColumn[], config?: Partial<ExportConfig>): void {
    // Mesclar com configurações padrão
    const mergedConfig = { ...this.defaultConfig, ...config };

    // Criar nome do arquivo com timestamp se necessário
    const filename = this.getFilename(mergedConfig, 'xlsx');

    // Criar cabeçalho
    const headers = columns.map((col) => col.header);

    // Criar linhas
    const rows = data.map((item) =>
      columns.map((col) => {
        const value = this.getNestedValue(item, col.field);
        return col.format ? col.format(value) : value;
      }),
    );

    // Combinar tudo em um CSV
    const csv = [headers.join('\t'), ...rows.map((row) => row.map((cell) => this.escapeExcelValue(cell)).join('\t'))].join('\n');

    // Criar blob e salvar
    const blob = new Blob(['\ufeff' + csv], { type: 'application/vnd.ms-excel;charset=utf-8' });
    FileSaver.saveAs(blob, filename);
  }

  /**
   * Exporta dados para PDF
   */
  exportToPDF<T>(data: T[], columns: ExportColumn[], config?: Partial<ExportConfig>): void {
    // Mesclar com configurações padrão
    const mergedConfig = { ...this.defaultConfig, ...config };

    // Criar nome do arquivo com timestamp se necessário
    const filename = this.getFilename(mergedConfig, 'pdf');

    // Criar documento PDF
    const doc = new jsPDF();

    // Adicionar título
    if (mergedConfig.title) {
      doc.setFontSize(18);
      doc.text(mergedConfig.title, 14, 22);
      doc.setFontSize(12);
    }

    // Adicionar data/hora
    if (mergedConfig.includeTimestamp) {
      const timestamp = this.formatDate(new Date(), mergedConfig.dateFormat);
      doc.setFontSize(10);
      doc.text(`Gerado em: ${timestamp}`, 14, mergedConfig.title ? 30 : 22);
      doc.setFontSize(12);
    }

    // Adicionar logo se disponível
    if (mergedConfig.logoUrl) {
      try {
        // Placeholder para logo - na implementação real, precisaríamos carregar a imagem
        // e convertê-la para formato compatível com jsPDF
        doc.addImage(mergedConfig.logoUrl, 'JPEG', 170, 10, 25, 25);
      } catch (e) {
        console.error('Erro ao adicionar logo ao PDF', e);
      }
    }

    // Preparar dados para tabela
    const headers = columns.map((col) => col.header);

    const rows = data.map((item) =>
      columns.map((col) => {
        const value = this.getNestedValue(item, col.field);
        return col.format ? col.format(value) : String(value);
      }),
    );

    // Configurar larguras das colunas
    const columnStyles: Record<number, { cellWidth?: number }> = {};
    columns.forEach((col, index) => {
      if (col.width) {
        columnStyles[index] = { cellWidth: col.width };
      }
    });

    // Adicionar tabela ao PDF
    autoTable(doc, {
      head: [headers],
      body: rows,
      startY: mergedConfig.title ? 35 : 25,
      columnStyles,
      theme: 'striped',
      headStyles: {
        fillColor: [63, 81, 181],
        textColor: 255,
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: [240, 240, 240],
      },
    });

    // Adicionar rodapé
    if (mergedConfig.companyName) {
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.text(
          `${mergedConfig.companyName} - Página ${i} de ${pageCount}`,
          doc.internal.pageSize.getWidth() / 2,
          doc.internal.pageSize.getHeight() - 10,
          { align: 'center' },
        );
      }
    }

    // Salvar documento
    doc.save(filename);
  }

  /**
   * Gera nome de arquivo com timestamp se necessário
   */
  private getFilename(config: ExportConfig, extension: string): string {
    let filename = config.filename;

    if (config.includeTimestamp) {
      const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
      filename = `${filename}_${timestamp}`;
    }

    return `${filename}.${extension}`;
  }

  /**
   * Formata uma data para string conforme formato especificado
   */
  private formatDate(date: Date, format: string = 'dd/MM/yyyy'): string {
    // Implementação simplificada - em produção, use uma biblioteca como date-fns
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');

    let result = format;
    result = result.replace('dd', day);
    result = result.replace('MM', month);
    result = result.replace('yyyy', year.toString());
    result = result.replace('HH', hours);
    result = result.replace('mm', minutes);

    return result;
  }

  /**
   * Escapa valor para CSV
   */
  private escapeCSVValue(value: any): string {
    if (value === null || value === undefined) {
      return '';
    }

    const str = String(value);

    // Se contém vírgula, aspas ou quebra de linha, colocar entre aspas
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      // Escapar aspas duplicando-as
      return `"${str.replace(/"/g, '""')}"`;
    }

    return str;
  }

  /**
   * Escapa valor para Excel
   */
  private escapeExcelValue(value: any): string {
    if (value === null || value === undefined) {
      return '';
    }

    const str = String(value);

    // Se contém tab ou quebra de linha, colocar entre aspas
    if (str.includes('\t') || str.includes('\n')) {
      // Escapar aspas duplicando-as
      return `"${str.replace(/"/g, '""')}"`;
    }

    return str;
  }

  /**
   * Obtém valor de propriedade aninhada (suporta 'user.address.city')
   */
  private getNestedValue(obj: any, path: string): any {
    if (!obj || !path) {
      return null;
    }

    // Lidar com campos aninhados (user.address.city)
    const keys = path.split('.');
    let value = obj;

    for (const key of keys) {
      if (value === null || value === undefined) {
        return null;
      }
      value = value[key];
    }

    return value;
  }
}
