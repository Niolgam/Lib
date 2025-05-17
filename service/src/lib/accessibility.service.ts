import { Injectable, inject, signal, computed, effect, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subject, of, catchError } from 'rxjs';
import { LocalStorageService } from './local-storage.service';
import { LoggingService } from './logging.service';

/**
 * Interface para configurações de acessibilidade do usuário
 */
export interface AccessibilitySettings {
  highContrast: boolean; // Alto contraste para deficiências visuais
  screenReader: boolean; // Usuário com leitor de tela
  reducedMotion: boolean; // Movimento reduzido para epilepsia/vestibular
  fontSize: number; // Tamanho de fonte (1-5)
  tabNavigation: boolean; // Navegação por tab
  keyboardOnly: boolean; // Usuário que navega apenas por teclado
  autoplayDisabled: boolean; // Desativar reprodução automática de mídia
  subtitlesEnabled: boolean; // Legendas ativadas
  colorBlindMode: string; // Modo para daltonismo (protanopia, deuteranopia, etc.)
  readingAssistance: boolean; // Assistência de leitura para dislexia
  soundDisabled: boolean; // Som desativado
  customKeyboardShortcuts: Record<string, string>; // Atalhos personalizados
}

/**
 * Valores padrão para configurações de acessibilidade
 */
const DEFAULT_ACCESSIBILITY_SETTINGS: AccessibilitySettings = {
  highContrast: false,
  screenReader: false,
  reducedMotion: false,
  fontSize: 2, // Normal
  tabNavigation: false,
  keyboardOnly: false,
  autoplayDisabled: false,
  subtitlesEnabled: false,
  colorBlindMode: 'none',
  readingAssistance: false,
  soundDisabled: false,
  customKeyboardShortcuts: {},
};

/**
 * Serviço para gerenciar configurações de acessibilidade
 * Permite detecção automática e configurações personalizadas
 */
@Injectable({
  providedIn: 'root',
})
export class AccessibilityService {
  private http = inject(HttpClient);
  private localStorageService = inject(LocalStorageService);
  private loggingService = inject(LoggingService);
  // private authStore = inject(AuthStore);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly STORAGE_KEY = 'accessibility_settings';

  // Estado para configurações de acessibilidade
  private readonly userSettingsState = signal<AccessibilitySettings>(DEFAULT_ACCESSIBILITY_SETTINGS);

  // Signal público para configurações de acessibilidade
  public readonly userAccessibilitySettings = this.userSettingsState.asReadonly();

  // Emite eventos quando as configurações de acessibilidade são alteradas
  public readonly accessibilitySettingsChanged = new Subject<AccessibilitySettings>();

  // Computed signals para configurações específicas
  public readonly isHighContrastEnabled = computed(() => this.userSettingsState().highContrast);
  public readonly isReducedMotionEnabled = computed(() => this.userSettingsState().reducedMotion);
  public readonly isScreenReaderEnabled = computed(() => this.userSettingsState().screenReader);
  public readonly fontSize = computed(() => this.userSettingsState().fontSize);

  constructor() {
    // Inicialização
    this._loadUserSettings();

    // Detecta configurações do sistema
    if (this.isBrowser) {
      this._detectSystemAccessibilitySettings();

      // Configurar observadores para alterações de mídia
      this._setupMediaQueryListeners();
    }

    // Monitora alterações de autenticação
    // effect(() => {
    //   const isAuth = this.authStore.isAuthenticated();
    //   const userId = this.authStore.userId();
    //
    //   if (isAuth && userId) {
    //     // Tenta carregar configurações específicas do usuário quando autenticado
    //     this._loadUserSpecificSettings(userId);
    //   }
    // });
  }

  /**
   * Carrega as configurações do usuário do armazenamento local
   * @private
   */
  private _loadUserSettings(): void {
    if (!this.isBrowser) return;

    try {
      const storedSettings = this.localStorageService.getItem<AccessibilitySettings>(this.STORAGE_KEY, { encrypt: false });

      if (storedSettings) {
        // Mescla com padrões para garantir que novas opções sejam incluídas
        this.userSettingsState.set({
          ...DEFAULT_ACCESSIBILITY_SETTINGS,
          ...storedSettings,
        });

        this.loggingService.debug('AccessibilityService: Configurações carregadas do armazenamento', storedSettings);

        // Aplica configurações ao DOM
        this._applySettingsToDOM();
      }
    } catch (error) {
      this.loggingService.error('AccessibilityService: Erro ao carregar configurações', { error });
    }
  }

