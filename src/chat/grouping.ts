import type { PhysicalChatLine } from "./chatTypes";

const leadingTimestampRegex =
  /^\[\s*(\d{2})\s*:\s*(\d{2})\s*:\s*(\d{2})\s*\]\s*/;

type GroupState = {
  pendingMessage: string | null;
  pendingTimestamp: string | null;
};

type GroupResult = GroupState & {
  messages: string[];
};

export function groupPhysicalLines(
  lines: ReadonlyArray<Pick<PhysicalChatLine, "text">>,
  state: GroupState = {
    pendingMessage: null,
    pendingTimestamp: null,
  },
  flushOnEmpty = false,
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
    if (flushOnEmpty && !isUnfinishedMaterialMessage(pendingMessage)) {
      flush();
    }
    return { messages, pendingMessage, pendingTimestamp };
  }

  for (const line of lines) {
    const text = normalizeChatWhitespace(line.text);
    if (!text) continue;

    const timestamp = getLeadingTimestamp(text);
    if (timestamp) {
      if (
        timestamp === pendingTimestamp &&
        isUnfinishedMaterialMessage(pendingMessage) &&
        isSameMessageRepaint(pendingMessage!, text)
      ) {
        pendingMessage = text;
        continue;
      }
      if (
        timestamp === pendingTimestamp &&
        isSpiritGiftHeader(pendingMessage) &&
        isQuantityEntry(stripTimestamp(text))
      ) {
        pendingMessage = joinContinuation(pendingMessage!, text);
        continue;
      }
      if (
        timestamp === pendingTimestamp &&
        isMaterialMessage(pendingMessage) &&
        isQuantityEntry(stripTimestamp(text))
      ) {
        pendingMessage = joinContinuation(pendingMessage!, text);
        continue;
      }
      flush();
      if (!stripTimestamp(text)) {
        continue;
      }
      pendingMessage = text;
      pendingTimestamp = timestamp;
      continue;
    }

    if (pendingMessage) {
      pendingMessage = joinContinuation(pendingMessage, text);
      continue;
    }

    messages.push(text);
  }

  return { messages, pendingMessage, pendingTimestamp };
}

function isUnfinishedMaterialMessage(text: string | null): boolean {
  if (!text) return false;
  const body = normalizeChatWhitespace(text).replace(leadingTimestampRegex, "");
  return (
    /^Materials gained:/i.test(body) &&
    (/,\s*$/.test(body) || /\b[1-9]\d*\s*x\s*$/i.test(body))
  );
}

function getLeadingTimestamp(text: string): string | null {
  const match = text.match(leadingTimestampRegex);
  return match ? `[${match[1]}:${match[2]}:${match[3]}]` : null;
}

function hasTimestamp(text: string): boolean {
  return getLeadingTimestamp(text) !== null;
}

function stripTimestamp(text: string): string {
  return text.replace(leadingTimestampRegex, "").trim();
}

function normalizeChatWhitespace(text: string): string {
  return text
    .replace(
      leadingTimestampRegex,
      (_match, hour, minute, second) => `[${hour}:${minute}:${second}] `,
    )
    .replace(/\s+/g, " ")
    .trim();
}

function joinContinuation(
  currentMessage: string,
  continuationText: string,
): string {
  const base = normalizeChatWhitespace(currentMessage);
  const continuation = normalizeChatWhitespace(
    stripTimestamp(continuationText),
  );
  if (!continuation) return base;

  const separator = getContinuationSeparator(base, continuation);
  return normalizeChatWhitespace(`${base}${separator}${continuation}`);
}

function getContinuationSeparator(base: string, continuation: string): string {
  if (/^[,.;:!?)]/.test(continuation)) return "";
  const body = stripTimestamp(base);
  if (
    /^Materials gained:/i.test(body) &&
    /\b(?:parts|components)$/i.test(body) &&
    /^[1-9]\d*\s*x\b/i.test(continuation)
  ) {
    return ", ";
  }
  if (isSpiritGiftWithReward(base) && isQuantityEntry(continuation)) {
    return ", ";
  }
  return " ";
}

function isSpiritGiftHeader(text: string | null): boolean {
  return (
    text !== null &&
    /^The (?:Seren spirit|forge phoenix|fire spirit) gifts you:\s*$/i.test(
      stripTimestamp(text),
    )
  );
}

function isSpiritGiftWithReward(text: string): boolean {
  return /^The (?:Seren spirit|forge phoenix|fire spirit) gifts you:\s*[1-9][\d,]*\s*x\b/i.test(
    stripTimestamp(text),
  );
}

function isMaterialMessage(text: string | null): boolean {
  return text !== null && /^Materials gained:/i.test(stripTimestamp(text));
}

function isQuantityEntry(text: string): boolean {
  return /^[1-9][\d,]*\s*x\s+\S/i.test(
    normalizeChatWhitespace(stripTimestamp(text)),
  );
}

function isSameMessageRepaint(pending: string, current: string): boolean {
  const prior = normalizeChatWhitespace(pending);
  const next = normalizeChatWhitespace(current);
  return prior === next || next.startsWith(prior);
}
