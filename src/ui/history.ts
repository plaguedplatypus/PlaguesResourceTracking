export type TrackedHistorySource = "chat" | "dialog";

export type TrackedHistoryEntry = {
	id: number;
	text: string;
	source: TrackedHistorySource;
};

export type HistoryAppendResult = {
	entry: TrackedHistoryEntry;
	evicted: TrackedHistoryEntry | null;
};

export class TrackedHistoryLog {
	private entries: TrackedHistoryEntry[] = [];
	private nextId = 1;

	constructor(private readonly maximum = 100) {}

	getAll(): readonly TrackedHistoryEntry[] {
		return this.entries;
	}

	add(
		text: string,
		source: TrackedHistorySource
	): HistoryAppendResult {
		const entry = {
			id: this.nextId++,
			text,
			source,
		};
		this.entries.push(entry);
		const evicted =
			this.entries.length > this.maximum
				? this.entries.shift() ?? null
				: null;
		return { entry, evicted };
	}

	clear(): boolean {
		if (this.entries.length === 0) return false;
		this.entries = [];
		return true;
	}
}

export type HistoryScrollState = {
	top: number;
	height: number;
};

export type HistoryListAdapter<Node> = {
	createRow(entry: TrackedHistoryEntry): Node;
	replaceAll(rows: readonly Node[]): void;
	prepend(row: Node): void;
	remove(row: Node): void;
	getScrollState(): HistoryScrollState;
	setScrollTop(top: number): void;
};

export class IncrementalHistoryRenderer<Node> {
	private readonly nodes = new Map<number, Node>();

	constructor(
		private readonly adapter: HistoryListAdapter<Node>,
		private readonly followTolerance = 8
	) {}

	renderInitial(entries: readonly TrackedHistoryEntry[]): void {
		this.nodes.clear();
		const rows = [...entries]
			.reverse()
			.map((entry) => {
				const row = this.adapter.createRow(entry);
				this.nodes.set(entry.id, row);
				return row;
			});
		this.adapter.replaceAll(rows);
	}

	append(entry: TrackedHistoryEntry): void {
		const before = this.adapter.getScrollState();
		const following = before.top <= this.followTolerance;
		const row = this.adapter.createRow(entry);
		this.nodes.set(entry.id, row);
		this.adapter.prepend(row);

		const after = this.adapter.getScrollState();
		this.adapter.setScrollTop(
			following
				? 0
				: before.top + Math.max(0, after.height - before.height)
		);
	}

	remove(id: number): void {
		const row = this.nodes.get(id);
		if (!row) return;
		this.adapter.remove(row);
		this.nodes.delete(id);
	}

	clear(): void {
		if (this.nodes.size === 0) return;
		this.nodes.clear();
		this.adapter.replaceAll([]);
	}

	getNode(id: number): Node | undefined {
		return this.nodes.get(id);
	}
}

const maxRecentHistory = 100;
const maxRecentProcessedMessages = 100;
const trackedHistory = new TrackedHistoryLog(maxRecentHistory);
const recentProcessedMessageKeys: string[] = [];
const recentProcessedMessageSet = new Set<string>();
const leadingTimestampRegex =
	/^\[\s*(\d{2})\s*:\s*(\d{2})\s*:\s*(\d{2})\s*\]/;

let historyWindow: Window | null = null;
let historyList: HTMLElement | null = null;
let historyRenderer: IncrementalHistoryRenderer<HTMLElement> | null = null;

export function hasProcessedChatMessage(chatLine: string): boolean {
	const candidate = chatLine.trim();
	if (recentProcessedMessageSet.has(candidate)) return true;

	const timestamp = getLeadingTimestamp(candidate);
	if (!timestamp) return false;

	return recentProcessedMessageKeys.some((processed) =>
		processed.length > candidate.length &&
		getLeadingTimestamp(processed) === timestamp &&
		processed.startsWith(candidate)
	);
}

export function rememberProcessedChatMessage(chatLine: string): void {
	const message = chatLine.trim();
	if (!message || recentProcessedMessageSet.has(message)) return;

	recentProcessedMessageKeys.push(message);
	recentProcessedMessageSet.add(message);
	if (
		recentProcessedMessageKeys.length >
		maxRecentProcessedMessages
	) {
		const oldKey = recentProcessedMessageKeys.shift();
		if (oldKey) recentProcessedMessageSet.delete(oldKey);
	}
}

function getLeadingTimestamp(chatLine: string): string | null {
	const match = chatLine.match(leadingTimestampRegex);
	return match
		? `${match[1]}:${match[2]}:${match[3]}`
		: null;
}

