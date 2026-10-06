import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import GeniePopup from './components/GeniePopup';
import { PersonaProvider } from './lib/persona.jsx';

const HomePage = lazy(() => import('./pages/HomePage'));
const HomeBrief = lazy(() => import('./pages/HomeBrief'));
const SalesPage = lazy(() => import('./pages/SalesPage'));
const HourlyPage = lazy(() => import('./pages/HourlyPage'));
const CategoryPage = lazy(() => import('./pages/CategoryPage'));
const EcomPage = lazy(() => import('./pages/EcomPage'));
const ForecastPage = lazy(() => import('./pages/ForecastPage'));
const InventoryIntelPage = lazy(() => import('./pages/InventoryIntelPage'));
const AgentsPage = lazy(() => import('./pages/AgentsPage'));
const CommerceExchangePage = lazy(() => import('./pages/CommerceExchangePage'));
const ReferencePage = lazy(() => import('./pages/ReferencePage'));
const SkuDetailPage = lazy(() => import('./pages/SkuDetailPage'));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-sm text-muted-foreground">Loading…</div>
    </div>
  );
}

function GenieMount() {
  return <GeniePopup />;
}

export default function App() {
  return (
    <PersonaProvider>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<HomeBrief />} />
          <Route path="/app/personalized" element={<HomePage />} />
          {/* Executive Summary now lives as a tab on the Sales page. */}
          <Route path="/app/summary" element={<Navigate to="/app/sales" replace />} />
          <Route path="/app/sales" element={<SalesPage />} />
          <Route path="/app/hourly" element={<HourlyPage />} />
          <Route path="/app/category" element={<CategoryPage />} />
          <Route path="/app/ecom" element={<EcomPage />} />
          <Route path="/app/forecast" element={<ForecastPage />} />
          <Route path="/app/inventory" element={<InventoryIntelPage />} />
          <Route path="/app/agents" element={<AgentsPage />} />
          <Route path="/app/commerce" element={<CommerceExchangePage />} />
          <Route path="/architecture" element={<ReferencePage />} />
          <Route path="/app/sku/:skuId" element={<SkuDetailPage />} />
          <Route path="*" element={<Navigate to="/app/sales" replace />} />
        </Routes>
      </Suspense>
      <GenieMount />
    </PersonaProvider>
  );
}
