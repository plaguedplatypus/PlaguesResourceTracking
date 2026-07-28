import * as a1lib from "alt1/base";
import DialogReader from "alt1/dialog";
import { processInventionMaterials, } from "./invention";
import { recordSessionUpdates, showSessionWindow, getSessionStatus, } from "./session";
import { isInHistory, showChatHistory, updateChatHistory } from "./history";
import { /*RT_DISCORD_INVITE_URL,*/ RT_VERSION } from "./updateNotes";
import { maybeShowUpdateToast, showPatchNotesModal } from "./updateToast";
import ResourceChatReader, { ChatboxPosition } from "./ChatReader";

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

type InventionFilter = "all" | "ancient" | "rare" | "uncommon" | "common";
type SortMode = "recent" | "alpha" | "count";

type SaveData = {
	chat?: string;
	activeTab?: InternalSkillType;
	fishingUsePorters?: boolean;
	sortMode?: SortMode;
	items: Record<string, TrackedItem>;
};

const appName = "ResourceTracker";
const appColor = a1lib.mixColor(67, 188, 188);
const tabsToggleButton = document.querySelector(".tabs-toggle") as HTMLElement | null;
const compactSortButton = document.querySelector(".compact-sort-button") as HTMLElement | null;

const timestampRegex = /\[\d{2}:\d{2}:\d{2}\]/g;

const appCog = document.querySelector(".app-cog") as HTMLElement;
const appSettingsPanel = document.querySelector(".app-settings-panel") as HTMLElement;
const settingsVersion = document.querySelector(".settings-version") as HTMLElement | null;
const settingsDiscord = document.querySelector(".settings-discord") as HTMLElement | null;

const chatSelector = document.querySelector(".chat") as HTMLSelectElement;
const findChatButton = document.querySelector(".find-chat") as HTMLElement;

const historyButton = document.querySelector(".history-button") as HTMLElement;
const exportButton = document.querySelector(".export") as HTMLElement;
const importInput = document.querySelector(".import") as HTMLInputElement;
const sessionButton = document.querySelector(".session-button") as HTMLElement;
const sessionStatusMini = document.querySelector(".session-status-line, .session-status-mini") as HTMLElement | null;
const sessionStatusValue = document.querySelector(".session-status-value") as HTMLElement | null;
const clearButton = document.querySelector(".clear") as HTMLElement;

const tracker = document.querySelector(".tracker") as HTMLElement;
const status = document.querySelector(".status") as HTMLElement;
const sortButton = document.querySelector(".sort-button") as HTMLElement;

const fishingMode = document.querySelector(".fishing-mode") as HTMLElement;
const fishingPortersButton = document.querySelector(".fishing-porters-cycle") as HTMLElement;

const inventionFilters = document.querySelector(".invention-filters") as HTMLElement;
const inventionFilterButton = document.querySelector(".invention-filter-cycle") as HTMLElement;

// *********************************************
// Temporary migration:
cleanupBakedSerenPrefixes();
// *********************************************

const savedData = getSaveData();

let inventionFilter: InventionFilter = "all";
let activeSkillTab: SkillType = "all";
let sortMode: SortMode = "recent";
let fishingUsePorters = true;
let openSettingsItem: string | null = null;
let tabsCollapsed = false;
let reader = new ResourceChatReader();

const savedActiveTab = savedData.activeTab as string | undefined;
activeSkillTab =
	savedActiveTab === "other"
		? "all"
		: ((savedData.activeTab || "all") as SkillType);
fishingUsePorters = savedData.fishingUsePorters ?? true;
sortMode = savedData.sortMode || "recent";


const dialogReader = new DialogReader();

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

		const runReaderPoll = (
			readerName: "chat" | "dialog",
			read: () => void
		) => {
			try {
				read();
			} catch (error) {
				console.warn(`${readerName} reader failed`, error);
				status.innerText =
					"Tracking read failed. Click Find Chat if tracking stopped.";
			}
		};

		setInterval(
			() => runReaderPoll("chat", readChatbox),
			600
		);

		// Keep both readers at 600 ms, but avoid blocking the UI by running
		// their synchronous OCR captures in the same interval callback.
		setTimeout(() => {
			runReaderPoll("dialog", readDialogBox);
			setInterval(
				() => runReaderPoll("dialog", readDialogBox),
				600
			);
		}, 300);
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

