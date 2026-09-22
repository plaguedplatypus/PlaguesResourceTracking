import * as a1lib from "alt1/base";
import { ImgRef, ImgRefData } from "alt1/base";
import * as OCR from "alt1/ocr";
import { webpackImages } from "alt1/base";
import chat10pt from "./chat_10pt.json";
import chat12pt from "./chat_12pt.json";
import chat14pt from "./chat_14pt.json";
import chat16pt from "./chat_16pt.json";
import type { ChatboxType } from "./chatTypes";
import { isKnownMaterial, MaterialSuffix } from "../invention/components";
import { isExplicitMaterialEntry } from "../invention/InventionParser";
import {
	couldStartSkillMessage,
	getMaterialsPayload,
	isMaterialsGainedMessage,
	isSpiritRewardMessage,
} from "../tracking/trackerMessages";

declare function require(moduleName: string): Promise<ImageData>;

type FontSetting = { name: string, lineheight: number, dy: number, def: OCR.FontDefinition };

let fonts: FontSetting[] = [
	{ name: "10pt", lineheight: 14, dy: -2, def: chat10pt as OCR.FontDefinition },
	{ name: "12pt", lineheight: 16, dy: -3, def: chat12pt as OCR.FontDefinition },
	{ name: "14pt", lineheight: 18, dy: -3, def: chat14pt as OCR.FontDefinition },
	{ name: "16pt", lineheight: 21, dy: -4, def: chat16pt as OCR.FontDefinition },
];

const imgs = webpackImages({
	plusbutton: require("../../node_modules/alt1/src/chatbox/imgs/plusbutton.data.png"),
	minusbutton: require("../../node_modules/alt1/src/chatbox/imgs/minusbutton.data.png"),
	filterbutton: require("../../node_modules/alt1/src/chatbox/imgs/filterbutton.data.png"),
	chatbubble: require("../../node_modules/alt1/src/chatbox/imgs/chatbubble.data.png"),
	chatLegacyBorder: require("../../node_modules/alt1/src/chatbox/imgs/chatLegacyBorder.data.png"),
	gameoff: require("../../node_modules/alt1/src/chatbox/imgs/gameoff.data.png"),
	gamefilter: require("../../node_modules/alt1/src/chatbox/imgs/gamefilter.data.png"),
	gameall: require("../../node_modules/alt1/src/chatbox/imgs/gameall.data.png"),
	legacyreport: require("../../node_modules/alt1/src/chatbox/imgs/legacyreport.data.png"),
});

const chatimgs = webpackImages({
	public: require("../../node_modules/alt1/src/chatbox/imgs/publicchat.data.png"),
	private: require("../../node_modules/alt1/src/chatbox/imgs/privatechat.data.png"),
	clan: require("../../node_modules/alt1/src/chatbox/imgs/clanchat.data.png"),
	guestclan: require("../../node_modules/alt1/src/chatbox/imgs/guestclan.data.png"),
	privateRecent: require("../../node_modules/alt1/src/chatbox/imgs/privateRecent.data.png"),
	friends: require("../../node_modules/alt1/src/chatbox/imgs/friendschat.data.png"),
	group: require("../../node_modules/alt1/src/chatbox/imgs/groupchat.data.png"),
	groupironman: require("../../node_modules/alt1/src/chatbox/imgs/gimchat.data.png"),
});

const chatmap: { [key in keyof typeof chatimgs.raw]: ChatboxType } = {
	public: "main",
	private: "private",
	clan: "cc",
	guestclan: "gcc",
	friends: "fc",
	group: "gc",
	groupironman: "gimc",
	privateRecent: "private", // needs to be last to not mess with the buf
};
const trackerColors: readonly OCR.ColortTriplet[] = [
	[255, 255, 255],
	[127, 169, 255],
	[255, 0, 0],
	[0, 255, 0],
	[67, 188, 188],
	[245, 135, 55],
	[255, 128, 0],
	[235, 119, 3],
	[255, 165, 0],
	[245, 159, 1],
	[57, 182, 26],
	[60, 183, 30],
	[51, 197, 20],
	[59, 181, 20],
	[59, 181, 30],
	[59, 176, 30],
	[0, 255, 255],
	[127, 255, 255],
];

