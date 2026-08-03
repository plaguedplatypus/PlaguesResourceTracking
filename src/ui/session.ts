export type SessionStatus = "idle" | "running" | "paused";

export type SessionItemUpdate = {
	item: string;
	amount: number;
	storageKey?: string;
};

export function getSessionStatus(): SessionStatus {
	if (sessionStatus === "running") return "running";
	if (sessionStatus === "paused") return "paused";

	return "idle";
}

type SessionItem = {
	count: number;
	lastUpdated: number;
	displayName: string;
};

type PriceCacheItem = {
	price: number | null;
	checkedAt: number;
};

type PriceCache = Record<string, PriceCacheItem>;

type SessionSettings = {
	showGpValue?: boolean;
};

type WeirdGloopLatestEntry = {
	price?: number;
};

type WeirdGloopLatestResponse = Record<string, WeirdGloopLatestEntry>;

type SessionWindowUpdateMode = "full" | "clock" | "items" | "prices";

type SessionRowElements = {
	row: HTMLTableRowElement;
	name: HTMLTableCellElement;
	count: HTMLTableCellElement;
	perHour: HTMLTableCellElement;
	value: HTMLTableCellElement;
	gpPerHour: HTMLTableCellElement;
};

const appName = "ResourceTracker";
const sessionSettingsKey = `${appName}_SessionSettings`;
const priceCacheKey = `${appName}_PriceCache`;
const priceCacheDurationMs = 24 * 60 * 60 * 1000;

let sessionStatus: SessionStatus = "idle";
let sessionStartedAt: number | null = null;
let activeStartedAt: number | null = null;
let elapsedBeforePauseMs = 0;

let sessionItems: Record<string, SessionItem> = {};
let sessionWindow: Window | null = null;
let sessionRefreshTimer: number | null = null;
let sessionUiOwner: Window | null = null;

let showGpValue = loadSessionSettings().showGpValue ?? false;

const pendingPriceLookups = new Set<string>();
const sessionRows = new Map<string, SessionRowElements>();

export function recordSessionUpdates(updates: SessionItemUpdate[]) {
	if (sessionStatus !== "running") return;
	if (updates.length === 0) return;

	const timestamp = Date.now();

	for (const update of updates) {
		const key = update.storageKey || update.item;
		if (!sessionItems[key]) {
			sessionItems[key] = {
				count: 0,
				lastUpdated: timestamp,
				displayName: update.item,
			};
		}

		sessionItems[key].count += update.amount;
		sessionItems[key].lastUpdated = timestamp;

		if (showGpValue) {
			void ensurePriceForItem(update.item);
		}
	}

	updateSessionWindow("items");
}

export function showSessionWindow() {
	if (!sessionWindow || sessionWindow.closed) {
		sessionWindow = window.open(
			"",
			"sessionWindow",
			"width=400,height=275"
		);
		sessionUiOwner = null;
		sessionRows.clear();
	}

	startSessionRefreshTimer();
	setTimeout(() => updateSessionWindow("full"), 50);
}

function toggleSession() {
	const now = Date.now();

	if (sessionStatus === "idle") {
		sessionStatus = "running";
		sessionStartedAt = now;
		activeStartedAt = now;
		elapsedBeforePauseMs = 0;
		sessionItems = {};

		if (showGpValue) {
			void ensurePricesForSessionItems();
		}

		updateSessionWindow("full");
		return;
	}

	if (sessionStatus === "running") {
		elapsedBeforePauseMs = getElapsedMs();
		activeStartedAt = null;
		sessionStatus = "paused";
		updateSessionWindow("full");
		return;
	}

	if (sessionStatus === "paused") {
		activeStartedAt = now;
		sessionStatus = "running";
		updateSessionWindow("full");
	}
}

function resetSession() {
	sessionStatus = "idle";
	sessionStartedAt = null;
	activeStartedAt = null;
	elapsedBeforePauseMs = 0;
	sessionItems = {};

	// No need to reset prices constantly, they hardly ever change.
	// Cached prices expire automatically after 24 hours.

	updateSessionWindow("full");
}

function updateShowGpValue(value: boolean) {
	showGpValue = value;

	saveSessionSettings({
		showGpValue,
	});

	if (showGpValue) {
		void ensurePricesForSessionItems();
	}

	updateSessionWindow("full");
}

function updateSessionWindow(mode: SessionWindowUpdateMode = "full") {
	if (!sessionWindow || sessionWindow.closed) return;

	const doc = sessionWindow.document;

	if (!doc.body) {
		setTimeout(() => updateSessionWindow(mode), 50);
		return;
	}

	const initializedNow = ensureSessionWindowUi(doc);
	const effectiveMode = initializedNow ? "full" : mode;

	updateSessionChrome(doc);
	updateSessionTotals(doc);
	syncSessionRows(doc, effectiveMode);
}

