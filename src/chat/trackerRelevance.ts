import { couldStartInventionMessage } from "../invention/InventionParser";
import { couldStartSkillTrackerMessage } from "../tracking/SkillTracker";

export type TrackerRowClassification =
  "relevant" | "contextual" | "uncertain" | "confidently-irrelevant";

export type TrackerContinuationContext = {
  kind: "material" | "spirit" | "tracked";
  timestamp: string | null;
} | null;

const timestampRegex = /^\[\s*(\d{2})\s*:\s*(\d{2})\s*:\s*(\d{2})\s*\]\s*/;

export function classifyTrackerRow(
  screenText: string,
  context: TrackerContinuationContext,
): TrackerRowClassification {
  const normalized = normalizeScreenText(screenText);
  if (!normalized) return "uncertain";

  const timestamp = getTrackerTimestamp(normalized);
  const body = stripTrackerTimestamp(normalized);
  if (!body) return "uncertain";

  if (
    context &&
    (!timestamp ||
      (timestamp === context.timestamp && isQuantityContinuation(body)))
  ) {
    return "contextual";
  }

  if (couldStartInventionMessage(body) || couldStartSkillTrackerMessage(body)) {
    return "relevant";
  }

  if (looksLikeDamagedTrackedPrefix(body)) {
    return "uncertain";
  }

  const wordCharacters = (body.match(/[A-Za-z0-9]/g) ?? []).length;
  if (body.length >= 12 && wordCharacters >= 8 && /^[A-Za-z❆⚯㊉]/.test(body)) {
    return "confidently-irrelevant";
  }

  return "uncertain";
}

export function advanceTrackerContext(
  current: TrackerContinuationContext,
  fullText: string,
  classification: TrackerRowClassification,
): TrackerContinuationContext {
  const normalized = normalizeScreenText(fullText);
  const timestamp = getTrackerTimestamp(normalized);
  const body = stripTrackerTimestamp(normalized);

  if (!timestamp) return current;
  if (!body) return null;

  if (/^Materials gained:/i.test(body)) {
    return { kind: "material", timestamp };
  }
  if (
    /^The (?:Seren spirit|forge phoenix|fire spirit) gifts you:/i.test(body)
  ) {
    return { kind: "spirit", timestamp };
  }
  if (
    couldStartInventionMessage(body) ||
    couldStartSkillTrackerMessage(body) ||
    (classification === "uncertain" && looksLikeDamagedTrackedPrefix(body))
  ) {
    return { kind: "tracked", timestamp };
  }

  return null;
}

export function getTrackerTimestamp(text: string): string | null {
  const match = normalizeScreenText(text).match(timestampRegex);
  return match ? `[${match[1]}:${match[2]}:${match[3]}]` : null;
}

function stripTrackerTimestamp(text: string): string {
  return normalizeScreenText(text).replace(timestampRegex, "").trim();
}

export function isTrackerBoundaryLine(text: string): boolean {
  return (
    getTrackerTimestamp(text) !== null &&
    stripTrackerTimestamp(text).length === 0
  );
}

function isQuantityContinuation(text: string): boolean {
  return /^[1-9][\d,]*\s+x(?:\s+\S|$)/i.test(text);
}

function looksLikeDamagedTrackedPrefix(text: string): boolean {
  return (
    /^M[a-z.-]{2,12}\s+g[a-z.-]{2,12}/i.test(text) ||
    /^Y[o0u\s.-]{2,7}\s+(?:rec|get|cat|fin|trans|por)/i.test(text) ||
    /^(?:The\s+)?(?:Ser|forge|fire).{0,24}(?:gift|spirit|phoenix)/i.test(
      text,
    ) ||
    /^\W{0,3}[1-9][\d,]*\s*x\b/i.test(text)
  );
}

function normalizeScreenText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
