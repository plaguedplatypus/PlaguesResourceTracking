import * as a1lib from "alt1/base";
import ChatboxReader from "alt1/chatbox";
import DialogReader from "alt1/dialog";
import {
	setupInventionNudges,
	processInventionMaterials,
} from "./invention";
import {
	recordSessionUpdates,
	showSessionWindow,
} from "./session";

import "./index.html";
import "./appconfig.json";
import "./css/style.css";

type SkillType =
	| "all"
	| "mining"
	| "woodcutting"
	| "fishing"
	| "archaeology"
	| "seren"
	| "invention";

type InternalSkillType = SkillType | "other";

type TrackedItem = {
	count: number;
	goal: number | null;
	settingsOpen: boolean;
	skill?: InternalSkillType;
	source?: string;
	colorClass?: string;
	lastUpdated?: number;
};

type ItemUpdate = {
	item: string;
	amount: number;
	skill: InternalSkillType;
	colorClass?: string;
	source?: string;
};

type HistoryFilter = "all" | "counted" | "ignored";
type InventionFilter = "all" | "ancient" | "rare" | "uncommon" | "common";
type SortMode = "recent" | "alpha" | "count";

type SaveData = {
	chat?: string;
	activeTab?: InternalSkillType;
	fishingUsePorters?: boolean;
	sortMode?: SortMode;
	items: Record<string, TrackedItem>;
};

type ChatboxPosition = NonNullable<ChatboxReader["pos"]>;

const appName = "ResourceTracker";
const appColor = a1lib.mixColor(67, 188, 188);

const maxRecentHistory = 100;

const timestampRegex = /\[\d{2}:\d{2}:\d{2}\]/g;
const timestampLineRegex = /\[\d{2}:\d{2}:\d{2}\]/;

const appCog = document.querySelector(".app-cog") as HTMLElement;
const appSettingsPanel = document.querySelector(".app-settings-panel") as HTMLElement;

const chatSelector = document.querySelector(".chat") as HTMLSelectElement;
const findChatButton = document.querySelector(".find-chat") as HTMLElement;

const historyButton = document.querySelector(".history-button") as HTMLElement;
const exportButton = document.querySelector(".export") as HTMLElement;
const importInput = document.querySelector(".import") as HTMLInputElement;
const sessionButton = document.querySelector(".session-button") as HTMLElement;
const clearButton = document.querySelector(".clear") as HTMLElement;

const tracker = document.querySelector(".tracker") as HTMLElement;
const status = document.querySelector(".status") as HTMLElement;
const sortButton = document.querySelector(".sort-button") as HTMLElement;

const fishingMode = document.querySelector(".fishing-mode") as HTMLElement;
const fishingPortersInput = document.querySelector(".fishing-porters") as HTMLInputElement;

const inventionFilters = document.querySelector(".invention-filters") as HTMLElement;
const inventionFilterButton = document.querySelector(".invention-filter-cycle") as HTMLElement;

const savedData = getSaveData();

let inventionFilter: InventionFilter = "all";
let activeSkillTab: SkillType = "all";
let sortMode: SortMode = "recent";
let fishingUsePorters = true;
let historyWindow: Window | null = null;
let historyPre: HTMLPreElement | null = null;
let historyFilter: HistoryFilter = "all";
let reader = createChatReader();

const dialogReader = new DialogReader();

function createChatReader() {
	const newReader = new ChatboxReader();
	newReader.readargs.colors.push(
		// anti aliasing sucks. These colors Alt1 does not have.
		a1lib.mixColor(51, 197, 20), // faded Green messages
		a1lib.mixColor(59, 181, 20), // Green messages
		a1lib.mixColor(59, 181, 30), // Other Green messages

		a1lib.mixColor(232, 47, 47), // pinkish red messages
		a1lib.mixColor(190, 15, 6), // dark red messages

		a1lib.mixColor(252, 140, 56), // broadcasts we don't need
		a1lib.mixColor(245, 135, 55), // broadcasts we don't need

		a1lib.mixColor(252, 174, 0), // Orange actions
		a1lib.mixColor(253, 127, 0), // uncommon components
		a1lib.mixColor(67, 188, 188), // Cotton candy? or ancient?

		a1lib.mixColor(161, 53, 235), // what's this? Purple
		a1lib.mixColor(51, 101, 252), // A random blue as entered the room
	);

	setupInventionNudges(newReader);

	return newReader;
}

