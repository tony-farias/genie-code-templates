export type Page = "dashboard" | "siu" | "genie";
export type BenchmarkBasis = "procedure" | "diagnosis";

export type FeatureFlags = {
  provider_analysis: boolean;
  letters: boolean;
  embedded_genie: boolean;
  member_utilization: boolean;
};

export type Meta = {
  product_name: string;
  plan_name: string;
  segment: string;
  template_version: string;
  source: string;
  genie_url?: string | null;
  features: FeatureFlags;
};

export type Dashboard = {
  basis: BenchmarkBasis;
  kpis: {
    providers: number;
    codeRows: number;
    claims: number;
    cost: number;
    aboveP75: number;
    aboveP75Pct: number;
    excessCost: number;
  };
  tiers: Array<{
    tier: "High" | "Medium" | "Low";
    providers: number;
    cost: number;
    color: string;
    share: number;
  }>;
  topCodes: Array<{
    code: string;
    providers: number;
    claims: number;
    excess: number;
    description?: string | null;
  }>;
  outliers: Array<{
    provider: string;
    providerName?: string | null;
    codes: number;
    claims: number;
    cost: number;
    hot: number;
    avgCost: number;
    benchmarkAvgCost: number;
    peerRatio: number;
    variancePct: number | null;
    tier: "High" | "Medium" | "Low";
  }>;
  quality: Array<{
    transactionType: string;
    status: string;
    records: number;
  }>;
};

export type ProviderSearchResult = {
  provider: string;
  providerName?: string | null;
  claims: number;
  totalCost: number;
  codes: number;
};

export type ProviderDetail = {
  provider: string;
  providerName?: string | null;
  basis: BenchmarkBasis;
  summary: {
    codeCount: number;
    totalClaims: number;
    totalCost: number;
    avgCostPerClaim: number;
    codesAboveBenchmark: number;
    codesAboveP75: number;
    excessCost: number;
    excessSharePct: number;
    peerRatio: number;
    tier: "High" | "Medium" | "Low";
  };
  services: Array<{
    code: string;
    description?: string | null;
    excess: number;
    claims: number;
    avgCost: number;
    totalCost: number;
    benchmarkAvgCost: number;
    benchmarkMedianCost: number;
    benchmarkP25: number;
    benchmarkP75: number;
    variancePct: number | null;
    aboveP75: boolean;
  }>;
};

export type ProviderClaims = {
  provider: string;
  total: number;
  shown: number;
  truncated: boolean;
  totalAllowed: number;
  claims: Array<{
    claimId: string;
    memberKey: string;
    serviceDate?: string | null;
    diagnosisCode?: string | null;
    lines: number;
    deniedLines: number;
    allowed: number;
    paid: number;
  }>;
};

export type ProviderMembers = {
  provider: string;
  total: number;
  shown: number;
  truncated: boolean;
  summary: {
    members: number;
    scored: number;
    avgUtilizationIndex: number | null;
    medianUtilizationIndex: number | null;
    highUtilization: number;
  };
  members: Array<{
    memberKey: string;
    claims: number;
    allowed: number;
    birthYear: number | null;
    genderCode?: string | null;
    stateCode?: string | null;
    utilizationIndex: number | null;
    totalAllowed: number | null;
  }>;
};

export type ProviderAnalysis = {
  provider: string;
  basis: BenchmarkBasis;
  summary: string[];
  findings: string[];
  recommendations: string[];
  savingsOpportunity: number;
};

export type ProviderLetter = {
  provider: string;
  basis: BenchmarkBasis;
  generatedOn: string;
  letter: string;
};

export type GenieTable = { columns: string[]; rows: Array<Array<string | number | null>> };
export type GenieResponse = {
  conversation_id: string;
  message_id: string;
  text: string;
  table?: GenieTable | null;
};

export type ChatMessage = {
  role: "user" | "genie";
  text: string;
  table?: GenieTable | null;
  at?: string;
};
