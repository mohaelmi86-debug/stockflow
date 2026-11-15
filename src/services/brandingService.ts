import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase.ts';
import { DEFAULT_BRANDING, type OrganizationBranding } from '../shared/branding.ts';

const safeColor = (value: string, fallback: string) =>
  /^#[0-9A-Fa-f]{6}$/.test(value) ? value : fallback;

export async function getOrganizationBranding(orgId: string): Promise<OrganizationBranding> {
  const snap = await getDoc(doc(db, 'organizations', orgId, 'settings', 'branding'));
  const data = snap.exists() ? snap.data() : {};
  return {
    orgId,
    ...DEFAULT_BRANDING,
    ...data,
    primaryColor: safeColor(String(data.primaryColor ?? DEFAULT_BRANDING.primaryColor), DEFAULT_BRANDING.primaryColor),
    accentColor: safeColor(String(data.accentColor ?? DEFAULT_BRANDING.accentColor), DEFAULT_BRANDING.accentColor),
  } as OrganizationBranding;
}

export async function saveOrganizationBranding(
  orgId: string,
  actorUid: string,
  input: Omit<OrganizationBranding, 'orgId' | 'updatedAt' | 'updatedBy'>
): Promise<void> {
  if (!orgId || !actorUid) throw new Error('Organisation et utilisateur requis.');
  if (!input.brandName.trim() || input.brandName.length > 80) throw new Error('Nom de marque invalide (1 à 80 caractères).');
  if (!/^#[0-9A-Fa-f]{6}$/.test(input.primaryColor) || !/^#[0-9A-Fa-f]{6}$/.test(input.accentColor)) {
    throw new Error('Les couleurs doivent être au format hexadécimal #RRGGBB.');
  }
  if (input.logoUrl.length > 2048 || input.supportEmail.length > 254 || input.footerText.length > 180) {
    throw new Error('Un champ dépasse la longueur autorisée.');
  }
  await setDoc(doc(db, 'organizations', orgId, 'settings', 'branding'), {
    ...input, orgId, updatedAt: serverTimestamp(), updatedBy: actorUid,
  });
}
