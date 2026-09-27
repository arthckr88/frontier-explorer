import { bookingDisplayDate } from "@/site/browser/form";
import { sanitizeMarkets, type MarketList } from "@/site/browser/sanitize";
import { BOOKING_HOME, SCHEDULE_META_TTL_MS, type BrowserQuery, type PageCapture } from "@/site/browser/types";

export type ObservedScheduleMeta = {
  markets: MarketList | null;
  calendars: Array<{ origin: string; destination: string; disabledDates: string[]; lastAvailableDate: string | null }>;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Headed Chrome. The browser creates the session. This function does not set Frontier headers. */
export async function captureBookingPage(query: BrowserQuery, now = new Date()): Promise<PageCapture & { meta: ObservedScheduleMeta }> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const context = await browser.newContext();
  const page = await context.newPage();
  let selectStatus: number | null = null;
  let markets: MarketList | null = null;
  const calendars: ObservedScheduleMeta["calendars"] = [];
  const pending: Array<Promise<void>> = [];
  page.on("response", (response) => {
    const url = response.url();
    const path = url.split("?")[0] ?? url;
    if (path.endsWith("/Flight/Select")) selectStatus = response.status();
    if ((response.status() === 403 || response.status() === 406) && path.includes("/Flight/")) selectStatus = response.status();
    pending.push(
      noteScheduleResponse(response, now).then((noted) => {
        if (noted?.markets) markets = noted.markets;
        if (noted?.calendar) calendars.push(noted.calendar);
      }),
    );
  });
  try {
    await page.goto(BOOKING_HOME, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await dismissCookies(page);
    await page.locator("label[for='rboneway']").click({ timeout: 15_000 });
    await chooseAirport(page, "#origin", query.origin);
    await chooseAirport(page, "#destination", query.destination);
    await pickDepartureDate(page, query.date);
    if (!(await page.locator("#searchDollars").isChecked())) await page.locator("#searchDollars").check();
    await page.locator("#btnSearch").click();
    await page.waitForURL(/booking\.flyfrontier\.com\/Flight\/|www\.flyfrontier\.com\/?$/, { timeout: 45_000 });
    await page.waitForLoadState("domcontentloaded");
    await Promise.all(pending);
    const html = await page.content();
    return {
      url: page.url(),
      html,
      httpStatus: selectStatus,
      meta: { markets, calendars },
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function chooseAirport(page: import("playwright").Page, selector: "#origin" | "#destination", code: string) {
  const input = page.locator(selector);
  await input.waitFor({ state: "visible", timeout: 15_000 });
  await input.click();
  await input.fill("");
  await input.pressSequentially(code, { delay: 40 });
  const option = page.locator(".ui-menu-item, li, [role='option']").filter({ hasText: new RegExp(`\\b${code}\\b`) }).locator("visible=true").first();
  await option.click({ timeout: 10_000 });
}

async function pickDepartureDate(page: import("playwright").Page, iso: string) {
  const expected = bookingDisplayDate(iso);
  const input = page.locator("#departureDate");
  await input.click({ timeout: 15_000 });
  const day = Number(iso.slice(8, 10));
  const monthName = MONTHS[Number(iso.slice(5, 7)) - 1] ?? "";
  const year = iso.slice(0, 4);
  const label = page.getByText(`${monthName} ${year}`, { exact: false });
  if ((await label.count()) === 0) {
    throw new Error("navigation_error");
  }
  const cell = page.locator("td:not(.ui-datepicker-other-month) a, td:not(.old):not(.new) button, [data-day]").filter({ hasText: new RegExp(`^${day}$`) }).first();
  await cell.click({ timeout: 10_000 });
  const value = await input.inputValue();
  if (value !== expected) throw new Error("navigation_error");
}

async function dismissCookies(page: import("playwright").Page) {
  const deny = page.getByRole("button", { name: /deny/i });
  if (await deny.count()) {
    await deny.first().click({ timeout: 3_000 }).catch(() => undefined);
  }
}

async function noteScheduleResponse(
  response: import("playwright").Response,
  now: Date,
): Promise<{ markets?: MarketList; calendar?: ObservedScheduleMeta["calendars"][number] } | null> {
  const url = response.url();
  if (response.status() !== 200) return null;
  try {
    if (url.includes("/Resource/GetMarkets")) {
      const body = (await response.json()) as unknown;
      const expiresAt = new Date(now.getTime() + SCHEDULE_META_TTL_MS).toISOString();
      return { markets: sanitizeMarkets(body, now.toISOString(), expiresAt) };
    }
    if (url.includes("/Flight/RetrieveSchedule")) {
      const body = (await response.json()) as unknown;
      const parsed = new URL(url);
      const origin = (parsed.searchParams.get("calendarSelectableDays.Origin") ?? "").toUpperCase();
      const destination = (parsed.searchParams.get("calendarSelectableDays.Destination") ?? "").toUpperCase();
      const calendar = isRecord(body) && isRecord(body.calendarSelectableDays) ? body.calendarSelectableDays : null;
      const disabled = Array.isArray(calendar?.disabledDates) ? calendar.disabledDates.filter((item): item is string => typeof item === "string") : [];
      const last = calendar && typeof calendar.lastAvailableDate === "string" ? calendar.lastAvailableDate : null;
      if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) return null;
      return { calendar: { origin, destination, disabledDates: disabled, lastAvailableDate: last } };
    }
  } catch {
    return null;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
