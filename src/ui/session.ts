import { getUpdateId } from "../tracking/SkillTracker";
import "./settings.css";
import "./session.css";

export type SessionStatus = "idle" | "running" | "paused" | "ended";

type ItemUpdate = {
  item: string;
  amount: number;
  skill?: string;
  source?: string;
  storageId?: string;
};

type Item = {
  count: number;
  lastUpdated: number;
  displayName: string;
  skill?: string;
  source?: string;
};

type Summary = {
  activeMs: number;
  items: Record<string, Item>;
};

type Run = {
  startedAt: number;
  lastGainAt: number;
  seenAt?: number;
  activeMs: number;
  items: Record<string, Item>;
  endedAt?: number;
};

type Activity = {
  version: 2;
  days: Record<string, Summary>;
  run?: Run;
  lastRun?: Run;
};

type CacheItem = {
  price: number | null;
  checkedAt: number;
};

type LatestResponse = Record<string, { price?: number }>;
type View = "run" | "daily";

const appName = "ResourceTracker";
const sessionId = appName + "_Session";
const priceCacheId = appName + "_PriceCache";
const priceCacheDurationMs = 24 * 60 * 60 * 1000;
const activeGapMs = 30 * 1000;
const runGapMs = 30 * 60 * 1000;
const heartbeatMs = 5 * 1000;
const daysKept = 7;

let activity = loadActivity();
let sessionWindow: Window | null = null;
let sessionUiOwner: Window | null = null;
let refreshApp: (() => void) | null = null;
let view: View = "run";
let selectedDay = dayKey(Date.now());
let followToday = true;
let saveWarningShown = false;

const pendingPrices = new Map<string, Promise<void>>();

if (activity.run) {
  const lastSeen = activity.run.seenAt ?? activity.run.lastGainAt;
  finishRun(Math.min(Date.now(), lastSeen + heartbeatMs));
}
settle(Date.now());
saveActivity();
window.setInterval(() => {
  const now = Date.now();
  settle(now);
  if (activity.run && now - (activity.run.seenAt ?? activity.run.lastGainAt) >= heartbeatMs) {
    activity.run.seenAt = now;
    saveActivity();
  }
  if (sessionWindow && !sessionWindow.closed) updateWindow();
}, 1000);
window.addEventListener("pagehide", () => {
  if (activity.run) finishRun(Date.now());
});

export function getSessionStatus(): SessionStatus {
  const run = activity.run;
  if (run) {
    return Date.now() - run.lastGainAt < activeGapMs ? "running" : "paused";
  }
  return hasSession() ? "ended" : "idle";
}

export function hasSession(): boolean {
  return Boolean(activity.run || activity.lastRun || Object.keys(activity.days).length);
}

export function hasSessionData(): boolean {
  return Object.values(activity.days).some((day) => Object.keys(day.items).length > 0)
    || Boolean(activity.run && Object.keys(activity.run.items).length > 0);
}

export function clearSession(): void {
  activity = { version: 2, days: {} };
  saveActivity();
  updateWindow();
  refreshApp?.();
}

export function getActivityExport(): Activity {
  settle(Date.now());
  return JSON.parse(JSON.stringify(activity)) as Activity;
}

export function importActivity(value: unknown): void {
  const imported = parseActivity(value);
  if (!imported) throw new Error("Invalid activity data");
  activity = imported;
  if (activity.run) {
    const lastSeen = activity.run.seenAt ?? activity.run.lastGainAt;
    finishRun(Math.min(Date.now(), lastSeen + heartbeatMs));
  }
  trimDays();
  saveActivity();
  updateWindow();
  refreshApp?.();
}

export function recordSession(updates: ItemUpdate[]): void {
  if (updates.length === 0) return;

  const now = Date.now();
  settle(now);
  let run = activity.run;
  if (!run) {
    run = { startedAt: now, lastGainAt: now, seenAt: now, activeMs: 0, items: {} };
    activity.run = run;
  } else {
    run.activeMs = getActiveMs(run, now);
    run.lastGainAt = now;
    run.seenAt = now;
  }

  for (const update of updates) {
    addItem(run.items, update, now);
    void ensurePriceForItem(update.item);
  }

  saveActivity();
  updateWindow();
  refreshApp?.();
}

export function showSession(onChange?: () => void): void {
  if (onChange) refreshApp = onChange;
  if (!sessionWindow || sessionWindow.closed) {
    sessionWindow = window.open("", "sessionWindow", "width=400,height=330");
    sessionUiOwner = null;
  }
  void ensurePrices();
  window.setTimeout(updateWindow, 50);
}

