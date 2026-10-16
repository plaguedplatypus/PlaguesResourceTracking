export type SkillType =
  | "all"
  | "mining"
  | "woodcutting"
  | "fishing"
  | "farming"
  | "archaeology"
  | "divination"
  | "hunter"
  | "seren"
  | "invention";

export type InternalSkillType = SkillType | "other";

export type TrackedItem = {
  count: number;
  goal: number | null;
  displayName?: string;
  skill?: InternalSkillType;
  source?: string;
  colorClass?: string;
  lastUpdated?: number;
  price?: number | null;
};

export type ItemUpdate = {
  item: string;
  amount: number;
  skill: InternalSkillType;
  colorClass?: string;
  source?: string;
  storageId?: string;
};

export type TrackableSkill = Exclude<SkillType, "all"> | "fire";
export type SkillSelection = Record<TrackableSkill, boolean>;
export type SortMode = "recent" | "alpha" | "count";
export type CountPosition = "right" | "left";
export type ItemDisplay = "list" | "card";
export type HistoryDays = 30 | 90;

export type SaveData = {
  chat?: string;
  activeTab?: InternalSkillType;
  fishingUsePorters?: boolean;
  shortInventionNames?: boolean;
  countPosition?: CountPosition;
  itemDisplay?: ItemDisplay;
  showAllTabIcons?: boolean;
  showGoalProgress?: boolean;
  progressColor?: string;
  showInventionFilter?: boolean;
  showArchFilter?: boolean;
  showArchArtefacts?: boolean;
  visibleSkills?: Partial<SkillSelection>;
  hideUnknownSection?: boolean;
  trackerSize?: number;
  historyDays?: HistoryDays;
  sortMode?: SortMode;
  items: Record<string, TrackedItem>;
};

const appName = "ResourceTracker";
const trackerSizeMin = 10;
const trackerSizeMax = 16;
export const trackerSizeDefault = 12;
export const historyDaysDefault = 30;
export const progressColorDefault = "#78d86b";

export function normalizeSkillSelection(value: unknown): SkillSelection {
  const savedSelection = value as Partial<SkillSelection> | undefined;
  return {
    mining: savedSelection?.mining ?? true,
    woodcutting: savedSelection?.woodcutting ?? true,
    fishing: savedSelection?.fishing ?? false,
    farming: savedSelection?.farming ?? false,
    archaeology: savedSelection?.archaeology ?? true,
    invention: savedSelection?.invention ?? true,
    divination: savedSelection?.divination ?? false,
    hunter: savedSelection?.hunter ?? false,
    seren: savedSelection?.seren ?? true,
    fire: savedSelection?.fire ?? savedSelection?.seren ?? true,
  };
}

export function normalizeTrackerSize(value: unknown): number {
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

export function normalizeHistoryDays(value: unknown): HistoryDays {
  return value === 90 ? 90 : historyDaysDefault;
}

export function normalizeProgressColor(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : progressColorDefault;
}

export function normalizeSaveData(value: unknown): SaveData {
  if (value === undefined) {
    return {
      itemDisplay: "card",
      showGoalProgress: true,
      progressColor: progressColorDefault,
      sortMode: "recent",
      trackerSize: trackerSizeDefault,
      historyDays: historyDaysDefault,
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
    itemDisplay: data.itemDisplay === "list" ? "list" : "card",
    showAllTabIcons: data.showAllTabIcons ?? true,
    showGoalProgress: data.showGoalProgress ?? true,
    progressColor: normalizeProgressColor(data.progressColor),
    showInventionFilter: data.showInventionFilter ?? true,
    showArchFilter: data.showArchFilter ?? true,
    showArchArtefacts: data.showArchArtefacts ?? true,
    visibleSkills: normalizeSkillSelection(data.visibleSkills),
    hideUnknownSection: data.hideUnknownSection ?? true,
    trackerSize: normalizeTrackerSize(data.trackerSize),
    historyDays: normalizeHistoryDays(data.historyDays),
    sortMode: data.sortMode || "recent",
    items: data.items || {},
  };
}

export function getSaveData(): SaveData {
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

export function saveData(data: SaveData) {
  localStorage.setItem(appName, JSON.stringify(data));
}

export function saveSetting<Field extends keyof SaveData>(
  field: Field,
  value: SaveData[Field],
) {
  const data = getSaveData();
  data[field] = value;
  saveData(data);
}
