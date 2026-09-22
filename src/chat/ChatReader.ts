import * as a1lib from "alt1/base";
import LocalChatBoxReader from "./LocalChatBoxReader";
import type { ChatPosition } from "./chatTypes";

export { ChatPosition };

export default class ChatReader {
  private readonly reader = new LocalChatBoxReader();
  private findErrorReported = false;

  get pos(): ChatPosition | null {
    return this.reader.pos as ChatPosition | null;
  }

  set pos(value: ChatPosition | null) {
    this.reader.pos = value as typeof this.reader.pos;
  }

  get selectedFontName(): string | null {
    return this.reader.font?.name ?? null;
  }

  find(): ChatPosition | null {
    if (typeof window === "undefined" || !window.alt1) return null;
    a1lib.resetEnvironment();
    this.resetForRefind();
    try {
      const position = this.reader.find() as ChatPosition | null;
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

  read() {
    return this.reader.readTracker();
  }

  private resetForRefind() {
    this.reader.pos = null;
    this.reader.font = null;
    this.reader.overlaplines = [];
    this.reader.lastTimestamp = -1;
    this.reader.lastTimestampUpdate = 0;
    this.reader.addedLastread = false;
    this.reader.lastReadBuffer = null;
    this.reader.resetTrackerState();
  }
}
