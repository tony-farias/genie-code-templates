import type { ReactNode } from "react";
import { DashboardIcon, SearchIcon, ShieldIcon, SparklesIcon } from "./icons";
import type { Meta, Page } from "./types";

const navigation = [
  { id: "dashboard" as const, label: "Dashboard", icon: DashboardIcon },
  { id: "siu" as const, label: "SIU Workbench", icon: SearchIcon },
  { id: "genie" as const, label: "Ask Genie", icon: SparklesIcon },
];

export function Shell({
  page,
  setPage,
  meta,
  title,
  subtitle,
  children,
}: {
  page: Page;
  setPage: (page: Page) => void;
  meta: Meta | null;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <aside className="rail">
        <div className="rail-brand">
          <ShieldIcon size={30} />
          <div>
            <strong>{meta?.product_name ?? "FWA Shield"}</strong>
            <span>{meta?.plan_name ?? "Health Plan Analytics"}</span>
          </div>
        </div>
        <nav aria-label="Primary navigation" className="rail-nav">
          {navigation
            .filter(({ id }) => {
              if (id === "siu") return meta?.features.provider_analysis ?? true;
              if (id === "genie") return meta?.features.embedded_genie ?? true;
              return true;
            })
            .map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={page === id ? "page" : undefined}
              className={page === id ? "active" : ""}
              onClick={() => setPage(id)}
            >
              <Icon size={20} />
              {label}
            </button>
            ))}
        </nav>
        <div className="rail-footer">
          <span>{meta?.source ?? "Loading governed source…"}</span>
          <span>Template {meta?.template_version ?? "…"}</span>
          <span>Powered by Databricks</span>
        </div>
      </aside>

      <div className="workspace">
        <header className="page-header">
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </header>
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}
