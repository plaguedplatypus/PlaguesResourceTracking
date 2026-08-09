import type { PhysicalChatLine } from "./chatTypes";

export class VisibleLineDiff {
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
      const watermarkIndex = findLastTimestampIndex(
        current,
        this.lastTimestamp,
      );
      if (watermarkIndex !== -1) {
        const resumeIndex = findNextTimestampIndex(
          current,
          watermarkIndex + 1,
          this.lastTimestamp,
        );
        this.previous = current;
        this.captureInterrupted = false;
        this.updateLastTimestamp(current);
        return resumeIndex === -1 ? [] : current.slice(resumeIndex);
      }

      const newestTimestamp = getLastTimestamp(current);
      if (
        !newestTimestamp ||
        !isTimestampAfter(newestTimestamp, this.lastTimestamp)
      ) {
        return [];
      }
    }

    this.captureInterrupted = false;
    const overlap = findSequenceOverlap(this.previous, current);
    const newLines = current.slice(overlap);
    this.previous = current;
    this.updateLastTimestamp(current);
    return newLines;
  }

  private updateLastTimestamp(
    lines: readonly Pick<PhysicalChatLine, "text">[],
  ): void {
    const timestamp = getLastTimestamp(lines);
    if (timestamp) this.lastTimestamp = timestamp;
  }
}

function findSequenceOverlap(
  previous: readonly Pick<PhysicalChatLine, "text">[],
  current: readonly Pick<PhysicalChatLine, "text">[],
): number {
  const maximum = Math.min(previous.length, current.length);

  for (let size = maximum; size > 0; size--) {
    const previousStart = previous.length - size;
    let matches = true;

    for (let index = 0; index < size; index++) {
      if (previous[previousStart + index].text !== current[index].text) {
        matches = false;
        break;
      }
    }

    if (matches) return size;
  }

  return 0;
}

function copyLine(line: PhysicalChatLine): PhysicalChatLine {
  return {
    text: line.text,
    basey: line.basey,
    fragments: line.fragments.map((fragment) => ({ ...fragment })),
  };
}

const leadingTimestampRegex = /^\[\s*(\d{2})\s*:\s*(\d{2})\s*:\s*(\d{2})\s*\]/;

function getTimestamp(text: string): string | null {
  const match = text.match(leadingTimestampRegex);
  return match ? `${match[1]}:${match[2]}:${match[3]}` : null;
}

function getLastTimestamp(
  lines: readonly Pick<PhysicalChatLine, "text">[],
): string | null {
  for (let index = lines.length - 1; index >= 0; index--) {
    const timestamp = getTimestamp(lines[index].text);
    if (timestamp) return timestamp;
  }
  return null;
}

function findLastTimestampIndex(
  lines: readonly Pick<PhysicalChatLine, "text">[],
  timestamp: string,
): number {
  for (let index = lines.length - 1; index >= 0; index--) {
    if (getTimestamp(lines[index].text) === timestamp) {
      return index;
    }
  }
  return -1;
}

function findNextTimestampIndex(
  lines: readonly Pick<PhysicalChatLine, "text">[],
  startIndex: number,
  previousTimestamp: string,
): number {
  for (let index = startIndex; index < lines.length; index++) {
    const timestamp = getTimestamp(lines[index].text);
    if (timestamp && timestamp !== previousTimestamp) {
      return index;
    }
  }
  return -1;
}

function isTimestampAfter(candidate: string, previous: string): boolean {
  const candidateSeconds = timestampToSeconds(candidate);
  const previousSeconds = timestampToSeconds(previous);
  const forward =
    (candidateSeconds - previousSeconds + 24 * 60 * 60) % (24 * 60 * 60);
  return forward > 0 && forward <= 12 * 60 * 60;
}

function timestampToSeconds(timestamp: string): number {
  const [hour, minute, second] = timestamp.split(":").map(Number);
  return hour * 60 * 60 + minute * 60 + second;
}
