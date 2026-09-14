import * as a1lib from "alt1/base";
import { processInventionMaterials } from "./invention/InventionParser";
import { getInventionOption, type InventionOption, } from "./invention/components";
import { digsiteMaterials, type Digsite, } from "./tracking/materials";
import { getUpdateId, parseSkillMessage } from "./tracking/SkillTracker";
import { isIgnoredMessage } from "./tracking/trackerMessages";
import { clearSession, exportSessionCsv, formatGp, getCachedPrice, getSessionStatus, hasSession, hasSessionData, recordSession, showSession, } from "./ui/session";
import { addHistoryEntry, hasSeenMessage, markSeenMessage, showHistory, } from "./ui/history";
import { trackerVersion } from "./updates/updateNotes";
import { maybeShowUpdate, showPatchNotes, } from "./updates/updateToast";
import ChatReader, { ChatPosition } from "./chat/ChatReader";
import { createArtifactReader } from "./dialog/artifactCapture";
import { processMessages } from "./chatPoll";
import { createSettingsWindow } from "./ui/Settings";

import "./ui/style.css";

type SkillType =
  | "all"
  | "mining"
  | "woodcutting"
  | "fishing"
  | "farming"
  | "archaeology"
  | "seren"
  | "invention";

type InternalSkillType = SkillType | "other";

type TrackedItem = {
  count: number;
  goal: number | null;
  displayName?: string;
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
  storageId?: string;
};

type InventionFilter = "all" | "ancient" | "rare" | "uncommon" | "common";
type ArchFilter = "all" | Digsite;
type TrackableSkill = Exclude<SkillType, "all">;
type SkillSelection = Record<TrackableSkill, boolean>;
type SortMode = "recent" | "alpha" | "count";
type CountPosition = "right" | "left";

const trackerSizeMin = 10;
const trackerSizeMax = 16;
const trackerSizeDefault = 12;
const messageDurationMs = 5000;
const skillIconIds = new Set<InternalSkillType>([
  "mining",
  "woodcutting",
  "fishing",
  "farming",
  "archaeology",
  "invention",
  "seren",
]);

type SaveData = {
  chat?: string;
  activeTab?: InternalSkillType;
  fishingUsePorters?: boolean;
  shortInventionNames?: boolean;
  countPosition?: CountPosition;
  showAllTabIcons?: boolean;
  showInventionFilter?: boolean;
  showArchFilter?: boolean;
  showArchArtefacts?: boolean;
  visibleSkills?: Partial<SkillSelection>;
  hideUnknownSection?: boolean;
  trackerSize?: number;
  sortMode?: SortMode;
  items: Record<string, TrackedItem>;
};

const appName = "ResourceTracker";
const appColor = a1lib.mixColor(67, 188, 188);
const tabsToggleButton = document.querySelector(
  ".tabs-toggle",
) as HTMLElement | null;

const skillTabs = document.querySelector(".skill-tabs") as HTMLElement;
const skillScrollLeft = document.querySelector(
  ".skill-scroll-left",
) as HTMLButtonElement;
const skillScrollRight = document.querySelector(
  ".skill-scroll-right",
) as HTMLButtonElement;

const timestampRegex = /\[\d{2}:\d{2}:\d{2}\]/g;

const appCog = document.querySelector(".app-cog") as HTMLElement;
const sessionQuickButton = document.querySelector(
  ".session-quick-button",
) as HTMLElement | null;

const tracker = document.querySelector(".tracker") as HTMLElement;
const message = document.querySelector(".tracker-message") as HTMLElement;
const sortButton = document.querySelector(".sort-button") as HTMLElement;

const inventionFilters = document.querySelector(
  ".invention-filters",
) as HTMLElement;
const inventionFilterButton = document.querySelector(
  ".invention-filter-cycle",
) as HTMLElement;
const inventionAddButton = document.querySelector(
  ".invention-add-button",
) as HTMLButtonElement;
const inventionAddMenu = document.querySelector(
  ".invention-add-menu",
) as HTMLElement;
const archFilters = document.querySelector(
  ".archaeology-filters",
) as HTMLElement;
const archFilterButton = document.querySelector(
  ".archaeology-filter-cycle",
) as HTMLElement;

const savedData = getSaveData();

let inventionFilter: InventionFilter = "all";
let archFilter: ArchFilter = "all";
let inventionAddMenuOpen = false;
let activeSkillTab: SkillType = "all";
let sortMode: SortMode = "recent";
let fishingUsePorters = true;
let shortInventionNames = false;
let countPosition: CountPosition = "right";
let showAllTabIcons = true;
let showInventionFilter = true;
let showArchFilter = true;
let showArchArtefacts = true;
let visibleSkills: SkillSelection;
let hideUnknownSection = true;
let trackerSize = trackerSizeDefault;
let openSettingsItem: string | null = null;
let tabsCollapsed = false;
let reader = new ChatReader();
let chatFontState: "waiting" | "ready" = "waiting";
let activeChatFontName: string | null = null;
let messageTimer: number | undefined;

