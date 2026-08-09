import * as a1lib from "alt1/base";
import { processInventionMaterials } from "./invention/InventionParser";
import { parseSkillTrackerMessage } from "./tracking/SkillTracker";
import {
  recordSessionUpdates,
  showSessionWindow,
  getSessionStatus,
} from "./ui/session";
import {
  addTrackedHistoryEntry,
  hasProcessedChatMessage,
  rememberProcessedChatMessage,
  showChatHistory,
} from "./ui/history";
import { /*RT_DISCORD_INVITE_URL,*/ RT_VERSION } from "./updates/updateNotes";
import {
  maybeShowUpdateToast,
  showPatchNotesModal,
} from "./updates/updateToast";
import ResourceChatReader, { ChatboxPosition } from "./chat/ChatReader";
import { createArtifactCaptureReader } from "./dialog/artifactCapture";
import { processChatPollMessages } from "./chatPoll";
import { createSettingsWindowController } from "./ui/Settings";

import "./index.html";
import "./appconfig.json";
import "./ui/style.css";

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
  storageKey?: string;
};

type InventionFilter = "all" | "ancient" | "rare" | "uncommon" | "common";
type SortMode = "recent" | "alpha" | "count";

type SaveData = {
  chat?: string;
  activeTab?: InternalSkillType;
  fishingUsePorters?: boolean;
  shortInventionNames?: boolean;
  sortMode?: SortMode;
  items: Record<string, TrackedItem>;
};

const appName = "ResourceTracker";
const appColor = a1lib.mixColor(67, 188, 188);
const tabsToggleButton = document.querySelector(
  ".tabs-toggle",
) as HTMLElement | null;
const compactSortButton = document.querySelector(
  ".compact-sort-button",
) as HTMLElement | null;
const compactSettingsButton = document.querySelector(
  ".compact-settings-button",
) as HTMLElement | null;

const timestampRegex = /\[\d{2}:\d{2}:\d{2}\]/g;

const appCog = document.querySelector(".app-cog") as HTMLElement;
const sessionQuickButton = document.querySelector(
  ".session-quick-button",
) as HTMLElement | null;

const tracker = document.querySelector(".tracker") as HTMLElement;
const status = document.querySelector(".status") as HTMLElement;
const sortButton = document.querySelector(".sort-button") as HTMLElement;

const inventionFilters = document.querySelector(
  ".invention-filters",
) as HTMLElement;
const inventionFilterButton = document.querySelector(
  ".invention-filter-cycle",
) as HTMLElement;

const savedData = getSaveData();

let inventionFilter: InventionFilter = "all";
let activeSkillTab: SkillType = "all";
let sortMode: SortMode = "recent";
let fishingUsePorters = true;
let shortInventionNames = false;
let openSettingsItem: string | null = null;
let tabsCollapsed = false;
let reader = new ResourceChatReader();
let chatFontState: "waiting" | "ready" = "waiting";
let activeChatFontName: string | null = null;

const savedActiveTab = savedData.activeTab as string | undefined;
activeSkillTab =
  savedActiveTab === "other"
    ? "all"
    : ((savedData.activeTab || "all") as SkillType);
fishingUsePorters = savedData.fishingUsePorters ?? true;
shortInventionNames = savedData.shortInventionNames ?? false;
sortMode = savedData.sortMode || "recent";

