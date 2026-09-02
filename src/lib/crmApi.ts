import { auth } from '../firebase';

export async function crmFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  await auth.authStateReady();
  const token = await auth.currentUser?.getIdToken();
  return fetch(input, {
    ...init,
    headers: {
      ...(init.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}