const archFilterCycle: ReadonlyArray<{
  filter: ArchFilter;
  label: string;
}> = [
  { filter: "all", label: "All" },
  { filter: "Kharid-et", label: "Kharid-et" },
  { filter: "Infernal Source", label: "Infernal Source" },
  { filter: "Everlight", label: "Everlight" },
  { filter: "Senntisten", label: "Senntisten" },
  { filter: "Stormguard", label: "Stormguard" },
  { filter: "Daemonheim", label: "Daemonheim" },
  { filter: "Warforge", label: "Warforge" },
  { filter: "Orthen", label: "Orthen" },
  { filter: "Moonrise", label: "Moonrise" },
];
const inventionFilterCycle: ReadonlyArray<{
  filter: InventionFilter;
  label: string;
}> = [
  { filter: "all", label: "All" },
  { filter: "ancient", label: "Ancient" },
  { filter: "rare", label: "Rare" },
  { filter: "uncommon", label: "Uncommon" },
  { filter: "common", label: "Common" },
];

const savedActiveTab = savedData.activeTab as string | undefined;
activeSkillTab =
  savedActiveTab === "other"
    ? "all"
    : ((savedData.activeTab || "all") as SkillType);
applySavedSettings(savedData);
sortMode = savedData.sortMode || "recent";

const artifactReader = createArtifactReader();

function openSession() {
  showSession(settingsWindow.refresh);
}

const settingsWindow = createSettingsWindow({
  getState: () => ({
    chatTypes: reader.pos?.boxes.map((box) => box.type) || [],
    selectedChat: getSaveData().chat || "0",
    fishingUsePorters,
    shortInventionNames,
    countPosition,
    showAllTabIcons,
    showInventionFilter,
    showArchFilter,
    showArchArtefacts,
    trackedSkills: visibleSkills,
    hideUnknownSection,
    trackerSize,
    sessionStatus: getSessionStatus(),
    hasSession: hasSession(),
    canExportSession: hasSessionData(),
    clearLabel: `Clear ${getActiveTabLabel()}`,
    canClear: hasItemsInTab(),
    resetLabel: `Reset ${getActiveTabLabel()}`,
    canReset: hasCountsInTab(),
    version: trackerVersion,
  }),
  selectChat,
  findChat: refreshChatboxes,
  showHistory,
  showSession: openSession,
  clearSession,
  exportSessionCsv,
  togglePorters,
  toggleShortNames,
  setCountPosition,
  toggleAllIcons,
  toggleInventionFilter,
  toggleArchFilter,
  toggleArchArtefacts,
  setSkillVisible,
  toggleUnknownSection,
  setTrackerSize,
  exportData,
  importData,
  clearTab,
  resetTabCounts,
  showPatchNotes,
});

window.setTimeout(function () {
  if (!window.alt1) {
    render();
    return;
  }

  reader.find();

  const findChat = setInterval(function () {
    if (reader.pos === null) {
      reader.find();
      return;
    }

    clearInterval(findChat);
    settingsWindow.refresh();
    selectSavedChat();
    showSelectedChat(reader.pos);
    chatFontState = "waiting";
    activeChatFontName = null;
    showMessage(getChatFontWaitMessage());
    render();

    const runReaderPoll = (readerName: "chat" | "dialog", read: () => void) => {
      try {
        read();
      } catch (error) {
        console.warn(`${readerName} reader failed`, error);
        showMessage("Tracking read failed. Click Find Chat if tracking stopped.");
      }
    };

    setInterval(() => runReaderPoll("chat", readChatbox), 600);

    // Keep both readers at 600 ms, but avoid blocking the UI by running
    // their synchronous OCR captures in the same interval callback.
    setTimeout(() => {
      runReaderPoll("dialog", readDialogBox);
      setInterval(
        () => runReaderPoll("dialog", readDialogBox),
        600,
      );
    }, 300);
  }, 1000);
}, 50);

if (window.alt1) {
  alt1.identifyAppUrl("./appconfig.json");
} else {
  const appUrl = `alt1://addapp/${new URL("./appconfig.json", document.location.href).href}`;
  showMessage(
    `Alt1 not detected. <a href='${appUrl}'>Add this app to Alt1</a>`,
    true,
  );
}

function selectChat(value: string) {
  if (!reader.pos || !reader.pos.boxes[Number(value)]) return;

  reader.pos.mainbox = reader.pos.boxes[Number(value)];
  showSelectedChat(reader.pos);

  saveSetting("chat", value);
  settingsWindow.refresh();
}

function resolveSavedChat(pos: ChatPosition, savedChat: string | undefined) {
  const savedIndex = Number(savedChat || "0");
  const index = pos.boxes[savedIndex] ? savedIndex : 0;

  return {
    box: pos.boxes[index],
    index,
  };
}

function selectSavedChat() {
  const pos = reader.pos;
  if (!pos) return;

  const data = getSaveData();
  const selected = resolveSavedChat(pos, data.chat);

  pos.mainbox = selected.box;

  data.chat = String(selected.index);
  saveData(data);
  settingsWindow.refresh();
}

function showSelectedChat(pos: ChatPosition) {
  if (!pos || !pos.mainbox) return;
  if (!alt1.permissionOverlay) return;

  alt1.overLayRect(
    appColor,
    pos.mainbox.rect.x,
    pos.mainbox.rect.y,
    pos.mainbox.rect.width,
    pos.mainbox.rect.height,
    2000,
    3,
  );
}

function readDialogBox() {
  const result = artifactReader.poll();
  if (!result) return;

  incrementItem(result.item, result.quantity, result.source);

  markSeenMessage(result.rawText);
  addHistoryEntry(result.rawText, "dialog");
}