function ensureSessionWindowUi(doc: Document) {
	const alreadyInitialized =
		sessionUiOwner === sessionWindow &&
		Boolean(doc.getElementById("session-root"));

	if (alreadyInitialized) return false;

	doc.title = "Session Stats";
	doc.body.innerHTML = renderSessionWindowShellHtml();

	doc
		.getElementById("session-toggle")
		?.addEventListener("click", toggleSession);

	doc
		.getElementById("session-reset")
		?.addEventListener("click", resetSession);

	const showGpInput = doc.getElementById("show-gp-value") as HTMLInputElement | null;

	if (showGpInput) {
		showGpInput.addEventListener("change", function () {
			updateShowGpValue(this.checked);
		});
	}

	sessionUiOwner = sessionWindow;
	sessionRows.clear();
	return true;
}

function updateSessionChrome(doc: Document) {
	const toggleText =
		sessionStatus === "idle"
			? "Start Session"
			: sessionStatus === "running"
				? "Pause Session"
				: "Resume Session";

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
				: "Paused";

	setText(doc, "session-toggle", toggleText);
	setText(doc, "session-started", startedText);
	setText(doc, "session-status", statusText);
	setText(doc, "session-elapsed", formatElapsed(getElapsedMs()));

	const status = doc.getElementById("session-status");
	if (status) status.className = sessionStatus;

	const showGpInput = doc.getElementById("show-gp-value") as HTMLInputElement | null;
	if (showGpInput && showGpInput.checked !== showGpValue) {
		showGpInput.checked = showGpValue;
	}

	doc.body.classList.toggle("show-gp", showGpValue);
	setText(doc, "session-per-hour-heading", showGpValue ? "Per/hr" : "/hr");

	const totals = doc.getElementById("session-totals");
	if (totals) totals.hidden = !showGpValue;
}

function updateSessionTotals(doc: Document) {
	if (!showGpValue) return;

	const totals = getSessionValueTotals();
	const totalValueText = totals.hasLoadingPrices
		? "..."
		: formatGp(totals.totalValue);
	const totalGpPerHourText = totals.hasLoadingPrices
		? "..."
		: formatGp(totals.totalGpPerHour);

	setText(doc, "session-total-value", totalValueText);
	setText(doc, "session-total-gp-hour", totalGpPerHourText);
}

function syncSessionRows(doc: Document, mode: SessionWindowUpdateMode) {
	const orderedKeys = Object.keys(sessionItems).sort((a, b) =>
		sessionItems[b].lastUpdated - sessionItems[a].lastUpdated
	);
	const shouldReconcileStructure = mode === "full" || mode === "items";
	const activeKeys = new Set(orderedKeys);
	const tbody = doc.getElementById("session-items-body") as HTMLTableSectionElement | null;
	const table = doc.getElementById("session-items-table") as HTMLTableElement | null;
	const empty = doc.getElementById("session-empty");

	if (!tbody || !table || !empty) return;

	if (shouldReconcileStructure) {
		const removedKeys: string[] = [];
		sessionRows.forEach((elements, key) => {
			if (activeKeys.has(key)) return;
			elements.row.remove();
			removedKeys.push(key);
		});
		for (const key of removedKeys) {
			sessionRows.delete(key);
		}

		for (const key of orderedKeys) {
			const itemData = sessionItems[key];
			let elements = sessionRows.get(key);

			if (!elements) {
				elements = createSessionRow(doc);
				sessionRows.set(key, elements);
			}

			const renderedName = titleCase(itemData.displayName);
			elements.name.textContent = renderedName;
			elements.name.title = renderedName;
			elements.count.textContent = itemData.count.toLocaleString();

			// Appending an existing row only moves it when the recent-item order changed.
			tbody.appendChild(elements.row);
		}
	}

	const elapsedMs = getElapsedMs();
	const elapsedHours = elapsedMs > 0 ? elapsedMs / 3600000 : 0;

	for (const key of orderedKeys) {
		const elements = sessionRows.get(key);
		const itemData = sessionItems[key];
		if (!elements || !itemData) continue;

		const perHour = elapsedHours > 0
			? itemData.count / elapsedHours
			: 0;
		elements.perHour.textContent = formatPerHour(perHour);

		if (!showGpValue) continue;

		const price = getFreshCachedPrice(itemData.displayName);
		const totalValue = typeof price === "number"
			? itemData.count * price
			: null;
		const gpPerHour = totalValue !== null && elapsedHours > 0
			? totalValue / elapsedHours
			: null;

		elements.value.textContent = formatPriceValue(price, totalValue);
		elements.gpPerHour.textContent = formatGpPerHour(gpPerHour);
	}

	const hasItems = orderedKeys.length > 0;
	table.hidden = !hasItems;
	empty.hidden = hasItems;
}

