import { api } from "./api";
import { SparklesIcon } from "./icons";
import { GenieChat } from "./GenieChat";
import type { Meta } from "./types";

const suggestions = [
  "Which providers have the highest average claim amount?",
  "Show paid amount and charged amount by claim status.",
  "What are the top procedure codes by total amount?",
  "How many X12 transactions were parsed or quarantined?",
  "Show the monthly trend in claim amount.",
  "Which diagnosis codes appear most often?",
];

export function GeniePage({ meta }: { meta: Meta | null }) {
  return (
    <div className="page-stack">
      <section className="genie-intro">
        <div>
          <span className="genie-avatar"><SparklesIcon size={22} /></span>
          <div>
            <h2>Health Plan Genie</h2>
            <p>Natural-language analysis over curated X12 Gold tables</p>
          </div>
        </div>
        {meta?.genie_url && (
          <a href={meta.genie_url} target="_blank" rel="noreferrer">Open in Databricks</a>
        )}
      </section>
      <GenieChat
        title="X12 Analytics Assistant"
        description="Queries execute in the governed Genie Space"
        suggestions={suggestions}
        ask={api.genie}
      />
    </div>
  );
}
