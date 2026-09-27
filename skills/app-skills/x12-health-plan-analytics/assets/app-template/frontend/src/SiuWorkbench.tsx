import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { AlertIcon, CloseIcon, FileIcon, MoneyIcon, SearchIcon, UsersIcon } from "./icons";
import { GenieChat } from "./GenieChat";
import { useResource } from "./hooks";
import type { BenchmarkBasis, FeatureFlags, ProviderDetail } from "./types";
import {
  EmptyState,
  Hint,
  maskedKey,
  MetricCard,
  money,
  RiskPill,
  SegmentedControl,
  TableSkeleton,
} from "./ui";

type Tab = "codes" | "claims" | "members" | "analysis";
type Sort = "totalCost" | "variancePct" | "claims" | "code";

const basisOptions: Array<{ id: BenchmarkBasis; label: string }> = [
  { id: "procedure", label: "Procedure" },
  { id: "diagnosis", label: "Diagnosis" },
];

const allTabOptions: Array<{ id: Tab; label: string }> = [
  { id: "codes", label: "Codes & Variance" },
  { id: "claims", label: "Claims" },
  { id: "members", label: "Members" },
  { id: "analysis", label: "Analysis & Genie" },
];

const sortOptions: Array<{ id: Sort; label: string }> = [
  { id: "totalCost", label: "Total $" },
  { id: "variancePct", label: "Variance" },
  { id: "claims", label: "Claims" },
  { id: "code", label: "Code" },
];

