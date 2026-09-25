export type Group =
	| "trap catches"
	| "hunter products"
	| "anachronia bgh"
	| "havenhythe bgh";

export type Option = {
	item: string;
	group: Group;
};

export const groups: ReadonlyArray<{ group: Group; label: string }> = [
	{ group: "trap catches", label: "Trap Catches" },
	{ group: "hunter products", label: "Hunter Products" },
	{ group: "anachronia bgh", label: "Anachronia BGH" },
	{ group: "havenhythe bgh", label: "Havenhythe BGH" },
];

const trapCatches = [
	"chinchompa",
	"red chinchompa",
	"black chinchompa",
	"cobalt skillchompa",
	"viridian skillchompa",
	"azure skillchompa",
	"crimson skillchompa",
	"crystal skillchompa",
	"green salamander",
	"orange salamander",
	"red salamander",
	"black salamander",
] as const;

const hunterProducts = [
	"plain whirligig shell",
	"gliding whirligig shell",
	"swift whirligig shell",
	"hasty whirligig shell",
	"speedy whirligig shell",
	"dazzling whirligig shell",
	"kebbit spike",
	"kebbit claws",
	"kebbit teeth",
	"long kebbit spike",
	"rabbit foot",
	"jackalope antlers",
	"grenwall spikes",
	"shiny shell chippings",
] as const;

const anachroniaBgh = [
	"dinosaur bones",
	"dinosaur scale",
	"dinosaur hide",
	"damaged dinosaur hide",
	"dragon mattock",
	"superior long bone",
	"tribal fin",
	"volcanic fragments",
	"raw arcane apoterrasaur meat",
	"raw scimitops meat",
	"raw bagrada rex meat",
	"raw spicati apoterrasaur meat",
	"raw asciatops meat",
	"raw corbicula rex meat",
	"raw oculi apoterrasaur meat",
	"raw malletops meat",
	"raw pavosaurus rex meat",
] as const;

const havenhytheBgh = [
	"apex hide",
	"raw giant chinchompa meat",
	"raw giant kebbit meat",
] as const;

const options: readonly Option[] = [
	...trapCatches.map((item) => ({
		item,
		group: "trap catches" as const,
	})),
	...hunterProducts.map((item) => ({
		item,
		group: "hunter products" as const,
	})),
	...anachroniaBgh.map((item) => ({
		item,
		group: "anachronia bgh" as const,
	})),
	...havenhytheBgh.map((item) => ({
		item,
		group: "havenhythe bgh" as const,
	})),
];

export function getOptions(): readonly Option[] {
	return options;
}
