import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Shield,
  Users,
  CreditCard,
  History,
  Lock,
  Download,
  UserPlus,
  Trash2,
  ExternalLink,
  CheckCircle2,
  KeyRound,
  Search,
  Palette,
  Eye,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useBranding } from '../contexts/BrandingContext.tsx';
import { saveOrganizationBranding } from '../services/brandingService.ts';
import { DEFAULT_BRANDING, type BrandingMode } from '../shared/branding.ts';
import { useToast } from '../contexts/ToastContext.tsx';
import { useErpData } from '../hooks/useErpData.ts';
import {
  addOrganizationMember,
  joinOrganizationWithInvitation,
  removeOrganizationMember,
  updateOrganizationDetails,
  updateOrganizationMemberRole,
} from '../services/erpService.ts';
import {
  addOrganizationMemberSchema,
  updateOrganizationSchema,
  type AddOrganizationMemberInput,
  type UpdateOrganizationInput,
} from '../shared/schemas.ts';
import { formatDateTime } from '../shared/formatters.ts';
import {
  PLAN_QUOTAS,
  type BillingCycle,
  type MemberStatus,
  type OrganizationMember,
  type OrgRole,
  type PlanCode,
} from '../shared/types.ts';
import { Button } from '../components/ui/Button.tsx';
import { StatusText } from '../components/ui/StatusText.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { ConfirmDialog } from '../components/ui/ConfirmDialog.tsx';

type SettingsTab = 'general' | 'branding' | 'team' | 'plans' | 'audit' | 'security';

interface BillingStatusResponse {
  stripeConfigured: boolean;
  webhookConfigured: boolean;
  annualDiscountPct: number;
}

const ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  manager: 'Responsable',
  operator: 'Opérateur',
  viewer: 'Lecteur',
};

const STATUS_LABELS: Record<MemberStatus, string> = {
  active: 'Actif',
  invited: 'Invité',
  suspended: 'Suspendu',
};

const RBAC_MATRIX: Array<{
  domain: string;
  owner: string;
  admin: string;
  manager: string;
  operator: string;
  viewer: string;
}> = [
  {
    domain: 'Organisation, Abonnement Stripe & Membres',
    owner: 'Complet',
    admin: 'Complet (sauf propriétaire)',
    manager: 'Lecture seule',
    operator: 'Lecture seule',
    viewer: 'Lecture seule',
  },
  {
    domain: 'Catalogue Produits, Catégories & Entrepôts',
    owner: 'Complet + Suppression',
    admin: 'Complet + Suppression',
    manager: 'Création / Modification',
    operator: 'Lecture seule',
    viewer: 'Lecture seule',
  },
  {
    domain: 'Mouvements de stock & Réceptions / Expéditions',
    owner: 'Complet',
    admin: 'Complet',
    manager: 'Complet',
    operator: 'Complet',
    viewer: 'Lecture seule',
  },
  {
    domain: 'Achats, Ventes, Devis & Facturation',
    owner: 'Complet + Suppression',
    admin: 'Complet + Suppression',
    manager: 'Création / Validation',
    operator: 'Préparation / Saisie',
    viewer: 'Lecture seule',
  },
  {
    domain: 'Assistant IA Gemini & Rapports',
    owner: 'Lecture + Actions confirmées',
    admin: 'Lecture + Actions confirmées',
    manager: 'Lecture + Actions confirmées',
    operator: 'Analyse & Stocks',
    viewer: 'Analyse lecture seule',
  },
];

