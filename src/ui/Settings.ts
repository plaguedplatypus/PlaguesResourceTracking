import type { SessionStatus } from "./session";

type SettingsWindowState = {
  chatCount: number;
  selectedChat: string;
  fishingUsePorters: boolean;
  shortInventionNames: boolean;
  sessionStatus: SessionStatus;
  clearLabel: string;
  version: string;
};

type SettingsWindowActions = {
  getState(): SettingsWindowState;
  selectChat(value: string): void;
  findChat(): void;
  showHistory(): void;
  showSession(): void;
  toggleFishingPorters(): void;
  toggleShortInventionNames(): void;
  exportData(): void;
  importData(file: File): void;
  clearCurrentTab(): void;
  showPatchNotes(targetDocument: Document): void;
};

type SettingsWindowController = {
  show(): void;
  refresh(): void;
};

export function createSettingsWindowController(
  actions: SettingsWindowActions,
): SettingsWindowController {
  let settingsWindow: Window | null = null;
  let initializedWindow: Window | null = null;

  function show(): void {
    if (settingsWindow && !settingsWindow.closed) {
      settingsWindow.close();
      settingsWindow = null;
      initializedWindow = null;
      return;
    }

    settingsWindow = window.open(
      "",
      "settingsWindow",
      "width=240,height=217",
    );
    initializedWindow = null;

    window.setTimeout(initialize, 50);
  }

  function initialize(): void {
    if (!settingsWindow || settingsWindow.closed) return;
    const doc = settingsWindow.document;
    if (!doc.body) {
      window.setTimeout(initialize, 50);
      return;
    }

    if (initializedWindow !== settingsWindow) {
      initializeDocument(doc);
      bindEvents(doc);
      initializedWindow = settingsWindow;
    }

    refresh();
  }

  function refresh(): void {
    const state = actions.getState();
    updateSessionStatus(document, state.sessionStatus);

    if (
      !settingsWindow ||
      settingsWindow.closed ||
      initializedWindow !== settingsWindow
    ) {
      return;
    }

    const doc = settingsWindow.document;
    updateChatSelector(doc, state);

    const porters = doc.querySelector(
      ".fishing-porters-cycle",
    ) as HTMLButtonElement | null;
    const portersLabel = porters?.querySelector(".settings-toggle-label");
    if (porters && portersLabel) {
      portersLabel.textContent = state.fishingUsePorters
        ? "Sign of the Porter: ON"
        : "Sign of the Porter: OFF";
      porters.setAttribute(
        "aria-pressed",
        String(state.fishingUsePorters),
      );
      porters.title = state.fishingUsePorters
        ? "Fishing porter tracking is enabled. Counting fish from porter and bank transport messages."
        : "Fishing porter tracking is disabled. Counting fish from direct catch messages.";
    }

    const shortNames = doc.querySelector(
      ".short-invention-names-toggle",
    ) as HTMLButtonElement | null;
    const shortNamesLabel = shortNames?.querySelector(".settings-toggle-label");
    if (shortNames && shortNamesLabel) {
      shortNamesLabel.textContent = state.shortInventionNames
        ? "Short Invention Names: ON"
        : "Short Invention Names: OFF";
      shortNames.setAttribute(
        "aria-pressed",
        String(state.shortInventionNames),
      );
    }

    updateSessionStatus(doc, state.sessionStatus);

    const clear = doc.querySelector(".clear") as HTMLButtonElement | null;
    if (clear) {
      clear.textContent = state.clearLabel;
      clear.title = state.clearLabel;
    }

    const version = doc.querySelector(
      ".settings-version",
    ) as HTMLButtonElement | null;
    if (version) {
      version.textContent = `Version ${state.version} Patch Notes`;
    }
  }

  function initializeDocument(doc: Document): void {
    doc.head.replaceChildren(...cloneApplicationStyles(doc));
    doc.title = "Settings";

    const popupStyle = doc.createElement("style");
    popupStyle.textContent = `
      html, body {height: 100%;}
      body {padding: 5px; box-sizing: border-box; background: #1e1e1e;}
      .settings-window-panel {
        position: static;
        display: flex;
        width: 100%;
        height: 100%;
        min-width: 0;
        max-height: none;
      }
    `;
    doc.head.append(popupStyle);
    doc.body.className = "nis settings-window-body";
    doc.body.innerHTML = settingsMarkup();
  }

  function bindEvents(doc: Document): void {
    const chat = doc.querySelector(".chat") as HTMLSelectElement;
    chat.addEventListener("change", () => {
      if (chat.value !== "") actions.selectChat(chat.value);
    });

    doc.querySelector(".find-chat")?.addEventListener("click", actions.findChat);
    doc
      .querySelector(".history-button")
      ?.addEventListener("click", actions.showHistory);
    doc.querySelector(".session-button")?.addEventListener("click", () => {
      actions.showSession();
      window.setTimeout(refresh, 100);
    });
    doc
      .querySelector(".fishing-porters-cycle")
      ?.addEventListener("click", actions.toggleFishingPorters);
    doc
      .querySelector(".short-invention-names-toggle")
      ?.addEventListener("click", actions.toggleShortInventionNames);
    doc.querySelector(".export")?.addEventListener("click", actions.exportData);
    doc.querySelector(".clear")?.addEventListener("click", actions.clearCurrentTab);

    const importInput = doc.querySelector(".import") as HTMLInputElement;
    importInput.addEventListener("change", () => {
      const file = importInput.files?.[0];
      if (file) actions.importData(file);
      importInput.value = "";
    });

    const version = doc.querySelector(".settings-version");
    const showPatchNotes = () => {
      actions.showPatchNotes(doc);
    };
    version?.addEventListener("click", showPatchNotes);
    version?.addEventListener("keydown", (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key !== "Enter" && keyboardEvent.key !== " ") return;
      keyboardEvent.preventDefault();
      showPatchNotes();
    });
  }

  window.setInterval(refresh, 1000);
  return { show, refresh };
}

