import * as a1lib from "alt1/base";
import ChatBoxReader from "alt1/chatbox";
import type * as OCR from "alt1/ocr";
import font10pt from "../../node_modules/alt1/src/fonts/chatbox/10pt.fontmeta.json";
import font12pt from "../../node_modules/alt1/src/fonts/chatbox/12pt.fontmeta.json";
import font14pt from "../../node_modules/alt1/src/fonts/chatbox/14pt.fontmeta.json";
import font16pt from "../../node_modules/alt1/src/fonts/chatbox/16pt.fontmeta.json";
import {
  applyMaterialSupplement,
  rereadMaterialPhysicalLine,
} from "../invention/InventionMaterialOcr";
import { couldStartInventionMessage } from "../invention/InventionParser";
import {
  couldStartSkillTrackerMessage,
  isMaterialsGainedMessage,
  isSpiritRewardMessage,
} from "../tracking/trackerMessages";
import type {
  ChatFontSetting,
  ChatboxPosition,
  LogicalChatMessage,
  PhysicalChatLine,
} from "./chatTypes";
import { CustomPhysicalRowDecoder } from "./customPhysicalRowDecoder";

export { ChatboxPosition };

const trackerChatColors: readonly OCR.ColortTriplet[] = [
  [255, 255, 255], // Normal tracked text and timestamp brackets.
  [127, 169, 255], // Timestamp digits.
  [255, 0, 0], // Red Invention material names.

  [245, 135, 55], // Orange Invention material names.
  [255, 128, 0], // Orange Invention component variant.
  [235, 119, 3], // 10pt orange component variant.
  [255, 165, 0], // Scavenging orange component names.
  [245, 159, 1], // Scavenging orange component names.

  [67, 188, 188], // Teal Invention component names.
  [0, 255, 0], // Bright green Forge Phoenix/Fire Spirit rewards.
  [51, 197, 20], // Faded green spirit reward variant.
  [59, 181, 20], // Green spirit reward variant.
  [59, 181, 30], // Green reward anti-aliasing variant.
  [59, 176, 30], // 10pt–12pt green spirit reward variant.
  [41, 77, 27], // Green anti-aliasing.
  [40, 67, 28], // Green anti-aliasing.

  [0, 255, 255], // Seren spirit reward text.
  [127, 255, 255], // Seren reward anti-aliasing variant.
];

const trackerOcrPalette: readonly OCR.ColortTriplet[] = trackerChatColors.map(
  ([red, green, blue]) => [red, green, blue],
);
const trackerChatFontCandidates: readonly ChatFontSetting[] = [
  chatFont("10pt", 14, -9, -2, font10pt),
  chatFont("12pt", 16, -9, -3, font12pt),
  chatFont("14pt", 18, -10, -3, font14pt),
  chatFont("16pt", 21, -10, -4, font16pt),
];
const leadingTimestampRegex = /^\[\s*(\d{2})\s*:\s*(\d{2})\s*:\s*(\d{2})\s*\]\s*/;

export default class ResourceChatReader {
  private readonly reader = new ChatBoxReader();
  private readonly customDecoder = new CustomPhysicalRowDecoder(
    trackerChatFontCandidates,
    trackerOcrPalette,
  );
  private readonly lineDiff = new VisibleLineDiff();
  private pendingMessage: string | null = null;
  private pendingTimestamp: string | null = null;
  private materialContextActive = false;
  private findErrorReported = false;

  constructor() {
    this.reader.readargs.colors = trackerChatColors.map((color) =>
      a1lib.mixColor(color[0], color[1], color[2]),
    );
  }

  get pos(): ChatboxPosition | null {
    return this.reader.pos as ChatboxPosition | null;
  }

  set pos(value: ChatboxPosition | null) {
    this.reader.pos = value as typeof this.reader.pos;
  }

  get selectedFontName(): string | null {
    return this.reader.font?.name ?? null;
  }

