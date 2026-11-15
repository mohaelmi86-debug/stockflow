import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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

  const refreshBranding = async () => {
    if (!activeOrg?.id) {
      setBranding({ orgId: '', ...DEFAULT_BRANDING });
      return;
    }
    setLoadingBranding(true);
    try {
      setBranding(await getOrganizationBranding(activeOrg.id));
    } catch (error) {
      console.error('Impossible de charger la marque de l’organisation:', error);
      setBranding({ orgId: activeOrg.id, ...DEFAULT_BRANDING });
    } finally {
      setLoadingBranding(false);
    }
  };

  useEffect(() => { void refreshBranding(); }, [activeOrg?.id]);
  useEffect(() => {
    document.documentElement.style.setProperty('--brand-primary', branding.primaryColor);
    document.documentElement.style.setProperty('--brand-accent', branding.accentColor);
  }, [branding.primaryColor, branding.accentColor]);

  const value = useMemo(() => ({ branding, loadingBranding, refreshBranding }), [branding, loadingBranding]);
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding() {
  const value = useContext(BrandingContext);
  if (!value) throw new Error('useBranding must be used inside BrandingProvider');
  return value;
}
