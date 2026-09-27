import type { ComponentType, ReactNode, SVGProps } from "react";
import { InfoIcon } from "./icons";

type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

export function money(value: number, compact = false): string {
  if (!Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  if (compact && absolute >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (compact && absolute >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (compact && absolute >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: absolute < 1_000 ? 2 : 0,
  }).format(value);
}

export function count(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

export function maskedKey(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 7)}…${value.slice(-5)}`;
}

export function Hint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="hint">
      <button type="button" aria-label={`How ${label} is calculated`} className="hint-trigger">
        <InfoIcon size={14} />
      </button>
      <span role="tooltip" className="hint-content">{children}</span>
    </span>
  );
}

export function MetricCard({
  icon: IconComponent,
  tone,
  value,
  label,
  caption,
  hint,
  loading,
}: {
  icon: Icon;
  tone: "blue" | "teal" | "orange" | "purple" | "red";
  value: string;
  label: string;
  caption?: string;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <article className="metric-card">
      <span className={`metric-icon metric-icon-${tone}`}><IconComponent size={20} /></span>
      {loading ? <span className="skeleton metric-skeleton" /> : <strong className="metric-value">{value}</strong>}
      <span className="metric-label">
        {label}
        {hint && <Hint label={label}>{hint}</Hint>}
      </span>
      {caption && <span className="metric-caption">{caption}</span>}
    </article>
  );
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ id: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented-field">
      <span className="field-label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={value === option.id}
            className={value === option.id ? "selected" : ""}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function RiskPill({ tier }: { tier: "High" | "Medium" | "Low" }) {
  return <span className={`pill risk-${tier.toLowerCase()}`}>{tier}</span>;
}

export function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="notice" role="alert">
      <strong>{title}</strong>
      <span>{children}</span>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}

export function TableSkeleton({ columns = 8, rows = 5 }: { columns?: number; rows?: number }) {
  return (
    <tbody aria-busy="true">
      {Array.from({ length: rows }).map((_, row) => (
        <tr key={row}>
          <td colSpan={columns}><span className="skeleton row-skeleton" /></td>
        </tr>
      ))}
    </tbody>
  );
}
