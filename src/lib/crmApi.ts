import { auth } from '../firebase';

const nativeFetch = globalThis.fetch.bind(globalThis);

export async function crmFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  await auth.authStateReady();
  const token = await auth.currentUser?.getIdToken();
  return nativeFetch(input, {
    ...init,
    headers: {
      ...(init.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

let authenticationInstalled = false;

/**
 * Transitional protection for the existing CRM: many older screens call
 * same-origin /api routes directly. Add the Firebase token centrally so the
 * server can deny anonymous access without rewriting every screen at once.
 */
export function installCrmApiAuthentication() {
  if (authenticationInstalled || typeof window === 'undefined') return;
  authenticationInstalled = true;
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(rawUrl, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
      return nativeFetch(input, init);
    }
    return crmFetch(input, init);
  };
}
