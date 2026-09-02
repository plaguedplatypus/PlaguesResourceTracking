import type { PhysicalChatLine } from "../chat/chatTypes";
import type * as OCR from "alt1/ocr";
import {
	bareMaterialsGainedHeaderPattern,
	getMaterialsGainedPayload,
} from "../tracking/trackerMessages";
import {
	isKnownMaterial,
	MaterialSuffix,
} from "./components";
import { isExplicitMaterialEntry } from "./InventionParser";

type MaterialLineRereader = (
	line: PhysicalChatLine
) => PhysicalChatLine | null;

type MaterialSupplementResult = {
	line: PhysicalChatLine;
};

type MaterialRowRead = (
	absoluteBaseline: number,
	colors: readonly OCR.ColortTriplet[]
) => PhysicalChatLine | null;

const leadingTimestampRegex =
	/^\[\s*\d{2}\s*:\s*\d{2}\s*:\s*\d{2}\s*\]\s*/;

export function applyMaterialSupplement(
	primary: PhysicalChatLine,
	inMaterialContext: boolean,
	reread: MaterialLineRereader
): MaterialSupplementResult {
	const primaryCompleteEntries =
		countCompleteMaterialEntries(primary.text);
	if (
		!inMaterialContext ||
		!hasIncompleteMaterialEntry(primary.text)
	) {
		return {
			line: primary,
		};
	}

	const supplemental = reread(primary);
	if (!supplemental) {
		return {
			line: primary,
		};
	}

	const supplementalCompleteEntries =
		countCompleteMaterialEntries(supplemental.text);
	const useSupplemental =
		supplementalCompleteEntries > primaryCompleteEntries ||
		(supplementalCompleteEntries ===
			primaryCompleteEntries &&
			isKnownMaterialContinuation(supplemental.text) &&
			!isKnownMaterialContinuation(primary.text));
	return {
		line: useSupplemental ? supplemental : primary,
	};
}

function hasIncompleteMaterialEntry(text: string): boolean {
	const body = text.replace(leadingTimestampRegex, "").trim();
	if (bareMaterialsGainedHeaderPattern.test(body)) return true;

	const materialText = getMaterialText(text);
	if (materialText === null) return false;
	if (!materialText) return true;

	const segments = materialText
		.split(",")
		.map((segment) => segment.trim())
		.filter(Boolean);

	return (
		segments.length === 0 ||
		segments.some((segment) => !isExplicitMaterialEntry(segment))
	);
}

function countCompleteMaterialEntries(text: string): number {
	const materialText = getMaterialText(text);
	if (materialText === null) return 0;

	return materialText
		.split(",")
		.map((segment) => segment.trim())
		.filter(Boolean)
		.filter(isExplicitMaterialEntry).length;
}

function isKnownMaterialContinuation(text: string): boolean {
	const body = text.replace(leadingTimestampRegex, "").trim();
	if (/^Junk[,.]?\s*$/i.test(body)) return true;

	const match = body.match(
		/^([a-z]+(?:-[a-z]+)?)\s+(parts|components)[,.]?\s*$/i
	);
	return (
		match !== null &&
		isKnownMaterial(
			match[1],
			match[2].toLowerCase() as MaterialSuffix
		)
	);
}

export function rereadMaterialPhysicalLine(
	line: PhysicalChatLine,
	colors: readonly OCR.ColortTriplet[],
	readRow: MaterialRowRead
): PhysicalChatLine | null {
	return readRow(line.basey, colors);
}

function getMaterialText(text: string): string | null {
	const body = text.replace(leadingTimestampRegex, "").trim();
	const payload = getMaterialsGainedPayload(body);
	if (payload !== null) return payload;

	return body;
}
