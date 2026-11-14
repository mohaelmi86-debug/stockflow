import { Link } from 'react-router-dom';
import { ArrowLeft, Layers } from 'lucide-react';
import { Button } from '../components/ui/Button.tsx';

interface PlannedModulePageProps {
  title: string;
  phase: string;
  description: string;
  deliverables: string[];
}

export function PlannedModulePage({ title, phase, description, deliverables }: PlannedModulePageProps) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Accueil / Feuille de route / {title}
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          {title}
        </h1>
      </div>

      <div className="max-w-2xl rounded-xl border border-slate-200 bg-white p-6 sm:p-8 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <p className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">{phase}</p>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Module planifié dans la séquence de développement
            </h2>
          </div>
        </div>

        <p className="mt-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          {description}
        </p>

        <div className="mt-6 border-t border-slate-100 pt-5 dark:border-slate-800">
          <p className="text-xs font-semibold text-slate-900 dark:text-white">
            Capacités prévues pour ce module :
          </p>
          <ul className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300">
            {deliverables.map((item) => (
              <li key={item} className="flex items-center gap-2">
                <span className="text-blue-600 dark:text-blue-400">·</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap gap-3">
          <Link to="/">
            <Button type="button" variant="outline">
              <ArrowLeft className="h-4 w-4" />
              <span>Retour au Dashboard</span>
            </Button>
          </Link>
          <Link to="/stocks">
            <Button type="button">Gérer les stocks (Phase 1–2)</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