  find(): ChatboxPosition | null {
    if (typeof window === "undefined" || !window.alt1) return null;
    a1lib.resetEnvironment();
    this.resetForRefind();
    try {
      const position = this.reader.find() as ChatboxPosition | null;
      this.findErrorReported = false;
      return position;
    } catch (error) {
      if (!this.findErrorReported) {
        console.warn("Chatbox discovery failed", error);
        this.findErrorReported = true;
      }
      return null;
    }
  }

  read(): LogicalChatMessage[] {
    const defaultLines = this.readDefaultLines();
    const customLines = this.readCustomLines();
    const physicalLines = mergePhysicalLines(defaultLines, customLines);
    if (physicalLines.length === 0) this.materialContextActive = false;
    const enhancedLines = physicalLines.map((line) => this.enhanceMaterialLine(line));
    const grouped = groupPhysicalLines(enhancedLines, {
      pendingMessage: this.pendingMessage,
      pendingTimestamp: this.pendingTimestamp,
    }, physicalLines.length === 0);
    this.pendingMessage = grouped.pendingMessage;
    this.pendingTimestamp = grouped.pendingTimestamp;
    return grouped.messages.map((text) => ({ text }));
  }

  private readDefaultLines(): PhysicalChatLine[] {
    const lines = (this.reader.read() ?? []) as PhysicalChatLine[];
    if (!isSupportedTrackerFont(this.reader.font?.name)) {
      this.reader.font = null;
      return [];
    }
    return lines;
  }

  private readCustomLines(): PhysicalChatLine[] {
    const visibleLines = this.customDecoder.read(this.reader);
    const newLines = this.lineDiff.next(visibleLines);
    return newLines;
  }

  private enhanceMaterialLine(line: PhysicalChatLine): PhysicalChatLine {
    const hasTimestamp = leadingTimestampRegex.test(line.text);
    const body = line.text.replace(leadingTimestampRegex, "").trim();
    const startsMaterialMessage = isMaterialsGainedMessage(body);
    if (hasTimestamp) this.materialContextActive = startsMaterialMessage;
    else if (startsMaterialMessage) this.materialContextActive = true;

    return applyMaterialSupplement(
      line,
      startsMaterialMessage || (!hasTimestamp && this.materialContextActive),
      (physicalLine) => rereadMaterialPhysicalLine(
        physicalLine,
        trackerOcrPalette,
        (absoluteBaseline, colors) => this.customDecoder.decodeCapturedRow(
          this.reader,
          absoluteBaseline,
          colors.slice(),
        ),
      ),
    ).line;
  }

  private resetForRefind(): void {
    this.reader.pos = null;
    this.reader.font = null;
    this.reader.overlaplines = [];
    this.reader.lastTimestamp = -1;
    this.reader.lastTimestampUpdate = 0;
    this.reader.addedLastread = false;
    this.reader.lastReadBuffer = null;
    this.customDecoder.resetCaptureState();
    this.lineDiff.reset();
    this.pendingMessage = null;
    this.pendingTimestamp = null;
    this.materialContextActive = false;
  }
}

function chatFont(
  name: string,
  lineheight: number,
  badgey: number,
  dy: number,
  definition: unknown,
): ChatFontSetting {
  return { name, lineheight, badgey, dy, def: definition as OCR.FontDefinition };
}

function isSupportedTrackerFont(name: string | undefined): boolean {
  return trackerChatFontCandidates.some((font) => font.name === name);
}

function mergePhysicalLines(
  defaultLines: readonly PhysicalChatLine[],
  customLines: readonly PhysicalChatLine[],
): PhysicalChatLine[] {
  const fallbackLines = customLines.filter(isCustomFallbackLine);
  if (fallbackLines.length === 0) return [...defaultLines];

  const fallbackBaselines = new Set(fallbackLines.map((line) => line.basey));
  return [
    ...defaultLines.filter((line) => !fallbackBaselines.has(line.basey)),
    ...fallbackLines,
  ].sort((left, right) => left.basey - right.basey);
}

function isCustomFallbackLine(line: PhysicalChatLine): boolean {
  const body = stripTimestamp(normalizeChatWhitespace(line.text));
  return (
    isMaterialsGainedMessage(body) ||
    isSpiritRewardMessage(body) ||
    couldStartInventionMessage(body) ||
    couldStartSkillTrackerMessage(body) ||
    isTrackerContinuation(body)
  );
}

