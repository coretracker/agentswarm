const sanitizeBranchPrefix = (branchPrefix: string): string => {
  const cleaned = branchPrefix
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");

  return cleaned || "agentswarm";
};

export const makeBranchName = (title: string, taskId: string, branchPrefix: string): string => {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  const suffix = taskId.slice(0, 8);
  const safeSlug = slug.length > 0 ? slug : "task";
  return `${sanitizeBranchPrefix(branchPrefix)}/${safeSlug}-${suffix}`;
};
