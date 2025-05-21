import { Injectable, Inject, InjectionToken } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { LoggingService } from '@vai/services';

export interface StorageOptions {
  /** Expiration time in minutes (default: no expiration) */
  expiresIn?: number;
  /** Whether to use sessionStorage instead of localStorage */
  session?: boolean;
  /** Whether to encrypt the data (simple obfuscation) */
  encrypt?: boolean;
}

interface StorageItem<T> {
  data: T;
  expires?: number; // Timestamp
  version?: string; // For schema migrations
}

@Injectable({
  providedIn: 'root',
})
export class LocalStorageService {
  private readonly APP_PREFIX = 'insidebox_';
  private readonly VERSION = '1.0.0';
  private readonly isBrowser: boolean;

  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
    private loggingService: LoggingService,
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  /**
   * Set an item in storage with optional expiration
   */
  setItem<T>(key: string, data: T, options: StorageOptions = {}): boolean {
    if (!this.isBrowser) {
      return false;
    }

    try {
      const prefixedKey = this.APP_PREFIX + key;

      const storageItem: StorageItem<T> = {
        data,
        version: this.VERSION,
      };

      // Set expiration if specified
      if (options.expiresIn) {
        const now = new Date();
        storageItem.expires = now.getTime() + options.expiresIn * 60 * 1000;
      }

      const serializedData = JSON.stringify(storageItem);
      const finalData = options.encrypt ? this.encrypt(serializedData) : serializedData;

      // Use sessionStorage or localStorage based on options
      const storage = options.session ? sessionStorage : localStorage;
      storage.setItem(prefixedKey, finalData);

      this.loggingService.debug(`Storage item set: ${key}`, { expires: storageItem.expires });
      return true;
    } catch (error) {
      this.loggingService.error('Error setting storage item', { key, error });
      return false;
    }
  }

  /**
   * Get an item from storage, checking for expiration
   */
  getItem<T>(key: string, options: StorageOptions = {}): T | null {
    if (!this.isBrowser) {
      return null;
    }

    try {
      const prefixedKey = this.APP_PREFIX + key;

      // Use sessionStorage or localStorage based on options
      const storage = options.session ? sessionStorage : localStorage;
      const value = storage.getItem(prefixedKey);

      if (!value) {
        return null;
      }

      const decryptedValue = options.encrypt ? this.decrypt(value) : value;
      const storageItem: StorageItem<T> = JSON.parse(decryptedValue);

      // Check if item has expired
      if (storageItem.expires && new Date().getTime() > storageItem.expires) {
        this.loggingService.debug(`Storage item expired: ${key}`);
        storage.removeItem(prefixedKey);
        return null;
      }

      // Check version for possible migrations
      if (storageItem.version !== this.VERSION) {
        this.loggingService.debug(`Storage item version mismatch: ${key}`, {
          current: this.VERSION,
          stored: storageItem.version,
        });
        // Here you could implement migration logic if needed
      }

      return storageItem.data;
    } catch (error) {
      this.loggingService.error('Error getting storage item', { key, error });
      return null;
    }
  }

  /**
   * Remove an item from storage
   */
  removeItem(key: string, options: StorageOptions = {}): boolean {
    if (!this.isBrowser) {
      return false;
    }

    try {
      const prefixedKey = this.APP_PREFIX + key;
      const storage = options.session ? sessionStorage : localStorage;
      storage.removeItem(prefixedKey);
      this.loggingService.debug(`Storage item removed: ${key}`);
      return true;
    } catch (error) {
      this.loggingService.error('Error removing storage item', { key, error });
      return false;
    }
  }

  /**
   * Clear all items with our app prefix
   */
  clear(options: StorageOptions = {}): void {
    if (!this.isBrowser) {
      return;
    }

    try {
      const storage = options.session ? sessionStorage : localStorage;
      const keysToRemove: string[] = [];

      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key && key.startsWith(this.APP_PREFIX)) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach((key) => storage.removeItem(key));
      this.loggingService.debug(`Cleared ${keysToRemove.length} storage items`);
    } catch (error) {
      this.loggingService.error('Error clearing storage', { error });
    }
  }

  /**
   * Simple encryption for obfuscation (not secure for sensitive data)
   */
  private encrypt(data: string): string {
    // Simple base64 encoding for demonstration
    // In a real app, use a proper encryption library
    return btoa(data);
  }

  /**
   * Simple decryption for obfuscated data
   */
  private decrypt(data: string): string {
    // Simple base64 decoding for demonstration
    return atob(data);
  }
}
