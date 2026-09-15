import type { SessionStatus } from "./session";
import type { ChatboxType } from "../chat/chatTypes";
import "./settings.css";

type CountPosition = "right" | "left";
type SettingsPage = "general" | "skills" | "data";
type TrackableSkill =
  | "mining"
  | "woodcutting"
  | "fishing"
  | "farming"
  | "archaeology"
  | "invention"
  | "seren";

type State = {
  chatTypes: readonly ChatboxType[];
  selectedChat: string;
  fishingUsePorters: boolean;
  shortInventionNames: boolean;
  countPosition: CountPosition;
  showAllTabIcons: boolean;
  showInventionFilter: boolean;
  showArchFilter: boolean;
  showArchArtefacts: boolean;
  trackedSkills: Readonly<Record<TrackableSkill, boolean>>;
  hideUnknownSection: boolean;
  trackerSize: number;
  sessionStatus: SessionStatus;
  hasSession: boolean;
  canExportSession: boolean;
  version: string;
};

type Actions = {
  getState(): State;
  selectChat(value: string): void;
  findChat(): void;
  showHistory(): void;
  showSession(): void;
  clearSession(): void;
  exportSessionCsv(): void;
  togglePorters(): void;
  toggleShortNames(): void;
  setCountPosition(position: CountPosition): void;
  toggleAllIcons(): void;
  toggleInventionFilter(): void;
  toggleArchFilter(): void;
  toggleArchArtefacts(): void;
  setSkillVisible(skill: TrackableSkill, visible: boolean): void;
  toggleUnknownSection(): void;
  setTrackerSize(value: number, persist: boolean): void;
  exportData(): void;
  importData(file: File): void;
  showPatchNotes(targetDocument: Document): void;
};

type windowController = {
  show(): void;
  refresh(): void;
};

type Confirmation = {
  title: string;
  message: string;
  confirmLabel: string;
};

