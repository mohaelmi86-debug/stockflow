import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Sidebar } from './Sidebar.tsx';
import { Header } from './Header.tsx';
import { Modal } from '../ui/Modal.tsx';
import { Button } from '../ui/Button.tsx';
import { useAuth } from '../../contexts/AuthContext.tsx';
import { useToast } from '../../contexts/ToastContext.tsx';
import { createOrganizationSchema, type CreateOrganizationInput } from '../../shared/schemas.ts';

export function ErpLayout({ children }: { children: ReactNode }) {
  const { createOrganization } = useAuth();
  const { toast } = useToast();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [newOrgOpen, setNewOrgOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [creatingOrg, setCreatingOrg] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateOrganizationInput>({
    resolver: zodResolver(createOrganizationSchema) as never,
    defaultValues: {
      name: '',
      currency: 'EUR',
      country: 'France',
      siret: '',
      vatNumber: '',
      seedDemo: true,
    },
  });

  const handleCreateOrg = async (data: CreateOrganizationInput) => {
    setCreatingOrg(true);
    try {
      await createOrganization(data);
      toast({
        variant: 'success',
        title: 'Entreprise créée',
        description: `Basculé sur l’organisation « ${data.name} ».`,
      });
      reset();
      setNewOrgOpen(false);
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Erreur',
        description: err instanceof Error ? err.message : 'Échec de création.',
      });
    } finally {
      setCreatingOrg(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950">
      <Sidebar mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />

      <div className="flex flex-1 flex-col min-w-0">
        <Header
          onOpenMobileMenu={() => setMobileOpen(true)}
          onOpenNewOrg={() => setNewOrgOpen(true)}
          onOpenHelp={() => setHelpOpen(true)}
        />
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>

      {/* New Organization Modal */}
      <Modal
        open={newOrgOpen}
        onClose={() => setNewOrgOpen(false)}
        title="Créer une nouvelle organisation"
        subtitle="Chaque organisation possède ses propres produits, entrepôts, stocks et permissions."
      >
        <form onSubmit={handleSubmit(handleCreateOrg)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
              Nom de l’entreprise
            </label>
            <input
              type="text"
              placeholder="Ex. Distribution Sud SARL"
              {...register('name')}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
            {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Devise</label>
              <select
                {...register('currency')}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="EUR">EUR (€)</option>
                <option value="USD">USD ($)</option>
                <option value="CHF">CHF</option>
                <option value="GBP">GBP (£)</option>
                <option value="CAD">CAD ($)</option>
                <option value="MAD">MAD</option>
                <option value="XOF">XOF</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Pays</label>
              <input
                type="text"
                {...register('country')}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </div>
          <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
            <input type="checkbox" {...register('seedDemo')} className="rounded border-slate-300" />
            <span>Inclure le jeu de données de démonstration</span>
          </label>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setNewOrgOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={creatingOrg}>
              {creatingOrg ? 'Création...' : 'Créer l’entreprise'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Help Modal */}
      <Modal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Guide StockFlow ERP"
        subtitle="Architecture multi-tenant, traçabilité des stocks et modules opérationnels"
      >
        <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-white">
              Règle fondamentale de traçabilité des stocks
            </h3>
            <p className="mt-1 text-xs">
              Il est impossible de modifier manuellement une quantité en stock. Toute variation passe par un mouvement transactionnel (Entrée, Sortie, Transfert ou Ajustement) générant une référence unique et une trace immuable dans le journal d’audit.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-white">
              Chaîne ERP complète opérationnelle
            </h3>
            <ul className="mt-1 list-disc pl-5 text-xs space-y-1">
              <li>Multi-organisations isolées par locataire avec contrôle d’accès RBAC (owner, admin, manager, operator, viewer)</li>
              <li>Catalogue Produits (CSV), Stocks transactionnels, Entrepôts &amp; Jumeau Numérique 3D Three.js</li>
              <li>Chaîne Achats (demandes, devis fournisseurs, commandes, réceptions) et Ventes / Facturation / Paiements</li>
              <li>Rapports analytiques exportables, Assistant IA Gemini avec confirmation humaine et Abonnements SaaS Stripe</li>
            </ul>
          </div>
        </div>
      </Modal>
    </div>
  );
}
