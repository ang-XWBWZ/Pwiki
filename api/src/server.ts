import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createPwikiApiHandler, type PwikiApiHttpOptions } from "./http.js";
import { PwikiApiService } from "./service.js";

export interface PwikiApiServerOptions extends PwikiApiHttpOptions {
  basePath?: string;
  modelId?: string;
  backgroundEmbeddings?: boolean;
  maxResults?: number;
  maxContentChars?: number;
  allowSourceManagement?: boolean;
  host?: string;
  port?: number;
  service?: PwikiApiService;
  help?: boolean;
}

export interface PwikiApiApplication {
  readonly server: ReturnType<typeof createServer>;
  readonly service: PwikiApiService;
  close(): Promise<void>;
}

export function createPwikiApiServer(options: PwikiApiServerOptions = {}): PwikiApiApplication {
  const service = options.service ?? new PwikiApiService(options);
  const handler = createPwikiApiHandler(service, options);
  const server = createServer((request, response) => {
    void handler(request, response);
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
export async function startPwikiApi(options: PwikiApiServerOptions = {}): Promise<PwikiApiApplication> {
  const app = createPwikiApiServer(options);
  const port = options.port ?? 4318;
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

function parseArgs(args: string[]): PwikiApiServerOptions {
  const host = process.env.PWIKI_HOST ?? "127.0.0.1";
  const options: PwikiApiServerOptions = {
    host,
    port: parsePort(process.env.PWIKI_PORT ?? "4318"),
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
      console.error("Usage: pwiki-api [--host HOST] [--port PORT] [--base-path DIR] [--allow-source-management]");
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
  const app = await startPwikiApi(options);
  const address = app.server.address();
  const location = typeof address === "object" && address ? `${address.address}:${address.port}` : String(address);
  console.error(`[pwiki-api] listening on http://${location}${options.prefix ?? "/api/v1"}`);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await app.close();
  };
  process.once("SIGINT", () => { void close(); });
  process.once("SIGTERM", () => { void close(); });
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("port must be between 0 and 65535");
  return port;
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entryUrl) {
  void run().catch((error) => {
    console.error(`[pwiki-api] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
