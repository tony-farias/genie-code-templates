import { api } from "./api";
import { AlertIcon, ArrowIcon, ChartIcon, MoneyIcon, UsersIcon } from "./icons";
import { useResource } from "./hooks";
import type { BenchmarkBasis } from "./types";
import {
  count,
  EmptyState,
  Hint,
  MetricCard,
  money,
  Notice,
  RiskPill,
  SegmentedControl,
  TableSkeleton,
} from "./ui";

const basisOptions: Array<{ id: BenchmarkBasis; label: string }> = [
  { id: "procedure", label: "Procedure" },
  { id: "diagnosis", label: "Diagnosis" },
];

export function Dashboard({
  basis,
  setBasis,
  onInvestigate,
  canInvestigate,
}: {
  basis: BenchmarkBasis;
  setBasis: (basis: BenchmarkBasis) => void;
  onInvestigate: (provider: string) => void;
  canInvestigate: boolean;
}) {
  const dashboard = useResource(() => api.dashboard(basis), [basis]);
  const data = dashboard.data;
  const kpis = data?.kpis;
  const maximumExcess = Math.max(...(data?.topCodes.map((item) => item.excess) ?? [1]), 1);
  const tierTotal = data?.tiers.reduce((sum, tier) => sum + tier.providers, 0) ?? 0;
  const highRisk = data?.tiers.find((tier) => tier.tier === "High")?.providers ?? 0;

  return (
    <div className="page-stack">
      <section className="card filter-card">
        <SegmentedControl
          label="Benchmark basis"
          options={basisOptions}
          value={basis}
          onChange={setBasis}
        />
        <p>
          Every figure is computed from curated X12 Gold tables. “Outlier” means a provider’s
          average amount for a code exceeds the peer benchmark for that same code. It is a
          screening signal, not a fraud finding.
        </p>
      </section>

      {dashboard.error && (
        <Notice title="Dashboard unavailable">{dashboard.error}</Notice>
      )}

      <section className="metric-grid" aria-label="Payment integrity overview">
        <MetricCard
          icon={UsersIcon}
          tone="blue"
          loading={dashboard.loading}
          value={kpis ? count(kpis.providers) : "—"}
          label="Providers Benchmarked"
          caption={kpis ? `${count(kpis.codeRows)} provider-code rows` : undefined}
          hint="Distinct billing providers represented in the selected benchmark basis."
        />
        <MetricCard
          icon={AlertIcon}
          tone="red"
          loading={dashboard.loading}
          value={kpis ? `${kpis.aboveP75Pct}%` : "—"}
          label="Rows Above Peer P75"
          caption={kpis ? `${count(kpis.aboveP75)} of ${count(kpis.codeRows)}` : undefined}
          hint="Provider-code rows whose average amount exceeds the 75th percentile for that code."
        />
        <MetricCard
          icon={MoneyIcon}
          tone="orange"
          loading={dashboard.loading}
          value={kpis ? money(kpis.excessCost, true) : "—"}
          label="Excess vs. Peer Average"
          caption="Above-average amount × observed volume"
          hint="A prioritization estimate, not a validated recovery amount."
        />
        <MetricCard
          icon={ChartIcon}
          tone="purple"
          loading={dashboard.loading}
          value={data ? count(highRisk) : "—"}
          label="High-Variance Providers"
          caption="Configured high peer-ratio tier"
          hint="Providers whose claim-weighted amount ratio exceeds the configured high threshold."
        />
      </section>

      <section className="dashboard-charts">
        <article className="card chart-panel chart-panel-wide">
          <div className="section-heading">
            <div>
              <h2>
                Top Codes by Excess Amount
                <Hint label="top codes by excess amount">
                  Codes ranked by the sum of positive provider-to-peer variance multiplied by volume.
                </Hint>
              </h2>
              <p>Largest aggregate variance from the peer average</p>
            </div>
          </div>
          {dashboard.loading ? (
            <div className="skeleton chart-skeleton" />
          ) : data?.topCodes.length ? (
            <div className="bar-chart" aria-label="Top codes by excess amount">
              {data.topCodes.map((item) => (
                <div className="bar-row" key={item.code}>
                  <span className="bar-code" title={item.description ?? undefined}>{item.code}</span>
                  <span className="bar-track">
                    <span
                      className="bar-fill"
                      style={{ width: `${Math.max((item.excess / maximumExcess) * 100, 3)}%` }}
                    />
                  </span>
                  <strong>{money(item.excess, true)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState>No benchmarkable codes are available for this basis.</EmptyState>
          )}
        </article>

        <article className="card chart-panel">
          <div className="section-heading">
            <div>
              <h2>
                Variance Distribution
                <Hint label="variance distribution">
                  Providers grouped by their claim-weighted amount ratio to the peer benchmark.
                </Hint>
              </h2>
              <p>Providers by peer ratio</p>
            </div>
          </div>
          {dashboard.loading ? (
            <div className="skeleton chart-skeleton" />
          ) : data?.tiers.length ? (
            <div className="distribution">
              <div
                className="donut"
                aria-label={`${tierTotal.toLocaleString()} benchmarked providers`}
                style={{
                  background: `conic-gradient(${data.tiers
                    .map((tier, index) => {
                      const before = data.tiers.slice(0, index).reduce((sum, item) => sum + item.share, 0);
                      return `${tier.color} ${before}% ${before + tier.share}%`;
                    })
                    .join(", ")})`,
                }}
              >
                <span><strong>{count(tierTotal)}</strong>providers</span>
              </div>
              <div className="distribution-legend">
                {data.tiers.map((tier) => (
                  <div key={tier.tier}>
                    <span><i style={{ background: tier.color }} />{tier.tier} variance</span>
                    <strong>{count(tier.providers)} <small>({tier.share}%)</small></strong>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState>No provider distribution is available.</EmptyState>
          )}
        </article>
      </section>

      <section className="card table-card">
        <div className="section-heading row-heading">
          <div>
            <h2>
              Highest Peer-Ratio Providers
              <Hint label="highest peer-ratio providers">
                Providers sorted by their claim-weighted average amount divided by the peer average
                for the same codes.
              </Hint>
            </h2>
            <p>Prioritized for review, not classified as fraud</p>
          </div>
          <span className="pill risk-high">{data?.outliers.length ?? 0} flagged</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th className="numeric">Peer Ratio</th>
                <th>Variance</th>
                <th className="numeric">Claims</th>
                <th className="numeric">Codes</th>
                <th className="numeric">Avg Amount</th>
                <th className="numeric">Peer Avg</th>
                <th className="numeric">Total Amount</th>
                <th className="numeric">Above P75</th>
                <th><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            {dashboard.loading ? (
              <TableSkeleton columns={10} />
            ) : (
              <tbody>
                {data?.outliers.map((provider) => (
                  <tr key={provider.provider}>
                    <td>
                      <span className="provider-cell">
                        <strong className="mono">{provider.provider}</strong>
                        {provider.providerName && <small>{provider.providerName}</small>}
                      </span>
                    </td>
                    <td className="numeric variance-high"><strong>{provider.peerRatio}×</strong></td>
                    <td><RiskPill tier={provider.tier} /></td>
                    <td className="numeric">{provider.claims.toLocaleString()}</td>
                    <td className="numeric">{provider.codes.toLocaleString()}</td>
                    <td className="numeric">{money(provider.avgCost)}</td>
                    <td className="numeric muted">{money(provider.benchmarkAvgCost)}</td>
                    <td className="numeric">{money(provider.cost, true)}</td>
                    <td className="numeric muted">{provider.hot}/{provider.codes}</td>
                    <td className="numeric">
                      {canInvestigate ? (
                        <button
                          type="button"
                          className="secondary-action"
                          onClick={() => onInvestigate(provider.provider)}
                        >
                          Investigate <ArrowIcon size={13} />
                        </button>
                      ) : <span className="muted">Not enabled</span>}
                    </td>
                  </tr>
                ))}
                {!data?.outliers.length && (
                  <tr><td colSpan={10}><EmptyState>No providers meet the review threshold.</EmptyState></td></tr>
                )}
              </tbody>
            )}
          </table>
        </div>
      </section>

      {!!data?.quality.length && (
        <section className="pipeline-evidence" aria-label="X12 parser evidence">
          <div>
            <strong>Pipeline evidence</strong>
            <span>Aggregate parser outcomes only. Raw X12 remains outside the application boundary.</span>
          </div>
          <div className="quality-pills">
            {data.quality.map((item) => (
              <span className="quality-pill" key={`${item.transactionType}-${item.status}`}>
                <strong>{item.transactionType}</strong> {item.status} · {item.records.toLocaleString()}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
