import { getComponentTier, isKnownMaterial,	MaterialSuffix, } from "./components";
import { getMaterialsPayload, isIgnoredTrackerMessage, isMaterialsGainedMessage, } from "../tracking/trackerMessages";

type MaterialUpdate = {
	item: string;
	amount: number;
	skill: "invention";
	colorClass?: string;
	source?: string;
};

type ParseResult = {
	updates: MaterialUpdate[];
	statusMessage: string;
};

type Material = {
	item: string;
	amount: number;
	root: string;
	suffix: MaterialSuffix | null;
};

export function processInventionMaterials(
	rawLine: string
): ParseResult | null {
	const cleanLine = normalizeInventionMessage(rawLine);
	if (isIgnoredTrackerMessage(cleanLine)) return null;
	const scavengingMatch = cleanLine.match(/^Your Scavenging perk adds:\s*(.+)$/i);
	if (scavengingMatch) {
		const scavengingMaterial = parseExplicitEntry(scavengingMatch[1]);
		return scavengingMaterial ? buildParseResult([scavengingMaterial]) : null;
	}

	const leagueMaterialMatch = cleanLine.match(
		/^Your Leagues? Scavenging perk finds:?\s*(.+)$/i
	);
	if (leagueMaterialMatch) {
		const leagueMaterial = parseLeagueEntry(leagueMaterialMatch[1]);
		return leagueMaterial ? buildParseResult([leagueMaterial]) : null;
	}

	const receivedMaterial = parseReceived(cleanLine);
	if (receivedMaterial) {
		return buildParseResult([receivedMaterial]);
	}

	const materialText = getMaterialsPayload(cleanLine);

	if (materialText !== null && /,\s*$/.test(materialText)) {
		return null;
	}

	const entries = materialText !== null
		? materialText
			.split(",")
			.map(parseExplicitEntry)
			.filter((entry): entry is Material => entry !== null)
		: [parseExplicitEntry(cleanLine)].filter(
			(entry): entry is Material => entry !== null
		);

	if (entries.length === 0) return null;

	return buildParseResult(entries);
}

export function couldStartInventionMessage(text: string): boolean {
	const cleanLine = normalizeInventionMessage(text);
	if (isIgnoredTrackerMessage(cleanLine)) return false;
	return (
		isMaterialsGainedMessage(cleanLine) ||
		/^Your Scavenging perk adds:/i.test(cleanLine) ||
		/^Your Leagues? Scavenging perk finds:?/i.test(cleanLine) ||
		/^You receive\b/i.test(cleanLine) ||
		/^[1-9][\d,]*\s+x\s+\S/i.test(cleanLine)
	);
}

function buildParseResult(
	entries: Material[]
): ParseResult {
	const updates = entries.map(toUpdate);
	const last = entries[entries.length - 1];

	return {
		updates,
		statusMessage: `💡: ${last.amount} x ${last.item}`,
	};
}

function parseReceived(
	text: string
): Material | null {
	const match = text.match(
		/^You receive\s+((?:[1-9]\d{0,2}(?:,\d{3})+)|(?:[1-9]\d*))\s+(.+?)\.?$/i
	);
	if (!match) return null;

	return parseEntry(
		match[1].replace(/,/g, ""),
		match[2]
	);
}

function parseExplicitEntry(
	text: string
): Material | null {
	const match = text
		.trim()
		.replace(/\.$/, "")
		.match(/^([1-9]\d*)\s+x\s+(.+)$/i);

	if (!match) return null;

	return parseEntry(match[1], match[2]);
}

function parseLeagueEntry(text: string): Material | null {
	const explicitEntry = parseExplicitEntry(text);
	if (explicitEntry) return explicitEntry;

	const match = text.trim().match(
		/^([1-9]\d*)\s+x\s+((?:junk)|(?:[a-z]+(?:-[a-z]+)?)\s+(?:parts|components))\b/i
	);
	if (!match) return null;

	return parseEntry(match[1], match[2]);
}

function parseEntry(
	amountText: string,
	materialText: string
): Material | null {
	const amount = Number(amountText);
	if (
		!Number.isSafeInteger(amount) ||
		amount <= 0
	) {
		return null;
	}
	const material = materialText.trim().toLowerCase();

	if (material === "junk") {
		return { item: "junk", amount, root: "junk", suffix: null };
	}

	const nameMatch = material.match(
		/^([a-z]+(?:-[a-z]+)?)\s+(parts|components)$/
	);
	if (!nameMatch) return null;

	const root = nameMatch[1];
	const suffix = nameMatch[2] as MaterialSuffix;
	if (!isKnownMaterial(root, suffix)) return null;

	return {
		item: `${root} ${suffix}`,
		amount,
		root,
		suffix,
	};
}

export function isExplicitMaterialEntry(text: string): boolean {
	return parseExplicitEntry(text) !== null;
}

function toUpdate(
	entry: Material
): MaterialUpdate {
	const componentTier =
		entry.suffix === "components"
			? getComponentTier(entry.root)
			: null;

	return {
		item: entry.item,
		amount: entry.amount,
		skill: "invention",
		colorClass: componentTier
			? `${componentTier}-component`
			: undefined,
		source: componentTier
			? `${componentTier}-components`
			: "invention",
	};
}

function normalizeInventionMessage(text: string): string {
	return text
		.replace(/\s+/g, " ")
		.replace(/\s+,/g, ",")
		.trim();
}