type TopRight = a1lib.PointLike & { type: "hidden" | "full" | "legacy" }
type BotLeft = a1lib.PointLike & { type: ChatboxType }
export type Chatbox = {
	rect: a1lib.Rect,
	timestamp: boolean,
	type: ChatboxType,
	leftfound: boolean,
	topright: TopRight,
	botleft: BotLeft,
	line0x: number,
	line0y: number
};
export type ChatLine = {
	text: string,
	fragments: OCR.TextFragment[],
	basey: number
};

export default class ChatBoxReader {
	//settings
	readargs = {
		colors: trackerColors.map(c => a1lib.mixColor(c[0], c[1], c[2]))
	};
	minoverlap = 2;
	diffRead = true;
	diffReadUseTimestamps = true;

	forwardnudges = defaultforwardnudges.slice();
	backwardnudges = defaultbackwardnudges.slice();

	//state
	pos: { mainbox: Chatbox, boxes: Chatbox[] } | null = null;
	overlaplines: ChatLine[] = [];
	lastTimestamp = -1;
	lastTimestampUpdate = 0;
	addedLastread = false;
	font: FontSetting | null = null;
	lastReadBuffer: ImgRefData | null = null;
	pendingMessage: string | null = null;
	pendingTimestamp: string | null = null;
	inMaterialContext = false;

