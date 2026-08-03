import * as a1lib from "alt1/base";
import type {
  CapturedChatBuffer,
  ChatFontSetting,
  ChatReaderState,
  LocalChatbox,
  PhysicalChatLine,
} from "./chatTypes";
import * as OCR from "alt1/ocr";
import { buildPrimaryOcrPalette } from "./primaryReaderConfig";
import {
  advanceTrackerContext,
  classifyTrackerRow,
  getTrackerTimestamp,
  isTrackerBoundaryLine,
} from "./trackerRelevance";
import type {
  TrackerContinuationContext,
  TrackerRowClassification,
} from "./trackerRelevance";

type ConfirmedGlyph = {
  character: string;
  x: number;
  color: OCR.ColortTriplet;
  info: OCR.ReadCharInfo;
  seedRead?: ReturnType<RowOcrPrimitives["readLine"]>;
};

export type RowOcrPrimitives = Pick<
  typeof OCR,
  "findChar" | "getChatColorMono" | "readChar" | "readLine"
>;

type CaptureChatPixels = (
  x: number,
  y: number,
  width: number,
  height: number,
) => ImageData;

type DecoderWorkObserver = {
  onLimitedRow?: (classification: TrackerRowClassification) => void;
  onDeepRow?: (classification: TrackerRowClassification) => void;
};

type DecodePhysicalRowOptions = {
  startWindowWidth?: number;
  maxFragments?: number;
  boundaryColorHints?: Map<string, OCR.ColortTriplet>;
};

type BoundaryMatch = {
  gap: number;
  glyph: ConfirmedGlyph;
};

type DecodedCapturedRow = PhysicalChatLine | null;

type CapturedRowGeometry = {
  buffer: CapturedChatBuffer;
  font: ChatFontSetting;
  startX: number;
  startWindowWidth: number;
  baselineY: number;
};

const MAX_RANKED_COLORS = 8;
const DEFAULT_MAX_FRAGMENTS = 32;
const MAX_CACHED_PHYSICAL_ROWS = 512;
const FINGERPRINT_COLOR_DISTANCE = 36;
const TRACKER_PREFIX_SCREEN_WIDTH = 320;
const TIMESTAMP_OPEN_COLORS: readonly OCR.ColortTriplet[] = [
  [255, 255, 255],
  [127, 169, 255],
];

type PhysicalTextQuality = {
  wordCharacters: number;
  punctuationOnlyRatio: number;
  score: number;
};

function scorePhysicalText(
  text: string,
  fragmentCount = 0,
): PhysicalTextQuality {
  const characters = Array.from(text);
  const printableCharacters = characters.filter(
    (character) => character >= " " && character !== "\x7f",
  ).length;
  const wordCharacters = (text.match(/[A-Za-z0-9]/g) ?? []).length;
  const whitespaceCharacters = (text.match(/\s/g) ?? []).length;
  const punctuationCharacters = Math.max(
    0,
    printableCharacters - wordCharacters - whitespaceCharacters,
  );
  const punctuationOnlyRatio =
    printableCharacters === 0 ? 1 : punctuationCharacters / printableCharacters;
  const validTimestamp = /^\[\d{2}:\d{2}:\d{2}\]/.test(text);
  const score =
    wordCharacters * 2 +
    printableCharacters * 0.25 +
    fragmentCount * 0.5 +
    (validTimestamp ? 20 : 0) -
    punctuationOnlyRatio * 15 -
    (wordCharacters < 3 ? 8 : 0);

  return { wordCharacters, punctuationOnlyRatio, score };
}

type RankedGlyphCandidate = BoundaryMatch & {
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
    character: info.chr,
    x: info.x,
    color,
    info,
    seedRead,
  };
}

