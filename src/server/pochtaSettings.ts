type Credentials = { token: string; userKey: string };

export function parsePochtaCredentials(body: unknown): Credentials | null {
  if (!body || typeof body !== 'object') return null;
  const { token, login, password } = body as Record<string, unknown>;
  if (typeof token !== 'string' || !/^[!-~]{1,2048}$/.test(token.trim())) return null;
  if (typeof login !== 'string' || !/^[^:\s\x00-\x1f\x7f]{1,256}$/.test(login.trim())) return null;
  if (typeof password !== 'string' || !password.trim() || password.length > 512 || /[\x00-\x1f\x7f]/.test(password)) return null;
  return { token: token.trim(), userKey: Buffer.from(`${login.trim()}:${password}`, 'utf8').toString('base64') };
}

export async function pochtaSecretRequest(resource: string, accessToken: string, credentials?: Credentials) {
  if (!/^projects\/[\w-]+\/secrets\/[\w-]+$/.test(resource)) throw new Error('Invalid secret resource');
  const suffix = credentials ? ':addVersion' : '/versions/latest:access';
  const response = await fetch(`https://secretmanager.googleapis.com/v1/${resource}${suffix}`, {
    method: credentials ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: credentials ? JSON.stringify({ payload: { data: Buffer.from(JSON.stringify(credentials)).toString('base64') } }) : undefined,
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (!credentials && response.status === 404) return null;
    throw new Error('Secret Manager request failed');
  }
  if (credentials) {
    await response.body?.cancel();
    return null;
  }
  const data = await response.json();
  const value = JSON.parse(Buffer.from(data.payload.data, 'base64').toString()) as Credentials;
  if (typeof value.token !== 'string' || typeof value.userKey !== 'string') throw new Error('Invalid secret data');
  return value;
}
