type Message = {
  text: string;
};

type Dependencies = {
  hasProcessed: (message: string) => boolean;
  processMessage: (message: string) => boolean;
  rememberProcessed: (message: string) => void;
  addHistory: (message: string) => void;
  commitChanges: () => void;
};

export function processChatPollMessages(
  messages: readonly Message[],
  dependencies: Dependencies,
): void {
  try {
    for (const { text: chatLine } of messages) {
      const historyKey = chatLine.trim();
      if (!historyKey) continue;

      if (dependencies.hasProcessed(historyKey)) continue;

      const tracked = dependencies.processMessage(chatLine);
      dependencies.rememberProcessed(historyKey);
      if (!tracked) continue;
      dependencies.addHistory(historyKey);
    }
  } finally {
    dependencies.commitChanges();
  }
}