function createPollTransaction() {
  let data: SaveData | null = null;
  let dirty = false;
  const highlightedItems = new Set<string>();

  return {
    increment(updates: ItemUpdate[], highlightItem?: string) {
      if (updates.length === 0) return;

      data ??= getSaveData();
      applyItemUpdatesToData(data, updates);
      recordSessionSafely(updates);
      buildHighlightedItems(updates, highlightItem).forEach((item) =>
        highlightedItems.add(item),
      );
      dirty = true;
    },
    commit() {
      if (!dirty || !data) return;
      saveData(data);
      render(highlightedItems, data);
    },
  };
}

function readChatbox() {
  const messages = reader.read();
  const selectedFontName = reader.selectedFontName;

  if (!selectedFontName) {
    if (chatFontState !== "waiting") {
      chatFontState = "waiting";
      activeChatFontName = null;
      showMessage(getChatFontWaitMessage());
    }
    return;
  }

  if (chatFontState !== "ready" || activeChatFontName !== selectedFontName) {
    chatFontState = "ready";
    activeChatFontName = selectedFontName;
    showMessage(`Tracking ${selectedFontName} chat.`);
  }

  const transaction = createPollTransaction();
  processMessages(messages, {
    hasProcessed: hasSeenMessage,
    processMessage: (message) =>
      processChatLine(message, transaction.increment),
    rememberProcessed: markSeenMessage,
    addHistory: (message) => addHistoryEntry(message, "chat"),
    commitChanges: transaction.commit,
  });
}

function getChatFontWaitMessage(): string {
  return "Waiting for readable 10pt, 12pt, 14pt, or 16pt chat. Change the RuneScape chat font, then click Find Chat.";
}

// Match the cleaned chat line against tracked drops.
function processChatLine(
  chatLine: string,
  increment: (updates: ItemUpdate[], highlightItem?: string) => void,
): boolean {
  const cleanLine = chatLine.replace(timestampRegex, "").trim();
  if (isIgnoredMessage(cleanLine)) return false;

  // Invention materials
  const inventionResult = processInventionMaterials(cleanLine);

  if (inventionResult) {
    increment(
      inventionResult.updates,
      inventionResult.updates[inventionResult.updates.length - 1].item,
    );

    return true;
  }

  const trackingResult = parseSkillMessage(cleanLine, {
    fishingUsePorters,
  });
  if (!trackingResult) return false;

  increment(
    trackingResult.updates,
    trackingResult.updates[trackingResult.updates.length - 1].item,
  );
  return true;
}

function getSkillIconHtml(itemData: TrackedItem) {
  if (activeSkillTab !== "all" || !showAllTabIcons) return "";

  const skill = itemData.skill;
  return skill && skillIconIds.has(skill)
    ? `<img class="item-prefix-icon" src="./icons/${skill}.png" alt=""> `
    : "";
}

function isDamagedArtefact(item: string) {
  return item.toLowerCase().includes("(damaged)");
}

function showMessage(text: string, markup = false) {
  window.clearTimeout(messageTimer);

  if (markup) {
    message.innerHTML = text;
  } else {
    message.innerText = text;
  }

  message.hidden = false;
  messageTimer = window.setTimeout(() => {
    message.replaceChildren();
    message.hidden = true;
  }, messageDurationMs);
}

function normalizeSaveData(value: unknown): SaveData {
  if (value === undefined) {
    return {
      sortMode: "recent",
      trackerSize: trackerSizeDefault,
      items: {},
    };
  }

  const data = value as Partial<SaveData>;

  return {
    chat: data.chat,
    activeTab: data.activeTab || "all",
    fishingUsePorters: data.fishingUsePorters ?? true,
    shortInventionNames: data.shortInventionNames ?? false,
    countPosition: data.countPosition === "left" ? "left" : "right",
    showAllTabIcons: data.showAllTabIcons ?? true,
    showInventionFilter: data.showInventionFilter ?? true,
    showArchFilter: data.showArchFilter ?? true,
    showArchArtefacts: data.showArchArtefacts ?? true,
    visibleSkills: normalizeSkillSelection(data.visibleSkills),
    hideUnknownSection: data.hideUnknownSection ?? true,
    trackerSize: normalizeTrackerSize(data.trackerSize),
    sortMode: data.sortMode || "recent",
    items: data.items || {},
  };
}

function applySavedSettings(data: SaveData) {
  fishingUsePorters = data.fishingUsePorters ?? true;
  shortInventionNames = data.shortInventionNames ?? false;
  countPosition = data.countPosition === "left" ? "left" : "right";
  showAllTabIcons = data.showAllTabIcons ?? true;
  showInventionFilter = data.showInventionFilter ?? true;
  showArchFilter = data.showArchFilter ?? true;
  showArchArtefacts = data.showArchArtefacts ?? true;
  visibleSkills = normalizeSkillSelection(data.visibleSkills);
  hideUnknownSection = data.hideUnknownSection ?? true;
  trackerSize = data.trackerSize ?? trackerSizeDefault;
}

function getSaveData(): SaveData {
  const raw = localStorage.getItem(appName);

  if (!raw) {
    return normalizeSaveData(undefined);
  }

  try {
    return normalizeSaveData(JSON.parse(raw));
  } catch {
    return normalizeSaveData(undefined);
  }
}

