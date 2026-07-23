type Listener = (...args: unknown[]) => void;

export class MockSocket {
  private listeners = new Map<string, Set<Listener>>();
  connected = true;

  on(event: string, listener: Listener): this {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  off(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string, ...args: unknown[]): this {
    this.listeners.get(event)?.forEach((listener) => listener(...args));
    return this;
  }

  close(): this {
    this.connected = false;
    return this;
  }

  disconnect(): this {
    return this.close();
  }
}

export type Socket = MockSocket;

export function io(): MockSocket {
  return new MockSocket();
}
