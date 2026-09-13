import * as a1lib from "alt1/base";
import type { CapturedChatBuffer, ChatFontSetting, ChatReaderState, LocalChatbox, PhysicalChatLine, } from "./chatTypes";
import * as OCR from "alt1/ocr";
import { couldStartInventionMessage } from "../invention/InventionParser";
import { couldStartSkillMessage, isMaterialsGainedMessage, isSpiritRewardMessage, materialsPattern, } from "../tracking/trackerMessages";

type ConfirmedGlyph = {
  char: string;
  x: number;
  color: OCR.ColortTriplet;
  info: OCR.ReadCharInfo;
  seedRead?: ReturnType<RowOcrPrimitives["readLine"]>;
};

type RowOcrPrimitives = Pick<
  typeof OCR,
  "findChar" | "getChatColorMono" | "readChar" | "readLine"
>;

type DecodeOptions = {
  startWindowWidth?: number;
  maxFragments?: number;
  boundaryColorHints?: Map<string, OCR.ColortTriplet>;
};

type BoundaryMatch = {
  gap: number;
  glyph: ConfirmedGlyph;
};

type DecodedRow = PhysicalChatLine | null;

type RowClassification =
  | "relevant"
  | "contextual"
  | "uncertain"
  | "confidently-irrelevant";

type ContinuationContext = {
  kind: "material" | "spirit" | "tracked";
  timestamp: string | null;
} | null;

type RowGeometry = {
  buffer: CapturedChatBuffer;
  font: ChatFontSetting;
  startX: number;
  startWindowWidth: number;
  baselineY: number;
};

const maxRankedColors = 8;
const defaultMaxFragments = 32;
const maxCachedRows = 512;
const fingerprintColorDistance = 36;
const trackerPrefixScreenWidth = 320;
const timestampColors: readonly OCR.ColortTriplet[] = [
  [255, 255, 255],
  [127, 169, 255],
];

type TextQuality = {
  wordChars: number;
  punctuationOnlyRatio: number;
  score: number;
};

function scorePhysicalText(
  text: string,
  fragmentCount = 0,
): TextQuality {
  const chars = Array.from(text);
  const printableChars = chars.filter(
    (char) => char >= " " && char !== "\x7f",
  ).length;
  const wordChars = (text.match(/[A-Za-z0-9]/g) ?? []).length;
  const whitespaceChars = (text.match(/\s/g) ?? []).length;
  const punctuationChars = Math.max(
    0,
    printableChars - wordChars - whitespaceChars,
  );
  const punctuationOnlyRatio =
    printableChars === 0 ? 1 : punctuationChars / printableChars;
  const validTimestamp = /^\[\d{2}:\d{2}:\d{2}\]/.test(text);
  const score =
    wordChars * 2 +
    printableChars * 0.25 +
    fragmentCount * 0.5 +
    (validTimestamp ? 20 : 0) -
    punctuationOnlyRatio * 15 -
    (wordChars < 3 ? 8 : 0);

  return { wordChars, punctuationOnlyRatio, score };
}

type RankedGlyph = BoundaryMatch & {
  colorRank: number;
  qualityScore: number;
  progress: number;
};

function createConfirmedGlyph(
  info: OCR.ReadCharInfo,
  color: OCR.ColortTriplet,
  seedRead?: ReturnType<RowOcrPrimitives["readLine"]>,
): ConfirmedGlyph {
  return {
    char: info.chr,
    x: info.x,
    color,
    info,
    seedRead,
  };
}

function createRankedGlyph(
  glyph: ConfirmedGlyph,
  colorRank: number,
  gap = 0,
): RankedGlyph {
  const seedRead = glyph.seedRead;
  return {
    gap,
    glyph,
    colorRank,
    qualityScore: seedRead
      ? scorePhysicalText(seedRead.text, seedRead.fragments.length).score
      : 0,
    progress: seedRead
      ? seedRead.fragments.reduce(
          (maximum, fragment) => Math.max(maximum, fragment.xend),
          glyph.x,
        )
      : glyph.x + glyph.info.basechar.width,
  };
}

function readBoundaryGlyph(
  buffer: ImageData,
  font: OCR.FontDefinition,
  color: OCR.ColortTriplet,
  x: number,
  baselineY: number,
  gap: number,
  colorRank: number,
  allowSecondary: boolean,
  readSeed: boolean,
  ocr: RowOcrPrimitives,
): RankedGlyph | null {
  const found = ocr.readChar(
    buffer,
    font,
    color,
    x,
    baselineY,
    false,
    allowSecondary,
  );
  if (!found || (!allowSecondary && found.basechar.secondary)) {
    return null;
  }
  const seedRead = readSeed
    ? ocr.readLine(buffer, font, color, found.x, baselineY, true, false)
    : undefined;
  return createRankedGlyph(
    createConfirmedGlyph(found, color, seedRead),
    colorRank,
    gap,
  );
}

function isBetterTextGlyph(
  ranked: RankedGlyph,
  best: RankedGlyph | null,
  compareSizeScore = false,
): boolean {
  if (!best) return true;
  if (ranked.qualityScore !== best.qualityScore) {
    return ranked.qualityScore > best.qualityScore;
  }
  if (ranked.progress !== best.progress) {
    return ranked.progress > best.progress;
  }
  if (ranked.colorRank !== best.colorRank) {
    return ranked.colorRank < best.colorRank;
  }
  return (
    compareSizeScore &&
    ranked.glyph.info.sizescore < best.glyph.info.sizescore
  );
}

function isBetterPhysicalGlyph(
  ranked: RankedGlyph,
  best: RankedGlyph | null,
): boolean {
  if (!best) return true;
  if (ranked.colorRank !== best.colorRank) {
    return ranked.colorRank < best.colorRank;
  }
  if (ranked.glyph.info.sizescore !== best.glyph.info.sizescore) {
    return ranked.glyph.info.sizescore < best.glyph.info.sizescore;
  }
  return ranked.gap < best.gap;
}