const artifactCaptureReader = createArtifactCaptureReader();
const settingsWindow = createSettingsWindowController({
  getState: () => ({
    chatCount: reader.pos?.boxes.length || 0,
    selectedChat: getSaveData().chat || "0",
    fishingUsePorters,
    shortInventionNames,
    sessionStatus: getSessionStatus(),
    clearLabel: `Clear ${getActiveTabLabel()}`,
    version: RT_VERSION,
  }),
  selectChat,
  findChat: refreshChatboxes,
  showHistory: showChatHistory,
  showSession: showSessionWindow,
  toggleFishingPorters,
  toggleShortInventionNames,
  exportData,
  importData,
  clearCurrentTab,
  showPatchNotes: showPatchNotesModal,
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
      status.innerText = "Looking for chatbox...";
      return;
    }

    clearInterval(findChat);
    populateChatSelector();
    selectSavedChat();
    showSelectedChat(reader.pos);
    chatFontState = "waiting";
    activeChatFontName = null;
    status.innerText = supportedChatFontWaitingMessage();
    render();

    const runReaderPoll = (readerName: "chat" | "dialog", read: () => void) => {
      try {
        read();
      } catch (error) {
        console.warn(`${readerName} reader failed`, error);
        status.innerText =
          "Tracking read failed. Click Find Chat if tracking stopped.";
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
  const addappurl = `alt1://addapp/${new URL("./appconfig.json", document.location.href).href}`;
  status.innerHTML = `Alt1 not detected. <a href='${addappurl}'>Add this app to Alt1</a>`;
}

function populateChatSelector() {
  settingsWindow.refresh();
}

function selectChat(value: string) {
  if (!reader.pos || !reader.pos.boxes[Number(value)]) return;

  reader.pos.mainbox = reader.pos.boxes[Number(value)];
  showSelectedChat(reader.pos);

  const data = getSaveData();
  data.chat = value;
  saveData(data);
  settingsWindow.refresh();
  status.innerText = `Using Chat ${value}.`;
}

function selectSavedChat() {
  if (!reader.pos) return;

  const data = getSaveData();
  const savedChat = data.chat || "0";

  reader.pos.mainbox =
    reader.pos.boxes[Number(savedChat)] || reader.pos.boxes[0];

  data.chat = savedChat;
  saveData(data);
  settingsWindow.refresh();
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
    3,
  );
}

function readDialogBox() {
  const result = artifactCaptureReader.poll();
  if (!result) return;

  incrementItem(result.item, result.quantity, result.source);
  setStatus(`Added: ${result.item}`);

  rememberProcessedChatMessage(result.rawText);
  addTrackedHistoryEntry(result.rawText, "dialog");
}

type IncrementItems = (updates: ItemUpdate[], highlightItem?: string) => void;

function createChatPollMainTransaction() {
  let data: SaveData | null = null;
  let dirty = false;
  const highlightedItems = new Set<string>();

  return {
    incrementItems(updates: ItemUpdate[], highlightItem?: string) {
      if (updates.length === 0) return;

      data ??= getSaveData();
      applyItemUpdatesToData(data, updates);
      recordSessionUpdatesSafely(updates);
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
      status.innerText = supportedChatFontWaitingMessage();
    }
    return;
  }

  if (chatFontState !== "ready" || activeChatFontName !== selectedFontName) {
    chatFontState = "ready";
    activeChatFontName = selectedFontName;
    status.innerText = `Tracking ${selectedFontName} chat.`;
  }

  const transaction = createChatPollMainTransaction();
  processChatPollMessages(messages, {
    hasProcessedMessage: hasProcessedChatMessage,
    processMessage: (message) =>
      processHarvestLine(message, transaction.incrementItems),
    rememberProcessedMessage: rememberProcessedChatMessage,
    addTrackedHistory: (message) => addTrackedHistoryEntry(message, "chat"),
    commitMainChanges: transaction.commit,
  });
}

function supportedChatFontWaitingMessage(): string {
  return "Waiting for readable 10pt, 12pt, 14pt, or 16pt chat. Change the RuneScape chat font, then click Find Chat.";
}

// Process a single chat line to check for harvesting events
function processHarvestLine(
  chatLine: string,
  incrementTrackedItems: IncrementItems,
): boolean {
  const cleanLine = chatLine.replace(timestampRegex, "").trim();

  // Invention materials
  const inventionResult = processInventionMaterials(cleanLine);

  if (inventionResult) {
    incrementTrackedItems(
      inventionResult.updates,
      inventionResult.updates[inventionResult.updates.length - 1].item,
    );

    setStatus(inventionResult.statusMessage);

    return true;
  }

  const trackingResult = parseSkillTrackerMessage(cleanLine, {
    fishingUsePorters,
  });
  if (!trackingResult) return false;

  incrementTrackedItems(
    trackingResult.updates,
    trackingResult.updates[trackingResult.updates.length - 1].item,
  );
  setStatus(trackingResult.statusMessage);
  return true;
}

function getItemDisplayPrefixHtml(itemData: TrackedItem) {
  if (activeSkillTab !== "all") return "";

  if (itemData.skill === "mining") {
    return `<img class="item-prefix-icon" src="./icons/mining.png" alt=""> `;
  }
  if (itemData.skill === "woodcutting") {
    return `<img class="item-prefix-icon" src="./icons/woodcutting.png" alt=""> `;
  }
  if (itemData.skill === "fishing") {
    return `<img class="item-prefix-icon" src="./icons/fishing.png" alt=""> `;
  }
  if (itemData.skill === "archaeology") {
    return `<img class="item-prefix-icon" src="./icons/archaeology.png" alt=""> `;
  }
  if (itemData.skill === "invention") {
    return `<img class="item-prefix-icon" src="./icons/invention.png" alt=""> `;
  }
  if (itemData.skill === "seren") {
    return `<img class="item-prefix-icon" src="./icons/seren.png" alt=""> `;
  }

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
      shortInventionNames: data.shortInventionNames ?? false,
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
    };
  }
}