export function exportSessionCsv(): void {
  settle(Date.now());
  if (!hasSessionData()) return;

  const rows: Array<Array<string | number>> = [[
    "date", "item", "skill", "source", "count", "active_seconds",
    "per_hour", "unit_price",
    "value", "gp_per_hour",
  ]];

  const today = dayKey(Date.now());
  const dates = new Set(Object.keys(activity.days));
  if (activity.run) dates.add(today);

  for (const date of Array.from(dates).sort().reverse()) {
    const summary = getDay(date);
    const hours = getRateHours(summary);
    for (const item of Object.values(summary.items)) {
      const price = getCachedPrice(item.displayName);
      const value = typeof price === "number" ? item.count * price : null;
      rows.push([
        date,
        titleCase(item.displayName),
        item.skill ?? "",
        item.source ?? "",
        item.count,
        Math.round(summary.activeMs / 1000),
        hours > 0 ? roundCsv(item.count / hours) : "",
        typeof price === "number" ? price : "",
        value ?? "",
        value !== null && hours > 0 ? roundCsv(value / hours) : "",
      ]);
    }
  }

  const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n") + "\r\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "Resource-Tracker-daily-" + today + ".csv";
  link.click();
  URL.revokeObjectURL(url);
}

function addItem(items: Record<string, Item>, update: ItemUpdate, now: number): void {
  const id = getUpdateId(update);
  const item = items[id] ?? {
    count: 0,
    lastUpdated: now,
    displayName: update.item,
  };
  item.count += update.amount;
  item.lastUpdated = now;
  item.displayName = update.item;
  if (update.skill) item.skill = update.skill;
  if (update.source) item.source = update.source;
  items[id] = item;
}

function dayKey(time: number): string {
  const date = new Date(time);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function nextDay(time: number): number {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}

function trimDays(): boolean {
  let changed = false;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - daysKept + 1);
  const first = dayKey(cutoff.getTime());
  for (const date of Object.keys(activity.days)) {
    if (date < first || date > dayKey(Date.now())) {
      delete activity.days[date];
      changed = true;
    }
  }
  if (activity.lastRun && dayKey(activity.lastRun.startedAt) < first) {
    activity.lastRun = undefined;
    changed = true;
  }
  return changed;
}

function settle(now: number): void {
  const run = activity.run;
  if (run) {
    const end = Math.min(run.lastGainAt + runGapMs, nextDay(run.startedAt));
    if (now >= end) finishRun(end);
  }
  if (trimDays()) saveActivity();
}

function getActiveMs(run: Run, now: number): number {
  if (run.endedAt !== undefined) return run.activeMs;
  return run.activeMs + Math.max(0, Math.min(now - run.lastGainAt, activeGapMs));
}

function getRun(run: Run, now = Date.now()): Summary {
  const end = run.endedAt ?? Math.min(now, run.lastGainAt + runGapMs, nextDay(run.startedAt));
  return {
    activeMs: getActiveMs(run, end),
    items: run.items,
  };
}

function finishRun(now: number): void {
  const run = activity.run;
  if (!run) return;
  const end = Math.max(run.startedAt, Math.min(now, run.lastGainAt + runGapMs, nextDay(run.startedAt)));
  run.activeMs = getActiveMs(run, end);
  run.endedAt = end;
  const date = dayKey(run.startedAt);
  const day = activity.days[date] ?? { activeMs: 0, items: {} };
  const summary = getRun(run);
  day.activeMs += summary.activeMs;
  for (const [id, item] of Object.entries(run.items)) {
    const previous = day.items[id];
    if (previous) {
      previous.count += item.count;
      if (item.lastUpdated >= previous.lastUpdated) {
        previous.lastUpdated = item.lastUpdated;
        previous.displayName = item.displayName;
        previous.skill = item.skill;
        previous.source = item.source;
      }
    } else {
      day.items[id] = { ...item };
    }
  }
  activity.days[date] = day;
  activity.lastRun = run;
  activity.run = undefined;
  trimDays();
  saveActivity();
  updateWindow();
  refreshApp?.();
}

