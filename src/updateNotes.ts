export type ReleaseNote = {
	version: string;
	title?: string;
	items: string[];
};

//export const RT_DISCORD_INVITE_URL = "";

export const RT_RELEASE_HISTORY: ReleaseNote[] = [
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
		title: "Dissasembling Fix",
		items: [
			"Fixed tracking dissasembled components that appear on a new line.",
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
	return RT_RELEASE_HISTORY[0] || null;
}

export function allReleaseNotes(): ReleaseNote[] {
	return RT_RELEASE_HISTORY;
}

const latest = latestReleaseNote();

export const RT_VERSION = latest?.version || "v0.0.0";
export const RT_UPDATE_ID = RT_VERSION;
export const RT_UPDATE_TITLE = latest ? `Update ${latest.version}` : "Update";
export const RT_UPDATE_NOTES = latest?.items || [];
