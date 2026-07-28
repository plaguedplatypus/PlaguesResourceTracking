export type InventionMaterialUpdate = {
	item: string;
	amount: number;
	skill: "invention";
	colorClass?: string;
	source?: string;
};

export type InventionParseResult = {
	updates: InventionMaterialUpdate[];
	countedMaterials: string[];
	statusMessage: string;
};

type ComponentTier = "ancient" | "rare" | "uncommon";

const ancientComponents = new Set([
	"classic components",
	"historic components",
	"timeworn components",
	"vintage components",
]);

const rareComponents = new Set([
	"armadyl components",
	"ascended components",
	"avernic components",
	"bandos components",
	"brassican components",
	"clockwork components",
	"corporeal components",
	"culinary components",
	"cywir components",
	"dragonfire components",
	"ecliptic components",
	"explosive components",
	"faceted components",
	"fortunate components",
	"fungal components",
	"harnessed components",
	"ilujankan components",
	"knightly components",
	"manufactured components",
	"noxious components",
	"oceanic components",
	"pestiferous components",
	"resilient components",
	"rumbling components",
	"saradomin components",
	"seren components",
	"shadow components",
	"shifting components",
	"silent components",
	"third-age components",
	"undead components",
	"zamorak components",
	"zaros components",
]);

const uncommonComponents = new Set([
	"dextrous components",
	"direct components",
	"enhancing components",
	"ethereal components",
	"evasive components",
	"healthy components",
	"heavy components",
	"imbued components",
	"light components",
	"living components",
	"offcut components",
	"pious components",
	"powerful components",
	"precious components",
	"precise components",
	"protective components",
	"refined components",
	"sharp components",
	"strong components",
	"stunning components",
	"subtle components",
	"swift components",
	"variable components",
]);

export function startsWithKnownInventionComponent(text: string): boolean {
	const match = text.match(
		/^\s*([A-Za-z]+(?:-[A-Za-z]+)?\s+components?)\b/i
	);
	if (!match) return false;

	const componentName = match[1]
		.toLowerCase()
		.replace(/\bcomponent$/, "components");

	return getComponentTier(componentName) !== null;
}

export function processInventionMaterials(
	cleanLine: string
): InventionParseResult | null {
	const materialsMatch = cleanLine.match(/Materials gained:\s*(.+)$/i);
	if (!materialsMatch) return null;

	const materialText = materialsMatch[1].trim();
	if (/,\s*$/.test(materialText)) {
		return null;
	}

	const materialRegex = /(\d+)\s*x\s*([^,.]+?)(?:,|\.|$)/gi;
	const updates: InventionMaterialUpdate[] = [];
	const countedMaterials: string[] = [];
	let statusMessage = "";
	let materialMatch: RegExpExecArray | null;

	const addMaterial = (item: string, amount: number): void => {
		if (!item || !Number.isFinite(amount)) {
			return;
		}

		const componentTier = getComponentTier(item);
		const isCommonMaterial =
			/\bparts$/.test(item) || item === "junk";

		if (!componentTier && !isCommonMaterial) {
			return;
		}

		const colorClass = componentTier
			? `${componentTier}-component`
			: undefined;
		const source = componentTier
			? `${componentTier}-components`
			: "invention";

		updates.push({
			item,
			amount,
			skill: "invention",
			colorClass,
			source,
		});

		countedMaterials.push(`${titleCase(item)} +${amount}`);
		statusMessage = `💡: ${amount} x ${item}`;
	};

	while ((materialMatch = materialRegex.exec(materialText)) !== null) {
		const amount = parseInt(materialMatch[1], 10);
		const item = normalizeMaterialName(materialMatch[2]);

		addMaterial(item, amount);
	}

	for (const segment of materialText.split(",")) {
		const orphanText = segment.trim();
		if (
			!orphanText ||
			/^\d+\s*x\b/i.test(orphanText) ||
			!/\bcomponents?\.?$/i.test(orphanText)
		) {
			continue;
		}

		const orphanComponent = normalizeMaterialName(orphanText);
		if (!getComponentTier(orphanComponent)) {
			continue;
		}

		addMaterial(orphanComponent, 1);
	}

	if (updates.length === 0) return null;

	return {
		updates,
		countedMaterials,
		statusMessage,
	};
}

function normalizeMaterialName(item: string): string {
	const normalized = item
		.toLowerCase()
		.replace(/\.$/, "")
		.replace(/\bcomponent$/, "components")
		.replace(/\bpart$/, "parts")
		.trim();

	if (getComponentTier(normalized)) {
		return normalized;
	}

	const completedComponent = `${normalized} components`;
	return getComponentTier(completedComponent)
		? completedComponent
		: normalized;
}

function getComponentTier(item: string): ComponentTier | null {
	if (ancientComponents.has(item)) return "ancient";
	if (rareComponents.has(item)) return "rare";
	if (uncommonComponents.has(item)) return "uncommon";

	return null;
}

function titleCase(text: string): string {
	return text.replace(/\b\w/g, (char) => char.toUpperCase());
}
