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

export function getSessionStatus(): SessionStatus {
	return sessionStatus;
}

export function hasSession(): boolean {
	return sessionStatus !== "idle";
}

export function hasSessionData(): boolean {
	return Object.keys(sessionItems).length > 0;
}

export function clearSession(): void {
	sessionStatus = "idle";
	sessionStartedAt = null;
	sessionEndedAt = null;
	activeStartedAt = null;
	activeMs = 0;
	sessionItems = {};
	sessionEvents = [];
	localStorage.removeItem(sessionId);
	updateWindow("full");
	refreshApp?.();
}

type Item = {
	count: number;
	lastUpdated: number;
	displayName: string;
};

type ItemEvent = {
	timestamp: number;
	activeMs: number;
	item: string;
	amount: number;
	skill?: string;
	source?: string;
	storageId?: string;
	unitPrice?: number;
};

type StoredSession = {
	status: Exclude<SessionStatus, "idle">;
	startedAt: number;
	endedAt?: number;
	activeMs: number;
	items: Record<string, Item>;
	events: ItemEvent[];
};

type CacheItem = {
	price: number | null;
	checkedAt: number;
};

type Cache = Record<string, CacheItem>;

type LatestEntry = {
	price?: number;
};

type LatestResponse = Record<string, LatestEntry>;

type UpdateMode = "full" | "clock" | "items" | "prices";

type RowElements = {
	row: HTMLTableRowElement;
	name: HTMLTableCellElement;
	count: HTMLTableCellElement;
	perHour: HTMLTableCellElement;
	value: HTMLTableCellElement;
	gpPerHour: HTMLTableCellElement;
};

const appName = "ResourceTracker";
const sessionId = `${appName}_Session`;
const priceCacheId = `${appName}_PriceCache`;
const priceCacheDurationMs = 24 * 60 * 60 * 1000;
const checkpointIntervalMs = 5000;

const savedSession = loadSession();
let sessionStatus: SessionStatus = savedSession?.status ?? "idle";
let sessionStartedAt: number | null = savedSession?.startedAt ?? null;
let sessionEndedAt: number | null = savedSession?.endedAt ?? null;
let activeStartedAt: number | null = null;
let activeMs = savedSession?.activeMs ?? 0;

let sessionItems: Record<string, Item> = savedSession?.items ?? {};
let sessionEvents = savedSession?.events ?? [];
let sessionWindow: Window | null = null;
let sessionRefreshTimer: number | null = null;
let sessionUiOwner: Window | null = null;
let refreshApp: (() => void) | null = null;
let saveWarningShown = false;

const pendingPrices = new Set<string>();
const sessionRows = new Map<string, RowElements>();

localStorage.removeItem(`${appName}_SessionSettings`);

if (sessionStatus === "running") {
	sessionStatus = "paused";
	saveSession();
}

window.setInterval(checkpointSession, checkpointIntervalMs);
window.addEventListener("pagehide", pauseForClose);

export function recordSession(updates: ItemUpdate[]) {
	if (sessionStatus !== "running") return;
	if (updates.length === 0) return;

	const timestamp = Date.now();
	const eventActiveMs = getElapsedMs();

	for (const update of updates) {
		const id = getUpdateId(update);
		if (!sessionItems[id]) {
			sessionItems[id] = {
				count: 0,
				lastUpdated: timestamp,
				displayName: update.item,
			};
		}

		sessionItems[id].count += update.amount;
		sessionItems[id].lastUpdated = timestamp;

		const price = getCachedPrice(update.item);
		sessionEvents.push({
			timestamp,
			activeMs: eventActiveMs,
			item: update.item,
			amount: update.amount,
			skill: update.skill,
			source: update.source,
			storageId:
				update.storageId && update.storageId !== update.item
					? update.storageId
					: undefined,
			unitPrice: typeof price === "number" ? price : undefined,
		});

		void ensurePriceForItem(update.item);
	}

	checkpointSession();
	updateWindow("items");
}

export function exportSessionCsv(): void {
	if (!hasSessionData() || sessionStartedAt === null) return;

	const blob = new Blob([buildCsv(sessionStartedAt)], {
		type: "text/csv;charset=utf-8",
	});
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = getCsvFilename(sessionStartedAt);
	link.click();
	URL.revokeObjectURL(url);
}