function isTrackerContinuation(text: string): boolean {
  return (
    isQuantityEntry(text) ||
    /^Junk[,.]?\s*$/i.test(text) ||
    /^[a-z]+(?:-[a-z]+)?\s+(?:parts|components)[,.]?\s*$/i.test(text)
  );
}

type GroupState = { pendingMessage: string | null; pendingTimestamp: string | null };
type GroupResult = GroupState & { messages: string[] };

function groupPhysicalLines(
  lines: ReadonlyArray<Pick<PhysicalChatLine, "text">>,
  state: GroupState,
  flushOnEmpty: boolean,
): GroupResult {
  const messages: string[] = [];
  let pendingMessage = state.pendingMessage;
  let pendingTimestamp = state.pendingTimestamp;
  const flush = () => {
    if (pendingMessage) messages.push(pendingMessage);
    pendingMessage = null;
    pendingTimestamp = null;
  };
  if (lines.length === 0) {
    if (flushOnEmpty && !isUnfinishedMaterialMessage(pendingMessage)) flush();
    return { messages, pendingMessage, pendingTimestamp };
  }
  for (const line of lines) {
    const text = normalizeChatWhitespace(line.text);
    if (!text) continue;
    const timestamp = getLeadingTimestamp(text);
    if (timestamp) {
      if (timestamp === pendingTimestamp && isUnfinishedMaterialMessage(pendingMessage) && isSameMessageRepaint(pendingMessage!, text)) {
        pendingMessage = text;
      } else if (timestamp === pendingTimestamp && isSpiritGiftHeader(pendingMessage) && isQuantityEntry(stripTimestamp(text))) {
        pendingMessage = joinContinuation(pendingMessage!, text);
      } else if (timestamp === pendingTimestamp && isMaterialMessage(pendingMessage) && isQuantityEntry(stripTimestamp(text))) {
        pendingMessage = joinContinuation(pendingMessage!, text);
      } else {
        flush();
        if (stripTimestamp(text)) {
          pendingMessage = text;
          pendingTimestamp = timestamp;
        }
      }
    } else if (pendingMessage) {
      pendingMessage = joinContinuation(pendingMessage, text);
    } else {
      messages.push(text);
    }
  }
  return { messages, pendingMessage, pendingTimestamp };
}

function isUnfinishedMaterialMessage(text: string | null): boolean {
  if (!text) return false;
  const body = stripTimestamp(text);
  return isMaterialsGainedMessage(body) && (/\s*,\s*$/.test(body) || /\b[1-9]\d*\s*x\s*$/i.test(body));
}

function getLeadingTimestamp(text: string): string | null {
  const match = text.match(leadingTimestampRegex);
  return match ? `[${match[1]}:${match[2]}:${match[3]}]` : null;
}

function stripTimestamp(text: string): string {
  return text.replace(leadingTimestampRegex, "").trim();
}

function normalizeChatWhitespace(text: string): string {
  return text.replace(leadingTimestampRegex, (_match, hour, minute, second) => `[${hour}:${minute}:${second}] `).replace(/\s+/g, " ").trim();
}

function joinContinuation(currentMessage: string, continuationText: string): string {
  const base = normalizeChatWhitespace(currentMessage);
  const continuation = normalizeChatWhitespace(stripTimestamp(continuationText));
  if (!continuation) return base;
  return normalizeChatWhitespace(`${base}${getContinuationSeparator(base, continuation)}${continuation}`);
}

function getContinuationSeparator(base: string, continuation: string): string {
  if (/^[,.;:!?)]/.test(continuation)) return "";
  const body = stripTimestamp(base);
  if (isMaterialsGainedMessage(body) && /\b(?:parts|components)$/i.test(body) && /^[1-9]\d*\s*x\b/i.test(continuation)) return ", ";
  if (isSpiritRewardMessage(stripTimestamp(base)) && isQuantityEntry(continuation)) return ", ";
  return " ";
}

function isSpiritGiftHeader(text: string | null): boolean {
  return text !== null && isSpiritRewardMessage(stripTimestamp(text)) && /:\s*$/.test(stripTimestamp(text));
}

