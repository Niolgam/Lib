import { PartialStateUpdater } from '@ngrx/signals';
import { CallStateData, CallStatus } from '@vai/store-feature'; // Supondo que CallStateData e CallStatus venham de um local comum

/**
 * Retorna um PartialStateUpdater para definir o status de uma chamada específica.
 * Limpa o erro associado à chave quando o status é definido como 'pending'.
 * @param key A chave da operação (string).
 * @param status O novo status da chamada.
 */
export function setCallStatus<TKey extends string>(key: TKey, status: CallStatus): PartialStateUpdater<CallStateData> {
  return (state): Partial<CallStateData> => ({
    status: { ...state.status, [key]: status },
    // Limpa o erro para esta chave específica quando uma nova chamada é iniciada (pending)
    ...(status === 'pending' && { error: { ...state.error, [key]: null } }),
  });
}

/**
 * Retorna um PartialStateUpdater para definir um erro para uma chamada específica.
 * Define o status da chamada como 'error'.
 * @param key A chave da operação (string).
 * @param error O objeto de erro.
 */
export function setCallError<TKey extends string, E = any>(key: TKey, error: E): PartialStateUpdater<CallStateData> {
  return (state): Partial<CallStateData> => ({
    status: { ...state.status, [key]: 'error' as CallStatus },
    error: { ...state.error, [key]: error },
  });
}

/**
 * Retorna um PartialStateUpdater para definir os dados retornados por uma chamada específica.
 * Não altera o status da chamada (geralmente usado em conjunto com setCallStatus(key, 'success')).
 * @param key A chave da operação (string).
 * @param data Os dados retornados pela chamada.
 */
export function setCallData<TKey extends string, D = any>(key: TKey, data: D): PartialStateUpdater<CallStateData> {
  return (state): Partial<CallStateData> => ({
    data: { ...state.data, [key]: data },
  });
}

/**
 * Retorna um PartialStateUpdater para limpar completamente o estado de uma chamada específica.
 * Define o status como 'idle', e limpa data e error.
 * @param key A chave da operação (string).
 */
export function clearCallState<TKey extends string>(key: TKey): PartialStateUpdater<CallStateData> {
  return (state): Partial<CallStateData> => ({
    status: { ...state.status, [key]: 'idle' as CallStatus },
    data: { ...state.data, [key]: undefined }, // ou null, dependendo da preferência
    error: { ...state.error, [key]: null },
  });
}
