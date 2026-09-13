import { getFarmingProduce, } from "./farming";
import { isIgnoredMessage, spiritRewardHeaders, type SpiritRewardSource, } from "./trackerMessages";

type Skill =
	| "mining"
	| "woodcutting"
	| "fishing"
	| "farming"
	| "archaeology"
	| "seren"
	| "other";

type ItemUpdate = {
	item: string;
	amount: number;
	skill: Skill;
	colorClass?: string;
	source?: SpiritRewardSource | string;
	storageId?: string;
};

export function getUpdateId(update: {
	item: string;
	storageId?: string;
}): string {
	return update.storageId || update.item;
}

type Result = {
	updates: ItemUpdate[];
};

type Options = {
	fishingUsePorters: boolean;
};

const skillPatterns: ReadonlyArray<{
	pattern: RegExp;
	skill: Exclude<Skill, "seren" | "other">;
}> = [
	{ pattern: /You get some\s+(.+?)[!.]/i, skill: "woodcutting" },
	{
		pattern:
			/You find (?:a|an)\s+((?:enchanted\s+)?bird's nest)(?:[.!]|\s+You pick it up\b|$)/i,
		skill: "woodcutting",
	},
	{
		pattern:
			/You find (?:a|an)\s+(eternal magic tree branch)[!.]/i,
		skill: "woodcutting",
	},
	{ pattern: /You catch (?:a|an|some)\s+(.+?)\./i, skill: "fishing" },
	{
		pattern: /^You find:\s*(.+?\(damaged\))[!.]?$/i,
		skill: "archaeology",
	},
	{ pattern: /You find some\s+(.+?)[!.]/i, skill: "archaeology" },
];

const rareSerenItems = new Set([
	"hazelmere's signet ring",
	"blurberry special",
	"cheese+tom batta",
]);

const miningItems = [
	"limestone",
	"essence",
	"clay",
	"sandstone",
	"granite",
	"calcified",
];

const woodcuttingItems = [
	"logs",
	"bird's nest",
	"crystal geode",
	"bamboo",
	"timber",
	"eternal magic tree branch",
];

const fishingItems = ["raw ", "leaping ", "algae"];

const knownItemOcrCorrections: Readonly<Record<string, string>> = {
	"saiifish": "sailfish",
	"raw saiifish": "raw sailfish",
	"raw swor": "raw swordfish",
};

export function parseSkillMessage(
	cleanLine: string,
	options: Options
): Result | null {
	if (isIgnoredMessage(cleanLine)) return null;

	const spiritResult = parseSpiritReward(cleanLine);
	if (spiritResult) return spiritResult;

	const farmingResult = parseFarmingMessage(cleanLine);
	if (farmingResult) return farmingResult;

	const transportMatch = cleanLine.match(
		/(?:You transport|sent it|transports your items|Your League relic transports the following item) to your\s+(.+?):\s*(?:(\d+)\s*x\s*)?([\s\S]+?)\.?$/i
	);

	if (transportMatch) {
		const destination = transportMatch[1].toLowerCase();
		const amount = transportMatch[2]
			? Number(transportMatch[2])
			: 1;
		const item = normalizeTrackedItemName(transportMatch[3]);
		if (!item || !Number.isInteger(amount) || amount <= 0) {
			return null;
		}

		const skill = getTransportSkill(item, destination);
		if (skill === "fishing" && !options.fishingUsePorters) {
			return null;
		}

		return makeResult({ item, amount, skill });
	}

	for (const entry of skillPatterns) {
		const match = cleanLine.match(entry.pattern);
		if (!match) continue;
		if (entry.skill === "fishing" && options.fishingUsePorters) {
			continue;
		}

		const item = normalizeTrackedItemName(match[1]);
		if (!item) return null;

		return makeResult({ item, amount: 1, skill: entry.skill });
	}

	return null;
}

function parseFarmingMessage(
	cleanLine: string,
): Result | null {
	const normalizedLine = cleanLine.replace(/\s+/g, " ").trim();
	const match =
		normalizedLine.match(
			/^You transport to your bank:\s*([1-9][\d,]*)\s*x\s*(.+?)\.?$/i,
		) ??
		normalizedLine.match(
			/^Your Farming skillcape perk harvested and noted\s+([1-9][\d,]*)\s*x\s*(.+?)\.?$/i,
		) ??
		normalizedLine.match(
			/^Your Boon of Crondis has doubled the following item and sent it to your bank:\s*([1-9][\d,]*)\s*x\s*(.+?)\.?$/i,
		);

	if (!match) return null;

	const amount = Number(match[1].replace(/,/g, ""));
	const item = getFarmingProduce(match[2]);
	if (!item || !Number.isSafeInteger(amount) || amount <= 0) return null;

	return makeResult({ item, amount, skill: "farming" });
}

function parseSpiritReward(
	cleanLine: string
): Result | null {
	for (const header of spiritRewardHeaders) {
		const match = cleanLine.trim().match(header.pattern);
		if (!match) continue;

		const entries = splitSpiritRewardEntries(
			stripSpiritReward(match[1])
		);
		if (entries.length === 0) return null;

		const updates = entries.map(({ item, amount }) => ({
			item,
			amount,
			skill: "seren" as const,
			colorClass: getSpiritColorClass(header.source, item),
			source: header.source,
			storageId: buildSpiritStorageId(header.source, item),
		}));

		return {
			updates,
		};
	}

	return null;
}

function buildSpiritStorageId(
	source: SpiritRewardSource,
	item: string
): string {
	return `${source}::${normalizeTrackedItemName(item)}`;
}

function stripSpiritReward(text: string): string {
	return text.replace(
		/\s+The gift is sent to your bank\.?\s*$/i,
		""
	);
}

function splitSpiritRewardEntries(
	text: string
): Array<{ item: string; amount: number }> {
	const pattern =
		/(?:^|,\s*)([1-9][\d,]*)\s*x\s+(.+?)(?=,\s*[1-9][\d,]*\s*x\s+|$)/gi;
	const matches: RegExpExecArray[] = [];
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(text)) !== null) {
		matches.push(match);
	}

	return matches
		.map((match) => {
			const amount = Number(match[1].replace(/,/g, ""));
			const item = normalizeTrackedItemName(match[2]);
			return { item, amount };
		})
		.filter(
			({ item, amount }) =>
				item.length > 0 &&
				Number.isSafeInteger(amount) &&
				amount > 0
		);
}