function getDay(date: string): Summary {
  const saved = activity.days[date];
  const result: Summary = {
    activeMs: saved?.activeMs ?? 0,
    items: {},
  };
  for (const [id, item] of Object.entries(saved?.items ?? {})) result.items[id] = { ...item };
  const run = activity.run;
  if (run && dayKey(run.startedAt) === date) {
    const current = getRun(run);
    result.activeMs += current.activeMs;
    for (const [id, item] of Object.entries(current.items)) {
      const previous = result.items[id];
      if (previous) {
        previous.count += item.count;
        if (item.lastUpdated >= previous.lastUpdated) {
          previous.lastUpdated = item.lastUpdated;
          previous.displayName = item.displayName;
          previous.skill = item.skill;
          previous.source = item.source;
        }
      } else {
        result.items[id] = { ...item };
      }
    }
  }
  return result;
}

function getShown(): Summary {
  if (view === "daily") {
    if (followToday) selectedDay = dayKey(Date.now());
    if (selectedDay !== dayKey(Date.now()) && !activity.days[selectedDay]) {
      selectedDay = dayKey(Date.now());
      followToday = true;
    }
    return getDay(selectedDay);
  }
  const run = getSessionRun();
  return run ? getRun(run) : { activeMs: 0, items: {} };
}

function getSessionRun(): Run | undefined {
  const run = activity.run;
  return run && dayKey(run.startedAt) === dayKey(Date.now()) ? run : undefined;
}

function getRateHours(summary: Summary): number {
  return summary.activeMs > 0 ? summary.activeMs / 3600000 : 0;
}

function updateWindow(): void {
  if (!sessionWindow || sessionWindow.closed) return;
  const doc = sessionWindow.document;
  if (!doc.body) {
    window.setTimeout(updateWindow, 50);
    return;
  }
  ensureUi(doc);
  const summary = getShown();
  const hours = getRateHours(summary);
  updateChrome(doc, summary);
  updateTotals(doc, summary, hours);
  updateRows(doc, summary, hours);
  if (view === "run") {
    const today = getDay(dayKey(Date.now()));
    const total = getTotal(today);
    setText(doc, "session-today-total-value", total.loading ? "..." : formatGp(total.value));
    setText(doc, "session-today-active-time", formatElapsed(today.activeMs));
    updateRows(doc, today, getRateHours(today), "session-today-items");
  }
}

function ensureUi(doc: Document): void {
  if (sessionUiOwner === sessionWindow && doc.getElementById("session-root")) return;
  doc.title = "Session Stats";
  doc.head.replaceChildren(...cloneStyles(doc));
  doc.body.className = "nis session-window-body";
  doc.body.innerHTML = renderShellHtml();
  doc.querySelectorAll<HTMLButtonElement>(".session-view").forEach((button) => {
    button.addEventListener("click", () => {
      view = button.dataset.view === "daily" ? "daily" : "run";
      void ensurePrices();
      updateWindow();
    });
  });
  doc.getElementById("session-day")?.addEventListener("change", (event) => {
    selectedDay = (event.target as HTMLSelectElement).value;
    followToday = selectedDay === dayKey(Date.now());
    void ensurePrices();
    updateWindow();
  });
  sessionUiOwner = sessionWindow;
}

function updateChrome(doc: Document, summary: Summary): void {
  const today = dayKey(Date.now());
  const dates = new Set([today, ...Object.keys(activity.days)]);
  const selector = doc.getElementById("session-day") as HTMLSelectElement;
  const options = Array.from(dates).sort().reverse();
  if (!options.includes(selectedDay)) followToday = true;
  if (followToday) selectedDay = today;
  if (selector.options.length !== options.length
    || options.some((date, index) => selector.options[index]?.value !== date)) {
    selector.replaceChildren(...options.map((date) => {
      const label = date === today ? "Today · " + formatDate(date) : formatDate(date);
      return new Option(label, date);
    }));
  }
  selector.value = selectedDay;
  (doc.getElementById("session-day-row") as HTMLElement).hidden = view !== "daily";
  (doc.getElementById("session-today-section") as HTMLElement).hidden = view !== "run";
  doc.querySelectorAll<HTMLButtonElement>(".session-view").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  const run = getSessionRun();
  const started = view === "run" && run
    ? new Date(run.startedAt).toLocaleTimeString("en-US", { hour12: false })
    : "—";
  const status = view === "daily"
    ? selectedDay === today ? "Today" : "Complete"
    : getSessionStatus() === "running" ? "Active"
    : run ? "Idle" : "Waiting for a gain";
  setText(doc, "session-started", started);
  setText(doc, "session-status", status);
  (doc.getElementById("session-started-row") as HTMLElement).hidden = view === "daily";
  (doc.getElementById("session-status-row") as HTMLElement).hidden = view === "daily";
  setText(doc, "session-active-time", formatElapsed(summary.activeMs));
  setText(doc, "session-items-title", view === "daily" ? "Daily Summary:" : "Active Session");
  setText(doc, "session-items-empty", view === "daily"
    ? "Nothing tracked on this day."
    : "Nothing tracked in this session.");
  setText(doc, "session-today-items-empty", "Nothing tracked today.");
  (doc.getElementById("session-run-note") as HTMLElement).hidden = view !== "run";
}

function formatDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function getTotal(summary: Summary) {
  let value = 0;
  let loading = false;
  for (const item of Object.values(summary.items)) {
    const price = getCachedPrice(item.displayName);
    if (price === undefined) loading = true;
    if (typeof price === "number") value += item.count * price;
  }
  return { value, loading };
}

function updateTotals(doc: Document, summary: Summary, hours: number): void {
  const total = getTotal(summary);
  setText(doc, "session-total-value", total.loading ? "..." : formatGp(total.value));
  setText(doc, "session-total-gp-hour", total.loading ? "..." : hours > 0 ? formatGp(total.value / hours) : "—");
}

function updateRows(doc: Document, summary: Summary, hours: number, id = "session-items"): void {
  const body = doc.getElementById(`${id}-body`) as HTMLTableSectionElement;
  const items = Object.values(summary.items).sort((a, b) => b.lastUpdated - a.lastUpdated);
  const rows = items.map((item) => {
    const row = doc.createElement("tr");
    const price = getCachedPrice(item.displayName);
    const value = typeof price === "number" ? price * item.count : null;
    const cells = [
      titleCase(item.displayName),
      item.count.toLocaleString(),
      hours > 0 ? formatPerHour(item.count / hours) : "—",
      formatPriceValue(price, value),
      formatGpPerHour(value !== null && hours > 0 ? value / hours : null),
    ];
    cells.forEach((text, index) => {
      const cell = doc.createElement("td");
      cell.textContent = text;
      if (index === 0) cell.title = text;
      else cell.className = "number";
      row.append(cell);
    });
    return row;
  });
  body.replaceChildren(...rows);
  (doc.getElementById(`${id}-table`) as HTMLTableElement).hidden = items.length === 0;
  (doc.getElementById(`${id}-empty`) as HTMLElement).hidden = items.length > 0;
}

function renderItemTable(id: string, empty: string): string {
  return `
    <div id="${id}-empty" class="session-empty">${empty}</div>
    <table id="${id}-table" hidden>
      <thead><tr>
        <th class="session-item-name">Item</th>
        <th class="session-number">Count</th>
        <th class="session-number">Per/hr</th>
        <th class="session-number">Value</th>
        <th class="session-number">GP/hr</th>
      </tr></thead>
      <tbody id="${id}-body"></tbody>
    </table>
  `;
}

function cloneStyles(doc: Document): Node[] {
  const base = doc.createElement("base");
  base.href = document.baseURI;
  return [
    base,
    ...Array.from(document.head.querySelectorAll('style, link[rel="stylesheet"]'))
      .map((node) => doc.importNode(node, true)),
  ];
}

function renderShellHtml(): string {
  return `
    <div id="session-root" class="session-window-panel">
      <div class="session-views" role="group" aria-label="Activity view">
        <button class="session-view is-active" type="button" data-view="run" aria-pressed="true">This Session</button>
        <button class="session-view" type="button" data-view="daily" aria-pressed="false">Daily History</button>
      </div>
      <div id="session-day-row" class="session-day-row" hidden>
        <label for="session-day">Day</label>
        <select id="session-day"></select>
      </div>
      <div class="session-meta">
        <div id="session-started-row"><strong>Started:</strong> <span id="session-started">—</span></div>
        <div id="session-status-row"><strong>Status:</strong> <span id="session-status">Waiting for a gain</span></div>
        <div><strong>Active time:</strong> <span id="session-active-time">00:00:00</span></div>
        <div class="session-active-note">Pauses after 30 seconds without an item gain.</div>
      </div>
      <div id="session-items-title" class="session-section-title">Active Session</div>
      <div class="session-totals">
        <div>Total value: <span id="session-total-value" class="session-total-value">0</span></div>
        <div class="session-total-gp">Total GP/hr: <span id="session-total-gp-hour">0</span></div>
      </div>
      <div id="session-run-note" class="session-section-note">Starts a new session after 30 minutes without an item gain.</div>
      ${renderItemTable("session-items", "Nothing tracked in this session.")}
      <div id="session-today-section" class="session-today-section">
        <div class="session-section-title">Daily Summary:</div>
        <div class="session-totals">
          <div>Total value: <span id="session-today-total-value" class="session-total-value">0</span></div>
          <div class="session-total-time"><strong>Total active time:</strong> <span id="session-today-active-time">00:00:00</span></div>
        </div>
        ${renderItemTable("session-today-items", "Nothing tracked today.")}
      </div>
    </div>
  `;
}

