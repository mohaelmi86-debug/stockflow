export type BrandingMode = 'stockflow' | 'cobrand' | 'whitelabel';

export interface OrganizationBranding {
  orgId: string;
  mode: BrandingMode;
  brandName: string;
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
  supportEmail: string;
  footerText: string;
  showStockFlow: boolean;
  updatedAt?: unknown;
  updatedBy?: string;
}

export const DEFAULT_BRANDING: Omit<OrganizationBranding, 'orgId'> = {
  mode: 'stockflow',
  brandName: 'StockFlow',
  logoUrl: '/stockflow-logo.svg',
  primaryColor: '#124A9C',
  accentColor: '#F47716',
  supportEmail: '',
  footerText: 'Propulsé par StockFlow ERP',
  showStockFlow: true,
};