export function showSession(onChange?: () => void) {
	if (onChange) refreshApp = onChange;

	if (!sessionWindow || sessionWindow.closed) {
		sessionWindow = window.open(
			"",
			"sessionWindow",
			"width=400,height=275"
		);
		sessionUiOwner = null;
		sessionRows.clear();
	}

	if (sessionStatus !== "idle") {
		void ensurePrices();
	}

	startRefreshTimer();
	setTimeout(() => updateWindow("full"), 50);
}

function toggleSession(doc: Document) {
	if (sessionStatus === "idle") {
		startSession();
	} else if (sessionStatus === "running") {
		pauseSession();
	} else if (sessionStatus === "paused") {
		resumeSession();
	} else {
		requestNewSession(doc);
	}
}

function startSession() {
	const now = Date.now();
	sessionStatus = "running";
	sessionStartedAt = now;
	sessionEndedAt = null;
	activeStartedAt = now;
	activeMs = 0;
	sessionItems = {};
	sessionEvents = [];
	saveSession();
	updateWindow("full");
	refreshApp?.();
}

function pauseSession() {
	commitActiveTime();
	activeStartedAt = null;
	sessionStatus = "paused";
	saveSession();
	updateWindow("full");
	refreshApp?.();
}

function resumeSession() {
	activeStartedAt = Date.now();
	sessionStatus = "running";
	saveSession();
	updateWindow("full");
	refreshApp?.();
}

function endSession() {
	const now = Date.now();
	commitActiveTime(now);
	activeStartedAt = null;
	sessionStatus = "ended";
	sessionEndedAt = now;
	saveSession();
	updateWindow("full");
	refreshApp?.();
}

function requestNewSession(doc: Document): void {
	if (doc.querySelector(".tracker-confirmation-overlay")) return;

	const overlay = doc.createElement("div");
	overlay.className = "tracker-confirmation-overlay";

	const dialog = doc.createElement("section");
	dialog.className = "tracker-confirmation";
	dialog.setAttribute("role", "dialog");
	dialog.setAttribute("aria-modal", "true");
	dialog.setAttribute("aria-labelledby", "session-new-confirmation-title");

	const title = doc.createElement("div");
	title.className = "tracker-confirmation-title";
	title.id = "session-new-confirmation-title";
	title.textContent = "Start a new session?";

	const message = doc.createElement("div");
	message.className = "tracker-confirmation-message";
	message.textContent = "The current session data will be cleared.";

	const actions = doc.createElement("div");
	actions.className = "tracker-confirmation-actions";

	const cancel = doc.createElement("button");
	cancel.type = "button";
	cancel.className = "tracker-confirmation-cancel";
	cancel.textContent = "Cancel";

	const confirm = doc.createElement("button");
	confirm.type = "button";
	confirm.className = "tracker-confirmation-confirm";
	confirm.textContent = "Start New";

	const close = () => {
		doc.removeEventListener("keydown", onKeyDown);
		overlay.remove();
	};
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Escape") {
			event.preventDefault();
			close();
		}
	};

	cancel.addEventListener("click", close);
	overlay.addEventListener("click", (event) => {
		if (event.target === overlay) close();
	});
	confirm.addEventListener("click", () => {
		close();
		startSession();
	});
	doc.addEventListener("keydown", onKeyDown);

	actions.append(cancel, confirm);
	dialog.append(title, message, actions);
	overlay.append(dialog);
	doc.body.append(overlay);
	cancel.focus();
}

function updateWindow(mode: UpdateMode = "full") {
	if (!sessionWindow || sessionWindow.closed) return;

	const doc = sessionWindow.document;

	if (!doc.body) {
		setTimeout(() => updateWindow(mode), 50);
		return;
	}

	const initializedNow = ensureUi(doc);
	const effectiveMode = initializedNow ? "full" : mode;

	updateChrome(doc);
	updateTotals(doc);
	syncRows(doc, effectiveMode);
}

