import { useState } from 'react';
import { ShieldCheck, ArrowRightLeft, Building2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext.tsx';
import { Button } from '../ui/Button.tsx';
export function LoginPage() {
 const {signInWithGoogle,authError}=useAuth(); const [submitting,setSubmitting]=useState(false);
 const handleLogin=async()=>{setSubmitting(true);try{await signInWithGoogle()}catch{/* Error surfaced via authError */}finally{setSubmitting(false)}};
 return <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col lg:flex-row">
 <div className="lg:w-[46%] bg-slate-900 text-slate-100 p-8 sm:p-12 lg:p-16 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-slate-800"><div>
 <img src="/stockflow-logo.svg" alt="StockFlow ERP" className="h-16 w-full max-w-[270px] object-contain object-left"/>
 <h1 className="mt-12 font-display text-3xl sm:text-4xl font-bold tracking-tight text-white max-w-md text-balance">Pilotage des stocks, entrepôts et opérations commerciales.</h1>
 <p className="mt-4 text-sm sm:text-base text-slate-300 max-w-md leading-relaxed">Plateforme ERP multi-entreprises conçue pour la traçabilité intégrale des mouvements de stock, la gestion multi-entrepôts et le contrôle d’accès par organisation.</p></div>
 <div className="mt-12 space-y-5 border-t border-slate-800 pt-8">
 <div className="flex items-start gap-3.5"><ArrowRightLeft className="h-5 w-5 text-blue-400 shrink-0 mt-0.5"/><div><p className="text-sm font-medium text-white">Moteur de stock transactionnel</p><p className="text-xs text-slate-400 mt-0.5">Chaque variation de quantité génère un mouvement immuable et audité.</p></div></div>
 <div className="flex items-start gap-3.5"><Building2 className="h-5 w-5 text-blue-400 shrink-0 mt-0.5"/><div><p className="text-sm font-medium text-white">Isolation stricte multi-tenant</p><p className="text-xs text-slate-400 mt-0.5">Chaque entreprise dispose de son espace cloisonné, de ses rôles et de sa devise.</p></div></div>
 <div className="flex items-start gap-3.5"><ShieldCheck className="h-5 w-5 text-blue-400 shrink-0 mt-0.5"/><div><p className="text-sm font-medium text-white">Règles de sécurité vérifiées</p><p className="text-xs text-slate-400 mt-0.5">Authentification Google et contrôle d’accès RBAC vérifié côté base de données.</p></div></div></div></div>
 <div className="flex-1 flex items-center justify-center p-6 sm:p-12"><div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
 <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-white">Connexion à votre espace</h2><p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Accédez à vos organisations StockFlow ERP ou créez votre premier environnement entreprise.</p>
 {authError&&<div role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">{authError}</div>}
 <div className="mt-7"><Button type="button" onClick={handleLogin} disabled={submitting} className="w-full h-11 text-sm font-medium">{submitting?'Connexion en cours...':'Continuer avec Google'}</Button></div>
 <div className="mt-6 border-t border-slate-100 pt-5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400"><p>Votre session est protégée par jeton Firebase Auth vérifié côté serveur. Aucune donnée d’une autre organisation n’est accessible.</p></div></div></div></div>;
}
