type HistoryFilter = "all" | "counted" | "ignored";

const maxRecentHistory = 100;

let recentLines: string[] = [];
let recentLineKeys: string[] = [];
const recentLineSet = new Set<string>();

let historyWindow: Window | null = null;
let historyPre: HTMLPreElement | null = null;
let historyFilter: HistoryFilter = "all";

export function isInHistory(chatLine: string) {
	return recentLineSet.has(chatLine);
}

// Add a new chat line to the history
export function updateChatHistory(chatLine: string, debugStatus: string) {
	const debugLine = `${chatLine} ${debugStatus}`;

	recentLines.push(debugLine);
	recentLineKeys.push(chatLine);
	recentLineSet.add(chatLine);

	if (recentLines.length > maxRecentHistory) {
		recentLines.shift();
	}

	if (recentLineKeys.length > maxRecentHistory) {
		const oldKey = recentLineKeys.shift();

		if (oldKey) {
			recentLineSet.delete(oldKey);
		}
	}

	updateHistoryWindow();
}

// Showing recent chat history
export function showChatHistory() {
	if (!historyWindow || historyWindow.closed) {
		historyWindow = window.open(
			"",
			"historyWindow",
			"width=350,height=450"
		);

		historyPre = null;
	}

	setTimeout(updateHistoryWindow, 50);
}

function isHistoryLineVisible(line: string) {
	if (historyFilter === "all") return true;

	const upper = line.toUpperCase();

	if (historyFilter === "counted") {
		return upper.includes("[COUNTED") || upper.includes("[DIALOG COUNTED");
	}

	if (historyFilter === "ignored") {
		return upper.includes("[IGNORED");
	}

	return true;
}

function clearHistoryWindowDisplay() {
	recentLines = [];
	updateHistoryWindow();
}

function renderHistoryLine(line: string) {
	const match = line.match(
		/^(.*?)(\s+\[(?:DIALOG COUNTED|COUNTED|IGNORED)[^\]]*\])$/i
	);

	if (!match) {
		return escapeHtml(line);
	}

	const message = match[1];
	const tag = match[2].trim();

	return `${escapeHtml(message)} <span class="${getHistoryTagClass(tag)}">${escapeHtml(tag)}</span>`;
}

function getHistoryTagClass(tag: string) {
	const normalized = tag.toUpperCase();

	if (normalized.startsWith("[DIALOG COUNTED")) {
		return "history-tag history-tag-dialog-counted";
	}

	if (normalized.startsWith("[COUNTED")) {
		return "history-tag history-tag-counted";
	}

	if (normalized.startsWith("[IGNORED")) {
		return "history-tag history-tag-ignored";
	}

	return "history-tag";
}

function updateHistoryWindow() {
	if (!historyWindow || historyWindow.closed) return;

	const doc = historyWindow.document;

	if (!doc.body) {
		setTimeout(updateHistoryWindow, 50);
		return;
	}

	if (!doc.body.dataset.initialized) {
		const style = doc.createElement("style");
		style.textContent = `
			.history-tag {font-weight: bold;}
			.history-tag-counted {color: #7CFC7C;}
			.history-tag-dialog-counted {color: #43bc9e;}
			.history-tag-ignored {color: #b36b6b;}
			.history-filter-button,
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
				text-shadow: 0 1px 0 #000;
			}
			.history-filter-button:hover,
			.history-clear-button:hover {
				color: #fff0bd;
				border-color: #9b7a36;
			}
			.history-filter-button.active {
				color: #fff2aa;
				border-color: #d9a441;
				background: linear-gradient(#4a3518, #20170c);
			}`;
		doc.head.appendChild(style);
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
		toolbar.style.justifyContent = "space-between";
		toolbar.style.alignItems = "center";
		toolbar.style.padding = "4px";
		toolbar.style.borderBottom = "2px solid #444";
		toolbar.style.boxSizing = "border-box";

		const filterBar = doc.createElement("div");
		filterBar.style.display = "flex";
		filterBar.style.gap = "3px";

		const createHistoryFilterButton = (label: string, value: HistoryFilter) => {
			const button = doc.createElement("button");
			button.textContent = label;
			button.className = "history-filter-button";

			if (historyFilter === value) {
				button.classList.add("active");
			}

			button.addEventListener("click", function () {
				historyFilter = value;

				doc.querySelectorAll(".history-filter-button").forEach((filterButton) => {
					const filterButtonElement = filterButton as HTMLButtonElement;

					filterButtonElement.classList.toggle(
						"active",
						filterButtonElement.textContent?.toLowerCase() === value
					);
				});

				updateHistoryWindow();
			});

			return button;
		};

		filterBar.append(
			createHistoryFilterButton("All", "all"),
			createHistoryFilterButton("Counted", "counted"),
			createHistoryFilterButton("Ignored", "ignored")
		);

		const historyClearButton = doc.createElement("button");
		historyClearButton.textContent = "Clear Display";
		historyClearButton.className = "history-clear-button";

		historyClearButton.addEventListener("click", clearHistoryWindowDisplay);

		toolbar.append(filterBar, historyClearButton);

		historyPre = doc.createElement("pre");
		historyPre.style.margin = "0";
		historyPre.style.padding = "3px";
		historyPre.style.whiteSpace = "pre-wrap";
		historyPre.style.overflowY = "auto";
		historyPre.style.flex = "1";
		historyPre.style.boxSizing = "border-box";
		historyPre.style.fontSize = "10px";

		doc.body.replaceChildren(toolbar, historyPre);
		doc.body.dataset.initialized = "true";
	}

	if (!historyPre) return;

	historyPre.innerHTML = [...recentLines]
		.reverse()
		.filter(isHistoryLineVisible)
		.map(renderHistoryLine)
		.join("\n");
}

function escapeHtml(value: string) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}
