import * as a1lib from "alt1/base";
import { normalizeTrackedItemName } from "../tracking/SkillTracker";
import DialogReader from "./DialogReader";

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
const maxReadFails = 3;
const readOffsets = [0, -30, -20, 5, 10, 20, 30];

export function createArtifactReader(): ArtifactCaptureReader {
	const reader = new DialogReader();
	let counted = false;
	let readFails = 0;

	return {
		poll() {
			if (!window.alt1) return null;

			if (!reader.pos && !reader.find()) {
				counted = false;
				return null;
			}

			const pos = reader.pos!;
			const image = a1lib.captureHold(pos.x, pos.y, pos.width, pos.height);
			const lines = reader.read(image);

			if (!lines) {
				readFails++;
				if (readFails >= maxReadFails) {
					reader.pos = null;
					readFails = 0;
					counted = false;
				}
				return null;
			}

			readFails = 0;
			if (counted) return null;

			let rawText = "";
			let match: RegExpMatchArray | null = null;
			// A fixed OCR probe can land on a glyph stroke and skip the dialog line.
			for (const offset of readOffsets) {
				const text = (offset === 0 ? lines : reader.read(image, offset) ?? [])
					.join(" ").replace(/\s+/g, " ").trim();
				match = text.match(damagedArtifactRegex);
				if (match) {
					rawText = text;
					break;
				}
			}
			if (!match) return null;

			const item = normalizeTrackedItemName(match[1]);
			if (!item) return null;

			counted = true;
			return { item, quantity: 1, source: "archaeology", rawText };
		},

		reset() {
			reader.pos = null;
			counted = false;
			readFails = 0;
		},
	};
}
