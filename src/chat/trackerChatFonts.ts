import type * as OCR from "alt1/ocr";
import font10pt from "../../node_modules/alt1/src/fonts/chatbox/10pt.fontmeta.json";
import font12pt from "../../node_modules/alt1/src/fonts/chatbox/12pt.fontmeta.json";
import font14pt from "../../node_modules/alt1/src/fonts/chatbox/14pt.fontmeta.json";
import font16pt from "../../node_modules/alt1/src/fonts/chatbox/16pt.fontmeta.json";
import type { ChatFontSetting } from "./chatTypes";

export type TrackerChatFontCandidate = ChatFontSetting & {
  id: string;
  badgey: number;
};

// Resource Tracker intentionally supports only the compact RuneScape chat
// fonts that are actively tested. Alt1 keeps these definitions private, so
// the application loads the official metadata directly through its font loader.
export const trackerChatFontCandidates: readonly TrackerChatFontCandidate[] = [
  font("chatbox-10pt", "10pt", 14, -9, -2, asLoadedFont(font10pt)),
  font("chatbox-12pt", "12pt", 16, -9, -3, asLoadedFont(font12pt)),
  font("chatbox-14pt", "14pt", 18, -10, -3, asLoadedFont(font14pt)),
  font("chatbox-16pt", "16pt", 21, -10, -4, asLoadedFont(font16pt)),
];

function asLoadedFont(source: unknown): OCR.FontDefinition {
  // alt1/font-loader transforms the metadata JSON into a runtime FontDefinition.
  return source as OCR.FontDefinition;
}

function font(
  id: string,
  name: string,
  lineheight: number,
  badgey: number,
  dy: number,
  def: OCR.FontDefinition,
): TrackerChatFontCandidate {
  return { id, name, lineheight, badgey, dy, def };
}