async function ensurePrices(): Promise<void> {
  const summary = view === "run" ? getDay(dayKey(Date.now())) : getShown();
  const items = Object.values(summary.items);
  for (const item of items) await ensurePriceForItem(item.displayName);
}

async function ensurePriceForItem(item: string): Promise<void> {
  if (isCoinsItem(item) || getCachedPrice(item) !== undefined) return;
  const priceId = getPriceId(item);
  const pending = pendingPrices.get(priceId);
  if (pending) return pending;
  const request = fetchAndSavePrice(item, priceId);
  pendingPrices.set(priceId, request);
  return request;
}

async function fetchAndSavePrice(item: string, priceId: string): Promise<void> {
  try {
    const price = await fetchItemPrice(item);
    const cache = loadPriceCache();
    cache[priceId] = { price, checkedAt: Date.now() };
    savePriceCache(cache);
  } catch {
    const cache = loadPriceCache();
    cache[priceId] = { price: null, checkedAt: Date.now() };
    savePriceCache(cache);
  } finally {
    pendingPrices.delete(priceId);
    updateWindow();
  }
}

export async function getPrice(item: string): Promise<number | null> {
  const cached = getCachedPrice(item);
  if (cached !== undefined) return cached;
  await ensurePriceForItem(item);
  return getCachedPrice(item) ?? null;
}

async function fetchItemPrice(item: string): Promise<number | null> {
  if (isCoinsItem(item)) return 1;
  const params = new URLSearchParams({ name: toWikiPriceName(item) });
  const response = await fetch(
    "https://api.weirdgloop.org/exchange/history/rs/latest?" + params.toString(),
  );
  if (!response.ok) return null;
  const json = await response.json() as LatestResponse;
  const first = Object.values(json)[0];
  return typeof first?.price === "number" ? first.price : null;
}

export function getCachedPrice(item: string): number | null | undefined {
  if (isCoinsItem(item)) return 1;
  const entry = loadPriceCache()[getPriceId(item)];
  if (!entry || Date.now() - entry.checkedAt >= priceCacheDurationMs) return undefined;
  return entry.price;
}

function loadPriceCache(): Record<string, CacheItem> {
  const raw = localStorage.getItem(priceCacheId);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, CacheItem>;
  } catch {
    return {};
  }
}

function savePriceCache(cache: Record<string, CacheItem>): void {
  localStorage.setItem(priceCacheId, JSON.stringify(cache));
}

