import { Directive, OnInit, input, inject, ChangeDetectorRef, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormGroup, FormArray } from '@angular/forms';
import { debounceTime, distinctUntilChanged, catchError, EMPTY } from 'rxjs';

/**
 * Diretiva para otimizar a detecção de mudanças em componentes com formulários grandes
 * que usam ChangeDetectionStrategy.OnPush.
 *
 * Reage a `valueChanges` ou `statusChanges` do formulário ou de campos específicos
 * e chama `markForCheck()` no ChangeDetectorRef do componente host.
 *
 * Uso:
 * <form [formGroup]="myForm" formOnPush [formDebounceTime]="15">...</form>
 * <form [formGroup]="myForm" formOnPush [trackChanges]="['controlName1', 'groupName.controlName2']">...</form>
 */
@Directive({
  selector: '[formOnPush]',
  standalone: true,
})
export class FormOnPushDirective implements OnInit {
  readonly formGroupInput = input.required<FormGroup | FormArray>({ alias: 'formOnPush' });
  readonly trackChanges = input<string[]>([]); // Caminhos para controles específicos a serem observados
  readonly formDebounceTime = input<number>(10); // Tempo de debounce para value/status changes
  readonly observeStatusChanges = input<boolean>(true); // Se deve observar statusChanges também

  private cdRef = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);

  ngOnInit() {
    const form = this.formGroupInput();
    if (!form) {
      console.warn('[FormOnPushDirective] FormGroup não fornecido.');
      return;
    }

    const specificFieldsToTrack = this.trackChanges();
    const debounceMs = Math.max(0, this.formDebounceTime()); // Garante que não seja negativo

    if (specificFieldsToTrack.length > 0) {
      this.observeSpecificFields(form, specificFieldsToTrack, debounceMs);
    } else {
      this.observeEntireForm(form, debounceMs);
    }

    // Marcar para verificação inicial, especialmente se o formulário já tiver um estado
    // que precise ser refletido na UI após a inicialização.
    Promise.resolve().then(() => this.cdRef.markForCheck());
  }

  private observeSpecificFields(form: FormGroup | FormArray, fieldPaths: string[], debounceMs: number) {
    fieldPaths.forEach((path) => {
      const control = form.get(path);
      if (control && control.valueChanges) {
        control.valueChanges
          .pipe(
            debounceTime(debounceMs),
            distinctUntilChanged(), // Evita reações a valores idênticos consecutivos
            takeUntilDestroyed(this.destroyRef),
            catchError((err) => {
              console.error(`[FormOnPushDirective] Erro em valueChanges do controle ${path}:`, err);
              return EMPTY;
            }),
          )
          .subscribe(() => {
            this.cdRef.markForCheck();
          });
      } else {
        console.warn(`[FormOnPushDirective] Controle não encontrado ou sem valueChanges em: ${path}`);
      }

      if (control && this.observeStatusChanges() && control.statusChanges) {
        control.statusChanges
          .pipe(
            debounceTime(debounceMs),
            distinctUntilChanged(),
            takeUntilDestroyed(this.destroyRef),
            catchError((err) => {
              console.error(`[FormOnPushDirective] Erro em statusChanges do controle ${path}:`, err);
              return EMPTY;
            }),
          )
          .subscribe(() => {
            this.cdRef.markForCheck();
          });
      }
    });
  }

  private observeEntireForm(form: FormGroup | FormArray, debounceMs: number) {
    if (form.valueChanges) {
      form.valueChanges
        .pipe(
          debounceTime(debounceMs),
          // distinctUntilChanged() para o form inteiro pode ser caro se o objeto do valor for grande.
          // Use com cautela ou com um comparador customizado se necessário.
          takeUntilDestroyed(this.destroyRef),
          catchError((err) => {
            console.error(`[FormOnPushDirective] Erro em valueChanges do formulário:`, err);
            return EMPTY;
          }),
        )
        .subscribe(() => {
          this.cdRef.markForCheck();
        });
    }

    if (this.observeStatusChanges() && form.statusChanges) {
      form.statusChanges
        .pipe(
          debounceTime(debounceMs),
          distinctUntilChanged(), // Status é geralmente uma string, então distinctUntilChanged é barato
          takeUntilDestroyed(this.destroyRef),
          catchError((err) => {
            console.error(`[FormOnPushDirective] Erro em statusChanges do formulário:`, err);
            return EMPTY;
          }),
        )
        .subscribe(() => {
          this.cdRef.markForCheck();
        });
    }
  }
}
