import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './contexts/AuthContext.tsx';
import { ThemeProvider } from './contexts/ThemeContext.tsx';
import { BrandingProvider } from './contexts/BrandingContext.tsx';
import { ToastProvider } from './contexts/ToastContext.tsx';
import { LoginPage } from './components/auth/LoginPage.tsx';
import { OnboardingPage } from './components/auth/OnboardingPage.tsx';
import { ErpLayout } from './components/layout/ErpLayout.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { ProductsPage } from './pages/ProductsPage.tsx';
import { StocksPage } from './pages/StocksPage.tsx';
import { WarehousesPage } from './pages/WarehousesPage.tsx';
import { Warehouse3DPage } from './pages/Warehouse3DPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { PurchasingPage } from './pages/PurchasingPage.tsx';
import { SuppliersPage } from './pages/SuppliersPage.tsx';
import { SalesPage } from './pages/SalesPage.tsx';
import { ClientsPage } from './pages/ClientsPage.tsx';
import { InvoicingPage } from './pages/InvoicingPage.tsx';
import { PaymentsPage } from './pages/PaymentsPage.tsx';
import { ReportsPage } from './pages/ReportsPage.tsx';
import { AiAssistantPage } from './pages/AiAssistantPage.tsx';
import { Skeleton } from './components/ui/Skeleton.tsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function AppShell() {
  const { user, authReady, loadingWorkspace, memberships, activeOrg } = useAuth();

  if (!authReady || (user && loadingWorkspace && !activeOrg)) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-3 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-10 w-full mt-4" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  if (memberships.length === 0 || !activeOrg) {
    return <OnboardingPage />;
  }

  return (
    <ErpLayout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/produits" element={<ProductsPage />} />
        <Route path="/stocks" element={<StocksPage />} />
        <Route path="/entrepots" element={<WarehousesPage />} />
        <Route path="/entrepots-3d" element={<Warehouse3DPage />} />
        <Route path="/parametres" element={<SettingsPage />} />

        <Route path="/achats" element={<PurchasingPage />} />
        <Route path="/fournisseurs" element={<SuppliersPage />} />
        <Route path="/ventes" element={<SalesPage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/facturation" element={<InvoicingPage />} />
        <Route path="/paiements" element={<PaymentsPage />} />
        <Route path="/rapports" element={<ReportsPage />} />
        <Route path="/assistant-ia" element={<AiAssistantPage />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErpLayout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <BrandingProvider>
            <BrowserRouter>
              <AppShell />
            </BrowserRouter>
            </BrandingProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
