import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AddSourceRequest,
  ApiEnvelope,
  CreateEntryRequest,
  DeleteEntryRequest,
  ModifyEntryRequest,
  MoveEntryRequest,
  RefreshRequest,
  RenameEntryRequest,
  RerankerSettingsRequest,
  SelectModelRequest,
  SemanticSettingsRequest,
} from "./contracts.js";
import { PwikiApiError, PwikiApiService } from "./service.js";

export interface PwikiApiHttpOptions {
  prefix?: string;
  corsOrigin?: string | false;
  maxBodyBytes?: number;
}

export type PwikiApiRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void>;

export function createPwikiApiHandler(
  service: PwikiApiService,
  options: PwikiApiHttpOptions = {},
): PwikiApiRequestHandler {
  const prefix = normalizePrefix(options.prefix ?? "/api/v1");
  const maxBodyBytes = options.maxBodyBytes ?? 2_500_000;
  return async (request, response) => {
    const requestId = randomUUID();
    applyHeaders(response, request, options.corsOrigin);
    try {
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      const url = new URL(request.url ?? "/", "http://pwiki.local");
      const path = url.pathname.replace(/\/$/, "") || "/";
      if (!path.startsWith(prefix)) throw new PwikiApiError("INVALID_REQUEST", "API route not found", 404);
      const route = path.slice(prefix.length) || "/";
      const result = await dispatch(request, url, route, service, maxBodyBytes);
      sendJson(response, { ok: true, value: result, requestId }, 200);
    } catch (error) {
      const apiError = toApiError(error);
      sendJson(response, {
        ok: false,
        error: {
          code: apiError.code,
          message: apiError.message,
          retryable: apiError.retryable,
          details: apiError.details,
        },
        requestId,
      }, apiError.status);
    }
  };
}

async function dispatch(
  request: IncomingMessage,
  url: URL,
  route: string,
  service: PwikiApiService,
  maxBodyBytes: number,
): Promise<unknown> {
  const method = request.method ?? "GET";
  if (method === "GET" && route === "/status") return service.status();
  if (method === "GET" && route === "/settings") return service.settings();
  if (method === "GET" && route === "/sources") return service.listSources();
  if (method === "POST" && route === "/sources") {
    return service.addSource(await bodyAs<AddSourceRequest>(request, maxBodyBytes));
  }
  if (method === "POST" && route === "/refresh") {
    const body = await optionalBodyAs<RefreshRequest>(request, maxBodyBytes);
    return service.refresh({ source: body?.source ?? optionalQuery(url, "source") });
  }
  if (method === "GET" && route === "/files") {
    return service.listFiles(
      requiredQuery(url, "source"),
      optionalQuery(url, "pathPrefix") ?? "",
      integerQuery(url, "limit") ?? undefined,
      optionalQuery(url, "filter"),
    );
  }
  if (method === "GET" && route === "/search") {
    return service.search({
      query: requiredQuery(url, "q"),
      mode: optionalQuery(url, "mode") as never,
      source: optionalQuery(url, "source"),
      pathPrefix: optionalQuery(url, "pathPrefix"),
      page: integerQuery(url, "page") ?? undefined,
      limit: integerQuery(url, "limit") ?? undefined,
    });
  }
  if (method === "GET" && route === "/entry") {
    return service.readEntry(
      requiredQuery(url, "source"),
      optionalQuery(url, "path") ?? requiredQuery(url, "relPath"),
    );
  }
  if (method === "POST" && route === "/entries") {
    return service.createEntry(await bodyAs<CreateEntryRequest>(request, maxBodyBytes));
  }
  if (method === "PUT" && route === "/entry") {
    return service.modifyEntry(await bodyAs<ModifyEntryRequest>(request, maxBodyBytes));
  }
  if (method === "PATCH" && route === "/entry/title") {
    return service.renameEntry(await bodyAs<RenameEntryRequest>(request, maxBodyBytes));
  }
  if (method === "POST" && route === "/entry/move") {
    return service.moveEntry(await bodyAs<MoveEntryRequest>(request, maxBodyBytes));
  }
  if (method === "DELETE" && route === "/entry") {
    return service.deleteEntry(await bodyAs<DeleteEntryRequest>(request, maxBodyBytes));
  }
  if (method === "GET" && route === "/models") return service.listModels();
  if (method === "PATCH" && route === "/settings/model") {
    return service.selectModel(await bodyAs<SelectModelRequest>(request, maxBodyBytes));
  }
  if (method === "PATCH" && route === "/settings/semantic") {
    return service.setSemantic(await bodyAs<SemanticSettingsRequest>(request, maxBodyBytes));
  }
  if (method === "PATCH" && route === "/settings/reranker") {
    return service.setReranker(await bodyAs<RerankerSettingsRequest>(request, maxBodyBytes));
  }

  const sourceRoute = route.match(/^\/sources\/([^/]+)(?:\/refresh)?$/);
  if (sourceRoute?.[1] && method === "POST" && route.endsWith("/refresh")) {
    return service.refresh({ source: decodeSegment(sourceRoute[1]) });
  }
  if (sourceRoute?.[1] && method === "DELETE" && !route.endsWith("/refresh")) {
    return service.removeSource(decodeSegment(sourceRoute[1]));
  }
  throw new PwikiApiError("INVALID_REQUEST", `Route not found: ${method} ${route}`, 404);
}

