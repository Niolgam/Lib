import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Serviço utilitário para operações criptográficas seguras
 * Fornece métodos para hash, comparação segura e outras funções de segurança
 */
@Injectable({
  providedIn: 'root',
})
export class CryptoService {
  private readonly isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }
  /**
   * Gera hash de string usando SHA-256 (ou outra técnica disponível)
   * @param input String para gerar hash
   * @returns Hash da string como string hexadecimal
   */
  async hashStringAsync(input: string): Promise<string> {
    if (!input) return '';

    try {
      // Usa Web Crypto API quando disponível (browsers modernos)
      if (this.isBrowser && window.crypto && window.crypto.subtle) {
        const encoder = new TextEncoder();
        const data = encoder.encode(input);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);

        // Converte ArrayBuffer para string hex
        return Array.from(new Uint8Array(hashBuffer))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      } else {
        // Fallback para algoritmo mais simples em ambientes sem crypto
        return this.simpleHash(input);
      }
    } catch (error) {
      console.error('Error hashing string', error);
      // Fallback em caso de erro
      return this.simpleHash(input);
    }
  }

  /**
   * Versão síncrona do hashString usando algoritmo mais simples
   * Menos seguro, mas serve como fallback quando crypto API não está disponível
   */
  hashString(input: string): string {
    if (!input) return '';

    // Implementação básica de hash para fallback
    return this.simpleHash(input);
  }

  /**
   * Compara duas strings de forma segura usando tempo constante
   * Evita timing attacks onde um atacante pode deduzir partes da string
   * pela diferença no tempo de comparação
   */
  compareStringsSecurely(a: string, b: string): boolean {
    if (a === undefined || b === undefined) return false;
    if (a.length !== b.length) return false;

    // Técnica de comparação de tempo constante
    // Sempre compara TODOS os caracteres, mesmo depois de encontrar diferença
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      // XOR bit a bit - dá 0 quando bits são iguais
      // Contudo, continuamos percorrendo toda a string, consumindo o mesmo tempo
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return result === 0;
  }

  /**
   * Gera ID único para identificação temporária
   */
  generateSecureId(length = 32): string {
    const array = new Uint8Array(length);
    if (this.isBrowser && window.crypto) {
      window.crypto.getRandomValues(array);
    } else {
      // Fallback menos seguro
      for (let i = 0; i < length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
    }

    return Array.from(array)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Implementação simples de hash para uso quando Web Crypto API não está disponível
   * @private
   */
  private simpleHash(input: string): string {
    let hash = 0;

    if (!input.length) return hash.toString(16);

    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      // Converte para int de 32 bits
      hash |= 0;
    }

    // Adiciona salt e timestamp para maior segurança
    const salt = 'b6a1de4c49fb33a482ee89ba6284c577';
    const timestamp = Math.floor(Date.now() / 3600000); // Horas desde epoch
    const saltedHash = hash + salt + timestamp;

    let finalHash = 0;
    for (let i = 0; i < saltedHash.length; i++) {
      const char = saltedHash.charCodeAt(i);
      finalHash = (finalHash << 5) - finalHash + char;
      finalHash |= 0;
    }

    return finalHash.toString(16);
  }
}

// Singleton para uso direto sem injeção de dependência não funciona com DI
// export const cryptoService = new CryptoService();
