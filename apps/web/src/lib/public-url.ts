const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const readConfiguredUrl = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimTrailingSlash(trimmed);
};

const inferBrowserOrigin = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const { hostname, origin, protocol } = window.location;
  if (LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost")) {
    return trimTrailingSlash(`${protocol}//${hostname}:4000`);
  }

  return trimTrailingSlash(origin);
};

export const getApiBaseUrl = (): string =>
  readConfiguredUrl(process.env.NEXT_PUBLIC_API_URL) ?? inferBrowserOrigin() ?? "http://localhost:4000";

export const getSocketUrl = (): string =>
  readConfiguredUrl(process.env.NEXT_PUBLIC_SOCKET_URL) ?? inferBrowserOrigin() ?? "http://localhost:4000";

export const buildApiUrl = (path: string): string => `${getApiBaseUrl()}${path}`;

export const buildWebSocketUrl = (path: string): string => `${getSocketUrl().replace(/^http/i, "ws")}${path}`;