export class CustomPhysicalRowDecoder {
  private readonly ocr: RowOcrPrimitives = OCR;
  private lastReadBuffer: CapturedChatBuffer | null = null;
  private capturedReadCache: {
    signature: string;
    pixels: Uint8ClampedArray;
    result: PhysicalChatLine[];
  } | null = null;
  private rowCacheContext = "";
  private foregroundClassifier: Uint8Array | null = null;
  private readonly boundaryColorHints = new Map<string, OCR.ColortTriplet>();
  private readonly decodedRowCache = new Map<string, DecodedRow>();

  constructor(
    private readonly fontOptions: readonly ChatFontSetting[] = [],
    private readonly ocrPalette: readonly OCR.ColortTriplet[] = [],
  ) {}

  resetCaptureState(): void {
    this.lastReadBuffer = null;
  }

  read(reader: ChatReaderState): PhysicalChatLine[] {
    if (!reader.pos) return [];

    const box = reader.pos.mainbox;
    const leftMargin = box.leftfound ? 0 : 300;
    const rightPadding = Math.max(
      reader.font?.def.width ?? 0,
      ...this.fontOptions.map((font) => font.def.width),
    );
    const imageX = box.rect.x - leftMargin;
    const imageY = box.rect.y;
    const image = a1lib.capture(
      imageX,
      imageY,
      box.rect.width + leftMargin + rightPadding,
      box.rect.height,
    );
    this.lastReadBuffer = new a1lib.ImgRefData(image, imageX, imageY);

    if (!reader.font) {
      reader.font = this.selectFont(reader);
    }
    if (!reader.font) return [];

    const colors = this.ocrPalette.slice();
    const signature = buildReadSignature(reader, image, colors);
    if (
      this.capturedReadCache &&
      this.capturedReadCache.signature === signature &&
      haveEqualPixels(this.capturedReadCache.pixels, image.data)
    ) {
      return this.capturedReadCache.result;
    }

    const result = this.decodeCapturedRows(reader, colors);
    this.capturedReadCache = {
      signature,
      pixels: new Uint8ClampedArray(image.data),
      result,
    };
    return result;
  }

  decodeCapturedRows(
    reader: ChatReaderState,
    colors: OCR.ColortTriplet[] = this.ocrPalette.slice(),
  ): PhysicalChatLine[] {
    const buffer = this.lastReadBuffer;
    const box = reader.pos?.mainbox;
    const font = reader.font;
    if (!buffer || !box || !font) return [];

    const lines: PhysicalChatLine[] = [];
    const rowCacheContext = buildReadSignature(
      reader,
      buffer.buf,
      colors,
    );
    if (rowCacheContext !== this.rowCacheContext) {
      this.rowCacheContext = rowCacheContext;
      this.decodedRowCache.clear();
      this.foregroundClassifier = buildClassifier(colors);
    }
    const foregroundClassifier =
      this.foregroundClassifier ?? buildClassifier(colors);
    const rows: Array<{
      absoluteBaseline: number;
      rowSignature: string | null;
    }> = [];
    for (let rowIndex = 0; ; rowIndex++) {
      const lineY = box.line0y - rowIndex * font.lineheight + font.dy;
      if (lineY - font.lineheight < 0) break;

      const absoluteBaseline = box.rect.y + lineY;
      const rowSignature = buildRowFingerprint(
        buffer.buf,
        font.def,
        colors,
        calculateStartX(buffer.x, box),
        absoluteBaseline - buffer.y,
        foregroundClassifier,
        box.rect.x + box.rect.width - buffer.x,
      );
      rows.push({ absoluteBaseline, rowSignature });
    }

    let continuationContext: ContinuationContext = null;
    for (const row of rows.reverse()) {
      const { absoluteBaseline, rowSignature } = row;
      const contextTag = buildContextTag(continuationContext);
      const signature =
        rowSignature === null ? null : `${rowSignature}|${contextTag}`;
      const hasCachedRow =
        signature !== null && this.decodedRowCache.has(signature);
      const decoded = hasCachedRow
        ? rebaseRow(
            this.decodedRowCache.get(signature!) ?? null,
            absoluteBaseline,
          )
        : this.decodeScreenedRow(
            reader,
            absoluteBaseline,
            colors,
            continuationContext,
          );
      if (signature !== null) {
        this.rememberDecodedRow(signature, decoded);
      }
      if (!decoded) continue;
      lines.push(decoded);
      if (isBoundaryLine(decoded.text)) {
        continuationContext = null;
        continue;
      }
      const classification = classifyTrackerRow(
        decoded.text,
        continuationContext,
      );
      continuationContext = advanceTrackerContext(
        continuationContext,
        decoded.text,
        classification,
      );
    }

    return lines;
  }

  private decodeScreenedRow(
    reader: ChatReaderState,
    absoluteBaseline: number,
    colors: OCR.ColortTriplet[],
    context: ContinuationContext,
  ): DecodedRow {
    const screen = this.decodeCapturedPrefix(reader, absoluteBaseline, colors);
    const classification = classifyTrackerRow(screen?.text ?? "", context);

    if (classification === "confidently-irrelevant") {
      const timestamp = getTimestamp(screen?.text ?? "");
      return timestamp
        ? {
            text: timestamp,
            fragments: [],
            basey: absoluteBaseline,
          }
        : null;
    }

    return this.decodeCapturedRow(reader, absoluteBaseline, colors);
  }