export function createSettingsWindow(
	actions: Actions,
): windowController {
  let settingsWindow: Window | null = null;
  let initializedWindow: Window | null = null;
  let activePage: SettingsPage = "general";

  function show(): void {
    if (settingsWindow && !settingsWindow.closed) {
      settingsWindow.close();
      settingsWindow = null;
      initializedWindow = null;
      return;
    }

    activePage = "general";
    settingsWindow = window.open("", "settingsWindow", "width=315,height=255");
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
      setActivePage(doc, activePage);
      initializedWindow = settingsWindow;
    }

    refresh();
  }

  function refresh(): void {
    const state = actions.getState();
    updateStatus(document, state.sessionStatus);

    if (
      !settingsWindow ||
      settingsWindow.closed ||
      initializedWindow !== settingsWindow
    ) {
      return;
    }

    const doc = settingsWindow.document;
    updateChatSelector(doc, state);
    updateSwitch(
      doc,
      ".fishing-porters-toggle",
      state.fishingUsePorters,
      state.fishingUsePorters
        ? "Porter tracking is enabled."
        : "Porter tracking is disabled.",
    );
    updateSwitch(
      doc,
      ".short-invention-names-toggle",
      state.shortInventionNames,
      "Shorten Invention names in the main tracker.",
    );
    updateSwitch(
      doc,
      ".all-tab-icons-toggle",
      state.showAllTabIcons,
      state.showAllTabIcons
        ? "Item icons are shown."
        : "Item icons are hidden.",
    );
    updateSwitch(
      doc,
      ".invention-filter-toggle",
      state.showInventionFilter,
      state.showInventionFilter
        ? "Invention filter is visible."
        : "Invention filter is hidden.",
    );
    updateSwitch(
      doc,
      ".archaeology-filter-toggle",
      state.showArchFilter,
      state.showArchFilter
        ? "Dig Site filter is visible."
        : "Dig Site filter is hidden.",
    );
    updateSwitch(
      doc,
      ".archaeology-artefact-toggle",
      state.showArchArtefacts,
      state.showArchArtefacts
        ? "Artefacts are visible."
        : "Artefacts are hidden.",
    );
    doc
      .querySelectorAll<HTMLInputElement>(".settings-tracked-skill input")
      .forEach((input) => {
        input.checked = state.trackedSkills[input.dataset.skill as TrackableSkill];
      });
    updateSwitch(
      doc,
      ".hide-unknown-section-toggle",
      state.hideUnknownSection,
      state.hideUnknownSection
        ? "Uncategorized items are hidden."
        : "Uncategorized items are shown.",
    );
    updateCountPosition(doc, state.countPosition);

    const trackerSize = doc.querySelector(
      ".tracker-size",
    ) as HTMLInputElement | null;
    const trackerSizeValue = doc.querySelector(".tracker-size-value");
    if (trackerSize && trackerSizeValue) {
      trackerSize.value = String(state.trackerSize);
      trackerSizeValue.textContent = `${state.trackerSize}px`;
    }

    const clearSession = doc.querySelector(
      ".clear-session",
    ) as HTMLButtonElement | null;
    if (clearSession) {
      clearSession.disabled = !state.hasSession;
      clearSession.title = state.hasSession
        ? "Clear the current session"
        : "No session to clear";
    }

    const exportSession = doc.querySelector(
      ".export-session-csv",
    ) as HTMLButtonElement | null;
    if (exportSession) {
      exportSession.disabled = !state.canExportSession;
      exportSession.title = state.canExportSession
        ? "Export session events as CSV"
        : state.hasSession
          ? "No session events to export"
          : "No session to export";
    }

    const version = doc.querySelector(".settings-version-label");
    if (version) version.textContent = state.version;
  }

  function initializeDocument(doc: Document): void {
    doc.head.replaceChildren(...cloneStyles(doc));
    doc.title = "Settings";

    doc.body.className = "nis settings-window-body";
    doc.body.innerHTML = markup();
  }

  function bindEvents(doc: Document): void {
    const chat = doc.querySelector(".chat") as HTMLSelectElement;
    chat.addEventListener("change", () => {
      if (chat.value !== "") actions.selectChat(chat.value);
    });

    doc
      .querySelectorAll<HTMLButtonElement>(
        ".settings-sidebar-item[data-page]",
      )
      .forEach((button) => {
        button.addEventListener("click", () => {
          activePage = button.dataset.page as SettingsPage;
          setActivePage(doc, activePage);
        });
      });
    doc.querySelector(".settings-session-button")?.addEventListener("click", () => {
      actions.showSession();
      window.setTimeout(refresh, 100);
    });
    doc.querySelector(".find-chat")?.addEventListener("click", actions.findChat);
    doc.querySelector(".history-button")?.addEventListener("click", actions.showHistory);
    doc.querySelector(".export-session-csv")?.addEventListener("click", () => {
      if (actions.getState().canExportSession) actions.exportSessionCsv();
    });
    doc.querySelector(".clear-session")?.addEventListener("click", () => {
      if (!actions.getState().hasSession) return;

      requestConfirmation(doc, {
        title: "Clear session data?",
        message: "This permanently removes the current session and its recorded data.",
        confirmLabel: "Clear",
      }, () => {
        actions.clearSession();
        refresh();
      });
    });
    doc
      .querySelector(".fishing-porters-toggle input")
      ?.addEventListener("change", actions.togglePorters);
    doc
      .querySelector(".short-invention-names-toggle input")
      ?.addEventListener("change", actions.toggleShortNames);
    doc
      .querySelector(".all-tab-icons-toggle input")
      ?.addEventListener("change", actions.toggleAllIcons);
    doc
      .querySelector(".invention-filter-toggle input")
      ?.addEventListener("change", actions.toggleInventionFilter);
    doc
      .querySelector(".archaeology-filter-toggle input")
      ?.addEventListener("change", actions.toggleArchFilter);
    doc
      .querySelector(".archaeology-artefact-toggle input")
      ?.addEventListener("change", actions.toggleArchArtefacts);
    doc
      .querySelectorAll<HTMLInputElement>(".settings-tracked-skill input")
      .forEach((input) => {
        input.addEventListener("change", () => {
          actions.setSkillVisible(
            input.dataset.skill as TrackableSkill,
            input.checked,
          );
        });
      });
    doc
      .querySelector(".hide-unknown-section-toggle input")
      ?.addEventListener("change", actions.toggleUnknownSection);
    doc.querySelectorAll<HTMLButtonElement>(".settings-segment-option").forEach(
      (button) => {
        button.addEventListener("click", () => {
          actions.setCountPosition(button.dataset.position as CountPosition);
        });
      },
    );

    const trackerSize = doc.querySelector(
      ".tracker-size",
    ) as HTMLInputElement | null;
    trackerSize?.addEventListener("input", () => {
      actions.setTrackerSize(Number(trackerSize.value), false);
    });
    trackerSize?.addEventListener("change", () => {
      actions.setTrackerSize(Number(trackerSize.value), true);
    });
    doc.querySelector(".export")?.addEventListener("click", actions.exportData);

    const importInput = doc.querySelector(".import") as HTMLInputElement;
    importInput.addEventListener("change", () => {
      const file = importInput.files?.[0];
      if (file) actions.importData(file);
      importInput.value = "";
    });

    doc.querySelector(".settings-patch-notes")?.addEventListener("click", () => {
      actions.showPatchNotes(doc);
    });
  }

  window.setInterval(refresh, 1000);
  return { show, refresh };
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