function saveData(data: SaveData) {
  localStorage.setItem(appName, JSON.stringify(data));
}

function saveSetting<Field extends keyof SaveData>(
  field: Field,
  value: SaveData[Field],
) {
  const data = getSaveData();
  data[field] = value;
  saveData(data);
}

function ensureItem(data: SaveData, item: string) {
  if (!data.items[item]) {
    data.items[item] = {
      count: 0,
      goal: null,
    };
  }
}

function applyItemUpdate(
  data: SaveData,
  update: ItemUpdate,
  timestamp: number,
) {
  const id = getUpdateId(update);
  ensureItem(data, id);

  data.items[id].count += update.amount;
  data.items[id].skill = update.skill;
  data.items[id].lastUpdated = timestamp;
  if (update.storageId) {
    data.items[id].displayName = update.item;
  }

  if (update.colorClass) {
    data.items[id].colorClass = update.colorClass;
  }

  if (update.source) {
    data.items[id].source = update.source;
  }
}

function applyItemUpdatesToData(data: SaveData, updates: ItemUpdate[]) {
  const timestamp = Date.now();
  for (const update of updates) applyItemUpdate(data, update, timestamp);
}

function recordSessionSafely(updates: ItemUpdate[]) {
  try {
    recordSession(updates);
  } catch (error) {
    console.warn("Session update failed", error);
  }
}

function buildHighlightedItems(updates: ItemUpdate[], highlightItem?: string) {
  const highlightedItems = new Set(updates.map(getUpdateId));

  if (highlightItem) {
    const highlightedUpdate = updates.find(
      (update) => update.item === highlightItem,
    );
    highlightedItems.add(
      highlightedUpdate ? getUpdateId(highlightedUpdate) : highlightItem,
    );
  }

  return highlightedItems;
}

function incrementItems(updates: ItemUpdate[], highlightItem?: string) {
  if (updates.length === 0) return;

  const data = getSaveData();
  applyItemUpdatesToData(data, updates);
  recordSessionSafely(updates);
  saveData(data);
  render(buildHighlightedItems(updates, highlightItem), data);
}

function incrementItem(
  item: string,
  amount: number = 1,
  skill: InternalSkillType = "other",
  colorClass?: string,
  source?: string,
) {
  incrementItems(
    [
      {
        item,
        amount,
        skill,
        colorClass,
        source,
      },
    ],
    item,
  );
}

function render(highlightItems?: Set<string>, data = getSaveData()) {
  const items = Object.keys(data.items).filter((item) => {
    if (activeSkillTab === "all") return isSkillVisible(data.items[item].skill);
    return (data.items[item].skill || "other") === activeSkillTab;
  });

  sortItems(items, data);

  tracker.innerHTML = "";

  if (activeSkillTab === "mining") {
    renderMiningNotice();
  }

  if (activeSkillTab === "farming") {
    renderFarmingNotice();
  }

  if (items.length === 0) {
    tracker.insertAdjacentHTML(
      "beforeend",
      `<div class="empty">No tracked items yet...</div>`,
    );
    return;
  }

  if (activeSkillTab === "all") {
    renderAllTab(items, data, highlightItems);
    return;
  }

  if (activeSkillTab === "archaeology") {
    const materials = items.filter(function (item) {
      return !isDamagedArtefact(item) && matchesArchFilter(item);
    });

    const artefacts = showArchArtefacts
      ? items.filter(function (item) {
          return isDamagedArtefact(item);
        })
      : [];

    if (materials.length > 0) {
      renderItemGroup("Materials", materials, data, highlightItems);
    }

    if (artefacts.length > 0) {
      renderItemGroup("Artefacts", artefacts, data, highlightItems);
    }

    return;
  }

  if (activeSkillTab === "invention") {
    if (inventionFilter === "all" || !showInventionFilter) {
      for (const item of items) {
        renderItemRow(item, data.items[item], highlightItems);
      }

      return;
    }

    const ancientItems = items.filter(
      (item) => data.items[item].source === "ancient-components",
    );

    const rareItems = items.filter(
      (item) => data.items[item].source === "rare-components",
    );

    const uncommonItems = items.filter(
      (item) => data.items[item].source === "uncommon-components",
    );

    const commonItems = items.filter(
      (item) =>
        data.items[item].source === "invention" || !data.items[item].source,
    );

    if (inventionFilter === "ancient") {
      renderItemGroup("Ancient Components", ancientItems, data, highlightItems);
    }

    if (inventionFilter === "rare") {
      renderItemGroup("Rare Components", rareItems, data, highlightItems);
    }

    if (inventionFilter === "uncommon") {
      renderItemGroup(
        "Uncommon Components",
        uncommonItems,
        data,
        highlightItems,
      );
    }

    if (inventionFilter === "common") {
      renderItemGroup("Common Components", commonItems, data, highlightItems);
    }

    return;
  }

  renderGoalSortedTab(items, data, highlightItems);
}

function renderMiningNotice() {
  tracker.insertAdjacentHTML(
    "beforeend",
    `<div class="skill-tracking-notice" title="Porters and similar chat messages can be tracked.">Tracking requires bank-teleport chat messages.</div>`,
  );
}

