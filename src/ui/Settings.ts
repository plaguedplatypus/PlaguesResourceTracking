import type { SessionStatus } from "./session";
import type { ChatboxType } from "../chat/chatTypes";

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

type SettingsWindowState = {
  chatTypes: readonly ChatboxType[];
  selectedChat: string;
  fishingUsePorters: boolean;
  shortInventionNames: boolean;
  countPosition: CountPosition;
  showAllTabIcons: boolean;
  showStatusFooter: boolean;
  showInventionFilter: boolean;
  showArchaeologyFilter: boolean;
  showArchaeologyArtefacts: boolean;
  trackedSkills: Readonly<Record<TrackableSkill, boolean>>;
  hideUnknownSection: boolean;
  trackerSize: number;
  sessionStatus: SessionStatus;
  clearLabel: string;
  clearHasTrackedItems: boolean;
  resetLabel: string;
  resetHasTrackedCounts: boolean;
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
  setCountPosition(position: CountPosition): void;
  toggleAllTabIcons(): void;
  toggleStatusFooter(): void;
  toggleInventionFilterVisibility(): void;
  toggleArchaeologyFilterVisibility(): void;
  toggleArchaeologyArtefactVisibility(): void;
  setTrackedSkillVisible(skill: TrackableSkill, visible: boolean): void;
  toggleUnknownSectionVisibility(): void;
  setTrackerSize(value: number, persist: boolean): void;
  exportData(): void;
  importData(file: File): void;
  clearCurrentTab(): void;
  resetCurrentTabCounts(): void;
  showPatchNotes(targetDocument: Document): void;
};

type SettingsWindowController = {
  show(): void;
  refresh(): void;
};

type TrackingConfirmation = {
  title: string;
  message: string;
  confirmLabel: string;
};