function requestConfirmation(
  doc: Document,
  confirmation: Confirmation,
  onConfirm: () => void,
): void {
  const existing = doc.querySelector(".tracker-confirmation-overlay");
  if (existing) {
    (
      existing.querySelector(
        ".tracker-confirmation-cancel",
      ) as HTMLButtonElement | null
    )?.focus();
    return;
  }

  const overlay = doc.createElement("div");
  overlay.className = "tracker-confirmation-overlay";

  const dialog = doc.createElement("section");
  dialog.className = "tracker-confirmation";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "tracker-confirmation-title");

  const title = doc.createElement("div");
  title.className = "tracker-confirmation-title";
  title.id = "tracker-confirmation-title";
  title.textContent = confirmation.title;

  const message = doc.createElement("div");
  message.className = "tracker-confirmation-message";
  message.textContent = confirmation.message;

  const actions = doc.createElement("div");
  actions.className = "tracker-confirmation-actions";

  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "tracker-confirmation-cancel";
  cancel.textContent = "Cancel";

  const confirm = doc.createElement("button");
  confirm.type = "button";
  confirm.className = "tracker-confirmation-confirm";
  confirm.textContent = confirmation.confirmLabel;

  let confirmed = false;
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
    if (confirmed) return;
    confirmed = true;
    confirm.disabled = true;
    close();
    onConfirm();
  });
  doc.addEventListener("keydown", onKeyDown);

  actions.append(cancel, confirm);
  dialog.append(title, message, actions);
  overlay.append(dialog);
  doc.body.append(overlay);
  cancel.focus();
}

function setActivePage(doc: Document, page: SettingsPage): void {
  const validPage = page === "skills" || page === "data" ? page : "general";
  doc.querySelectorAll<HTMLElement>(".settings-page").forEach((element) => {
    element.hidden = element.dataset.settingsPage !== validPage;
  });
  doc
    .querySelectorAll<HTMLButtonElement>(".settings-sidebar-item[data-page]")
    .forEach((button) => {
      const selected = button.dataset.page === validPage;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-current", selected ? "page" : "false");
    });
}

