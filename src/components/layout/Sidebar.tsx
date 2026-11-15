import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Package, ArrowRightLeft, Warehouse, Box, ShoppingCart,
  Truck, TrendingUp, Users, FileText, CreditCard, BarChart3, Bot, Settings, X,
} from 'lucide-react';
import { cn } from '../../lib/cn.ts';
import { useBranding } from '../../contexts/BrandingContext.tsx';

export interface NavItem { to: string; label: string; icon: typeof LayoutDashboard; phase?: string; }
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard }, { to: '/produits', label: 'Produits', icon: Package },
  { to: '/stocks', label: 'Stocks', icon: ArrowRightLeft }, { to: '/entrepots', label: 'Entrepôts', icon: Warehouse },
  { to: '/entrepots-3d', label: 'Entrepôt 3D', icon: Box }, { to: '/achats', label: 'Achats', icon: ShoppingCart },
  { to: '/fournisseurs', label: 'Fournisseurs', icon: Truck }, { to: '/ventes', label: 'Ventes', icon: TrendingUp },
  { to: '/clients', label: 'Clients', icon: Users }, { to: '/facturation', label: 'Facturation', icon: FileText },
  { to: '/paiements', label: 'Paiements', icon: CreditCard }, { to: '/rapports', label: 'Rapports', icon: BarChart3 },
  { to: '/assistant-ia', label: 'Assistant IA', icon: Bot }, { to: '/parametres', label: 'Paramètres', icon: Settings },
];
interface SidebarProps { mobileOpen: boolean; onCloseMobile: () => void; }
export function Sidebar({ mobileOpen, onCloseMobile }: SidebarProps) {
  const { branding } = useBranding();
  const navContent = <div className="flex h-full flex-col bg-slate-900 text-slate-100 select-none">
    <div className="flex h-20 items-center justify-between border-b border-slate-800 px-4 shrink-0">
      {branding.mode === 'stockflow' || !branding.logoUrl ? <img src="/stockflow-logo.svg" alt="StockFlow ERP" className="h-14 w-full max-w-[218px] rounded-md bg-white px-2 object-contain object-left" /> : <div className="flex items-center gap-2 rounded-md bg-white px-2 py-2 max-w-[218px]"><img src={branding.logoUrl} alt={branding.brandName} className="h-9 max-w-[92px] object-contain" /><span className="truncate text-sm font-semibold text-slate-900">{branding.brandName}</span>{branding.showStockFlow && <span className="text-[10px] text-slate-500">with StockFlow</span>}</div>}
      <button type="button" onClick={onCloseMobile} aria-label="Fermer le menu" className="lg:hidden rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
    </div>
    <nav aria-label="Navigation principale" className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
      {NAV_ITEMS.map(item => { const Icon = item.icon; return <NavLink key={item.to} to={item.to} end={item.to === '/'} onClick={onCloseMobile}
        className={({isActive}) => cn('group flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150 whitespace-nowrap', isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800/80 hover:text-white')}>
        {({isActive}) => <><span className="flex items-center gap-3 min-w-0"><Icon className={cn('h-4 w-4 shrink-0',isActive?'text-white':'text-slate-400 group-hover:text-slate-200')}/><span className="truncate">{item.label}</span></span>{item.phase && <span className={cn('text-[11px] font-mono shrink-0',isActive?'text-blue-100':'text-slate-500')}>{item.phase}</span>}</>}
      </NavLink>; })}
    </nav></div>;
  return <><aside className="hidden lg:block w-64 shrink-0 border-r border-slate-800 bg-slate-900"><div className="sticky top-0 h-screen">{navContent}</div></aside>
  {mobileOpen && <div className="fixed inset-0 z-40 flex lg:hidden"><div className="fixed inset-0 bg-slate-950/60" onClick={onCloseMobile} aria-hidden="true"/><aside className="relative z-50 w-64 max-w-[80vw] h-full shadow-xl">{navContent}</aside></div>}</>;
}
