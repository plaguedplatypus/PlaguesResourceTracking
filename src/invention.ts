import ChatboxReader from "alt1/chatbox";
import * as OCR from "alt1/ocr";

type InventionMaterialUpdate = {
	item: string;
	amount: number;
	skill: "invention";
	colorClass?: string;
	source?: string;
};

type InventionMaterialResult = {
	updates: InventionMaterialUpdate[];
	countedMaterials: string[];
	statusMessage: string;
};

// List of ancient components.
const ancientComponents = new Set([
	"classic components",
	"historic components",
	"timeworn components",
	"vintage components",
]);

// List of rare components.
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

// List of uncommon components.
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

function normalizeItemName(item: string): string {
	return item
		.toLowerCase()
		.replace(/\.$/, "")
		.trim();
}

function titleCase(text: string): string {
	return text.replace(/\b\w/g, (char) => char.toUpperCase());
}

function repairComponentName(text: string, componentSet: Set<string>): string | null {
	const normalized = text
		.toLowerCase()
		.replace(/-/g, "e")
		.replace(/\./g, "p")
		.replace(/[^a-z]/g, "");

	for (const component of Array.from(componentSet)) {
		const componentNormalized = component
			.toLowerCase()
			.replace(/[^a-z]/g, "");

		const componentBase = componentNormalized.replace(/components$/, "");

		if (
			normalized.length >= 4 &&
			componentBase.startsWith(normalized)
		) {
			return component;
		}
	}

	return null;
}

function repairMaterialText(materialText: string): string {
	let finalMaterialText = materialText;

	// Clean badly chopped "components" endings, like "Subtle co...po. --."
	finalMaterialText = finalMaterialText.replace(
		/\b([A-Za-z-]+)\s+co[\.\-a-z\s]*$/gi,
		"$1"
	);

	// Repair chopped component names, like "Prot- ctiv-" or "H- avy".
	finalMaterialText = finalMaterialText.replace(
		/(\d+\s*x\s+)([A-Za-z- ]+?)(?=,|\.|$)/gi,
		(match, prefix, brokenName) => {
			const repaired =
				repairComponentName(brokenName, ancientComponents) ||
				repairComponentName(brokenName, rareComponents) ||
				repairComponentName(brokenName, uncommonComponents);

			return repaired ? `${prefix}${repaired}` : match;
		}
	);

	// Remove orphan tails like ", components" or ", parts".
	finalMaterialText = finalMaterialText.replace(
		/,\s*(components|parts)$/i,
		","
	);

	return finalMaterialText;
}

function addTextBridgeNudge(
	reader: ChatboxReader,
	name: string,
	match: RegExp
): void {
	reader.forwardnudges.push({
		name,
		match,
		fn: (ctx) => {
			const startx = ctx.rightx;

			for (const color of ctx.colors) {
				for (const offset of [
					0,
					ctx.font.spacewidth,
					ctx.font.spacewidth * 2,
					ctx.font.spacewidth * 3,
					1, 2, 3, 4, 5, 6,
				]) {
					const one = OCR.readChar(
						ctx.imgdata,
						ctx.font,
						color,
						startx + offset,
						ctx.baseliney,
						false,
						true
					);

					if (one?.chr !== "1") continue;

					const data = OCR.readLine(
						ctx.imgdata,
						ctx.font,
						color,
						one.x,
						ctx.baseliney,
						true,
						false
					);

					if (/^1\s*x\s+/i.test(data.text)) {
						data.fragments.forEach((frag) => ctx.addfrag(frag));
						return true;
					}

					const x = OCR.readChar(
						ctx.imgdata,
						ctx.font,
						color,
						one.x + one.basechar.width + ctx.font.spacewidth,
						ctx.baseliney,
						false,
						true
					);

					ctx.addfrag({
						color,
						index: -1,
						text: x?.chr === "x" ? "1 x" : "1",
						xstart: startx,
						xend: one.x + one.basechar.width,
					});

					return true;
				}
			}
		},
	});
}

function addCommaNudge(reader: ChatboxReader): void {
	reader.forwardnudges.push({
		name: "material-comma",
		match: /Materials gained:[\s\S]*(parts|components)$/i,
		fn: (ctx) => {
			for (const offset of [0, 1, 2, 3, 4, 5, ctx.font.spacewidth]) {
				for (const color of ctx.colors) {
					const comma = OCR.readChar(
						ctx.imgdata,
						ctx.font,
						color,
						ctx.rightx + offset,
						ctx.baseliney,
						false,
						true
					);

					if (comma?.chr !== ",") continue;

					ctx.addfrag({
						color,
						index: -1,
						text: ", ",
						xstart: ctx.rightx,
						xend: comma.x + comma.basechar.width + ctx.font.spacewidth,
					});

					return true;
				}
			}
		},
	});
}