function updateChatSelector(
  doc: Document,
  state: State,
): void {
  const chat = doc.querySelector(".chat") as HTMLSelectElement | null;
  if (!chat) return;

  if (chat.options.length !== state.chatTypes.length + 1) {
    chat.replaceChildren(new Option("Select Chat", ""));

    for (let index = 0; index < state.chatTypes.length; index += 1) {
      const suffix = state.chatTypes.length > 1 ? ` ${index + 1}` : "";
      const label = chatTypeLabels[state.chatTypes[index]];

      chat.add(new Option(`${label}${suffix}`, String(index)));
    }
  }

  chat.value = state.selectedChat;
}
const chatTypeLabels: Record<ChatboxType, string> = {
  main: "Main chat",
  cc: "Clan chat",
  fc: "Friends chat",
  gc: "Group chat",
  gcc: "Guest clan chat",
  private: "Private chat",
  gimc: "Group ironman chat",
  unknown: "Chat window",
};

function updateSwitch(
  doc: Document,
  selector: string,
  enabled: boolean,
  title: string,
): void {
  const control = doc.querySelector(selector) as HTMLLabelElement | null;
  const input = control?.querySelector("input") as HTMLInputElement | null;
  if (!control || !input) return;

  input.checked = enabled;
  control.title = title;
}

