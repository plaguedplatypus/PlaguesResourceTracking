import * as a1lib from "alt1/base";
import ChatboxReader from "alt1/chatbox";
import { setupInventionNudges } from "./invention";

export type ResourceChatReader = ChatboxReader;
export type ChatboxPosition = NonNullable<ChatboxReader["pos"]>;

const leadingTimestampRegex = /^\[\d{2}:\d{2}:\d{2}\]\s*/;
const timestampValueRegex = /^\[(\d{2}:\d{2}:\d{2})\]\s*/;
const materialLineRegex = /\bMaterials gained:/i;
const materialContinuationRegex =
	/^\d+\s*x\s+.+\b(?:components?|parts?)\b[,.! ]*$/i;
const materialTailRegex =
	/^(?:(?:[a-z][a-z' -]*\s+)?(?:components?|parts?))[,.! ]*$/i;
const continuationStartRegex =
	/^(?:and|to|sent|yielding|granting|giving|with)\b/i;
const unfinishedLineRegex =
	/(?:[,;:]|\b(?:following items?|following item|receive|received|adds?|contains?|including|yielding|granting|gives you|sent it to your bank)\s*:?\s*|\b\d+\s*x\s*)$/i;
const recentMaterialContextMs = 10000;

let recentMaterialContext: { timestamp: string; updatedAt: number } | null = null;

export function createResourceChatReader(): ResourceChatReader {
	recentMaterialContext = null;

	const reader = new ChatboxReader();

	// Do not use Alt1's timestamp cutoff: wrapped continuation rows can share the
	// same timestamp as the parent material line and arrive slightly later.
	reader.diffRead = true;
	reader.diffReadUseTimestamps = false;

	reader.readargs.colors.push(
		// anti aliasing sucks. These colors Alt1 does not have.
		a1lib.mixColor(51, 197, 20), // faded Green messages
		a1lib.mixColor(59, 181, 20), // Green messages
		a1lib.mixColor(59, 181, 30), // Other Green messages

		a1lib.mixColor(232, 47, 47), // pinkish red messages
		a1lib.mixColor(190, 15, 6), // dark red messages

		a1lib.mixColor(252, 140, 56), // broadcasts we don't need
		a1lib.mixColor(245, 135, 55), // broadcasts we don't need

		a1lib.mixColor(252, 174, 0), // Orange actions
		a1lib.mixColor(253, 127, 0), // uncommon components
		a1lib.mixColor(67, 188, 188), // Cotton candy? or ancient?

		a1lib.mixColor(161, 53, 235), // what's this? Purple
		a1lib.mixColor(51, 101, 252), // A random blue as entered the room
	);

	setupInventionNudges(reader);

	return reader;
}

export function processChatRows(opts: Array<{ text: string }>): string[] {
	const groupedRows: string[] = [];
	let activeLine = "";
	let activeTimestamp: string | null = null;
	let pendingTimestampOnly: string | null = null;

	const flushActiveLine = () => {
		if (!activeLine) return;

		groupedRows.push(activeLine);
		activeLine = "";
		activeTimestamp = null;
	};

	const preservePendingTimestamp = () => {
		if (!pendingTimestampOnly) return;

		flushActiveLine();
		groupedRows.push(`[${pendingTimestampOnly}]`);
		pendingTimestampOnly = null;
	};

	for (let row of opts.map((option) => normalizeChatWhitespace(option.text))) {
		if (!row) continue;

		let timestamp = getTimestamp(row);
		let body = stripLeadingTimestamp(row);

		if (!timestamp && pendingTimestampOnly) {
			row = `[${pendingTimestampOnly}] ${body}`;
			timestamp = pendingTimestampOnly;
			body = stripLeadingTimestamp(row);
			pendingTimestampOnly = null;
		} else if (timestamp && pendingTimestampOnly) {
			preservePendingTimestamp();
		}

		if (timestamp && !body) {
			pendingTimestampOnly = timestamp;
			continue;
		}

		if (!timestamp) {
			if (activeLine) {
				activeLine = joinChatContinuation(activeLine, row);
				continue;
			}

			groupedRows.push(
				createSyntheticMaterialContinuation(body) ?? row
			);
			continue;
		}

		if (isStandaloneMaterialContinuation(body)) {
			if (activeLine && activeTimestamp === timestamp && isMaterialLine(activeLine)) {
				rememberMaterialContext(timestamp);
				groupedRows.push(activeLine);
				groupedRows.push(formatSyntheticMaterialContinuation(timestamp, body));
				activeLine = "";
				activeTimestamp = null;
				continue;
			}

			const contextTimestamp = getRecentMaterialTimestamp(timestamp);

			if (contextTimestamp) {
				flushActiveLine();
				groupedRows.push(formatSyntheticMaterialContinuation(contextTimestamp, body));
				continue;
			}
		}

		if (
			activeLine &&
			activeTimestamp === timestamp &&
			shouldJoinTimestampedContinuation(activeLine, body)
		) {
			activeLine = joinChatContinuation(activeLine, body);

			if (isMaterialLine(activeLine)) {
				rememberMaterialContext(timestamp);
			}

			continue;
		}

		flushActiveLine();

		activeLine = row;
		activeTimestamp = timestamp;

		if (isMaterialLine(activeLine)) {
			rememberMaterialContext(timestamp);
		}
	}

	flushActiveLine();
	preservePendingTimestamp();

	return groupedRows
		.map((text) => text.replace(/(\d)\s*x\s+x\b/gi, "$1 x").trim())
		.filter(Boolean);
}

function normalizeChatWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function getTimestamp(text: string): string | null {
	return text.match(timestampValueRegex)?.[1] ?? null;
}

function stripLeadingTimestamp(text: string): string {
	return text.replace(leadingTimestampRegex, "").trim();
}

function shouldJoinTimestampedContinuation(activeLine: string, body: string): boolean {
	const activeBody = stripLeadingTimestamp(activeLine);

	return (
		continuationStartRegex.test(body) ||
		materialTailRegex.test(body) ||
		unfinishedLineRegex.test(activeBody)
	);
}

function createSyntheticMaterialContinuation(body: string): string | null {
	if (!isStandaloneMaterialContinuation(body)) return null;

	const timestamp = getRecentMaterialTimestamp();
	if (!timestamp) return null;

	return formatSyntheticMaterialContinuation(timestamp, body);
}

function formatSyntheticMaterialContinuation(timestamp: string, body: string): string {
	return `[${timestamp}] Materials gained: ${body}`;
}

function isMaterialLine(text: string): boolean {
	return materialLineRegex.test(text);
}

function isStandaloneMaterialContinuation(text: string): boolean {
	return !isMaterialLine(text) && materialContinuationRegex.test(text);
}

function rememberMaterialContext(timestamp: string): void {
	recentMaterialContext = {
		timestamp,
		updatedAt: Date.now(),
	};
}

function getRecentMaterialTimestamp(timestamp?: string | null): string | null {
	if (!recentMaterialContext) return null;

	if (Date.now() - recentMaterialContext.updatedAt > recentMaterialContextMs) {
		recentMaterialContext = null;
		return null;
	}

	if (timestamp && recentMaterialContext.timestamp !== timestamp) {
		return null;
	}

	return recentMaterialContext.timestamp;
}

function joinChatContinuation(base: string, continuation: string): string {
	const cleanContinuation = stripLeadingTimestamp(continuation);
	if (!cleanContinuation) return base;

	return `${base.trimEnd()} ${cleanContinuation}`.replace(/\s+/g, " ").trim();
}
