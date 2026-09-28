import { existsSync } from "node:fs";
import { chromium, type Page, type Response } from "playwright";
import type { FareModuleRead, FareModuleSample, OfficialCatalogue } from "@/site/direct-routes";

const CHROME = "/home/ubuntu/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";
const CHALLENGE = /captcha|verify you are human|access denied|pardon our interruption|just a moment|attention required/i;

type SeenModule = {
  currentPage: number;
  lastPage: number;
  total: number;
  destinations: string[];
};

export async function readTruncatedFareModules(catalogue: OfficialCatalogue): Promise<FareModuleRead[]> {
  const targets = catalogue.fareModules.filter((sample) => sample.embedded < sample.total || sample.origin === "SFO");
  if (targets.length === 0) return [];
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    ...(existsSync(CHROME) ? { executablePath: CHROME } : {}),
  });
  const reads: FareModuleRead[] = [];
  try {
    for (const sample of targets) {
      const read = await readOne(browser, sample);
      reads.push(read);
      console.log(JSON.stringify({ origin: read.origin, status: read.status, destinations: read.destinations.length, detail: read.detail }));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } finally {
    await browser.close();
  }
  return reads;
}

async function readOne(browser: Awaited<ReturnType<typeof chromium.launch>>, sample: FareModuleSample): Promise<FareModuleRead> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  const seen: SeenModule[] = [];
  let blockedDetail = "";
  page.on("response", (response) => {
    void noteResponse(response, sample.origin, seen, (detail) => {
      blockedDetail = detail;
    });
  });
  try {
    const response = await page.goto(sample.sourceUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2000);
    const blocked = await challengeText(page, response?.status() ?? 0);
    if (blocked || blockedDetail) {
      return blockedRead(sample, blocked || blockedDetail);
    }
    if (!moduleFinished(seen)) {
      const clear = page.getByRole("button", { name: /clear filter/i });
      if (await clear.count()) await clear.first().click().catch(() => undefined);
      await page.waitForTimeout(800);
    }
    for (let attempt = 0; attempt < 4 && !moduleFinished(seen); attempt += 1) {
      if (await challengeText(page, 0)) return blockedRead(sample, "A challenge replaced the flights-from page.");
      const show = page.getByRole("button", { name: /show more/i });
      if (!(await show.count())) break;
      await show.first().scrollIntoViewIfNeeded();
      await show.first().click();
      await page.waitForTimeout(1500);
    }
    if (await challengeText(page, 0) || blockedDetail) return blockedRead(sample, blockedDetail || "A challenge replaced the flights-from page.");
    const expectedTotal = seen[0]?.total ?? sample.total;
    const matching = seen.filter((item) => item.total === expectedTotal);
    const finished = matching.some((item) => item.currentPage === item.lastPage);
    const destinations = [...new Set(matching.flatMap((item) => item.destinations))].sort();
    if (!finished || destinations.length === 0) {
      throw new Error(`${sample.origin} Show more did not reveal the remaining fare rows.`);
    }
    const last = matching.find((item) => item.currentPage === item.lastPage) ?? matching[matching.length - 1];
    return {
      origin: sample.origin,
      status: "complete",
      destinations,
      currentPage: last?.currentPage ?? null,
      lastPage: last?.lastPage ?? null,
      total: last?.total ?? null,
      detail: `Read page ${last?.currentPage ?? "?"} of ${last?.lastPage ?? "?"} in a normal browser. ${destinations.length} named destinations.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The flights-from page could not be read.";
    if (CHALLENGE.test(message) || blockedDetail) return blockedRead(sample, blockedDetail || message);
    throw error;
  } finally {
    await context.close();
  }
}

function moduleFinished(seen: SeenModule[]) {
  const total = seen[0]?.total;
  return total != null && seen.some((item) => item.total === total && item.currentPage === item.lastPage);
}

function blockedRead(sample: FareModuleSample, detail: string): FareModuleRead {
  return {
    origin: sample.origin,
    status: "blocked",
    destinations: [],
    currentPage: null,
    lastPage: sample.lastPage,
    total: sample.total,
    detail,
  };
}

async function challengeText(page: Page, status: number) {
  if (status === 403 || status === 406 || status >= 500) return `The flights-from page returned HTTP ${status}.`;
  const title = await page.title().catch(() => "");
  const body = await page.locator("body").innerText().then((text) => text.slice(0, 400)).catch(() => "");
  if (CHALLENGE.test(title) || CHALLENGE.test(body)) return "A challenge replaced the flights-from page.";
  return "";
}

async function noteResponse(response: Response, origin: string, seen: SeenModule[], block: (detail: string) => void) {
  if (!response.url().includes("/graphql")) return;
  if (response.status() === 403 || response.status() === 406) {
    block(`The fare module response returned HTTP ${response.status()}.`);
    return;
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return;
  }
  for (const fareModule of fareModules(json)) {
    const pagination = fareModule.pagination as { currentPage?: number; lastPage?: number; total?: number };
    if (typeof pagination.currentPage !== "number" || typeof pagination.lastPage !== "number" || typeof pagination.total !== "number") continue;
    const destinations = [];
    for (const fare of fareModule.fares as Record<string, unknown>[]) {
      const code = fare.destinationAirportCode;
      const from = fare.originAirportCode;
      const layovers = fare.layovers;
      if (from !== origin || typeof code !== "string" || !/^[A-Z]{3}$/.test(code)) continue;
      if (Array.isArray(layovers) && layovers.length > 0) continue;
      destinations.push(code);
    }
    seen.push({ currentPage: pagination.currentPage, lastPage: pagination.lastPage, total: pagination.total, destinations });
  }
}

function fareModules(value: unknown) {
  const found: { pagination: unknown; fares: unknown[] }[] = [];
  const stack = [value];
  const visited = new Set<unknown>();
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || visited.has(node)) continue;
    visited.add(node);
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    const record = node as Record<string, unknown>;
    if (record.__typename === "StandardFareModule" && record.pagination && Array.isArray(record.fares)) {
      found.push({ pagination: record.pagination, fares: record.fares });
    }
    for (const [key, child] of Object.entries(record)) {
      if (/key|token|secret|auth/i.test(key)) continue;
      if (child && typeof child === "object") stack.push(child);
    }
  }
  return found;
}