async function bodyAs<T>(request: IncomingMessage, maxBodyBytes: number): Promise<T> {
  const body = await readBody(request, maxBodyBytes);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new PwikiApiError("INVALID_REQUEST", "JSON body must be an object");
  }
  return body as T;
}

async function optionalBodyAs<T>(request: IncomingMessage, maxBodyBytes: number): Promise<T | undefined> {
  const body = await readBody(request, maxBodyBytes);
  if (body === undefined) return undefined;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new PwikiApiError("INVALID_REQUEST", "JSON body must be an object");
  }
  return body as T;
}

function readBody(request: IncomingMessage, maxBodyBytes: number): Promise<unknown | undefined> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBodyBytes) {
        reject(new PwikiApiError("INVALID_REQUEST", "request body is too large"));
        request.destroy();
        return;
      }
      chunks.push(buffer);
    });
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch {
        reject(new PwikiApiError("INVALID_REQUEST", "request body must be valid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function requiredQuery(url: URL, name: string): string {
  const value = optionalQuery(url, name);
  if (!value) throw new PwikiApiError("INVALID_REQUEST", `${name} is required`);
  return value;
}

function optionalQuery(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name);
  return value === null || value.trim() === "" ? undefined : value;
}

function integerQuery(url: URL, name: string): number | undefined {
  const value = optionalQuery(url, name);
  if (value === undefined) return undefined;
  if (!/^[0-9]+$/.test(value)) throw new PwikiApiError("INVALID_REQUEST", `${name} must be an integer`);
  return Number(value);
}

function decodeSegment(value: string): string {
  try { return decodeURIComponent(value); }
  catch { throw new PwikiApiError("INVALID_REQUEST", "invalid URL path segment"); }
}

function normalizePrefix(prefix: string): string {
  const normalized = prefix.startsWith("/") ? prefix : `/${prefix}`;
  return normalized.replace(/\/$/, "");
}

function applyHeaders(response: ServerResponse, request: IncomingMessage, corsOrigin?: string | false): void {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  if (corsOrigin !== false && corsOrigin !== undefined) {
    response.setHeader("Access-Control-Allow-Origin", corsOrigin);
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
    response.setHeader("Vary", "Origin");
  }
  void request;
}

function sendJson(response: ServerResponse, payload: ApiEnvelope<unknown>, status: number): void {
  if (response.headersSent) return;
  const data = JSON.stringify(payload);
  response.writeHead(status, { "Content-Length": Buffer.byteLength(data) });
  response.end(data);
}

function toApiError(error: unknown): PwikiApiError {
  if (error instanceof PwikiApiError) return error;
  return new PwikiApiError("INTERNAL", "Pwiki API operation failed", 500, true);
}