function ensureUi(doc: Document) {
	const alreadyInitialized =
		sessionUiOwner === sessionWindow &&
		Boolean(doc.getElementById("session-root"));

	if (alreadyInitialized) return false;

	doc.title = "Session Stats";
	doc.head.replaceChildren(...cloneStyles(doc));
	doc.body.className = "nis session-window-body";
	doc.body.innerHTML = renderShellHtml();

	doc
		.getElementById("session-toggle")
		?.addEventListener("click", () => toggleSession(doc));

	doc
		.getElementById("session-end")
		?.addEventListener("click", endSession);

	sessionUiOwner = sessionWindow;
	sessionRows.clear();
	return true;
}

function updateChrome(doc: Document) {
	const toggleText =
		sessionStatus === "idle"
			? "Start Session"
			: sessionStatus === "running"
				? "Pause Session"
				: sessionStatus === "paused"
					? "Resume Session"
					: "Start New Session";

	const startedText = sessionStartedAt
		? new Date(sessionStartedAt).toLocaleTimeString("en-US", {
			hour12: false,
		})
		: "—";

	const statusText =
		sessionStatus === "idle"
			? "Not running"
			: sessionStatus === "running"
				? "Running"
				: sessionStatus === "paused"
					? "Paused"
					: "Ended";

	setText(doc, "session-toggle", toggleText);
	setText(doc, "session-started", startedText);
	setText(doc, "session-status", statusText);
	setText(doc, "session-elapsed", formatElapsed(getElapsedMs()));

	const status = doc.getElementById("session-status");
	if (status) status.className = sessionStatus;

	const end = doc.getElementById("session-end") as HTMLButtonElement | null;
	if (end) end.hidden = sessionStatus === "idle" || sessionStatus === "ended";

	const controls = doc.querySelector(".session-controls");
	controls?.classList.toggle("single", end ? end.hidden === true : true);

}

function updateTotals(doc: Document) {
	const totals = getValueTotals();
	const totalValueText = totals.hasLoadingPrices
		? "..."
		: formatGp(totals.totalValue);
	const totalGpPerHourText = totals.hasLoadingPrices
		? "..."
		: formatGp(totals.totalGpPerHour);

	setText(doc, "session-total-value", totalValueText);
	setText(doc, "session-total-gp-hour", totalGpPerHourText);
}

function syncRows(doc: Document, mode: UpdateMode) {
	const orderedIds = Object.keys(sessionItems).sort((a, b) =>
		sessionItems[b].lastUpdated - sessionItems[a].lastUpdated
	);
	const shouldReconcileStructure = mode === "full" || mode === "items";
	const activeIds = new Set(orderedIds);
	const tbody = doc.getElementById("session-items-body") as HTMLTableSectionElement | null;
	const table = doc.getElementById("session-items-table") as HTMLTableElement | null;
	const empty = doc.getElementById("session-empty");

	if (!tbody || !table || !empty) return;

	if (shouldReconcileStructure) {
		const removedIds: string[] = [];
		sessionRows.forEach((elements, id) => {
			if (activeIds.has(id)) return;
			elements.row.remove();
			removedIds.push(id);
		});
		for (const id of removedIds) {
			sessionRows.delete(id);
		}

		for (const id of orderedIds) {
			const itemData = sessionItems[id];
			let elements = sessionRows.get(id);

			if (!elements) {
				elements = createRow(doc);
				sessionRows.set(id, elements);
			}

			const renderedName = titleCase(itemData.displayName);
			elements.name.textContent = renderedName;
			elements.name.title = renderedName;
			elements.count.textContent = itemData.count.toLocaleString();

			tbody.appendChild(elements.row);
		}
	}

	const elapsedHours = getElapsedHours();

	for (const id of orderedIds) {
		const elements = sessionRows.get(id);
		const itemData = sessionItems[id];
		if (!elements) continue;

		const values = getItemValues(itemData, elapsedHours);
		elements.perHour.textContent = formatPerHour(values.perHour);
		elements.value.textContent = formatPriceValue(values.price, values.totalValue);
		elements.gpPerHour.textContent = formatGpPerHour(values.gpPerHour);
	}

	const hasItems = orderedIds.length > 0;
	table.hidden = !hasItems;
	empty.hidden = hasItems;
}

