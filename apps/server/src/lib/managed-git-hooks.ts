import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveGitPaths } from "./git-paths.js";

export const MANAGED_GIT_HOOKS = {
  "pre-commit": "#!/bin/sh\n# AgentSwarm: only the spawner may create commits.\nexit 1\n",
  "pre-push": "#!/bin/sh\n# AgentSwarm: only the spawner may push.\nexit 1\n"
} as const;

export async function installManagedGitHooks(gitPath: string): Promise<void> {
  const { commonDir } = await resolveGitPaths(gitPath);
  const hooksDir = path.join(commonDir, "hooks");
  await mkdir(hooksDir, { recursive: true });

  for (const [hookName, content] of Object.entries(MANAGED_GIT_HOOKS)) {
    const hookPath = path.join(hooksDir, hookName);
    await writeFile(hookPath, content, "utf8");
    await chmod(hookPath, 0o755);
  }
}
