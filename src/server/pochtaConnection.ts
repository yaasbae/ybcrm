export async function checkPochtaConnection(
  token: string | undefined,
  userKey: string | undefined,
  request = fetch,
): Promise<'missing' | 'connected' | 'rejected' | 'unavailable'> {
  if (!token?.trim() || !userKey?.trim()) return 'missing';

  try {
    const response = await request('https://otpravka-api.pochta.ru/1.0/user-shipping-points', {
      headers: {
        Authorization: `AccessToken ${token.trim()}`,
        'X-User-Authorization': `Basic ${userKey.trim()}`,
        Accept: 'application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return response.status === 401 || response.status === 403 ? 'rejected' : 'unavailable';
    }
    return Array.isArray(await response.json()) ? 'connected' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}
