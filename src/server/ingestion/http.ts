export type FetchTextResult = {
  ok: boolean;
  status: number;
  body: string;
  latencyMs: number;
  error?: string;
  url: string;
};

let chain: Promise<void> = Promise.resolve();

function gap(ms: number) {
  const next = chain.then(
    () => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  );
  chain = next.catch(() => undefined);
  return next;
}

function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 30_000);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(date - Date.now(), 0), 30_000);
}

export async function fetchText(
  url: string,
  options?: { retries?: number; timeoutMs?: number; minDelayMs?: number; headers?: Record<string, string> },
): Promise<FetchTextResult> {
  const retries = options?.retries ?? 3;
  const timeoutMs = options?.timeoutMs ?? 20_000;
  const minDelayMs = options?.minDelayMs ?? 800;
  await gap(minDelayMs);
  let lastError = "Request failed";
  let status = 0;
  const started = Date.now();
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: "text/html,application/xml,application/json;q=0.9,*/*;q=0.8",
          "user-agent": "FrontierRouteExplorer/0.1 (personal research; public pages only)",
          ...options?.headers,
        },
      });
      status = response.status;
      const body = await response.text();
      if (response.ok) {
        return { ok: true, status, body, latencyMs: Date.now() - started, url };
      }
      lastError = `HTTP ${response.status}`;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === retries) break;
      const wait = retryAfterMs(response.headers.get("retry-after")) ?? 500 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, wait));
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Network error";
      if (attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, status, body: "", latencyMs: Date.now() - started, error: lastError, url };
}