  private decodeCapturedPrefix(
    reader: ChatReaderState,
    absoluteBaseline: number,
    colors: OCR.ColortTriplet[],
  ): DecodedRow {
    const geometry = getRowGeometry(
      reader,
      this.lastReadBuffer,
      absoluteBaseline,
    );
    if (!geometry) return null;
    const { buffer, font, startX, startWindowWidth, baselineY } = geometry;
    const rowTop = Math.max(0, baselineY - font.def.basey);
    const rowHeight = Math.min(font.def.height, buffer.buf.height - rowTop);
    const canCrop =
      Number.isFinite(buffer.buf.width) &&
      Number.isFinite(buffer.buf.height) &&
      buffer.buf.width > startX + trackerPrefixScreenWidth &&
      rowHeight > 0 &&
      typeof buffer.buf.clone === "function";
    const prefixBuffer = canCrop
      ? buffer.buf.clone({
          x: 0,
          y: rowTop,
          width: startX + trackerPrefixScreenWidth,
          height: rowHeight,
        })
      : buffer.buf;
    return this.decodeAndRebase(
      prefixBuffer,
      font.def,
      colors,
      startX,
      canCrop ? baselineY - rowTop : baselineY,
      absoluteBaseline,
      buffer.x,
      {
        startWindowWidth,
        maxFragments: 8,
        boundaryColorHints: this.boundaryColorHints,
      },
    );
  }

  decodeCapturedRow(
    reader: ChatReaderState,
    absoluteBaseline: number,
    colors: OCR.ColortTriplet[] = this.ocrPalette.slice(),
  ): DecodedRow {
    const geometry = getRowGeometry(
      reader,
      this.lastReadBuffer,
      absoluteBaseline,
    );
    if (!geometry) return null;
    const { buffer, font, startX, startWindowWidth, baselineY } = geometry;
    return this.decodeAndRebase(
      buffer.buf,
      font.def,
      colors,
      startX,
      baselineY,
      absoluteBaseline,
      buffer.x,
      {
        startWindowWidth,
        boundaryColorHints: this.boundaryColorHints,
      },
    );
  }

  private decodeAndRebase(
    capturedImage: ImageData,
    font: OCR.FontDefinition,
    colors: OCR.ColortTriplet[],
    relativeStartX: number,
    relativeBaselineY: number,
    absoluteBaseline: number,
    fragmentXOffset: number,
    options: DecodeOptions,
  ): DecodedRow {
    const decoded = decodeRow(
      capturedImage,
      font,
      colors,
      relativeStartX,
      relativeBaselineY,
      this.ocr,
      options,
    );
    return toChatLine(decoded, absoluteBaseline, fragmentXOffset);
  }

  private selectFont(reader: ChatReaderState): ChatFontSetting | null {
    const box = reader.pos?.mainbox;
    if (!box || !this.lastReadBuffer) return null;
    const colors = this.ocrPalette.slice();
    let best: {
      font: ChatFontSetting;
      score: number;
      wordChars: number;
    } | null = null;

    for (const font of this.fontOptions) {
      reader.font = font;
      const sampleLines: PhysicalChatLine[] = [];
      for (let rowIndex = 0; rowIndex < 3; rowIndex++) {
        const lineY =
          box.line0y - rowIndex * font.lineheight + font.dy;
        if (lineY - font.lineheight < 0) break;
        const decoded = this.decodeCapturedRow(
          reader,
          box.rect.y + lineY,
          colors,
        );
        if (decoded) sampleLines.push(decoded);
      }
      const quality = sampleLines.reduce(
        (total, line) => {
          const current = scorePhysicalText(line.text, line.fragments.length);
          total.score += current.score;
          total.wordChars += current.wordChars;
          return total;
        },
        { score: 0, wordChars: 0 },
      );
      if (!best || quality.score > best.score) {
        best = {
          font,
          score: quality.score,
          wordChars: quality.wordChars,
        };
      }
    }

    reader.font = null;
    return best && best.wordChars > 10 ? best.font : null;
  }

  private rememberDecodedRow(
    signature: string,
    decoded: DecodedRow,
  ): void {
    this.decodedRowCache.delete(signature);
    this.decodedRowCache.set(signature, decoded);

    while (this.decodedRowCache.size > maxCachedRows) {
      const oldest = this.decodedRowCache.keys().next().value!;
      this.decodedRowCache.delete(oldest);
    }
  }
}

function toChatLine(
  decoded: ReturnType<typeof decodeRow>,
  absoluteBaseline: number,
  absoluteXOffset: number,
): PhysicalChatLine | null {
  if (!decoded.text) return null;
  return {
    text: decoded.text,
    fragments: decoded.fragments.map((fragment) => ({
      ...fragment,
      xstart: fragment.xstart + absoluteXOffset,
      xend: fragment.xend + absoluteXOffset,
    })),
    basey: absoluteBaseline,
  };
}

function getRowGeometry(
  reader: ChatReaderState,
  buffer: CapturedChatBuffer | null,
  absoluteBaseline: number,
): RowGeometry | null {
  const box = reader.pos?.mainbox;
  const font = reader.font;
  if (!buffer || !box || !font) return null;

  const nominalStartX = box.rect.x + box.line0x - buffer.x;
  const startX = calculateStartX(buffer.x, box);
  return {
    buffer,
    font,
    startX,
    startWindowWidth: box.leftfound
      ? font.def.width + font.def.spacewidth
      : nominalStartX - startX + font.def.width + font.def.spacewidth,
    baselineY: absoluteBaseline - buffer.y,
  };
}

function calculateStartX(bufferX: number, box: LocalChatbox): number {
  const nominalStartX = box.rect.x + box.line0x - bufferX;
  return box.leftfound ? nominalStartX : Math.max(0, nominalStartX - 300);
}

function buildContextTag(
  context: ContinuationContext,
): string {
  return context ? `${context.kind}:${context.timestamp ?? ""}` : "none";
}

