import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { getStorage } from 'firebase/storage';
import { auth } from '../lib/firebase.ts';

const storage = getStorage();
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

export async function uploadOrganizationLogo(orgId: string, file: File): Promise<string> {
  if (!auth.currentUser) throw new Error('Connexion requise.');
  if (!orgId) throw new Error('Organisation non sélectionnée.');
  if (!ALLOWED_LOGO_TYPES.includes(file.type)) throw new Error('Format autorisé : PNG, JPG, WebP ou SVG.');
  if (file.size > MAX_LOGO_BYTES) throw new Error('Le logo doit peser 2 Mo maximum.');
  const extension = file.name.split('.').pop()?.toLowerCase() || 'png';
  const target = ref(storage, 'organizations/' + orgId + '/branding/logo.' + extension);
  await uploadBytes(target, file, { contentType: file.type, customMetadata: { orgId, uploadedBy: auth.currentUser.uid } });
  return getDownloadURL(target);
}
