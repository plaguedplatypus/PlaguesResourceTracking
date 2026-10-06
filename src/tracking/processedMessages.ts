const recentMessageLimit = 100;
const recentMessages: string[] = [];
const seenMessages = new Set<string>();
const leadingTimestampRegex =
  /^\[\s*(\d{2})\s*:\s*(\d{2})\s*:\s*(\d{2})\s*\]/;

export function hasSeenMessage(chatLine: string): boolean {
  const message = chatLine.trim();
  if (seenMessages.has(message)) return true;

  const timestamp = getLeadingTimestamp(message);
  if (!timestamp) return false;

  return recentMessages.some((processed) =>
    processed.length > message.length &&
    getLeadingTimestamp(processed) === timestamp &&
    processed.startsWith(message)
  );
}

export function markSeenMessage(chatLine: string): void {
  const message = chatLine.trim();
  if (!message || seenMessages.has(message)) return;

  recentMessages.push(message);
  seenMessages.add(message);
  if (recentMessages.length > recentMessageLimit) {
    const oldMessage = recentMessages.shift()!;
    seenMessages.delete(oldMessage);
  }
}

function getLeadingTimestamp(chatLine: string): string | null {
  const match = chatLine.match(leadingTimestampRegex);
  return match ? `${match[1]}:${match[2]}:${match[3]}` : null;
}
