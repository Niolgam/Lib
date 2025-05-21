// format.service.ts
import { Injectable, Inject, LOCALE_ID, inject, signal, computed } from '@angular/core';
import { formatDate, formatNumber, formatCurrency } from '@angular/common';

@Injectable({
  providedIn: 'root',
})
export class FormatService {
  private locale = inject(LOCALE_ID);

  // Signal para controlar o formato de data padrão (pode ser alterado em runtime)
  // TODO: pegar do CoreConfig
  private readonly defaultDateFormat = signal('mediumDate');
  private readonly defaultCurrency = signal('BRL');

  // Configurações computadas
  readonly currentDateFormat = this.defaultDateFormat.asReadonly();
  readonly currentCurrency = this.defaultCurrency.asReadonly();

  /**
   * Configura o formato de data padrão
   */
  setDefaultDateFormat(format: string): void {
    this.defaultDateFormat.set(format);
  }

  /**
   * Configura a moeda padrão
   */
  setDefaultCurrency(currency: string): void {
    this.defaultCurrency.set(currency);
  }

  /**
   * Formata uma data no padrão local
   */
  formatDate(date: Date | string | number | null | undefined, format?: string): string {
    if (date === null || date === undefined || date === '') return '';

    try {
      return formatDate(date, format || this.defaultDateFormat(), this.locale);
    } catch (error) {
      console.warn('Date format error:', error);
      return String(date);
    }
  }

  /**
   * Formata um tempo relativo a partir de uma data
   */
  getRelativeTime(date: Date | string | number | null | undefined): string {
    if (date === null || date === undefined || date === '') return '';

    const now = new Date();
    const targetDate = new Date(date);
    const diffInSeconds = Math.floor((now.getTime() - targetDate.getTime()) / 1000);

    if (diffInSeconds < 60) return `${diffInSeconds} seconds ago`;
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minutes ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
    if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)} days ago`;

    // Para datas mais antigas que um mês, usar formato padrão
    return this.formatDate(date);
  }

  /**
   * Formata um número
   */
  formatNumber(value: number | null | undefined, digitsInfo: string = '1.0-2'): string {
    if (value === null || value === undefined) return '';

    try {
      return formatNumber(value, this.locale, digitsInfo);
    } catch (error) {
      console.warn('Number format error:', error);
      return String(value);
    }
  }

  /**
   * Formata um valor monetário
   */
  formatCurrency(value: number | null | undefined, currencyCode?: string, digitsInfo: string = '1.2-2'): string {
    if (value === null || value === undefined) return '';

    try {
      return formatCurrency(value, this.locale, currencyCode || this.defaultCurrency(), undefined, digitsInfo);
    } catch (error) {
      console.warn('Currency format error:', error);
      return String(value);
    }
  }

  /**
   * Formata um CPF
   */
  formatCpf(cpf: string | null | undefined): string {
    if (!cpf) return '';

    // Remove caracteres não numéricos
    const numbers = cpf.replace(/\D/g, '');

    // Valida tamanho
    if (numbers.length !== 11) {
      return cpf;
    }

    // Aplica a máscara: 000.000.000-00
    return numbers.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }

  /**
   * Formata um telefone brasileiro
   */
  formatPhone(phone: string | null | undefined): string {
    if (!phone) return '';

    // Remove caracteres não numéricos
    const numbers = phone.replace(/\D/g, '');

    // Valida tamanho
    if (numbers.length < 10 || numbers.length > 11) {
      return phone;
    }

    // Celular (com 9 dígitos) ou fixo (com 8 dígitos)
    if (numbers.length === 11) {
      return numbers.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    } else {
      return numbers.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    }
  }

  /**
   * Trunca um texto com ellipsis
   */
  truncateText(text: string | null | undefined, maxLength: number = 100): string {
    if (!text) return '';
    if (text.length <= maxLength) return text;

    return text.substring(0, maxLength) + '...';
  }

  /**
   * Formata bytes em unidades legíveis (KB, MB, etc)
   */
  formatBytes(bytes: number, decimals: number = 2): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
  }
}