function renderFarmingNotice() {
  tracker.insertAdjacentHTML(
    "beforeend",
    `<div class="skill-tracking-notice" title="Porters, Farming cape procs, and similar chat messages can be tracked.">Tracking requires bank-teleport chat messages.</div>`,
  );
}

function updateTabsCollapsedUi() {
  document.body.classList.toggle("tabs-collapsed", tabsCollapsed);

  if (!tabsToggleButton) return;

  tabsToggleButton.innerText = tabsCollapsed ? "+" : "−";
  tabsToggleButton.title = tabsCollapsed ? "Exit Compact Mode" : "Compact Mode";
}

function renderAllTab(
  items: string[],
  data: SaveData,
  highlightItems?: Set<string>,
) {
  renderGoalSortedTab(items, data, highlightItems, true);
}
function renderGoalSortedTab(
  items: string[],
  data: SaveData,
  highlightItems?: Set<string>,
  includeUnknown = false,
) {
  const goalItems = items.filter((item) => data.items[item].goal !== null);

  const unknownItems = includeUnknown && !hideUnknownSection
    ? items.filter(
      (item) =>
        data.items[item].goal === null &&
        (data.items[item].skill || "other") === "other",
    )
    : [];

  const sortedItems = items.filter(
    (item) =>
      data.items[item].goal === null &&
      (!includeUnknown || (data.items[item].skill || "other") !== "other"),
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
  highlightItems?: Set<string>,
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
  highlightItems?: Set<string>,
) {
  const row = document.createElement("div");
  row.className = `item-row ${openSettingsItem === item ? "settings-open" : ""}`;
  row.dataset.item = item;

  let goalHtml = "";
  let goalTooltip = "";

  if (itemData.goal) {
    const goalReached = itemData.count >= itemData.goal;
    const overage = itemData.count - itemData.goal;
    const overageText = overage > 0 ? ` (+${overage.toLocaleString()})` : "";

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

  const displayPrefixHtml = getSkillIconHtml(itemData);
  const displayName = titleCase(
    getItemName(
      itemData.displayName || item,
      itemData.skill,
      shortInventionNames,
    ),
  );
  let statsHtml = "";

  if (openSettingsItem === item) {
    const price = getCachedPrice(itemData.displayName || item);
    const unitPrice = typeof price === "number" ? formatGp(price) : "—";
    const totalValue = typeof price === "number"
      ? formatGp(itemData.count * price)
      : "—";

    statsHtml = `
		<div class="item-stats">
			<span>Price: <strong>${unitPrice}</strong></span>
			<span>Total value: <strong>${totalValue}</strong></span>
		</div>
	`;
  }

  row.innerHTML = `
		<div class="item-main-row"
			 role="button"
			 tabindex="0"
			 aria-expanded="${openSettingsItem === item}"
			 aria-label="Edit ${escapeAttr(displayName)}">
			<div class="item-text">
				<strong class="${escapeAttr(itemData.colorClass || "")}">
					${displayPrefixHtml}${escapeHtml(displayName)}
				</strong>
			</div>

			<div class="item-count">
    			${itemData.count.toLocaleString()}
			</div>
		</div>

		${goalHtml}

		${openSettingsItem === item ? `
		<div class="item-settings-panel">
			<input type="number"
				   id="goal-${escapeAttr(item)}"
				   placeholder="Goal"
				   value="${itemData.goal || ""}">

			<button class="clear-goal icon-btn" title="Clear Goal">
				<img src="./icons/clear-goal.png" alt="Clear Goal">
			</button>

			<button class="save-goal icon-btn" title="Set Goal">
				<img src="./icons/save-goal.png" alt="Set Goal">
			</button>

			<span class="button-separator">•</span>

			<button class="reset-item icon-btn" title="Reset Count">
				<img src="./icons/reset-count.png" alt="Reset Count">
			</button>

			<button class="delete-item icon-btn" title="Delete Item">
				<img src="./icons/delete-item.png" alt="Delete Item">
			</button>
		</div>
		` : ""}

		${statsHtml}
	`;

  if (highlightItems?.has(item)) {
    row.classList.add("highlight");
  }

  tracker.appendChild(row);
}

function sortItems(items: string[], data: SaveData) {
  if (sortMode === "recent") {
    items.sort(
      (a, b) =>
        (data.items[b].lastUpdated || 0) - (data.items[a].lastUpdated || 0),
    );
    return;
  }

  if (sortMode === "count") {
    items.sort((a, b) => data.items[b].count - data.items[a].count);
    return;
  }

  items.sort((a, b) =>
    (data.items[a].displayName || a).localeCompare(
      data.items[b].displayName || b,
    ),
  );
}

function togglePorters() {
  fishingUsePorters = !fishingUsePorters;
  saveSetting("fishingUsePorters", fishingUsePorters);

  settingsWindow.refresh();
  render();
}

function toggleShortNames() {
  shortInventionNames = !shortInventionNames;
  saveSetting("shortInventionNames", shortInventionNames);

  settingsWindow.refresh();
  render();
}

function updateCountPositionUi() {
  document.body.classList.toggle("counts-left", countPosition === "left");
}

function normalizeSkillSelection(value: unknown): SkillSelection {
  const savedSelection = value as Partial<SkillSelection> | undefined;
  return {
    mining: savedSelection?.mining ?? true,
    woodcutting: savedSelection?.woodcutting ?? true,
    fishing: savedSelection?.fishing ?? false,
    farming: savedSelection?.farming ?? false,
    archaeology: savedSelection?.archaeology ?? true,
    invention: savedSelection?.invention ?? true,
    seren: savedSelection?.seren ?? true,
  };
}

function isSkillVisible(skill: InternalSkillType | undefined) {
  if (!skill || skill === "all" || skill === "other") return true;
  return visibleSkills[skill];
}

function setCountPosition(position: CountPosition) {
    if (countPosition === position) return;
    countPosition = position;
    saveSetting("countPosition", countPosition);

    updateCountPositionUi();
    settingsWindow.refresh();
}

function normalizeTrackerSize(value: unknown): number {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= trackerSizeMin &&
    value <= trackerSizeMax
  ) {
    return value;
  }

  return trackerSizeDefault;
}

function toggleAllIcons() {
  showAllTabIcons = !showAllTabIcons;
  saveSetting("showAllTabIcons", showAllTabIcons);

  settingsWindow.refresh();
  render();
}

function toggleInventionFilter() {
  showInventionFilter = !showInventionFilter;
  saveSetting("showInventionFilter", showInventionFilter);

  updateInventionFilterUi();
  settingsWindow.refresh();
  render();
}

function toggleArchFilter() {
  showArchFilter = !showArchFilter;
  saveSetting("showArchFilter", showArchFilter);

  updateArchFilterUi();
  settingsWindow.refresh();
  render();
}

function toggleArchArtefacts() {
  showArchArtefacts = !showArchArtefacts;
  saveSetting("showArchArtefacts", showArchArtefacts);

  settingsWindow.refresh();
  render();
}

function setSkillVisible(skill: TrackableSkill, visible: boolean) {
  if (visibleSkills[skill] === visible) return;

  visibleSkills = {
    ...visibleSkills,
    [skill]: visible,
  };
  saveSetting("visibleSkills", visibleSkills);

  updateSkillTabs();
  settingsWindow.refresh();
  render();
}

function toggleUnknownSection() {
  hideUnknownSection = !hideUnknownSection;
  saveSetting("hideUnknownSection", hideUnknownSection);

  settingsWindow.refresh();
  render();
}

function updateTrackerSizeUi() {
  tracker.style.setProperty("--tracker-size", `${trackerSize}px`);
}

function setTrackerSize(value: number, persist: boolean) {
  trackerSize = normalizeTrackerSize(value);
  updateTrackerSizeUi();

  if (persist) {
    saveSetting("trackerSize", trackerSize);
  }

  settingsWindow.refresh();
}

// Hide invention filters when not on invention tab
function updateInventionFilterUi() {
  if (!inventionFilters) return;

  const visible = activeSkillTab === "invention" && showInventionFilter;
  inventionFilters.classList.toggle("visible", visible);

  if (!visible) {
    inventionAddMenuOpen = false;
    updateInventionAddMenu();
  }
}

function updateArchFilterUi() {
  if (!archFilters) return;

  archFilters.classList.toggle(
    "visible",
    activeSkillTab === "archaeology" && showArchFilter,
  );
}

function updateSkillTabs() {
  const enabledSkills = (Object.keys(visibleSkills) as TrackableSkill[]).filter(
    (skill) => visibleSkills[skill],
  );
  const showAllTab = enabledSkills.length !== 1;

  document.querySelectorAll<HTMLElement>(".skill-tab").forEach((tab) => {
    if (tab.dataset.skill === "all") {
      tab.hidden = !showAllTab;
      return;
    }

    const skill = tab.dataset.skill as TrackableSkill | undefined;
    if (!skill) return;
    tab.hidden = !visibleSkills[skill];
  });

  const nextActiveTab =
    activeSkillTab === "all" && enabledSkills.length === 1
      ? enabledSkills[0]
      : activeSkillTab !== "all" && !visibleSkills[activeSkillTab]
        ? enabledSkills.length === 1
          ? enabledSkills[0]
          : "all"
        : activeSkillTab;

  if (nextActiveTab !== activeSkillTab) {
    activeSkillTab = nextActiveTab;
    saveSetting("activeTab", activeSkillTab);

    document.querySelectorAll<HTMLElement>(".skill-tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.skill === activeSkillTab);
    });
    updateInventionFilterUi();
    updateArchFilterUi();
    settingsWindow.refresh();
  }

  updateSkillTabScrollButtons();
}

