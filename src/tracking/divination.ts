export type Group = "energy" | "chronicles";

export type Option = {
	item: string;
	group: Group;
};

const standardTiers = [
	"pale",
	"flickering",
	"bright",
	"glowing",
	"sparkling",
	"gleaming",
	"vibrant",
	"lustrous",
	"elder",
	"brilliant",
	"radiant",
	"luminous",
	"incandescent",
] as const;

const arcTiers = ["positive", "negative", "ancestral"] as const;

const chronicles = [
	"chronicle fragment",
	"enhanced chronicle fragment",
	"elder chronicle",
	"enhanced elder chronicle",
] as const;

const options: readonly Option[] = [
	...standardTiers.map((tier) => ({
		item: `${tier} energy`,
		group: "energy" as const,
	})),
	...arcTiers.map((tier) => ({
		item: `${tier} energy`,
		group: "energy" as const,
	})),
	...chronicles.map((item) => ({
		item,
		group: "chronicles" as const,
	})),
];

export function getOptions(): readonly Option[] {
	return options;
}