function createRow(doc: Document): RowElements {
	const row = doc.createElement("tr");
	const name = doc.createElement("td");
	const count = doc.createElement("td");
	const perHour = doc.createElement("td");
	const value = doc.createElement("td");
	const gpPerHour = doc.createElement("td");

	name.className = "item-name";
	count.className = "number";
	perHour.className = "number";
	value.className = "number";
	gpPerHour.className = "number";

	row.append(name, count, perHour, value, gpPerHour);

	return {
		row,
		name,
		count,
		perHour,
		value,
		gpPerHour,
	};
}

function setText(doc: Document, id: string, value: string) {
	const element = doc.getElementById(id);
	if (element && element.textContent !== value) {
		element.textContent = value;
	}
}

function startRefreshTimer() {
	if (sessionRefreshTimer !== null) return;

	sessionRefreshTimer = window.setInterval(() => {
		if (!sessionWindow || sessionWindow.closed) {
			if (sessionRefreshTimer !== null) {
				window.clearInterval(sessionRefreshTimer);
				sessionRefreshTimer = null;
			}

			sessionUiOwner = null;
			sessionRows.clear();
			return;
		}

		if (sessionStatus === "running") {
			updateWindow("clock");
		}
	}, 1000);
}

function cloneStyles(doc: Document): Node[] {
	const base = doc.createElement("base");
	base.href = document.baseURI;

	return [
		base,
		...Array.from(
			document.head.querySelectorAll('style, link[rel="stylesheet"]'),
		).map((node) => doc.importNode(node, true)),
	];
}

function renderShellHtml() {
	return `

		<div id="session-root" class="session-window-panel">
			<div class="session-controls">
				<button id="session-toggle">Start</button>
				<button id="session-end" hidden>End Session</button>
			</div>

			<div class="session-meta">
				<div class="session-note">Continues while Resource Tracker is open.</div>
				<div class="session-separator"></div>

				<div><strong>Session Started:</strong> <span id="session-started">—</span></div>
				<div><strong>Status:</strong> <span id="session-status" class="idle">Not running</span></div>
				<div><strong>Elapsed:</strong> <span id="session-elapsed">00:00:00</span></div>

			</div>

			<div id="session-totals" class="session-totals">
				<div>
					Total value:
					<span id="session-total-value" class="session-total-value">0</span>
				</div>

				<div class="session-total-gp">
					Total GP/hr: <span id="session-total-gp-hour">0</span>
				</div>
			</div>

			<div class="session-section-title">Recent Items</div>
			<div id="session-empty" class="session-empty">No items yet.</div>

			<table id="session-items-table" hidden>
				<thead>
					<tr>
						<th class="session-item-name">Item</th>
						<th class="session-number">Count</th>
						<th class="session-number">Per/hr</th>
						<th class="session-number">Value</th>
						<th class="session-number">GP/hr</th>
					</tr>
				</thead>
				<tbody id="session-items-body"></tbody>
			</table>
		</div>
	`;
}

function getValueTotals(elapsedHours = getElapsedHours()) {
	const items = Object.keys(sessionItems);

	let totalValue = 0;
	let hasLoadingPrices = false;

	for (const item of items) {
		const values = getItemValues(sessionItems[item], elapsedHours);

		if (values.price === undefined) {
			hasLoadingPrices = true;
			continue;
		}

		if (values.totalValue === null) {
			continue;
		}

		totalValue += values.totalValue;
	}

	const totalGpPerHour =
		elapsedHours > 0
			? totalValue / elapsedHours
			: 0;

	return {
		totalValue,
		totalGpPerHour,
		hasLoadingPrices,
	};
}

function getElapsedHours(elapsedMs = getElapsedMs()) {
	return elapsedMs > 0 ? elapsedMs / 3600000 : 0;
}

function getItemValues(item: Item, elapsedHours: number) {
	const perHour = elapsedHours > 0 ? item.count / elapsedHours : 0;
	const price = getCachedPrice(item.displayName);
	const totalValue = typeof price === "number" ? item.count * price : null;
	const gpPerHour = totalValue !== null && elapsedHours > 0
		? totalValue / elapsedHours
		: null;

	return {
		perHour,
		price,
		totalValue,
		gpPerHour,
	};
}

