import * as a1lib from "alt1/base";
import * as OCR from "alt1/ocr";
import { webpackImages } from "alt1/base";
import chat12pt from "../chat/chat_12pt.json";

declare function require(moduleName: "./imgs/continue.data.png"): Promise<ImageData>;

const images = webpackImages({
	continue: require("./imgs/continue.data.png"),
});
const font: OCR.FontDefinition = chat12pt;
const dialogXFromContinue = 218;
const dialogYFromContinue = 120;
const dialogWidth = 520;
const dialogHeight = 142;

type Position = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export default class DialogReader {
	pos: Position | null = null;

	find() {
		if (!images.loaded) return null;

		const image = a1lib.captureHoldFullRs();
		const matches = image.findSubimage(images.continue);
		const match = matches[0];
		if (!match) return null;

		this.pos = {
			x: match.x - dialogXFromContinue,
			y: match.y - dialogYFromContinue,
			width: dialogWidth,
			height: dialogHeight,
		};
		return this.pos;
	}

	checkDialog(image: ReturnType<typeof a1lib.captureHold>) {
		if (!this.pos) return false;

		return image.findSubimage(
			images.continue,
			this.pos.x - image.x,
			this.pos.y - image.y,
			this.pos.width,
			this.pos.height,
		).length > 0;
	}

	read(image: ReturnType<typeof a1lib.captureHold>) {
		if (!this.pos || !this.checkDialog(image)) return null;

		const data = image.toData(
			this.pos.x,
			this.pos.y + 33,
			this.pos.width,
			80,
		);
		const lines: string[] = [];

		for (let y = 0; y < data.height; y++) {
			let hasText = false;

			for (let x = 200; x < 300; x++) {
				const index = x * 4 + y * 4 * data.width;
				if (data.data[index] + data.data[index + 1] + data.data[index + 2] < 50) {
					hasText = true;
					break;
				}
			}

			if (!hasText) continue;

			let best: ReturnType<typeof OCR.readLine> | null = null;
			let baseline = y;

			for (const x of [192, 246, 310]) {
				const char = OCR.findChar(data, font, [0, 0, 0], x, y + 5, 12, 3);
				if (!char) continue;

				const line = OCR.readLine(
					data,
					font,
					[0, 0, 0],
					char.x,
					char.y,
					true,
					true,
				);
				if (!best || line.text.length > best.text.length) {
					best = line;
					baseline = char.y;
				}
			}

			if (!best || best.text.length < 3) continue;

			lines.push(best.text);
			y = baseline + 5;
		}

		return lines;
	}
}
