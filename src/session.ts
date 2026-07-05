
// setting up the session window for you stats and money weirdos

export type SessionStatus = "idle" | "running" | "paused";

export type SessionItemUpdate = {
	item: string;
	amount: number;
};

export function getSessionStatus(): SessionStatus {
	if (sessionStatus === "running") return "running";
	if (sessionStatus === "paused") return "paused";

	return "idle";
}

type SessionItem = {
	count: number;
	lastUpdated: number;
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

let showGpValue = loadSessionSettings().showGpValue ?? false;

const pendingPriceLookups = new Set<string>();

export function recordSessionUpdates(updates: SessionItemUpdate[]) {
	if (sessionStatus !== "running") return;
	if (updates.length === 0) return;

	const timestamp = Date.now();

	for (const update of updates) {
		if (!sessionItems[update.item]) {
			sessionItems[update.item] = {
				count: 0,
				lastUpdated: timestamp,
			};
		}

		sessionItems[update.item].count += update.amount;
		sessionItems[update.item].lastUpdated = timestamp;

		if (showGpValue) {
			void ensurePriceForItem(update.item);
		}
	}

	updateSessionWindow();
}

export function showSessionWindow() {
	if (!sessionWindow || sessionWindow.closed) {
		sessionWindow = window.open(
			"",
			"sessionWindow",
			"width=400,height=275"
		);
	}

	startSessionRefreshTimer();
	setTimeout(updateSessionWindow, 50);
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

		updateSessionWindow();
		return;
	}

	if (sessionStatus === "running") {
		elapsedBeforePauseMs = getElapsedMs();
		activeStartedAt = null;
		sessionStatus = "paused";
		updateSessionWindow();
		return;
	}

	if (sessionStatus === "paused") {
		activeStartedAt = now;
		sessionStatus = "running";
		updateSessionWindow();
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

	updateSessionWindow();
}

function updateShowGpValue(value: boolean) {
	showGpValue = value;

	saveSessionSettings({
		showGpValue,
	});

	if (showGpValue) {
		void ensurePricesForSessionItems();
	}

	updateSessionWindow();
}

function updateSessionWindow() {
	if (!sessionWindow || sessionWindow.closed) return;

	const doc = sessionWindow.document;

	if (!doc.body) {
		setTimeout(updateSessionWindow, 50);
		return;
	}

	doc.title = "Session Stats";
	doc.body.innerHTML = renderSessionWindowHtml();

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
}

function startSessionRefreshTimer() {
	if (sessionRefreshTimer !== null) return;

	sessionRefreshTimer = window.setInterval(() => {
		if (!sessionWindow || sessionWindow.closed) {
			if (sessionRefreshTimer !== null) {
				window.clearInterval(sessionRefreshTimer);
				sessionRefreshTimer = null;
			}

			return;
		}

		if (sessionStatus === "running") {
			updateSessionWindow();
		}
	}, 1000);
}

function renderSessionWindowHtml() {
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
				width: ${showGpValue ? "34%" : "52%"};
			}

			.number {
				text-align: right;
			}

			.empty {
				color: #aaa;
				font-style: italic;
				padding: 8px 0;
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

		<div class="session-wrap">
			<div class="session-controls">
				<button id="session-toggle">${toggleText}</button>
				<button id="session-reset">Reset Session</button>
			</div>

			<div class="session-meta">
				<div style="font-size: 12px; font-style: italic;">Session continues while this window is closed.</div>
				<div class="separator"></div>

				<div><strong>Session Started:</strong> ${startedText}</div>
				<div><strong>Status:</strong> <span class="${sessionStatus}">${statusText}</span></div>
				<div><strong>Elapsed:</strong> ${formatElapsed(getElapsedMs())}</div>

				<label class="session-options">
					<input id="show-gp-value" type="checkbox" ${showGpValue ? "checked" : ""}>
					Show GP value
				</label>
			</div>

			${renderSessionTotalsHtml()}

			<div class="section-title">Recent Session Items</div>

			${renderSessionItemsHtml()}
		</div>
	`;
}

function renderSessionTotalsHtml() {
	if (!showGpValue) return "";

	const totals = getSessionValueTotals();

	const totalValueText = totals.hasLoadingPrices
		? "..."
		: formatGp(totals.totalValue);

	const totalGpPerHourText = totals.hasLoadingPrices
		? "..."
		: `${formatGp(totals.totalGpPerHour)}`;

	return `
		<div class="session-totals">
			<div>
				Total session value:
				<span class="session-total-value">${totalValueText}</span>
			</div>

			<div class="session-total-gp">
				Total GP/hr: ${totalGpPerHourText}
			</div>
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
		const price = getFreshCachedPrice(item);

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

function renderSessionItemsHtml() {
	const items = Object.keys(sessionItems).sort((a, b) =>
		sessionItems[b].lastUpdated - sessionItems[a].lastUpdated
	);

	if (items.length === 0) {
		return `<div class="empty">No session items yet.</div>`;
	}

	const elapsedMs = getElapsedMs();
	const elapsedHours = elapsedMs > 0 ? elapsedMs / 3600000 : 0;

	const header = showGpValue
		? `
			<tr>
				<th class="item-name">Item</th>
				<th class="number">Count</th>
				<th class="number">Per/hr</th>
				<th class="number">Value</th>
				<th class="number">GP/hr</th>
			</tr>
		`
		: `
			<tr>
				<th class="item-name">Item</th>
				<th class="number">Count</th>
				<th class="number">/hr</th>
			</tr>
		`;

	const rows = items
		.map((item) => {
			const itemData = sessionItems[item];
			const perHour = elapsedHours > 0
				? itemData.count / elapsedHours
				: 0;

			if (!showGpValue) {
				return `
					<tr>
						<td class="item-name" title="${escapeAttr(titleCase(item))}">
							${escapeHtml(titleCase(item))}
						</td>
						<td class="number">${itemData.count.toLocaleString()}</td>
						<td class="number">${formatPerHour(perHour)}</td>
					</tr>
				`;
			}

			const price = getFreshCachedPrice(item);
			const totalValue = typeof price === "number"
				? itemData.count * price
				: null;

			const gpPerHour = totalValue !== null && elapsedHours > 0
				? totalValue / elapsedHours
				: null;

			return `
				<tr>
					<td class="item-name" title="${escapeAttr(titleCase(item))}">
						${escapeHtml(titleCase(item))}
					</td>
					<td class="number">${itemData.count.toLocaleString()}</td>
					<td class="number">${formatPerHour(perHour)}</td>
					<td class="number">${formatPriceValue(price, totalValue)}</td>
					<td class="number">${formatGpPerHour(gpPerHour)}</td>
				</tr>
			`;
		})
		.join("");

	return `
		<table>
			<thead>${header}</thead>
			<tbody>${rows}</tbody>
		</table>
	`;
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
		await ensurePriceForItem(item);
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
		updateSessionWindow();
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

function escapeHtml(value: string) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function escapeAttr(value: string) {
	return escapeHtml(value);
}
