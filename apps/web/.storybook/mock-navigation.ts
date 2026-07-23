type NavigationParams = Record<string, string | string[]>;

interface NavigationState {
  pathname: string;
  search: string;
  params: NavigationParams;
}

const navigationState: NavigationState = {
  pathname: "/tasks",
  search: "",
  params: {}
};

function normalizeSearch(search?: string | URLSearchParams | Record<string, string> | null): string {
  if (!search) {
    return "";
  }
  if (typeof search === "string") {
    return search.startsWith("?") ? search.slice(1) : search;
  }
  return new URLSearchParams(search).toString();
}

export function setMockNavigationState(input: Partial<NavigationState>): void {
  navigationState.pathname = input.pathname ?? navigationState.pathname;
  navigationState.search = normalizeSearch(input.search ?? navigationState.search);
  navigationState.params = input.params ?? navigationState.params;
}

function pushHistory(path: string): void {
  const [pathname, search = ""] = path.split("?");
  setMockNavigationState({ pathname: pathname || "/", search });
}

export function usePathname(): string {
  return navigationState.pathname;
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams(navigationState.search);
}

export function useParams(): NavigationParams {
  return navigationState.params;
}

export function useRouter() {
  return {
    back: () => undefined,
    forward: () => undefined,
    refresh: () => undefined,
    prefetch: async () => undefined,
    push: pushHistory,
    replace: pushHistory
  };
}

export function redirect(path: string): never {
  pushHistory(path);
  throw new Error(`Storybook redirect: ${path}`);
}

export function notFound(): never {
  throw new Error("Storybook notFound");
}