function getElapsedMs() {
	if (!sessionStartedAt) return 0;

	if (sessionStatus === "running" && activeStartedAt) {
		return activeMs + (Date.now() - activeStartedAt);
	}

	return activeMs;
}

function commitActiveTime(now = Date.now()) {
	if (sessionStatus !== "running" || activeStartedAt === null) return;

	activeMs += Math.max(0, now - activeStartedAt);
	activeStartedAt = now;
}

function checkpointSession() {
	if (sessionStatus !== "running") return;

	commitActiveTime();
	saveSession();
}

function pauseForClose() {
	if (sessionStatus !== "running") return;

	commitActiveTime();
	activeStartedAt = null;
	sessionStatus = "paused";
	saveSession();
}

async function ensurePrices() {
	const items = Object.keys(sessionItems);

	for (const item of items) {
		await ensurePriceForItem(sessionItems[item].displayName);
	}
}

async function ensurePriceForItem(item: string) {
	const priceId = getPriceId(item);

	if (isCoinsItem(item)) return;

	const cachedPrice = getCachedPrice(item);

	if (cachedPrice !== undefined) return;
	if (pendingPrices.has(priceId)) return;

	pendingPrices.add(priceId);

	try {
		const price = await fetchItemPrice(item);
		const cache = loadPriceCache();

		cache[priceId] = {
			price,
			checkedAt: Date.now(),
		};

		savePriceCache(cache);
		if (typeof price === "number") setEventPrice(item, price);
	} catch {
		const cache = loadPriceCache();

		cache[priceId] = {
			price: null,
			checkedAt: Date.now(),
		};

		savePriceCache(cache);
	} finally {
		pendingPrices.delete(priceId);
		updateWindow("prices");
	}
}

function setEventPrice(item: string, price: number) {
	const priceId = getPriceId(item);
	let changed = false;

	for (const event of sessionEvents) {
		if (event.unitPrice === undefined && getPriceId(event.item) === priceId) {
			event.unitPrice = price;
			changed = true;
		}
	}

	if (changed) saveSession();
}

async function fetchItemPrice(item: string): Promise<number | null> {
	if (isCoinsItem(item)) return 1;

	const wikiName = toWikiPriceName(item);
	const params = new URLSearchParams({
		name: wikiName,
	});

	const response = await fetch(
		`https://api.weirdgloop.org/exchange/history/rs/latest?${params.toString()}`
	);

	if (!response.ok) return null;

	const json = await response.json() as LatestResponse;
	const firstResult = Object.values(json)[0];

	if (!firstResult || typeof firstResult.price !== "number") {
		return null;
	}

	return firstResult.price;
}

export function getCachedPrice(item: string): number | null | undefined {
	if (isCoinsItem(item)) return 1;

	const cache = loadPriceCache();
	const entry = cache[getPriceId(item)];

	if (!entry) return undefined;

	const isFresh = Date.now() - entry.checkedAt < priceCacheDurationMs;

	if (!isFresh) return undefined;

	return entry.price;
}

function buildCsv(startedAt: number) {
	const elapsedMs = getElapsedMs();
	const elapsedHours = getElapsedHours(elapsedMs);
	const totals = getValueTotals(elapsedHours);
	const sessionEnd = sessionStatus === "ended" && sessionEndedAt !== null
		? new Date(sessionEndedAt).toISOString()
		: "";
	const rows: Array<Array<string | number>> = [
		["session_start", new Date(startedAt).toISOString()],
		["session_end", sessionEnd],
		["session_seconds", elapsedMs / 1000],
		["total_value", totals.hasLoadingPrices ? "" : totals.totalValue],
		[
			"total_gp_per_hour",
			totals.hasLoadingPrices ? "" : roundCsv(totals.totalGpPerHour),
		],
		[],
		[
			"item",
			"skill",
			"source",
			"count",
			"per_hour",
			"unit_price",
			"total_value",
			"gp_per_hour",
		],
	];
	const orderedIds = Object.keys(sessionItems).sort((a, b) =>
		sessionItems[b].lastUpdated - sessionItems[a].lastUpdated
	);

	for (const id of orderedIds) {
		const item = sessionItems[id];
		const details = getEventDetails(id);
		const values = getItemValues(item, elapsedHours);

		rows.push([
			titleCase(item.displayName),
			details.skill,
			details.source,
			item.count,
			roundCsv(values.perHour),
			typeof values.price === "number" ? values.price : "",
			values.totalValue ?? "",
			values.gpPerHour === null ? "" : roundCsv(values.gpPerHour),
		]);
	}

	return `${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}\r\n`;
}