function updateArchFilterButton() {
  if (!archFilterButton) return;

  const activeFilter = archFilterCycle.find(
    (entry) => entry.filter === archFilter,
  );
  archFilterButton.innerText = `Dig Site: ${activeFilter!.label}`;
}

function normalizeMaterialName(value: string) {
  return value.trim().toLowerCase();
}

function matchesArchFilter(item: string) {
  if (archFilter === "all" || !showArchFilter) return true;

  const normalizedItem = normalizeMaterialName(item);
  return digsiteMaterials[archFilter].some(
    (material) => normalizeMaterialName(material) === normalizedItem,
  );
}

function updateInventionFilterButton() {
  if (!inventionFilterButton) return;

  const activeFilter = inventionFilterCycle.find(
    (entry) => entry.filter === inventionFilter,
  );
  inventionFilterButton.innerText = `Filter: ${activeFilter!.label}`;
}

function getAvailableInventionMaterials(
  data: SaveData,
): readonly InventionOption[] {
  return getInventionOption().filter(
    (material) =>
      (inventionFilter === "all" || material.filter === inventionFilter) &&
      !data.items[material.item],
  );
}

function updateInventionAddMenu() {
  const data = getSaveData();
  const materials = getAvailableInventionMaterials(data);
  inventionAddMenu.replaceChildren();

  for (const material of materials) {
    const button = document.createElement("button");
    button.className = [
      "invention-add-option",
      material.colorClass || "invention-part-option",
    ].join(" ");
    button.type = "button";
    button.dataset.material = material.item;
    button.textContent = titleCase(material.item);
    inventionAddMenu.append(button);
  }

  const addAllButton = document.createElement("button");
  addAllButton.className = "invention-add-all-option";
  addAllButton.type = "button";
  addAllButton.dataset.action = "add-all";
  addAllButton.textContent = "Add All";
  inventionAddMenu.append(addAllButton);

  inventionAddMenu.hidden = !inventionAddMenuOpen;
  inventionAddButton.disabled = materials.length === 0;
  inventionAddButton.title = materials.length === 0
    ? "All materials in this filter are already tracked"
    : "Add an Invention material";
}

