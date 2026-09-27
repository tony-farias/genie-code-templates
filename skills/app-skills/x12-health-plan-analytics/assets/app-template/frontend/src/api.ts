import type {
  BenchmarkBasis,
  Dashboard,
  GenieResponse,
  Meta,
  ProviderAnalysis,
  ProviderClaims,
  ProviderDetail,
  ProviderLetter,
  ProviderMembers,
  ProviderSearchResult,
} from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      message = body.detail ?? body.error ?? message;
    } catch {
      // Preserve the HTTP status when the server did not return JSON.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function post(message: string, conversationId?: string | null): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, conversation_id: conversationId ?? null }),
  };
}

export const api = {
  meta: () => request<Meta>("/api/meta"),
  dashboard: (basis: BenchmarkBasis) => request<Dashboard>(`/api/dashboard?basis=${basis}`),
  providerSearch: (query: string, basis: BenchmarkBasis) =>
    request<{ providers: ProviderSearchResult[] }>(
      `/api/siu/providers?q=${encodeURIComponent(query)}&basis=${basis}`,
    ),
  provider: (provider: string, basis: BenchmarkBasis) =>
    request<ProviderDetail>(`/api/siu/provider/${encodeURIComponent(provider)}?basis=${basis}`),
  providerClaims: (provider: string) =>
    request<ProviderClaims>(`/api/siu/provider/${encodeURIComponent(provider)}/claims`),
  providerMembers: (provider: string) =>
    request<ProviderMembers>(`/api/siu/provider/${encodeURIComponent(provider)}/member-list`),
  providerAnalysis: (provider: string, basis: BenchmarkBasis) =>
    request<ProviderAnalysis>(
      `/api/siu/provider/${encodeURIComponent(provider)}/analysis?basis=${basis}`,
    ),
  providerLetter: (provider: string, basis: BenchmarkBasis) =>
    request<ProviderLetter>(
      `/api/siu/provider/${encodeURIComponent(provider)}/letter?basis=${basis}`,
    ),
  genie: (message: string, conversationId?: string | null) =>
    request<GenieResponse>("/api/genie/ask", post(message, conversationId)),
  providerGenie: (
    provider: string,
    basis: BenchmarkBasis,
    message: string,
    conversationId?: string | null,
  ) =>
    request<GenieResponse>(
      `/api/siu/provider/${encodeURIComponent(provider)}/genie`,
      {
        ...post(message, conversationId),
        body: JSON.stringify({
          message,
          basis,
          conversation_id: conversationId ?? null,
        }),
      },
    ),
};