  /**
   * Configura listeners para media queries para detectar mudanças nas preferências do sistema
   * @private
   */
  private _setupMediaQueryListeners(): void {
    if (!this.isBrowser) return;

    try {
      // Listener para preferência de redução de movimento
      const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

      // Adiciona listener de acordo com a API do navegador
      if (typeof reducedMotionQuery.addEventListener === 'function') {
        reducedMotionQuery.addEventListener('change', (e) => {
          this._updateFromSystemPreference('reducedMotion', e.matches);
        });
      } else if (typeof reducedMotionQuery.addListener === 'function') {
        // Para navegadores mais antigos
        reducedMotionQuery.addListener((e) => {
          this._updateFromSystemPreference('reducedMotion', e.matches);
        });
      }

      // Listener para preferência de alto contraste
      const highContrastQuery = window.matchMedia('(prefers-contrast: more)');

      if (typeof highContrastQuery.addEventListener === 'function') {
        highContrastQuery.addEventListener('change', (e) => {
          this._updateFromSystemPreference('highContrast', e.matches);
        });
      } else if (typeof highContrastQuery.addListener === 'function') {
        highContrastQuery.addListener((e) => {
          this._updateFromSystemPreference('highContrast', e.matches);
        });
      }

      // Outros listeners para preferências do sistema podem ser adicionados aqui
    } catch (error) {
      this.loggingService.error('AccessibilityService: Erro ao configurar listeners', { error });
    }
  }

  /**
   * Atualiza configuração específica baseada em preferência do sistema
   * @private
   */
  private _updateFromSystemPreference(key: keyof AccessibilitySettings, value: any): void {
    // Apenas atualiza se o usuário não tiver configuração personalizada
    // Ou se a configuração foi definida automaticamente pelo sistema antes
    const currentSettings = this.userSettingsState();

    // Verificar se devemos atualizar
    // Só atualizamos se o valor for diferente e o usuário não tiver definido manualmente
    if (currentSettings[key] !== value) {
      this.userSettingsState.update((settings) => ({
        ...settings,
        [key]: value,
      }));

      this.loggingService.debug(`AccessibilityService: Preferência do sistema alterada: ${key}`, { value });

      // Aplica ao DOM
      this._applySettingsToDOM();

      // Notifica componentes
      this.accessibilitySettingsChanged.next(this.userSettingsState());
    }
  }

  /**
   * Detecta configurações de acessibilidade do sistema
   * @private
   */
  private _detectSystemAccessibilitySettings(): void {
    if (!this.isBrowser) return;

    try {
      // Detecta preferência de redução de movimento
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      // Detecta preferência de alto contraste
      const prefersContrast = window.matchMedia('(prefers-contrast: more)').matches;

      // Detecta preferência de esquema de cores
      const prefersDarkColorScheme = window.matchMedia('(prefers-color-scheme: dark)').matches;

      // Atualiza apenas se o usuário não tiver configurações personalizadas
      const currentSettings = this.userSettingsState();

      const systemSettings: Partial<AccessibilitySettings> = {
        reducedMotion: prefersReducedMotion,
        highContrast: prefersContrast,
        // Outras configurações detectadas do sistema
      };

      // Atualiza apenas se as configurações forem diferentes
      let needsUpdate = false;
      Object.entries(systemSettings).forEach(([key, value]) => {
        if (currentSettings[key as keyof AccessibilitySettings] !== value) {
          needsUpdate = true;
        }
      });

      if (needsUpdate) {
        this.userSettingsState.set({
          ...currentSettings,
          ...systemSettings,
        });

        this.loggingService.debug('AccessibilityService: Configurações do sistema detectadas', systemSettings);

        // Aplica configurações ao DOM
        this._applySettingsToDOM();

        // Notifica outros componentes
        this.accessibilitySettingsChanged.next(this.userSettingsState());
      }
    } catch (error) {
      this.loggingService.error('AccessibilityService: Erro ao detectar configurações do sistema', { error });
    }
  }

  /**
   * Carrega configurações específicas do usuário do servidor
   * @private
   */
  private _loadUserSpecificSettings(userId: string): void {
    // Esta é uma implementação simplificada
    // Em um cenário real, você buscaria as configurações de um endpoint de API
    // Exemplo de chamada API para buscar configurações do usuário
    /*
    this.http.get<AccessibilitySettings>(`/api/users/${userId}/accessibility-settings`)
      .pipe(
        catchError(error => {
          this.loggingService.error('Erro ao carregar configurações de acessibilidade do servidor', { error });
          return of(null);
        })
      )
      .subscribe(settings => {
        if (settings) {
          this.updateSettings(settings);
        }
      });
    */
  }