function getEventDetails(id: string) {
	const skills = new Set<string>();
	const sources = new Set<string>();

	for (const event of sessionEvents) {
		if (getUpdateId(event) !== id) continue;
		if (event.skill) skills.add(event.skill);
		if (event.source) sources.add(event.source);
	}

	return {
		skill: Array.from(skills).join("; "),
		source: Array.from(sources).join("; "),
	};
}

function roundCsv(value: number) {
	return Math.round(value * 1000) / 1000;
}

function escapeCsv(value: string | number) {
	const text = String(value);

	return /[",\r\n]/.test(text)
		? `"${text.replace(/"/g, '""')}"`
		: text;
}

function getCsvFilename(startedAt: number) {
	const timestamp = new Date(startedAt).toISOString();
	const date = timestamp.slice(0, 10);
	const time = timestamp.slice(11, 19).replace(/:/g, "");

	return `Resource-Tracker-session-${date}-${time}.csv`;
}

function loadSession(): StoredSession | null {
	const raw = localStorage.getItem(sessionId);

	if (!raw) return null;

	try {
		const saved = JSON.parse(raw) as unknown;

		if (!saved || typeof saved !== "object") throw new Error();

		const value = saved as Record<string, unknown>;
		const status = value.status;
		const startedAt = value.startedAt;
		const storedEndedAt = value.endedAt;
		const storedActiveMs = value.activeMs;
		const storedItems = value.items;
		const storedEvents = value.events;

		if (
			(status !== "running" && status !== "paused" && status !== "ended") ||
			typeof startedAt !== "number" ||
			!Number.isFinite(startedAt) ||
			startedAt <= 0 ||
			startedAt > 8.64e15 ||
			(storedEndedAt !== undefined &&
				(typeof storedEndedAt !== "number" ||
					!Number.isFinite(storedEndedAt) ||
					storedEndedAt < 0 ||
					storedEndedAt > 8.64e15)) ||
			typeof storedActiveMs !== "number" ||
			!Number.isFinite(storedActiveMs) ||
			storedActiveMs < 0 ||
			!storedItems ||
			typeof storedItems !== "object" ||
			Array.isArray(storedItems)
		) {
			throw new Error();
		}

		const items: Record<string, Item> = {};

		for (const [id, storedItem] of Object.entries(storedItems)) {
			if (!storedItem || typeof storedItem !== "object") throw new Error();

			const item = storedItem as Record<string, unknown>;

			if (
				typeof item.count !== "number" ||
				!Number.isFinite(item.count) ||
				typeof item.lastUpdated !== "number" ||
				!Number.isFinite(item.lastUpdated) ||
				typeof item.displayName !== "string"
			) {
				throw new Error();
			}

			items[id] = {
				count: item.count,
				lastUpdated: item.lastUpdated,
				displayName: item.displayName,
			};
		}

		const events: ItemEvent[] = [];

		if (storedEvents !== undefined) {
			if (!Array.isArray(storedEvents)) throw new Error();

			for (const storedEvent of storedEvents) {
				if (!storedEvent || typeof storedEvent !== "object") throw new Error();

				const event = storedEvent as Record<string, unknown>;
				if (
					typeof event.timestamp !== "number" ||
					!Number.isFinite(event.timestamp) ||
					event.timestamp < 0 ||
					event.timestamp > 8.64e15 ||
					typeof event.activeMs !== "number" ||
					!Number.isFinite(event.activeMs) ||
					event.activeMs < 0 ||
					typeof event.item !== "string" ||
					typeof event.amount !== "number" ||
					!Number.isFinite(event.amount) ||
					(event.skill !== undefined && typeof event.skill !== "string") ||
					(event.source !== undefined && typeof event.source !== "string") ||
					(event.storageId !== undefined && typeof event.storageId !== "string") ||
					(event.unitPrice !== undefined &&
						(typeof event.unitPrice !== "number" ||
							!Number.isFinite(event.unitPrice)))
				) {
					throw new Error();
				}

				events.push({
					timestamp: event.timestamp,
					activeMs: event.activeMs,
					item: event.item,
					amount: event.amount,
					skill: event.skill,
					source: event.source,
					storageId: event.storageId,
					unitPrice: event.unitPrice,
				} as ItemEvent);
			}
		}

		return {
			status,
			startedAt,
			endedAt: typeof storedEndedAt === "number" ? storedEndedAt : undefined,
			activeMs: storedActiveMs,
			items,
			events,
		};
	} catch {
		localStorage.removeItem(sessionId);
		return null;
	}
}

function saveSession() {
	if (sessionStatus === "idle" || sessionStartedAt === null) {
		localStorage.removeItem(sessionId);
		return;
	}

	const session: StoredSession = {
		status: sessionStatus,
		startedAt: sessionStartedAt,
		endedAt: sessionEndedAt ?? undefined,
		activeMs,
		items: sessionItems,
		events: sessionEvents,
	};

	try {
		localStorage.setItem(sessionId, JSON.stringify(session));
		saveWarningShown = false;
	} catch (error) {
		if (!saveWarningShown) {
			console.warn("Session save failed", error);
			saveWarningShown = true;
		}
	}
}

function loadPriceCache(): Cache {
	const raw = localStorage.getItem(priceCacheId);

	if (!raw) return {};

	try {
		return JSON.parse(raw) as Cache;
	} catch {
		return {};
	}
}

function savePriceCache(cache: Cache) {
	localStorage.setItem(priceCacheId, JSON.stringify(cache));
}

function cleanItemNameForPrice(item: string) {
	return item
		.replace(/^﴾♦﴿\s*/, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

function getPriceId(item: string) {
	return cleanItemNameForPrice(item);
}

function toWikiPriceName(item: string) {
	const cleaned = cleanItemNameForPrice(item);

	if (!cleaned) return "";

	const pageName =
		cleaned.charAt(0).toUpperCase() +
		cleaned.slice(1);

	return pageName.replace(/\s+/g, "_");
}

function isCoinsItem(item: string) {
	const cleaned = cleanItemNameForPrice(item);

	return cleaned === "coin" || cleaned === "coins";
}

function formatElapsed(ms: number) {
	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	return [
		hours.toString().padStart(2, "0"),
		minutes.toString().padStart(2, "0"),
		seconds.toString().padStart(2, "0"),
	].join(":");
}

function formatPerHour(value: number) {
	if (!isFinite(value) || value <= 0) return "0/hr";

	return `${Math.round(value).toLocaleString()}`;
}

function formatPriceValue(
	price: number | null | undefined,
	totalValue: number | null
) {
	if (price === undefined) return "...";
	if (price === null || totalValue === null) return "—";

	return formatGp(totalValue);
}

function formatGpPerHour(value: number | null) {
	if (value === null || !isFinite(value)) return "—";

	return formatGp(value);
}

export function formatGp(value: number) {
	const rounded = Math.round(value);

	if (rounded >= 1_000_000_000) {
		return `${trimDecimal(rounded / 1_000_000_000)}b`;
	}

	if (rounded >= 1_000_000) {
		return `${trimDecimal(rounded / 1_000_000)}m`;
	}

	if (rounded >= 10_000) {
		return `${trimDecimal(rounded / 1_000)}k`;
	}

	return rounded.toLocaleString();
}

function trimDecimal(value: number) {
	return value
		.toFixed(1)
		.replace(/\.0$/, "");
}

function titleCase(text: string) {
	return text.replace(/(^|[\s\-])([a-z])/g, (_match, prefix, char) => {
		return prefix + char.toUpperCase();
	});
}
