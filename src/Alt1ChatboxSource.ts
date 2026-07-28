import * as a1lib from "alt1/base";
import ChatboxReader from "alt1/chatbox";
import * as OCR from "alt1/ocr";
import { startsWithKnownInventionComponent } from "./invention";

export type ChatboxPosition = NonNullable<ChatboxReader["pos"]>;
export type VisualChatRow = { text: string };

type ReadContext = Parameters<
	ChatboxReader["forwardnudges"][number]["fn"]
>[0];

const materialRowRegex =
	/(?:materials gained:|\b(?:components?|parts?|junk)\b|\bcom\.|\bco\.{5}\s+\.{2}\s+-{2}\.)/i;
const componentScarEndRegex =
	/\b[A-Za-z]+(?:-\s*[A-Za-z]*)*-\s*$/;
const terminalJunkRegex = /\bjunk[.!]?\s*$/i;
const materialContinuationEndRegex =
	/(?:,\s*|\b(?:components?|parts?|com\.|com\.onents)[.!]?\s*|\bco\.{5}\s+\.{2}\s+-{2}\.\s*|\b\d+\s*(?:x|,)\s*)$/i;
const missingLeadingEComponentRegex =
	/^(?:nhancing|thereal|vasive|xplosive|cliptic)\s+(?:components?|com\.)(?:\W|$)/i;
const maxCustomNudgesPerRow = 8;