  /**
   * Aplica configurações de acessibilidade ao DOM
   * @private
   */
  private _applySettingsToDOM(): void {
    if (!this.isBrowser) return;

    const settings = this.userSettingsState();
    const html = document.documentElement;

    // Alto contraste
    if (settings.highContrast) {
      html.classList.add('high-contrast');
    } else {
      html.classList.remove('high-contrast');
    }

    // Movimento reduzido
    if (settings.reducedMotion) {
      html.classList.add('reduced-motion');
    } else {
      html.classList.remove('reduced-motion');
    }

    // Tamanho da fonte
    html.setAttribute('data-font-size', settings.fontSize.toString());

    // Classes adicionais para outras configurações
    html.classList.toggle('screen-reader-active', settings.screenReader);
    html.classList.toggle('keyboard-navigation', settings.keyboardOnly);
    html.classList.toggle('reading-assistance', settings.readingAssistance);

    // Modo para daltonismo
    if (settings.colorBlindMode !== 'none') {
      html.setAttribute('data-color-blind-mode', settings.colorBlindMode);
    } else {
      html.removeAttribute('data-color-blind-mode');
    }
  }

  /**
   * Atualiza configurações de acessibilidade
   * @public
   */
  updateSettings(newSettings: Partial<AccessibilitySettings>): void {
    // Atualiza as configurações
    this.userSettingsState.update((currentSettings) => ({
      ...currentSettings,
      ...newSettings,
    }));

    // Salva no armazenamento local
    this.localStorageService.setItem(this.STORAGE_KEY, this.userSettingsState(), { encrypt: false });

    // Aplica ao DOM
    this._applySettingsToDOM();

    // Notifica outros componentes
    this.accessibilitySettingsChanged.next(this.userSettingsState());

    this.loggingService.debug('AccessibilityService: Configurações atualizadas', newSettings);
  }

  /**
   * Reseta configurações para os padrões
   * @public
   */
  resetSettings(): void {
    this.userSettingsState.set(DEFAULT_ACCESSIBILITY_SETTINGS);

    // Salva no armazenamento local
    this.localStorageService.setItem(this.STORAGE_KEY, DEFAULT_ACCESSIBILITY_SETTINGS, { encrypt: false });

    // Aplica ao DOM
    this._applySettingsToDOM();

    // Notifica outros componentes
    this.accessibilitySettingsChanged.next(DEFAULT_ACCESSIBILITY_SETTINGS);

    this.loggingService.debug('AccessibilityService: Configurações resetadas para padrões');
  }

  /**
   * Aumenta o tamanho da fonte
   * @public
   */
  increaseFontSize(): void {
    this.userSettingsState.update((settings) => {
      const newSize = Math.min(settings.fontSize + 1, 5);
      return { ...settings, fontSize: newSize };
    });

    // Salva e aplica mudanças
    this.localStorageService.setItem(this.STORAGE_KEY, this.userSettingsState(), { encrypt: false });

    this._applySettingsToDOM();
    this.accessibilitySettingsChanged.next(this.userSettingsState());
  }

  /**
   * Diminui o tamanho da fonte
   * @public
   */
  decreaseFontSize(): void {
    this.userSettingsState.update((settings) => {
      const newSize = Math.max(settings.fontSize - 1, 1);
      return { ...settings, fontSize: newSize };
    });

    // Salva e aplica mudanças
    this.localStorageService.setItem(this.STORAGE_KEY, this.userSettingsState(), { encrypt: false });

    this._applySettingsToDOM();
    this.accessibilitySettingsChanged.next(this.userSettingsState());
  }

  /**
   * Alterna o modo de alto contraste
   * @public
   */
  toggleHighContrast(): void {
    this.userSettingsState.update((settings) => ({
      ...settings,
      highContrast: !settings.highContrast,
    }));

    // Salva e aplica mudanças
    this.localStorageService.setItem(this.STORAGE_KEY, this.userSettingsState(), { encrypt: false });

    this._applySettingsToDOM();
    this.accessibilitySettingsChanged.next(this.userSettingsState());
  }

  /**
   * Alterna o modo de movimento reduzido
   * @public
   */
  toggleReducedMotion(): void {
    this.userSettingsState.update((settings) => ({
      ...settings,
      reducedMotion: !settings.reducedMotion,
    }));

    // Salva e aplica mudanças
    this.localStorageService.setItem(this.STORAGE_KEY, this.userSettingsState(), { encrypt: false });

    this._applySettingsToDOM();
    this.accessibilitySettingsChanged.next(this.userSettingsState());
  }