function applyItemUpdate(
  data: SaveData,
  update: ItemUpdate,
  timestamp: number,
) {
  const key = update.storageKey || update.item;
  ensureItem(data, key);

  data.items[key].count += update.amount;
  data.items[key].skill = update.skill;
  data.items[key].lastUpdated = timestamp;
  if (update.storageKey) {
    data.items[key].displayName = update.item;
  }

  if (update.colorClass) {
    data.items[key].colorClass = update.colorClass;
  }

  if (update.source) {
    data.items[key].source = update.source;
  }
}

function applyItemUpdatesToData(data: SaveData, updates: ItemUpdate[]) {
  const timestamp = Date.now();
  for (const update of updates) applyItemUpdate(data, update, timestamp);
}

function recordSessionUpdatesSafely(updates: ItemUpdate[]) {
  try {
    recordSessionUpdates(updates);
  } catch (error) {
    console.warn("Session update failed", error);
  }
}

function buildHighlightedItems(updates: ItemUpdate[], highlightItem?: string) {
  const highlightedItems = new Set(
    updates.map((update) => update.storageKey || update.item),
  );

  if (highlightItem) {
    const highlightedUpdate = updates.find(
      (update) => update.item === highlightItem,
    );
    highlightedItems.add(highlightedUpdate?.storageKey || highlightItem);
  }

  return highlightedItems;
}

function incrementItems(updates: ItemUpdate[], highlightItem?: string) {
  if (updates.length === 0) return;

  const data = getSaveData();
  applyItemUpdatesToData(data, updates);
  recordSessionUpdatesSafely(updates);
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

// Rendering the UI
function render(highlightItems?: Set<string>, data = getSaveData()) {
  const items = Object.keys(data.items).filter((item) => {
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

  const unknownItems = includeUnknown
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
  row.className = `item-row ${openSettingsItem === item ? "settings-active" : ""}`;

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

  const displayPrefixHtml = getItemDisplayPrefixHtml(itemData);
  const displayName = titleCase(
    getDisplayItemName(
      itemData.displayName || item,
      itemData.skill,
      shortInventionNames,
    ),
  );
  
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

// Set state of fishing porters
function updateFishingPortersButton() {
  settingsWindow.refresh();
}

function toggleFishingPorters() {
  fishingUsePorters = !fishingUsePorters;

  const data = getSaveData();
  data.fishingUsePorters = fishingUsePorters;
  saveData(data);

  updateFishingPortersButton();
  render();
}

function toggleShortInventionNames() {
  shortInventionNames = !shortInventionNames;

  const data = getSaveData();
  data.shortInventionNames = shortInventionNames;
  saveData(data);

  settingsWindow.refresh();
  render();
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
  settingsWindow.refresh();
}

function updateSessionStatusMini() {
  settingsWindow.refresh();
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

    updateInventionFilterVisibility();
    updateClearButtonLabel();
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
  chatFontState = "waiting";
  activeChatFontName = null;

  const found = reader.find() as ChatboxPosition | null;

  if (!found || found.boxes.length === 0) {
    status.innerText = "No chatbox found.";
    return;
  }

  reader.pos = found;
  populateChatSelector();

  const data = getSaveData();
  const savedChat = data.chat || "0";
  const selectedIndex = Number(savedChat);

  const validIndex = found.boxes[selectedIndex] ? selectedIndex : 0;
  const validChat = String(validIndex);

  found.mainbox = found.boxes[validIndex];

  data.chat = validChat;
  saveData(data);
  settingsWindow.refresh();

  showSelectedChat(found);
  status.innerText = supportedChatFontWaitingMessage();
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
        shortInventionNames: imported.shortInventionNames ?? false,
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

function getDisplayItemName(
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
    const target = (e.target as HTMLElement).closest(
      "button[data-item]",
    ) as HTMLElement | null;
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

document.querySelectorAll(".skill-tab").forEach((btn) => {
  btn.classList.remove("active");
});

const savedTabButton = document.querySelector(
  `.skill-tab[data-skill="${activeSkillTab}"]`,
);

if (savedTabButton) {
  savedTabButton.classList.add("active");
}

// Initial UI setup
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
  settingsWindow.refresh();
}

// App settings panel / session status refresh
tabsToggleButton?.addEventListener("click", function () {
  tabsCollapsed = !tabsCollapsed;
  updateTabsCollapsedUi();
});

appCog?.addEventListener("click", function () {
  settingsWindow.show();
});

compactSettingsButton?.addEventListener("click", function () {
  settingsWindow.show();
});

sessionQuickButton?.addEventListener("click", showSessionWindow);

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