function addInventionMaterials(items: readonly string[]) {
  const data = getSaveData();
  const optionsByItem = new Map(
    getInventionOption().map((option) => [option.item, option]),
  );
  const addedItems: string[] = [];

  for (const item of items) {
    const material = optionsByItem.get(item);
    if (!material || data.items[material.item]) continue;

    data.items[material.item] = {
      count: 0,
      goal: null,
      skill: "invention",
      source: material.source,
      colorClass: material.colorClass,
    };
    addedItems.push(material.item);
  }

  if (addedItems.length === 0) {
    updateInventionAddMenu();
    return;
  }

  saveData(data);

  inventionAddMenuOpen = false;
  updateInventionAddMenu();
  render();
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
}

function getActiveTabLabel() {
  if (activeSkillTab === "all") return "ALL";
  if (activeSkillTab === "seren") return "Spirits";

  return titleCase(activeSkillTab);
}

function getSortedGroupLabel() {
  if (sortMode === "recent") return "Recent";
  if (sortMode === "alpha") return "A-Z";
  return "Count";
}

function getSkillTabScrollStep() {
  const tab = skillTabs.querySelector(".skill-tab") as HTMLElement | null;
  if (!tab) return 28;

  const styles = getComputedStyle(skillTabs);
  const gap = parseFloat(styles.columnGap) || 0;

  return tab.getBoundingClientRect().width + gap;
}

function updateSkillTabScrollButtons() {
  const maxScrollLeft = skillTabs.scrollWidth - skillTabs.clientWidth;

  const hasOverflow = maxScrollLeft > 1;

  skillScrollLeft.hidden = !hasOverflow || skillTabs.scrollLeft <= 1;

  skillScrollRight.hidden =
    !hasOverflow || skillTabs.scrollLeft >= maxScrollLeft - 1;
}

skillScrollLeft.addEventListener("click", () => {
  skillTabs.scrollBy({
    left: -getSkillTabScrollStep(),
    behavior: "smooth",
  });
});

skillScrollRight.addEventListener("click", () => {
  skillTabs.scrollBy({
    left: getSkillTabScrollStep(),
    behavior: "smooth",
  });
});

skillTabs.addEventListener("scroll", updateSkillTabScrollButtons);

new ResizeObserver(() => {
    updateSkillTabScrollButtons();
}).observe(skillTabs);

requestAnimationFrame(updateSkillTabScrollButtons);

document.querySelectorAll(".skill-tab").forEach((tab) => {
  tab.addEventListener("click", (e: Event) => {
    const target = e.currentTarget as HTMLElement;

    activeSkillTab = (target.dataset.skill as SkillType) || "all";
    saveSetting("activeTab", activeSkillTab);

    document.querySelectorAll(".skill-tab").forEach((btn) => {
      btn.classList.remove("active");
    });

    target.classList.add("active");

    updateInventionFilterUi();
    updateArchFilterUi();
    settingsWindow.refresh();
    render();
  });
});

function toggleSettings(item: string) {
  const data = getSaveData();
  if (!data.items[item]) return;
  openSettingsItem = openSettingsItem === item ? null : item;

  render();
}

function cycleSortMode() {
  sortMode =
    sortMode === "recent" ? "alpha" : sortMode === "alpha" ? "count" : "recent";
  saveSetting("sortMode", sortMode);

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
      showMessage("Goal must be a positive number.");
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

  reader = new ChatReader();
  chatFontState = "waiting";
  activeChatFontName = null;

  const found = reader.find() as ChatPosition | null;

  if (!found || found.boxes.length === 0) {
    showMessage("No chatbox found.");
    return;
  }

  reader.pos = found;
  settingsWindow.refresh();

  const data = getSaveData();
  const selected = resolveSavedChat(found, data.chat);

  found.mainbox = selected.box;

  data.chat = String(selected.index);
  saveData(data);
  settingsWindow.refresh();

  showSelectedChat(found);
  showMessage(getChatFontWaitMessage());
}