function updateCountPosition(doc: Document, position: CountPosition): void {
  doc
    .querySelectorAll<HTMLButtonElement>(".settings-segment-option")
    .forEach((button) => {
      const selected = button.dataset.position === position;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
}

function updateStatus(doc: Document, status: SessionStatus): void {
  const quickButton = doc.querySelector(
    ".session-quick-button",
  ) as HTMLButtonElement | null;
  const statusText =
    status === "running"
      ? "Running"
      : status === "paused"
        ? "Paused"
        : status === "ended"
          ? "Ended"
          : "Not Running";

  if (quickButton) {
    quickButton.classList.remove("running", "paused", "ended", "idle");
    quickButton.classList.add(status);
    quickButton.title = `Session: ${statusText}`;
    quickButton.setAttribute("aria-label", `Session: ${statusText}`);
  }
}

function markup(): string {
  return `
    <div class="settings-window-panel">
      <div class="settings-window-main">
      <nav class="settings-sidebar" aria-label="Settings sections">
        <div class="settings-sidebar-title">Settings</div>
        <button class="settings-sidebar-item" type="button" data-page="general">General/UI</button>
        <button class="settings-sidebar-item" type="button" data-page="skills">Skills</button>
        <button class="settings-sidebar-item" type="button" data-page="data">Data</button>
        <div class="settings-sidebar-title"></div>
        <button class="settings-session-button" type="button">Session</button>
      </nav>
      <div class="settings-page-content">
          <section class="settings-page" data-settings-page="general">
            <div class="settings-section">
              <div class="settings-section-title">CHAT</div>
              <div class="settings-field">
                <div class="settings-chat-row">
                  <div class="settings-field-description">Supported chat sizes: 10pt–16pt. Click Find Chat after changing the size.</div>
                  <button class="find-chat" type="button">Find Chat</button>
                </div>
                <div class="settings-chat-select-row">
                  <label for="settings-chat-window">Chat window</label>
                  <select id="settings-chat-window" class="chat"><option value="">Select Chat</option></select>
                </div>
              </div>
            </div>
            <div class="settings-section">
              <div class="settings-section-title">INTERFACE</div>
              <div class="settings-field">
                <span class="settings-field-label">UI Scale:</span>
                <div class="settings-tracker-size-row">
                  <input class="tracker-size" type="range" min="10" max="16" step="1" value="12" aria-label="Tracker Size">
                  <span class="tracker-size-value">12px</span>
                </div>
              </div>
              <div class="settings-field">
                <span class="settings-field-label">Count Position:</span>
                <div class="settings-segmented-control" role="group" aria-label="Count Position">
                  <button class="settings-segment-option" type="button" data-position="left">Left</button>
                  <button class="settings-segment-option" type="button" data-position="right">Right</button>
                </div>
              </div>
                ${switchMarkup("all-tab-icons-toggle", "Item Icons", "Show skill icons beside items on the main tab.")}
            </div>
          </section>
          <section class="settings-page" data-settings-page="skills" hidden>
            <div class="settings-section">
              <div class="settings-section-title">TRACKED SKILLS/EVENTS</div>
              <div class="settings-field-description">Choose tracked resources and events.</div>
              <div class="settings-tracked-skills">
                ${trackedSkillsMarkup()}
              </div>
            </div>
            <div class="settings-section">
              <div class="settings-section-title">FISHING</div>
              ${switchMarkup("fishing-porters-toggle", "Sign of the Porter", "Track fish sent through porters and bank transports.")}
            </div>
            <div class="settings-section">
              <div class="settings-section-title">INVENTION</div>
              ${switchMarkup("short-invention-names-toggle", "Short Invention Names", "Shorten component and part labels.")}
              ${switchMarkup("invention-filter-toggle", "Show Invention Filter", "Show the material filter.")}
            </div>
            <div class="settings-section">
              <div class="settings-section-title">ARCHAEOLOGY</div>
              ${switchMarkup("archaeology-filter-toggle", "Show Dig Site Filter", "Show the Dig Site filter.")}
              ${switchMarkup("archaeology-artefact-toggle", "Show Artefacts", "Show damaged artefacts.")}
            </div>
            <div class="settings-section">
              <div class="settings-section-title">MISC.</div>
              ${switchMarkup("hide-unknown-section-toggle", "Hide Uncategorized Items", "Hide Uncategorized items.")}
            </div>
          </section>
          <section class="settings-page" data-settings-page="data" hidden>
            <div class="settings-section">
              <div class="settings-section-title">DATA</div>
              <div class="settings-data-row">
                <button class="export" type="button">Export</button>
                <label class="import-label">Import<input class="import" type="file" accept=".json"></label>
              </div>
            </div>
            <div class="settings-section">
              <div class="settings-section-title">MISC.</div>
              <div class="settings-data-actions">
                <button class="history-button" type="button">History</button>
                <button class="export-session-csv" type="button">Export CSV</button>
                <button class="clear-session" type="button">Clear Session</button>
              </div>
            </div>
          </section>
      </div>
      </div>
      <div class="settings-bottom-area">
        <div class="settings-bottom-links">
          <button class="settings-version-label settings-patch-notes" type="button" title="Show Patch Notes"></button>
        </div>
      </div>
    </div>
  `;
}

function switchMarkup(
  className: string,
  label: string,
  description: string,
): string {
  return `
    <label class="settings-switch-row ${className}">
      <span class="settings-switch-label">
        <span class="settings-setting-label">${label}</span>
      </span>
      <input type="checkbox">
      <span class="settings-info-icon" role="img" aria-label="${description}" title="${description}">?</span>
      <span class="settings-switch" aria-hidden="true"></span>
    </label>
  `;
}

function trackedSkillsMarkup(): string {
  const skills: ReadonlyArray<{
    skill: TrackableSkill;
    label: string;
    icon: string;
  }> = [
    { skill: "mining", label: "Mining", icon: "mining.png" },
    { skill: "woodcutting", label: "Woodcutting", icon: "woodcutting.png" },
    { skill: "fishing", label: "Fishing", icon: "fishing.png" },
    { skill: "farming", label: "Farming", icon: "farming.png" },
    { skill: "archaeology", label: "Archaeology", icon: "archaeology.png" },
    { skill: "invention", label: "Invention", icon: "invention.png" },
    { skill: "seren", label: "Seren / Phoenix", icon: "seren.png" },
  ];

  return skills
    .map(({ skill, label, icon }) => {
      const iconUrl = new URL(`./icons/${icon}`, window.location.href).href;
      return `<label class="settings-tracked-skill" title="${label}">
        <input type="checkbox" data-skill="${skill}" aria-label="Show ${label}">
        <img src="${iconUrl}" alt="">
      </label>`;
    })
    .join("");
}
