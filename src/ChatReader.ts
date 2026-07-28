import Alt1ChatboxSource, {
	ChatboxPosition,
	repairInventionOcrText,
	VisualChatRow,
} from "./Alt1ChatboxSource";
import { startsWithKnownInventionComponent } from "./invention";

export { ChatboxPosition };

type GroupedRows = {
	messages: string[];
	lastTimestamp: string | null;
};

const timestampRegex =
	/\[\s*(\d{2})\s*:\s*(\d{2})\s*:\s*(\d{2})\s*\]/;
const leadingTimestampRegex =
	/^\[\s*\d{2}\s*:\s*\d{2}\s*:\s*\d{2}\s*\]\s*/;
const quantityContinuationRegex = /^\d+\s*x(?:\s+|$)/i;
const continuationWordRegex =
	/^(?:and|another|continuation|from|into|or|sent|to|with|yielding)\b/i;
const incompleteMessageRegex =
	/(?:[,;:]|\b\d+\s*x)\s*$/i;
const terminalPunctuationRegex = /[.!?)]\s*$/;

/**
 * Converts Alt1 visual rows into complete logical messages.
 *
 * Examples:
 * - Same timestamp:
 *   ["[17:16:04] Materials gained: 9 x Metallic parts,",
 *    "[17:16:04] 8 x Timeworn components"]
 * - Untimestamped wrapping:
 *   ["[12:00:00] Main message begins",
 *    "continuation line one", "continuation line two"]
 */
export function groupVisualRowsIntoMessages(rows: string[]): string[] {
	return groupRows(rows, null).messages;
}

export default class ResourceChatReader {
	private readonly source = new Alt1ChatboxSource();
	private lastTimestamp: string | null = null;

	get pos(): ChatboxPosition | null {
		return this.source.pos;
	}

	set pos(value: ChatboxPosition | null) {
		this.source.pos = value;
	}

	get readargs(): { colors: number[] } {
		return this.source.readargs;
	}

	find(): ChatboxPosition | null {
		return this.source.find();
	}

	read(): Array<{ text: string }> {
		const rows = this.readVisualRows().map((row) => row.text);
		const grouped = groupRows(rows, this.lastTimestamp);

		this.lastTimestamp = grouped.lastTimestamp;

		return grouped.messages.map((text) => ({ text }));
	}

	private readVisualRows(): VisualChatRow[] {
		return this.source.read();
	}
}

function groupRows(
	rows: string[],
	previousTimestamp: string | null
): GroupedRows {
	const messages: string[] = [];
	let currentMessage = "";
	let currentTimestamp: string | null = null;
	let lastTimestamp = previousTimestamp;

	const flushCurrent = () => {
		if (!currentMessage) return;

		messages.push(repairInventionOcrText(currentMessage));
		currentMessage = "";
		currentTimestamp = null;
	};

	for (const rawRow of rows) {
		const row = normalizeChatWhitespace(rawRow);
		if (!row) continue;

		const timestamp = getTimestamp(row);
		const body = stripTimestamp(row);

		if (timestamp) {
			lastTimestamp = timestamp;

			if (
				currentMessage &&
				currentTimestamp === timestamp &&
				looksLikeContinuation(body, currentMessage, true)
			) {
				currentMessage = joinContinuation(currentMessage, body);
				continue;
			}

			flushCurrent();
			currentMessage = `${timestamp} ${body}`.trim();
			currentTimestamp = timestamp;
			continue;
		}

		if (
			currentMessage &&
			looksLikeContinuation(body, currentMessage, false)
		) {
			currentMessage = joinContinuation(currentMessage, body);
			continue;
		}

		flushCurrent();
		currentMessage = lastTimestamp
			? `${lastTimestamp} ${body}`.trim()
			: body;
		currentTimestamp = lastTimestamp;
	}

	flushCurrent();

	return { messages, lastTimestamp };
}

export function hasTimestamp(text: string): boolean {
	return timestampRegex.test(text);
}

export function getTimestamp(text: string): string | null {
	const match = text.match(timestampRegex);
	if (!match) return null;

	return `[${match[1]}:${match[2]}:${match[3]}]`;
}

export function stripTimestamp(text: string): string {
	return text.replace(leadingTimestampRegex, "").trim();
}

export function normalizeChatWhitespace(text: string): string {
	return text
		.replace(timestampRegex, (_match, hour, minute, second) =>
			`[${hour}:${minute}:${second}]`
		)
		.replace(/\s+/g, " ")
		.trim();
}

export function looksLikeContinuation(
	rowText: string,
	currentMessage: string,
	rowHasTimestamp = false
): boolean {
	const row = stripTimestamp(rowText);
	const currentBody = stripTimestamp(currentMessage);

	if (!row) return false;

	if (
		quantityContinuationRegex.test(row) ||
		continuationWordRegex.test(row) ||
		incompleteMessageRegex.test(currentBody)
	) {
		return true;
	}

	if (/^[a-z]/.test(row) && !terminalPunctuationRegex.test(currentBody)) {
		return true;
	}

	return !rowHasTimestamp && !terminalPunctuationRegex.test(currentBody);
}

export function joinContinuation(
	currentMessage: string,
	continuationText: string
): string {
	const continuation = stripTimestamp(continuationText);
	if (!continuation) return normalizeChatWhitespace(currentMessage);

	const base = currentMessage.trimEnd();
	const startsKnownComponent =
		/\bMaterials gained:/i.test(base) &&
		/\b(?:parts?|components?)\s*$/i.test(base) &&
		startsWithKnownInventionComponent(continuation);
	const separator =
		(quantityContinuationRegex.test(continuation) ||
			startsKnownComponent) &&
		!/,\s*$/.test(base)
			? ", "
			: " ";

	return normalizeChatWhitespace(`${base}${separator}${continuation}`);
}
