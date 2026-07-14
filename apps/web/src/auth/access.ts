import type { PermissionScope } from "@verft/shared-types";

export interface NavigationRoute {
  key: string;
  label: string;
  requiredScopes: PermissionScope[];
}

export const navigationRoutes: NavigationRoute[] = [
  { key: "/tasks", label: "Tasks", requiredScopes: ["task:list"] },
  { key: "/snippets", label: "Snippets", requiredScopes: ["snippet:list"] },
  { key: "/repositories", label: "Repositories", requiredScopes: ["repo:list"] },
  { key: "/settings", label: "Settings", requiredScopes: ["settings:read"] },
  { key: "/users", label: "Users", requiredScopes: ["user:list"] }
];

export const isPublicPathname = (pathname: string): boolean => pathname === "/login";

export const isTerminalFullscreenPath = (pathname: string): boolean =>
  /^\/tasks\/[^/]+\/terminal$/.test(pathname) || pathname === "/settings/provider-setup-terminal";

export const getRequiredScopesForPathname = (pathname: string): PermissionScope[] => {
  if (pathname === "/tasks") {
    return ["task:list"];
  }

  if (pathname === "/tasks/new") {
    return ["task:create", "repo:list"];
  }

  if (/^\/tasks\/[^/]+\/terminal$/.test(pathname)) {
    return ["task:edit", "task:terminal"];
  }

  if (pathname === "/settings/provider-setup-terminal") {
    return ["settings:edit"];
  }

  if (pathname.startsWith("/tasks/")) {
    return ["task:read"];
  }

  if (pathname === "/snippets" || pathname === "/presets") {
    return ["snippet:list"];
  }

  if (pathname === "/repositories") {
    return ["repo:list"];
  }

  if (pathname === "/settings") {
    return ["settings:read"];
  }

  if (pathname === "/users") {
    return ["user:list"];
  }

  if (pathname === "/profile") {
    return [];
  }

  return [];
};

export const canAccessScopes = (
  grantedScopes: Iterable<PermissionScope>,
  requiredScopes: PermissionScope[]
): boolean => {
  const granted = new Set(grantedScopes);
  return requiredScopes.every((scope) => granted.has(scope));
};

export const resolveDefaultPath = (grantedScopes: Iterable<PermissionScope>): string | null => {
  for (const route of navigationRoutes) {
    if (canAccessScopes(grantedScopes, route.requiredScopes)) {
      return route.key;
    }
  }

  return null;
};

export const getSelectedNavigationKey = (pathname: string): string => {
  if (pathname.startsWith("/tasks")) {
    return "/tasks";
  }

  if (pathname.startsWith("/snippets") || pathname.startsWith("/presets")) {
    return "/snippets";
  }

  if (pathname.startsWith("/repositories")) {
    return "/repositories";
  }

  if (pathname.startsWith("/settings")) {
    return "/settings";
  }

  if (pathname.startsWith("/users")) {
    return "/users";
  }

  return pathname;
};