function cleanItemNameForPrice(item: string): string {
  return item.replace(/^﴾♦﴿\s*/, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function getPriceId(item: string): string {
  return cleanItemNameForPrice(item);
}

function toWikiPriceName(item: string): string {
  const cleaned = cleanItemNameForPrice(item);
  return cleaned ? (cleaned.charAt(0).toUpperCase() + cleaned.slice(1)).replace(/\s+/g, "_") : "";
}

function isCoinsItem(item: string): boolean {
  const cleaned = cleanItemNameForPrice(item);
  return cleaned === "coin" || cleaned === "coins";
}

function loadActivity(): Activity {
  const raw = localStorage.getItem(sessionId);
  if (!raw) return { version: 2, days: {} };
  try {
    const value = JSON.parse(raw) as unknown;
    const saved = parseActivity(value);
    if (saved) return saved;
    const legacy = value as {
      startedAt?: number;
      activeMs?: number;
      items?: Record<string, Item>;
      events?: Array<ItemUpdate & { timestamp: number }>;
    };
    if (isMs(legacy.startedAt) && isMs(legacy.activeMs)
      && legacy.items && typeof legacy.items === "object") {
      const items: Record<string, Item> = {};
      for (const [id, item] of Object.entries(legacy.items)) {
        if (isItem(item)) items[id] = item;
      }
      const lastGainAt = Math.max(
        legacy.startedAt,
        ...Object.values(items).map((item) => item.lastUpdated),
      );
      const run: Run = {
        startedAt: legacy.startedAt,
        lastGainAt,
        endedAt: legacy.startedAt + legacy.activeMs,
        activeMs: legacy.activeMs,
        items,
      };
      const days: Record<string, Summary> = {};
      if (Array.isArray(legacy.events) && legacy.events.length > 0) {
        for (const event of legacy.events) {
          if (!event || !isMs(event.timestamp) || typeof event.item !== "string"
            || !Number.isSafeInteger(event.amount) || event.amount <= 0) continue;
          const date = dayKey(event.timestamp);
          const day = days[date] ?? { activeMs: 0, items: {} };
          addItem(day.items, event, event.timestamp);
          days[date] = day;
        }
      } else {
        days[dayKey(legacy.startedAt)] = {
          activeMs: legacy.activeMs,
          items: { ...items },
        };
      }
      return {
        version: 2,
        days,
        lastRun: run,
      };
    }
  } catch {
    // A damaged local save should not stop tracking.
  }
  return { version: 2, days: {} };
}

function parseActivity(value: unknown): Activity | null {
  if (!value || typeof value !== "object") return null;
  const saved = value as Partial<Activity>;
  if (saved.version !== 2 || !saved.days || typeof saved.days !== "object") return null;
  const days: Record<string, Summary> = {};
  for (const [date, summary] of Object.entries(saved.days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const parsed = parseSummary(summary);
    if (parsed) days[date] = parsed;
  }
  return {
    version: 2,
    days,
    run: parseRun(saved.run) ?? undefined,
    lastRun: parseRun(saved.lastRun) ?? undefined,
  };
}

function parseSummary(value: unknown): Summary | null {
  if (!value || typeof value !== "object") return null;
  const summary = value as Summary;
  if (!isMs(summary.activeMs)
    || !summary.items || typeof summary.items !== "object") return null;
  const items: Record<string, Item> = {};
  for (const [id, item] of Object.entries(summary.items)) {
    if (isItem(item)) items[id] = item;
  }
  return { activeMs: summary.activeMs, items };
}

function parseRun(value: unknown): Run | null {
  if (!value || typeof value !== "object") return null;
  const run = value as Run;
  if (!isMs(run.startedAt) || !isMs(run.lastGainAt) || !isMs(run.activeMs)
    || (run.seenAt !== undefined && !isMs(run.seenAt))
    || (run.endedAt !== undefined && !isMs(run.endedAt))
    || !run.items || typeof run.items !== "object") return null;
  const items: Record<string, Item> = {};
  for (const [id, item] of Object.entries(run.items)) {
    if (isItem(item)) items[id] = item;
  }
  return { ...run, items };
}

function isMs(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isItem(value: unknown): value is Item {
  if (!value || typeof value !== "object") return false;
  const item = value as Item;
  return Number.isSafeInteger(item.count) && item.count >= 0
    && isMs(item.lastUpdated) && typeof item.displayName === "string"
    && (item.skill === undefined || typeof item.skill === "string")
    && (item.source === undefined || typeof item.source === "string");
}

function saveActivity(): void {
  trimDays();
  try {
    localStorage.setItem(sessionId, JSON.stringify(activity));
    saveWarningShown = false;
  } catch (error) {
    if (!saveWarningShown) {
      console.warn("Activity save failed", error);
      saveWarningShown = true;
    }
  }
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return [
    Math.floor(seconds / 3600),
    Math.floor((seconds % 3600) / 60),
    seconds % 60,
  ].map((part) => String(part).padStart(2, "0")).join(":");
}

function formatPerHour(value: number): string {
  return Number.isFinite(value) && value > 0 ? Math.round(value).toLocaleString() : "0";
}

function formatPriceValue(price: number | null | undefined, value: number | null): string {
  if (price === undefined) return "...";
  return price === null || value === null ? "—" : formatGp(value);
}

function formatGpPerHour(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : formatGp(value);
}

export function formatGp(value: number): string {
  const rounded = Math.round(value);
  if (rounded >= 1_000_000_000) return trimDecimal(rounded / 1_000_000_000) + "b";
  if (rounded >= 1_000_000) return trimDecimal(rounded / 1_000_000) + "m";
  if (rounded >= 10_000) return trimDecimal(rounded / 1_000) + "k";
  return rounded.toLocaleString();
}

function trimDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

function titleCase(value: string): string {
  return value.replace(/(^|[\s-])([a-z])/g, (_match, prefix, char) =>
    prefix + char.toUpperCase());
}

function roundCsv(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function escapeCsv(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function setText(doc: Document, id: string, value: string): void {
  const element = doc.getElementById(id);
  if (element && element.textContent !== value) element.textContent = value;
}
