type TrackedSkill =
	| "mining"
	| "woodcutting"
	| "fishing"
	| "archaeology"
	| "seren"
	| "other";

type SpiritRewardSource =
	| "seren-spirit"
	| "Forge/Fire Spirit";

type SkillItemUpdate = {
	item: string;
	amount: number;
	skill: TrackedSkill;
	colorClass?: string;
	source?: SpiritRewardSource | string;
	storageKey?: string;
};

type SkillTrackingResult = {
	updates: SkillItemUpdate[];
	statusMessage: string;
	historyStatus: string;
};

type SkillTrackerOptions = {
	fishingUsePorters: boolean;
};

const skillPatterns: ReadonlyArray<{
	pattern: RegExp;
	skill: Exclude<TrackedSkill, "seren" | "other">;
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

const spiritHeaders: ReadonlyArray<{
	pattern: RegExp;
	source: SpiritRewardSource;
	label: string;
}> = [
	{
		pattern: /^The Seren spirit gifts you:\s*(.+)$/i,
		source: "seren-spirit",
		label: "Seren Spirit",
	},
	{
		pattern: /^The forge phoenix gifts you:\s*(.+)$/i,
		source: "Forge/Fire Spirit",
		label: "Forge/Fire Spirit",
	},
	{
		pattern: /^The fire spirit gifts you:\s*(.+)$/i,
		source: "Forge/Fire Spirit",
		label: "Forge/Fire Spirit",
	},
];

const ignoredSkillMessages: readonly RegExp[] = [
	/^You find some valuables and stuff them into your bag\.?$/i,
];

export function parseSkillTrackerMessage(
	cleanLine: string,
	options: SkillTrackerOptions
): SkillTrackingResult | null {
	if (isIgnoredSkillMessage(cleanLine)) return null;

	const spiritResult = parseSpiritRewardMessage(cleanLine);
	if (spiritResult) return spiritResult;

	const transportMatch = cleanLine.match(
		/(?:You transport|sent it|transports your items) to your\s+(.+?):\s*(?:(\d+)\s*x\s*)?([\s\S]+?)\.?$/i
	);

	if (transportMatch) {
		const destination = transportMatch[1].toLowerCase();
		const amount = transportMatch[2]
			? Number(transportMatch[2])
			: 1;
		const item = normalizeItemName(transportMatch[3]);
		if (!item || !Number.isInteger(amount) || amount <= 0) {
			return null;
		}

		const skill = getSkillForTransport(item, destination);
		if (skill === "fishing" && !options.fishingUsePorters) {
			return null;
		}

		return result(
			{ item, amount, skill },
			`Added: ${amount} x ${item}`
		);
	}

	for (const entry of skillPatterns) {
		const match = cleanLine.match(entry.pattern);
		if (!match) continue;
		if (entry.skill === "fishing" && options.fishingUsePorters) {
			continue;
		}

		const item = normalizeItemName(match[1]);
		if (!item) return null;

		return result(
			{ item, amount: 1, skill: entry.skill },
			`Added: ${item}`
		);
	}

	return null;
}

export function couldStartSkillTrackerMessage(text: string): boolean {
	const cleanLine = text.trim();
	if (isIgnoredSkillMessage(cleanLine)) return false;

	return (
		/^You (?:get|catch|find)\b/i.test(cleanLine) ||
		/^Your (?:Boon of Crondis|Fortune|imp-souled)\b/i.test(cleanLine) ||
		/^The (?:Seren spirit|forge phoenix|fire spirit) gifts you:/i.test(
			cleanLine
		) ||
		/(?:^You transport|sent it|transports your items) to your\b/i.test(
			cleanLine
		)
	);
}

function isIgnoredSkillMessage(text: string): boolean {
	const cleanLine = text.trim();
	return ignoredSkillMessages.some((pattern) => pattern.test(cleanLine));
}

function parseSpiritRewardMessage(
	cleanLine: string
): SkillTrackingResult | null {
	for (const header of spiritHeaders) {
		const match = cleanLine.trim().match(header.pattern);
		if (!match) continue;

		const entries = splitSpiritRewardEntries(
			stripSpiritRewardFooter(match[1])
		);
		if (entries.length === 0) return null;

		const updates = entries.map(({ item, amount }) => ({
			item,
			amount,
			skill: "seren" as const,
			colorClass: getSpiritColorClass(header.source, item),
			source: header.source,
			storageKey: buildSpiritStorageKey(header.source, item),
		}));

		return {
			updates,
			statusMessage: `${header.label}: ${updates
				.map(({ amount, item }) => `${amount} x ${item}`)
				.join(", ")}`,
			historyStatus: `[COUNTED: ${updates
				.map(({ item, amount }) => `${item} +${amount}`)
				.join(", ")}]`,
		};
	}

	return null;
}

function buildSpiritStorageKey(
	source: SpiritRewardSource,
	item: string
): string {
	return `${source}::${normalizeItemName(item)}`;
}

function stripSpiritRewardFooter(text: string): string {
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
			const item = normalizeItemName(match[2]);
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

const knownItemOcrCorrections: Readonly<Record<string, string>> = {
	"saiifish": "sailfish",
	"raw saiifish": "raw sailfish",
};

export function normalizeItemName(item: string): string {
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

function getSkillForTransport(
	item: string,
	destination: string
): TrackedSkill {
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

function result(
	update: SkillItemUpdate,
	statusMessage: string
): SkillTrackingResult {
	return {
		updates: [update],
		statusMessage,
		historyStatus: `[COUNTED: ${update.item} +${update.amount}]`,
	};
}
