class StorybookResizeObserver {
  observe(): void {
    // Storybook only needs the observer to exist for components that fit editors/terminals.
  }

  unobserve(): void {
    // noop
  }

  disconnect(): void {
    // noop
  }
}

class StorybookWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = StorybookWebSocket.CONNECTING;
  binaryType: BinaryType = "blob";

  constructor(url: string) {
    super();
    this.url = url;
    window.setTimeout(() => {
      this.readyState = StorybookWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
      this.dispatchEvent(new MessageEvent("message", { data: "\u001b[32mStorybook terminal session\u001b[0m\r\n$ npm run ci\r\n" }));
    }, 20);
  }

  send(): void {
    // noop
  }

  close(code = 1000, reason = "storybook close"): void {
    if (this.readyState === StorybookWebSocket.CLOSED) {
      return;
    }
    this.readyState = StorybookWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close", { code, reason }));
  }
}

class StorybookNotification extends EventTarget {
  static permission: NotificationPermission = "default";

  static async requestPermission(): Promise<NotificationPermission> {
    StorybookNotification.permission = "granted";
    return StorybookNotification.permission;
  }

  constructor(
    readonly title: string,
    readonly options?: NotificationOptions
  ) {
    super();
  }

  close(): void {
    // noop
  }
}

if (typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false
  });
}

if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = StorybookResizeObserver;
}

if (typeof window.WebSocket === "undefined") {
  window.WebSocket = StorybookWebSocket as unknown as typeof WebSocket;
}

if (typeof window.Notification === "undefined") {
  window.Notification = StorybookNotification as unknown as typeof Notification;
}

if (!navigator.clipboard) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async () => undefined
    }
  });
}