window.setTimeout(function () {
	if (!window.alt1) {
		render();
		return;
	}

	reader.find();

	const findChat = setInterval(function () {
		if (reader.pos === null) {
			reader.find();
			status.innerText = "Looking for chatbox...";
			return;
		}

		clearInterval(findChat);
		populateChatSelector();
		selectSavedChat();
		showSelectedChat(reader.pos);
		status.innerText = "Chat found. Tracking started.";
		render();

		setInterval(function () {
			try {
				readChatbox();
				readDialogBox();
			} catch (error) {
				console.warn("Tracker read failed", error);
				status.innerText = "Tracking read failed. Click Find Chat if tracking stopped.";
			}
		}, 600);
	}, 1000);
}, 50);

if (window.alt1) {
	alt1.identifyAppUrl("./appconfig.json");
} else {
	const addappurl = `alt1://addapp/${new URL("./appconfig.json", document.location.href).href}`;
	status.innerHTML = `Alt1 not detected. <a href='${addappurl}'>Add this app to Alt1</a>`;
}

function populateChatSelector() {
	if (!reader.pos) return;

	chatSelector.innerHTML = `<option value="">Select Chat</option>`;

	reader.pos.boxes.forEach((_box, i) => {
		chatSelector.insertAdjacentHTML("beforeend", `<option value="${i}">Chat ${i}</option>`);
	});

	chatSelector.onchange = function () {
		if (chatSelector.value === "") return;
		if (!reader.pos) return;

		reader.pos.mainbox = reader.pos.boxes[Number(chatSelector.value)];
		showSelectedChat(reader.pos);

		const data = getSaveData();
		data.chat = chatSelector.value;
		saveData(data);

		status.innerText = `Using Chat ${chatSelector.value}.`;
	};
}

function selectSavedChat() {
	if (!reader.pos) return;

	const data = getSaveData();
	const savedChat = data.chat || "0";

	reader.pos.mainbox = reader.pos.boxes[Number(savedChat)] || reader.pos.boxes[0];
	chatSelector.value = savedChat;

	data.chat = savedChat;
	saveData(data);
}

let activeDialogFindText = "";
let lastDialogSeenAt = 0;
let dialogReadFailCount = 0;
const maxDialogReadFails = 3;
const dialogGoneResetMs = 3000;
const damagedArtifactDuplicateWindowMs = 3000;
const recentDamagedArtifactCounts = new Map<string, number>();

function readDialogBox() {
	if (!window.alt1) return;

	const now = Date.now();

	if (!dialogReader.pos) {
		dialogReader.find();

		if (!dialogReader.pos) {
			return;
		}
	}

	const dialog = dialogReader.read();

	if (!dialog || !dialog.text || dialog.text.length === 0) {
		dialogReadFailCount++;

		if (dialogReadFailCount >= maxDialogReadFails) {
			dialogReader.pos = null;
			dialogReadFailCount = 0;
		}

		if (now - lastDialogSeenAt > dialogGoneResetMs) {
			activeDialogFindText = "";
		}

		return;
	}

	dialogReadFailCount = 0;

	const fullText = dialog.text.join(" ").replace(/\s+/g, " ").trim();

	lastDialogSeenAt = now;

	const match = fullText.match(/^You find:\s*(.+?\(damaged\))[!.]?$/i);

	if (!match) {
		return;
	}

	if (fullText === activeDialogFindText) {
		return;
	}

	activeDialogFindText = fullText;

	const item = normalizeItemName(match[1]);
	if (!item) return;

	if (!registerDamagedArtifactCount(item)) {
		return;
	}

	incrementItem(item, 1, "archaeology");
	setStatus(`Added: ${item}`);

	updateChatHistory(fullText, `[DIALOG COUNTED: ${item} +1]`);
}

function readChatbox() {
	const opts = reader.read() || [];

	const chatArr = processChat(opts);

	for (const chatLine of chatArr) {
		const historyKey = chatLine.trim();
		if (!historyKey) continue;

		if (isInHistory(historyKey)) continue;

		const debugStatus = processHarvestLine(chatLine);
		if (debugStatus === null) {
			updateChatHistory(historyKey, "[IGNORED]");
			continue;
		}
		updateChatHistory(historyKey, debugStatus);
	}
}

function processChat(opts: Array<{ text: string }>) {
	let chatStr = "";

	for (let index = 0; index < opts.length; index++) {
		const text = opts[index].text;
		const hasTimestamp = timestampLineRegex.test(text);

		if (!hasTimestamp && index === 0) {
			continue;
		}

		if (hasTimestamp) {
			if (index > 0) chatStr += "\n";
			chatStr += text + " ";
			continue;
		}

		chatStr += text + " ";
	}

	if (chatStr.trim() === "") return [];

	return chatStr
		.replace(/(\d) x x/g, "$1 x")
		.split("\n");
}

