export function normalizeInventionMessage(text: string): string {
	return text
		.replace(/\s+/g, " ")
		.replace(/\s+,/g, ",")
		.trim();
}
