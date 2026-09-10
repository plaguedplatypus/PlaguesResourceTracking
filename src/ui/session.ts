import "./settings.css";
import "./session.css";

export type SessionStatus = "idle" | "running" | "paused";

type ItemUpdate = {
	item: string;
	amount: number;
	storageKey?: string;
};

export function getSessionStatus(): SessionStatus {
	return sessionStatus;
}

type Item = {
	count: number;
	lastUpdated: number;
	displayName: string;
};

type CacheItem = {
	price: number | null;
	checkedAt: number;
};

type Cache = Record<string, CacheItem>;

type Settings = {
	showGpValue?: boolean;
};

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
const sessionSettingsKey = `${appName}_SessionSettings`;
const priceCacheKey = `${appName}_PriceCache`;
const priceCacheDurationMs = 24 * 60 * 60 * 1000;

let sessionStatus: SessionStatus = "idle";
let sessionStartedAt: number | null = null;
let activeStartedAt: number | null = null;
let elapsedBeforePauseMs = 0;

let sessionItems: Record<string, Item> = {};
let sessionWindow: Window | null = null;
let sessionRefreshTimer: number | null = null;
let sessionUiOwner: Window | null = null;

let showGpValue = loadSettings().showGpValue ?? false;

const pendingPrices = new Set<string>();
const sessionRows = new Map<string, RowElements>();

export function recordSessionUpdates(updates: ItemUpdate[]) {
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

	updateWindow("items");
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

	startRefreshTimer();
	setTimeout(() => updateWindow("full"), 50);
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
			void ensurePrices();
		}

		updateWindow("full");
		return;
	}

	if (sessionStatus === "running") {
		elapsedBeforePauseMs = getElapsedMs();
		activeStartedAt = null;
		sessionStatus = "paused";
		updateWindow("full");
		return;
	}

	activeStartedAt = now;
	sessionStatus = "running";
	updateWindow("full");
}

function resetSession() {
	sessionStatus = "idle";
	sessionStartedAt = null;
	activeStartedAt = null;
	elapsedBeforePauseMs = 0;
	sessionItems = {};

	// No need to reset prices constantly, they hardly ever change.
	// Cached prices expire automatically after 24 hours.

	updateWindow("full");
}

function requestReset(doc: Document): void {
	if (doc.querySelector(".tracker-confirmation-overlay")) return;

	const overlay = doc.createElement("div");
	overlay.className = "tracker-confirmation-overlay";

	const dialog = doc.createElement("section");
	dialog.className = "tracker-confirmation";
	dialog.setAttribute("role", "dialog");
	dialog.setAttribute("aria-modal", "true");
	dialog.setAttribute("aria-labelledby", "session-reset-confirmation-title");

	const title = doc.createElement("div");
	title.className = "tracker-confirmation-title";
	title.id = "session-reset-confirmation-title";
	title.textContent = "Reset Session?";

	const message = doc.createElement("div");
	message.className = "tracker-confirmation-message";
	message.textContent =
		"This will reset the timer and all current item statistics.";

	const actions = doc.createElement("div");
	actions.className = "tracker-confirmation-actions";

	const cancel = doc.createElement("button");
	cancel.type = "button";
	cancel.className = "tracker-confirmation-cancel";
	cancel.textContent = "Cancel";

	const confirm = doc.createElement("button");
	confirm.type = "button";
	confirm.className = "tracker-confirmation-confirm";
	confirm.textContent = "Reset";

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
		resetSession();
	});
	doc.addEventListener("keydown", onKeyDown);

	actions.append(cancel, confirm);
	dialog.append(title, message, actions);
	overlay.append(dialog);
	doc.body.append(overlay);
	cancel.focus();
}

function updateShowGpValue(value: boolean) {
	showGpValue = value;

	saveSettings({
		showGpValue,
	});

	if (showGpValue) {
	void ensurePrices();
	}

	updateWindow("full");
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
		?.addEventListener("click", toggleSession);

	doc
		.getElementById("session-reset")
		?.addEventListener("click", () => requestReset(doc));

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

function updateChrome(doc: Document) {
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

function updateTotals(doc: Document) {
	if (!showGpValue) return;

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
				elements = createRow(doc);
				sessionRows.set(key, elements);
			}

			const renderedName = titleCase(itemData.displayName);
			elements.name.textContent = renderedName;
			elements.name.title = renderedName;
			elements.count.textContent = itemData.count.toLocaleString();

			tbody.appendChild(elements.row);
		}
	}

	const elapsedMs = getElapsedMs();
	const elapsedHours = elapsedMs > 0 ? elapsedMs / 3600000 : 0;

	for (const key of orderedKeys) {
		const elements = sessionRows.get(key);
		const itemData = sessionItems[key];
		if (!elements) continue;

		const perHour = elapsedHours > 0
			? itemData.count / elapsedHours
			: 0;
		elements.perHour.textContent = formatPerHour(perHour);

		if (!showGpValue) continue;

		const price = getCachedPrice(itemData.displayName);
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
				<button id="session-reset">Reset</button>
			</div>

			<div class="session-meta">
				<div class="session-note">Continues while this window is closed.</div>
				<div class="session-separator"></div>

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
						<th id="session-per-hour-heading" class="session-number">/hr</th>
						<th class="session-number gp-column">Value</th>
						<th class="session-number gp-column">GP/hr</th>
					</tr>
				</thead>
				<tbody id="session-items-body"></tbody>
			</table>
		</div>
	`;
}

function getValueTotals() {
	const items = Object.keys(sessionItems);
	const elapsedMs = getElapsedMs();
	const elapsedHours = elapsedMs > 0 ? elapsedMs / 3600000 : 0;

	let totalValue = 0;
	let hasLoadingPrices = false;

	for (const item of items) {
		const price = getCachedPrice(
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

async function ensurePrices() {
	const items = Object.keys(sessionItems);

	for (const item of items) {
		await ensurePriceForItem(sessionItems[item].displayName);
	}
}

async function ensurePriceForItem(item: string) {
	const cacheKey = getItemCacheKey(item);

	if (isCoinsItem(item)) return;

	const cachedPrice = getCachedPrice(item);

	if (cachedPrice !== undefined) return;
	if (pendingPrices.has(cacheKey)) return;

	pendingPrices.add(cacheKey);

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
		pendingPrices.delete(cacheKey);
		updateWindow("prices");
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

	const json = await response.json() as LatestResponse;
	const firstResult = Object.values(json)[0];

	if (!firstResult || typeof firstResult.price !== "number") {
		return null;
	}

	return firstResult.price;
}

function getCachedPrice(item: string): number | null | undefined {
	if (isCoinsItem(item)) return 1;

	const cache = loadPriceCache();
	const entry = cache[getItemCacheKey(item)];

	if (!entry) return undefined;

	const isFresh = Date.now() - entry.checkedAt < priceCacheDurationMs;

	if (!isFresh) return undefined;

	return entry.price;
}

function loadPriceCache(): Cache {
	const raw = localStorage.getItem(priceCacheKey);

	if (!raw) return {};

	try {
		return JSON.parse(raw) as Cache;
	} catch {
		return {};
	}
}

function savePriceCache(cache: Cache) {
	localStorage.setItem(priceCacheKey, JSON.stringify(cache));
}

function loadSettings(): Settings {
	const raw = localStorage.getItem(sessionSettingsKey);

	if (!raw) return {};

	try {
		return JSON.parse(raw) as Settings;
	} catch {
		return {};
	}
}

function saveSettings(settings: Settings) {
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

	return formatGp(value);
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
