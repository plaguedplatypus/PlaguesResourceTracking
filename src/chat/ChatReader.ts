import * as a1lib from "alt1/base";
import type {
  ChatboxPosition,
  LogicalChatMessage,
  PhysicalChatSource,
} from "./chatTypes";
import { groupPhysicalLines } from "./grouping";
import CustomChatboxSource from "./CustomChatboxSource";

export { ChatboxPosition };
export {
  getLeadingTimestamp,
  groupPhysicalLines,
  hasTimestamp,
  joinContinuation,
  normalizeChatWhitespace,
  stripTimestamp,
} from "./grouping";

export default class ResourceChatReader {
  private readonly source: PhysicalChatSource;
  private pendingMessage: string | null = null;
  private pendingTimestamp: string | null = null;
  private findErrorReported = false;

  constructor(source?: PhysicalChatSource) {
    this.source = source ?? this.createCustomSource();
  }

  get pos(): ChatboxPosition | null {
    return this.source.pos;
  }

  set pos(value: ChatboxPosition | null) {
    this.source.pos = value;
  }

  get selectedFontName(): string | null {
    return this.source.selectedFontName ?? null;
  }

  find(): ChatboxPosition | null {
    if (typeof window === "undefined" || !window.alt1) {
      return null;
    }

    a1lib.resetEnvironment();

    try {
      const position = this.source.find();
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
    const physicalLines = this.source.read() ?? [];
    const result = groupPhysicalLines(
      physicalLines,
      {
        pendingMessage: this.pendingMessage,
        pendingTimestamp: this.pendingTimestamp,
      },
      physicalLines.length === 0,
    );

    this.pendingMessage = result.pendingMessage;
    this.pendingTimestamp = result.pendingTimestamp;

    return result.messages.map((text) => ({ text }));
  }

  private createCustomSource(): PhysicalChatSource {
    return new CustomChatboxSource();
  }
}
