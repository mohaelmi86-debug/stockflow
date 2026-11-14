import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db, googleAuthProvider } from '../lib/firebase.ts';
import {
  createOrganizationWorkspace,
  getOrganization,
  listUserMemberships,
  upsertUserProfile,
} from '../services/erpService.ts';
import type { CreateOrganizationInput } from '../shared/schemas.ts';
import type { Organization, OrgRole, UserMembership, UserProfile } from '../shared/types.ts';

interface AuthContextValue {
  user: User | null;
  authReady: boolean;
  loadingWorkspace: boolean;
  memberships: UserMembership[];
  activeOrg: Organization | null;
  activeRole: OrgRole | null;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  selectOrganization: (orgId: string) => Promise<void>;
  createOrganization: (input: CreateOrganizationInput) => Promise<string>;
  refreshWorkspace: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [memberships, setMemberships] = useState<UserMembership[]>([]);
  const [activeOrg, setActiveOrg] = useState<Organization | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const loadWorkspaceForUser = useCallback(async (currentUser: User, preferredOrgId?: string) => {
    setLoadingWorkspace(true);
    setAuthError(null);
    try {
      await upsertUserProfile(currentUser);
      const userSnap = await getDoc(doc(db, 'users', currentUser.uid));
      const profile = userSnap.exists() ? (userSnap.data() as UserProfile) : null;
      const userMemberships = await listUserMemberships(currentUser.uid);
      setMemberships(userMemberships);

      if (userMemberships.length === 0) {
        setActiveOrg(null);
        return;
      }

      const targetOrgId =
        preferredOrgId && userMemberships.some((m) => m.orgId === preferredOrgId)
          ? preferredOrgId
          : profile?.activeOrgId && userMemberships.some((m) => m.orgId === profile.activeOrgId)
            ? profile.activeOrgId
            : userMemberships[0].orgId;

      const org = await getOrganization(targetOrgId);
      setActiveOrg(org);
    } catch (err) {
      console.error('Failed to load workspace:', err);
      setAuthError(err instanceof Error ? err.message : 'Impossible de charger votre espace entreprise.');
    } finally {
      setLoadingWorkspace(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (nextUser) {
        await loadWorkspaceForUser(nextUser);
      } else {
        setMemberships([]);
        setActiveOrg(null);
      }
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, [loadWorkspaceForUser]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Échec de la connexion Google.';
      setAuthError(msg);
      throw err;
    }
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
    setMemberships([]);
    setActiveOrg(null);
  }, []);

  const selectOrganization = useCallback(
    async (orgId: string) => {
      if (!user) return;
      await upsertUserProfile(user, orgId);
      await loadWorkspaceForUser(user, orgId);
    },
    [user, loadWorkspaceForUser]
  );

  const createOrganization = useCallback(
    async (input: CreateOrganizationInput) => {
      if (!user) throw new Error('Authentification requise.');
      const newOrgId = await createOrganizationWorkspace(user, input);
      await loadWorkspaceForUser(user, newOrgId);
      return newOrgId;
    },
    [user, loadWorkspaceForUser]
  );

  const refreshWorkspace = useCallback(async () => {
    if (!user) return;
    await loadWorkspaceForUser(user, activeOrg?.id);
  }, [user, activeOrg?.id, loadWorkspaceForUser]);

  const getIdToken = useCallback(async () => {
    if (!auth.currentUser) return null;
    return auth.currentUser.getIdToken();
  }, []);

  const activeRole = useMemo<OrgRole | null>(() => {
    if (!activeOrg) return null;
    return memberships.find((m) => m.orgId === activeOrg.id)?.role ?? null;
  }, [activeOrg, memberships]);

  return (
    <AuthContext.Provider
      value={{
        user,
        authReady,
        loadingWorkspace,
        memberships,
        activeOrg,
        activeRole,
        authError,
        signInWithGoogle,
        signOut,
        selectOrganization,
        createOrganization,
        refreshWorkspace,
        getIdToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
