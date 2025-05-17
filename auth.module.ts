import { NgModule, ModuleWithProviders } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HTTP_INTERCEPTORS } from '@angular/common/http';
import { InjectionToken } from '@angular/core';

import { AuthConfig, AuthStore, RoleStore, UserStore } from './data-access/src';
import {
  AuthConfigService,
  authGuard,
  AuthInterceptor,
  AuthService,
  CsrfInterceptor,
  CsrfService,
  HasPermissionDirective,
  permissionGuard,
  PermissionService,
  roleGuard,
  RoleService,
  SecurityHeadersInterceptor,
  SecurityMonitorService,
  SecurityValidatorService,
  TokenService,
  UserService,
} from './utils/src/';

@NgModule({
  declarations: [],
  imports: [CommonModule, HasPermissionDirective, ReactiveFormsModule, RouterModule],
  exports: [
    // Diretivas expostas para uso na aplicação
    HasPermissionDirective,
  ],
})
export class AuthModule {
  /**
   * Método para importar e configurar o módulo de autenticação na raiz da aplicação
   * @param config Configuração do módulo de autenticação
   * @returns ModuleWithProviders configurado
   */
  static forRoot(): ModuleWithProviders<AuthModule> {
    return {
      ngModule: AuthModule,
      providers: [
        AuthConfigService,
        AuthService,
        TokenService,
        CsrfService,
        SecurityMonitorService,
        SecurityValidatorService,
        PermissionService,
        RoleService,
        UserService,

        AuthStore,
        RoleStore,
        UserStore,

        {
          provide: HTTP_INTERCEPTORS,
          useClass: SecurityHeadersInterceptor,
          multi: true,
        },
        {
          provide: HTTP_INTERCEPTORS,
          useClass: CsrfInterceptor,
          multi: true,
        },
        {
          provide: HTTP_INTERCEPTORS,
          useClass: AuthInterceptor,
          multi: true,
        },
      ],
    };
  }

  static forFeature(): ModuleWithProviders<AuthModule> {
    return {
      ngModule: AuthModule,
      providers: [
        // Serviços específicos para features
        PermissionService,
      ],
    };
  }
}

/**
 * Exporta tudo o que é necessário para usar o módulo
 */
export {
  // Services
  AuthService,
  AuthConfigService,
  TokenService,
  CsrfService,
  SecurityMonitorService,
  SecurityValidatorService,
  PermissionService,
  RoleService,
  UserService,

  // Stores
  AuthStore,
  RoleStore,
  UserStore,

  // Guards
  authGuard,
  permissionGuard,
  roleGuard,

  // Models (todos os modelos principais para uso externo)
  AuthConfig,

  // Directives
  HasPermissionDirective,
};