function buildRowFingerprint(
  image: ImageData,
  font: OCR.FontDefinition,
  colors: readonly OCR.ColortTriplet[],
  startX: number,
  baselineY: number,
  classifier: Uint8Array = buildClassifier(colors),
  logicalRightX: number = image.width,
): string | null {
  if (
    !image.data ||
    image.width <= 0 ||
    image.height <= 0 ||
    colors.length === 0
  ) {
    return null;
  }

  const top = Math.max(0, baselineY - font.basey);
  const bottom = Math.min(image.height, top + font.height);
  const left = Math.max(0, startX);
  const right = Math.min(image.width, Math.max(left, logicalRightX));
  let primaryHash = 0x811c9dc5;
  let secondaryHash = 0x9e3779b9;
  let foregroundPixels = 0;

  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const offset = (y * image.width + x) * 4;
      const red = image.data[offset];
      const green = image.data[offset + 1];
      const blue = image.data[offset + 2];
      const colorGroup =
        classifier[(red >> 3) * 1024 + (green >> 3) * 32 + (blue >> 3)];
      if (colorGroup === 0) continue;
      foregroundPixels++;
      const token =
        ((x - left) & 0xffff) ^
        ((y - top) << 16) ^
        Math.imul(colorGroup, 0x45d9f3b);
      primaryHash = Math.imul(primaryHash ^ token, 0x01000193);
      secondaryHash = Math.imul(secondaryHash + token, 0x27d4eb2d);
    }
  }

  return [foregroundPixels, primaryHash >>> 0, secondaryHash >>> 0].join(":");
}

function buildClassifier(
  colors: readonly OCR.ColortTriplet[],
): Uint8Array {
  const classifier = new Uint8Array(32 * 32 * 32);
  const groups: number[] = [];
  for (let colorIndex = 0; colorIndex < colors.length; colorIndex++) {
    let group = 0;
    for (let earlier = 0; earlier < colorIndex; earlier++) {
      if (colorDistance(colors[colorIndex], colors[earlier]) < 50) {
        group = groups[earlier];
        break;
      }
    }
    if (group === 0) {
      group =
        groups.reduce((maximum, group) => Math.max(maximum, group), 0) + 1;
    }
    groups.push(group);
  }

  for (let red = 0; red < 32; red++) {
    for (let green = 0; green < 32; green++) {
      for (let blue = 0; blue < 32; blue++) {
        const sample: OCR.ColortTriplet = [
          red * 8 + 4,
          green * 8 + 4,
          blue * 8 + 4,
        ];
        let closestColor = -1;
        let closestDistance = fingerprintColorDistance;
        for (let colorIndex = 0; colorIndex < colors.length; colorIndex++) {
          const distance = colorDistance(sample, colors[colorIndex]);
          if (distance < closestDistance) {
            closestDistance = distance;
            closestColor = colorIndex;
          }
        }
        if (closestColor !== -1) {
          classifier[red * 1024 + green * 32 + blue] = groups[closestColor];
        }
      }
    }
  }

  return classifier;
}

function colorDistance(
  left: OCR.ColortTriplet,
  right: OCR.ColortTriplet,
): number {
  return (
    Math.abs(left[0] - right[0]) +
    Math.abs(left[1] - right[1]) +
    Math.abs(left[2] - right[2])
  );
}

function rebaseRow(
  decoded: DecodedRow,
  absoluteBaseline: number,
): DecodedRow {
  if (!decoded) return null;

  return {
    ...decoded,
    basey: absoluteBaseline,
    fragments: decoded.fragments.map((fragment) => ({ ...fragment })),
  };
}

function buildReadSignature(
  reader: ChatReaderState,
  image: ImageData,
  colors: readonly OCR.ColortTriplet[],
): string {
  const box = reader.pos!.mainbox;
  const font = reader.font!;
  return [
    image.width,
    image.height,
    box.rect.x,
    box.rect.y,
    box.rect.width,
    box.rect.height,
    box.line0x,
    box.line0y,
    box.leftfound ? 1 : 0,
    font.name,
    font.lineheight,
    font.dy,
    font.def.width,
    font.def.height,
    font.def.basey,
    colors.map((color) => color.join(",")).join(";"),
  ].join("|");
}

function haveEqualPixels(
  previous: Uint8ClampedArray,
  current: Uint8ClampedArray,
): boolean {
  if (previous.length !== current.length) return false;

  for (let index = 0; index < previous.length; index++) {
    if (previous[index] !== current[index]) return false;
  }
  return true;
}

function decodeRow(
  buffer: ImageData,
  font: OCR.FontDefinition,
  colors: OCR.ColortTriplet[],
  startX: number,
  baselineY: number,
  ocr: RowOcrPrimitives = OCR,
  options: DecodeOptions = {},
): {
  text: string;
  fragments: OCR.TextFragment[];
} {
  const startWindowWidth =
    options.startWindowWidth ?? font.width + font.spacewidth;
  const confirmed = confirmInitialGlyph(
    buffer,
    font,
    colors,
    startX,
    baselineY,
    startWindowWidth,
    ocr,
  );
  if (!confirmed) {
    return { text: "", fragments: [] };
  }

  const fragments: OCR.TextFragment[] = [];
  let cursor = confirmed.x;
  let next: BoundaryMatch | null = {
    gap: 0,
    glyph: confirmed,
  };
  const maxFragments = options.maxFragments ?? defaultMaxFragments;

  for (let attempt = 0; attempt < maxFragments && next; attempt++) {
    if (next.gap > 0) {
      appendGap(
        fragments,
        cursor,
        cursor + next.gap,
        next.glyph.color,
        font.spacewidth,
      );
      cursor += next.gap;
    }

    const line =
      next.glyph.seedRead ??
      ocr.readLine(
        buffer,
        font,
        next.glyph.color,
        next.glyph.x,
        baselineY,
        true,
        false,
      );
    const progressed = appendReadFragments(fragments, line.fragments, cursor);
    if (progressed > cursor) {
      cursor = progressed;
    } else if (next.glyph.info.basechar.secondary) {
      const end = next.glyph.x + next.glyph.info.basechar.width;
      appendFragment(fragments, {
        text: next.glyph.char,
        color: next.glyph.color,
        index: -1,
        xstart: next.glyph.x,
        xend: end,
      });
      cursor = end;
    } else {
      break;
    }

    const currentText = fragments.map(({ text }) => text).join("");
    next =
      confirmTimestampClose(
        buffer,
        font,
        cursor,
        baselineY,
        currentText,
        ocr,
      ) ??
      findBoundaryMatch(
        buffer,
        font,
        colors,
        cursor,
        baselineY,
        currentText,
        options.boundaryColorHints,
        ocr,
      );
  }

  fragments.forEach((fragment, index) => (fragment.index = index));
  return {
    text: fragments.map(({ text }) => text).join(""),
    fragments,
  };
}