function createRankedGlyphCandidate(
  glyph: ConfirmedGlyph,
  colorRank: number,
  gap = 0,
): RankedGlyphCandidate {
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

function readBoundaryCandidate(
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
): RankedGlyphCandidate | null {
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
  return createRankedGlyphCandidate(
    createConfirmedGlyph(found, color, seedRead),
    colorRank,
    gap,
  );
}

function isBetterTextCandidate(
  candidate: RankedGlyphCandidate,
  best: RankedGlyphCandidate | null,
  compareSizeScore = false,
): boolean {
  if (!best) return true;
  if (candidate.qualityScore !== best.qualityScore) {
    return candidate.qualityScore > best.qualityScore;
  }
  if (candidate.progress !== best.progress) {
    return candidate.progress > best.progress;
  }
  if (candidate.colorRank !== best.colorRank) {
    return candidate.colorRank < best.colorRank;
  }
  return (
    compareSizeScore &&
    candidate.glyph.info.sizescore < best.glyph.info.sizescore
  );
}

function isBetterPhysicalCandidate(
  candidate: RankedGlyphCandidate,
  best: RankedGlyphCandidate | null,
): boolean {
  if (!best) return true;
  if (candidate.colorRank !== best.colorRank) {
    return candidate.colorRank < best.colorRank;
  }
  if (candidate.glyph.info.sizescore !== best.glyph.info.sizescore) {
    return candidate.glyph.info.sizescore < best.glyph.info.sizescore;
  }
  return candidate.gap < best.gap;
}

export class CustomPhysicalRowDecoder {
  private lastReadBuffer: CapturedChatBuffer | null = null;
  private capturedReadCache: {
    key: string;
    pixels: Uint8ClampedArray;
    result: PhysicalChatLine[];
  } | null = null;
  private rowCacheContext = "";
  private foregroundClassifier: Uint8Array | null = null;
  private readonly boundaryColorHints = new Map<string, OCR.ColortTriplet>();
  private readonly decodedRowCache = new Map<string, DecodedCapturedRow>();

  constructor(
    private readonly ocr: RowOcrPrimitives = OCR,
    private readonly fontCandidates: readonly ChatFontSetting[] = [],
    private readonly workObserver: DecoderWorkObserver = {},
  ) {}

  resetCaptureState(): void {
    this.lastReadBuffer = null;
  }

  read(
    reader: ChatReaderState,
    capture: CaptureChatPixels = a1lib.capture,
  ): PhysicalChatLine[] {
    if (!reader.pos) return emptyRead();

    const box = reader.pos.mainbox;
    const leftMargin = box.leftfound ? 0 : 300;
    const rightPadding = Math.max(
      reader.font?.def.width ?? 0,
      ...this.fontCandidates.map((candidate) => candidate.def.width),
    );
    const imageX = box.rect.x - leftMargin;
    const imageY = box.rect.y;
    const image = capture(
      imageX,
      imageY,
      box.rect.width + leftMargin + rightPadding,
      box.rect.height,
    );
    this.lastReadBuffer = new a1lib.ImgRefData(image, imageX, imageY);

    if (!reader.font) {
      reader.font = this.selectFont(reader);
    }
    if (!reader.font) return emptyRead();

    const colors = buildPrimaryOcrPalette();
    const cacheKey = buildCapturedReadCacheKey(reader, image, colors);
    if (
      this.capturedReadCache &&
      this.capturedReadCache.key === cacheKey &&
      haveEqualPixels(this.capturedReadCache.pixels, image.data)
    ) {
      return this.capturedReadCache.result;
    }

    const result = this.decodeCapturedRows(reader, colors);
    this.capturedReadCache = {
      key: cacheKey,
      pixels: new Uint8ClampedArray(image.data),
      result,
    };
    return result;
  }

  decodeCapturedRows(
    reader: ChatReaderState,
    colors: OCR.ColortTriplet[] = buildPrimaryOcrPalette(),
  ): PhysicalChatLine[] {
    const buffer = this.lastReadBuffer;
    const box = reader.pos?.mainbox;
    const font = reader.font;
    if (!buffer || !box || !font) return emptyRead();

    const lines: PhysicalChatLine[] = [];
    const rowCacheContext = buildCapturedReadCacheKey(
      reader,
      buffer.buf,
      colors,
    );
    if (rowCacheContext !== this.rowCacheContext) {
      this.rowCacheContext = rowCacheContext;
      this.decodedRowCache.clear();
      this.foregroundClassifier = buildForegroundClassifier(colors);
    }
    const foregroundClassifier =
      this.foregroundClassifier ?? buildForegroundClassifier(colors);
    const rows: Array<{
      absoluteBaseline: number;
      rowSignature: string | null;
    }> = [];
    for (let rowIndex = 0; ; rowIndex++) {
      const lineY = box.line0y - rowIndex * font.lineheight + font.dy;
      if (lineY - font.lineheight < 0) break;

      const absoluteBaseline = box.rect.y + lineY;
      const rowSignature = buildPhysicalRowFingerprint(
        buffer.buf,
        font.def,
        colors,
        calculatePhysicalStartX(buffer.x, box),
        absoluteBaseline - buffer.y,
        foregroundClassifier,
        box.rect.x + box.rect.width - buffer.x,
      );
      rows.push({ absoluteBaseline, rowSignature });
    }

    let continuationContext: TrackerContinuationContext = null;
    for (const row of rows.reverse()) {
      const { absoluteBaseline, rowSignature } = row;
      const contextKey = buildContinuationContextKey(continuationContext);
      const cacheKey =
        rowSignature === null ? null : `${rowSignature}|${contextKey}`;
      const hasCachedRow =
        cacheKey !== null && this.decodedRowCache.has(cacheKey);
      const decoded = hasCachedRow
        ? rebaseCachedPhysicalRow(
            this.decodedRowCache.get(cacheKey!) ?? null,
            absoluteBaseline,
          )
        : this.decodeScreenedCapturedRow(
            reader,
            absoluteBaseline,
            colors,
            continuationContext,
          );
      if (cacheKey !== null) {
        this.rememberDecodedRow(cacheKey, decoded);
      }
      if (!decoded) continue;
      lines.push(decoded);
      if (isTrackerBoundaryLine(decoded.text)) {
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

  private decodeScreenedCapturedRow(
    reader: ChatReaderState,
    absoluteBaseline: number,
    colors: OCR.ColortTriplet[],
    context: TrackerContinuationContext,
  ): DecodedCapturedRow {
    const screen = this.decodeCapturedPrefix(reader, absoluteBaseline, colors);
    const classification = classifyTrackerRow(screen?.text ?? "", context);
    this.workObserver.onLimitedRow?.(classification);

    if (classification === "confidently-irrelevant") {
      const timestamp = getTrackerTimestamp(screen?.text ?? "");
      return timestamp
        ? {
            text: timestamp,
            fragments: [],
            basey: absoluteBaseline,
          }
        : null;
    }

    this.workObserver.onDeepRow?.(classification);
    return this.decodeCapturedRow(reader, absoluteBaseline, colors);
  }

  private decodeCapturedPrefix(
    reader: ChatReaderState,
    absoluteBaseline: number,
    colors: OCR.ColortTriplet[],
  ): DecodedCapturedRow {
    const geometry = getCapturedRowGeometry(
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
      buffer.buf.width > startX + TRACKER_PREFIX_SCREEN_WIDTH &&
      rowHeight > 0 &&
      typeof buffer.buf.clone === "function";
    const prefixBuffer = canCrop
      ? buffer.buf.clone({
          x: 0,
          y: rowTop,
          width: startX + TRACKER_PREFIX_SCREEN_WIDTH,
          height: rowHeight,
        })
      : buffer.buf;
    return this.decodeAndRebaseCapturedImage(
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
    colors: OCR.ColortTriplet[] = buildPrimaryOcrPalette(),
  ): DecodedCapturedRow {
    const geometry = getCapturedRowGeometry(
      reader,
      this.lastReadBuffer,
      absoluteBaseline,
    );
    if (!geometry) return null;
    const { buffer, font, startX, startWindowWidth, baselineY } = geometry;
    return this.decodeAndRebaseCapturedImage(
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

  private decodeAndRebaseCapturedImage(
    capturedImage: ImageData,
    font: OCR.FontDefinition,
    colors: OCR.ColortTriplet[],
    relativeStartX: number,
    relativeBaselineY: number,
    absoluteBaseline: number,
    fragmentXOffset: number,
    options: DecodePhysicalRowOptions,
  ): DecodedCapturedRow {
    const decoded = decodePhysicalRow(
      capturedImage,
      font,
      colors,
      relativeStartX,
      relativeBaselineY,
      this.ocr,
      options,
    );
    return toPhysicalChatLine(decoded, absoluteBaseline, fragmentXOffset);
  }

  private selectFont(reader: ChatReaderState): ChatFontSetting | null {
    const box = reader.pos?.mainbox;
    if (!box || !this.lastReadBuffer) return null;
    const colors = buildPrimaryOcrPalette();
    let best: {
      font: ChatFontSetting;
      score: number;
      wordCharacters: number;
    } | null = null;

    for (const candidate of this.fontCandidates) {
      reader.font = candidate;
      const sampleLines: PhysicalChatLine[] = [];
      for (let rowIndex = 0; rowIndex < 3; rowIndex++) {
        const lineY =
          box.line0y - rowIndex * candidate.lineheight + candidate.dy;
        if (lineY - candidate.lineheight < 0) break;
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
          total.wordCharacters += current.wordCharacters;
          return total;
        },
        { score: 0, wordCharacters: 0 },
      );
      if (!best || quality.score > best.score) {
        best = {
          font: candidate,
          score: quality.score,
          wordCharacters: quality.wordCharacters,
        };
      }
    }

    reader.font = null;
    return best && best.wordCharacters > 10 ? best.font : null;
  }

  private rememberDecodedRow(
    signature: string,
    decoded: DecodedCapturedRow,
  ): void {
    this.decodedRowCache.delete(signature);
    this.decodedRowCache.set(signature, decoded);

    while (this.decodedRowCache.size > MAX_CACHED_PHYSICAL_ROWS) {
      const oldest = this.decodedRowCache.keys().next().value;
      if (oldest === undefined) break;
      this.decodedRowCache.delete(oldest);
    }
  }
}

function toPhysicalChatLine(
  decoded: ReturnType<typeof decodePhysicalRow>,
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

function getCapturedRowGeometry(
  reader: ChatReaderState,
  buffer: CapturedChatBuffer | null,
  absoluteBaseline: number,
): CapturedRowGeometry | null {
  const box = reader.pos?.mainbox;
  const font = reader.font;
  if (!buffer || !box || !font) return null;

  const nominalStartX = box.rect.x + box.line0x - buffer.x;
  const startX = calculatePhysicalStartX(buffer.x, box);
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

function calculatePhysicalStartX(bufferX: number, box: LocalChatbox): number {
  const nominalStartX = box.rect.x + box.line0x - bufferX;
  return box.leftfound ? nominalStartX : Math.max(0, nominalStartX - 300);
}

function buildContinuationContextKey(
  context: TrackerContinuationContext,
): string {
  return context ? `${context.kind}:${context.timestamp ?? ""}` : "none";
}

export function buildPhysicalRowFingerprint(
  image: ImageData,
  font: OCR.FontDefinition,
  colors: readonly OCR.ColortTriplet[],
  startX: number,
  baselineY: number,
  classifier: Uint8Array = buildForegroundClassifier(colors),
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

function buildForegroundClassifier(
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
        let closestDistance = FINGERPRINT_COLOR_DISTANCE;
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

function rebaseCachedPhysicalRow(
  decoded: DecodedCapturedRow,
  absoluteBaseline: number,
): DecodedCapturedRow {
  if (!decoded) return null;

  return {
    ...decoded,
    basey: absoluteBaseline,
    fragments: decoded.fragments.map((fragment) => ({ ...fragment })),
  };
}

function buildCapturedReadCacheKey(
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

export function haveEqualPixels(
  previous: Uint8ClampedArray,
  current: Uint8ClampedArray,
): boolean {
  if (previous.length !== current.length) return false;

  for (let index = 0; index < previous.length; index++) {
    if (previous[index] !== current[index]) return false;
  }
  return true;
}

export function decodePhysicalRow(
  buffer: ImageData,
  font: OCR.FontDefinition,
  colors: OCR.ColortTriplet[],
  startX: number,
  baselineY: number,
  ocr: RowOcrPrimitives = OCR,
  options: DecodePhysicalRowOptions = {},
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
  const maxFragments = options.maxFragments ?? DEFAULT_MAX_FRAGMENTS;

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
        text: next.glyph.character,
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

export function confirmInitialGlyph(
  buffer: ImageData,
  font: OCR.FontDefinition,
  colors: OCR.ColortTriplet[],
  startX: number,
  baselineY: number,
  windowWidth: number,
  ocr: RowOcrPrimitives = OCR,
): ConfirmedGlyph | null {
  for (const color of TIMESTAMP_OPEN_COLORS) {
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
    let bestAtX: RankedGlyphCandidate | null = null;
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
      const candidate = createRankedGlyphCandidate(
        createConfirmedGlyph(found, color, seedRead),
        colorRank,
      );
      if (isBetterTextCandidate(candidate, bestAtX)) {
        bestAtX = candidate;
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
    let best: RankedGlyphCandidate | null = null;
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
      const candidate = createRankedGlyphCandidate(
        createConfirmedGlyph(found, color, seedRead),
        colorRank,
      );
      if (isBetterTextCandidate(candidate, best)) {
        best = candidate;
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
  for (const color of TIMESTAMP_OPEN_COLORS) {
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
  let best: RankedGlyphCandidate | null = null;

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
      const candidate = readBoundaryCandidate(
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
        !candidate?.glyph.seedRead ||
        !/^\s*[1-9][\d,]*\s+\S/.test(candidate.glyph.seedRead.text)
      ) {
        continue;
      }
      if (isBetterTextCandidate(candidate, best, true)) {
        best = candidate;
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
      MAX_RANKED_COLORS,
      /\]\s*$/.test(currentText) ||
        /Materials gained:\s*$/i.test(currentText) ||
        /\b(?:parts|components),\s*$/i.test(currentText),
      getBoundaryColorHintKey(currentText),
      boundaryColorHints,
    );
  const allowsSecondaryComma = !/[\]:]\s*$/.test(currentText);
  const secondaryCandidates: BoundaryMatch[] = [];
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
      secondaryCandidates.push({
        gap,
        glyph: best,
      });
    }
  }

  secondaryCandidates.sort(
    (left, right) =>
      left.glyph.info.sizescore - right.glyph.info.sizescore ||
      left.gap - right.gap,
  );
  for (const candidate of secondaryCandidates) {
    const nextCursor = candidate.glyph.x + candidate.glyph.info.basechar.width;
    const continuation = findPrimaryContinuation(
      buffer,
      font,
      colors,
      nextCursor,
      baselineY,
      ocr,
    );
    if (continuation) {
      if (currentText.endsWith(candidate.glyph.character)) {
        return candidate.glyph.character === ","
          ? {
              ...continuation,
              gap: Math.max(continuation.gap, font.spacewidth),
            }
          : continuation;
      }
      if (primary && primary.gap <= candidate.gap) {
        return primary;
      }
      return candidate;
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
      MAX_RANKED_COLORS,
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

function getBoundaryColorHintKey(currentText: string): string | null {
  if (/^\[[A-Za-z0-9: ]+\]\s*$/.test(currentText)) {
    return "post-timestamp";
  }
  if (
    /Materials gained:\s*$/i.test(currentText) ||
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
  maxRankedColors = MAX_RANKED_COLORS,
  arbitrateSeedRead = false,
  colorHintKey: string | null = null,
  colorHints: Map<string, OCR.ColortTriplet> | undefined = undefined,
): BoundaryMatch | null {
  if (arbitrateSeedRead && colorHintKey && colorHints?.has(colorHintKey)) {
    const hinted = readHintedBoundaryGlyph(
      buffer,
      font,
      colorHints.get(colorHintKey)!,
      cursor,
      baselineY,
      gaps,
      allowSecondary,
      ocr,
    );
    if (hinted) return hinted;
  }

  let best: RankedGlyphCandidate | null = null;
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
      maxRankedColors,
    );
    for (let colorRank = 0; colorRank < ranked.length; colorRank++) {
      const candidate = readBoundaryCandidate(
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
      if (!candidate) continue;
      const better = arbitrateSeedRead
        ? isBetterTextCandidate(candidate, best, true)
        : isBetterPhysicalCandidate(candidate, best);
      if (better) best = candidate;
    }
  }
  if (!best) return null;
  if (
    arbitrateSeedRead &&
    colorHintKey &&
    best.glyph.seedRead &&
    isStrongBoundarySeedRead(best.glyph.seedRead)
  ) {
    colorHints?.set(colorHintKey, best.glyph.color);
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
    const candidate = readBoundaryCandidate(
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
      candidate?.glyph.seedRead &&
      isStrongBoundarySeedRead(candidate.glyph.seedRead)
    ) {
      return candidate;
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
    quality.wordCharacters >= 12 &&
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
  limit = MAX_RANKED_COLORS,
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
  const segmented = trimReadAfterTimestampClose(line);
  if (segmented !== line) {
    return segmented;
  }
  const closeEnd = findPhysicalTimestampCloseEnd(
    buffer,
    font,
    startX,
    baselineY,
    ocr,
  );
  return trimReadAfterTimestampClose(line, closeEnd);
}

function findPhysicalTimestampCloseEnd(
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
    for (const color of TIMESTAMP_OPEN_COLORS) {
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

function trimReadAfterTimestampClose(
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

function emptyRead(): PhysicalChatLine[] {
  return [];
}