	readChatLine(box: Chatbox, imgdata: ImageData, imgx: number, imgy: number, font: FontSetting, ocrcolors: OCR.ColortTriplet[], linenr: number): ChatLine {
		var liney = box.line0y - linenr * font.lineheight + font.dy;

		let ctx: ReadLineContext = {
			baseliney: liney + box.rect.y - imgy,
			colors: ocrcolors,
			font: font.def,
			forward: true,
			imgdata,
			leftx: box.line0x + box.rect.x - imgx,
			rightx: box.line0x + box.rect.x - imgx,
			text: "",
			fragments: [],
			addfrag(this: ReadLineContext, frag: OCR.TextFragment) {
				if (this.forward) {
					this.fragments.push(frag);
					this.text += frag.text;
					this.rightx = frag.xend;
				}
				else {
					this.fragments.unshift(frag);
					this.text = frag.text + this.text;
					this.leftx = frag.xstart;
				}
			}
		}

		if (!box.leftfound) {
			let col = OCR.getChatColor(imgdata, { x: ctx.rightx - 5, y: ctx.baseliney - 10, width: 10, height: 10 }, ocrcolors);
			if (!col) { return { text: "", fragments: [], basey: liney }; }
			let pos = OCR.findChar(imgdata, font.def, col, ctx.rightx - 5, ctx.baseliney, font.def.width, 1);
			if (!pos) { return { text: "", fragments: [], basey: liney }; }
			ctx.rightx = pos.x;
			ctx.leftx = pos.x;
		}

		for (let dirforward of [false, true]) {
			if (box.leftfound && !dirforward) { continue; }
			ctx.forward = dirforward;
			let nudges = (dirforward ? this.forwardnudges : this.backwardnudges);
			retryloop: while (true) {
				for (let nudge of nudges) {
					let m = ctx.text.match(nudge.match)
					if (m) {
						if (nudge.fn(ctx, m)) {
							continue retryloop;
						}
					}
				}
				break;
			}
		}

		ctx.fragments.forEach(f => { f.xstart += imgx; f.xend += imgx });
		if (!box.leftfound) {
			let found = false;
			let extraoffset = 0;
			//ignore lines with news in them since the preceeding news icon often doesn't match in backward reads
			if (ctx.text.match(/^(\[\w)/i) && ctx.text.indexOf("News") == -1) {
				found = true;
			}
			if (found) {
				let dx = ctx.fragments[0].xstart - box.rect.x - extraoffset;
				box.rect.x += dx;
				box.rect.width -= dx;
				box.leftfound = true;
				console.log("found box left because of chat contents", ctx.text);
			}
		}
		return { text: ctx.text, fragments: ctx.fragments, basey: ctx.baseliney + imgy };
	}

	read(img?: ImgRef | null) {
		if (!this.pos) { return null; }
		var box = this.pos.mainbox;
		var leftmargin = (box.leftfound ? 0 : 300);
		let imgx = box.rect.x - leftmargin;
		let imgy = box.rect.y;
		const rightEdge = img ? img.x + img.width : alt1.rsWidth;
		const rightPadding = Math.max(0, Math.min(
			Math.max(...fonts.map(font => font.def.width)),
			rightEdge - box.rect.x - box.rect.width,
		));
		const width = box.rect.width + leftmargin + rightPadding;
		let imgdata: ImageData;
		if (img) { imgdata = img.toData(imgx, imgy, width, box.rect.height); }
		else { imgdata = a1lib.capture(imgx, imgy, width, box.rect.height); }
		this.lastReadBuffer = new ImgRefData(imgdata, imgx, imgy);

		//add timestamp colors if needed
		//TODO
		if (true || box.timestamp) {
			var cols = [a1lib.mixColor(127, 169, 255), a1lib.mixColor(255, 255, 255)];
			for (var a in cols) {
				if (this.readargs.colors.indexOf(cols[a]) == -1) { this.readargs.colors.push(cols[a]); }
			}
		}

		var ocrcolors = this.readargs.colors.map(c => a1lib.unmixColor(c));

		if (!this.font) {
			for (let font of fonts) {
				let line1 = this.readChatLine(box, imgdata, imgx, imgy, font, ocrcolors, 0);
				let line2 = this.readChatLine(box, imgdata, imgx, imgy, font, ocrcolors, 1);
				let m = (line1.text + line2.text).match(/\w/g)
				if (m && m.length > 10) {
					this.font = font;
					break;
				}
			}
		}
		if (!this.font) {
			return null;
		}

		var readlines: ChatLine[] = [];
		var newlines: ChatLine[] = [];
		let hadtimestampless = false;
		for (var line = 0; true; line++) {
			var liney = box.line0y - line * this.font.lineheight + this.font.dy;
			if (liney - this.font.lineheight < 0) {
				newlines = readlines;
				break;
			}

			let newline = this.readChatLine(box, imgdata, imgx, imgy, this.font, ocrcolors, line);
			readlines.unshift(newline);

			//combine with previous reads
			if (this.diffRead) {
				let time = ChatBoxReader.getMessageTime(newline.text);
				if (this.diffReadUseTimestamps && !this.addedLastread && !hadtimestampless && time != -1 && this.lastTimestamp != -1) {
					//don't block messages in the same second as last update
					if (Date.now() > this.lastTimestampUpdate + 1000) {
						const maxtime = 24 * 60 * 60;
						let diff = time - this.lastTimestamp;
						//wrap around at 00:00:00
						if (diff < -maxtime / 2) { diff += maxtime; }
						//don't accept messages with older timestamp
						if (diff <= 0) {
							newlines = readlines.slice(1);
							break;
						}
					}
				} else {
					//can not use timestamps if there is a msg without timestamp in the same batch
					hadtimestampless = true;
				}
				if (readlines.length >= this.overlaplines.length && this.overlaplines.length >= this.minoverlap) {
					var matched = true;
					for (let a = 0; a < this.overlaplines.length; a++) {
						if (!this.matchLines(this.overlaplines[a].text, readlines[a].text)) { matched = false; break; }
					}
					if (matched) {
						newlines = readlines.slice(this.overlaplines.length, readlines.length);
						break;
					}
				}
			}
		}
		//update the last message timestamp
		this.addedLastread = newlines.length != 0;
		for (let a = newlines.length - 1; a >= 0; a--) {
			let time = ChatBoxReader.getMessageTime(newlines[a].text);
			if (time != -1) {
				this.lastTimestamp = time;
				this.lastTimestampUpdate = Date.now();
				break;
			}
		}
		//add new lines
		this.overlaplines = this.overlaplines.concat(newlines);
		if (this.overlaplines.length > this.minoverlap) { this.overlaplines.splice(0, this.overlaplines.length - this.minoverlap); }

		//console.log("Read chat attempt time: " + (Date.now() - t));
		//for (let a = 0; a < newlines.length; a++) { console.log(newlines[a]); }
		return newlines;
	}

	readTracker() {
		const lines = this.read() ?? [];
		if (lines.length === 0) {
			if (!isUnfinishedMaterialMessage(this.pendingMessage)) {
				const messages = this.pendingMessage ? [{ text: this.pendingMessage }] : [];
				this.pendingMessage = null;
				this.pendingTimestamp = null;
				this.inMaterialContext = false;
				return messages;
			}
			return [];
		}

		const result = groupLines(lines.map(line => this.enhanceTrackerLine(line)), {
			pendingMessage: this.pendingMessage,
			pendingTimestamp: this.pendingTimestamp,
		});
		this.pendingMessage = result.pendingMessage;
		this.pendingTimestamp = result.pendingTimestamp;
		return result.messages.map(text => ({ text }));
	}

	private enhanceTrackerLine(line: ChatLine): ChatLine {
		const body = stripTimestamp(line.text);
		const startsMaterialMessage = isMaterialsGainedMessage(body);
		if (hasTimestamp(line.text)) { this.inMaterialContext = startsMaterialMessage; }
		else if (startsMaterialMessage) { this.inMaterialContext = true; }

		const inMaterialContext = startsMaterialMessage || this.inMaterialContext;
		if (!inMaterialContext || !hasIncompleteMaterialEntry(line.text)) { return line; }

		const supplemental = this.rereadTrackerLine(line);
		if (!supplemental) { return line; }
		const primaryEntries = countCompleteMaterialEntries(line.text);
		const supplementalEntries = countCompleteMaterialEntries(supplemental.text);
		return supplementalEntries > primaryEntries || (
			supplementalEntries === primaryEntries &&
			isKnownMaterialContinuation(supplemental.text) &&
			!isKnownMaterialContinuation(line.text)
		) ? supplemental : line;
	}

	private rereadTrackerLine(line: ChatLine): ChatLine | null {
		const box = this.pos?.mainbox;
		const font = this.font;
		const buffer = this.lastReadBuffer;
		if (!box || !font || !buffer) { return null; }
		const lineNr = Math.round((box.line0y + box.rect.y + font.dy - line.basey) / font.lineheight);
		return this.readChatLine(
			box,
			buffer.buf,
			buffer.x,
			buffer.y,
			font,
			this.readargs.colors.map(a1lib.unmixColor),
			lineNr,
		);
	}

	resetTrackerState() {
		this.pendingMessage = null;
		this.pendingTimestamp = null;
		this.inMaterialContext = false;
	}

	//convert some similar characters to prevent problems when a character is slightly misread
	simplifyLine(str: string) {
		str = str.replace(/[\[\]\.\':;,_ ]/g, "");
		str = str.replace(/[|!lIji]/g, "l");
		return str;
	}

	matchLines(line1: string, line2: string) {
		return this.simplifyLine(line1) == this.simplifyLine(line2);
	}

	find(imgornull?: ImgRef) {
		if (!imgornull) { imgornull = a1lib.captureHoldFullRs(); }
		if (!imgornull) { return null; }
		var img = imgornull;
		var toprights: TopRight[] = [];

		img.findSubimage(imgs.plusbutton).forEach(loc => toprights.push({ x: loc.x + 5, y: loc.y + 21, type: "hidden" }));
		img.findSubimage(imgs.filterbutton).forEach(loc => toprights.push({ x: loc.x + 19, y: loc.y + 19, type: "hidden" }));
		img.findSubimage(imgs.minusbutton).forEach(loc => toprights.push({ x: loc.x + 5, y: loc.y + 21, type: "full" }));

		var botlefts: BotLeft[] = [];
		img.findSubimage(imgs.chatbubble).forEach(loc => {
			//107,2 press enter to chat
			//102,2 click here to chat
			// biggest chat size is 83 + 4 pixels
			var data = img.toData(loc.x + 19, loc.y, 87 + (107 - 102), 12);
			var matched = false;
			for (const chat of Object.keys(chatimgs.raw) as Array<keyof typeof chatimgs.raw>) {
				let cimg = chatimgs.raw[chat];

				if (data.pixelCompare(cimg, 0, 1) != Infinity || data.pixelCompare(cimg, (107 - 102), 1) != Infinity) {
					botlefts.push({ x: loc.x, y: loc.y - 1, type: chatmap[chat] });
					matched = true;
				}
				//i don't even know anymore some times the bubble is 1px higher (i think it might be java related)
				else if (data.pixelCompare(cimg, 0, 0) != Infinity || data.pixelCompare(cimg, (107 - 102), 0) != Infinity) {
					loc.y -= 1;
					botlefts.push({ x: loc.x, y: loc.y, type: chatmap[chat] });
					matched = true;
				}
			}
			//active chat
			if (!matched) {
				var pixel = img.toData(loc.x, loc.y - 5, 1, 1);
				var pixel2 = img.toData(loc.x, loc.y - 4, 1, 1);
				if (pixel.data[0] == 255 && pixel.data[1] == 255 && pixel.data[2] == 255) {
					loc.y -= 1;
					botlefts.push({ x: loc.x, y: loc.y, type: "unknown" });
				}
				//the weird offset again
				else if (pixel2.data[0] == 255 && pixel2.data[1] == 255 && pixel2.data[2] == 255) {
					loc.y -= 2;
					botlefts.push({ x: loc.x, y: loc.y, type: "unknown" });
				}
				else {
					//console.log("unlinked quickchat bubble " + JSON.stringify(loc));
				}
			}
		});
		img.findSubimage(imgs.chatLegacyBorder).forEach(loc => {
			botlefts.push({ x: loc.x, y: loc.y - 1, type: "main" });
		});
		// previously activated private chat showing "To"
		img.findSubimage(chatimgs.privateRecent).forEach(loc => {
			botlefts.push({ x: loc.x, y: loc.y - 1, type: "private" });
		});

		//check if we're in full-on legacy
		if (botlefts.length == 1 && toprights.length == 0) {
			//cheat in a topright without knowing it's actual height
			var pos = img.findSubimage(imgs.legacyreport);
			if (pos.length == 1) { toprights.push({ x: pos[0].x + 32, y: pos[0].y - 170, type: "legacy" }); }
		}

		var groups: Chatbox[] = [];
		var groupcorners = function () {
			var done = true;
			for (var a in toprights) {
				if (groups.find(q => q.topright == toprights[a])) { continue; }
				done = false;
				for (var b in botlefts) {
					if (groups.find(q => q.botleft == botlefts[b])) { continue; }
					var group: Chatbox = {
						timestamp: false,
						type: "main",
						leftfound: false,
						topright: toprights[a],
						botleft: botlefts[b],
						rect: new a1lib.Rect(botlefts[b].x, toprights[a].y, toprights[a].x - botlefts[b].x, botlefts[b].y - toprights[a].y),
						line0x: 0,
						line0y: 0
					};
					if (groups.find(q => q.rect.overlaps(group.rect))) { continue; }
					groups[groups.length] = group;
					if (groupcorners()) { return true; }
					groups.splice(groups.length - 1, 1);
				}
			}
			return done;
		}

		if (!groupcorners()) { return null; }
		var mainbox: Chatbox | null = null;
		groups.forEach(group => {
			group.type = group.botleft.type;

			if (!group.leftfound && group.topright.type == "full") {
				var pos: a1lib.PointLike[] = [];
				if (pos.length == 0) { pos = img.findSubimage(imgs.gameall, Math.max(0, group.rect.x - 300), group.rect.y - 22, 310, 16); }
				if (pos.length == 0) { pos = img.findSubimage(imgs.gamefilter, Math.max(0, group.rect.x - 300), group.rect.y - 22, 310, 16); }
				if (pos.length == 0) { pos = img.findSubimage(imgs.gameoff, Math.max(0, group.rect.x - 300), group.rect.y - 22, 310, 16); }
				if (pos.length != 0) {
					group.leftfound = true;
					var d = group.rect.x - pos[0].x + 2;
					group.rect.x -= d;
					group.rect.width += d;
				}
			}
			//alt1.overLayRect(a1lib.mixcolor(255, 255, 255), group.rect.x, group.rect.y, group.rect.width, group.rect.height, 10000, 2);
			//alt1.overLayTextEx(group.type, a1lib.mixcolor(255, 255, 255), 20, group.rect.x + group.rect.width / 2 | 0, group.rect.y + group.rect.height / 2 | 0, 10000, "", true, true);

			group.line0x = 0;
			group.line0y = group.rect.height - 12;// 16;//15;//12;//- 15;//-11//- 9;//-10 before mobile interface update

			if (group.leftfound) { group.timestamp = this.checkTimestamp(img, group); }
			if (mainbox == null || group.type == "main") { mainbox = group; }
		});

		if (groups.length == 0 || !mainbox) { return null; }

		var res = {
			mainbox: mainbox,
			boxes: groups
		};
		this.pos = res;
		return res;
	}

	checkTimestamp(img: ImgRef, pos: Chatbox) {
		//TODO replace this
		return false;
	}

	static getMessageTime(str: string) {
		let m = str.match(/^\[(\d{2}):(\d{2}):(\d{2})\]/);
		if (!m) { return -1; }
		return (+m[1]) * 60 * 60 + (+m[2]) * 60 + (+m[3]);
	}

}


type ReadLineContext = {
	addfrag: (frag: OCR.TextFragment) => void,
	leftx: number,
	rightx: number,
	baseliney: number,
	imgdata: ImageData,
	font: OCR.FontDefinition,
	colors: [number, number, number][]
	text: string,
	fragments: OCR.TextFragment[],
	forward: boolean
}


type ReadLineNudge = {
	name: string,
	match: RegExp,
	fn: (ctx: ReadLineContext, match: RegExpMatchArray) => boolean | undefined
};

function findNextChar(ctx: ReadLineContext, startx: number) {
	const endx = Math.min(
		ctx.imgdata.width - ctx.font.width,
		startx + ctx.font.width + ctx.font.spacewidth,
	);
	for (let x = startx; x < endx; x++) {
		let best: OCR.ReadCharInfo | null = null;
		let color: OCR.ColortTriplet | null = null;
		for (const option of ctx.colors) {
			const found = OCR.readChar(ctx.imgdata, ctx.font, option, x, ctx.baseliney, false, true);
			// Weak secondary-glyph matches can appear in the gap before a colored number.
			if (
				found &&
				(!found.basechar.secondary || found.sizescore < 50) &&
				(!best || found.sizescore < best.sizescore)
			) {
				best = found;
				color = option;
			}
		}
		if (best && color) { return { color, x, char: best }; }
	}
	return null;
}

function readNext(ctx: ReadLineContext) {
	const startx = ctx.rightx;
	const next = findNextChar(ctx, startx);
	if (!next) { return false; }
	if (ctx.text && next.x - startx >= ctx.font.spacewidth) {
		ctx.addfrag({ color: next.color, index: -1, text: " ", xstart: startx, xend: next.x });
	}
	return addTrackerRead(ctx, OCR.readLine(
		ctx.imgdata,
		ctx.font,
		next.color,
		next.x,
		ctx.baseliney,
		true,
		false,
	));
}

function addTrackerRead(ctx: ReadLineContext, data: ReturnType<typeof OCR.readLine>) {
	if (!data.text) { return false; }
	data.fragments.forEach(fragment => ctx.addfrag(fragment));

	for (let attempts = 0; attempts < 16; attempts++) {
		const startx = ctx.rightx;
		const next = findNextChar(ctx, startx);
		if (!next) { break; }
		if (next.x - startx >= ctx.font.spacewidth) {
			ctx.addfrag({ color: next.color, index: -1, text: " ", xstart: startx, xend: next.x });
		}
		const continuation = OCR.readLine(
			ctx.imgdata,
			ctx.font,
			next.color,
			next.x,
			ctx.baseliney,
			true,
			false,
		);
		if (!continuation.text && next.char.basechar.secondary && /[,.;:!?)]/.test(next.char.chr)) {
			ctx.addfrag({
				color: next.color,
				index: -1,
				text: next.char.chr,
				xstart: next.x,
				xend: next.x + next.char.basechar.width,
			});
			continue;
		}
		if (!continuation.text || continuation.fragments.every(fragment => fragment.xend <= startx)) {
			break;
		}
		continuation.fragments.forEach(fragment => ctx.addfrag(fragment));
	}
	return true;
}

let defaultforwardnudges: ReadLineNudge[] = [
	{
		//fix for "[" first char
		match: /^$/,
		name: "timestampopen",
		fn: (ctx) => {
			let timestampopen = OCR.readChar(ctx.imgdata, ctx.font, [255, 255, 255], ctx.rightx, ctx.baseliney, false, false);
			if (timestampopen?.chr == "[") {
				ctx.addfrag({ color: [255, 255, 255], index: -1, text: "[", xstart: ctx.rightx, xend: ctx.rightx + timestampopen.basechar.width });
				return true;
			}
		}
	},
	{
		match: /.*/,
		name: "body",
		fn: readNext
	},
	{
		match: /\[[\w: ]+$/,
		name: "timestampclose",
		fn: ctx => {
			let closebracket = OCR.readChar(ctx.imgdata, ctx.font, [255, 255, 255], ctx.rightx, ctx.baseliney, false, false);
			if (closebracket?.chr == "]") {
				ctx.addfrag({ color: [255, 255, 255], text: "] ", index: -1, xstart: ctx.rightx, xend: ctx.rightx + closebracket.basechar.width + ctx.font.spacewidth });
				return true;
			}
		}
	},
	{
		match: /(^|\]|:)( ?)$/i,
		name: "startline",
		fn: (ctx, match) => {
			let addspace = !match[2];
			let x = ctx.rightx + (addspace ? ctx.font.spacewidth : 0);
			let best: OCR.ReadCharInfo | null = null;
			let bestcolor: OCR.ColortTriplet | null = null;
			for (let col of ctx.colors) {
				let chr = OCR.readChar(ctx.imgdata, ctx.font, col, x, ctx.baseliney, false, false);
				if (chr && (!best || chr.sizescore < best.sizescore)) {
					best = chr;
					bestcolor = col;
				}
			}
			if (bestcolor) {
				var data = OCR.readLine(ctx.imgdata, ctx.font, bestcolor, x, ctx.baseliney, true, false);
				if (data.text) {
					if (addspace) { ctx.addfrag({ color: [255, 255, 255], index: -1, text: " ", xstart: ctx.rightx, xend: x }); }
					return addTrackerRead(ctx, data);
				}
			}
		}
	},
	{
		match: /\w$/,
		name: "whitecolon",
		fn: ctx => {
			let startx = ctx.rightx;
			let colonchar = OCR.readChar(ctx.imgdata, ctx.font, [255, 255, 255], startx, ctx.baseliney, false, true);
			if (colonchar?.chr == ":") {
				ctx.addfrag({ color: [255, 255, 255], index: -1, text: ": ", xstart: startx, xend: startx + colonchar.basechar.width + ctx.font.spacewidth });
				return true;
			}
		}
	}
];

let defaultbackwardnudges: ReadLineNudge[] = [
	{
		match: /.*/,
		name: "body",
		fn: ctx => {
			var data = OCR.readLine(ctx.imgdata, ctx.font, ctx.colors, ctx.leftx, ctx.baseliney, false, true);
			if (data.text) {
				data.fragments.reverse().forEach(f => ctx.addfrag(f));
				return true;
			}
		}
	},
	{
		match: /^\w/,
		name: "whitecolon",
		fn: ctx => {
			let startx = ctx.leftx - ctx.font.spacewidth;
			let colonchar = OCR.readChar(ctx.imgdata, ctx.font, [255, 255, 255], startx, ctx.baseliney, false, true);
			if (colonchar?.chr == ":") {
				startx -= colonchar.basechar.width;
				ctx.addfrag({ color: [255, 255, 255], index: -1, text: ": ", xstart: startx, xend: startx + colonchar.basechar.width + ctx.font.spacewidth });
				return true;
			}
		}
	}
];

type GroupState = {
	pendingMessage: string | null;
	pendingTimestamp: string | null;
};

function groupLines(lines: readonly ChatLine[], state: GroupState) {
	const messages: string[] = [];
	let { pendingMessage, pendingTimestamp } = state;
	const flush = () => {
		if (pendingMessage) { messages.push(pendingMessage); }
		pendingMessage = null;
		pendingTimestamp = null;
	};

	for (const line of lines) {
		const text = normalizeWhitespace(line.text);
		if (!text) { continue; }
		const timestamp = getTimestamp(text);
		if (timestamp) {
			if (
				timestamp === pendingTimestamp &&
				isUnfinishedMaterialMessage(pendingMessage) &&
				isSameRepaint(pendingMessage!, text)
			) {
				pendingMessage = text;
			} else if (
				timestamp === pendingTimestamp &&
				(isSpiritHeader(pendingMessage) || isMaterialMessage(pendingMessage)) &&
				isQuantity(stripTimestamp(text))
			) {
				pendingMessage = joinContinuation(pendingMessage!, text);
			} else {
				flush();
				if (stripTimestamp(text)) {
					pendingMessage = text;
					pendingTimestamp = timestamp;
				}
			}
		} else if (pendingMessage && canJoinContinuation(pendingMessage)) {
			pendingMessage = joinContinuation(pendingMessage, text);
		} else {
			flush();
			messages.push(text);
		}
	}

	return { messages, pendingMessage, pendingTimestamp };
}

const timestampPattern = /^\[\s*(\d{2})\s*:\s*(\d{2})\s*:\s*(\d{2})\s*\]\s*/;

function hasTimestamp(text: string) {
	return timestampPattern.test(text);
}

function getTimestamp(text: string) {
	const match = text.match(timestampPattern);
	return match ? `[${match[1]}:${match[2]}:${match[3]}]` : null;
}

function stripTimestamp(text: string) {
	return text.replace(timestampPattern, "").trim();
}

function normalizeWhitespace(text: string) {
	return text
		.replace(timestampPattern, (_match, hour, minute, second) => `[${hour}:${minute}:${second}] `)
		.replace(/\s+/g, " ")
		.trim();
}

function isUnfinishedMaterialMessage(text: string | null) {
	if (!text) { return false; }
	const body = stripTimestamp(text);
	return isMaterialsGainedMessage(body) && (/\s*,\s*(?:[1-9]\d*)?\s*$/.test(body) || /\b[1-9]\d*\s*x\s*$/i.test(body));
}

function isMaterialMessage(text: string | null) {
	return text !== null && isMaterialsGainedMessage(stripTimestamp(text));
}

function isSpiritHeader(text: string | null) {
	return text !== null && isSpiritRewardMessage(stripTimestamp(text)) && /:\s*$/.test(stripTimestamp(text));
}

function isQuantity(text: string) {
	return /^[1-9][\d,]*\s*x\s+\S/i.test(normalizeWhitespace(stripTimestamp(text)));
}

function canJoinContinuation(message: string) {
	const body = stripTimestamp(message);
	return !(couldStartSkillMessage(body) && /[.!?]\s*$/.test(body));
}

function joinContinuation(message: string, continuationText: string) {
	const base = normalizeWhitespace(message);
	const continuation = normalizeWhitespace(stripTimestamp(continuationText));
	if (!continuation) { return base; }
	let separator = /^[,.;:!?)]/.test(continuation) ? "" : " ";
	if (
		isMaterialsGainedMessage(stripTimestamp(base)) &&
		/\b(?:parts|components)$/i.test(stripTimestamp(base)) &&
		/^[1-9]\d*\s*x\b/i.test(continuation)
	) {
		separator = ", ";
	} else if (isSpiritRewardMessage(stripTimestamp(base)) && isQuantity(continuation)) {
		separator = ", ";
	}
	return normalizeWhitespace(`${base}${separator}${continuation}`);
}

function isSameRepaint(previous: string, current: string) {
	const prior = normalizeWhitespace(previous);
	const next = normalizeWhitespace(current);
	return prior === next || next.startsWith(prior);
}

function hasIncompleteMaterialEntry(text: string) {
	const body = stripTimestamp(text);
	if (/^Materials gained:\s*$/i.test(body)) { return true; }
	const materialText = getMaterialsPayload(body) ?? body;
	const entries = materialText.split(",").map(entry => entry.trim()).filter(Boolean);
	return entries.length === 0 || entries.some(entry => !isExplicitMaterialEntry(entry));
}

function countCompleteMaterialEntries(text: string) {
	const materialText = getMaterialsPayload(stripTimestamp(text)) ?? "";
	return materialText
		.split(",")
		.map(entry => entry.trim())
		.filter(Boolean)
		.filter(isExplicitMaterialEntry)
		.length;
}

function isKnownMaterialContinuation(text: string) {
	const body = stripTimestamp(text);
	if (/^Junk[,.]?\s*$/i.test(body)) { return true; }
	const match = body.match(/^([a-z]+(?:-[a-z]+)?)\s+(parts|components)[,.]?\s*$/i);
	return match !== null && isKnownMaterial(match[1], match[2].toLowerCase() as MaterialSuffix);
}