function cloneApplicationStyles(doc: Document): Node[] {
  return Array.from(
    document.head.querySelectorAll('style, link[rel="stylesheet"]'),
  ).map((node) => doc.importNode(node, true));
}

function updateChatSelector(
  doc: Document,
  state: SettingsWindowState,
): void {
  const chat = doc.querySelector(".chat") as HTMLSelectElement | null;
  if (!chat) return;

  if (chat.options.length !== state.chatCount + 1) {
    chat.replaceChildren(new Option("Select Chat", ""));
    for (let index = 0; index < state.chatCount; index += 1) {
      chat.add(new Option(`Chat ${index}`, String(index)));
    }
  }

  chat.value = state.selectedChat;
}

function updateSessionStatus(doc: Document, status: SessionStatus): void {
  const line = doc.querySelector(".session-status-line");
  const value = doc.querySelector(".session-status-value");
  const quickButton = doc.querySelector(
    ".session-quick-button",
  ) as HTMLButtonElement | null;
  const statusText =
    status === "running"
      ? "Running"
      : status === "paused"
        ? "Paused"
        : "Not Running";

  if (line && value) {
    line.classList.remove("running", "paused", "idle");
    line.classList.add(status);
    value.textContent = statusText;
  }

  if (quickButton) {
    quickButton.classList.remove("running", "paused", "idle");
    quickButton.classList.add(status);
    quickButton.title = `Session: ${statusText}`;
    quickButton.setAttribute("aria-label", `Session: ${statusText}`);
  }
}

function settingsMarkup(): string {
  const fishingIcon = new URL("./icons/fishing.png", window.location.href).href;
  return `
    <div class="app-settings-panel open settings-window-panel">
      <div class="settings-row">
        <select class="chat"><option value="">Select Chat</option></select>
        <button class="find-chat">Find Chat</button>
      </div>
      <div class="chat-font-support">
        Supported Text Sizes: 10-16pt<br>
        Click Find Chat after changing Text Size.
      </div>
      <div class="settings-row">
        <button class="history-button">History</button>
        <button class="session-button">Session</button>
      </div>
      <div class="settings-row settings-skill-toggle-row">
        <button class="settings-skill-toggle fishing-porters-cycle"
          title="Toggle Fishing porter tracking mode" aria-pressed="true">
          <img src="${fishingIcon}" alt="">
          <span class="settings-toggle-label">Sign of the Porter: ON</span>
        </button>
      </div>
      <div class="settings-row settings-skill-toggle-row">
        <button class="settings-skill-toggle short-invention-names-toggle"
          title="Shorten Invention item labels in the main tracker" aria-pressed="false">
          <span class="settings-toggle-label">Short Invention Names: OFF</span>
        </button>
      </div>
      <div class="settings-row">
        <button class="export">Export</button>
        <label class="import-label">Import
          <input class="import" type="file" accept=".json">
        </label>
      </div>
      <div class="session-status-line idle">
        <span class="session-status-label">Session:</span>
        <span class="session-status-value">Not Running</span>
      </div>
      <div class="settings-separator"></div>
      <button class="clear">Clear Tab</button>
      <div class="settings-footer-links">
        <button class="settings-text-link settings-version" type="button"
          role="button" tabindex="0" title="Show Patch Notes"></button>
      </div>
    </div>
  `;
}
