import {
	getComponentTier,
	isKnownMaterial,
	MaterialSuffix,
} from "./components";
import { normalizeInventionMessage } from "./InventionNormalizer";
import {
	getMaterialsGainedPayload,
	isIgnoredTrackerMessage,
	isMaterialsGainedMessage,
} from "../tracking/trackerMessages";

type InventionMaterialUpdate = {
	item: string;
	amount: number;
	skill: "invention";
	colorClass?: string;
	source?: string;
};

type InventionParseResult = {
	updates: InventionMaterialUpdate[];
	countedMaterials: string[];
	statusMessage: string;
};

type ParsedMaterial = {
	item: string;
	amount: number;
	root: string;
	suffix: MaterialSuffix | null;
};

export function processInventionMaterials(
rawLine: string
 ): InventionParseResult | null {
 	const cleanLine = normalizeInventionMessage(rawLine);
	if (isIgnoredTrackerMessage(cleanLine)) return null;
	const scavengingMatch = cleanLine.match(/^Your Scavenging perk adds:\s*(.+)$/i);
	if (scavengingMatch) {
		const scavengingMaterial = parseExplicitMaterialEntry(scavengingMatch[1]);
		return scavengingMaterial ? buildParseResult([scavengingMaterial]) : null;
	}

	const leagueMaterialMatch = cleanLine.match(
		/^Your Leagues? Scavenging perk finds:?\s*(.+)$/i
	);
	if (leagueMaterialMatch) {
		const leagueMaterial = parseLeagueMaterialEntry(leagueMaterialMatch[1]);
		return leagueMaterial ? buildParseResult([leagueMaterial]) : null;
	}

 	const receivedMaterial = parseReceivedMaterial(cleanLine);
 	if (receivedMaterial) {
 		return buildParseResult([receivedMaterial]);
	}

	const materialText = getMaterialsGainedPayload(cleanLine);

	if (materialText !== null && /,\s*$/.test(materialText)) {
		return null;
	}

	const entries = materialText !== null
		? materialText
			.split(",")
			.map(parseExplicitMaterialEntry)
			.filter((entry): entry is ParsedMaterial => entry !== null)
		: [parseExplicitMaterialEntry(cleanLine)].filter(
			(entry): entry is ParsedMaterial => entry !== null
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
	entries: ParsedMaterial[]
): InventionParseResult {
	const updates = entries.map(toMaterialUpdate);
	const countedMaterials = entries.map(
		({ item, amount }) => `${titleCase(item)} +${amount}`
	);
	const last = entries[entries.length - 1];

	return {
		updates,
		countedMaterials,
		statusMessage: `💡: ${last.amount} x ${last.item}`,
	};
}

function parseReceivedMaterial(
	text: string
): ParsedMaterial | null {
	const match = text.match(
		/^You receive\s+((?:[1-9]\d{0,2}(?:,\d{3})+)|(?:[1-9]\d*))\s+(.+?)\.?$/i
	);
	if (!match) return null;

	return parseMaterial(
		match[1].replace(/,/g, ""),
		match[2]
	);
}

function parseExplicitMaterialEntry(
	text: string
): ParsedMaterial | null {
	const match = text
		.trim()
		.replace(/\.$/, "")
		.match(/^([1-9]\d*)\s+x\s+(.+)$/i);

	if (!match) return null;

	return parseMaterial(match[1], match[2]);
}

function parseLeagueMaterialEntry(text: string): ParsedMaterial | null {
	const explicitEntry = parseExplicitMaterialEntry(text);
	if (explicitEntry) return explicitEntry;

	const match = text.trim().match(
		/^([1-9]\d*)\s+x\s+((?:junk)|(?:[a-z]+(?:-[a-z]+)?)\s+(?:parts|components))\b/i
	);
	if (!match) return null;

	return parseMaterial(match[1], match[2]);
}

function parseMaterial(
	amountText: string,
	materialText: string
): ParsedMaterial | null {
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
	return parseExplicitMaterialEntry(text) !== null;
}

function toMaterialUpdate(
	entry: ParsedMaterial
): InventionMaterialUpdate {
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

function titleCase(text: string): string {
	return text.replace(/\b\w/g, (char) => char.toUpperCase());
}