function addMaterialContinuationNudge(reader: ChatboxReader): void {
	reader.forwardnudges.push({
		name: "material-color-continuation",
		match: /Materials gained:[\s\S]*(?:,|\bparts|\bcomponents)\s*$/i,
		fn: (ctx) => {
			const addContinuation = (x: number, fragments: OCR.TextFragment[]) => {
				if (!ctx.text.endsWith(" ")) {
					ctx.addfrag({
						color: [255, 255, 255],
						index: -1,
						text: " ",
						xstart: ctx.rightx,
						xend: x,
					});
				}

				fragments.forEach((frag) => ctx.addfrag(frag));
				return true;
			};

			const candidateStarts = [
				ctx.rightx - ctx.font.spacewidth * 4,
				ctx.rightx - ctx.font.spacewidth * 3,
				ctx.rightx - ctx.font.spacewidth * 2,
				ctx.rightx - ctx.font.spacewidth,
				ctx.rightx,
				ctx.rightx + ctx.font.spacewidth,
				ctx.rightx + ctx.font.spacewidth * 2,
				ctx.rightx + ctx.font.spacewidth * 3,
				ctx.rightx + ctx.font.spacewidth * 4,
			];

			for (const x of candidateStarts) {
				const data = OCR.readLine(
					ctx.imgdata,
					ctx.font,
					ctx.colors,
					x,
					ctx.baseliney,
					true,
					false
				);

				if (!/^\s*\d+\s*x\s+/i.test(data.text)) {
					continue;
				}

				return addContinuation(x, data.fragments);
			}

			const scanStart = ctx.rightx - ctx.font.spacewidth * 4;
			const scanEnd = ctx.rightx + ctx.font.spacewidth * 12;

			for (let x = scanStart; x <= scanEnd; x++) {
				for (const color of ctx.colors) {
					const digit = OCR.readChar(
						ctx.imgdata,
						ctx.font,
						color,
						x,
						ctx.baseliney,
						false,
						true
					);

					if (!digit || !/^\d$/.test(digit.chr)) {
						continue;
					}

					const data = OCR.readLine(
						ctx.imgdata,
						ctx.font,
						color,
						digit.x,
						ctx.baseliney,
						true,
						false
					);

					if (/^\d+\s*x\s+/i.test(data.text)) {
						return addContinuation(digit.x, data.fragments);
					}
				}
			}
		},
	});
}

export function setupInventionNudges(reader: ChatboxReader): void {
	addCommaNudge(reader);
	addMaterialContinuationNudge(reader);
	addTextBridgeNudge(
		reader,
		"component-bridge",
		/Materials gained:[\s\S]*(?:parts|components)/i
	);
}

export function processInventionMaterials(
	cleanLine: string
): InventionMaterialResult | null {
	const materialsMatch = cleanLine.match(/Materials gained:\s*(.+)$/i);

	if (!materialsMatch) return null;

	const materialText = materialsMatch[1];
	const finalMaterialText = repairMaterialText(materialText);
	const materialRegex = /(\d+)\s*x\s*([^,\.]+?)(?:,|\.|$)/gi;
	let materialMatch: RegExpExecArray | null;
	const countedMaterials: string[] = [];
	const updates: InventionMaterialUpdate[] = [];
	let statusMessage = "";

	while ((materialMatch = materialRegex.exec(finalMaterialText)) !== null) {
		const amount = parseInt(materialMatch[1], 10);
		const item = normalizeItemName(materialMatch[2]);

		if (!item || isNaN(amount)) continue;
		if (item === "junk") continue;

		const isAncientComponent = ancientComponents.has(item);
		const isRareComponent = rareComponents.has(item);
		const isComponent = item.includes("components");
		const isPart = item.includes("parts");

		const isInventionMaterial =
			isComponent ||
			isPart;

		if (!isInventionMaterial) continue;

		const colorClass = isAncientComponent
			? "ancient-component"
			: isRareComponent
				? "rare-component"
				: isComponent
					? "uncommon-component"
					: undefined;

		const source = isAncientComponent
			? "ancient-components"
			: isRareComponent
				? "rare-components"
				: isComponent
					? "uncommon-components"
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
	}

	if (updates.length === 0) return null;

	return {
		updates,
		countedMaterials,
		statusMessage,
	};
}