function createSessionRow(doc: Document): SessionRowElements {
	const row = doc.createElement("tr");
	const name = doc.createElement("td");
	const count = doc.createElement("td");
	const perHour = doc.createElement("td");
	const value = doc.createElement("td");
	const gpPerHour = doc.createElement("td");

	name.className = "item-name";
	count.className = "number";
	perHour.className = "number";
	value.className = "number gp-column";
	gpPerHour.className = "number gp-column";

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

function startSessionRefreshTimer() {
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
			updateSessionWindow("clock");
		}
	}, 1000);
}

function renderSessionWindowShellHtml() {
	return `
		<style>
			html,
			body {
				margin: 0;
				min-height: 100%;
				background: #1e1e1e;
				color: #ddd;
				font-family: Arial, sans-serif;
				font-size: 12px;
			}

			::-webkit-scrollbar {width: 8px; height: 8px;}
			::-webkit-scrollbar-button {
				display: none;
				width: 0;
				height: 0;}
			::-webkit-scrollbar-thumb {
				min-height: 48px;
				border: 1px solid #161a1d;
				background: #9b7a36;}

			.session-wrap {
				box-sizing: border-box;
				min-height: 100vh;
				padding: 8px;
			}

			.session-controls {
				display: grid;
				grid-template-columns: 1fr 1fr;
				gap: 6px;
				margin-bottom: 8px;
			}

			button {
				height: 22px;
				box-sizing: border-box;
				font-size: 12px;
				color: #d8c58a;
				background: linear-gradient(#262626, #1e1e1e);
				border: 1px solid #4a4030;
				cursor: pointer;
				text-shadow: 0 1px 0 #000;
			}

			button:hover {
				color: #fff0bd;
				background: linear-gradient(#606060, #202020);
			}

			.separator {
				border-top: 2px solid #444;
			}

			.session-meta {
				border: 1px solid #444;
				background: #2c2c2c;
				padding: 6px;
				margin-bottom: 8px;
				line-height: 1.5;
			}

			.session-options {
				display: flex;
				align-items: center;
				gap: 5px;
				margin-top: 4px;
				color: #ccc;
				font-size: 11px;
			}

			.session-options input {
				margin: 0;
			}

			.session-totals {
				display: grid;
				grid-template-columns: 1fr 1fr;
				gap: 8px;
				border: 1px solid #444;
				background: #252525;
				padding: 6px;
				margin-bottom: 8px;
				font-size: 12px;
			}

			.session-totals[hidden] {
				display: none;
			}

			.session-total-value {
				color: #7CFC7C;
				font-weight: bold;
			}

			.session-total-gp {
				color: #d8c26a;
				font-weight: bold;
				text-align: right;
			}

			.section-title {
				color: #d8c26a;
				font-size: 11px;
				font-weight: bold;
				text-transform: uppercase;
				border-bottom: 1px solid #444;
				padding-bottom: 3px;
				margin-bottom: 5px;
			}

			table {
				width: 100%;
				border-collapse: collapse;
				table-layout: fixed;
			}

			table[hidden] {
				display: none;
			}

			th,
			td {
				padding: 3px 2px;
				border-bottom: 1px solid #333;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			th {
				color: #aaa;
				font-size: 10px;
				font-weight: normal;
				text-align: left;
			}

			td {
				font-size: 11px;
			}

			.item-name {
				width: 52%;
			}

			body.show-gp .item-name {
				width: 34%;
			}

			body:not(.show-gp) .gp-column {
				display: none;
			}

			.number {
				text-align: right;
			}

			.empty {
				color: #aaa;
				font-style: italic;
				padding: 8px 0;
			}

			.empty[hidden] {
				display: none;
			}

			.paused {
				color: #ffd700;
			}

			.running {
				color: #7CFC7C;
			}

			.idle {
				color: #aaa;
			}
		</style>

		<div id="session-root" class="session-wrap">
			<div class="session-controls">
				<button id="session-toggle">Start Session</button>
				<button id="session-reset">Reset Session</button>
			</div>

			<div class="session-meta">
				<div style="font-size: 12px; font-style: italic;">Session continues while this window is closed.</div>
				<div class="separator"></div>

				<div><strong>Session Started:</strong> <span id="session-started">—</span></div>
				<div><strong>Status:</strong> <span id="session-status" class="idle">Not running</span></div>
				<div><strong>Elapsed:</strong> <span id="session-elapsed">00:00:00</span></div>

				<label class="session-options">
					<input id="show-gp-value" type="checkbox">
					Show GP value
				</label>
			</div>

			<div id="session-totals" class="session-totals" hidden>
				<div>
					Total session value:
					<span id="session-total-value" class="session-total-value">0</span>
				</div>

				<div class="session-total-gp">
					Total GP/hr: <span id="session-total-gp-hour">0</span>
				</div>
			</div>

			<div class="section-title">Recent Session Items</div>
			<div id="session-empty" class="empty">No session items yet.</div>

			<table id="session-items-table" hidden>
				<thead>
					<tr>
						<th class="item-name">Item</th>
						<th class="number">Count</th>
						<th id="session-per-hour-heading" class="number">/hr</th>
						<th class="number gp-column">Value</th>
						<th class="number gp-column">GP/hr</th>
					</tr>
				</thead>
				<tbody id="session-items-body"></tbody>
			</table>
		</div>
	`;
}

