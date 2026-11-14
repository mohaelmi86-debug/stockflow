import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, LogOut, Database } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext.tsx';
import { useToast } from '../../contexts/ToastContext.tsx';
import { createOrganizationSchema, type CreateOrganizationInput } from '../../shared/schemas.ts';
import { Button } from '../ui/Button.tsx';

export function OnboardingPage() {
  const { user, createOrganization, signOut } = useAuth();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
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

  const seedDemo = watch('seedDemo');

  const onSubmit = async (data: CreateOrganizationInput) => {
    setSubmitting(true);
    try {
      await createOrganization(data);
      toast({
        variant: 'success',
        title: 'Organisation créée',
        description: `L’espace « ${data.name} » est prêt.`,
      });
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Erreur lors de la création',
        description: err instanceof Error ? err.message : 'Impossible de créer l’organisation.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-5 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                Créer votre première organisation
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Connecté en tant que {user?.email}
              </p>
            </div>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => void signOut()}>
            <LogOut className="h-4 w-4" />
            <span>Déconnexion</span>
          </Button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
          <div>
            <label htmlFor="org-name" className="block text-sm font-medium text-slate-700 dark:text-slate-200">
              Raison sociale / Nom de l’entreprise
            </label>
            <input
              id="org-name"
              type="text"
              placeholder="Ex. Atelier Industriel Horizon SAS"
              {...register('name')}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
            {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="org-currency" className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                Devise principale
              </label>
              <select
                id="org-currency"
                {...register('currency')}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="EUR">EUR — Euro (€)</option>
                <option value="USD">USD — Dollar US ($)</option>
                <option value="CHF">CHF — Franc suisse</option>
                <option value="GBP">GBP — Livre sterling (£)</option>
                <option value="CAD">CAD — Dollar canadien</option>
                <option value="MAD">MAD — Dirham marocain</option>
                <option value="XOF">XOF — Franc CFA</option>
              </select>
            </div>
            <div>
              <label htmlFor="org-country" className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                Pays
              </label>
              <input
                id="org-country"
                type="text"
                {...register('country')}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="org-siret" className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                SIRET (optionnel)
              </label>
              <input
                id="org-siret"
                type="text"
                placeholder="123 456 789 00012"
                {...register('siret')}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-mono text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="org-vat" className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                N° TVA intracommunautaire (optionnel)
              </label>
              <input
                id="org-vat"
                type="text"
                placeholder="FR12345678901"
                {...register('vatNumber')}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-mono text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
            <div className="flex items-start gap-3">
              <Database className="h-5 w-5 text-blue-600 shrink-0 mt-0.5 dark:text-blue-400" />
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Initialisation des données
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Choisissez d’injecter un jeu de données de démonstration identifié (2 entrepôts, 6 produits, mouvements initiaux et alertes) ou de partir d’un environnement vierge.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setValue('seedDemo', true)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
                      seedDemo
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700'
                    }`}
                  >
                    Avec données de démonstration
                  </button>
                  <button
                    type="button"
                    onClick={() => setValue('seedDemo', false)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
                      !seedDemo
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700'
                    }`}
                  >
                    Espace vierge
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
              {submitting ? 'Initialisation en cours...' : 'Créer et ouvrir l’ERP'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