function getSpiritColorClass(
	source: SpiritRewardSource,
	item: string
): string {
	if (source === "seren-spirit") {
		return rareSerenItems.has(item)
			? "seren-item-rare"
			: "seren-item";
	}

	return "spirit-item-green";
}

export function normalizeTrackedItemName(item: string): string {
	const normalized = item
		.replace(
			/\s+\[(?:[01]\d|2[0-3])(?::[0-5]?\d?){0,2}.*$/,
			""
		)
		.toLowerCase()
		.trim()
		.replace(/[\s.,;:\[\]]+$/g, "")
		.trim();

	return knownItemOcrCorrections[normalized] ?? normalized;
}

function getTransportSkill(
	item: string,
	destination: string
): Skill {
	if (destination.includes("metal bank")) return "mining";
	if (destination.includes("material storage")) return "archaeology";
	if (!destination.includes("bank")) return "other";
	if (item.includes("(damaged)")) return "archaeology";
	if (miningItems.some((keyword) => item.includes(keyword))) {
		return "mining";
	}
	if (woodcuttingItems.some((keyword) => item.includes(keyword))) {
		return "woodcutting";
	}
	if (fishingItems.some((keyword) => item.includes(keyword))) {
		return "fishing";
	}
	return "other";
}

function makeResult(update: ItemUpdate): Result {
	return {
		updates: [update],
	};
}