  /**
   * Define o modo para daltonismo
   * @public
   */
  setColorBlindMode(mode: string): void {
    this.userSettingsState.update((settings) => ({
      ...settings,
      colorBlindMode: mode,
    }));

    // Salva e aplica mudanças
    this.localStorageService.setItem(this.STORAGE_KEY, this.userSettingsState(), { encrypt: false });

    this._applySettingsToDOM();
    this.accessibilitySettingsChanged.next(this.userSettingsState());
  }

  /**
   * Detecta a presença de tecnologia assistiva
   * @public
   */
  detectAssistiveTechnology(): boolean {
    if (!this.isBrowser) return false;

    // Detecção de leitor de tela - método não é 100% confiável
    // mas pode detectar alguns leitores de tela comuns
    const hasScreenReader =
      // NVDA / JAWS (Windows)
      'speechSynthesis' in window ||
      // VoiceOver (iOS/macOS)
      (navigator.userAgent.includes('Mac') && 'webkitSpeechRecognition' in window) ||
      // Outras heurísticas
      document.querySelectorAll('[role="alert"]').length > 0;

    if (hasScreenReader) {
      this.userSettingsState.update((settings) => ({
        ...settings,
        screenReader: true,
      }));

      // Salva e aplica mudanças
      this.localStorageService.setItem(this.STORAGE_KEY, this.userSettingsState(), { encrypt: false });

      this._applySettingsToDOM();
      this.accessibilitySettingsChanged.next(this.userSettingsState());
    }

    return hasScreenReader;
  }

  /**
   * Detecta se o usuário usa principalmente o teclado
   * @public
   */
  detectKeyboardNavigation(): void {
    if (!this.isBrowser) return;

    // Configurar detector de navegação por teclado
    const handleFirstTab = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        document.body.classList.add('user-is-tabbing');

        this.userSettingsState.update((settings) => ({
          ...settings,
          tabNavigation: true,
          keyboardOnly: true,
        }));

        // Salva configurações
        this.localStorageService.setItem(this.STORAGE_KEY, this.userSettingsState(), { encrypt: false });

        this._applySettingsToDOM();
        this.accessibilitySettingsChanged.next(this.userSettingsState());

        // Remove o listener inicial
        window.removeEventListener('keydown', handleFirstTab);
      }
    };

    // Adiciona listener para detectar primeiro uso do Tab
    window.addEventListener('keydown', handleFirstTab);
  }

  /**
   * Aplica estilos CSS específicos para acessibilidade
   * @public
   */
  applyAccessibilityStyles(): void {
    if (!this.isBrowser) return;

    // Aqui você pode injetar estilos CSS adicionais para acessibilidade
    // Exemplo: adicionar foco mais visível, aumentar contrastes, etc.

    const style = document.createElement('style');
    style.id = 'accessibility-styles';
    style.textContent = `
      /* Melhorar visibilidade do foco */
      .high-contrast *:focus {
        outline: 3px solid yellow !important;
        outline-offset: 2px !important;
      }

      /* Remover animações quando movimento reduzido está ativado */
      .reduced-motion * {
        animation: none !important;
        transition: none !important;
      }

      /* Estilos para diferentes tamanhos de fonte */
      html[data-font-size="1"] { font-size: 14px; }
      html[data-font-size="2"] { font-size: 16px; }
      html[data-font-size="3"] { font-size: 18px; }
      html[data-font-size="4"] { font-size: 20px; }
      html[data-font-size="5"] { font-size: 24px; }

      /* Alto contraste */
      .high-contrast {
        --text-color: white;
        --background-color: black;
        --link-color: yellow;
        --focus-color: yellow;
      }

      .high-contrast body {
        background-color: var(--background-color);
        color: var(--text-color);
      }

      .high-contrast a {
        color: var(--link-color);
      }

      /* Assistência de leitura para dislexia */
      .reading-assistance {
        --font-family: OpenDyslexic, Comic Sans MS, sans-serif;
        --line-height: 1.5;
        --letter-spacing: 0.12em;
        --word-spacing: 0.16em;
      }

      .reading-assistance body {
        font-family: var(--font-family);
        line-height: var(--line-height);
        letter-spacing: var(--letter-spacing);
        word-spacing: var(--word-spacing);
      }
    `;

    // Adiciona ao head ou substitui se já existir
    const existingStyle = document.getElementById('accessibility-styles');
    if (existingStyle) {
      existingStyle.remove();
    }

    document.head.appendChild(style);
  }
}
