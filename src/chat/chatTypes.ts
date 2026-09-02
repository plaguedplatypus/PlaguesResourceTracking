import type * as OCR from "alt1/ocr";

export type ChatboxType =
  | "main"
  | "cc"
  | "fc"
  | "gc"
  | "gcc"
  | "private"
  | "gimc"
  | "unknown";

export interface ChatRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LocalChatbox {
  rect: ChatRect;
  type: ChatboxType;
  leftfound: boolean;
  line0x: number;
  line0y: number;
}

export interface ChatboxPosition {
  mainbox: LocalChatbox;
  boxes: LocalChatbox[];
}

export interface ChatFontSetting {
  name: string;
  lineheight: number;
  badgey: number;
  dy: number;
  def: OCR.FontDefinition;
}

export interface CapturedChatBuffer {
  buf: ImageData;
  x: number;
  y: number;
}

export interface ChatReaderState {
  pos: ChatboxPosition | null;
  font: ChatFontSetting | null;
}

export interface PhysicalChatLine {
  text: string;
  fragments: OCR.TextFragment[];
  basey: number;
}

export type LogicalChatMessage = { text: string };