function isMaterialMessage(text: string | null): boolean {
  return text !== null && isMaterialsGainedMessage(stripTimestamp(text));
}

function isQuantityEntry(text: string): boolean {
  return /^[1-9][\d,]*\s*x\s+\S/i.test(normalizeChatWhitespace(stripTimestamp(text)));
}

function isSameMessageRepaint(pending: string, current: string): boolean {
  const prior = normalizeChatWhitespace(pending);
  const next = normalizeChatWhitespace(current);
  return prior === next || next.startsWith(prior);
}

class VisibleLineDiff {
  private previous: PhysicalChatLine[] = [];
  private lastTimestamp: string | null = null;
  private captureInterrupted = false;

  reset(): void {
    this.previous = [];
    this.lastTimestamp = null;
    this.captureInterrupted = false;
  }

  next(currentLines: readonly PhysicalChatLine[]): PhysicalChatLine[] {
    const current = currentLines.map(copyLine);
    if (current.length === 0) {
      this.captureInterrupted = true;
      return [];
    }
    if (this.captureInterrupted && this.lastTimestamp) {
      const watermarkIndex = findLastTimestampIndex(current, this.lastTimestamp);
      if (watermarkIndex !== -1) {
        const resumeIndex = findNextTimestampIndex(current, watermarkIndex + 1, this.lastTimestamp);
        this.previous = current;
        this.captureInterrupted = false;
        this.updateLastTimestamp(current);
        return resumeIndex === -1 ? [] : current.slice(resumeIndex);
      }
      const newestTimestamp = getLastTimestamp(current);
      if (!newestTimestamp || !isTimestampAfter(newestTimestamp, this.lastTimestamp)) return [];
    }
    this.captureInterrupted = false;
    const overlap = findSequenceOverlap(this.previous, current);
    const newLines = current.slice(overlap);
    this.previous = current;
    this.updateLastTimestamp(current);
    return newLines;
  }

  private updateLastTimestamp(lines: readonly Pick<PhysicalChatLine, "text">[]): void {
    const timestamp = getLastTimestamp(lines);
    if (timestamp) this.lastTimestamp = timestamp;
  }
}

function copyLine(line: PhysicalChatLine): PhysicalChatLine {
  return { ...line, fragments: line.fragments.map((fragment) => ({ ...fragment })) };
}

function findSequenceOverlap(previous: readonly Pick<PhysicalChatLine, "text">[], current: readonly Pick<PhysicalChatLine, "text">[]): number {
  for (let size = Math.min(previous.length, current.length); size > 0; size--) {
    const start = previous.length - size;
    if (current.slice(0, size).every((line, index) => line.text === previous[start + index].text)) return size;
  }
  return 0;
}

function getLastTimestamp(lines: readonly Pick<PhysicalChatLine, "text">[]): string | null {
  for (let index = lines.length - 1; index >= 0; index--) {
    const timestamp = getLeadingTimestamp(lines[index].text);
    if (timestamp) return timestamp;
  }
  return null;
}

function findLastTimestampIndex(lines: readonly Pick<PhysicalChatLine, "text">[], timestamp: string): number {
  for (let index = lines.length - 1; index >= 0; index--) {
    if (getLeadingTimestamp(lines[index].text) === timestamp) return index;
  }
  return -1;
}

function findNextTimestampIndex(lines: readonly Pick<PhysicalChatLine, "text">[], startIndex: number, previousTimestamp: string): number {
  for (let index = startIndex; index < lines.length; index++) {
    const timestamp = getLeadingTimestamp(lines[index].text);
    if (timestamp && timestamp !== previousTimestamp) return index;
  }
  return -1;
}

function isTimestampAfter(candidate: string, previous: string): boolean {
  const toSeconds = (timestamp: string) => {
    const [hour, minute, second] = timestamp.slice(1, -1).split(":").map(Number);
    return hour * 3600 + minute * 60 + second;
  };
  const forward = (toSeconds(candidate) - toSeconds(previous) + 86400) % 86400;
  return forward > 0 && forward <= 12 * 60 * 60;
}
