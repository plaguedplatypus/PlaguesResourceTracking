import * as a1lib from "alt1/base";
import type DialogReader from "alt1/dialog";
import { normalizeTrackedItemName } from "../tracking/SkillTracker";

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

interface DialogApi {
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

const damagedArtifactRegex =
	/^You find\s*[:;]?\s+(.+?\(\s*damaged\s*\))[!.]?$/i;
const maxDialogReadFails = 3;

function createDialogReader(): DialogApi {
	const dialogReaderClass = require("alt1/dialog").default;
	return new dialogReaderClass() as unknown as DialogApi;
}

export function createArtifactReader(): ArtifactCaptureReader {
	const reader = createDialogReader();
	let dialogCounted = false;
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

		// Don't run permissive offset OCR on normal game pixels; they can look like text and leave the previous artefact open.
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

		if (texts.some((text) => damagedArtifactRegex.test(text))) {
			return { visible: true, texts };
		}
		// DialogReader's fixed line-start probes can mistake a
		// horizontal glyph stroke for "_", then skip past the real line.
		// Small horizontal offsets move those probes while OCRing the same dialog pixels.
		try {
			for (const offsetX of [0, -30, -20, 5, 10, 20, 30]) {
				const shiftedX = originalPos.x + offsetX;

				if (
					shiftedX < captureX ||
					shiftedX + originalPos.width > captureRight
				) continue;

				reader.pos = { ...originalPos, x: shiftedX };
				addText(reader.readDialog(image, true));

				if (texts.some((text) => damagedArtifactRegex.test(text))) {
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
					dialogCounted = false;
					return null;
				}
			}

			const dialogResult = readLocatedDialogTexts();

			if (!dialogResult.visible) {
				dialogReadFailCount++;

				if (dialogReadFailCount >= maxDialogReadFails) {
					reader.pos = null;
					dialogReadFailCount = 0;
					dialogCounted = false;
				}

				return null;
			}

			dialogReadFailCount = 0;

			if (dialogCounted || dialogResult.texts.length === 0) {
				return null;
			}

			let rawText = "";
			let match: RegExpMatchArray | null = null;

			for (const text of dialogResult.texts) {
				const artifactMatch = text.match(damagedArtifactRegex);

				if (artifactMatch) {
					rawText = text;
					match = artifactMatch;
					break;
				}
			}

			if (!match) return null;

			const item = normalizeTrackedItemName(match[1]);
			if (!item) return null;

			dialogCounted = true;

			return {
				item,
				quantity: 1,
				source: "archaeology",
				rawText,
			};
		},

		reset() {
			reader.pos = null;
			dialogCounted = false;
			dialogReadFailCount = 0;
		},
	};
}
