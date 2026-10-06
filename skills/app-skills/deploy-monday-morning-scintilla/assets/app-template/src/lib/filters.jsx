// Global filter context: vendor + date range + what-if simulation.
// Every useApi() call automatically appends the active filter as query params,
// so all data across all tabs reacts to the one global filter bar.

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { prefetchTabs } from './api.js';

const FilterCtx = createContext(null);

const RANGE_LABELS = {
  wtd: 'Week to date',
  lw: 'Last week',
  l4w: 'Last 4 weeks',
  l13w: 'Last 13 weeks',
  l52w: 'Last 52 weeks',
};

export function FilterProvider({ children }) {
  const [vendor, setVendor] = useState('all');
  const [category, setCategory] = useState('all');
  const [range, setRange] = useState('l52w');
  const [whatif, setWhatif] = useState(null); // { salesLift, instockDelta }

  // encode into a query string appended to every API request
  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (vendor && vendor !== 'all') p.set('vendor', vendor);
    if (category && category !== 'all') p.set('category', category);
    p.set('range', range);
    if (whatif && (whatif.salesLift || whatif.instockDelta)) p.set('whatif', JSON.stringify(whatif));
    return p.toString();
  }, [vendor, category, range, whatif]);

  // When the filter set changes, warm every tab's data in the background so
  // switching tabs is instant instead of triggering a cold warehouse query.
  useEffect(() => {
    prefetchTabs(queryString);
  }, [queryString]);

  const value = useMemo(
    () => ({ vendor, setVendor, category, setCategory, range, setRange, whatif, setWhatif, queryString, rangeLabel: RANGE_LABELS[range] }),
    [vendor, category, range, whatif, queryString]
  );
  return <FilterCtx.Provider value={value}>{children}</FilterCtx.Provider>;
}

export function useFilters() {
  const ctx = useContext(FilterCtx);
  if (!ctx) throw new Error('useFilters must be used within FilterProvider');
  return ctx;
}

export { RANGE_LABELS };
