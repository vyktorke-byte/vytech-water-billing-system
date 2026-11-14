import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getAuth,
  reauthenticateWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updatePassword,
  updateProfile,
  User,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

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
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Firebase Firestore client is offline. Please verify configuration.');
    }
  }
}

export async function signInWithEmailPassword(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function registerWithEmailPassword(
  email: string,
  password: string,
  displayName: string
) {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  const cleanName = displayName.trim();
  if (cleanName) {
    await updateProfile(cred.user, { displayName: cleanName.slice(0, 120) });
  }
  await sendEmailVerification(cred.user);
  return cred;
}

export async function resendVerificationEmail(user: User) {
  return sendEmailVerification(user);
}

export async function sendOperatorPasswordReset(email: string) {
  return sendPasswordResetEmail(auth, email.trim());
}

export async function updateOperatorAccountCredentials(opts: {
  user: User;
  displayName?: string;
  currentPassword?: string;
  newPassword?: string;
}) {
  const { user, displayName, currentPassword, newPassword } = opts;
  if (displayName && displayName.trim()) {
    await updateProfile(user, { displayName: displayName.trim().slice(0, 120) });
  }
  if (newPassword && newPassword.length >= 6) {
    if (!currentPassword) {
      throw new Error('Enter your current password to change your account password.');
    }
    if (!user.email) {
      throw new Error('Authenticated account email is required to update password.');
    }
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);
  }
}

export async function signOutOperator() {
  return firebaseSignOut(auth);
}

// Execute boot connectivity verification immediately upon module initialization
void testFirestoreConnection();
