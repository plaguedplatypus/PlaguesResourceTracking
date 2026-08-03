import * as a1lib from "alt1/base";
import * as OCR from "alt1/ocr";
import { trackerChatColors } from "./customColors";

export function buildPrimaryPackedColors(): number[] {
  return trackerChatColors.slice();
}

export function buildPrimaryOcrPalette(): OCR.ColortTriplet[] {
  return buildPrimaryPackedColors().map((color) => a1lib.unmixColor(color));
}

export function resetPrimaryReaderForFind(reader: {
  pos: unknown;
  font: unknown;
}): void {
  reader.pos = null;
  reader.font = null;
}
