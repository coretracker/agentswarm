import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const manifestPath = process.env.TASK_MANIFEST_FILE;
const providerConfigPath = process.env.PROVIDER_CONFIG_FILE;
const openAiApiKey = process.env.OPENAI_API_KEY ?? "";
const openAiBaseUrl = process.env.OPENAI_BASE_URL ?? "";

if (!manifestPath) {
  console.error("TASK_MANIFEST_FILE is required");
  process.exit(1);
}
if (!providerConfigPath) {
  console.error("PROVIDER_CONFIG_FILE is required");
  process.exit(1);
}
if (!openAiApiKey) {
  console.error("OPENAI_API_KEY is required");
  process.exit(1);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const providerConfig = await readFile(providerConfigPath, "utf8").catch(() => "");
const homeDir = "/root";
const codexDir = path.join(homeDir, ".codex");
const lastMessageFile = path.join(path.dirname(manifest.resultJsonPath), "codex-last-message.txt");

await mkdir(codexDir, { recursive: true });
await mkdir(path.dirname(manifest.resultJsonPath), { recursive: true });
if (providerConfig.trim()) {
  await writeFile(path.join(codexDir, "config.toml"), providerConfig, "utf8");
  console.log("[runtime] wrote Codex config");
}

if (openAiBaseUrl) {
  process.env.OPENAI_BASE_URL = openAiBaseUrl;
}
process.env.OPENAI_API_KEY = openAiApiKey;
process.env.HOME = homeDir;

const extractReviewVerdict = (markdown) => {
  const match = markdown.match(/(?:^|\n)#{1,6}\s+Verdict\s*\n([\s\S]*?)(?=\n#{1,6}\s+|$)/i);
  const candidate = match?.[1]?.toLowerCase().replace(/[`*_]/g, "").trim() ?? "";
  if (candidate.includes("changes_requested") || candidate.includes("changes requested")) {
    return "changes_requested";
  }
  if (candidate.includes("approved") || candidate.includes("all good")) {
    return "approved";
  }
  return null;
};

const buildPrompt = () => {
  const rulesSection = manifest.agentRules?.trim()
    ? `\nGlobal Agent Rules:\n${manifest.agentRules}\n\nThese rules apply to every action unless they directly conflict with the explicit task requirements.\n`
    : "";
  const approvedPlanSection = manifest.planMarkdown?.trim()
    ? `\nApproved plan markdown:\n${manifest.planMarkdown}\n`
    : `\nNo approved plan markdown is available for this task.\nFallback execution summary:\n${manifest.executionSummary}\n`;

  switch (manifest.action) {
    case "plan":
      return `You are planning work for the repository at ${manifest.workspacePath}.\n\nTask title:\n${manifest.title}\n\nRequirements:\n${manifest.requirements}\n\nRepository profile:\n${manifest.repoProfile}${rulesSection}\nInspect the repository and create an implementation plan in markdown with sections:\n- Overview\n- Repo Findings\n- Files To Change\n- Implementation Steps\n- Validation\n- Risks\n\nImportant:\n- Return only markdown content for the plan.\n- Do not ask for additional input.\n- Be concrete. The plan must describe the likely code changes, not just process steps.\n- In \"Overview\", summarize the problem and intended outcome without repeating the full requirements.\n- In \"Repo Findings\", list the concrete files, modules, or code paths you inspected and why they matter.\n- In \"Repo Findings\", include short code snippets only when they clarify a key implementation constraint.\n- In \"Files To Change\", organize the plan file-by-file, explain why each file matters, and include the proposed edits directly under that file entry.\n- Do not create a separate \"Suggested Code Changes\" section.\n- When proposing file edits, prefer fenced markdown code blocks whose language is set to diff.\n- For diff blocks, prefer full git-style unified diffs with diff --git, ---, +++, and valid @@ -old,+new @@ hunk headers so the UI can render them reliably.\n- In \"Validation\", list only the concrete checks or commands needed to verify the planned change.\n- Omit \"Risks\" if there are no meaningful risks.\n- Do not actually modify files during planning.`;
    case "build":
      return `You are implementing a task in the repository at ${manifest.workspacePath}.\n\nTask title:\n${manifest.title}\n\nRequirements:\n${manifest.requirements}\n\nRepository profile:\n${manifest.repoProfile}${approvedPlanSection}${rulesSection}\nImplement the required code changes directly in this repository, then stop.\nUse the approved plan as the primary implementation guide when it is available.\nOnly rely on the fallback execution summary when no approved plan exists.\nStay close to the planned files and implementation steps.\nDo not do broad repository exploration unless the approved plan is clearly blocked by the actual code.`;
    case "iterate":
      return `You are revising an implementation plan for the repository at ${manifest.workspacePath}.\n\nTask title:\n${manifest.title}\n\nRequirements:\n${manifest.requirements}\n\nRepository profile:\n${manifest.repoProfile}\n\nCurrent plan markdown:\n${manifest.planMarkdown || "(no plan has been generated yet; use the execution summary below as the current draft)"}\n\nCurrent execution summary:\n${manifest.executionSummary}\n\nIteration request:\n${manifest.iterationInput}${rulesSection}\nRevise the plan to incorporate the iteration request, then stop.\nReturn only the complete updated markdown plan.\nKeep the same plan structure and sections as the initial planning step.\nDo not modify files.`;
    case "review":
      return `You are reviewing the implementation on branch ${manifest.baseBranch} in the repository at ${manifest.workspacePath}.\n\nCompare it against the repository default branch:\n${manifest.repoDefaultBranch}\n\nRequirements:\n${manifest.requirements}\n\nRepository profile:\n${manifest.repoProfile}${rulesSection}\nInspect the branch diff against ${manifest.repoDefaultBranch} and the relevant changed files, then return a markdown review with sections:\n- Verdict\n- Summary\n- Findings\n- Recommended Changes\n- Validation\n\nImportant:\n- Return only markdown.\n- In \"Verdict\", output exactly one of: approved, changes_requested.\n- If the implementation is acceptable, say approved and keep findings concise.\n- If changes are needed, explain the concrete issues and how to fix them.\n- Do not modify files.`;
    case "ask":
      return `You are answering a repository question for the branch ${manifest.baseBranch} at ${manifest.workspacePath}.\n\nTask title:\n${manifest.title}\n\nQuestion:\n${manifest.requirements}\n\nRepository profile:\n${manifest.repoProfile}${rulesSection}\nAnswer the question in markdown only.\nIf code snippets help, use fenced code blocks.\nDo not modify files.`;
    default:
      throw new Error(`Unsupported action: ${manifest.action}`);
  }
};

console.log(`[runtime] running codex action=${manifest.action} model=${manifest.resolvedModel ?? "default"} profile=${manifest.providerProfile}`);
await new Promise((resolve, reject) => {
  const proc = spawn("codex", ["login", "--with-api-key"], {
    env: process.env,
    cwd: manifest.workspacePath,
    stdio: ["pipe", "pipe", "pipe"]
  });
  proc.stdin.write(openAiApiKey);
  proc.stdin.end();
  proc.stdout.on("data", (chunk) => process.stdout.write(chunk));
  proc.stderr.on("data", (chunk) => process.stderr.write(chunk));
  proc.on("error", reject);
  proc.on("close", (code) => {
    if (code === 0) {
      resolve();
      return;
    }

    reject(new Error(`codex login exited with ${code ?? "unknown"}`));
  });
});

const prompt = buildPrompt();
const args = [
  "exec",
  "--dangerously-bypass-approvals-and-sandbox",
  "-C",
  manifest.workspacePath,
  "--color",
  "never",
  "--output-last-message",
  lastMessageFile
];
if (manifest.resolvedModel) {
  args.push("-m", manifest.resolvedModel);
}
if (manifest.resolvedReasoningEffort) {
  args.push("-c", `model_reasoning_effort=\"${manifest.resolvedReasoningEffort}\"`);
}
args.push(prompt);

const execProc = spawn("codex", args, { env: process.env, cwd: manifest.workspacePath, stdio: ["ignore", "pipe", "pipe"] });
execProc.stdout.on("data", (chunk) => process.stdout.write(chunk));
execProc.stderr.on("data", (chunk) => process.stderr.write(chunk));
await new Promise((resolve, reject) => {
  execProc.on("error", reject);
  execProc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`codex exited with code ${code ?? "unknown"}`))));
});

const summaryMarkdown = (await readFile(lastMessageFile, "utf8").catch(() => "")).trim();
if (!summaryMarkdown) {
  throw new Error("codex returned empty summary markdown");
}

await writeFile(manifest.resultMarkdownPath, `${summaryMarkdown}\n`, "utf8");
await writeFile(
  manifest.resultJsonPath,
  JSON.stringify(
    {
      taskType: manifest.taskType,
      status: "success",
      summaryMarkdown,
      reviewVerdict: manifest.action === "review" ? extractReviewVerdict(summaryMarkdown) : null,
      changedFiles: [],
      metadata: {
        provider: manifest.provider,
        action: manifest.action
      }
    },
    null,
    2
  ),
  "utf8"
);

console.log("[runtime] completed");
