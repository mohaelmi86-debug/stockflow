import { auth } from './firebase.ts';

export async function callStockEngine<T = Record<string, unknown>>(
  operation: 'reserve' | 'cancel' | 'ship' | 'receipt' | 'movement',
  payload: Record<string, unknown>,
): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Votre session a expiré. Veuillez vous reconnecter.');
  const token = await user.getIdToken();
  const response = await fetch(`/api/stock/${operation}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(result.error || `Opération de stock refusée (${response.status}).`);
  return result;
}