function CodeTable({ provider, sort }: { provider: ProviderDetail; sort: Sort }) {
  const services = useMemo(() => {
    const next = [...provider.services];
    return next.sort((left, right) => {
      if (sort === "code") return left.code.localeCompare(right.code);
      if (sort === "variancePct") return (right.variancePct ?? -Infinity) - (left.variancePct ?? -Infinity);
      return right[sort] - left[sort];
    });
  }, [provider.services, sort]);

  return (
    <>
      <p className="table-context">All {services.length.toLocaleString()} codes billed</p>
      <div className="table-scroll bounded-table">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th className="numeric">Claims</th>
              <th className="numeric">Avg Amount</th>
              <th className="numeric">Total Amount</th>
              <th className="numeric">Peer Avg</th>
              <th className="numeric">Peer Median</th>
              <th className="numeric">Peer P25–P75</th>
              <th className="numeric">Variance</th>
            </tr>
          </thead>
          <tbody>
            {services.map((service) => (
              <tr key={service.code}>
                <td>
                  <span className="code-cell">
                    {service.aboveP75 && <AlertIcon size={13} />}
                    <strong className="mono">{service.code}</strong>
                  </span>
                </td>
                <td className="numeric">{service.claims.toLocaleString()}</td>
                <td className="numeric"><strong>{money(service.avgCost)}</strong></td>
                <td className="numeric">{money(service.totalCost)}</td>
                <td className="numeric muted">{money(service.benchmarkAvgCost)}</td>
                <td className="numeric muted">{money(service.benchmarkMedianCost)}</td>
                <td className="numeric muted">{money(service.benchmarkP25)}–{money(service.benchmarkP75)}</td>
                <td className={`numeric ${service.variancePct && service.variancePct > 0 ? "variance-high" : "variance-low"}`}>
                  {service.variancePct === null ? "—" : `${service.variancePct > 0 ? "+" : ""}${service.variancePct}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="table-footnote"><AlertIcon size={12} /> Flagged rows exceed the peer 75th percentile. This is a screening signal, not a finding.</p>
    </>
  );
}

function ClaimsTab({ provider }: { provider: string }) {
  const claims = useResource(() => api.providerClaims(provider), [provider]);
  if (claims.error) return <EmptyState>Claims could not be loaded: {claims.error}</EmptyState>;
  return (
    <>
      {claims.data && (
        <p className="table-context">
          {claims.data.truncated
            ? `Showing ${claims.data.shown.toLocaleString()} of ${claims.data.total.toLocaleString()} claims`
            : `All ${claims.data.total.toLocaleString()} claims`} · {money(claims.data.totalAllowed, true)} total amount
        </p>
      )}
      <div className="table-scroll bounded-table">
        <table>
          <thead><tr><th>Claim</th><th>Member Key</th><th>Service Date</th><th>Diagnosis</th><th className="numeric">Lines</th><th className="numeric">Denied</th><th className="numeric">Claim Amount</th><th className="numeric">Paid</th></tr></thead>
          {claims.loading ? <TableSkeleton columns={8} /> : (
            <tbody>
              {claims.data?.claims.map((claim) => (
                <tr key={claim.claimId}>
                  <td className="mono compact-id">{claim.claimId}</td>
                  <td className="mono compact-id" title={claim.memberKey}>{maskedKey(claim.memberKey)}</td>
                  <td>{claim.serviceDate ?? "—"}</td>
                  <td className="mono">{claim.diagnosisCode ?? "—"}</td>
                  <td className="numeric">{claim.lines}</td>
                  <td className={`numeric ${claim.deniedLines ? "variance-high" : "muted"}`}>{claim.deniedLines || "—"}</td>
                  <td className="numeric">{money(claim.allowed)}</td>
                  <td className="numeric">{money(claim.paid)}</td>
                </tr>
              ))}
              {!claims.data?.claims.length && <tr><td colSpan={8}><EmptyState>No claims were found for this provider.</EmptyState></td></tr>}
            </tbody>
          )}
        </table>
      </div>
    </>
  );
}

function MembersTab({ provider }: { provider: string }) {
  const members = useResource(() => api.providerMembers(provider), [provider]);
  if (members.error) return <EmptyState>Member context could not be loaded: {members.error}</EmptyState>;
  return (
    <>
      {members.data && (
        <p className="table-context">
          {members.data.truncated
            ? `Showing ${members.data.shown.toLocaleString()} of ${members.data.total.toLocaleString()} de-identified members`
            : `All ${members.data.total.toLocaleString()} de-identified members`}
          {members.data.summary.avgUtilizationIndex !== null && ` · avg utilization index ${members.data.summary.avgUtilizationIndex}×`}
        </p>
      )}
      <div className="table-scroll bounded-table">
        <table>
          <thead><tr><th>Member Key</th><th className="numeric">Utilization Index</th><th>Birth Year</th><th>Gender</th><th>State</th><th className="numeric">Claims</th><th className="numeric">Amount with Provider</th><th className="numeric">Total Amount</th></tr></thead>
          {members.loading ? <TableSkeleton columns={8} /> : (
            <tbody>
              {members.data?.members.map((member) => (
                <tr key={member.memberKey}>
                  <td className="mono compact-id" title={member.memberKey}>{maskedKey(member.memberKey)}</td>
                  <td className={`numeric ${Number(member.utilizationIndex) >= 2 ? "variance-high" : ""}`}>{member.utilizationIndex === null ? "—" : `${member.utilizationIndex}×`}</td>
                  <td>{member.birthYear ?? "—"}</td>
                  <td>{member.genderCode ?? "—"}</td>
                  <td>{member.stateCode ?? "—"}</td>
                  <td className="numeric">{member.claims.toLocaleString()}</td>
                  <td className="numeric">{money(member.allowed)}</td>
                  <td className="numeric">{member.totalAllowed === null ? "—" : money(member.totalAllowed)}</td>
                </tr>
              ))}
              {!members.data?.members.length && <tr><td colSpan={8}><EmptyState>No de-identified members were found for this provider.</EmptyState></td></tr>}
            </tbody>
          )}
        </table>
      </div>
      <p className="table-footnote">Member keys are SHA-256 pseudonyms. Names, addresses, exact birth dates, and raw X12 are not returned.</p>
    </>
  );
}

function AnalysisTab({ provider, basis }: { provider: string; basis: BenchmarkBasis }) {
  const analysis = useResource(() => api.providerAnalysis(provider, basis), [provider, basis]);
  const suggestions = [
    "Show this provider's top procedure codes by amount.",
    "How many claims for this provider were not fully paid?",
    "Compare this provider's claim amount by month.",
  ];
  return (
    <div className="analysis-grid">
      <div className="analysis-copy">
        {analysis.loading && <div className="skeleton analysis-skeleton" />}
        {analysis.error && <EmptyState>Analysis could not be built: {analysis.error}</EmptyState>}
        {analysis.data && (
          <>
            <section><h3>Summary</h3>{analysis.data.summary.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</section>
            <section><h3>Key Findings</h3><ul>{analysis.data.findings.map((item, index) => <li key={index}>{item}</li>)}</ul></section>
            <section><h3>Recommended Next Steps</h3><ol>{analysis.data.recommendations.map((item, index) => <li key={index}>{item}</li>)}</ol></section>
            <small>Deterministic narrative derived from the benchmark figures on this page. Screening signals are not findings of improper billing.</small>
          </>
        )}
      </div>
      <GenieChat
        compact
        title="Ask Genie about this provider"
        description={`Queries are scoped to ${provider}`}
        suggestions={suggestions}
        ask={(message, conversationId) => api.providerGenie(provider, basis, message, conversationId)}
      />
    </div>
  );
}

function LetterPanel({ provider, basis, onClose }: { provider: string; basis: BenchmarkBasis; onClose: () => void }) {
  const letter = useResource(() => api.providerLetter(provider, basis), [provider, basis]);
  const [copied, setCopied] = useState(false);
  return (
    <section className="letter-panel" aria-labelledby="letter-title">
      <header>
        <div><h2 id="letter-title">Peer-variance notification</h2><p>Reviewer-editable draft. Nothing is sent automatically.</p></div>
        <button type="button" className="icon-action" aria-label="Close letter" onClick={onClose}><CloseIcon size={18} /></button>
      </header>
      {letter.loading && <div className="skeleton letter-skeleton" />}
      {letter.error && <EmptyState>Letter could not be generated: {letter.error}</EmptyState>}
      {letter.data && (
        <>
          <pre>{letter.data.letter}</pre>
          <button
            type="button"
            className="primary-action"
            onClick={async () => {
              await navigator.clipboard.writeText(letter.data!.letter);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy draft"}
          </button>
        </>
      )}
    </section>
  );
}

export function SiuWorkbench({
  basis,
  setBasis,
  handoff,
  clearHandoff,
  features,
}: {
  basis: BenchmarkBasis;
  setBasis: (basis: BenchmarkBasis) => void;
  handoff: string | null;
  clearHandoff: () => void;
  features: FeatureFlags | null;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("codes");
  const [sort, setSort] = useState<Sort>("totalCost");
  const [showLetter, setShowLetter] = useState(false);

  useEffect(() => {
    if (handoff) {
      setSelected(handoff);
      setQuery(handoff);
      setTab("codes");
      clearHandoff();
    }
  }, [handoff, clearHandoff]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const normalized = debounced.replace(/[^a-zA-Z0-9]/g, "");
  const search = useResource(
    () => normalized.length >= 2 ? api.providerSearch(normalized, basis) : Promise.resolve({ providers: [] }),
    [normalized, basis],
  );
  const detail = useResource(
    () => selected ? api.provider(selected, basis) : Promise.resolve(null),
    [selected, basis],
  );
  const summary = detail.data?.summary;
  const tabs = allTabOptions.filter((option) => {
    if (option.id === "members") return features?.member_utilization ?? true;
    if (option.id === "analysis") return features?.embedded_genie ?? true;
    return true;
  });

  useEffect(() => {
    if (!tabs.some((option) => option.id === tab)) setTab("codes");
  }, [tabs, tab]);

  return (
    <div className="page-stack">
      <section className="card provider-search-card">
        <div className="provider-search-field">
          <label htmlFor="provider-search">Provider</label>
          <div>
            <SearchIcon size={16} />
            <input
              id="provider-search"
              value={query}
              placeholder="Search by provider ID or name…"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        <SegmentedControl label="Benchmark basis" options={basisOptions} value={basis} onChange={setBasis} />
      </section>

      {normalized.length >= 2 && !selected && (
        <section className="card search-results" aria-label="Provider search results">
          {search.loading ? <span className="muted">Searching…</span> : search.data?.providers.length ? (
            search.data.providers.map((provider) => (
              <button key={provider.provider} type="button" onClick={() => setSelected(provider.provider)}>
                <span><strong className="mono">{provider.provider}</strong>{provider.providerName && <small>{provider.providerName}</small>}</span>
                <span>{provider.claims.toLocaleString()} claims · {provider.codes.toLocaleString()} codes · {money(provider.totalCost, true)}</span>
              </button>
            ))
          ) : <EmptyState>No providers match this search.</EmptyState>}
        </section>
      )}

      {!selected && <section className="card select-provider"><SearchIcon size={24} /><p>Select a provider to review code variance, claims, members, and supporting evidence.</p></section>}

      {selected && detail.loading && <section className="card provider-loading"><span className="skeleton analysis-skeleton" /></section>}
      {selected && detail.error && <section className="card"><EmptyState>Provider details could not be loaded: {detail.error}</EmptyState></section>}

      {selected && detail.data && summary && (
        <>
          <section className="metric-grid metric-grid-five">
            <MetricCard icon={FileIcon} tone="blue" value={summary.codeCount.toLocaleString()} label="Codes Billed" caption={`${summary.totalClaims.toLocaleString()} claims`} />
            <MetricCard icon={MoneyIcon} tone="teal" value={money(summary.totalCost, true)} label="Total Amount" caption={`${money(summary.avgCostPerClaim)} per claim`} />
            <MetricCard icon={MoneyIcon} tone="orange" value={money(summary.excessCost, true)} label="Variance Opportunity" caption={`${summary.excessSharePct}% of total amount`} hint="Positive variance above the peer average, not a validated recovery amount." />
            <MetricCard icon={UsersIcon} tone="orange" value={`${summary.peerRatio}×`} label="Peer Ratio" caption="vs. same-code benchmark" />
            <MetricCard icon={AlertIcon} tone="red" value={summary.codesAboveP75.toLocaleString()} label="Codes Above Peer P75" caption={`${summary.codeCount ? ((summary.codesAboveP75 / summary.codeCount) * 100).toFixed(1) : 0}% of codes`} />
          </section>

          <section className="card provider-detail-card">
            <header className="provider-detail-header">
              <div>
                <h2>Provider <span className="mono">{detail.data.provider}</span> <RiskPill tier={summary.tier} /></h2>
                <p>{detail.data.providerName ?? "Provider name not supplied"} · {basis} benchmark</p>
              </div>
              {(features?.letters ?? true) && (
                <button type="button" className="primary-action" onClick={() => setShowLetter((current) => !current)}>
                  <FileIcon size={15} /> {showLetter ? "Hide Letter" : "Generate Letter"}
                </button>
              )}
            </header>
            <div className="provider-controls">
              <SegmentedControl label="View" options={tabs} value={tab} onChange={setTab} />
              {tab === "codes" && <SegmentedControl label="Sort by" options={sortOptions} value={sort} onChange={setSort} />}
            </div>
            {tab === "codes" && <CodeTable provider={detail.data} sort={sort} />}
            {tab === "claims" && <ClaimsTab provider={detail.data.provider} />}
            {tab === "members" && <MembersTab provider={detail.data.provider} />}
            {tab === "analysis" && <AnalysisTab provider={detail.data.provider} basis={basis} />}
          </section>

          {showLetter && (features?.letters ?? true) && <LetterPanel provider={detail.data.provider} basis={basis} onClose={() => setShowLetter(false)} />}
        </>
      )}
    </div>
  );
}
