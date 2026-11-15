import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext.tsx';
import { DEFAULT_BRANDING, type OrganizationBranding } from '../shared/branding.ts';
import { getOrganizationBranding } from '../services/brandingService.ts';

interface BrandingContextValue {
  branding: OrganizationBranding;
  loadingBranding: boolean;
  refreshBranding: () => Promise<void>;
}
const BrandingContext = createContext<BrandingContextValue | null>(null);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { activeOrg } = useAuth();
  const [branding, setBranding] = useState<OrganizationBranding>({ orgId: '', ...DEFAULT_BRANDING });
  const [loadingBranding, setLoadingBranding] = useState(false);

  const refreshBranding = useCallback(async () => {
    const orgId = activeOrg?.id;
    if (!orgId) {
      setBranding({ orgId: '', ...DEFAULT_BRANDING });
      setLoadingBranding(false);
      return;
    }
    setLoadingBranding(true);
    try {
      const loaded = await getOrganizationBranding(orgId);
      // Avoid applying a late response after the user switches organization.
      setBranding(current => current.orgId === orgId || current.orgId === '' ? loaded : current);
    } catch (error) {
      console.error('Impossible de charger la marque de l’organisation:', error);
      setBranding(current => current.orgId === orgId ? { orgId, ...DEFAULT_BRANDING } : current);
    } finally {
      setLoadingBranding(false);
    }
  }, [activeOrg?.id]);

  useEffect(() => { void refreshBranding(); }, [refreshBranding]);
  useEffect(() => {
    document.documentElement.style.setProperty('--brand-primary', branding.primaryColor);
    document.documentElement.style.setProperty('--brand-accent', branding.accentColor);
  }, [branding.primaryColor, branding.accentColor]);

  const value = useMemo(() => ({ branding, loadingBranding, refreshBranding }), [branding, loadingBranding, refreshBranding]);
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding() {
  const value = useContext(BrandingContext);
  if (!value) throw new Error('useBranding must be used inside BrandingProvider');
  return value;
}