function confirmInitialGlyph(
  buffer: ImageData,
  font: OCR.FontDefinition,
  colors: OCR.ColortTriplet[],
  startX: number,
  baselineY: number,
  windowWidth: number,
  ocr: RowOcrPrimitives = OCR,
): ConfirmedGlyph | null {
  for (const color of timestampColors) {
    const timestampOpen = ocr.readChar(
      buffer,
      font,
      color,
      startX,
      baselineY,
      false,
      true,
    );
    if (timestampOpen?.chr === "[") {
      const seedRead = ocr.readLine(
        buffer,
        font,
        color,
        timestampOpen.x,
        baselineY,
        true,
        false,
      );
      return createConfirmedGlyph(
        timestampOpen,
        color,
        trimInitialTimestampRead(
          buffer,
          font,
          timestampOpen.x,
          baselineY,
          ocr,
          seedRead,
        ),
      );
    }
  }

  const quantityStart = confirmQuantityStart(
    buffer,
    font,
    colors,
    startX,
    baselineY,
    windowWidth,
    ocr,
  );
  if (quantityStart) return quantityStart;

  const endX = startX + Math.max(1, windowWidth);
  for (let x = startX; x < endX; x++) {
    const ranked = rankColors(
      buffer,
      font,
      colors,
      x,
      baselineY,
      Math.max(1, font.width),
      ocr,
    );
    let bestAtX: RankedGlyph | null = null;
    for (let colorRank = 0; colorRank < ranked.length; colorRank++) {
      const color = ranked[colorRank];
      const found = ocr.findChar(buffer, font, color, x, baselineY, 1, 1);
      if (!found || found.x !== x || found.basechar.secondary) {
        continue;
      }
      const rawSeedRead = ocr.readLine(
        buffer,
        font,
        color,
        found.x,
        baselineY,
        true,
        false,
      );
      const seedRead = trimInitialTimestampRead(
        buffer,
        font,
        found.x,
        baselineY,
        ocr,
        rawSeedRead,
      );
      const rankedGlyph = createRankedGlyph(
        createConfirmedGlyph(found, color, seedRead),
        colorRank,
      );
      if (isBetterTextGlyph(rankedGlyph, bestAtX)) {
        bestAtX = rankedGlyph;
      }
    }
    if (bestAtX) return bestAtX.glyph;
  }
  return null;
}

function confirmQuantityStart(
  buffer: ImageData,
  font: OCR.FontDefinition,
  colors: OCR.ColortTriplet[],
  startX: number,
  baselineY: number,
  windowWidth: number,
  ocr: RowOcrPrimitives,
): ConfirmedGlyph | null {
  const probeStart = Math.max(0, startX - Math.max(1, font.spacewidth));
  const probeEnd = startX + Math.max(1, windowWidth);
  for (let x = probeStart; x < probeEnd; x++) {
    const ranked = rankColors(
      buffer,
      font,
      colors,
      x,
      baselineY,
      Math.max(1, font.width),
      ocr,
      colors.length,
    );
    let best: RankedGlyph | null = null;
    for (let colorRank = 0; colorRank < ranked.length; colorRank++) {
      const color = ranked[colorRank];
      const found = ocr.readChar(
        buffer,
        font,
        color,
        x,
        baselineY,
        false,
        false,
      );
      if (
        !found ||
        found.x !== x ||
        found.basechar.secondary ||
        !/^[1-9]$/.test(found.chr)
      ) {
        continue;
      }
      const seedRead = ocr.readLine(
        buffer,
        font,
        color,
        found.x,
        baselineY,
        true,
        false,
      );
      if (!/^[1-9]\d*\s+x\b/i.test(seedRead.text)) {
        continue;
      }
      const rankedGlyph = createRankedGlyph(
        createConfirmedGlyph(found, color, seedRead),
        colorRank,
      );
      if (isBetterTextGlyph(rankedGlyph, best)) {
        best = rankedGlyph;
      }
    }
    if (best) return best.glyph;
  }
  return null;
}

