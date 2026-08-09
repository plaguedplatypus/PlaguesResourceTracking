import * as a1lib from "alt1/base";
import type DialogReader from "alt1/dialog";
import { normalizeItemName } from "../tracking/SkillTracker";

declare function require(moduleName: "alt1/dialog"): {
	default: typeof DialogReader;
};

type DialogPosition = {
	x: number;
	y: number;
	width: number;
	height: number;
	legacy?: boolean;
};

interface ArtifactDialogReader {
	pos: DialogPosition | null;
	find(): unknown;
	checkDialog(image: unknown): boolean;
	read(image: unknown): { text: string[] | null } | null | false;
	readDialog(image: unknown, checked: boolean): string[] | null;
}

interface ArtifactCaptureResult {
	item: string;
	quantity: number;
	source: "archaeology";
	rawText: string;
}

interface ArtifactCaptureReader {
	poll(): ArtifactCaptureResult | null;
	reset(): void;
}

const damagedArtifactDialogRegex =
	/^You find\s*[:;]?\s+(.+?\(\s*damaged\s*\))[!.]?$/i;
const maxDialogReadFails = 3;

function createDefaultDialogReader(): ArtifactDialogReader {
	const Reader = require("alt1/dialog").default;
	return new Reader() as unknown as ArtifactDialogReader;
}

export function createArtifactCaptureReader(): ArtifactCaptureReader {
	const reader = createDefaultDialogReader();
	let currentDialogCounted = false;
	let dialogReadFailCount = 0;

	function readLocatedDialogTexts() {
		if (!reader.pos) return { visible: false, texts: [] as string[] };

		const originalPos = reader.pos;
		const capturePadding = 40;
		const captureX = Math.max(0, originalPos.x - capturePadding);
		const captureRight = Math.min(
			alt1.rsWidth,
			originalPos.x + originalPos.width + capturePadding
		);
		const image = a1lib.captureHold(
			captureX,
			originalPos.y,
			captureRight - captureX,
			originalPos.height
		);

		// A saved position can outlive the dialog. Do not run the permissive
		// offset OCR against ordinary game pixels or they can look like text and
		// keep the previous artifact marked as the still-open dialog.
		if (!reader.checkDialog(image)) {
			return { visible: false, texts: [] as string[] };
		}

		const dialog = reader.read(image);
		const texts: string[] = [];

		function addText(lines: string[] | null) {
			const text = (lines || []).join(" ").replace(/\s+/g, " ").trim();

			if (text && !texts.includes(text)) texts.push(text);
		}

		addText(dialog && dialog.text ? dialog.text : null);

		if (texts.some((text) => damagedArtifactDialogRegex.test(text))) {
			return { visible: true, texts };
		}

		// DialogReader's fixed line-start probes can mistake a horizontal glyph
		// stroke for "_", then skip past the real line. Small horizontal offsets
		// move those probes while OCRing the same dialog pixels.
		try {
			for (const offsetX of [0, -30, -20, 5, 10, 20, 30]) {
				const shiftedX = originalPos.x + offsetX;

				if (
					shiftedX < captureX ||
					shiftedX + originalPos.width > captureRight
				) continue;

				reader.pos = { ...originalPos, x: shiftedX };
				addText(reader.readDialog(image, true));

				if (texts.some((text) => damagedArtifactDialogRegex.test(text))) {
					break;
				}
			}
		} finally {
			reader.pos = originalPos;
		}

		return { visible: true, texts };
	}

	return {
		poll() {
			if (!window.alt1) return null;

			if (!reader.pos) {
				reader.find();

				if (!reader.pos) {
					currentDialogCounted = false;
					return null;
				}
			}

			const dialogResult = readLocatedDialogTexts();

			if (!dialogResult.visible) {
				dialogReadFailCount++;

				if (dialogReadFailCount >= maxDialogReadFails) {
					reader.pos = null;
					dialogReadFailCount = 0;
					currentDialogCounted = false;
				}

				return null;
			}

			dialogReadFailCount = 0;

			if (currentDialogCounted || dialogResult.texts.length === 0) {
				return null;
			}

			let rawText = "";
			let match: RegExpMatchArray | null = null;

			for (const text of dialogResult.texts) {
				const candidateMatch = text.match(damagedArtifactDialogRegex);

				if (candidateMatch) {
					rawText = text;
					match = candidateMatch;
					break;
				}
			}

			if (!match || !rawText) return null;

			const item = normalizeItemName(match[1]);
			if (!item) return null;

			currentDialogCounted = true;

			return {
				item,
				quantity: 1,
				source: "archaeology",
				rawText,
			};
		},

		reset() {
			reader.pos = null;
			currentDialogCounted = false;
			dialogReadFailCount = 0;
		},
	};
}
