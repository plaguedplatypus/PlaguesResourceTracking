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

export interface ChatPosition {
  mainbox: LocalChatbox;
  boxes: LocalChatbox[];
}
