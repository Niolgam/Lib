// import { Injectable, inject, Renderer2, RendererFactory2 } from '@angular/core';
// import { DOCUMENT } from '@angular/common';
//
// @Injectable({
//   providedIn: 'root',
// })
// export class ThemeService {
//   private configService = inject(ConfigService);
//   private document = inject(DOCUMENT);
//   private renderer: Renderer2;
//
//   constructor(rendererFactory: RendererFactory2) {
//     this.renderer = rendererFactory.createRenderer(null, null);
//
//     // Aplica o tema inicialmente
//     this.applyTheme();
//
//     // Observa mudanças na configuração
//     this.configService.config$.subscribe(() => {
//       this.applyTheme();
//     });
//   }
//
//   /**
//    * Aplica o tema baseado na configuração atual
//    */
//   private applyTheme(): void {
//     const themeConfig = this.configService.get('theme');
//
//     // Aplica cores e outras variáveis CSS
//     this.setRootVariable('--primary-color', themeConfig.primaryColor);
//     this.setRootVariable('--secondary-color', themeConfig.secondaryColor);
//     this.setRootVariable('--font-size', themeConfig.fontSize);
//
//     // Aplica modo escuro
//     if (themeConfig.darkMode) {
//       this.renderer.addClass(this.document.body, 'dark-theme');
//     } else {
//       this.renderer.removeClass(this.document.body, 'dark-theme');
//     }
//
//     // Carrega folha de estilo do tema se necessário
//     if (themeConfig.name !== 'default') {
//       this.loadThemeStylesheet(themeConfig.name);
//     }
//   }
//
//   /**
//    * Define uma variável CSS no elemento :root
//    */
//   private setRootVariable(name: string, value: string): void {
//     this.document.documentElement.style.setProperty(name, value);
//   }
//
//   /**
//    * Carrega uma folha de estilo para um tema específico
//    */
//   private loadThemeStylesheet(themeName: string): void {
//     // Verifica se a folha de estilo já existe
//     const existingLink = this.document.getElementById('theme-stylesheet');
//     if (existingLink) {
//       this.renderer.removeChild(this.document.head, existingLink);
//     }
//
//     // Cria e adiciona a nova folha de estilo
//     const link = this.renderer.createElement('link');
//     this.renderer.setAttribute(link, 'id', 'theme-stylesheet');
//     this.renderer.setAttribute(link, 'rel', 'stylesheet');
//     this.renderer.setAttribute(link, 'href', `assets/themes/${themeName}.css`);
//
//     this.renderer.appendChild(this.document.head, link);
//   }
//
//   /**
//    * Alterna o modo escuro
//    */
//   toggleDarkMode(): void {
//     const themeConfig = this.configService.get('theme');
//     this.configService.updateConfig({
//       theme: {
//         ...themeConfig,
//         darkMode: !themeConfig.darkMode,
//       },
//     });
//   }
//
//   /**
//    * Define um tema pelo nome
//    */
//   setTheme(themeName: string): void {
//     const themeConfig = this.configService.get('theme');
//     this.configService.updateConfig({
//       theme: {
//         ...themeConfig,
//         name: themeName,
//       },
//     });
//   }
// }
