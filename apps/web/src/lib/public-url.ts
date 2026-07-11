const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const LOCAL_API_PORT = 4000;
const PROXY_API_PREFIX = "/api";

interface UrlTarget {
  origin: string | null;
  basePath: string;
}

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const normalizePath = (value: string): string => {
  if (!value) {
    return "";
  }
  return value.startsWith("/") ? value : `/${value}`;
};

const isLocalHostname = (hostname: string): boolean =>
  LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost");

const getBrowserOrigin = (): string | null =>
  typeof window === "undefined" ? null : trimTrailingSlash(window.location.origin);

const inferDefaultTarget = (): UrlTarget => {
  if (typeof window === "undefined") {
    return {
      origin: "http://localhost:4000",
      basePath: ""
    };
  }

  const { hostname, protocol } = window.location;
  if (process.env.NODE_ENV === "development" && isLocalHostname(hostname)) {
    return {
      origin: trimTrailingSlash(`${protocol}//${hostname}:${LOCAL_API_PORT}`),
      basePath: ""
    };
  }

  return {
    origin: getBrowserOrigin(),
    basePath: PROXY_API_PREFIX
  };
};

const buildUrl = (target: UrlTarget, path = ""): string => {
  const normalizedPath = normalizePath(path);
  const base = `${target.basePath}${normalizedPath}`;
  return target.origin ? `${trimTrailingSlash(target.origin)}${base}` : base;
};

const getApiTarget = (): UrlTarget => inferDefaultTarget();

const getSocketTarget = (): UrlTarget => inferDefaultTarget();

export const getApiBaseUrl = (): string => buildUrl(getApiTarget());

export const buildApiUrl = (path: string): string => buildUrl(getApiTarget(), path);

export const getSocketUrl = (): string | null => getSocketTarget().origin ?? getBrowserOrigin();

export const getSocketPath = (): string => {
  const { basePath } = getSocketTarget();
  return `${basePath || ""}/socket.io`;
};

export const buildWebSocketUrl = (path: string): string => {
  const target = getApiTarget();
  const origin = target.origin ?? getBrowserOrigin();
  if (!origin) {
    throw new Error("Unable to resolve WebSocket origin");
  }

  return buildUrl(
    {
      ...target,
      origin: origin.replace(/^http/i, "ws")
    },
    path
  );
};
