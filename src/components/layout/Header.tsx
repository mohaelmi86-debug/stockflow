import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Building2,
  ChevronDown,
  HelpCircle,
  LogOut,
  Menu,
  Moon,
  Plus,
  Search,
  Sun,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext.tsx';
import { useTheme } from '../../contexts/ThemeContext.tsx';
import { useBranding } from '../../contexts/BrandingContext.tsx';
import { useErpData } from '../../hooks/useErpData.ts';
import { markNotificationRead } from '../../services/erpService.ts';
import { formatDateTime } from '../../shared/formatters.ts';
import { cn } from '../../lib/cn.ts';

interface HeaderProps {
  onOpenMobileMenu: () => void;
  onOpenNewOrg: () => void;
  onOpenHelp: () => void;
}

export function Header({ onOpenMobileMenu, onOpenNewOrg, onOpenHelp }: HeaderProps) {
  const navigate = useNavigate();
  const { user, memberships, activeOrg, activeRole, selectOrganization, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { branding } = useBranding();
  const {
    products,
    warehouses,
    movements,
    suppliers,
    purchaseOrders,
    customers,
    quotes,
    salesOrders,
    salesInvoices,
    notifications,
    invalidateAll,
  } = useErpData();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const searchRef = useRef<HTMLDivElement>(null);
  const orgRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (searchRef.current && !searchRef.current.contains(target)) setSearchOpen(false);
      if (orgRef.current && !orgRef.current.contains(target)) setOrgMenuOpen(false);
      if (notifRef.current && !notifRef.current.contains(target)) setNotifOpen(false);
      if (profileRef.current && !profileRef.current.contains(target)) setProfileOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return {
        products: [],
        warehouses: [],
        movements: [],
        suppliers: [],
        purchaseOrders: [],
        customers: [],
        salesOrders: [],
        salesInvoices: [],
      };
    }
    return {
      products: products
        .filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.sku.toLowerCase().includes(q) ||
            (p.barcode ?? '').toLowerCase().includes(q)
        )
        .slice(0, 4),
      warehouses: warehouses
        .filter((w) => w.name.toLowerCase().includes(q) || w.code.toLowerCase().includes(q))
        .slice(0, 3),
      movements: movements
        .filter((m) => m.reference.toLowerCase().includes(q) || m.productSku.toLowerCase().includes(q))
        .slice(0, 3),
      suppliers: suppliers
        .filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
        .slice(0, 3),
      purchaseOrders: purchaseOrders
        .filter(
          (po) =>
            po.reference.toLowerCase().includes(q) || po.supplierName.toLowerCase().includes(q)
        )
        .slice(0, 3),
      customers: customers
        .filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.code.toLowerCase().includes(q) ||
            (c.email ?? '').toLowerCase().includes(q)
        )
        .slice(0, 3),
      salesOrders: [
        ...quotes
          .filter(
            (qt) =>
              qt.reference.toLowerCase().includes(q) || qt.customerName.toLowerCase().includes(q)
          )
          .map((qt) => ({ id: qt.id, ref: qt.reference, party: qt.customerName, tab: 'quotes' })),
        ...salesOrders
          .filter(
            (so) =>
              so.reference.toLowerCase().includes(q) || so.customerName.toLowerCase().includes(q)
          )
          .map((so) => ({ id: so.id, ref: so.reference, party: so.customerName, tab: 'orders' })),
      ].slice(0, 4),
      salesInvoices: salesInvoices
        .filter(
          (inv) =>
            inv.invoiceNumber.toLowerCase().includes(q) ||
            inv.customerName.toLowerCase().includes(q)
        )
        .slice(0, 3),
    };
  }, [
    searchQuery,
    products,
    warehouses,
    movements,
    suppliers,
    purchaseOrders,
    customers,
    quotes,
    salesOrders,
    salesInvoices,
  ]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications]
  );

  const hasSearchResults =
    searchResults.products.length > 0 ||
    searchResults.warehouses.length > 0 ||
    searchResults.movements.length > 0 ||
    searchResults.suppliers.length > 0 ||
    searchResults.purchaseOrders.length > 0 ||
    searchResults.customers.length > 0 ||
    searchResults.salesOrders.length > 0 ||
    searchResults.salesInvoices.length > 0;

  const handleMarkRead = async (notifId: string, link?: string) => {
    if (activeOrg) {
      await markNotificationRead(activeOrg.id, notifId);
      await invalidateAll();
    }
    setNotifOpen(false);
    if (link) navigate(link);
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex shrink-0 items-center gap-2 pr-1"><div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-md bg-white"><img src={branding.logoUrl||'/stockflow-logo.svg'} alt="" className="h-full w-full object-contain p-0.5" onError={e=>{e.currentTarget.src='/stockflow-logo.svg';}}/></div><div className="hidden min-w-0 sm:block"><p className="max-w-36 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{branding.mode==='stockflow'?'StockFlow':branding.brandName}</p>{branding.mode==='cobrand'&&branding.showStockFlow&&<p className="text-[10px] text-slate-500">avec StockFlow</p>}</div></div>
      {/* Left: Mobile toggle + Global Search */}
      <div className="flex items-center gap-3 flex-1 min-w-0 max-w-xl">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Ouvrir le menu"
          className="lg:hidden rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div ref={searchRef} className="relative flex-1 min-w-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={searchQuery}
            onFocus={() => setSearchOpen(true)}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSearchOpen(true);
            }}
            placeholder="Rechercher SKU, produit, entrepôt ou référence..."
            aria-label="Recherche globale"
            className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:bg-slate-900"
          />

          {searchOpen && searchQuery.trim().length > 0 && (
            <div className="absolute left-0 right-0 mt-1.5 rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-800 dark:bg-slate-900 z-50">
              {!hasSearchResults ? (
                <p className="px-3 py-4 text-center text-xs text-slate-500 dark:text-slate-400">
                  Aucun résultat pour « {searchQuery} »
                </p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {searchResults.products.length > 0 && (
                    <div>
                      <p className="px-2.5 py-1 text-[11px] font-semibold text-slate-400">Produits</p>
                      {searchResults.products.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setSearchOpen(false);
                            setSearchQuery('');
                            navigate('/produits');
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <span className="truncate font-medium text-slate-900 dark:text-slate-100">{p.name}</span>
                          <span className="ml-2 font-mono text-xs text-slate-500 shrink-0">{p.sku}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {searchResults.warehouses.length > 0 && (
                    <div>
                      <p className="px-2.5 py-1 text-[11px] font-semibold text-slate-400">Entrepôts</p>
                      {searchResults.warehouses.map((w) => (
                        <button
                          key={w.id}
                          type="button"
                          onClick={() => {
                            setSearchOpen(false);
                            setSearchQuery('');
                            navigate('/entrepots');
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <span className="truncate text-slate-900 dark:text-slate-100">{w.name}</span>
                          <span className="ml-2 font-mono text-xs text-slate-500 shrink-0">{w.code}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {searchResults.movements.length > 0 && (
                    <div>
                      <p className="px-2.5 py-1 text-[11px] font-semibold text-slate-400">Mouvements</p>
                      {searchResults.movements.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setSearchOpen(false);
                            setSearchQuery('');
                            navigate('/stocks');
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <span className="truncate font-mono text-xs text-slate-900 dark:text-slate-100">{m.reference}</span>
                          <span className="ml-2 text-xs text-slate-500 shrink-0">{m.productSku}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {searchResults.suppliers.length > 0 && (
                    <div>
                      <p className="px-2.5 py-1 text-[11px] font-semibold text-slate-400">Fournisseurs</p>
                      {searchResults.suppliers.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setSearchOpen(false);
                            setSearchQuery('');
                            navigate('/fournisseurs');
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <span className="truncate text-slate-900 dark:text-slate-100">{s.name}</span>
                          <span className="ml-2 font-mono text-xs text-slate-500 shrink-0">{s.code}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {searchResults.purchaseOrders.length > 0 && (
                    <div>
                      <p className="px-2.5 py-1 text-[11px] font-semibold text-slate-400">Commandes fournisseurs</p>
                      {searchResults.purchaseOrders.map((po) => (
                        <button
                          key={po.id}
                          type="button"
                          onClick={() => {
                            setSearchOpen(false);
                            setSearchQuery('');
                            navigate('/achats');
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <span className="truncate font-mono text-xs text-slate-900 dark:text-slate-100">{po.reference}</span>
                          <span className="ml-2 text-xs text-slate-500 truncate">{po.supplierName}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {searchResults.customers.length > 0 && (
                    <div>
                      <p className="px-2.5 py-1 text-[11px] font-semibold text-slate-400">Clients</p>
                      {searchResults.customers.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setSearchOpen(false);
                            setSearchQuery('');
                            navigate('/clients');
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <span className="truncate text-slate-900 dark:text-slate-100">{c.name}</span>
                          <span className="ml-2 font-mono text-xs text-slate-500 shrink-0">{c.code}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {searchResults.salesOrders.length > 0 && (
                    <div>
                      <p className="px-2.5 py-1 text-[11px] font-semibold text-slate-400">Devis &amp; Ventes</p>
                      {searchResults.salesOrders.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setSearchOpen(false);
                            setSearchQuery('');
                            navigate(`/ventes?tab=${item.tab}`);
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <span className="truncate font-mono text-xs text-slate-900 dark:text-slate-100">{item.ref}</span>
                          <span className="ml-2 text-xs text-slate-500 truncate">{item.party}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {searchResults.salesInvoices.length > 0 && (
                    <div>
                      <p className="px-2.5 py-1 text-[11px] font-semibold text-slate-400">Factures clients</p>
                      {searchResults.salesInvoices.map((inv) => (
                        <button
                          key={inv.id}
                          type="button"
                          onClick={() => {
                            setSearchOpen(false);
                            setSearchQuery('');
                            navigate('/facturation');
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <span className="truncate font-mono text-xs text-slate-900 dark:text-slate-100">{inv.invoiceNumber}</span>
                          <span className="ml-2 text-xs text-slate-500 truncate">{inv.customerName}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right: Org switcher, notifications, theme, help, user profile */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Organization Switcher */}
        <div ref={orgRef} className="relative">
          <button
            type="button"
            onClick={() => setOrgMenuOpen((v) => !v)}
            className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer max-w-[200px]"
          >
            <Building2 className="h-4 w-4 text-blue-600 shrink-0 dark:text-blue-400" />
            <span className="truncate">{activeOrg?.name ?? 'Organisation'}</span>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          </button>

          {orgMenuOpen && (
            <div className="absolute right-0 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-800 dark:bg-slate-900 z-50">
              <p className="px-2.5 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                Vos organisations ({memberships.length})
              </p>
              <div className="max-h-60 overflow-y-auto space-y-0.5">
                {memberships.map((m) => (
                  <button
                    key={m.orgId}
                    type="button"
                    onClick={() => {
                      setOrgMenuOpen(false);
                      void selectOrganization(m.orgId);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm cursor-pointer',
                      m.orgId === activeOrg?.id
                        ? 'bg-blue-50 text-blue-700 font-medium dark:bg-blue-950/50 dark:text-blue-300'
                        : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'
                    )}
                  >
                    <span className="truncate">{m.orgName}</span>
                    <span className="ml-2 font-mono text-[11px] text-slate-400 shrink-0">
                      {m.currency}
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-1.5 border-t border-slate-100 pt-1.5 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setOrgMenuOpen(false);
                    onOpenNewOrg();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40 cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Nouvelle entreprise</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Notifications */}
        <div ref={notifRef} className="relative">
          <button
            type="button"
            onClick={() => setNotifOpen((v) => !v)}
            aria-label="Notifications"
            className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded bg-red-600 px-1 text-[10px] font-mono font-semibold text-white">
                {unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 mt-1.5 w-80 rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900 z-50 overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Notifications
                </span>
                <span className="text-xs text-slate-500 font-mono">{unreadCount} non lue(s)</span>
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                {notifications.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-slate-500">
                    Aucune notification pour cette entreprise.
                  </p>
                ) : (
                  notifications.slice(0, 8).map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => void handleMarkRead(n.id, n.link)}
                      className={cn(
                        'w-full px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer',
                        !n.isRead && 'bg-blue-50/40 dark:bg-blue-950/20'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {n.title}
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono">
                          {formatDateTime(n.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{n.message}</p>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Theme toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre'}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        {/* Help */}
        <button
          type="button"
          onClick={onOpenHelp}
          aria-label="Aide et documentation"
          className="hidden sm:flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
        >
          <HelpCircle className="h-4 w-4" />
        </button>

        {/* Profile */}
        <div ref={profileRef} className="relative">
          <button
            type="button"
            onClick={() => setProfileOpen((v) => !v)}
            aria-label="Menu utilisateur"
            className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800 cursor-pointer"
          >
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt={user.displayName ?? 'Profil'}
                referrerPolicy="no-referrer"
                className="h-6 w-6 rounded-md object-cover"
              />
            ) : (
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-200 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                {(user?.email?.[0] ?? 'U').toUpperCase()}
              </div>
            )}
            <span className="hidden md:inline max-w-[120px] truncate text-xs font-medium text-slate-700 dark:text-slate-200">
              {user?.displayName ?? user?.email}
            </span>
          </button>

          {profileOpen && (
            <div className="absolute right-0 mt-1.5 w-60 rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-800 dark:bg-slate-900 z-50">
              <div className="border-b border-slate-100 px-2.5 py-2 dark:border-slate-800">
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {user?.displayName || 'Utilisateur'}
                </p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user?.email}</p>
                <p className="mt-1 text-[11px] font-mono text-slate-500">
                  Rôle : {activeRole ?? 'member'} · Plan {activeOrg?.plan ?? 'starter'}
                </p>
              </div>
              <div className="pt-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setProfileOpen(false);
                    navigate('/parametres');
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Paramètres organisation
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setProfileOpen(false);
                    void signOut();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30 cursor-pointer"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Se déconnecter</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
