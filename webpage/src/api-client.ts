import type {
  AddSourceRequest,
  ApiEntry,
  ApiEnvelope,
  ApiFilePage,
  ApiSettings,
  ApiSearchRequest,
  ApiSearchResult,
  ApiSource,
  ApiStatus,
  CreateEntryRequest,
  DeleteEntryRequest,
  DeleteEntryResult,
  ModifyEntryRequest,
  MoveEntryRequest,
  RefreshRequest,
  RerankerSettingsRequest,
  RenameEntryRequest,
  SourceMutationResult,
  SelectModelRequest,
  SemanticSettingsRequest,
  SettingsMutationResult,
} from "@llangtop/pwiki-api";

export interface PwikiApiClientOptions {
  /** Same-origin by default; absolute URLs are allowed for an explicitly configured API. */
  baseUrl?: string;
  fetcher?: typeof fetch;
}

/** Browser-safe client. It only knows the HTTP DTOs and never imports Pwiki core. */
export class PwikiApiClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(options: PwikiApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  }

  status(): Promise<ApiEnvelope<ApiStatus>> {
    return this.request<ApiStatus>("/status");
  }

  settings(): Promise<ApiEnvelope<ApiSettings>> {
    return this.request<ApiSettings>("/settings");
  }

  sources(): Promise<ApiEnvelope<ApiSource[]>> {
    return this.request<ApiSource[]>("/sources");
  }

  addSource(request: AddSourceRequest): Promise<ApiEnvelope<SourceMutationResult>> {
    return this.request<SourceMutationResult>("/sources", jsonRequest("POST", request));
  }

  removeSource(source: string): Promise<ApiEnvelope<ApiSource>> {
    return this.request<ApiSource>(`/sources/${encodeURIComponent(source)}`, { method: "DELETE" });
  }

  refresh(request: RefreshRequest = {}): Promise<ApiEnvelope<{ files: number; sources: number }>> {
    return this.request<{ files: number; sources: number }>("/refresh", jsonRequest("POST", request));
  }

  files(source: string, pathPrefix?: string, limit?: number, filter?: string): Promise<ApiEnvelope<ApiFilePage>> {
    const query = new URLSearchParams({ source });
    if (pathPrefix !== undefined) query.set("pathPrefix", pathPrefix);
    if (limit !== undefined) query.set("limit", String(limit));
    if (filter !== undefined && filter.trim() !== "") query.set("filter", filter.trim());
    return this.request<ApiFilePage>(`/files?${query}`);
  }

  search(request: ApiSearchRequest): Promise<ApiEnvelope<ApiSearchResult>> {
    const query = new URLSearchParams({ q: request.query });
    for (const [key, value] of Object.entries(request)) {
      if (key === "query" || value === undefined) continue;
      query.set(key, String(value));
    }
    return this.request<ApiSearchResult>(`/search?${query}`);
  }

  entry(source: string, relPath: string): Promise<ApiEnvelope<ApiEntry | null>> {
    return this.request<ApiEntry | null>(`/entry?${new URLSearchParams({ source, path: relPath })}`);
  }

  createEntry(request: CreateEntryRequest): Promise<ApiEnvelope<ApiEntry>> {
    return this.request<ApiEntry>("/entries", jsonRequest("POST", request));
  }

  modifyEntry(request: ModifyEntryRequest): Promise<ApiEnvelope<ApiEntry>> {
    return this.request<ApiEntry>("/entry", jsonRequest("PUT", request));
  }

  renameEntry(request: RenameEntryRequest): Promise<ApiEnvelope<ApiEntry>> {
    return this.request<ApiEntry>("/entry/title", jsonRequest("PATCH", request));
  }

  moveEntry(request: MoveEntryRequest): Promise<ApiEnvelope<ApiEntry>> {
    return this.request<ApiEntry>("/entry/move", jsonRequest("POST", request));
  }

  deleteEntry(request: DeleteEntryRequest): Promise<ApiEnvelope<DeleteEntryResult>> {
    return this.request<DeleteEntryResult>("/entry", jsonRequest("DELETE", request));
  }

  selectModel(request: SelectModelRequest): Promise<ApiEnvelope<SettingsMutationResult>> {
    return this.request<SettingsMutationResult>("/settings/model", jsonRequest("PATCH", request));
  }

  setSemantic(request: SemanticSettingsRequest): Promise<ApiEnvelope<SettingsMutationResult>> {
    return this.request<SettingsMutationResult>("/settings/semantic", jsonRequest("PATCH", request));
  }

  setReranker(request: RerankerSettingsRequest): Promise<ApiEnvelope<SettingsMutationResult>> {
    return this.request<SettingsMutationResult>("/settings/reranker", jsonRequest("PATCH", request));
  }

  private async request<T>(path: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
    try {
      const response = await this.fetcher(`${this.baseUrl}/api/v1${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
      });
      const payload = await response.json() as ApiEnvelope<T>;
      if (payload && typeof payload === "object" && "ok" in payload) return payload;
      return { ok: false, error: { code: "INVALID_RESPONSE", message: "API returned an invalid response" } };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "NETWORK_ERROR",
          message: error instanceof Error ? error.message : "API request failed",
          retryable: true,
        },
      };
    }
  }
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}
