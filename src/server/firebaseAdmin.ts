import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

const adminApp = getApps()[0] ?? initializeApp({
  projectId: firebaseConfig.projectId,
});

// The browser client uses this named database. Keep Admin SDK reads/writes aligned.
export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp, firebaseConfig.firestoreDatabaseId);