export function createSettingsWindowController(
  actions: SettingsWindowActions,
): SettingsWindowController {
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
    settingsWindow = window.open("", "settingsWindow", "width=315,height=300");
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
    updateSettingsSwitch(
      doc,
      ".fishing-porters-toggle",
      state.fishingUsePorters,
      state.fishingUsePorters
        ? "Fishing porter tracking is enabled."
        : "Fishing porter tracking is disabled.",
    );
    updateSettingsSwitch(
      doc,
      ".short-invention-names-toggle",
      state.shortInventionNames,
      "Shorten Invention item labels in the main tracker.",
    );
    updateSettingsSwitch(
      doc,
      ".all-tab-icons-toggle",
      state.showAllTabIcons,
      state.showAllTabIcons
        ? "All-tab item icons are shown."
        : "All-tab item icons are hidden.",
    );
    updateSettingsSwitch(
      doc,
      ".status-footer-toggle",
      state.showStatusFooter,
      state.showStatusFooter
        ? "Tracker status footer is visible."
        : "Tracker status footer is hidden.",
    );
    updateSettingsSwitch(
      doc,
      ".invention-filter-visibility-toggle",
      state.showInventionFilter,
      state.showInventionFilter
        ? "Invention filter is visible."
        : "Invention filter is hidden.",
    );
    updateSettingsSwitch(
      doc,
      ".archaeology-filter-visibility-toggle",
      state.showArchaeologyFilter,
      state.showArchaeologyFilter
        ? "Archaeology Dig Site filter is visible."
        : "Archaeology Dig Site filter is hidden.",
    );
    updateSettingsSwitch(
      doc,
      ".archaeology-artefact-visibility-toggle",
      state.showArchaeologyArtefacts,
      state.showArchaeologyArtefacts
        ? "Archaeology artefacts are visible."
        : "Archaeology artefacts are hidden.",
    );
    doc
      .querySelectorAll<HTMLInputElement>(".settings-tracked-skill input")
      .forEach((input) => {
        input.checked = state.trackedSkills[input.dataset.skill as TrackableSkill];
      });
    updateSettingsSwitch(
      doc,
      ".hide-unknown-section-toggle",
      state.hideUnknownSection,
      state.hideUnknownSection
        ? "Unclassified items are hidden from the All tab."
        : "Unclassified items are shown on the All tab.",
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

    const clear = doc.querySelector(".clear") as HTMLButtonElement | null;
    if (clear) {
      clear.textContent = state.clearLabel;
      clear.disabled = !state.clearHasTrackedItems;
      clear.title = state.clearHasTrackedItems
        ? state.clearLabel
        : "No tracked items to clear";
    }

    const reset = doc.querySelector(".reset") as HTMLButtonElement | null;
    if (reset) {
      reset.textContent = state.resetLabel;
      reset.disabled = !state.resetHasTrackedCounts;
      reset.title = state.resetHasTrackedCounts
        ? state.resetLabel
        : "No tracked counts to reset";
    }

    const version = doc.querySelector(".settings-version-label");
    if (version) version.textContent = `Version ${state.version}`;
  }

  function initializeDocument(doc: Document): void {
    doc.head.replaceChildren(...cloneApplicationStyles(doc));
    doc.title = "Settings";

    const popupStyle = doc.createElement("style");
    popupStyle.textContent = `
      :root { color-scheme: dark; }
      html, body { width: 100%; height: 100%; }
      body.settings-window-body {
        margin: 0;
        padding: 4px;
        box-sizing: border-box;
        overflow: hidden;
        background: #0e1d25;
      }
      .settings-window-panel {
        display: grid;
        grid-template-rows: minmax(0, 1fr) auto;
        width: 100%;
        height: 100%;
        min-width: 0;
        max-height: none;
        padding: 0;
        box-sizing: border-box;
        overflow: hidden;
        background: #172136;
        border: 2px solid #5a4a2a;
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.65);
        border-radius: 6px;
      }
      .settings-window-panel button,
      .settings-window-panel select,
      .settings-window-panel .import-label {
        border-radius: 5px;
      }
      .settings-sidebar-title {
        padding: 3px 5px 5px;
        color: #d8c58a;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 15px;
        font-weight: 500;
        border-bottom: 1px solid #5a4a2a;
      }
      .settings-window-main {
        display: grid;
        grid-template-columns: 78px minmax(0, 1fr);
        min-height: 0;
      }
      .settings-sidebar {
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 4px 6px 0 4px;
        border-right: 0px solid #5a4a2a;
        background: rgba(0, 0, 0, 0.35);
      }
      .settings-sidebar-item {
        width: 100%;
        min-height: 24px;
        justify-content: flex-start;
        padding: 3px;
        color: #b7ad8c;
        font-size: 12px;
        text-align: left;
        background: rgba(90, 74, 42, 0.28);
        border-color: #5a4a2a;
        box-shadow: none;
      }
      .settings-sidebar-item:hover,
      .settings-sidebar-item:focus-visible {
        color: #fff0bd;
        outline: none;
      }
      .settings-sidebar-item.is-active {
        color: #fff2aa;
        background: linear-gradient(90deg, #4a3518, #20170c);
        border-color: #d9a441;
        box-shadow: inset 0 0 3px rgba(255, 200, 80, 0.25);
      }
      .settings-session-button {
        width: 100%;
        min-height: 24px;
        padding: 3px 5px;
        font-size: 12px;
      }
      .settings-page-content {
        min-width: 0;
        overflow-y: auto;
        padding: 0 8px 4px 8px;
      }
      .settings-page[hidden] { display: none; }
      .settings-section + .settings-section {
        margin-top: 7px;
        padding-top: 6px;
        border-top: 1px solid rgba(216, 197, 138, 0.22);
      }
      .settings-section-title {
        margin-bottom: 4px;
        margin-left: -8px;
        margin-right: -8px;
        color: #d8c58a;
        padding: 2px 0 0 2px;
        font-size: 12px;
        font-weight: bold;
        letter-spacing: 0.03em;
        background: rgba(0, 0, 0, 0.35);
        border-bottom: 2px solid #5a4a2a;
      }
      .settings-field,
      .settings-switch-row {
        min-width: 0;
        margin-top: 4px;
      }
      .settings-field-label,
      .settings-setting-label {
        display: block;
        color: #dddddd;
        font-size: 12px;
      }
      .settings-setting-label {
        color: #dddddd;
        font-size: 11px;
        font-weight: 600;
      }
      .settings-field-description {
        display: block;
        margin-top: 2px;
        color: #bbbbbb;
        font-size: 11px;
        overflow-wrap: anywhere;
      }
      .settings-chat-row,
      .settings-data-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 3px;
        margin-top: 3px;
      }
      .settings-data-row { grid-template-columns: 1fr 1fr; }
      .settings-chat-row,
      .settings-chat-select-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 5px;
        padding: 3px;
      }
      .settings-chat-select-row {
        grid-template-columns: auto minmax(0, 1fr);
        margin-top: 4px;
      }
      .settings-chat-select-row label {
        color: #dddddd;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
      }
      .settings-chat-select-row .chat {
        min-width: 0;
        padding: 3px;
        border: 1px solid #5a4a2a;
        border-radius: 5px;
        background: #20231c;
        color: #d8c58a;
        font-size: 12px;
      }
      .settings-chat-select-row .chat:focus-visible {
        border-color: #82734e;
        outline: none;
      }
      .settings-chat-row .settings-field-description { margin: 0; }
      .settings-switch-row {
        position: relative;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 12px 30px;
        width: 100%;
        box-sizing: border-box;
        height: auto;
        min-height: 0;
        align-items: center;
        gap: 4px;
        padding: 3px;
        color: inherit;
        text-align: left;
        background: rgba(27, 30, 24, 0.8);
        border: 1px solid #5a4a2a;
        border-radius: 6px;
        box-shadow: none;
        cursor: pointer;
      }
      .settings-switch-row > span:first-child { min-width: 0; }
      .settings-switch-label {
        min-width: 0;
      }
      .settings-info-icon {
        display: inline-grid;
        flex: 0 0 auto;
        width: 12px;
        height: 12px;
        place-items: center;
        color: #d8c58a;
        font-size: 11px;
        font-weight: bold;
        line-height: 1;
        border: 1px solid #8a7440;
        border-radius: 50%;
        cursor: help;
      }
      .settings-switch-row input {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
      }
      .settings-switch {
        position: relative;
        box-sizing: border-box;
        width: 30px;
        height: 16px;
        border: 1px solid #55594d;
        border-radius: 10px;
        background: #252820;
      }
      .settings-switch::after {
        content: "";
        position: absolute;
        top: 2px;
        left: 2px;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #9b9c91;
        transition: transform 120ms ease, background 120ms ease;
      }
      .settings-switch-row input:checked ~ .settings-switch {
        border-color: #7b815a;
        background: #3c4528;
      }
      .settings-switch-row input:checked ~ .settings-switch::after {
        transform: translateX(14px);
        background: #a9c46d;
      }
      .settings-switch-row input:focus-visible ~ .settings-switch {
        outline: 2px solid #c0a56b;
        outline-offset: 2px;
      }
      .settings-tracked-skills {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 4px;
      }
      .settings-tracked-skill {
        position: relative;
        display: flex;
        flex: 0 0 28px;
        width: 28px;
        height: 28px;
        align-items: center;
        justify-content: center;
        padding: 3px;
        box-sizing: border-box;
        border: 1px solid #34382f;
        border-radius: 5px;
        background: rgba(88, 13, 13, 0.4);
        cursor: pointer;
      }
      .settings-tracked-skill input {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 1;
      }
      .settings-tracked-skill img {
        width: 20px;
        height: 20px;
        object-fit: contain;
        pointer-events: none;
      }
      .settings-tracked-skill::after {
        position: absolute;
        top: 1px;
        right: 4px;
        color: #91f025;
        content: "";
        font-size: 18px;
        font-weight: bold;
      }
      .settings-tracked-skill:has(input:checked) {
        border-color: #7b815a;
        background: #325828;
      }
      .settings-tracked-skill:has(input:checked)::after { content: "✓"; }
      .settings-tracked-skill input:focus-visible + img {
        outline: 2px solid #c0a56b;
        outline-offset: 2px;
      }
      .settings-segmented-control {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 2px;
        margin-top: 4px;
      }
      .settings-segment-option {
        min-height: 20px;
        padding: 3px;
        font-size: 12px;
      }
      .settings-segment-option.is-active {
        color: #fff2aa;
        border-color: #916f30;
        background: linear-gradient( #3f2e16, #20170c);
      }
      .settings-tracker-size-row {
        display: grid;
        grid-template-columns: 88px auto;
        justify-content: start;
        align-items: center;
        gap: 5px;
        margin-top: 3px;
      }
      .tracker-size-value { color: #d8c58a; font-size: 12px; }
      input.tracker-size { width: 88px; padding: 0; }
      .settings-bottom-area {
        padding: 7px 7px 4px;
        border-top: 1px solid #5a4a2a;
        background: rgba(0, 0, 0, 0.35);
      }
      .settings-bottom-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 4px;
      }
      .settings-bottom-area .clear,
      .settings-bottom-area .reset {
        display: flex;
        width: 100%;
        min-width: 0;
        justify-content: center;
        padding-right: 3px;
        padding-left: 3px;
      }
      .settings-bottom-links {
        display: flex;
        justify-content: center;
        gap: 9px;
        margin-top: 4px;
        color: #bbbbbb;
        font-size: 11px;
      }
      .settings-confirm-overlay {
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: grid;
        place-items: center;
        padding: 12px;
        box-sizing: border-box;
        background: rgba(0, 0, 0, 0.62);
      }
      .settings-clear-confirmation {
        width: min(248px, calc(100vw - 24px));
        padding: 9px;
        box-sizing: border-box;
        color: #e2ded0;
        background: #0e1d25;
        border: 2px solid #5a4a2a;
        border-radius: 6px;
        box-shadow: 0 3px 12px rgba(0, 0, 0, 0.72);
      }
      .settings-clear-confirmation-title {
        padding-bottom: 5px;
        color: #d8c58a;
        font-size: 12px;
        font-weight: bold;
        border-bottom: 1px solid rgba(216, 197, 138, 0.3);
      }
      .settings-clear-confirmation-message {
        margin: 7px 0 9px;
        color: #ded9cb;
        font-size: 12px;
        line-height: 1.35;
      }
      .settings-clear-confirmation-actions {
        display: flex;
        justify-content: flex-end;
        gap: 5px;
      }
      .settings-clear-confirmation-actions button {
        min-height: 22px;
        padding: 3px 7px;
        font-size: 12px;
      }
      .settings-clear-confirmation-confirm {
        color: #ffd0b8;
        border-color: #9b5636;
        background: linear-gradient(#4b2a1d, #21130e);
      }
      .settings-patch-notes {
        height: auto;
        padding: 0;
        color: #d8c58a;
        background: transparent;
        border: 0;
        box-shadow: none;
        font-size: inherit;
      }
      .settings-patch-notes:hover,
      .settings-patch-notes:focus-visible { color: #fff2aa; outline: none; }
      .import { display: none; }
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
    doc.querySelector(".settings-session-link")?.addEventListener("click", () => {
      actions.showSession();
      window.setTimeout(refresh, 100);
    });
    doc.querySelector(".find-chat")?.addEventListener("click", actions.findChat);
    doc.querySelector(".history-button")?.addEventListener("click", actions.showHistory);
    doc
      .querySelector(".fishing-porters-toggle input")
      ?.addEventListener("change", actions.toggleFishingPorters);
    doc
      .querySelector(".short-invention-names-toggle input")
      ?.addEventListener("change", actions.toggleShortInventionNames);
    doc
      .querySelector(".all-tab-icons-toggle input")
      ?.addEventListener("change", actions.toggleAllTabIcons);
    doc
      .querySelector(".status-footer-toggle input")
      ?.addEventListener("change", actions.toggleStatusFooter);
    doc
      .querySelector(".invention-filter-visibility-toggle input")
      ?.addEventListener("change", actions.toggleInventionFilterVisibility);
    doc
      .querySelector(".archaeology-filter-visibility-toggle input")
      ?.addEventListener("change", actions.toggleArchaeologyFilterVisibility);
    doc
      .querySelector(".archaeology-artefact-visibility-toggle input")
      ?.addEventListener("change", actions.toggleArchaeologyArtefactVisibility);
    doc
      .querySelectorAll<HTMLInputElement>(".settings-tracked-skill input")
      .forEach((input) => {
        input.addEventListener("change", () => {
          actions.setTrackedSkillVisible(
            input.dataset.skill as TrackableSkill,
            input.checked,
          );
        });
      });
    doc
      .querySelector(".hide-unknown-section-toggle input")
      ?.addEventListener("change", actions.toggleUnknownSectionVisibility);
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
    doc.querySelector(".clear")?.addEventListener("click", () => {
      const state = actions.getState();
      if (!state.clearHasTrackedItems) return;

      requestTrackingConfirmation(doc, getClearConfirmation(state.clearLabel), () => {
        actions.clearCurrentTab();
        refresh();
      });
    });
    doc.querySelector(".reset")?.addEventListener("click", () => {
      const state = actions.getState();
      if (!state.resetHasTrackedCounts) return;

      requestTrackingConfirmation(doc, getResetConfirmation(state.resetLabel), () => {
        actions.resetCurrentTabCounts();
        refresh();
      });
    });

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

function cloneApplicationStyles(doc: Document): Node[] {
  return Array.from(
    document.head.querySelectorAll('style, link[rel="stylesheet"]'),
  ).map((node) => doc.importNode(node, true));
}

function getClearConfirmation(clearLabel: string): TrackingConfirmation {
  const isAll = clearLabel === "Clear ALL";
  const scope = clearLabel.replace(/^Clear\s+/, "");

  return {
    title: isAll ? "Clear all tracking data?" : `${clearLabel}?`,
    message: isAll
      ? "This will permanently remove all tracked items and counts from every tab."
      : `This will permanently remove all tracked ${scope} items and counts.`,
    confirmLabel: clearLabel,
  };
}

function getResetConfirmation(resetLabel: string): TrackingConfirmation {
  const isAll = resetLabel === "Reset ALL";
  const scope = resetLabel.replace(/^Reset\s+/, "");

  return {
    title: isAll ? "Reset all tracked counts?" : `${resetLabel} counts?`,
    message: isAll
      ? "This will reset every tracked item count to 0 while keeping the items and their goals."
      : `This will reset all tracked ${scope} item counts to 0 while keeping the items and their goals.`,
    confirmLabel: resetLabel,
  };
}

function requestTrackingConfirmation(
  doc: Document,
  confirmation: TrackingConfirmation,
  onConfirm: () => void,
): void {
  const existing = doc.querySelector(".settings-confirm-overlay");
  if (existing) {
    (
      existing.querySelector(
        ".settings-clear-confirmation-cancel",
      ) as HTMLButtonElement | null
    )?.focus();
    return;
  }

  const overlay = doc.createElement("div");
  overlay.className = "settings-confirm-overlay";

  const dialog = doc.createElement("section");
  dialog.className = "settings-clear-confirmation";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "settings-clear-confirmation-title");

  const title = doc.createElement("div");
  title.className = "settings-clear-confirmation-title";
  title.id = "settings-clear-confirmation-title";
  title.textContent = confirmation.title;

  const message = doc.createElement("div");
  message.className = "settings-clear-confirmation-message";
  message.textContent = confirmation.message;

  const actionButtons = doc.createElement("div");
  actionButtons.className = "settings-clear-confirmation-actions";
  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "settings-clear-confirmation-cancel";
  cancel.textContent = "Cancel";
  const confirm = doc.createElement("button");
  confirm.type = "button";
  confirm.className = "settings-clear-confirmation-confirm";
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

  actionButtons.append(cancel, confirm);
  dialog.append(title, message, actionButtons);
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
  state: SettingsWindowState,
): void {
  const chat = doc.querySelector(".chat") as HTMLSelectElement | null;
  if (!chat) return;

  if (chat.options.length !== state.chatTypes.length + 1) {
    chat.replaceChildren(new Option("Select Chat", ""));
    for (let index = 0; index < state.chatTypes.length; index += 1) {
      const suffix = state.chatTypes.length > 1 ? ` ${index + 1}` : "";
      chat.add(
        new Option(
          `${getChatTypeLabel(state.chatTypes[index])}${suffix}`,
          String(index),
        ),
      );
    }
  }

  chat.value = state.selectedChat;
}

function getChatTypeLabel(type: ChatboxType): string {
  switch (type) {
    case "main":
      return "Main chat";
    case "cc":
      return "Clan chat";
    case "fc":
      return "Friends chat";
    case "gc":
      return "Group chat";
    case "gcc":
      return "Guest clan chat";
    case "private":
      return "Private chat";
    case "gimc":
      return "Group ironman chat";
    default:
      return "Chat window";
  }
}

function updateSettingsSwitch(
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

function updateSessionStatus(doc: Document, status: SessionStatus): void {
  const quickButton = doc.querySelector(
    ".session-quick-button",
  ) as HTMLButtonElement | null;
  const statusText =
    status === "running"
      ? "Running"
      : status === "paused"
        ? "Paused"
        : "Not Running";

  if (quickButton) {
    quickButton.classList.remove("running", "paused", "idle");
    quickButton.classList.add(status);
    quickButton.title = `Session: ${statusText}`;
    quickButton.setAttribute("aria-label", `Session: ${statusText}`);
  }
}

function settingsMarkup(): string {
  return `
    <div class="settings-window-panel">
      <div class="settings-window-main">
      <nav class="settings-sidebar" aria-label="Settings sections">
        <div class="settings-sidebar-title">Settings</div>
        <button class="settings-sidebar-item" type="button" data-page="general">General/UI</button>
        <button class="settings-sidebar-item" type="button" data-page="skills">Skills</button>
        <button class="settings-sidebar-item" type="button" data-page="data">Data</button>
        <div class="settings-sidebar-title"></div>
        <button class="settings-session-button settings-session-link" type="button">Session</button>
      </nav>
      <div class="settings-page-content">
          <section class="settings-page" data-settings-page="general">
            <div class="settings-section">
              <div class="settings-section-title">CHAT</div>
              <div class="settings-field">
                <div class="settings-chat-row">
                  <div class="settings-field-description">Supported Text Sizes:   10pt-16pt. Click 'Find Chat' if you change your Text Size.</div>
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
              ${settingsSwitchMarkup("all-tab-icons-toggle", "All-Tab Icons", "Show skill icons beside items on the All tab.")}
              ${settingsSwitchMarkup("status-footer-toggle", "Show Status Footer", "Show the tracking message at the bottom of the tracker.")}
            </div>
          </section>
          <section class="settings-page" data-settings-page="skills" hidden>
            <div class="settings-section">
              <div class="settings-section-title">TRACKED SKILLS/EVENTS</div>
              <div class="settings-field-description">Toggle Tracked Skills and Events ON/OFF.</div>
              <div class="settings-tracked-skills">
                ${settingsTrackedSkillsMarkup()}
              </div>
            </div>
            <div class="settings-section">
              <div class="settings-section-title">FISHING</div>
              ${settingsSwitchMarkup("fishing-porters-toggle", "Sign of the Porter", "Track fish sent through porters and bank transports.")}
            </div>
            <div class="settings-section">
              <div class="settings-section-title">INVENTION</div>
              ${settingsSwitchMarkup("short-invention-names-toggle", "Short Invention Names", "Shorten component and part labels in the tracker.")}
              ${settingsSwitchMarkup("invention-filter-visibility-toggle", "Show Invention Filter", "Show the material filter control on the Invention tab.")}
            </div>
            <div class="settings-section">
              <div class="settings-section-title">ARCHAEOLOGY</div>
              ${settingsSwitchMarkup("archaeology-filter-visibility-toggle", "Show Dig Site Filter", "Show the Dig Site filter control on the Archaeology tab.")}
              ${settingsSwitchMarkup("archaeology-artefact-visibility-toggle", "Show Artefacts", "Show damaged artefacts on the Archaeology tab.")}
            </div>
            <div class="settings-section">
              <div class="settings-section-title">MISC.</div>
              ${settingsSwitchMarkup("hide-unknown-section-toggle", "Hide Unknown Items", "Hide unclassified items from the All tab.")}
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
              <button class="history-button" type="button">History</button>
            </div>
          </section>
      </div>
      </div>
      <div class="settings-bottom-area">
        <div class="settings-bottom-actions">
          <button class="clear" type="button">Clear Tab</button>
          <button class="reset" type="button">Reset Tab</button>
        </div>
        <div class="settings-bottom-links">
          <span class="settings-version-label"></span>
          <button class="settings-patch-notes" type="button" title="Show Patch Notes">Patch Notes</button>
        </div>
      </div>
    </div>
  `;
}

function settingsSwitchMarkup(
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

function settingsTrackedSkillsMarkup(): string {
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
