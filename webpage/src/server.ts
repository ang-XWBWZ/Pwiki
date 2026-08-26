#!/usr/bin/env node

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPwikiApiHandler, PwikiApiService, type PwikiApiHttpOptions } from "@llangtop/pwiki-api";

export interface PwikiWebpageServerOptions extends PwikiApiHttpOptions {
  basePath?: string;
  modelId?: string;
  backgroundEmbeddings?: boolean;
  maxResults?: number;
  maxContentChars?: number;
  allowSourceManagement?: boolean;
  host?: string;
  port?: number;
  assetRoot?: string;
  service?: PwikiApiService;
  help?: boolean;
}

export interface PwikiWebpageApplication {
  readonly server: ReturnType<typeof createServer>;
  readonly service: PwikiApiService;
  close(): Promise<void>;
}

export function createPwikiWebpageServer(options: PwikiWebpageServerOptions = {}): PwikiWebpageApplication {
  const host = options.host ?? "127.0.0.1";
  const service = options.service ?? new PwikiApiService({
    basePath: options.basePath,
    modelId: options.modelId,
    backgroundEmbeddings: options.backgroundEmbeddings ?? true,
    maxResults: options.maxResults,
    maxContentChars: options.maxContentChars,
    allowSourceManagement: options.allowSourceManagement ?? isLoopback(host),
  });
  const apiHandler = createPwikiApiHandler(service, options);
  const assetRoot = resolve(options.assetRoot ?? dirname(fileURLToPath(import.meta.url)));
  const apiPrefix = normalizePrefix(options.prefix ?? "/api/v1");
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://pwiki.local");
    if (url.pathname === apiPrefix || url.pathname.startsWith(`${apiPrefix}/`)) {
      void apiHandler(request, response);
      return;
    }
    serveAsset(url.pathname, assetRoot, response);
  });
  return {
    server,
    service,
    async close() {
      if (server.listening) {
        await new Promise<void>((resolveClose, reject) => {
          server.close((error) => error ? reject(error) : resolveClose());
        });
      }
      await service.dispose();
    },
  };
}

/** Explicit startup entry; importing this module does not bind a port. */
export async function startPwikiWebpage(options: PwikiWebpageServerOptions = {}): Promise<PwikiWebpageApplication> {
  const app = createPwikiWebpageServer(options);
  const port = options.port ?? 4317;
  const host = options.host ?? "127.0.0.1";
  try {
    await new Promise<void>((resolveListen, reject) => {
      app.server.once("error", reject);
      app.server.listen(port, host, () => {
        app.server.off("error", reject);
        resolveListen();
      });
    });
    return app;
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
}

function serveAsset(pathname: string, assetRoot: string, response: import("node:http").ServerResponse): void {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); }
  catch { sendText(response, 400, "Invalid URL"); return; }
  const relativePath = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const target = resolve(assetRoot, relativePath);
  const fromRoot = relative(assetRoot, target);
  if (fromRoot.startsWith("..") || fromRoot.includes("\0")) {
    sendText(response, 403, "Forbidden");
    return;
  }
  let stat;
  try { stat = statSync(target); }
  catch { sendText(response, 404, "Not found"); return; }
  if (!stat.isFile()) { sendText(response, 404, "Not found"); return; }
  const extension = extname(target).toLowerCase();
  const developmentAsset = extension === ".js" || extension === ".css" || extension === ".html";
  response.writeHead(200, {
    "Content-Type": contentType(extname(target)),
    "Cache-Control": developmentAsset ? "no-store" : "public, max-age=3600",
    "Content-Length": stat.size,
  });
  createReadStream(target).pipe(response);
}

function contentType(extension: string): string {
  switch (extension.toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    default: return "application/octet-stream";
  }
}

function sendText(response: import("node:http").ServerResponse, status: number, value: string): void {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(value);
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("port must be between 0 and 65535");
  return port;
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function normalizePrefix(prefix: string): string {
  const normalized = prefix.startsWith("/") ? prefix : `/${prefix}`;
  return normalized.replace(/\/$/, "");
}

function parseArgs(args: string[]): PwikiWebpageServerOptions {
  const host = process.env.PWIKI_WEB_HOST ?? "127.0.0.1";
  const options: PwikiWebpageServerOptions = {
    host,
    port: parsePort(process.env.PWIKI_WEB_PORT ?? "4317"),
    basePath: process.env.WIKI_HOME,
    allowSourceManagement: isLoopback(host),
  };
  let explicitManagement: boolean | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === "--host" && value) { options.host = value; index++; continue; }
    if (arg === "--port" && value) { options.port = parsePort(value); index++; continue; }
    if (arg === "--base-path" && value) { options.basePath = value; index++; continue; }
    if (arg === "--allow-source-management") { explicitManagement = true; continue; }
    if (arg === "--no-source-management") { explicitManagement = false; continue; }
    if (arg === "--help" || arg === "-h") {
      console.error("Usage: pwiki-webpage [--host HOST] [--port PORT] [--base-path DIR] [--allow-source-management]");
      options.help = true;
      return options;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  options.allowSourceManagement = explicitManagement ?? isLoopback(options.host ?? host);
  return options;
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return;
  const app = await startPwikiWebpage(options);
  const address = app.server.address();
  const location = typeof address === "object" && address ? `${address.address}:${address.port}` : String(address);
  console.error(`[pwiki-webpage] listening on http://${location}`);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await app.close();
  };
  process.once("SIGINT", () => { void close(); });
  process.once("SIGTERM", () => { void close(); });
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entryUrl) {
  void run().catch((error) => {
    console.error(`[pwiki-webpage] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
