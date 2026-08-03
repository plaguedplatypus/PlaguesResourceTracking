export type ComponentTier = "ancient" | "rare" | "uncommon";
export type MaterialSuffix = "parts" | "components";

export const ancientComponents = new Set([
	"classic",
	"historic",
	"timeworn",
	"vintage",
]);

export const rareComponents = new Set([
	"armadyl",
	"ascended",
	"avernic",
	"bandos",
	"brassican",
	"clockwork",
	"corporeal",
	"culinary",
	"cywir",
	"dragonfire",
	"ecliptic",
	"explosive",
	"faceted",
	"fortunate",
	"fungal",
	"harnessed",
	"ilujankan",
	"knightly",
	"manufactured",
	"noxious",
	"oceanic",
	"pestiferous",
	"resilient",
	"rumbling",
	"saradomin",
	"seren",
	"shadow",
	"shifting",
	"silent",
	"third-age",
	"undead",
	"zamorak",
	"zaros",
]);

export const uncommonComponents = new Set([
	"dextrous",
	"direct",
	"enhancing",
	"ethereal",
	"evasive",
	"healthy",
	"heavy",
	"imbued",
	"light",
	"living",
	"offcut",
	"pious",
	"powerful",
	"precious",
	"precise",
	"protective",
	"refined",
	"sharp",
	"strong",
	"stunning",
	"subtle",
	"swift",
	"variable",
]);

export const parts = new Set([
	"base",
	"blade",
	"clear",
	"connector",
	"cover",
	"crafted",
	"crystal",
	"deflecting",
	"delicate",
	"flexible",
	"head",
	"insulated",
	"magic",
	"metallic",
	"organic",
	"padded",
	"plated",
	"simple",
	"smooth",
	"spiked",
	"spiritual",
	"stave",
	"tensile",
	"variable",
]);

const componentTiers: ReadonlyArray<
	readonly [ComponentTier, ReadonlySet<string>]
> = [
	["ancient", ancientComponents],
	["rare", rareComponents],
	["uncommon", uncommonComponents],
];

export function isKnownPart(root: string): boolean {
	return parts.has(root.toLowerCase());
}

export function isKnownComponent(root: string): boolean {
	const normalized = root.toLowerCase();
	return componentTiers.some(([, roots]) => roots.has(normalized));
}

export function isKnownMaterial(
	root: string,
	suffix: MaterialSuffix
): boolean {
	return suffix === "parts"
		? isKnownPart(root)
		: isKnownComponent(root);
}

export function getComponentTier(
	root: string
): ComponentTier | null {
	const normalized = root.toLowerCase();
	return (
		componentTiers.find(([, roots]) => roots.has(normalized))?.[0] ??
		null
	);
}
