type Message = {
  text: string;
};

type Dependencies = {
  hasProcessed: (message: string) => boolean;
  processMessage: (message: string) => void;
  rememberProcessed: (message: string) => void;
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

      dependencies.processMessage(chatLine);
      dependencies.rememberProcessed(message);
    }
  } finally {
    dependencies.commitChanges();
  }
}