function confirmTimestampClose(
  buffer: ImageData,
  font: OCR.FontDefinition,
  cursor: number,
  baselineY: number,
  currentText: string,
  ocr: RowOcrPrimitives,
): BoundaryMatch | null {
  if (!/^\[[A-Za-z0-9: ]+$/.test(currentText)) {
    return null;
  }
  for (const color of timestampColors) {
    const found = ocr.readChar(
      buffer,
      font,
      color,
      cursor,
      baselineY,
      false,
      true,
    );
    if (found?.chr === "]") {
      return {
        gap: 0,
        glyph: createConfirmedGlyph(
          found,
          color,
          ocr.readLine(buffer, font, color, found.x, baselineY, true, false),
        ),
      };
    }
  }
  return null;
}

function findYouReceiveQuantityBoundary(
  buffer: ImageData,
  font: OCR.FontDefinition,
  colors: OCR.ColortTriplet[],
  cursor: number,
  baselineY: number,
  ocr: RowOcrPrimitives,
): BoundaryMatch | null {
  const maxGap = Math.max(font.width + font.spacewidth, font.spacewidth * 2);
  let best: RankedGlyph | null = null;

  for (let gap = 0; gap <= maxGap; gap++) {
    const x = cursor + gap;
    const ranked = rankColors(
      buffer,
      font,
      colors,
      x,
      baselineY,
      Math.max(font.width, 1),
      ocr,
      colors.length,
    );
    for (let colorRank = 0; colorRank < ranked.length; colorRank++) {
      const rankedGlyph = readBoundaryGlyph(
        buffer,
        font,
        ranked[colorRank],
        x,
        baselineY,
        gap,
        colorRank,
        false,
        true,
        ocr,
      );
      if (
        !rankedGlyph?.glyph.seedRead ||
        !/^\s*[1-9][\d,]*\s+\S/.test(rankedGlyph.glyph.seedRead.text)
      ) {
        continue;
      }
      if (isBetterTextGlyph(rankedGlyph, best, true)) {
        best = rankedGlyph;
      }
    }
  }

  return best ? { gap: best.gap, glyph: best.glyph } : null;
}

function findBoundaryMatch(
  buffer: ImageData,
  font: OCR.FontDefinition,
  colors: OCR.ColortTriplet[],
  cursor: number,
  baselineY: number,
  currentText: string,
  boundaryColorHints: Map<string, OCR.ColortTriplet> | undefined,
  ocr: RowOcrPrimitives,
): BoundaryMatch | null {
  const gaps = uniqueNumbers([0, font.spacewidth]);
  const receiveQuantityMatch = /\bYou receive\s*$/i.test(currentText)
    ? findYouReceiveQuantityBoundary(
        buffer,
        font,
        colors,
        cursor,
        baselineY,
        ocr,
      )
    : null;
  const receiveQuantity = receiveQuantityMatch
    ? {
        ...receiveQuantityMatch,
        gap: /\s$/.test(currentText) ? 0 : font.spacewidth,
      }
    : null;
  const primary =
    receiveQuantity ??
    findBestBoundaryGlyph(
      buffer,
      font,
      colors,
      cursor,
      baselineY,
      gaps,
      false,
      ocr,
      maxRankedColors,
      /\]\s*$/.test(currentText) ||
        materialsPattern.test(currentText) ||
        /\b(?:parts|components),\s*$/i.test(currentText),
      getBoundaryHintId(currentText),
      boundaryColorHints,
    );
  const allowsSecondaryComma = !/[\]:]\s*$/.test(currentText);
  const secondaryMatches: BoundaryMatch[] = [];
  for (const gap of allowsSecondaryComma ? gaps : []) {
    const x = cursor + gap;
    const ranked = rankColors(
      buffer,
      font,
      colors,
      x,
      baselineY,
      Math.max(font.width, 1),
      ocr,
      colors.length,
    );
    let best: ConfirmedGlyph | null = null;
    for (const color of ranked) {
      const found = ocr.readChar(
        buffer,
        font,
        color,
        x,
        baselineY,
        false,
        true,
      );
      if (
        found &&
        found.basechar.secondary &&
        found.chr === "," &&
        (!best || found.sizescore < best.info.sizescore)
      ) {
        best = createConfirmedGlyph(found, color);
      }
    }
    if (best) {
      secondaryMatches.push({
        gap,
        glyph: best,
      });
    }
  }

  secondaryMatches.sort(
    (left, right) =>
      left.glyph.info.sizescore - right.glyph.info.sizescore ||
      left.gap - right.gap,
  );
  for (const match of secondaryMatches) {
    const nextCursor = match.glyph.x + match.glyph.info.basechar.width;
    const continuation = findPrimaryContinuation(
      buffer,
      font,
      colors,
      nextCursor,
      baselineY,
      ocr,
    );
    if (continuation) {
      if (currentText.endsWith(match.glyph.char)) {
        return match.glyph.char === ","
          ? {
              ...continuation,
              gap: Math.max(continuation.gap, font.spacewidth),
            }
          : continuation;
      }
      if (primary && primary.gap <= match.gap) {
        return primary;
      }
      return match;
    }
  }

  if (!primary && /^\[[A-Za-z0-9: ]+\]\s*$/.test(currentText)) {
    const insetGaps = Array.from(
      {
        length:
          Math.max(font.width + font.spacewidth, font.spacewidth * 2) -
          font.spacewidth * 2 +
          1,
      },
      (_value, index) => font.spacewidth * 2 + index,
    );
    const insetQuantity = findBestBoundaryGlyph(
      buffer,
      font,
      colors,
      cursor,
      baselineY,
      insetGaps,
      false,
      ocr,
      maxRankedColors,
      true,
    );
    if (
      insetQuantity?.glyph.seedRead &&
      /^[1-9][\d,]*\s+x\b/i.test(insetQuantity.glyph.seedRead.text)
    ) {
      return {
        ...insetQuantity,
        gap: font.spacewidth * 2,
      };
    }
  }

  return primary;
}

function getBoundaryHintId(currentText: string): string | null {
  if (/^\[[A-Za-z0-9: ]+\]\s*$/.test(currentText)) {
    return "post-timestamp";
  }
  if (
    materialsPattern.test(currentText) ||
    /\b(?:parts|components),\s*$/i.test(currentText)
  ) {
    return "material-boundary";
  }
  return null;
}