function clearTab() {
  const data = getSaveData();

  if (activeSkillTab === "all") {
    data.items = {};
    openSettingsItem = null;

    saveData(data);
    render();
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
}

function hasItemsInTab() {
  const items = Object.values(getSaveData().items);

  return activeSkillTab === "all"
    ? items.length > 0
    : items.some((item) => (item.skill || "other") === activeSkillTab);
}

function hasCountsInTab() {
  return Object.values(getSaveData().items).some(
    (item) =>
      item.count !== 0 &&
      (activeSkillTab === "all" ||
        (item.skill || "other") === activeSkillTab),
  );
}

function resetTabCounts() {
  const data = getSaveData();

  for (const item of Object.values(data.items)) {
    if (
      activeSkillTab === "all" ||
      (item.skill || "other") === activeSkillTab
    ) {
      item.count = 0;
    }
  }

  saveData(data);
  render();
}

function exportData() {
  const data = getSaveData();

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "Resource-Tracker-save.json";
  link.click();
  URL.revokeObjectURL(url);
}

function importData(file: File) {
  const reader = new FileReader();

  reader.onload = function () {
    try {
      const data = normalizeSaveData(JSON.parse(reader.result as string));

      saveData(data);
      openSettingsItem = null;
      applySavedSettings(data);

      updateCountPositionUi();
      updateInventionFilterUi();
      updateArchFilterUi();
      updateSkillTabs();
      updateTrackerSizeUi();
      settingsWindow.refresh();
      render();
    } catch {
      showMessage("Import failed.");
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

function getItemName(
  itemName: string,
  skill: InternalSkillType | undefined,
  useShortInventionNames: boolean,
) {
  if (!useShortInventionNames || skill !== "invention") return itemName;

  return itemName.replace(/\s+(?:components|parts)$/i, "");
}

function escapeAttr(value: string) {
  return escapeHtml(value);
}

function bindRowEvents() {
  tracker.addEventListener("click", (e: Event) => {
    const clicked = e.target as HTMLElement;
    const itemRow = clicked.closest(
      ".item-row[data-item]",
    ) as HTMLElement | null;
    if (!itemRow) return;

    const target = clicked.closest(".icon-btn") as HTMLElement | null;

    if (target) {
      const item = itemRow.dataset.item || "";

      if (target.classList.contains("clear-goal")) {
        clearGoal(item);
      } else if (target.classList.contains("save-goal")) {
        setGoal(item);
      } else if (target.classList.contains("reset-item")) {
        resetItem(item);
      } else if (target.classList.contains("delete-item")) {
        deleteItem(item);
      }
      return;
    }

    if (clicked.closest(".item-settings-panel")) return;

    if (itemRow) toggleSettings(itemRow.dataset.item || "");
  });

  tracker.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;

    const mainRow = e.target as HTMLElement;
    if (!mainRow.classList.contains("item-main-row")) return;

    const itemRow = mainRow.closest(
      ".item-row[data-item]",
    ) as HTMLElement | null;
    if (!itemRow) return;

    e.preventDefault();
    toggleSettings(itemRow.dataset.item || "");
  });
}

bindRowEvents();

document.querySelectorAll(".skill-tab").forEach((btn) => {
  btn.classList.remove("active");
});

const savedTabButton = document.querySelector(
  `.skill-tab[data-skill="${activeSkillTab}"]`,
);

if (savedTabButton) {
  savedTabButton.classList.add("active");
}

updateInventionFilterButton();
updateInventionFilterUi();
updateArchFilterButton();
updateArchFilterUi();
updateSkillTabs();
updateInventionAddMenu();
updateSortButtonLabel();
settingsWindow.refresh();
maybeShowUpdate();
updateTabsCollapsedUi();
updateCountPositionUi();
updateTrackerSizeUi();
updateSkillTabScrollButtons();
render();

tabsToggleButton?.addEventListener("click", function () {
  tabsCollapsed = !tabsCollapsed;
  updateTabsCollapsedUi();
});

appCog?.addEventListener("click", function () {
  settingsWindow.show();
});

sessionQuickButton?.addEventListener("click", openSession);

sortButton?.addEventListener("click", cycleSortMode);

inventionFilterButton?.addEventListener("click", () => {
  const currentIndex = inventionFilterCycle.findIndex(
    (entry) => entry.filter === inventionFilter,
  );
  const nextIndex = (currentIndex + 1) % inventionFilterCycle.length;
  inventionFilter = inventionFilterCycle[nextIndex].filter;

  updateInventionFilterButton();
  updateInventionAddMenu();
  render();
});

archFilterButton?.addEventListener("click", () => {
  const currentIndex = archFilterCycle.findIndex(
    (entry) => entry.filter === archFilter,
  );
  const nextIndex = (currentIndex + 1) % archFilterCycle.length;
  archFilter = archFilterCycle[nextIndex].filter;

  updateArchFilterButton();
  render();
});

inventionAddButton?.addEventListener("click", () => {
  if (inventionAddButton.disabled) return;
  inventionAddMenuOpen = !inventionAddMenuOpen;
  updateInventionAddMenu();
});

inventionAddMenu?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest(
    "button[data-material], button[data-action]",
  ) as HTMLButtonElement | null;
  if (!button) return;

  if (button.dataset.action === "add-all") {
    addInventionMaterials(
      getAvailableInventionMaterials(getSaveData()).map((material) => material.item),
    );
    return;
  }

  addInventionMaterials([button.dataset.material || ""]);
});
