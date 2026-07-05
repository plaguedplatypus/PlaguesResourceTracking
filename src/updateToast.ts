import { RT_UPDATE_ID, RT_UPDATE_NOTES, RT_UPDATE_TITLE } from "./updateNotes";

const UPDATE_TOAST_SEEN_KEY = "RT-update-toast-seen-id";

function getSeenReleaseId() {
	try {
		return window.localStorage.getItem(UPDATE_TOAST_SEEN_KEY);
	} catch {
		return null;
	}
}

function markReleaseSeen() {
	try {
		window.localStorage.setItem(UPDATE_TOAST_SEEN_KEY, RT_UPDATE_ID);
	} catch {
		
	}
}

export function maybeShowUpdateToast() {
	if (typeof window === "undefined" || typeof document === "undefined") return;
	if (!RT_UPDATE_ID || !RT_UPDATE_NOTES.length) return;
	if (getSeenReleaseId() === RT_UPDATE_ID) return;

	const existingToast = document.querySelector(".update-toast");
	if (existingToast) existingToast.remove();

	const toast = document.createElement("div");
	toast.className = "update-toast";

	const title = document.createElement("div");
	title.className = "update-toast-title";
	title.textContent = RT_UPDATE_TITLE;

	const list = document.createElement("ul");
	list.className = "update-toast-list";

	for (const note of RT_UPDATE_NOTES) {
		const item = document.createElement("li");
		item.textContent = note;
		list.appendChild(item);
	}

	const close = document.createElement("button");
	close.className = "update-toast-close";
	close.type = "button";
	close.textContent = "Got it";

	function dismiss() {
		markReleaseSeen();
		toast.remove();
	}

	close.addEventListener("click", dismiss);

	toast.append(title, list, close);
	document.body.appendChild(toast);
}
