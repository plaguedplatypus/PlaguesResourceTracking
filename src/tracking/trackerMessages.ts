export type SpiritRewardSource = "seren-spirit" | "Forge/Fire Spirit";

export type SpiritRewardHeader = {
  pattern: RegExp;
  prefix: RegExp;
  source: SpiritRewardSource;
  label: string;
};

export const materialsGainedHeaderPattern = /^Materials gained:\s*/i;
export const bareMaterialsGainedHeaderPattern = /^Materials gained:\s*$/i;

export const spiritRewardHeaders: readonly SpiritRewardHeader[] = [
  {
    pattern: /^The Seren spirit gifts you:\s*(.+)$/i,
    prefix: /^The Seren spirit gifts you:/i,
    source: "seren-spirit",
    label: "Seren Spirit",
  },
  {
    pattern: /^The forge phoenix gifts you:\s*(.+)$/i,
    prefix: /^The forge phoenix gifts you:/i,
    source: "Forge/Fire Spirit",
    label: "Forge/Fire Spirit",
  },
  {
    pattern: /^The fire spirit gifts you:\s*(.+)$/i,
    prefix: /^The fire spirit gifts you:/i,
    source: "Forge/Fire Spirit",
    label: "Forge/Fire Spirit",
  },
];

export function isMaterialsGainedMessage(text: string): boolean {
  return materialsGainedHeaderPattern.test(text.trim());
}

/** Returns the material payload when a line is a Materials gained message. */
export function getMaterialsGainedPayload(text: string): string | null {
  const match = text.trim().match(/^Materials gained:\s*(.*)$/i);
  return match ? match[1].trim() : null;
}

export function isSpiritRewardMessage(text: string): boolean {
  return spiritRewardHeaders.some(({ prefix }) => prefix.test(text.trim()));
}

export function isIgnoredTrackerMessage(text: string): boolean {
  const cleanLine = text.trim();
  return ignoredMessages.some((pattern) => pattern.test(cleanLine));
}

export function couldStartSkillTrackerMessage(text: string): boolean {
  const cleanLine = text.trim();
  if (isIgnoredTrackerMessage(cleanLine)) return false;

  return (
    /^You (?:get|catch|find)\b/i.test(cleanLine) ||
    /^Your (?:Boon of Crondis|Boon of Cronos|Farming skillcape perk|Fortune|imp-souled)\b/i.test(cleanLine) ||
    /^The (?:Seren spirit|forge phoenix|fire spirit) gifts you:/i.test(
      cleanLine,
    ) ||
    /(?:^You transport|sent it|transports your items|Your League relic transports the following item) to your\b/i.test(
      cleanLine,
    )
  );
}

export const ignoredMessages: readonly RegExp[] = [
  /^You find some valuables and stuff them into your bag\.?$/i,
];