function findBestBoundaryGlyph(
  buffer: ImageData,
  font: OCR.FontDefinition,
  colors: OCR.ColortTriplet[],
  cursor: number,
  baselineY: number,
  gaps: readonly number[],
  allowSecondary: boolean,
  ocr: RowOcrPrimitives,
  colorLimit = maxRankedColors,
  arbitrateSeedRead = false,
  hintId: string | null = null,
  colorHints: Map<string, OCR.ColortTriplet> | undefined = undefined,
): BoundaryMatch | null {
  if (arbitrateSeedRead && hintId && colorHints?.has(hintId)) {
    const hinted = readHintedBoundaryGlyph(
      buffer,
      font,
      colorHints.get(hintId)!,
      cursor,
      baselineY,
      gaps,
      allowSecondary,
      ocr,
    );
    if (hinted) return hinted;
  }

  let best: RankedGlyph | null = null;
  for (const gap of gaps) {
    const x = cursor + gap;
    const ranked = rankColors(
      buffer,
      font,
      colors,
      x,
      baselineY,
      Math.max(font.width, 1),
      ocr,
      colorLimit,
    );
    for (let colorRank = 0; colorRank < ranked.length; colorRank++) {
      const rankedGlyph = readBoundaryGlyph(
        buffer,
        font,
        ranked[colorRank],
        x,
        baselineY,
        gap,
        colorRank,
        allowSecondary,
        arbitrateSeedRead,
        ocr,
      );
      if (!rankedGlyph) continue;
      const better = arbitrateSeedRead
        ? isBetterTextGlyph(rankedGlyph, best, true)
        : isBetterPhysicalGlyph(rankedGlyph, best);
      if (better) best = rankedGlyph;
    }
  }
  if (!best) return null;
  if (
    arbitrateSeedRead &&
    hintId &&
    best.glyph.seedRead &&
    isStrongBoundarySeedRead(best.glyph.seedRead)
  ) {
    colorHints?.set(hintId, best.glyph.color);
  }
  return {
    gap: best.gap,
    glyph: best.glyph,
  };
}

function readHintedBoundaryGlyph(
  buffer: ImageData,
  font: OCR.FontDefinition,
  color: OCR.ColortTriplet,
  cursor: number,
  baselineY: number,
  gaps: readonly number[],
  allowSecondary: boolean,
  ocr: RowOcrPrimitives,
): BoundaryMatch | null {
  for (const gap of gaps) {
    const rankedGlyph = readBoundaryGlyph(
      buffer,
      font,
      color,
      cursor + gap,
      baselineY,
      gap,
      0,
      allowSecondary,
      true,
      ocr,
    );
    if (
      rankedGlyph?.glyph.seedRead &&
      isStrongBoundarySeedRead(rankedGlyph.glyph.seedRead)
    ) {
      return rankedGlyph;
    }
  }
  return null;
}

function isStrongBoundarySeedRead(
  seedRead: ReturnType<RowOcrPrimitives["readLine"]>,
): boolean {
  const quality = scorePhysicalText(seedRead.text, seedRead.fragments.length);
  return (
    seedRead.text.length >= 20 &&
    quality.wordChars >= 12 &&
    quality.punctuationOnlyRatio < 0.4
  );
}

function findPrimaryContinuation(
  buffer: ImageData,
  font: OCR.FontDefinition,
  colors: OCR.ColortTriplet[],
  cursor: number,
  baselineY: number,
  ocr: RowOcrPrimitives,
): BoundaryMatch | null {
  return findBestBoundaryGlyph(
    buffer,
    font,
    colors,
    cursor,
    baselineY,
    uniqueNumbers([0, font.spacewidth]),
    false,
    ocr,
    colors.length,
  );
}

function rankColors(
  buffer: ImageData,
  font: OCR.FontDefinition,
  colors: OCR.ColortTriplet[],
  x: number,
  baselineY: number,
  width: number,
  ocr: RowOcrPrimitives,
  limit = maxRankedColors,
): OCR.ColortTriplet[] {
  if (colors.length <= 1) return colors.slice();
  return ocr
    .getChatColorMono(
      buffer,
      {
        x,
        y: baselineY - font.basey,
        width,
        height: font.height,
      },
      colors,
    )
    .slice(0, limit)
    .map(({ col }) => col);
}

function appendReadFragments(
  target: OCR.TextFragment[],
  source: readonly OCR.TextFragment[],
  minimumX: number,
): number {
  let right = minimumX;
  for (const fragment of source) {
    if (
      !fragment.text ||
      fragment.xend <= fragment.xstart ||
      fragment.xend <= right
    ) {
      continue;
    }
    appendFragment(target, fragment);
    right = Math.max(right, fragment.xend);
  }
  return right;
}

function trimInitialTimestampRead(
  buffer: ImageData,
  font: OCR.FontDefinition,
  startX: number,
  baselineY: number,
  ocr: RowOcrPrimitives,
  line: ReturnType<RowOcrPrimitives["readLine"]>,
): ReturnType<RowOcrPrimitives["readLine"]> {
  const timestamp = line.text.match(/^\[[A-Za-z0-9: ]+\]/)?.[0];
  if (!timestamp || line.text.length <= timestamp.length) {
    return line;
  }
  const segmented = trimAfterTimestampClose(line);
  if (segmented !== line) {
    return segmented;
  }
  const closeEnd = findTimestampCloseEnd(
    buffer,
    font,
    startX,
    baselineY,
    ocr,
  );
  return trimAfterTimestampClose(line, closeEnd);
}

