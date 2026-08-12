import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithCustomToken,
  signInWithPopup,
  signInWithRedirect,
  signOut
} from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, getDocFromServer } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
auth.useDeviceLanguage();
setPersistence(auth, browserLocalPersistence).catch(console.error);

const needsLocalhostForAuth = () =>
  typeof window !== 'undefined' && ['127.0.0.1', '0.0.0.0'].includes(window.location.hostname);

const redirectToLocalhost = () => {
  const { protocol, port, pathname, search, hash } = window.location;
  window.location.assign(`${protocol}//localhost${port ? `:${port}` : ''}${pathname}${search}${hash}`);
};

const shouldUseRedirectFallback = (error: any) => {
  const code = error?.code || '';
  const message = error?.message || '';
  return [
    'auth/popup-blocked',
    'auth/popup-closed-by-user',
    'auth/cancelled-popup-request',
    'auth/internal-error',
  ].includes(code) || message.includes('missing initial state');
};

// Auth helpers
export const completeGoogleRedirectSignIn = () => getRedirectResult(auth);
export const signInWithGoogle = async () => {
  if (needsLocalhostForAuth()) {
    redirectToLocalhost();
    return null;
  }

  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (error: any) {
    if (shouldUseRedirectFallback(error)) {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
    throw error;
  }
};
export const signInWithEmail = (email: string, password: string) => signInWithEmailAndPassword(auth, email, password);
export const signInWithPasskeyToken = (token: string) => signInWithCustomToken(auth, token);
export const createUser = (email: string, password: string) => createUserWithEmailAndPassword(auth, email, password);
export const logOut = () => signOut(auth);

export const getGoogleAuthErrorMessage = (error: any) => {
  const code = error?.code || '';
  const message = error?.message || '';
  if (code === 'auth/unauthorized-domain') {
    return "Домен не разрешён в Firebase Auth. Откройте локально через localhost или добавьте домен в Authorized domains.";
  }
  if (code === 'auth/popup-blocked') return "Браузер заблокировал окно Google. Повторите вход или разрешите всплывающие окна.";
  if (code === 'auth/popup-closed-by-user') return "Окно Google было закрыто до завершения входа.";
  if (code === 'auth/account-exists-with-different-credential') return "Этот email уже привязан к другому способу входа.";
  if (code === 'auth/operation-not-allowed') return "Google-вход не включён в Firebase Authentication.";
  if (message.includes('missing initial state') || code === 'auth/internal-error') {
    return "Сессия Google не завершилась. Откройте сайт в обычной вкладке и попробуйте ещё раз.";
  }
  return `Не удалось войти через Google${code ? ` (${code})` : ''}.`;
};

// Connection test
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