function showSelectedChat(pos: any) {
	if (!pos || !pos.mainbox) return;
	if (!alt1.permissionOverlay) return;

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

let currentDialogCounted = false;
let dialogReadFailCount = 0;
const maxDialogReadFails = 3;
const damagedArtifactDialogRegex = /^You find\s*[:;]?\s+(.+?\(\s*damaged\s*\))[!.]?$/i;

function readLocatedDialogTexts() {
	if (!dialogReader.pos) return { visible: false, texts: [] as string[] };

	const originalPos = dialogReader.pos;
	const capturePadding = 40;
	const captureX = Math.max(0, originalPos.x - capturePadding);
	const captureRight = Math.min(
		alt1.rsWidth,
		originalPos.x + originalPos.width + capturePadding
	);
	const image = a1lib.captureHold(
		captureX,
		originalPos.y,
		captureRight - captureX,
		originalPos.height
	);

	// A saved position can outlive the dialog. Do not run the permissive
	// offset OCR against ordinary game pixels or they can look like text and
	// keep the previous artifact marked as the still-open dialog.
	if (!dialogReader.checkDialog(image)) {
		return { visible: false, texts: [] as string[] };
	}

	const dialog = dialogReader.read(image);
	const texts: string[] = [];

	function addText(lines: string[] | null) {
		const text = (lines || []).join(" ").replace(/\s+/g, " ").trim();

		if (text && !texts.includes(text)) {
			texts.push(text);
		}
	}

	addText(dialog && dialog.text ? dialog.text : null);

	if (texts.some((text) => damagedArtifactDialogRegex.test(text))) {
		return { visible: true, texts };
	}

	// DialogReader's fixed line-start probes can mistake a horizontal glyph
	// stroke for "_", then skip past the real line. Small horizontal offsets
	// move those probes while OCRing the same dialog pixels.
	try {
		for (const offsetX of [0, -30, -20, 5, 10, 20, 30]) {
			const shiftedX = originalPos.x + offsetX;

			if (
				shiftedX < captureX ||
				shiftedX + originalPos.width > captureRight
			) {
				continue;
			}

			dialogReader.pos = { ...originalPos, x: shiftedX };
			addText(dialogReader.readDialog(image, true));

			if (texts.some((text) => damagedArtifactDialogRegex.test(text))) {
				break;
			}
		}
	} finally {
		dialogReader.pos = originalPos;
	}

	return { visible: true, texts };
}

function readDialogBox() {
	if (!window.alt1) return;

	if (!dialogReader.pos) {
		dialogReader.find();

		if (!dialogReader.pos) {
			currentDialogCounted = false;
			return;
		}
	}

	const dialogResult = readLocatedDialogTexts();

	if (!dialogResult.visible) {
		dialogReadFailCount++;

		if (dialogReadFailCount >= maxDialogReadFails) {
			dialogReader.pos = null;
			dialogReadFailCount = 0;
			currentDialogCounted = false;
		}

		return;
	}

	dialogReadFailCount = 0;

	if (currentDialogCounted || dialogResult.texts.length === 0) {
		return;
	}

	let fullText = "";
	let match: RegExpMatchArray | null = null;

	for (const text of dialogResult.texts) {
		const candidateMatch = text.match(damagedArtifactDialogRegex);

		if (candidateMatch) {
			fullText = text;
			match = candidateMatch;
			break;
		}
	}

	if (!match || !fullText) {
		return;
	}

	const item = normalizeItemName(match[1]);
	if (!item) return;

	currentDialogCounted = true;

	incrementItem(item, 1, "archaeology");
	setStatus(`Added: ${item}`);

	updateChatHistory(fullText, `[DIALOG COUNTED: ${item} +1]`);
}

function readChatbox() {
	for (const { text: chatLine } of reader.read()) {
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

		const item = normalizedItem;

		const colorClass = rareSerenItems.has(normalizedItem)
			? "seren-item-rare"
			: "seren-item";

		incrementItem(item, amount, "seren", colorClass, "seren-spirit");
		setStatus(`Seren: ${amount} x ${item}`);

		return `[COUNTED: ${item} +${amount}]`;
	}

	// Invention materials
	const inventionResult =
		processInventionMaterials(cleanLine);

	if (inventionResult) {
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

		incrementItem(item, 1, entry.skill);
		setStatus(`Added: ${item}`);
		return `[COUNTED: ${item} +1]`;
	}

	return null;
}

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

// Sorting the items not caught by skillPatterns/transportMatch

// List of rare Seren spirit items that should be highlighted in the tracker.
// We both know you'll never see them
const rareSerenItems = new Set([
	"hazelmere's signet ring",
	"blurberry special", // maybe this one, about 15 times.
	"cheese+tom batta" // should have been wearing that ring...
]);

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

function normalizeItemName(item: string) {
	return item
		.replace(/\s+\[(?:[01]\d|2[0-3])(?::[0-5]?\d?){0,2}.*$/, "")
		.toLowerCase()
		.trim()
		.replace(/[\s.,;:\[\]]+$/g, "")
		.trim();
}

function getItemDisplayPrefixHtml(itemData: TrackedItem) {
	if (activeSkillTab !== "all") return "";

	if (itemData.skill === "mining")
		{ return `<img class="item-prefix-icon" src="./icons/mining.png" alt=""> `; }
	if (itemData.skill === "woodcutting")
		{ return `<img class="item-prefix-icon" src="./icons/woodcutting.png" alt=""> `; }
	if (itemData.skill === "fishing")
		{ return `<img class="item-prefix-icon" src="./icons/fishing.png" alt=""> `; }
	if (itemData.skill === "archaeology")
		{ return `<img class="item-prefix-icon" src="./icons/archaeology.png" alt=""> `; }
	if (itemData.skill === "invention")
		{ return `<img class="item-prefix-icon" src="./icons/invention.png" alt=""> `; }
	if (itemData.skill === "seren")
		{ return `<img class="item-prefix-icon" src="./icons/seren.png" alt=""> `; }

	return "";
}

function isDamagedArtefact(item: string) {
	return item.toLowerCase().includes("(damaged)");
}

// Update the status message in the footer with a timestamp on when events occurred
function getTimeStamp() {
	return new Date().toLocaleTimeString("en-US", {
		hour12: false,
	});
}
function setStatus(message: string) {
	status.innerText = `${message} @ ${getTimeStamp()}`;
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

// *********************************************
// Temporary migration:
// Older saves stored the Seren Spirit marker as part of the item name.
// Clean those item names so the marker can be handled by renderItemRow instead.
// Safe to remove after this version has been live for a while.
function cleanupBakedSerenPrefixes() {
	const data = getSaveData();
	let changed = false;

	for (const item of Object.keys(data.items)) {
		if (!item.startsWith("﴾♦﴿ ")) continue;

		const cleanItem = item.replace(/^﴾♦﴿\s*/, "").trim();
		if (!cleanItem) continue;

		const oldItemData = data.items[item];

		if (data.items[cleanItem]) {
			const existingItemData = data.items[cleanItem];

			existingItemData.count += oldItemData.count;

			if (existingItemData.goal === null && oldItemData.goal !== null) {
				existingItemData.goal = oldItemData.goal;
			}

			existingItemData.skill = existingItemData.skill || oldItemData.skill || "seren";
			existingItemData.source = existingItemData.source || oldItemData.source || "seren-spirit";
			existingItemData.colorClass = existingItemData.colorClass || oldItemData.colorClass;

			existingItemData.lastUpdated = Math.max(
				existingItemData.lastUpdated || 0,
				oldItemData.lastUpdated || 0
			);
		} else {
			data.items[cleanItem] = {
				...oldItemData,
				skill: oldItemData.skill || "seren",
				source: oldItemData.source || "seren-spirit",
			};
		}

		delete data.items[item];
		changed = true;
	}

	if (changed) {
		saveData(data);
	}
}
// *********************************************

function ensureItem(data: SaveData, item: string) {
	if (!data.items[item]) {
		data.items[item] = {
			count: 0,
			goal: null,
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

	const highlightedItems = new Set(
		updates.map((update) => update.item)
	);

	if (highlightItem) {
		highlightedItems.add(highlightItem);
	}

	render(highlightedItems, data);
}

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

// Rendering the UI
function render(highlightItems?: Set<string>, data = getSaveData()) {
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
		renderAllTab(items, data, highlightItems);
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
			renderItemGroup("Materials", materials, data, highlightItems);
		}

		if (artefacts.length > 0) {
			renderItemGroup("Artefacts", artefacts, data, highlightItems);
		}

		return;
	}

	if (activeSkillTab === "invention") {
		if (inventionFilter === "all") {
			for (const item of items) {
				renderItemRow(item, data.items[item], highlightItems);
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
			renderItemGroup("Ancient Components", ancientItems, data, highlightItems);
		}

		if (inventionFilter === "rare") {
			renderItemGroup("Rare Components", rareItems, data, highlightItems);
		}

		if (inventionFilter === "uncommon") {
			renderItemGroup("Uncommon Components", uncommonItems, data, highlightItems);
		}

		if (inventionFilter === "common") {
			renderItemGroup("Common Components", commonItems, data, highlightItems);
		}

		return;
	}

	renderGoalSortedTab(items, data, highlightItems);
}

function updateTabsCollapsedUi() {
	document.body.classList.toggle("tabs-collapsed", tabsCollapsed);

	if (tabsCollapsed) {
		appSettingsPanel?.classList.remove("open");
	}

	if (!tabsToggleButton) return;

	tabsToggleButton.innerText = tabsCollapsed ? "+" : "−";
	tabsToggleButton.title = tabsCollapsed ? "Exit Compact Mode" : "Compact Mode";
}

function renderAllTab(
	items: string[],
	data: SaveData,
	highlightItems?: Set<string>
) {
	renderGoalSortedTab(items, data, highlightItems, true);
}
function renderGoalSortedTab(
	items: string[],
	data: SaveData,
	highlightItems?: Set<string>,
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
		renderItemGroup("Goals", goalItems, data, highlightItems);
	}

	if (sortedItems.length > 0) {
		renderItemGroup(getSortedGroupLabel(), sortedItems, data, highlightItems);
	}

	if (unknownItems.length > 0) {
		renderItemGroup("Unknown", unknownItems, data, highlightItems);
	}
}

function renderItemGroup(
	label: string,
	items: string[],
	data: SaveData,
	highlightItems?: Set<string>
) {
	if (items.length === 0) return;

	const header = document.createElement("div");
	header.className = "group-header";
	header.innerText = label;
	tracker.appendChild(header);

	for (const item of items) {
		renderItemRow(item, data.items[item], highlightItems);
	}
}

function renderItemRow(
	item: string,
	itemData: TrackedItem,
	highlightItems?: Set<string>
) {
	const row = document.createElement("div");
	row.className = `item-row ${openSettingsItem === item ? "settings-active" : ""}`;

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

	const displayPrefixHtml = getItemDisplayPrefixHtml(itemData);
	const displayName = titleCase(item);

	row.innerHTML = `
		<div class="item-main-row">
			<div class="item-text">
				<strong class="${escapeAttr(itemData.colorClass || "")}">
					${displayPrefixHtml}${escapeHtml(displayName)}
				</strong>
			</div>

			<div class="item-count">
    			${itemData.count.toLocaleString()}
			</div>

			<button class="cog-btn" data-item="${escapeAttr(item)}">⚙</button>
		</div>

		${goalHtml}

		${openSettingsItem === item ? `<div class="settings-separator"></div>` : ""}

		<div class="settings-panel ${openSettingsItem === item ? "open" : ""}">
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

	if (highlightItems?.has(item)) {
		row.classList.add("highlight");
	}

	tracker.appendChild(row);
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

// Set state of fishing porters
function updateFishingPortersButton() {
	if (!fishingPortersButton) return;

	fishingPortersButton.innerText = fishingUsePorters
		? "Porters / GOTE: ON"
		: "Porters / GOTE: OFF";

	fishingPortersButton.title = fishingUsePorters
		? "Counting fishing items from porter/bank transport lines."
		: "Counting fishing items from direct catch lines.";
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

function updateSortButtonLabel() {
	const sortTitle =
		sortMode === "recent"
			? "Sort: Recent"
			: sortMode === "alpha"
				? "Sort: A-Z"
				: "Sort: Count";

	if (sortButton) {
		sortButton.title = sortTitle;
	}

	if (compactSortButton) {
		compactSortButton.title = sortTitle;
	}
}

function updateClearButtonLabel() {
	if (!clearButton) return;

	clearButton.innerText = `Clear ${getActiveTabLabel()}`;
	clearButton.title = `Clear ${getActiveTabLabel()}`;
}

function updateSessionStatusMini() {
	if (!sessionStatusMini || !sessionStatusValue) return;

	const currentSessionStatus = getSessionStatus();

	sessionStatusMini.classList.remove("running", "paused", "idle");
	sessionStatusMini.classList.add(currentSessionStatus);

	sessionStatusValue.innerText =
		currentSessionStatus === "running"
			? "Running"
			: currentSessionStatus === "paused"
				? "Paused"
				: "Not Running";
}

function getActiveTabLabel() {
	if (activeSkillTab === "all") return "ALL";
	if (activeSkillTab === "seren") return "Seren Spirits";

	return titleCase(activeSkillTab);
}

function getSortedGroupLabel() {
	if (sortMode === "recent") return "Recent";
	if (sortMode === "alpha") return "A-Z";
	return "Count";
}

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
	openSettingsItem = openSettingsItem === item ? null : item;

	render();
}

function cycleSortMode() {
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
	if (openSettingsItem === item) {
		openSettingsItem = null;
	}
	delete data.items[item];
	saveData(data);
	render();
}

function refreshChatboxes() {
	if (!window.alt1) return;

	reader = new ResourceChatReader();

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
		openSettingsItem = null;

		saveData(data);
		render();

		status.innerText = "All items cleared.";
		return;
	}

	for (const item of Object.keys(data.items)) {
		if ((data.items[item].skill || "other") === activeSkillTab) {
			delete data.items[item];

			if (openSettingsItem === item) {
				openSettingsItem = null;
			}
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
			openSettingsItem = null;

			render();
			status.innerText = "Save imported.";
		} catch {
			status.innerText = "Import failed.";
		}
	};

	reader.readAsText(file);
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
	return text.replace(/(^|[\s\-\(])([a-z])/g, (_match, prefix, char) => {
		return prefix + char.toUpperCase();
	});
}

function escapeAttr(value: string) {
	return escapeHtml(value);
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

window.setInterval(function () {
	if (!appSettingsPanel?.classList.contains("open")) return;

	updateSessionStatusMini();
}, 1000);

// Set initial sort button label
document.querySelectorAll(".skill-tab").forEach((btn) => {
	btn.classList.remove("active");
});

// Activate the saved skill tab or default to "all"
const savedTabButton = document.querySelector(
	`.skill-tab[data-skill="${activeSkillTab}"]`
);

// If the saved active tab is "other", default to "all", how old is that save file?
if (savedTabButton) {
	savedTabButton.classList.add("active");
}

// Initial UI setup
updateFishingModeVisibility();
updateFishingPortersButton();
updateInventionFilterButton();
updateInventionFilterVisibility();
updateSortButtonLabel();
updateClearButtonLabel();
updateSessionStatusMini();
updateSettingsVersionLabel();
maybeShowUpdateToast();
updateTabsCollapsedUi();
render();

function updateSettingsVersionLabel() {
	if (!settingsVersion) return;
	settingsVersion.textContent = `Version ${RT_VERSION}`;
	settingsVersion.setAttribute("role", "button");
	settingsVersion.setAttribute("tabindex", "0");
	settingsVersion.setAttribute("title", "Show Patch Notes");
}

// App settings panel / session status refresh
tabsToggleButton?.addEventListener("click", function () {
	tabsCollapsed = !tabsCollapsed;
	updateTabsCollapsedUi();
});

appCog?.addEventListener("click", function () {
	appSettingsPanel?.classList.toggle("open");
	updateSessionStatusMini();
});

settingsVersion?.addEventListener("click", showPatchNotesModal);
settingsVersion?.addEventListener("keydown", event => {
	if (event.key !== "Enter" && event.key !== " ") return;
	event.preventDefault();
	showPatchNotesModal();
});

/*settingsDiscord?.addEventListener("click", () => {
	window.open(RT_DISCORD_INVITE_URL, "_blank", "noopener,noreferrer");
});*/

sortButton?.addEventListener("click", cycleSortMode);
compactSortButton?.addEventListener("click", cycleSortMode);

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

fishingPortersButton?.addEventListener("click", function () {
	fishingUsePorters = !fishingUsePorters;

	const data = getSaveData();
	data.fishingUsePorters = fishingUsePorters;
	saveData(data);

	updateFishingPortersButton();
	render();
});

sessionButton?.addEventListener("click", function () {
	showSessionWindow();
	setTimeout(updateSessionStatusMini, 100);
});

clearButton?.addEventListener("click", clearCurrentTab);

findChatButton?.addEventListener("click", refreshChatboxes);

historyButton?.addEventListener("click", showChatHistory);

exportButton?.addEventListener("click", exportData);

importInput?.addEventListener("change", function () {
	if (this.files && this.files[0]) {
		importData(this.files[0]);
		this.value = "";
	}
});