function findTimestampCloseEnd(
  buffer: ImageData,
  font: OCR.FontDefinition,
  startX: number,
  baselineY: number,
  ocr: RowOcrPrimitives,
): number | undefined {
  const requestedEnd = startX + Math.max(font.width * 12, 80);
  const bufferWidth =
    typeof buffer.width === "number" && buffer.width > 0
      ? buffer.width
      : requestedEnd;
  const endX = Math.min(requestedEnd, bufferWidth);
  for (let x = startX + 1; x < endX; x++) {
    for (const color of timestampColors) {
      const found = ocr.readChar(
        buffer,
        font,
        color,
        x,
        baselineY,
        false,
        true,
      );
      if (found?.chr === "]" && found.x === x) {
        return found.x + found.basechar.width;
      }
    }
  }
  return undefined;
}

function trimAfterTimestampClose(
  line: ReturnType<RowOcrPrimitives["readLine"]>,
  physicalCloseEnd?: number,
): ReturnType<RowOcrPrimitives["readLine"]> {
  const closeIndex = line.text.indexOf("]");
  if (
    closeIndex < 0 ||
    !(line.text.startsWith("]") || /^\[[A-Za-z0-9: ]+\]/.test(line.text))
  ) {
    return line;
  }

  let textEnd = 0;
  let closeFragmentIndex = -1;
  for (let index = 0; index < line.fragments.length; index++) {
    textEnd += line.fragments[index].text.length;
    if (textEnd > closeIndex) {
      closeFragmentIndex = index;
      break;
    }
  }
  if (
    closeFragmentIndex < 0 ||
    (closeFragmentIndex >= line.fragments.length - 1 &&
      physicalCloseEnd === undefined)
  ) {
    return line;
  }

  const fragments = line.fragments
    .slice(0, closeFragmentIndex + 1)
    .map((fragment) => ({ ...fragment }));
  const closeFragment = fragments[fragments.length - 1];
  const textBeforeCloseFragment =
    textEnd - line.fragments[closeFragmentIndex].text.length;
  const localCloseIndex = closeIndex - textBeforeCloseFragment;
  const trailingWhitespace =
    closeFragment.text.slice(localCloseIndex + 1).match(/^\s*/)?.[0] ?? "";
  closeFragment.text =
    closeFragment.text.slice(0, localCloseIndex + 1) + trailingWhitespace;
  if (physicalCloseEnd !== undefined) {
    closeFragment.text = closeFragment.text.trimEnd();
    closeFragment.xend = physicalCloseEnd;
  }

  return {
    ...line,
    text: fragments.map(({ text }) => text).join(""),
    fragments,
  };
}

function appendGap(
  fragments: OCR.TextFragment[],
  start: number,
  end: number,
  color: OCR.ColortTriplet,
  spaceWidth: number,
): void {
  if (end <= start) return;
  const count = Math.max(
    1,
    Math.round((end - start) / Math.max(1, spaceWidth)),
  );
  appendFragment(fragments, {
    text: " ".repeat(count),
    color,
    index: -1,
    xstart: start,
    xend: end,
  });
}

function appendFragment(
  fragments: OCR.TextFragment[],
  fragment: OCR.TextFragment,
): void {
  const previous = fragments[fragments.length - 1];
  if (
    previous &&
    sameColor(previous.color, fragment.color) &&
    previous.xend === fragment.xstart
  ) {
    previous.text += fragment.text;
    previous.xend = fragment.xend;
    return;
  }
  fragments.push({ ...fragment, index: fragments.length });
}

function sameColor(left: OCR.ColortTriplet, right: OCR.ColortTriplet): boolean {
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
}

function uniqueNumbers(values: readonly number[]): number[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

const timestampRegex = /^\[\s*(\d{2})\s*:\s*(\d{2})\s*:\s*(\d{2})\s*\]\s*/;

function classifyTrackerRow(
  screenText: string,
  context: ContinuationContext,
): RowClassification {
  const normalized = normalizeScreenText(screenText);
  if (!normalized) return "uncertain";

  const timestamp = getTimestamp(normalized);
  const body = stripTimestamp(normalized);
  if (!body) return "uncertain";

  if (
    context &&
    (!timestamp ||
      (timestamp === context.timestamp && isQuantity(body)))
  ) {
    return "contextual";
  }

  if (couldStartInventionMessage(body) || couldStartSkillMessage(body)) {
    return "relevant";
  }

  if (looksLikeDamagedPrefix(body)) return "uncertain";

  const wordChars = (body.match(/[A-Za-z0-9]/g) ?? []).length;
  if (body.length >= 12 && wordChars >= 8 && /^[A-Za-z❆⚯㊉]/.test(body)) {
    return "confidently-irrelevant";
  }

  return "uncertain";
}

function advanceTrackerContext(
  current: ContinuationContext,
  fullText: string,
  classification: RowClassification,
): ContinuationContext {
  const normalized = normalizeScreenText(fullText);
  const timestamp = getTimestamp(normalized);
  const body = stripTimestamp(normalized);

  if (!timestamp) return current;
  if (!body) return null;

  if (isMaterialsGainedMessage(body)) {
    return { kind: "material", timestamp };
  }
  if (isSpiritRewardMessage(body)) {
    return { kind: "spirit", timestamp };
  }
  if (
    couldStartInventionMessage(body) ||
    couldStartSkillMessage(body) ||
    (classification === "uncertain" && looksLikeDamagedPrefix(body))
  ) {
    return { kind: "tracked", timestamp };
  }

  return null;
}

function getTimestamp(text: string): string | null {
  const match = normalizeScreenText(text).match(timestampRegex);
  return match ? `[${match[1]}:${match[2]}:${match[3]}]` : null;
}

function isBoundaryLine(text: string): boolean {
  return (
    getTimestamp(text) !== null &&
    stripTimestamp(text).length === 0
  );
}

function stripTimestamp(text: string): string {
  return normalizeScreenText(text).replace(timestampRegex, "").trim();
}

function isQuantity(text: string): boolean {
  return /^[1-9][\d,]*\s+x(?:\s+\S|$)/i.test(text);
}

function looksLikeDamagedPrefix(text: string): boolean {
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
