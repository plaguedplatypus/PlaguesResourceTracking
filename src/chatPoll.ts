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

export function processMessages(
  messages: readonly Message[],
  dependencies: Dependencies,
): void {
  try {
    for (const { text: chatLine } of messages) {
      const message = chatLine.trim();
      if (!message) continue;

      if (dependencies.hasProcessed(message)) continue;

      const tracked = dependencies.processMessage(chatLine);
      dependencies.rememberProcessed(message);
      if (!tracked) continue;
      dependencies.addHistory(message);
    }
  } finally {
    dependencies.commitChanges();
  }
}