function getTimeStamp() {
	return new Date().toLocaleTimeString("en-US", {
		hour12: false,
	});
}

// Update the status message in the footer with a timestamp on when events occurred
function setStatus(message: string) {
	status.innerText = `${message} @ ${getTimeStamp()}`;
}

// Activate the saved fishing porters setting or default to true if not set
const savedActiveTab = savedData.activeTab as string | undefined;
activeSkillTab =
	savedActiveTab === "other"
		? "all"
		: ((savedData.activeTab || "all") as SkillType);
fishingUsePorters = savedData.fishingUsePorters ?? true;
sortMode = savedData.sortMode || "recent";

// Set initial state of fishing porters checkbox based on saved data
if (fishingPortersInput) {
	fishingPortersInput.checked = fishingUsePorters;
}

// Set initial sort button label
document.querySelectorAll(".skill-tab").forEach((btn) => {
	btn.classList.remove("active");
});

// History window
function isHistoryLineVisible(line: string) {
	if (historyFilter === "all") return true;

	const upper = line.toUpperCase();

	if (historyFilter === "counted") {
		return upper.includes("[COUNTED") || upper.includes("[DIALOG COUNTED");
	}

	if (historyFilter === "ignored") {
		return upper.includes("[IGNORED") || upper.includes("[SKIPPED DUPLICATE");
	}

	return true;
}

function clearHistoryWindowDisplay() {
	recentLines = [];
	updateHistoryWindow();
}

