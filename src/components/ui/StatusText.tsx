import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '../../lib/cn.ts';

export type SemanticTone = 'success' | 'warning' | 'error' | 'neutral' | 'info';

interface StatusTextProps {
  tone: SemanticTone;
  label: string;
}

export function StatusText({ tone, label }: StatusTextProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap',
        tone === 'success' && 'text-emerald-700 dark:text-emerald-400',
        tone === 'warning' && 'text-amber-700 dark:text-amber-400',
        tone === 'error' && 'text-red-700 dark:text-red-400',
        tone === 'info' && 'text-blue-700 dark:text-blue-400',
        tone === 'neutral' && 'text-slate-600 dark:text-slate-400'
      )}
    >
      {tone === 'success' && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
      {tone === 'warning' && <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
      {tone === 'error' && <XCircle className="h-3.5 w-3.5 shrink-0" />}
      {tone === 'info' && <Info className="h-3.5 w-3.5 shrink-0" />}
      <span>{label}</span>
    </span>
  );
}
