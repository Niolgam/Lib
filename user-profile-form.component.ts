import { Component, OnInit, output, inject, computed, signal, effect, ChangeDetectionStrategy } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormControl, AbstractControl } from '@angular/forms';
import { CommonModule } from '@angular/common';

import { AuthStore, UserStore } from '@auth/data-access';
import { User } from '@auth/data-access';
import { BaseFormComponent } from '@component/form-base';

// Interface para os DADOS do formulário
interface UserProfileFormData {
  name: string;
  email: string;
  cpf?: string | null;
  phone?: string | null;
  bio?: string | null;
  preferences: {
    language: string;
    timezone: string;
    theme: string;
    notifications: {
      email: boolean;
      push: boolean;
      sms: boolean;
    };
  };
}

// Interface para a ESTRUTURA do FormGroup
interface UserProfileFormShape {
  name: FormControl<string>;
  email: FormControl<string>;
  cpf: FormControl<string | null>;
  phone: FormControl<string | null>;
  bio: FormControl<string | null>;
  preferences: FormGroup<{
    language: FormControl<string>;
    timezone: FormControl<string>;
    theme: FormControl<string>;
    notifications: FormGroup<{
      email: FormControl<boolean>;
      push: FormControl<boolean>;
      sms: FormControl<boolean>;
    }>;
  }>;
}

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'user-profile-form',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './user-profile-form.component.html',
  styleUrls: ['./user-profile-form.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserProfileFormComponent extends BaseFormComponent<Partial<User>> implements OnInit {
  private fb = inject(FormBuilder);
  private authStore = inject(AuthStore);
  private userStore = inject(UserStore);

  readonly profileUpdated = output<User>();
  readonly showSuccessMessageSignal = signal<boolean>(false); // Mantido para controle local da visibilidade da mensagem

  // form é agora corretamente tipado com a estrutura de FormControls
  override form: FormGroup<UserProfileFormShape>;

  readonly currentUser = computed(() => this.authStore.currentUser());
  private readonly updateProfileCallKey = computed(() => `updateUserProfile_${this.currentUser()?.id || 'current'}`);

  constructor() {
    // Passa um objeto BaseFormOptions parcial ou completo para o construtor da classe base.
    // O formId é crucial para persistência e histórico.
    super({ formId: 'userProfileForm' }); // formId inicial, pode ser atualizado em ngOnInit
    this.form = this.createForm();

    // Efeito para reagir ao status da chamada de atualização do UserStore
    effect(() => {
      const callKey = this.updateProfileCallKey();
      // Acessa os signals do store. Se o store não os expuser diretamente,
      // o componente precisaria de uma forma de obter essa informação.
      // Assumindo que UserStore tem getCallStatusSignal e getErrorByKeySignal.
      const updateUserStatus = this.userStore.getCallStatusSignal(callKey)();
      const error = this.userStore.getErrorByKeySignal(callKey)();

      if (this.submitting()) {
        // Reage apenas se este formulário iniciou a submissão
        if (updateUserStatus === 'success') {
          this.setSuccess('Perfil atualizado com sucesso!');
          this.form.markAsPristine();
          this.authStore.loadUser({ forceLoad: true });
          const updatedUser = this.authStore.currentUser();
          if (updatedUser) {
            this.profileUpdated.emit(updatedUser);
          }
          this.submitting.set(false);
        } else if (updateUserStatus === 'error' && error) {
          this.handleSubmissionError(error || new Error('Falha ao atualizar perfil.'));
          // this.submitting.set(false) é chamado dentro de handleSubmissionError
        } else if (updateUserStatus === 'idle' && this.submitting()) {
          // Chamada terminou mas não foi sucesso nem erro (raro, mas possível)
          this.submitting.set(false);
        }
      }
    });
  }

  override ngOnInit(): void {
    // As opções da classe base são inicializadas no construtor de BaseFormComponent.
    // Se precisarmos definir/sobrescrever opções com base em dados que só estão disponíveis em ngOnInit,
    // usamos this.initializeOptions().
    this.initializeOptions({
      formId: `userProfile_${this.currentUser()?.id || 'new'}`,
      // Exemplo: enableHistory: this.coreConfigService.getFormFeatureFlag('profileHistory')
    });
    super.ngOnInit(); // Chama ngOnInit da classe base

    effect(() => {
      const user = this.currentUser();
      if (user) {
        this.populateForm(user);
        if (user.id && this.options.formId !== `userProfile_${user.id}`) {
          this.initializeOptions({ formId: `userProfile_${user.id}` });
        }
      }
    });

    if (!this.currentUser()) {
      this.authStore.loadUser({ forceLoad: true });
    }
  }

  private createForm(): FormGroup<UserProfileFormShape> {
    return this.fb.group<UserProfileFormShape>({
      name: this.fb.control('', { validators: [Validators.required, Validators.minLength(2)], nonNullable: true }),
      email: this.fb.control('', { validators: [Validators.required, Validators.email], nonNullable: true }),
      cpf: this.fb.control<string | null>(null),
      phone: this.fb.control<string | null>(null),
      bio: this.fb.control<string | null>('', [Validators.maxLength(500)]),
      preferences: this.fb.group({
        language: this.fb.control('pt-BR', { validators: Validators.required, nonNullable: true }),
        timezone: this.fb.control('America/Cuiaba', { validators: Validators.required, nonNullable: true }),
        theme: this.fb.control('light', { validators: Validators.required, nonNullable: true }),
        notifications: this.fb.group({
          email: this.fb.control(true, { validators: Validators.required, nonNullable: true }),
          push: this.fb.control(false, { validators: Validators.required, nonNullable: true }),
          sms: this.fb.control(false, { validators: Validators.required, nonNullable: true }),
        }),
      }),
    });
  }

  private populateForm(user: User): void {
    const userData = user as User & { preferences?: UserProfileFormData['preferences']; phone?: string; bio?: string };
    this.form.patchValue(
      {
        name: userData.name,
        email: userData.email,
        cpf: userData.cpf || null,
        phone: userData.phone || null,
        bio: userData.bio || null,
        preferences: {
          language: userData.preferences?.language || 'pt-BR',
          timezone: userData.preferences?.timezone || 'America/Cuiaba',
          theme: userData.preferences?.theme || 'light',
          notifications: {
            email: userData.preferences?.notifications?.email ?? true,
            push: userData.preferences?.notifications?.push ?? false,
            sms: userData.preferences?.notifications?.sms ?? false,
          },
        },
      },
      { emitEvent: false },
    );
    this.form.markAsPristine();
    if (this.options.enableHistory) {
      this.formHistory.set([]);
      this.historyPosition.set(-1);
      this.addHistoryEntry('Form populated');
    }
  }

  protected override getFormValue(): Partial<User> {
    // Usa getRawValue para incluir campos desabilitados se this.options.includeDisabled for true,
    // mas UserProfileFormData já reflete a estrutura esperada.
    const formValue = this.options.includeDisabled ? (this.form.getRawValue() as UserProfileFormData) : (this.form.value as UserProfileFormData);
    const currentUser = this.currentUser();
    const payload: Partial<User & { preferences?: UserProfileFormData['preferences']; phone?: string; bio?: string }> = {
      id: currentUser?.id,
      name: formValue.name,
      email: formValue.email,
      cpf: formValue.cpf || undefined,
      phone: formValue.phone || undefined,
      bio: formValue.bio || undefined,
      preferences: formValue.preferences,
    };
    return payload;
  }

  protected override submitFormLogic(payload: Partial<User>): void {
    const userId = this.currentUser()?.id;
    if (!userId) {
      throw new Error('User ID is required for profile update.');
    }
    this.logger.info('UserProfileFormComponent: Submitting profile update via UserStore', { userId, data: payload });
    // A chamada ao store. O effect no construtor vai lidar com success/error.
    this.userStore.updateUser({ userId, data: payload }); // Este método no UserStore deve ser um rxMethod
  }

  override setSuccess(message: string): void {
    super.setSuccess(message);
    this.showSuccessMessageSignal.set(true);
    setTimeout(() => this.showSuccessMessageSignal.set(false), 5000);
  }

  get hasUnsavedChanges(): boolean {
    return this.isDirty();
  }

  protected override createArrayItem(arrayName: string, initialValue?: unknown): AbstractControl {
    this.logger.warn(`UserProfileFormComponent: createArrayItem called for unmanaged array "${arrayName}". Returning empty FormGroup.`);
    return this.fb.group({});
  }

  resetLocalForm(): void {
    const user = this.currentUser();
    if (user) {
      this.populateForm(user);
    } else {
      this.form.reset(this.createForm().getRawValue()); // Reseta para os valores iniciais da estrutura do form
    }
    this.clearErrors();
    this.successMessage.set(null);
    this.showSuccessMessageSignal.set(false);
    this.form.markAsPristine();
    this.form.markAsUntouched();
    if (this.options.enableHistory) {
      this.formHistory.set([]);
      this.historyPosition.set(-1);
      this.addHistoryEntry('Form reset');
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      this.logger.debug('Profile image selected', { fileName: file.name, fileSize: file.size });
    }
  }
}
