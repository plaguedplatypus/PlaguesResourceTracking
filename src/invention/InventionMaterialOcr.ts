import type { PhysicalChatLine } from "../chat/chatTypes";
import {
	bareMaterialsGainedHeaderPattern,
	getMaterialsGainedPayload,
} from "../tracking/trackerMessages";
import {
	isKnownMaterial,
	MaterialSuffix,
} from "./components";
import { isExplicitMaterialEntry } from "./InventionParser";

type LineRereader = (
	line: PhysicalChatLine
) => PhysicalChatLine | null;

const leadingTimestampRegex =
	/^\[\s*\d{2}\s*:\s*\d{2}\s*:\s*\d{2}\s*\]\s*/;

export function applyMaterialSupplement(
	primary: PhysicalChatLine,
	inMaterialContext: boolean,
	reread: LineRereader
): PhysicalChatLine {
	const primaryCompleteEntries =
		countCompleteMaterialEntries(primary.text);
	if (
		!inMaterialContext ||
		!hasIncompleteMaterialEntry(primary.text)
	) {
		return primary;
	}

	const supplemental = reread(primary);
	if (!supplemental) {
		return primary;
	}

	const supplementalCompleteEntries =
		countCompleteMaterialEntries(supplemental.text);
	const useSupplemental =
		supplementalCompleteEntries > primaryCompleteEntries ||
		(supplementalCompleteEntries ===
			primaryCompleteEntries &&
			isKnownMaterialContinuation(supplemental.text) &&
			!isKnownMaterialContinuation(primary.text));
	return useSupplemental ? supplemental : primary;
}

function hasIncompleteMaterialEntry(text: string): boolean {
	const body = text.replace(leadingTimestampRegex, "").trim();
	if (bareMaterialsGainedHeaderPattern.test(body)) return true;

	const materialText = getText(text);
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
	const materialText = getText(text);

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

function getText(text: string): string {
	const body = text.replace(leadingTimestampRegex, "").trim();
	const payload = getMaterialsGainedPayload(body);
	if (payload !== null) return payload;

	return body;
}