// Add newly observed Invention OCR substitutions here. These run while the
// physical chat rows are read, and again after wrapped rows are grouped.
const inventionOcrReplacements: Array<[RegExp, string]> = [
	[/\bTimewom\b/gi, "Timeworn"],
	[/\bDeflectlng\b/gi, "Deflecting"],
	[/\bPlaled\b/gi, "Plated"],
	[/\bProt[-\s]*ctiv[-\s]*(?=\W|$)/gi, "Protective"],
	[/\bH[-\s]*avy(?=\W|$)/gi, "Heavy"],
	[/\bH[-\s]*althy(?=\W|$)/gi, "Healthy"],
	[/\bD[-\s]*xtrous(?=\W|$)/gi, "Dextrous"],
	[
		/[;:|]\s*[.,-]\s*[.,-]\s*-{1,2}ctive\s+components\b/gi,
		"1 x Protective components",
	],
	[/\bco\.{5}\s+\.{2}\s+-{2}\./gi, "components,"],
	[/\bcom\.\s*on(?:e|[-\s])*nts\b/gi, "components"],
	[/\bcom\./gi, "components,"],
	[
		/\b(\d+)\s*,\s*(?=[A-Za-z][A-Za-z.'\-\s]*\b(?:components?|parts?)\b)/gi,
		"$1 x ",
	],
];

/**
 * Keeps the Alt1-specific chatbox location and OCR dependency out of the
 * logical message reader.
 */
export default class Alt1ChatboxSource {
	private readonly reader = new ChatboxReader();
	private findErrorReported = false;

	constructor() {
		this.reader.diffRead = true;
		this.reader.diffReadUseTimestamps = false;

		this.reader.readargs.colors.push(
			a1lib.mixColor(51, 197, 20),
			a1lib.mixColor(59, 181, 20),
			a1lib.mixColor(59, 181, 30),
			a1lib.mixColor(232, 47, 47),
			a1lib.mixColor(255, 64, 64),
			a1lib.mixColor(220, 32, 32),
			a1lib.mixColor(190, 15, 6),
			a1lib.mixColor(252, 140, 56),
			a1lib.mixColor(245, 135, 55),
			a1lib.mixColor(252, 174, 0),
			a1lib.mixColor(255, 160, 0),
			a1lib.mixColor(255, 144, 0),
			a1lib.mixColor(255, 128, 0),
			a1lib.mixColor(238, 116, 0),
			a1lib.mixColor(253, 127, 0),
			a1lib.mixColor(67, 188, 188),
			a1lib.mixColor(80, 205, 205),
			a1lib.mixColor(45, 170, 190),
			a1lib.mixColor(35, 145, 220),
			a1lib.mixColor(161, 53, 235),
			a1lib.mixColor(51, 101, 252)
		);

		addGenericOcrContinuationNudges(this.reader);
	}

	get pos(): ChatboxPosition | null {
		return this.reader.pos;
	}

	set pos(value: ChatboxPosition | null) {
		this.reader.pos = value;
	}

	get readargs(): { colors: number[] } {
		return this.reader.readargs;
	}

	find(): ChatboxPosition | null {
		if (typeof window === "undefined" || !window.alt1) {
			return null;
		}

		// Alt1 can inject its API after this bundle has evaluated. Refresh the
		// base wrapper's cached environment flag before it captures the client.
		a1lib.resetEnvironment();

		try {
			const position =
				this.reader.find() as ChatboxPosition | null;
			this.findErrorReported = false;
			return position;
		} catch (error) {
			if (!this.findErrorReported) {
				console.warn("Chatbox discovery failed", error);
				this.findErrorReported = true;
			}

			return null;
		}
	}

	read(): VisualChatRow[] {
		return (this.reader.read() ?? []).map((row) => ({
			...row,
			text: repairInventionOcrText(row.text),
		}));
	}
}

function addGenericOcrContinuationNudges(reader: ChatboxReader): void {
	const continuationNudgeAttempts = new WeakMap<ReadContext, number>();

	reader.forwardnudges.push({
		name: "missing-colored-component-row",
		match: /^$/,
		fn: (ctx) => {
			const scanEnd = Math.min(
				ctx.imgdata.width - 1,
				ctx.rightx + ctx.font.spacewidth * 6
			);
			const leadingQuantities = new Map<
				number,
				{
					text: string;
					xstart: number;
					xend: number;
				}
			>();
			const baselines = [
				ctx.baseliney,
				ctx.baseliney - 1,
				ctx.baseliney + 1,
			];

			for (let x = ctx.rightx; x <= scanEnd; x++) {
				for (const y of baselines) {
					for (const color of ctx.colors) {
						const first = OCR.readChar(
							ctx.imgdata,
							ctx.font,
							color,
							x,
							y,
							false,
							true
						);
						if (!first) continue;

						const data = OCR.readLine(
							ctx.imgdata,
							ctx.font,
							color,
							first.x,
							y,
							true,
							false
						);
						const candidateText =
							repairInventionOcrText(data.text)
								.replace(/\s+/g, " ")
								.trim();
						const restoredText =
							missingLeadingEComponentRegex.test(
								candidateText
							)
								? `E${candidateText}`
								: candidateText;
						const lastFragment =
							data.fragments[data.fragments.length - 1];

						if (
							lastFragment &&
							/^\d+\s*(?:x|,)\s*$/i.test(candidateText)
						) {
							leadingQuantities.set(y, {
								text: candidateText.replace(
									/^(\d+)\s*,\s*$/,
									"$1 x"
								),
								xstart: first.x,
								xend: lastFragment.xend,
							});
							continue;
						}

						if (
							!lastFragment ||
							!startsWithKnownInventionComponent(
								restoredText
							)
						) {
							continue;
						}

						const leadingQuantity =
							leadingQuantities.get(y);
						const hasLeadingQuantity =
							leadingQuantity !== undefined &&
							leadingQuantity.xend <= first.x;
						const recoveredText = hasLeadingQuantity
							? `${leadingQuantity.text} ${restoredText}`
							: restoredText;

						ctx.addfrag({
							color,
							index: -1,
							text: recoveredText,
							xstart: hasLeadingQuantity
								? leadingQuantity.xstart
								: ctx.rightx,
							xend: lastFragment.xend,
						});

						return true;
					}
				}
			}
		},
	});

	reader.forwardnudges.push({
		name: "mixed-color-continuation",
		match: /.+/,
		fn: (ctx) => {
			if (!needsMaterialContinuationNudge(ctx.text)) {
				return;
			}

			const attempt = claimNudgeAttempt(
				ctx,
				continuationNudgeAttempts
			);
			if (attempt === null) return;

			const scanEnd = Math.min(
				ctx.imgdata.width - 1,
				ctx.rightx + ctx.font.spacewidth * 8
			);
			const baselines = [
				ctx.baseliney,
				ctx.baseliney - 1,
				ctx.baseliney + 1,
			];

			for (let x = ctx.rightx; x <= scanEnd; x++) {
				for (const y of baselines) {
					for (const color of ctx.colors) {
						const first = OCR.readChar(
							ctx.imgdata,
							ctx.font,
							color,
							x,
							y,
							false,
							true
						);

						if (!first || !/^[A-Za-z0-9]$/.test(first.chr)) {
							continue;
						}

						const data = OCR.readLine(
							ctx.imgdata,
							ctx.font,
							color,
							first.x,
							y,
							true,
							false
						);
						const lastFragment =
							data.fragments[data.fragments.length - 1];
						const candidateText =
							repairContinuationOcrText(
								data.text,
								ctx.text
							);

						if (
							getContinuationRejectionReason(
								ctx.text,
								candidateText,
								lastFragment?.xend,
								ctx.rightx
							)
						) {
							continue;
						}

						const joinsBrokenComponentWord =
							/\bcom\.\s*$/i.test(ctx.text) &&
							/^onents\b/i.test(candidateText);

						if (
							!joinsBrokenComponentWord &&
							!/\s$/.test(ctx.text) &&
							first.x > ctx.rightx
						) {
							ctx.addfrag({
								color: [255, 255, 255],
								index: -1,
								text: " ",
								xstart: ctx.rightx,
								xend: first.x,
							});
						}

						if (candidateText === data.text) {
							data.fragments.forEach((fragment) =>
								ctx.addfrag(fragment)
							);
						} else {
							ctx.addfrag({
								color,
								index: -1,
								text: candidateText,
								xstart: first.x,
								xend: lastFragment.xend,
							});
						}

						return true;
					}
				}
			}
		},
	});
}

function needsMaterialContinuationNudge(text: string): boolean {
	const endsWithComponentScar = componentScarEndRegex.test(text);

	return (
		(materialRowRegex.test(text) || endsWithComponentScar) &&
		!terminalJunkRegex.test(text) &&
		(materialContinuationEndRegex.test(text) ||
			endsWithComponentScar)
	);
}

function repairContinuationOcrText(
	text: string,
	currentText: string
): string {
	const repaired = repairInventionOcrText(text)
		.replace(/^(\d+)\s*,\s*(?=[A-Za-z])/, "$1 x ")
		.replace(/\s+/g, " ")
		.trim();

	if (
		/\bcom\.\s*$/i.test(currentText) &&
		/^on(?:e|[-\s])*nts\b/i.test(repaired)
	) {
		return repaired.replace(/^on(?:e|[-\s])*nts\b/i, "onents");
	}

	return repaired;
}

function isCoherentMaterialContinuation(
	currentText: string,
	candidateText: string
): boolean {
	if (
		/\bcom\.\s*$/i.test(currentText) &&
		/^onents\b/i.test(candidateText)
	) {
		return true;
	}

	if (/\b\d+\s*,\s*$/.test(currentText)) {
		return (
			/^[A-Za-z][A-Za-z.'-]*(?:\s+(?:components?|parts?))?(?:\W|$)/i.test(
				candidateText
			)
		);
	}

	if (/,\s*$/.test(currentText)) {
		return (
			/^\d+\s*x\s*[A-Za-z]/i.test(candidateText) ||
			/^\d+\s*x\s*$/i.test(candidateText) ||
			/^\d+\s*,\s*$/.test(candidateText) ||
			/^[;:|]\s*[.,-]\s*[.,-]\s*-{1,2}ctive\s+components\b/i.test(
				candidateText
			)
		);
	}

	if (/\b\d+\s*x\s*$/i.test(currentText)) {
		return /^[A-Za-z]/.test(candidateText);
	}

	if (
		/\b\d+\s*x\s+[A-Za-z.\-\s]+$/i.test(currentText) &&
		/^(?:components?|parts?)(?:\W|$)/i.test(candidateText)
	) {
		return true;
	}

	return (
		/^\d+\s*x\s*[A-Za-z]/i.test(candidateText) ||
		/^\d+\s*x\s*$/i.test(candidateText) ||
		/^\d+\s*,?\s*$/.test(candidateText) ||
		/^(?:components?|parts?)(?:\W|$)/i.test(candidateText) ||
		/^com\.(?:\W|$)/i.test(candidateText) ||
		/^[;:|]\s*[.,-]\s*[.,-]\s*-{1,2}ctive\s+components\b/i.test(
			candidateText
		)
	);
}

function getContinuationRejectionReason(
	currentText: string,
	candidateText: string,
	candidateEndX: number | undefined,
	currentRightX: number
): string | null {
	if (!candidateText) return "empty candidate";
	if (candidateEndX === undefined) return "missing fragment";
	if (candidateEndX <= currentRightX) return "no forward progress";
	if (!isCoherentMaterialContinuation(currentText, candidateText)) {
		return "incoherent continuation";
	}

	return null;
}

export function repairInventionOcrText(text: string): string {
	if (
		!materialRowRegex.test(text) &&
		!componentScarEndRegex.test(text)
	) {
		return text;
	}

	return inventionOcrReplacements
		.reduce(
			(result, [pattern, replacement]) =>
				result.replace(pattern, replacement),
			text
		)
		.replace(
			/\b(parts?|components?)\s+(?=(?:\d+\s*)?x\b|\d+\s*$)/gi,
			"$1, "
		)
		.replace(/\bjunk\s+(?=\d+\s*x\s+)/gi, "junk, ")
		.replace(/\s+/g, " ")
		.trim();
}

function claimNudgeAttempt(
	ctx: ReadContext,
	attempts: WeakMap<ReadContext, number>
): number | null {
	const attemptCount = attempts.get(ctx) ?? 0;
	if (attemptCount >= maxCustomNudgesPerRow) return null;

	const nextAttempt = attemptCount + 1;
	attempts.set(ctx, nextAttempt);
	return nextAttempt;
}
