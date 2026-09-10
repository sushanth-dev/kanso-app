/**
 * The slice of the chrome.* surface the extension uses, declared by hand so
 * the package needs no @types/chrome devDependency. Anything not used here is
 * not used by the extension.
 */
declare namespace chrome {
  namespace storage {
    interface SyncArea {
      get(keys: string[] | string | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    }
  }
  namespace runtime {
    const onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: unknown,
          sendResponse: (response?: unknown) => void,
        ) => boolean | void,
      ): void;
    };
    const sendMessage: (message: unknown) => Promise<unknown>;
    const onInstalled: {
      addListener(listener: () => void): void;
    };
  }
  const storage: { sync: storage.SyncArea };
  const runtime: {
    onMessage: runtime['onMessage'];
    sendMessage: typeof runtime.sendMessage;
    onInstalled: runtime['onInstalled'];
  };
}
