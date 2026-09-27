import { useEffect, useState } from "react";
import { api } from "./api";
import { Dashboard } from "./Dashboard";
import { GeniePage } from "./GeniePage";
import { Shell } from "./Shell";
import { SiuWorkbench } from "./SiuWorkbench";
import type { BenchmarkBasis, Meta, Page } from "./types";
import { Notice } from "./ui";

const pageCopy: Record<Page, { title: string; subtitle: string }> = {
  dashboard: {
    title: "Payment Integrity Dashboard",
    subtitle: "Provider variance and governed X12 pipeline evidence",
  },
  siu: {
    title: "SIU Workbench",
    subtitle: "Provider benchmarking, claims review, and de-identified member context",
  },
  genie: {
    title: "Ask Genie",
    subtitle: "Explore curated health-plan analytics in natural language",
  },
};

export default function App() {
  const initial = new URLSearchParams(window.location.search);
  const requestedPage = initial.get("page");
  const [page, setPageState] = useState<Page>(
    requestedPage === "siu" || requestedPage === "genie" ? requestedPage : "dashboard",
  );
  const [basis, setBasis] = useState<BenchmarkBasis>("procedure");
  const [handoff, setHandoff] = useState<string | null>(initial.get("provider"));
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  useEffect(() => {
    api.meta()
      .then(setMeta)
      .catch((error: unknown) => setMetaError(error instanceof Error ? error.message : String(error)));
  }, []);

  useEffect(() => {
    if (!meta) return;
    if (page === "siu" && !meta.features.provider_analysis) navigate("dashboard");
    if (page === "genie" && !meta.features.embedded_genie) navigate("dashboard");
  }, [meta, page]);

  function investigate(provider: string) {
    setHandoff(provider);
    navigate("siu", provider);
  }

  function navigate(nextPage: Page, provider?: string) {
    setPageState(nextPage);
    const search = new URLSearchParams();
    if (nextPage !== "dashboard") search.set("page", nextPage);
    if (provider) search.set("provider", provider);
    const query = search.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }

  return (
    <Shell
      page={page}
      setPage={navigate}
      meta={meta}
      title={pageCopy[page].title}
      subtitle={pageCopy[page].subtitle}
    >
      {metaError && <Notice title="Application configuration unavailable">{metaError}</Notice>}
      {page === "dashboard" && (
        <Dashboard
          basis={basis}
          setBasis={setBasis}
          onInvestigate={investigate}
          canInvestigate={meta?.features.provider_analysis ?? true}
        />
      )}
      {page === "siu" && (
        <SiuWorkbench
          basis={basis}
          setBasis={setBasis}
          handoff={handoff}
          clearHandoff={() => setHandoff(null)}
          features={meta?.features ?? null}
        />
      )}
      {page === "genie" && <GeniePage meta={meta} />}
    </Shell>
  );
}
