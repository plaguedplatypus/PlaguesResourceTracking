import ChatBoxReader from "alt1/chatbox";
import type { ChatboxPosition, PhysicalChatLine } from "./chatTypes";
import {
  applyMaterialSupplement,
  rereadMaterialPhysicalLine,
} from "../invention/InventionMaterialOcr";
import { CustomPhysicalRowDecoder } from "./customPhysicalRowDecoder";
import { trackerChatFontCandidates } from "./trackerChatFonts";
import { resetPrimaryReaderForFind } from "./primaryReaderConfig";
import { VisibleLineDiff } from "./visibleLineDiff";

const leadingTimestampRegex = /^\[\s*\d{2}\s*:\s*\d{2}\s*:\s*\d{2}\s*\]\s*/;

export default class CustomChatboxSource {
  private readonly reader = new ChatBoxReader();
  private readonly customDecoder = new CustomPhysicalRowDecoder(
    trackerChatFontCandidates,
  );
  private readonly lineDiff = new VisibleLineDiff();
  private materialContextActive = false;

  get pos(): ChatboxPosition | null {
    return this.reader.pos;
  }

  set pos(value: ChatboxPosition | null) {
    this.reader.pos = value as typeof this.reader.pos;
  }

  get selectedFontName(): string | null {
    return this.reader.font?.name ?? null;
  }

  find(): ChatboxPosition | null {
    this.resetForRefind();
    return this.reader.find() as ChatboxPosition | null;
  }

  read(): PhysicalChatLine[] {
    const visibleLines = this.customDecoder.read(this.reader);
    const newLines = this.lineDiff.next(visibleLines);

    if (visibleLines.length === 0) {
      this.materialContextActive = false;
      return [];
    }

    return newLines.map((line) => this.enhanceMaterialLine(line));
  }

  private enhanceMaterialLine(line: PhysicalChatLine): PhysicalChatLine {
    const hasTimestamp = leadingTimestampRegex.test(line.text);
    const body = line.text.replace(leadingTimestampRegex, "").trim();
    const startsMaterialMessage = /^Materials gained:/i.test(body);

    if (hasTimestamp) {
      this.materialContextActive = startsMaterialMessage;
    } else if (startsMaterialMessage) {
      this.materialContextActive = true;
    }

    const result = applyMaterialSupplement(
      line,
      startsMaterialMessage || (!hasTimestamp && this.materialContextActive),
      (physicalLine) =>
        rereadMaterialPhysicalLine(
          physicalLine,
          (absoluteBaseline, colors) =>
            this.customDecoder.decodeCapturedRow(
              this.reader,
              absoluteBaseline,
              colors.slice(),
            ) ?? null,
        ),
    );

    return result.line;
  }

  private resetForRefind(): void {
    this.customDecoder.resetCaptureState();
    resetPrimaryReaderForFind(this.reader);
    this.lineDiff.reset();
    this.materialContextActive = false;
  }
}
