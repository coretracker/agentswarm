import type { PermissionScope } from "@agentswarm/shared-types";

export interface NavigationRoute {
  key: string;
  label: string;
  requiredScopes: PermissionScope[];
}

export const navigationRoutes: NavigationRoute[] = [
  { key: "/tasks", label: "Tasks", requiredScopes: ["task:list"] },
  { key: "/presets", label: "Presets", requiredScopes: ["preset:list"] },
  { key: "/repositories", label: "Repositories", requiredScopes: ["repo:list"] },
  { key: "/settings", label: "Settings", requiredScopes: ["settings:read"] },
  { key: "/users", label: "Users", requiredScopes: ["user:list"] }
];

export const isPublicPathname = (pathname: string): boolean => pathname === "/login";

export const isTaskInteractiveFullscreenPath = (pathname: string): boolean =>
  /^\/tasks\/[^/]+\/interactive$/.test(pathname);

export const getRequiredScopesForPathname = (pathname: string): PermissionScope[] => {
  if (pathname === "/tasks") {
    return ["task:list"];
  }

  if (pathname === "/tasks/new") {
    return ["task:create", "repo:list"];
  }

  if (/^\/tasks\/[^/]+\/interactive$/.test(pathname)) {
    return ["task:edit"];
  }

  if (pathname.startsWith("/tasks/")) {
    return ["task:read"];
  }

  if (pathname === "/presets") {
    return ["preset:list"];
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

  if (pathname.startsWith("/presets")) {
    return "/presets";
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