function renderHistoryLine(line: string) {
	const match = line.match(
		/^(.*?)(\s+\[(?:DIALOG COUNTED|COUNTED|IGNORED|SKIPPED DUPLICATE)[^\]]*\])$/i
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

	if (normalized.startsWith("[SKIPPED DUPLICATE")) {
		return "history-tag history-tag-skipped";
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
			.history-tag-skipped {color: #d8c58a;}
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

// Showing recent chat history
function showChatHistory() {
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

// Toggles/Buttons inside tabs
// Show/hide fishing mode based on active tab
function updateFishingModeVisibility() {
	if (!fishingMode) return;

	if (activeSkillTab === "fishing") {
		fishingMode.classList.add("visible");
	} else {
		fishingMode.classList.remove("visible");
	}
}

// Hide invention filters when not on invention tab
function updateInventionFilterVisibility() {
	if (!inventionFilters) return;

	if (activeSkillTab === "invention") {
		inventionFilters.classList.add("visible");
	} else {
		inventionFilters.classList.remove("visible");
	}
}

// Invention filter button handlers
function updateInventionFilterButton() {
	if (!inventionFilterButton) return;

	inventionFilterButton.innerText =
		inventionFilter === "all"
			? "Filter: All"
			: inventionFilter === "ancient"
				? "Filter: Ancient"
				: inventionFilter === "rare"
					? "Filter: Rare"
					: inventionFilter === "uncommon"
						? "Filter: Uncommon"
						: "Filter: Common";
}

inventionFilterButton?.addEventListener("click", () => {
	inventionFilter =
		inventionFilter === "all"
			? "ancient"
			: inventionFilter === "ancient"
				? "rare"
				: inventionFilter === "rare"
					? "uncommon"
					: inventionFilter === "uncommon"
						? "common"
						: "all";

	updateInventionFilterButton();
	render();
});

// Activate the saved skill tab or default to "all"
const savedTabButton = document.querySelector(
	`.skill-tab[data-skill="${activeSkillTab}"]`
);

// If the saved active tab is "other", default to "all", how old is that save file?
if (savedTabButton) {
	savedTabButton.classList.add("active");
}

updateFishingModeVisibility();
updateInventionFilterButton();
updateInventionFilterVisibility();
updateSortButtonLabel();
updateClearButtonLabel();
render();

// List of rare Seren spirit items that should be highlighted in the tracker.
// We both know you'll never see them
const rareSerenItems = new Set([
	"hazelmere's signet ring",
	"blurberry special", // maybe this one, about 15 times.
	"cheese+tom batta" // should have been wearing that ring...
]);

const skillPatterns: Array<{
	pattern: RegExp;
	skill: SkillType;
}> = [
		{ pattern: /You get some\s+(.+?)[!.]/i, skill: "woodcutting" },
		{ pattern: /You find (?:a|an)\s+((?:enchanted\s+)?bird's nest)(?:[.!]|\s+You pick it up\b|$)/i, skill: "woodcutting" },
		{ pattern: /You find (?:a|an)\s+(eternal magic tree branch)[!.]/i, skill: "woodcutting" },
		{ pattern: /You catch (?:a|an|some)\s+(.+?)\./i, skill: "fishing" },
		{ pattern: /^You find:\s*(.+?\(damaged\))[!.]?$/i, skill: "archaeology" },
		{ pattern: /You find some\s+(.+?)[!.]/i, skill: "archaeology" },
	];

// Process a single chat line to check for harvesting events
function processHarvestLine(chatLine: string): string | null {
	const cleanLine = chatLine.replace(timestampRegex, "").trim();

	// Check for Seren spirit's
	const serenMatch = cleanLine.match(
		/The Seren spirit gifts you:\s*(\d+)\s*x\s*(.+?)\./i
	);

	if (serenMatch) {
		const amount = parseInt(serenMatch[1], 10);
		const normalizedItem = normalizeItemName(serenMatch[2]);

		if (!normalizedItem || isNaN(amount)) return "[IGNORED]";

		const item = "﴾♦﴿ " + normalizedItem;

		const colorClass = rareSerenItems.has(normalizedItem)
			? "seren-item-rare"
			: "seren-item";

		incrementItem(item, amount, "seren", colorClass, "seren-spirit");
		setStatus(`﴾♦﴿: ${amount} x ${item}`);

		return `[COUNTED: ${item} +${amount}]`;
	}

	// Invention materials
	const inventionResult =
		processInventionMaterials(cleanLine);

	if (inventionResult) {
		if (inventionResult.updates.length === 0) {
			return "[IGNORED]";
		}

		incrementItems(
			inventionResult.updates,
			inventionResult.updates[
				inventionResult.updates.length - 1
			].item
		);

		setStatus(inventionResult.statusMessage);

		return `[COUNTED: ${inventionResult.countedMaterials.join(", ")}]`;
	}

	// GOTE / Porters / Perks in those lines?
	// Check for item/perk transports
	const transportMatch = cleanLine.match(
		/(?:You transport|sent it|transports your items) to your\s+(.+?):\s*(?:(\d+)\s*x\s*)?([\s\S]+?)\.?$/i
	);

	if (transportMatch) {
		const destination = transportMatch[1].toLowerCase();

		const amount = transportMatch[2]
			? parseInt(transportMatch[2], 10)
			: 1;

		const item = normalizeItemName(transportMatch[3]);

		if (!item || isNaN(amount)) return "[IGNORED]";

		let skill: InternalSkillType = "other";

		if (destination.includes("metal bank")) {
			skill = "mining";
		} else if (destination.includes("material storage")) {
			skill = "archaeology";
		} else if (destination.includes("bank")) {
			skill = getSkillForItem(item);
		}

		if (skill === "fishing" && !fishingUsePorters) {
			return null;
		}

		if (skill === "archaeology" && !registerDamagedArtifactCount(item)) {
			return `[SKIPPED DUPLICATE: ${item}]`;
		}

		incrementItem(item, amount, skill);
		setStatus(`Added: ${amount} x ${item}`);

		return `[COUNTED: ${item} +${amount}]`;
	}

	// Checking for mining, woodcutting, fishing, and archaeology skill patterns
	for (const entry of skillPatterns) {
		const match = cleanLine.match(entry.pattern);
		if (!match) continue;

		if (entry.skill === "fishing" && fishingUsePorters) {
			continue;
		}

		const item = normalizeItemName(match[1]);
		if (!item) return "[IGNORED]";

		if (entry.skill === "archaeology" && !registerDamagedArtifactCount(item)) {
			return `[SKIPPED DUPLICATE: ${item}]`;
		}

		incrementItem(item, 1, entry.skill);
		setStatus(`Added: ${item}`);
		return `[COUNTED: ${item} +1]`;
	}

	return null;
}

// Sorting the items not caught by skillPatterns/transportMatch
const miningItems = [
	"limestone", "essence",
	"clay", "sandstone", "granite",
	"calcified", // croesus front
];

const woodcuttingItems = [
	"logs",
	"bird's nest",
	"crystal geode",
	"bamboo", // uncharted isles
	"timber", // croesus front
	"eternal magic tree branch",
];

const fishingItems = [
	"raw ",
	"leaping ", // barbarian fishing
	"algae",   // croesus front
];

function getSkillForItem(item: string): InternalSkillType {
	// For those artifacts that are tracked. It can happen.
	if (item.includes("(damaged)")) return "archaeology";

	if (miningItems.some((keyword) => item.includes(keyword))) {
		return "mining";
	}

	if (woodcuttingItems.some((keyword) => item.includes(keyword))) {
		return "woodcutting";
	}

	if (fishingItems.some((keyword) => item.includes(keyword))) {
		return "fishing";
	}
	// What did you find? Was it farming related? I'm not sorting those.
	return "other";
}

function isDamagedArtefact(item: string) {
	return item.toLowerCase().includes("(damaged)");
}

function normalizeItemName(item: string) {
	return item
		.replace(/\s+\[(?:[01]\d|2[0-3])(?::[0-5]?\d?){0,2}.*$/, "")
		.toLowerCase()
		.replace(/[.!]$/, "")
		.trim();
}

function registerDamagedArtifactCount(item: string) {
	if (!item.includes("(damaged)")) {
		return true;
	}

	const now = Date.now();

	recentDamagedArtifactCounts.forEach((seenAt, key) => {
		if (now - seenAt > damagedArtifactDuplicateWindowMs) {
			recentDamagedArtifactCounts.delete(key);
		}
	});

	const lastSeen = recentDamagedArtifactCounts.get(item);

	if (lastSeen && now - lastSeen < damagedArtifactDuplicateWindowMs) {
		return false;
	}

	recentDamagedArtifactCounts.set(item, now);
	return true;
}

function getSaveData(): SaveData {
	const raw = localStorage.getItem(appName);

	if (!raw) {
		return {
			sortMode: "recent",
			items: {},
		};
	}

	try {
		const data = JSON.parse(raw);
		return {
			chat: data.chat,
			activeTab: data.activeTab || "all",
			fishingUsePorters: data.fishingUsePorters ?? true,
			sortMode: data.sortMode || "recent",
			items: data.items || {},
		};
	} catch {
		return {
			sortMode: "recent",
			items: {},
		};
	}
}

function saveData(data: SaveData) {
	localStorage.setItem(appName, JSON.stringify(data));
}

function ensureItem(data: SaveData, item: string) {
	if (!data.items[item]) {
		data.items[item] = {
			count: 0,
			goal: null,
			settingsOpen: false,
		};
	}
}

function applyItemUpdate(data: SaveData, update: ItemUpdate, timestamp: number) {
	ensureItem(data, update.item);

	data.items[update.item].count += update.amount;
	data.items[update.item].skill = update.skill;
	data.items[update.item].lastUpdated = timestamp;

	if (update.colorClass) {
		data.items[update.item].colorClass = update.colorClass;
	}

	if (update.source) {
		data.items[update.item].source = update.source;
	}
}

function incrementItems(updates: ItemUpdate[], highlightItem?: string) {
	if (updates.length === 0) return;

	const data = getSaveData();
	const timestamp = Date.now();

	for (const update of updates) {
		applyItemUpdate(data, update, timestamp);
	}

	try {
		recordSessionUpdates(updates);
	} catch (error) {
		console.warn("Session update failed", error);
	}

	saveData(data);
	render(highlightItem || updates[updates.length - 1].item, data);
}

// Increment the count of a tracked item
// then re-render the tracker to reflect the change
function incrementItem(
	item: string,
	amount: number = 1,
	skill: InternalSkillType = "other",
	colorClass?: string,
	source?: string
) {
	incrementItems([{
		item,
		amount,
		skill,
		colorClass,
		source,
	}], item);
}

// Prevent processing duplicates
let recentLines: string[] = [];
let recentLineKeys: string[] = [];
const recentLineSet = new Set<string>();

function isInHistory(chatLine: string) {
	return recentLineSet.has(chatLine);
}

// Add a new chat line to the history
function updateChatHistory(chatLine: string, debugStatus = "[IGNORED]") {
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

function render(highlightItem?: string, data = getSaveData()) {
	const items = Object.keys(data.items)
		.filter((item) => {
			if (activeSkillTab === "all") return true;
			return (data.items[item].skill || "other") === activeSkillTab;
		});

	sortItems(items, data);

	tracker.innerHTML = "";

	if (items.length === 0) {
		tracker.innerHTML = `<div class="empty">No tracked items yet...</div>`;
		return;
	}

	if (activeSkillTab === "all") {
		renderAllTab(items, data, highlightItem);
		return;
	}

	if (activeSkillTab === "archaeology") {
		const materials = items.filter(function (item) {
			return !isDamagedArtefact(item);
		});

		const artefacts = items.filter(function (item) {
			return isDamagedArtefact(item);
		});

		if (materials.length > 0) {
			renderItemGroup("Materials", materials, data, highlightItem);
		}

		if (artefacts.length > 0) {
			renderItemGroup("Artefacts", artefacts, data, highlightItem);
		}

		return;
	}

	if (activeSkillTab === "invention") {
		if (inventionFilter === "all") {
			for (const item of items) {
				renderItemRow(item, data.items[item], highlightItem);
			}

			return;
		}

		const ancientItems = items.filter(
			(item) => data.items[item].source === "ancient-components"
		);

		const rareItems = items.filter(
			(item) => data.items[item].source === "rare-components"
		);

		const uncommonItems = items.filter(
			(item) => data.items[item].source === "uncommon-components"
		);

		const commonItems = items.filter(
			(item) => data.items[item].source === "invention" || !data.items[item].source
		);

		if (inventionFilter === "ancient") {
			renderItemGroup("Ancient Components", ancientItems, data, highlightItem);
		}

		if (inventionFilter === "rare") {
			renderItemGroup("Rare Components", rareItems, data, highlightItem);
		}

		if (inventionFilter === "uncommon") {
			renderItemGroup("Uncommon Components", uncommonItems, data, highlightItem);
		}

		if (inventionFilter === "common") {
			renderItemGroup("Common Components", commonItems, data, highlightItem);
		}

		return;
	}

	renderGoalSortedTab(items, data, highlightItem);
}

function sortItems(items: string[], data: SaveData) {
	if (sortMode === "recent") {
		items.sort((a, b) =>
			(data.items[b].lastUpdated || 0) -
			(data.items[a].lastUpdated || 0)
		);
		return;
	}

	if (sortMode === "count") {
		items.sort((a, b) =>
			data.items[b].count - data.items[a].count
		);
		return;
	}

	items.sort();
}

function updateSortButtonLabel() {
	if (!sortButton) return;

	sortButton.title =
		sortMode === "recent"
			? "Sort: Recent"
			: sortMode === "alpha"
				? "Sort: A-Z"
				: "Sort: Count";
}

if (sortButton) {
	sortButton.addEventListener("click", function () {
		sortMode =
			sortMode === "recent"
				? "alpha"
				: sortMode === "alpha"
					? "count"
					: "recent";

		const data = getSaveData();
		data.sortMode = sortMode;
		saveData(data);

		updateSortButtonLabel();
		render();
	});
}

function getActiveTabLabel() {
	if (activeSkillTab === "all") return "ALL";
	if (activeSkillTab === "seren") return "Seren Spirits";

	return titleCase(activeSkillTab);
}

function updateClearButtonLabel() {
	if (!clearButton) return;

	clearButton.innerText = `Clear ${getActiveTabLabel()}`;
	clearButton.title = `Clear ${getActiveTabLabel()}`;
}

function renderItemGroup(
	label: string,
	items: string[],
	data: SaveData,
	highlightItem?: string
) {
	if (items.length === 0) return;

	const header = document.createElement("div");
	header.className = "group-header";
	header.innerText = label;
	tracker.appendChild(header);

	for (const item of items) {
		renderItemRow(item, data.items[item], highlightItem);
	}
}

function getSortedGroupLabel() {
	if (sortMode === "recent") return "Recent";
	if (sortMode === "alpha") return "A-Z";
	return "Count";
}

function renderGoalSortedTab(
	items: string[],
	data: SaveData,
	highlightItem?: string,
	includeUnknown = false
) {
	const goalItems = items.filter((item) =>
		data.items[item].goal !== null
	);

	const unknownItems = includeUnknown
		? items.filter((item) =>
			data.items[item].goal === null &&
			(data.items[item].skill || "other") === "other"
		)
		: [];

	const sortedItems = items.filter((item) =>
		data.items[item].goal === null &&
		(!includeUnknown || (data.items[item].skill || "other") !== "other")
	);

	sortItems(goalItems, data);
	sortItems(sortedItems, data);
	sortItems(unknownItems, data);

	if (goalItems.length > 0) {
		renderItemGroup("Goals", goalItems, data, highlightItem);
	}

	if (sortedItems.length > 0) {
		renderItemGroup(getSortedGroupLabel(), sortedItems, data, highlightItem);
	}

	if (unknownItems.length > 0) {
		renderItemGroup("Unknown", unknownItems, data, highlightItem);
	}
}

function renderAllTab(
	items: string[],
	data: SaveData,
	highlightItem?: string
) {
	renderGoalSortedTab(items, data, highlightItem, true);
}

function renderItemRow(
	item: string,
	itemData: TrackedItem,
	highlightItem?: string
) {
	const row = document.createElement("div");
	row.className = "item-row";

	let goalHtml = "";
	let goalTooltip = "";

	if (itemData.goal) {
		const goalReached = itemData.count >= itemData.goal;
		const overage = itemData.count - itemData.goal;
		const overageText =
			overage > 0
				? ` (+${overage.toLocaleString()})`
				: "";

		const remaining = Math.max(itemData.goal - itemData.count, 0);

		goalTooltip = goalReached
			? `Goal reached. ${overage > 0 ? `${overage.toLocaleString()} over goal.` : "Exactly at goal."}`
			: `${remaining.toLocaleString()} remaining to goal.`;

		if (goalReached) {
			goalHtml = `
			<div class="goal-complete" title="${escapeAttr(goalTooltip)}">★ Goal Reached!${overageText}</div>
		`;

		} else {
			const progress = Math.min((itemData.count / itemData.goal) * 100, 100);
			const current = itemData.count.toLocaleString();
			const goal = itemData.goal.toLocaleString();

			goalHtml = `
    		<div class="goal-row" title="${escapeAttr(goalTooltip)}">
        		<span class="goal-text">
           			 ${current} / ${goal} (${progress.toFixed(1)}%)
        		</span>

				<div class="progress-bar">
					<div class="progress-fill" style="width:${progress}%"></div>
				</div>
			</div>
		`;
		}
	}

	row.innerHTML = `
		<div class="item-main-row">
			<div class="item-text">
				<strong class="${escapeAttr(itemData.colorClass || "")}">
					${escapeHtml(titleCase(item))}
				</strong>
			</div>

			<div class="item-count">
    			${itemData.count.toLocaleString()}
			</div>

			<button class="cog-btn" data-item="${escapeAttr(item)}">⚙</button>
		</div>

		${goalHtml}

		${itemData.settingsOpen ? `<div class="settings-separator"></div>` : ""}

		<div class="settings-panel ${itemData.settingsOpen ? "open" : ""}">
			<input type="number"
				   id="goal-${escapeAttr(item)}"
				   placeholder="Goal"
				   value="${itemData.goal || ""}">

			<button class="clear-goal icon-btn" data-item="${escapeAttr(item)}" title="Clear Goal">
				<img src="./icons/clear-goal.png" alt="Clear Goal">
			</button>

			<button class="save-goal icon-btn" data-item="${escapeAttr(item)}" title="Set Goal">
				<img src="./icons/save-goal.png" alt="Set Goal">
			</button>

			<span class="button-separator">•</span>

			<button class="reset-item icon-btn" data-item="${escapeAttr(item)}" title="Reset Count">
				<img src="./icons/reset-count.png" alt="Reset Count">
			</button>

			<button class="delete-item icon-btn" data-item="${escapeAttr(item)}" title="Delete Item">
				<img src="./icons/delete-item.png" alt="Delete Item">
			</button>
		</div>
	`;

	if (highlightItem === item) {
		row.classList.add("highlight");
	}

	tracker.appendChild(row);
}

function bindRowEvents() {
	tracker.addEventListener("click", (e: Event) => {
		const target = (e.target as HTMLElement).closest("button[data-item]") as HTMLElement | null;
		if (!target) return;

		const item = target.dataset.item || "";

		if (target.classList.contains("cog-btn")) {
			toggleSettings(item);
		} else if (target.classList.contains("clear-goal")) {
			clearGoal(item);
		} else if (target.classList.contains("save-goal")) {
			setGoal(item);
		} else if (target.classList.contains("reset-item")) {
			resetItem(item);
		} else if (target.classList.contains("delete-item")) {
			deleteItem(item);
		}
	});
}

bindRowEvents();

document.querySelectorAll(".skill-tab").forEach((tab) => {
	tab.addEventListener("click", (e: Event) => {
		const target = e.currentTarget as HTMLElement;

		activeSkillTab = (target.dataset.skill as SkillType) || "all";

		const data = getSaveData();
		data.activeTab = activeSkillTab;
		saveData(data);

		document.querySelectorAll(".skill-tab").forEach((btn) => {
			btn.classList.remove("active");
		});

		target.classList.add("active");

		updateFishingModeVisibility();
		updateInventionFilterVisibility();
		updateClearButtonLabel();
		render();
	});
});

// Toggle the settings panel when the cog button is clicked
function toggleSettings(item: string) {
	const data = getSaveData();
	if (!data.items[item]) return;

	data.items[item].settingsOpen = !data.items[item].settingsOpen;
	saveData(data);
	render();
}

function clearGoal(item: string) {
	const data = getSaveData();
	if (!data.items[item]) return;

	data.items[item].goal = null;

	saveData(data);
	render();
}

function setGoal(item: string) {
	const data = getSaveData();
	if (!data.items[item]) return;

	const input = document.getElementById(`goal-${item}`) as HTMLInputElement;
	if (!input) return;

	const value = input.value.trim();

	if (value === "") {
		data.items[item].goal = null;
	} else {
		const goal = parseInt(value, 10);
		if (isNaN(goal) || goal <= 0) {
			status.innerText = "Goal must be a positive number.";
			return;
		}
		data.items[item].goal = goal;
	}

	saveData(data);
	render();
}

function resetItem(item: string) {
	const data = getSaveData();
	if (!data.items[item]) return;

	data.items[item].count = 0;
	saveData(data);
	render();
}

function deleteItem(item: string) {
	const data = getSaveData();
	delete data.items[item];
	saveData(data);
	render();
}

function refreshChatboxes() {
	if (!window.alt1) return;

	reader = createChatReader();

	const found = reader.find() as ChatboxPosition | null;

	if (!found || found.boxes.length === 0) {
		status.innerText = "No chatbox found.";
		return;
	}

	reader.pos = found;
	populateChatSelector();

	const data = getSaveData();
	const savedChat = data.chat || "0";
	const selectedChat = chatSelector.value || savedChat;
	const selectedIndex = Number(selectedChat);

	const validIndex = found.boxes[selectedIndex] ? selectedIndex : 0;
	const validChat = String(validIndex);

	found.mainbox = found.boxes[validIndex];
	chatSelector.value = validChat;

	data.chat = validChat;
	saveData(data);

	showSelectedChat(found);
	status.innerText = `Chatbox refreshed. Using Chat ${validChat}.`;
}

function clearCurrentTab() {
	const data = getSaveData();

	if (activeSkillTab === "all") {
		data.items = {};

		saveData(data);
		render();

		status.innerText = "All items cleared.";
		return;
	}

	for (const item of Object.keys(data.items)) {
		if ((data.items[item].skill || "other") === activeSkillTab) {
			delete data.items[item];
		}
	}

	saveData(data);
	render();

	status.innerText = `${getActiveTabLabel()} cleared.`;
}

function exportData() {
	const data = getSaveData();

	const blob = new Blob([JSON.stringify(data, null, 2)], {
		type: "application/json",
	});

	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = "Resource-Tracker-save.json";
	a.click();
	URL.revokeObjectURL(url);
}

function importData(file: File) {
	const reader = new FileReader();

	reader.onload = function () {
		try {
			const imported = JSON.parse(reader.result as string);
			const data: SaveData = {
				chat: imported.chat,
				activeTab: imported.activeTab || "all",
				fishingUsePorters: imported.fishingUsePorters ?? true,
				sortMode: imported.sortMode || "recent",
				items: imported.items || {},
			};

			saveData(data);

			render();
			status.innerText = "Save imported.";
		} catch {
			status.innerText = "Import failed.";
		}
	};

	reader.readAsText(file);
}

function showSelectedChat(pos: any) {
	if (!pos || !pos.mainbox) return;

	alt1.overLayRect(
		appColor,
		pos.mainbox.rect.x,
		pos.mainbox.rect.y,
		pos.mainbox.rect.width,
		pos.mainbox.rect.height,
		2000,
		3
	);
}

function escapeHtml(value: string) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function titleCase(text: string) {
	return text.replace(/\b\w/g, (char) => char.toUpperCase());
}

function escapeAttr(value: string) {
	return escapeHtml(value);
}

// Hey you, listen to this...
appCog?.addEventListener("click", function () {
	appSettingsPanel?.classList.toggle("open");
});

sessionButton?.addEventListener("click", showSessionWindow);

clearButton?.addEventListener("click", clearCurrentTab);

if (fishingPortersInput) {
	fishingPortersInput.addEventListener("change", function () {
		fishingUsePorters = this.checked;

		const data = getSaveData();
		data.fishingUsePorters = fishingUsePorters;
		saveData(data);
	});
}
findChatButton?.addEventListener("click", refreshChatboxes);

historyButton?.addEventListener("click", showChatHistory);

exportButton?.addEventListener("click", exportData);

importInput?.addEventListener("change", function () {
	if (this.files && this.files[0]) {
		importData(this.files[0]);
		this.value = "";
	}
});