export function addTrackedHistoryEntry(
	text: string,
	source: TrackedHistorySource
): TrackedHistoryEntry {
	const { entry, evicted } = trackedHistory.add(text, source);
	const renderer = getOpenRenderer();
	if (renderer) {
		renderer.append(entry);
		if (evicted) renderer.remove(evicted.id);
	}
	return entry;
}

export function showChatHistory(): void {
	if (!historyWindow || historyWindow.closed) {
		historyWindow = window.open(
			"",
			"historyWindow",
			"width=350,height=450"
		);
		historyList = null;
		historyRenderer = null;
	}

	setTimeout(initializeHistoryWindow, 50);
}

export function clearTrackedHistory(): void {
	if (!trackedHistory.clear()) return;
	historyRenderer?.clear();
}

function getOpenRenderer(): IncrementalHistoryRenderer<HTMLElement> | null {
	if (
		!historyWindow ||
		historyWindow.closed ||
		!historyList?.isConnected
	) {
		historyList = null;
		historyRenderer = null;
		return null;
	}
	return historyRenderer;
}

function initializeHistoryWindow(): void {
	if (!historyWindow || historyWindow.closed) return;

	const doc = historyWindow.document;
	if (!doc.body) {
		setTimeout(initializeHistoryWindow, 50);
		return;
	}
	if (historyRenderer && historyList?.isConnected) return;

	const style = doc.createElement("style");
	style.textContent = `
		::-webkit-scrollbar {width: 8px; height: 8px;}
		::-webkit-scrollbar-button {
			display: none;
			width: 0;
			height: 0;}
		::-webkit-scrollbar-thumb {
			min-height: 48px;
			border: 1px solid #161a1d;
			background: #9b7a36;}
		.history-entry-dialog {color: #43bc9e;}
		.history-clear-button {
			height: 20px;
			box-sizing: border-box;
			padding: 2px 6px;
			color: #d8c58a;
			background: linear-gradient(#262626, #1e1e1e);
			border: 1px solid #4a4030;
			box-shadow:
				inset 1px 1px 0 rgba(255, 255, 255, 0.06),
				inset -1px -1px 0 rgba(0, 0, 0, 0.75);
			cursor: pointer;
			font-size: 10px;
			text-shadow: 0 1px 0 #000;}
		.history-clear-button:hover {
			color: #fff0bd;
			border-color: #9b7a36;}`;
	doc.head.replaceChildren(style);
	doc.title = "Resource Tracker History";

	doc.body.style.margin = "0";
	doc.body.style.background = "#1e1e1e";
	doc.body.style.color = "#ddd";
	doc.body.style.fontFamily = "Consolas, monospace";
	doc.body.style.display = "flex";
	doc.body.style.flexDirection = "column";
	doc.body.style.height = "100vh";

	const toolbar = doc.createElement("div");
	toolbar.style.display = "flex";
	toolbar.style.justifyContent = "flex-end";
	toolbar.style.padding = "4px";
	toolbar.style.borderBottom = "2px solid #444";
	toolbar.style.boxSizing = "border-box";

	const clearButton = doc.createElement("button");
	clearButton.textContent = "Clear Display";
	clearButton.className = "history-clear-button";
	clearButton.addEventListener("click", clearTrackedHistory);
	toolbar.append(clearButton);

	historyList = doc.createElement("div");
	historyList.className = "history-list";
	historyList.style.padding = "3px";
	historyList.style.whiteSpace = "pre-wrap";
	historyList.style.overflowY = "auto";
	historyList.style.flex = "1";
	historyList.style.boxSizing = "border-box";
	historyList.style.fontSize = "10px";

	doc.body.replaceChildren(toolbar, historyList);
	historyRenderer = new IncrementalHistoryRenderer(
		createHistoryDomAdapter(doc, historyList)
	);
	historyRenderer.renderInitial(trackedHistory.getAll());
}

function createHistoryDomAdapter(
	doc: Document,
	list: HTMLElement
): HistoryListAdapter<HTMLElement> {
	return {
		createRow(entry) {
			const row = doc.createElement("div");
			row.className = `history-entry history-entry-${entry.source}`;
			row.dataset.historyId = String(entry.id);
			row.textContent = entry.text;
			return row;
		},
		replaceAll(rows) {
			const fragment = doc.createDocumentFragment();
			fragment.append(...rows);
			list.replaceChildren(fragment);
		},
		prepend(row) {
			list.prepend(row);
		},
		remove(row) {
			row.remove();
		},
		getScrollState() {
			return {
				top: list.scrollTop,
				height: list.scrollHeight,
			};
		},
		setScrollTop(top) {
			list.scrollTop = top;
		},
	};
}
