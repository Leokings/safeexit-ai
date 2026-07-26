export {};

declare global {
  const chrome: {
    runtime: {
      id: string;
      getManifest(): {
        version: string;
      };
      sendMessage<T = unknown>(message: unknown): Promise<T>;
      onMessage: {
        addListener(
          listener: (
            message: unknown,
            sender: {
              id?: string;
              url?: string;
              tab?: {
                id?: number;
                url?: string;
                windowId?: number;
              };
            },
            sendResponse: (response: unknown) => void,
          ) => boolean | void,
        ): void;
      };
    };
    storage: {
      session: {
        get(key: string): Promise<Record<string, unknown>>;
        set(items: Record<string, unknown>): Promise<void>;
        remove(key: string): Promise<void>;
        setAccessLevel(options: {
          accessLevel: "TRUSTED_CONTEXTS";
        }): Promise<void>;
      };
    };
    tabs: {
      sendMessage<T = unknown>(tabId: number, message: unknown): Promise<T>;
    };
    action: {
      openPopup(options?: { windowId?: number }): Promise<void>;
      setBadgeText(details: { text: string }): Promise<void>;
      setBadgeBackgroundColor(details: {
        color: string;
      }): Promise<void>;
    };
  };
}
