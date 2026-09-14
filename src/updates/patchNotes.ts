import { allReleaseNotes } from "./updateNotes";

export function showPatchNotes(targetDocument?: Document) {
	if (typeof window === "undefined" || typeof document === "undefined") return;
	const modalDocument = targetDocument || document;

	const existing = modalDocument.getElementById("rt-patch-notes-modal");
	if (existing) {
		existing.removeAttribute("hidden");
		existing.querySelector<HTMLElement>("button")?.focus();
		return;
	}

	const modal = modalDocument.createElement("section");
	modal.id = "rt-patch-notes-modal";
	modal.className = "patch-notes-modal";
	modal.setAttribute("role", "dialog");
	modal.setAttribute("aria-modal", "true");
	modal.setAttribute("aria-label", "Patch Notes");

	const header = modalDocument.createElement("div");
	header.className = "patch-notes-header";

	const title = modalDocument.createElement("strong");
	title.textContent = "Patch Notes";

	const close = modalDocument.createElement("button");
	close.className = "patch-notes-close";
	close.type = "button";
	close.title = "Close patch notes";
	close.setAttribute("aria-label", "Close patch notes");
	close.textContent = "X";

	header.append(title, close);

	const content = modalDocument.createElement("div");
	content.className = "patch-notes-content";

	for (const note of allReleaseNotes()) {
		const entry = modalDocument.createElement("section");
		entry.className = "patch-notes-entry";

		const version = modalDocument.createElement("div");
		version.className = "patch-notes-version";
		version.textContent = `Version: ${note.version}`;
		entry.appendChild(version);

		if (note.title) {
			const entryTitle = modalDocument.createElement("div");
			entryTitle.className = "patch-notes-entry-title";
			entryTitle.textContent = note.title;
			entry.appendChild(entryTitle);
		}

		const list = modalDocument.createElement("ul");
		list.className = "patch-notes-list";

		for (const itemText of note.items) {
			const item = modalDocument.createElement("li");
			item.textContent = itemText;
			list.appendChild(item);
		}

		entry.appendChild(list);
		content.appendChild(entry);
	}

	function dismiss() {
		modal.setAttribute("hidden", "");
	}

	close.addEventListener("click", dismiss);

	modal.append(header, content);
	modalDocument.body.appendChild(modal);
	close.focus();
}
