type PublicKeyOptionsResponse = {
  requestId: string;
  options: PublicKeyCredentialCreationOptionsJSON | PublicKeyCredentialRequestOptionsJSON;
};

type PublicKeyCredentialCreationOptionsJSON = Omit<PublicKeyCredentialCreationOptions, 'challenge' | 'user' | 'excludeCredentials'> & {
  challenge: string;
  user: Omit<PublicKeyCredentialUserEntity, 'id'> & { id: string };
  excludeCredentials?: Array<Omit<PublicKeyCredentialDescriptor, 'id'> & { id: string }>;
};

type PublicKeyCredentialRequestOptionsJSON = Omit<PublicKeyCredentialRequestOptions, 'challenge' | 'allowCredentials'> & {
  challenge: string;
  allowCredentials?: Array<Omit<PublicKeyCredentialDescriptor, 'id'> & { id: string }>;
};

const apiPost = async <T>(path: string, body: unknown, token?: string): Promise<T> => {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'Passkey request failed');
  return data as T;
};

export const isPasskeySupported = () =>
  typeof window !== 'undefined'
  && typeof window.PublicKeyCredential !== 'undefined'
  && window.isSecureContext;

const base64UrlToBuffer = (value: string) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = window.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
};

const bufferToBase64Url = (buffer: ArrayBuffer | null) => {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const prepareRegistrationOptions = (options: PublicKeyCredentialCreationOptionsJSON): PublicKeyCredentialCreationOptions => ({
  ...options,
  challenge: base64UrlToBuffer(options.challenge),
  user: {
    ...options.user,
    id: base64UrlToBuffer(options.user.id),
  },
  excludeCredentials: options.excludeCredentials?.map(credential => ({
    ...credential,
    id: base64UrlToBuffer(credential.id),
  })),
});

const prepareAuthenticationOptions = (options: PublicKeyCredentialRequestOptionsJSON): PublicKeyCredentialRequestOptions => ({
  ...options,
  challenge: base64UrlToBuffer(options.challenge),
  allowCredentials: options.allowCredentials?.map(credential => ({
    ...credential,
    id: base64UrlToBuffer(credential.id),
  })),
});

const serializeRegistration = (credential: PublicKeyCredential) => {
  const response = credential.response as AuthenticatorAttestationResponse & { getTransports?: () => AuthenticatorTransport[] };
  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      attestationObject: bufferToBase64Url(response.attestationObject),
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      transports: response.getTransports?.() || [],
    },
  };
};

const serializeAuthentication = (credential: PublicKeyCredential) => {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      authenticatorData: bufferToBase64Url(response.authenticatorData),
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      signature: bufferToBase64Url(response.signature),
      userHandle: bufferToBase64Url(response.userHandle),
    },
  };
};

export const registerPasskey = async (firebaseToken: string) => {
  if (!isPasskeySupported()) {
    throw new Error('На этом устройстве passkey/Face ID недоступен. Нужен HTTPS и современный Safari/Chrome.');
  }
  const { requestId, options } = await apiPost<PublicKeyOptionsResponse>('/api/passkeys/register/options', {}, firebaseToken);
  const credential = await navigator.credentials.create({
    publicKey: prepareRegistrationOptions(options as PublicKeyCredentialCreationOptionsJSON),
  }) as PublicKeyCredential | null;
  if (!credential) throw new Error('Устройство не создало passkey');
  return apiPost<{ success: boolean; email?: string }>('/api/passkeys/register/verify', {
    requestId,
    response: serializeRegistration(credential),
  }, firebaseToken);
};

export const loginWithPasskey = async () => {
  if (!isPasskeySupported()) {
    throw new Error('На этом устройстве passkey/Face ID недоступен. Нужен HTTPS и современный Safari/Chrome.');
  }
  const { requestId, options } = await apiPost<PublicKeyOptionsResponse>('/api/passkeys/login/options', {});
  const credential = await navigator.credentials.get({
    publicKey: prepareAuthenticationOptions(options as PublicKeyCredentialRequestOptionsJSON),
  }) as PublicKeyCredential | null;
  if (!credential) throw new Error('Устройство не вернуло passkey');
  return apiPost<{ success: boolean; customToken: string; email?: string }>('/api/passkeys/login/verify', {
    requestId,
    response: serializeAuthentication(credential),
  });
};