function QuotaProgressBar({ label, current, max }: { label: string; current: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((current / max) * 100)) : 0;
  const barTone =
    pct >= 90 ? 'bg-red-600' : pct >= 70 ? 'bg-amber-500' : 'bg-blue-600';
  return (
    <div className="rounded-lg border border-slate-200 p-3.5 dark:border-slate-800">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500 dark:text-slate-400">{label}</span>
        <span className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
          {current.toLocaleString('fr-FR')} / {max.toLocaleString('fr-FR')}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className={`h-full transition-all ${barTone}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-[11px] text-slate-400 tabular-nums">{pct}% utilisé</p>
    </div>
  );
}

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, activeOrg, activeRole, getIdToken, refreshWorkspace } = useAuth();
  const { branding, refreshBranding } = useBranding();
  const [brandingDraft, setBrandingDraft] = useState({ ...DEFAULT_BRANDING });
  const [brandingSaving, setBrandingSaving] = useState(false);
  const { toast } = useToast();
  const {
    members,
    auditLogs,
    products,
    warehouses,
    suppliers,
    customers,
    salesInvoices,
    invalidateAll,
  } = useErpData();

  const resolveTabFromParam = (raw: string | null): SettingsTab => {
    if (raw === 'branding' || raw === 'team' || raw === 'plans' || raw === 'audit' || raw === 'security') return raw;
    return 'general';
  };

  const [tab, setTab] = useState<SettingsTab>(() => resolveTabFromParam(searchParams.get('tab')));
  const [saving, setSaving] = useState(false);

  // Billing / Stripe state
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(
    activeOrg?.billingCycle ?? 'monthly'
  );
  const [billingStatus, setBillingStatus] = useState<BillingStatusResponse | null>(null);
  const [checkoutPendingUrl, setCheckoutPendingUrl] = useState<string | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);

  // Team RBAC state
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [joinOrgModalOpen, setJoinOrgModalOpen] = useState(false);
  const [joinOrgIdInput, setJoinOrgIdInput] = useState('');
  const [removeTarget, setRemoveTarget] = useState<OrganizationMember | null>(null);
  const [teamBusy, setTeamBusy] = useState(false);

  // Audit filter state
  const [auditSearch, setAuditSearch] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('ALL');

  const isAdmin = activeRole === 'owner' || activeRole === 'admin';

  useEffect(() => {
    setBrandingDraft({ ...branding });
  }, [branding]);

  useEffect(() => {
    const paramTab = searchParams.get('tab');
    if (paramTab) {
      setTab(resolveTabFromParam(paramTab));
    }
  }, [searchParams]);

  useEffect(() => {
    if (activeOrg?.billingCycle) {
      setBillingCycle(activeOrg.billingCycle);
    }
  }, [activeOrg?.billingCycle]);

  // Load server-side Stripe capability status
  useEffect(() => {
    let mounted = true;
    fetch('/api/billing/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: BillingStatusResponse | null) => {
        if (mounted && data) setBillingStatus(data);
      })
      .catch(() => {
        // Non-blocking status lookup
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Verify Stripe Checkout callback if redirected back with ?checkout=success&session_id=...
  useEffect(() => {
    const checkoutState = searchParams.get('checkout');
    const sessionId = searchParams.get('session_id');
    if (!checkoutState || !activeOrg || !user) return;

    if (checkoutState === 'cancel') {
      toast({
        variant: 'info',
        title: 'Paiement annulé',
        description: 'Votre abonnement actuel reste inchangé.',
      });
      setSearchParams({ tab: 'plans' }, { replace: true });
      return;
    }

    if (checkoutState === 'success' && sessionId) {
      let active = true;
      (async () => {
        setBillingBusy(true);
        try {
          const token = await getIdToken();
          const res = await fetch('/api/billing/verify-session', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ sessionId }),
          });
          const data = (await res.json()) as {
            verified?: boolean;
            planCode?: PlanCode;
            billingCycle?: BillingCycle;
            stripeCustomerId?: string;
            stripeSubscriptionId?: string;
            error?: string;
          };
          if (!res.ok || !data.verified || !data.planCode) {
            throw new Error(data.error || 'Paiement Stripe non confirmé.');
          }
          await Promise.all([refreshWorkspace(), invalidateAll()]);
          if (active) {
            toast({
              variant: 'success',
              title: 'Abonnement Stripe activé',
              description: `Plan ${PLAN_QUOTAS[data.planCode].name} activé avec succès.`,
            });
          }
        } catch (err) {
          if (active) {
            toast({
              variant: 'error',
              title: 'Vérification Stripe impossible',
              description: err instanceof Error ? err.message : 'Erreur lors de l’activation.',
            });
          }
        } finally {
          if (active) {
            setBillingBusy(false);
            setSearchParams({ tab: 'plans' }, { replace: true });
          }
        }
      })();
      return () => {
        active = false;
      };
    }
  }, [searchParams, activeOrg, user, getIdToken, refreshWorkspace, invalidateAll, toast, setSearchParams]);

  const form = useForm<UpdateOrganizationInput>({
    resolver: zodResolver(updateOrganizationSchema) as never,
    defaultValues: {
      name: activeOrg?.name ?? '',
      currency: activeOrg?.currency ?? 'EUR',
      country: activeOrg?.country ?? 'France',
      siret: activeOrg?.siret ?? '',
      vatNumber: activeOrg?.vatNumber ?? '',
    },
  });

  const inviteForm = useForm<AddOrganizationMemberInput>({
    resolver: zodResolver(addOrganizationMemberSchema) as never,
    defaultValues: {
      uid: '',
      email: '',
      displayName: '',
      role: 'operator',
    },
  });

  useEffect(() => {
    if (activeOrg) {
      form.reset({
        name: activeOrg.name,
        currency: activeOrg.currency,
        country: activeOrg.country ?? 'France',
        siret: activeOrg.siret ?? '',
        vatNumber: activeOrg.vatNumber ?? '',
      });
    }
  }, [activeOrg, form]);

  const onSubmitGeneral = async (data: UpdateOrganizationInput) => {
    if (!activeOrg || !user) return;
    setSaving(true);
    try {
      await updateOrganizationDetails(
        activeOrg.id,
        data,
        { uid: user.uid, email: user.email ?? 'admin@stockflow.local' },
        activeOrg.memberUids
      );
      await Promise.all([refreshWorkspace(), invalidateAll()]);
      toast({ variant: 'success', title: 'Paramètres enregistrés' });
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Erreur',
        description: err instanceof Error ? err.message : 'Impossible de mettre à jour.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSelectPlan = async (targetPlan: PlanCode) => {
    if (!activeOrg || !user || !isAdmin) return;
    setBillingBusy(true);
    setCheckoutPendingUrl(null);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/billing/checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ orgId: activeOrg.id, planCode: targetPlan, billingCycle }),
      });
      const data = await res.json() as { mode?: 'stripe' | 'free'; checkoutUrl?: string; error?: string };
      if (!res.ok) throw new Error(data.error || 'Souscription impossible.');
      if (data.mode === 'free') {
        await Promise.all([refreshWorkspace(), invalidateAll()]);
        toast({ variant: 'success', title: 'Plan Starter activé', description: 'Le changement a été confirmé côté serveur.' });
      } else {
        if (!data.checkoutUrl) throw new Error('Stripe n’a pas retourné de lien de paiement.');
        setCheckoutPendingUrl(data.checkoutUrl);
        toast({ variant: 'info', title: 'Session Stripe prête', description: 'Finalisez le paiement sur Stripe. Le plan sera activé après confirmation serveur.' });
      }
    } catch (err) {
      toast({ variant: 'error', title: 'Facturation impossible', description: err instanceof Error ? err.message : 'Erreur Stripe.' });
    } finally {
      setBillingBusy(false);
    }
  };

  const handleOpenCustomerPortal = async () => {
    if (!activeOrg || !activeOrg.stripeCustomerId) return;
    setBillingBusy(true);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/billing/portal-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ orgId: activeOrg.id }),
      });
      const data = (await res.json()) as { portalUrl?: string; error?: string };
      if (!res.ok || !data.portalUrl) {
        throw new Error(data.error || 'Portail client indisponible.');
      }
      setCheckoutPendingUrl(data.portalUrl);
      toast({
        variant: 'info',
        title: 'Portail client Stripe prêt',
        description: 'Utilisez le lien généré pour accéder à vos factures Stripe.',
      });
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Portail Stripe indisponible',
        description: err instanceof Error ? err.message : 'Erreur serveur.',
      });
    } finally {
      setBillingBusy(false);
    }
  };

  const currentQuota = PLAN_QUOTAS[activeOrg?.plan ?? 'starter'];

  const handleInviteMember = async (data: AddOrganizationMemberInput) => {
    if (!activeOrg || !user) return;
    if (members.length >= currentQuota.maxUsers) {
      toast({
        variant: 'warning',
        title: 'Quota utilisateurs atteint',
        description: `Votre plan ${currentQuota.name} limite l’équipe à ${currentQuota.maxUsers} membres. Passez au plan supérieur.`,
      });
      return;
    }
    setTeamBusy(true);
    try {
      await addOrganizationMember({
        org: activeOrg,
        input: data,
        actor: { uid: user.uid, email: user.email ?? 'admin@stockflow.local' },
      });
      await Promise.all([refreshWorkspace(), invalidateAll()]);
      inviteForm.reset();
      setInviteModalOpen(false);
      toast({
        variant: 'success',
        title: 'Collaborateur invité',
        description: `${data.displayName} (${ROLE_LABELS[data.role]}) ajouté à l’organisation.`,
      });
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Invitation refusée',
        description: err instanceof Error ? err.message : 'Impossible d’ajouter le collaborateur.',
      });
    } finally {
      setTeamBusy(false);
    }
  };

  const handleJoinOrg = async () => {
    if (!user || !joinOrgIdInput.trim()) return;
    setTeamBusy(true);
    try {
      await joinOrganizationWithInvitation(user, joinOrgIdInput);
      await Promise.all([refreshWorkspace(), invalidateAll()]);
      setJoinOrgIdInput('');
      setJoinOrgModalOpen(false);
      toast({
        variant: 'success',
        title: 'Organisation rejointe',
        description: 'Votre espace actif a été basculé sur cette organisation.',
      });
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Accès impossible',
        description: err instanceof Error ? err.message : 'Invitation introuvable.',
      });
    } finally {
      setTeamBusy(false);
    }
  };

  const handleRoleOrStatusChange = async (
    member: OrganizationMember,
    nextRole: Exclude<OrgRole, 'owner'>,
    nextStatus: MemberStatus
  ) => {
    if (!activeOrg || !user) return;
    setTeamBusy(true);
    try {
      await updateOrganizationMemberRole({
        org: activeOrg,
        targetMember: member,
        role: nextRole,
        status: nextStatus,
        actor: { uid: user.uid, email: user.email ?? 'admin@stockflow.local' },
      });
      await invalidateAll();
      toast({
        variant: 'success',
        title: 'Droits mis à jour',
        description: `${member.displayName} : ${ROLE_LABELS[nextRole]} (${STATUS_LABELS[nextStatus]})`,
      });
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Modification refusée',
        description: err instanceof Error ? err.message : 'Erreur RBAC.',
      });
    } finally {
      setTeamBusy(false);
    }
  };

  const handleConfirmRemoveMember = async () => {
    if (!activeOrg || !user || !removeTarget) return;
    setTeamBusy(true);
    try {
      await removeOrganizationMember({
        org: activeOrg,
        targetMember: removeTarget,
        actor: { uid: user.uid, email: user.email ?? 'admin@stockflow.local' },
      });
      await Promise.all([refreshWorkspace(), invalidateAll()]);
      toast({
        variant: 'success',
        title: 'Membre révoqué',
        description: `${removeTarget.displayName} n’a plus accès à ${activeOrg.name}.`,
      });
      setRemoveTarget(null);
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Révocation impossible',
        description: err instanceof Error ? err.message : 'Erreur.',
      });
    } finally {
      setTeamBusy(false);
    }
  };

  const auditActions = useMemo(
    () => Array.from(new Set(auditLogs.map((l) => l.action))).sort(),
    [auditLogs]
  );

  const filteredAudit = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    return auditLogs.filter((log) => {
      if (auditActionFilter !== 'ALL' && log.action !== auditActionFilter) return false;
      if (!q) return true;
      return (
        log.action.toLowerCase().includes(q) ||
        log.summary.toLowerCase().includes(q) ||
        log.actorEmail.toLowerCase().includes(q)
      );
    });
  }, [auditLogs, auditSearch, auditActionFilter]);

  const handleExportAuditCsv = () => {
    const header = ['Action', 'Entité', 'ID Entité', 'Résumé', 'Acteur', 'Date'];
    const rows = filteredAudit.map((l) =>
      [
        l.action,
        l.entityType,
        l.entityId,
        `"${l.summary.replace(/"/g, '""')}"`,
        l.actorEmail,
        formatDateTime(l.createdAt),
      ].join(';')
    );
    const csv = '\uFEFF' + [header.join(';'), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_${activeOrg?.slug ?? 'stockflow'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ variant: 'info', title: 'Journal d’audit exporté', description: `${filteredAudit.length} événement(s)` });
  };

  const handleExportComplianceJson = () => {
    if (!activeOrg) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      organization: {
        id: activeOrg.id,
        name: activeOrg.name,
        slug: activeOrg.slug,
        currency: activeOrg.currency,
        plan: activeOrg.plan,
        billingCycle: activeOrg.billingCycle ?? 'monthly',
        subscriptionStatus: activeOrg.subscriptionStatus ?? 'active',
        siret: activeOrg.siret ?? '',
        vatNumber: activeOrg.vatNumber ?? '',
      },
      counts: {
        members: members.length,
        warehouses: warehouses.length,
        products: products.length,
        suppliers: suppliers.length,
        customers: customers.length,
        salesInvoices: salesInvoices.length,
        auditEvents: auditLogs.length,
      },
      members: members.map((m) => ({
        uid: m.uid,
        displayName: m.displayName,
        email: m.email,
        role: m.role,
        status: m.status,
      })),
      recentAuditLogs: auditLogs.slice(0, 100),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conformite_rgpd_${activeOrg.slug}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ variant: 'success', title: 'Archive RGPD / Audit générée' });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Accueil / Administration / Paramètres</p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Paramètres, Facturation &amp; Multi-Tenant
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-600 dark:text-slate-400">
          <span>Plan : <strong className="text-slate-900 dark:text-white">{currentQuota.name}</strong></span>
          <span>·</span>
          <span>Rôle : <strong className="text-slate-900 dark:text-white">{activeRole ? ROLE_LABELS[activeRole] : '—'}</strong></span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1.5 w-fit dark:border-slate-800 dark:bg-slate-900">
        {[
          { id: 'general', label: 'Organisation', icon: Shield },
          { id: 'branding', label: 'Identité visuelle', icon: Palette },
          { id: 'team', label: 'Équipe & RBAC', icon: Users },
          { id: 'plans', label: 'Abonnement & Stripe', icon: CreditCard },
          { id: 'audit', label: 'Journal d’audit', icon: History },
          { id: 'security', label: 'Isolation & RGPD', icon: Lock },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                const next = t.id as SettingsTab;
                setTab(next);
                setSearchParams({ tab: next }, { replace: true });
              }}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                tab === t.id
                  ? 'bg-slate-900 text-white dark:bg-blue-600'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      
      {tab === 'branding' && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
          <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-5">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">Identité visuelle & marque blanche</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Personnalisez l’expérience de votre organisation. Seuls les propriétaires et administrateurs peuvent modifier ces paramètres.</p>
            </div>
            {!isAdmin ? <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Accès en lecture seule : demandez à un administrateur de modifier la marque.</div> : (
              <form className="space-y-5" onSubmit={async (event) => {
                event.preventDefault();
                if (!activeOrg || !user) return;
                setBrandingSaving(true);
                try {
                  await saveOrganizationBranding(activeOrg.id, user.uid, brandingDraft);
                  await refreshBranding();
                  toast({ variant: 'success', title: 'Identité visuelle enregistrée', description: 'La marque est appliquée à votre espace.' });
                } catch (error) {
                  toast({ variant: 'error', title: 'Enregistrement impossible', description: error instanceof Error ? error.message : 'Erreur de sauvegarde.' });
                } finally { setBrandingSaving(false); }
              }}>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Mode de marque</label>
                  <select value={brandingDraft.mode} onChange={e => setBrandingDraft(d => ({ ...d, mode: e.target.value as BrandingMode, showStockFlow: e.target.value !== 'whitelabel' }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
                    <option value="stockflow">StockFlow (marque standard)</option>
                    <option value="cobrand">Co-branding (partenaire + StockFlow)</option>
                    <option value="whitelabel">Marque blanche (votre marque)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Nom affiché</label>
                  <input maxLength={80} required value={brandingDraft.brandName} onChange={e => setBrandingDraft(d => ({ ...d, brandName: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder="Ex. Mon ERP"/>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">URL du logo (HTTPS ou chemin public)</label>
                  <input maxLength={2048} type="url" value={brandingDraft.logoUrl.startsWith('/') ? '' : brandingDraft.logoUrl} onChange={e => setBrandingDraft(d => ({ ...d, logoUrl: e.target.value || '/stockflow-logo.svg' }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder="https://.../logo.png"/>
                  <p className="mt-1 text-[11px] text-slate-500">Le téléversement Firebase Storage sera ajouté ensuite. Cette version accepte une URL HTTPS.</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-xs font-medium">Couleur principale</label><div className="mt-1 flex gap-2"><input type="color" value={brandingDraft.primaryColor} onChange={e => setBrandingDraft(d => ({ ...d, primaryColor: e.target.value }))} className="h-10 w-12 rounded border"/><input value={brandingDraft.primaryColor} onChange={e => setBrandingDraft(d => ({ ...d, primaryColor: e.target.value }))} className="min-w-0 flex-1 rounded-lg border px-2 text-sm dark:bg-slate-950"/></div></div>
                  <div><label className="block text-xs font-medium">Couleur d’accent</label><div className="mt-1 flex gap-2"><input type="color" value={brandingDraft.accentColor} onChange={e => setBrandingDraft(d => ({ ...d, accentColor: e.target.value }))} className="h-10 w-12 rounded border"/><input value={brandingDraft.accentColor} onChange={e => setBrandingDraft(d => ({ ...d, accentColor: e.target.value }))} className="min-w-0 flex-1 rounded-lg border px-2 text-sm dark:bg-slate-950"/></div></div>
                </div>
                <div><label className="block text-xs font-medium">E-mail support</label><input type="email" maxLength={254} value={brandingDraft.supportEmail} onChange={e => setBrandingDraft(d => ({ ...d, supportEmail: e.target.value }))} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm dark:bg-slate-950" placeholder="support@entreprise.fr"/></div>
                <div><label className="block text-xs font-medium">Texte de pied de page</label><input maxLength={180} value={brandingDraft.footerText} onChange={e => setBrandingDraft(d => ({ ...d, footerText: e.target.value }))} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm dark:bg-slate-950"/></div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={brandingDraft.showStockFlow} onChange={e => setBrandingDraft(d => ({ ...d, showStockFlow: e.target.checked }))}/> Afficher « Propulsé par StockFlow »</label>
                <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setBrandingDraft({ ...branding })}>Annuler</Button><Button type="submit" disabled={brandingSaving}>{brandingSaving ? 'Enregistrement…' : 'Enregistrer la marque'}</Button></div>
              </form>
            )}
          </section>
          <aside className="space-y-4">
            <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Eye className="h-4 w-4"/> Aperçu</div>
              <div className="rounded-xl border bg-slate-950 p-4">
                <div className="rounded-lg bg-white p-3"><img src={brandingDraft.logoUrl || '/stockflow-logo.svg'} alt={brandingDraft.brandName} className="mx-auto h-12 max-w-full object-contain" onError={e => { e.currentTarget.src='/stockflow-logo.svg'; }}/></div>
                <div className="mt-4 text-center text-white"><div className="text-lg font-semibold">{brandingDraft.brandName}</div><div className="mt-1 text-xs text-slate-300">{brandingDraft.mode === 'whitelabel' ? 'Votre environnement ERP' : brandingDraft.mode === 'cobrand' ? 'Votre partenaire ERP · StockFlow' : 'StockFlow ERP'}</div></div>
                <div className="mt-4 flex justify-center gap-2"><span className="rounded px-3 py-1 text-xs text-white" style={{backgroundColor:brandingDraft.primaryColor}}>Principal</span><span className="rounded px-3 py-1 text-xs text-white" style={{backgroundColor:brandingDraft.accentColor}}>Accent</span></div>
                {brandingDraft.showStockFlow && <p className="mt-3 text-center text-[10px] text-slate-400">Propulsé par StockFlow ERP</p>}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">Aperçu indicatif de la connexion et de l’identité partenaire.</p>
            </section>
            <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200"><strong>À savoir</strong><ul className="mt-2 list-disc space-y-1 pl-4"><li>La marque est isolée par organisation.</li><li>Le co-branding conserve la mention StockFlow.</li><li>La marque blanche masque cette mention.</li><li>Les domaines personnalisés et emails sont à venir.</li></ul></section>
          </aside>
        </div>
      )}

      {tab === 'general' && (
        <div className="max-w-2xl rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Identité légale &amp; devise
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Identifiant organisation : <span className="font-mono">{activeOrg?.id}</span> · Votre rôle :{' '}
            <span className="font-mono">{activeRole}</span>
          </p>

          <form onSubmit={form.handleSubmit(onSubmitGeneral)} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
                Raison sociale *
              </label>
              <input
                type="text"
                {...form.register('name')}
                disabled={!isAdmin}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Devise</label>
                <select
                  {...form.register('currency')}
                  disabled={!isAdmin}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="EUR">EUR (€)</option>
                  <option value="USD">USD ($)</option>
                  <option value="CHF">CHF</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="CAD">CAD</option>
                  <option value="MAD">MAD</option>
                  <option value="XOF">XOF</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Pays</label>
                <input
                  type="text"
                  {...form.register('country')}
                  disabled={!isAdmin}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">SIRET</label>
                <input
                  type="text"
                  {...form.register('siret')}
                  disabled={!isAdmin}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
                  TVA intracommunautaire
                </label>
                <input
                  type="text"
                  {...form.register('vatNumber')}
                  disabled={!isAdmin}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={saving || !isAdmin}>
                {saving ? 'Enregistrement...' : 'Enregistrer les modifications'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {tab === 'team' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                  Membres &amp; contrôle d’accès RBAC ({members.length} / {currentQuota.maxUsers})
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Votre UID Firebase : <span className="font-mono text-slate-700 dark:text-slate-300">{user?.uid}</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setJoinOrgModalOpen(true)}>
                  <KeyRound className="h-3.5 w-3.5" />
                  <span>Rejoindre une organisation</span>
                </Button>
                {isAdmin && (
                  <Button type="button" size="sm" onClick={() => setInviteModalOpen(true)}>
                    <UserPlus className="h-3.5 w-3.5" />
                    <span>Inviter un collaborateur</span>
                  </Button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/70 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/60">
                  <tr>
                    <th className="px-4 py-3 font-medium">Utilisateur</th>
                    <th className="px-4 py-3 font-medium">Rôle RBAC</th>
                    <th className="px-4 py-3 font-medium">Statut</th>
                    <th className="px-4 py-3 font-medium">Membre depuis</th>
                    {isAdmin && <th className="px-4 py-3 text-right font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {members.map((m) => {
                    const isOwner = m.role === 'owner';
                    const isSelf = m.uid === user?.uid;
                    const canEditMember = isAdmin && !isOwner;
                    return (
                      <tr key={m.uid}>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900 dark:text-white">
                            {m.displayName} {isSelf && <span className="text-xs text-slate-400">(vous)</span>}
                          </p>
                          <p className="text-xs text-slate-500">{m.email}</p>
                          <p className="font-mono text-[11px] text-slate-400">{m.uid}</p>
                        </td>
                        <td className="px-4 py-3">
                          {canEditMember && !isSelf ? (
                            <select
                              value={m.role}
                              disabled={teamBusy}
                              onChange={(e) =>
                                handleRoleOrStatusChange(
                                  m,
                                  e.target.value as Exclude<OrgRole, 'owner'>,
                                  m.status
                                )
                              }
                              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-950"
                            >
                              <option value="admin">Administrateur</option>
                              <option value="manager">Responsable</option>
                              <option value="operator">Opérateur</option>
                              <option value="viewer">Lecteur</option>
                            </select>
                          ) : (
                            <span className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
                              {ROLE_LABELS[m.role]}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {canEditMember && !isSelf ? (
                            <select
                              value={m.status}
                              disabled={teamBusy}
                              onChange={(e) =>
                                handleRoleOrStatusChange(
                                  m,
                                  m.role as Exclude<OrgRole, 'owner'>,
                                  e.target.value as MemberStatus
                                )
                              }
                              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                            >
                              <option value="active">Actif</option>
                              <option value="invited">Invité</option>
                              <option value="suspended">Suspendu</option>
                            </select>
                          ) : (
                            <StatusText
                              tone={
                                m.status === 'active'
                                  ? 'success'
                                  : m.status === 'invited'
                                    ? 'warning'
                                    : 'error'
                              }
                              label={STATUS_LABELS[m.status]}
                            />
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">
                          {formatDateTime(m.joinedAt)}
                        </td>
                        {isAdmin && (
                          <td className="px-4 py-3 text-right">
                            {canEditMember && !isSelf ? (
                              <button
                                type="button"
                                onClick={() => setRemoveTarget(m)}
                                disabled={teamBusy}
                                title="Révoquer l’accès"
                                className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 cursor-pointer"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            ) : (
                              <span className="text-[11px] text-slate-400">—</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* RBAC Matrix */}
          <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Matrice des permissions RBAC appliquée côté Firestore
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Chaque règle est contrôlée côté serveur dans les règles de sécurité Firestore.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50/70 text-slate-500 dark:border-slate-800 dark:bg-slate-900/60">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Périmètre métier</th>
                    <th className="px-4 py-2.5 font-medium">Propriétaire</th>
                    <th className="px-4 py-2.5 font-medium">Administrateur</th>
                    <th className="px-4 py-2.5 font-medium">Responsable</th>
                    <th className="px-4 py-2.5 font-medium">Opérateur</th>
                    <th className="px-4 py-2.5 font-medium">Lecteur</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {RBAC_MATRIX.map((row) => (
                    <tr key={row.domain}>
                      <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-white">{row.domain}</td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{row.owner}</td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{row.admin}</td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{row.manager}</td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{row.operator}</td>
                      <td className="px-4 py-2.5 text-slate-500">{row.viewer}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'plans' && (
        <div className="space-y-6">
          {/* Consumption & Stripe connection bar */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Consommation actuelle — Plan {currentQuota.name}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Cycle : {activeOrg?.billingCycle === 'annual' ? 'Annuel (-20%)' : 'Mensuel'} ·{' '}
                  Statut : {activeOrg?.subscriptionStatus ?? 'active'} ·{' '}
                  Passerelle Stripe :{' '}
                  {billingStatus?.stripeConfigured
                    ? 'Stripe Checkout actif côté serveur'
                    : 'Souscriptions suspendues : Stripe doit être configuré côté serveur'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => setBillingCycle('monthly')}
                    className={`rounded-md px-3 py-1.5 font-medium cursor-pointer ${
                      billingCycle === 'monthly'
                        ? 'bg-slate-900 text-white dark:bg-blue-600'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Mensuel
                  </button>
                  <button
                    type="button"
                    onClick={() => setBillingCycle('annual')}
                    className={`rounded-md px-3 py-1.5 font-medium cursor-pointer ${
                      billingCycle === 'annual'
                        ? 'bg-slate-900 text-white dark:bg-blue-600'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Annuel (-20%)
                  </button>
                </div>
                {activeOrg?.stripeCustomerId && billingStatus?.stripeConfigured && isAdmin && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleOpenCustomerPortal}
                    disabled={billingBusy}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Portail client Stripe</span>
                  </Button>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <QuotaProgressBar label="Utilisateurs actifs" current={members.length} max={currentQuota.maxUsers} />
              <QuotaProgressBar label="Entrepôts" current={warehouses.length} max={currentQuota.maxWarehouses} />
              <QuotaProgressBar label="Produits catalogue" current={products.length} max={currentQuota.maxProducts} />
              <div className="rounded-lg border border-slate-200 p-3.5 dark:border-slate-800">
                <span className="text-xs text-slate-500 dark:text-slate-400">Crédits Assistant IA</span>
                <p className="mt-1 font-mono text-base font-semibold text-slate-900 dark:text-white tabular-nums">
                  {currentQuota.aiCreditsMonthly.toLocaleString('fr-FR')} / mois
                </p>
                <p className="mt-1.5 text-[11px] text-slate-400">Tool calling Gemini inclus</p>
              </div>
            </div>

            {checkoutPendingUrl && (
              <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-900/50 dark:bg-blue-950/30">
                <div className="text-xs text-slate-700 dark:text-slate-200">
                  <p className="font-semibold">Session Stripe prête</p>
                  <p className="mt-0.5 text-slate-600 dark:text-slate-400">
                    Finalisez le paiement dans un onglet sécurisé Stripe. Vous serez redirigé automatiquement vers StockFlow ERP à l’issue du paiement.
                  </p>
                </div>
                <a
                  href={checkoutPendingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 shrink-0"
                >
                  <span>Continuer vers Stripe</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {Object.values(PLAN_QUOTAS).map((plan) => {
              const isCurrent = plan.code === activeOrg?.plan;
              const displayedMonthlyPrice =
                plan.priceMonthlyEur === 0
                  ? 0
                  : billingCycle === 'annual'
                    ? Math.round(plan.priceMonthlyEur * 0.8)
                    : plan.priceMonthlyEur;
              return (
                <div
                  key={plan.code}
                  className={`rounded-xl border p-5 flex flex-col justify-between ${
                    isCurrent
                      ? 'border-blue-600 bg-white dark:bg-slate-900'
                      : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                        {plan.name}
                      </h3>
                      {isCurrent && <StatusText tone="info" label="Actuel" />}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{plan.targetAudience}</p>
                    <p className="mt-4 font-mono text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
                      {displayedMonthlyPrice === 0 ? 'Gratuit' : `${displayedMonthlyPrice} €`}
                      {displayedMonthlyPrice > 0 && (
                        <span className="text-xs font-normal text-slate-500">
                          {' '}
                          / mois{billingCycle === 'annual' ? ' (facturé annuellement)' : ''}
                        </span>
                      )}
                    </p>
                    <ul className="mt-4 space-y-2 text-xs text-slate-600 dark:text-slate-300 border-t border-slate-100 pt-4 dark:border-slate-800 font-mono tabular-nums">
                      <li>{plan.maxUsers} utilisateurs max.</li>
                      <li>{plan.maxWarehouses} entrepôt(s)</li>
                      <li>{plan.maxProducts.toLocaleString('fr-FR')} produits</li>
                      <li>{plan.aiCreditsMonthly.toLocaleString('fr-FR')} crédits IA / mois</li>
                    </ul>
                  </div>
                  <div className="mt-5">
                    <Button
                      type="button"
                      variant={isCurrent ? 'outline' : 'primary'}
                      className="w-full"
                      disabled={isCurrent || !isAdmin || billingBusy || (plan.priceMonthlyEur > 0 && !billingStatus?.stripeConfigured)}
                      onClick={() => handleSelectPlan(plan.code)}
                    >
                      {isCurrent
                        ? 'Plan actif'
                        : !isAdmin
                          ? 'Réservé aux admins'
                          : billingBusy
                            ? 'Préparation...'
                            : plan.priceMonthlyEur === 0
                              ? 'Revenir au plan Starter'
                              : billingStatus?.stripeConfigured
                                ? `Souscrire (${plan.name})`
                                : `Activer ${plan.name}`}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Journal d’audit immuable ({filteredAudit.length})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Traçabilité complète et inaltérable des opérations critiques de l’organisation.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  placeholder="Filtrer par acteur ou motif..."
                  className="rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <select
                value={auditActionFilter}
                onChange={(e) => setAuditActionFilter(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="ALL">Toutes les actions</option>
                {auditActions.map((act) => (
                  <option key={act} value={act}>
                    {act}
                  </option>
                ))}
              </select>
              <Button type="button" variant="outline" size="sm" onClick={handleExportAuditCsv}>
                <Download className="h-3.5 w-3.5" />
                <span>Exporter CSV</span>
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-slate-500 dark:border-slate-800 dark:bg-slate-900/60">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Action</th>
                  <th className="px-4 py-2.5 font-medium">Résumé</th>
                  <th className="px-4 py-2.5 font-medium">Acteur</th>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredAudit.map((log) => (
                  <tr key={log.id}>
                    <td className="px-4 py-2.5 font-mono font-semibold text-slate-800 dark:text-slate-200">
                      {log.action}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">{log.summary}</td>
                    <td className="px-4 py-2.5 text-slate-500">{log.actorEmail}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-400">{formatDateTime(log.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'security' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              {
                title: 'Isolation stricte par locataire (Multi-Tenant)',
                detail:
                  'Les lectures des collections d’organisation sont vérifiées par les règles Firestore à partir de l’adhésion active et du rôle.',
              },
              {
                title: 'Intégrité transactionnelle des stocks',
                detail:
                  'Les soldes stockBalances ne sont modifiables que via des transactions atomiques liées à un mouvement stockMovements traçable et immuable.',
              },
              {
                title: 'Conformité facturation & audit',
                detail:
                  'Les écritures d’audit (auditLogs), mouvements et factures émises sont protégés contre la modification ou la suppression non autorisée.',
              },
              {
                title: 'Clés API & Paiements côté serveur',
                detail:
                  'Les secrets GEMINI_API_KEY et STRIPE_SECRET_KEY restent exclusivement côté serveur Express et ne sont jamais exposés dans le bundle client.',
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{item.title}</h3>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      {item.detail}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Portabilité des données &amp; Export RGPD
              </h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Téléchargez un instantané structuré (JSON) des métadonnées de l’organisation, des membres RBAC et des 100 derniers événements d’audit.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={handleExportComplianceJson}>
              <Download className="h-4 w-4" />
              <span>Télécharger l’archive RGPD (JSON)</span>
            </Button>
          </div>
        </div>
      )}

      {/* Invite collaborator modal */}
      <Modal
        open={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        title="Inviter un collaborateur"
        subtitle="Renseignez l’UID Firebase du collaborateur et son rôle RBAC. Il pourra ensuite rejoindre via l’ID de l’organisation."
      >
        <form onSubmit={inviteForm.handleSubmit(handleInviteMember)} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
              UID Firebase du collaborateur *
            </label>
            <input
              type="text"
              placeholder="Ex. HiH2WgFdtbhJTmljauQmW4oFWkz2"
              {...inviteForm.register('uid')}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono dark:border-slate-700 dark:bg-slate-950"
            />
            {inviteForm.formState.errors.uid && (
              <p className="mt-1 text-xs text-red-600">{inviteForm.formState.errors.uid.message}</p>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
                Nom complet *
              </label>
              <input
                type="text"
                placeholder="Ex. Claire Martin"
                {...inviteForm.register('displayName')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
              {inviteForm.formState.errors.displayName && (
                <p className="mt-1 text-xs text-red-600">
                  {inviteForm.formState.errors.displayName.message}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
                E-mail professionnel *
              </label>
              <input
                type="email"
                placeholder="claire@entreprise.fr"
                {...inviteForm.register('email')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
              {inviteForm.formState.errors.email && (
                <p className="mt-1 text-xs text-red-600">{inviteForm.formState.errors.email.message}</p>
              )}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Rôle RBAC</label>
            <select
              {...inviteForm.register('role')}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="admin">Administrateur</option>
              <option value="manager">Responsable (Produits, Achats, Ventes)</option>
              <option value="operator">Opérateur (Stocks &amp; Préparation)</option>
              <option value="viewer">Lecteur (Consultation seule)</option>
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setInviteModalOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={teamBusy}>
              {teamBusy ? 'Envoi...' : 'Enregistrer l’invitation'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Join existing organization modal */}
      <Modal
        open={joinOrgModalOpen}
        onClose={() => setJoinOrgModalOpen(false)}
        title="Rejoindre une organisation existante"
        subtitle="Saisissez l’identifiant d’une organisation dans laquelle un administrateur vous a déjà invité avec votre UID."
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
              Identifiant organisation (orgId)
            </label>
            <input
              type="text"
              value={joinOrgIdInput}
              onChange={(e) => setJoinOrgIdInput(e.target.value)}
              placeholder="Ex. org_mwg83o7r_j9exro"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setJoinOrgModalOpen(false)}>
              Annuler
            </Button>
            <Button type="button" disabled={teamBusy || !joinOrgIdInput.trim()} onClick={handleJoinOrg}>
              {teamBusy ? 'Connexion...' : 'Accepter et rejoindre'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Remove member confirmation */}
      <ConfirmDialog
        open={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleConfirmRemoveMember}
        loading={teamBusy}
        title="Révoquer l’accès du collaborateur ?"
        description={
          removeTarget
            ? `${removeTarget.displayName} (${removeTarget.email}) perdra immédiatement l’accès à ${activeOrg?.name}.`
            : ''
        }
        confirmLabel="Révoquer l’accès"
      />
    </div>
  );
}