function getSessionValueTotals() {
	const items = Object.keys(sessionItems);
	const elapsedMs = getElapsedMs();
	const elapsedHours = elapsedMs > 0 ? elapsedMs / 3600000 : 0;

	let totalValue = 0;
	let hasLoadingPrices = false;

	for (const item of items) {
		const price = getFreshCachedPrice(
			sessionItems[item].displayName
		);

		if (price === undefined) {
			hasLoadingPrices = true;
			continue;
		}

		if (typeof price !== "number") {
			continue;
		}

		totalValue += sessionItems[item].count * price;
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

function getElapsedMs() {
	if (!sessionStartedAt) return 0;

	if (sessionStatus === "running" && activeStartedAt) {
		return elapsedBeforePauseMs + (Date.now() - activeStartedAt);
	}

	return elapsedBeforePauseMs;
}

async function ensurePricesForSessionItems() {
	const items = Object.keys(sessionItems);

	for (const item of items) {
		await ensurePriceForItem(sessionItems[item].displayName);
	}
}

async function ensurePriceForItem(item: string) {
	const cacheKey = getItemCacheKey(item);

	if (isCoinsItem(item)) return;

	const cachedPrice = getFreshCachedPrice(item);

	if (cachedPrice !== undefined) return;
	if (pendingPriceLookups.has(cacheKey)) return;

	pendingPriceLookups.add(cacheKey);

	try {
		const price = await fetchItemPrice(item);
		const cache = loadPriceCache();

		cache[cacheKey] = {
			price,
			checkedAt: Date.now(),
		};

		savePriceCache(cache);
	} catch {
		const cache = loadPriceCache();

		cache[cacheKey] = {
			price: null,
			checkedAt: Date.now(),
		};

		savePriceCache(cache);
	} finally {
		pendingPriceLookups.delete(cacheKey);
		updateSessionWindow("prices");
	}
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

	const json = await response.json() as WeirdGloopLatestResponse;
	const firstResult = Object.values(json)[0];

	if (!firstResult || typeof firstResult.price !== "number") {
		return null;
	}

	return firstResult.price;
}

function getFreshCachedPrice(item: string): number | null | undefined {
	if (isCoinsItem(item)) return 1;

	const cache = loadPriceCache();
	const entry = cache[getItemCacheKey(item)];

	if (!entry) return undefined;

	const isFresh = Date.now() - entry.checkedAt < priceCacheDurationMs;

	if (!isFresh) return undefined;

	return entry.price;
}

function loadPriceCache(): PriceCache {
	const raw = localStorage.getItem(priceCacheKey);

	if (!raw) return {};

	try {
		return JSON.parse(raw) as PriceCache;
	} catch {
		return {};
	}
}

function savePriceCache(cache: PriceCache) {
	localStorage.setItem(priceCacheKey, JSON.stringify(cache));
}

function loadSessionSettings(): SessionSettings {
	const raw = localStorage.getItem(sessionSettingsKey);

	if (!raw) return {};

	try {
		return JSON.parse(raw) as SessionSettings;
	} catch {
		return {};
	}
}

function saveSessionSettings(settings: SessionSettings) {
	localStorage.setItem(sessionSettingsKey, JSON.stringify(settings));
}

function cleanItemNameForPrice(item: string) {
	return item
		.replace(/^﴾♦﴿\s*/, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

function getItemCacheKey(item: string) {
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

	return `${formatGp(value)}`;
}

function formatGp(value: number) {
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
