import { Link, useLocation } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { navItems, pageConfig } from '../data/mockData';
import { useApi } from '../lib/api.js';
import databricksLogo from '../assets/databricks-logo-light.svg';

// Left navigation sidebar. Fixed on md+; page roots carry md:pl-56 so content clears it.
export default function AppHeader() {
  const { pathname } = useLocation();
  const { data: meta } = useApi('/api/meta', { raw: true });
  const outcomeMapsUrl = meta?.links?.outcome_maps;
  const matchedKey = Object.keys(pageConfig).find((k) => pathname === k || pathname.startsWith(`${k}/`));
  const page = matchedKey ? pageConfig[matchedKey] : null;

  const base = 'w-full px-3 py-2.5 min-h-[40px] flex items-center rounded-md whitespace-nowrap transition-colors text-sm';
  const linkClass = (active, activeBg = 'bg-db-navy', accent = false) =>
    active
      ? `${base} text-white font-bold ${activeBg}`
      : `${base} ${accent ? 'text-db-lava font-semibold hover:bg-db-accent-tint' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`;

  return (
    <aside className="fixed inset-y-0 left-0 z-50 hidden md:flex w-56 flex-col border-r border-border bg-card/95 backdrop-blur">
      {/* Brand + current page */}
      <div className="px-4 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <img src={databricksLogo} alt="Databricks" className="h-5" />
        </div>
        <div className="mt-2 text-sm font-bold text-foreground">Monday Morning</div>
        {page && (
          <div className="mt-2 flex items-center gap-1.5">
            <span className={`px-1.5 py-0.5 rounded text-[10px] border font-mono bg-card ${page.badgeText} ${page.badgeBorder}`}>
              {page.number}
            </span>
            <span className="text-[11px] text-muted-foreground truncate">{page.title}</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5 font-medium">
        <Link to="/" aria-current={pathname === '/' ? 'page' : undefined} className={linkClass(pathname === '/', 'bg-db-lava')}>
          Home
        </Link>
        {navItems.map((item) => {
          const isActive = pathname === item.path || pathname.startsWith(`${item.path}/`);
          return (
            <Link
              key={item.id}
              to={item.path}
              data-testid={item.testId}
              aria-current={isActive ? 'page' : undefined}
              className={linkClass(isActive, item.activeBg)}
            >
              <span className="mr-2 text-[10px] font-mono text-muted-foreground/70">{item.id}</span>
              {item.label}
            </Link>
          );
        })}

        <div className="my-2 border-t border-border" />

        <Link
          to="/app/personalized"
          aria-current={pathname === '/app/personalized' ? 'page' : undefined}
          className={linkClass(pathname === '/app/personalized', 'bg-db-lava', true)}
        >
          Personalized
        </Link>
        <Link
          to="/architecture"
          aria-current={pathname === '/architecture' ? 'page' : undefined}
          className={linkClass(pathname === '/architecture', 'bg-db-lava', true)}
        >
          Architecture
        </Link>
      </nav>

      {/* Back to the Business Outcome Maps deck; shown only when OUTCOME_MAPS_URL is configured. */}
      {outcomeMapsUrl && (
        <div className="px-2 py-3 border-t border-border">
          <a
            href={outcomeMapsUrl}
            aria-label="Back to Outcome Maps"
            title="Back to Outcome Maps"
            className="w-full px-3 py-2 min-h-[40px] flex items-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Outcome Maps
          </a>
        </div>
      )}
    </aside>
  );
}
