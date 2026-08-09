type ChatPollMessage = {
  text: string;
};

type ChatPollDependencies = {
  hasProcessedMessage: (message: string) => boolean;
  processMessage: (message: string) => boolean;
  rememberProcessedMessage: (message: string) => void;
  addTrackedHistory: (message: string) => void;
  commitMainChanges: () => void;
};

export function processChatPollMessages(
  messages: readonly ChatPollMessage[],
  dependencies: ChatPollDependencies,
): void {
  try {
    for (const { text: chatLine } of messages) {
      const historyKey = chatLine.trim();
      if (!historyKey) continue;

      if (dependencies.hasProcessedMessage(historyKey)) continue;

      const tracked = dependencies.processMessage(chatLine);
      dependencies.rememberProcessedMessage(historyKey);
      if (!tracked) continue;
      dependencies.addTrackedHistory(historyKey);
    }
  } finally {
    dependencies.commitMainChanges();
  }
}
