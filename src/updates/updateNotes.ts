type ReleaseNote = {
	version: string;
	title?: string;
	items: string[];
};

const releaseHistory: ReleaseNote[] = [
	{
		version: "v1.12",
		title: "Divination/Hunter",
		items: [
			"Can now edit counts by selecting an item and clicking the edit icon next to the counts.",
			"Added Divination category. Fully manual tracking.",
			"Added Hunter category. Fully manual tracking.",
		],
	},
	{
		version: "v1.11",
		title: "Runescape UI Update",
		items: [
			"Fixed dialog reader not capturing after latest Runescape UI update.",
		],
	},
	{
		version: "v1.10",
		title: "The Tracker Update",
		items: [
			"Farming Tracking is here, toggle it in the settings.",
			"Can now Toggle Tracked Skills and Events ON/OFF in the settings.",
			"Can now reset counts per tab without clearing the tracker.",
			"There is now a confirmation when clearing the Tracker. (no more misclicks)",
			"Added a Dig Site filter to Archaeology.",
			"Added a [+] button to Invention Tracker to add components.",
		],
	},
	{
		version: "v1.9.1",
		title: "Minor Update",
		items: [
			"Minor update: Added Leagues relics to the tracker.",
		],
	},
	{
		version: "v1.9",
		title: "UI Updates",
		items: [
			"Updated the tracker UI.",
			"Added a setting for scaling the tracker rows.",
			"Added a setting to change the position of item counts- left or right.",
			"Added a setting to toggle off/on the All-Tab item icons.",
		],
	},
	{
		version: "v1.8",
		title: "Compact Components",
		items: [
			"Added option to shorten Invention component/part names.",
			"Improved compact tracker spacing and item-name readability.",
			"Removed the app's minimum width and height limits for more flexible resizing.",
		],
	},
	{
		version: "v1.7",
		title: "Forged in fire",
		items: [
			"Added tracking for Forge Phoenix/Fire Spirits, they will appear in the Spirits tab.",
			"Added tracking for Auto Disassembler messages.",
			"Added Session Button on main Tracker window.",
			"Added Mini-Settings Button in compact mode.",
			"Moved the Fishing 'Sign of the Porter' toggle to the settings menu.",
			"Notes:",
			"Resource Tracker currently only supports chat sizes 10pt-16pt.",
		],
	},
	{
		version: "v1.6-2",
		title: "Component Wrapping",
		items: [
			"Fixed some wrapped line issues for components/parts.",
			"'E' components should still be captured when split between lines.",
			"Junk will now appear in 'Common Components'.",
			"Select 'Find Chat' in settings after changing font sizes.",
		],
	},
	{
		version: "v1.6",
		title: "Component Font Size",
		items: [
			"Fixed some components not being seen at different font sizes.",
			"Select 'Find Chat' in settings after changing font sizes.",
		],
	},
	{
		version: "v1.5",
		title: "Disassembling Fix",
		items: [
			"Fixed tracking disassembled components that appear on a new line.",
		],
	},
	{
		version: "v1.4",
		title: "Damaged Artefact tracking",
		items: [
			"Damaged Artefact tracking is now more robust.",
		],
	},
	{
		version: "v1.3",
		title: "Compact mode",
		items: [
			"Added a compact mode for the tracking window.",
		],
	},
	{
		version: "v1.2",
		title: "Damaged Artefact tracking",
		items: [
			"Now tracking damaged artefact dialog boxes.",
		],
	},
	{
		version: "v1.1",
		title: "Invention update",
		items: [
			"Now tracking invention components.",
		],
	},
	{
		version: "v1.0",
		title: "Initial Release",
		items: [
			"Initial release.",
		],
	},
];

export function latestReleaseNote(): ReleaseNote | null {
	return releaseHistory[0] || null;
}

export function allReleaseNotes(): ReleaseNote[] {
	return releaseHistory;
}

const latest = latestReleaseNote();

export const trackerVersion = latest?.version || "v0.0.0";
