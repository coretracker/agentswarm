import type {
  CreateTaskFromIssueInput,
  CreateTaskFromPullRequestInput,
  CreateTaskInput,
  GitHubBranchReference,
  GitHubIssueReference,
  GitHubPullRequestReference,
  Repository
} from "@agentswarm/shared-types";
import type { SettingsStore } from "./settings-store.js";

const GITHUB_API_URL = "https://api.github.com";
const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

interface GitHubUser {
  login: string;
}

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  labels?: Array<{ name: string }>;
  pull_request?: Record<string, unknown>;
}

interface GitHubIssueComment {
  body: string;
  html_url: string;
  user: GitHubUser | null;
  created_at: string;
}

interface GitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  head: { ref: string };
  base: { ref: string };
}

interface GitHubBranch {
  name: string;
}

interface ReviewThreadCommentNode {
  body: string;
  url: string;
  createdAt: string;
  diffHunk: string | null;
  author: GitHubUser | null;
}

interface ReviewThreadNode {
  isResolved: boolean;
  isOutdated: boolean;
  path: string | null;
  line: number | null;
  originalLine: number | null;
  comments: {
    nodes: ReviewThreadCommentNode[];
  };
}

interface PullRequestReviewThreadsResponse {
  data?: {
    repository?: {
      pullRequest?: {
        reviewThreads?: {
          nodes: ReviewThreadNode[];
        };
      };
    };
  };
  errors?: Array<{ message: string }>;
}

export class GitHubImportError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400
  ) {
    super(message);
    this.name = "GitHubImportError";
  }
}

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 3))}...` : value;

const cleanMarkdownBlock = (value: string | null | undefined, maxLength = 3000): string | null => {
  const normalized = (value ?? "").trim();
  if (!normalized) {
    return null;
  }

  return truncate(normalized, maxLength);
};

const parseGitHubRepository = (repoUrl: string): { owner: string; repo: string } => {
  const httpsMatch = repoUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  const sshMatch = repoUrl.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  throw new GitHubImportError("Repository import currently supports github.com repositories only.");
};

export class GitHubImportService {
  constructor(private readonly settingsStore: SettingsStore) {}

  private async getGitHubToken(): Promise<string> {
    const credentials = await this.settingsStore.getRuntimeCredentials();
    if (!credentials.githubToken) {
      throw new GitHubImportError("GitHub token is not configured in Settings.", 409);
    }

    return credentials.githubToken;
  }

  private async fetchGitHubJson<T>(path: string): Promise<T> {
    const token = await this.getGitHubToken();
    const response = await fetch(`${GITHUB_API_URL}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "AgentSwarm",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new GitHubImportError(`GitHub API request failed (${response.status}): ${text || response.statusText}`, response.status);
    }

    return response.json() as Promise<T>;
  }

  private async fetchGitHubGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const token = await this.getGitHubToken();
    const response = await fetch(GITHUB_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "AgentSwarm"
      },
      body: JSON.stringify({ query, variables })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new GitHubImportError(`GitHub GraphQL request failed (${response.status}): ${text || response.statusText}`, response.status);
    }

    return response.json() as Promise<T>;
  }

  async listOpenIssues(repository: Repository): Promise<GitHubIssueReference[]> {
    const { owner, repo } = parseGitHubRepository(repository.url);
    const issues = await this.fetchGitHubJson<GitHubIssue[]>(`/repos/${owner}/${repo}/issues?state=open&sort=updated&direction=desc&per_page=50`);

    return issues
      .filter((issue) => !issue.pull_request)
      .map((issue) => ({
        number: issue.number,
        title: issue.title,
        url: issue.html_url
      }));
  }

  async listOpenPullRequests(repository: Repository): Promise<GitHubPullRequestReference[]> {
    const { owner, repo } = parseGitHubRepository(repository.url);
    const pullRequests = await this.fetchGitHubJson<GitHubPullRequest[]>(`/repos/${owner}/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=50`);

    return pullRequests.map((pullRequest) => ({
      number: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.html_url,
      headBranch: pullRequest.head.ref,
      baseBranch: pullRequest.base.ref
    }));
  }

  async listBranches(repository: Repository): Promise<GitHubBranchReference[]> {
    const { owner, repo } = parseGitHubRepository(repository.url);
    const branches = await this.fetchGitHubJson<GitHubBranch[]>(`/repos/${owner}/${repo}/branches?per_page=100`);

    return branches.map((branch) => ({
      name: branch.name,
      isDefault: branch.name === repository.defaultBranch
    }));
  }

  async buildTaskInputFromIssue(repository: Repository, input: CreateTaskFromIssueInput): Promise<CreateTaskInput> {
    const { owner, repo } = parseGitHubRepository(repository.url);
    const issue = await this.fetchGitHubJson<GitHubIssue>(`/repos/${owner}/${repo}/issues/${input.issueNumber}`);

    if (issue.pull_request) {
      throw new GitHubImportError("That number belongs to a pull request. Use the PR import flow instead.");
    }

    const comments = input.includeComments
      ? await this.fetchGitHubJson<GitHubIssueComment[]>(`/repos/${owner}/${repo}/issues/${input.issueNumber}/comments?per_page=50`)
      : [];

    const commentBlocks = comments
      .map((comment) => {
        const body = cleanMarkdownBlock(comment.body, 1800);
        if (!body) {
          return null;
        }

        return [
          `### @${comment.user?.login ?? "unknown"} (${comment.created_at})`,
          body,
          `Source: ${comment.html_url}`
        ].join("\n");
      })
      .filter((value): value is string => Boolean(value));

    const issueBody = cleanMarkdownBlock(issue.body, 6000);
    const labels = (issue.labels ?? []).map((label) => label.name).filter(Boolean);
    const taskType = input.taskType ?? "build";
    const title = input.title?.trim() || `Issue #${issue.number}: ${issue.title}`;
    const prompt = [
      `Imported from GitHub issue #${issue.number}: ${issue.title}`,
      `Issue URL: ${issue.html_url}`,
      labels.length > 0 ? `Labels: ${labels.join(", ")}` : null,
      issueBody ? `## Issue Body\n${issueBody}` : null,
      commentBlocks.length > 0 ? `## Issue Comments\n\n${commentBlocks.join("\n\n")}` : null
    ]
      .filter((value): value is string => Boolean(value))
      .join("\n\n");

    return {
      title,
      repoId: repository.id,
      prompt,
      notes: input.notes?.trim() ?? "",
      taskType,
      startMode: input.startMode,
      provider: input.provider,
      providerProfile: input.providerProfile,
      modelOverride: input.modelOverride,
      baseBranch: input.baseBranch?.trim() || repository.defaultBranch,
      branchStrategy: taskType === "build" ? input.branchStrategy ?? "feature_branch" : "feature_branch",
      model: input.model,
      reasoningEffort: input.reasoningEffort
    };
  }

  async buildTaskInputFromPullRequest(repository: Repository, input: CreateTaskFromPullRequestInput): Promise<CreateTaskInput> {
    const { owner, repo } = parseGitHubRepository(repository.url);
    const pullRequest = await this.fetchGitHubJson<GitHubPullRequest>(`/repos/${owner}/${repo}/pulls/${input.pullRequestNumber}`);

    const response = await this.fetchGitHubGraphQL<PullRequestReviewThreadsResponse>(
      `
        query PullRequestReviewThreads($owner: String!, $repo: String!, $number: Int!) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $number) {
              reviewThreads(first: 100) {
                nodes {
                  isResolved
                  isOutdated
                  path
                  line
                  originalLine
                  comments(first: 20) {
                    nodes {
                      body
                      url
                      createdAt
                      diffHunk
                      author {
                        login
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
      { owner, repo, number: input.pullRequestNumber }
    );

    if (response.errors?.length) {
      throw new GitHubImportError(response.errors.map((error) => error.message).join("; "));
    }

    const threads = response.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
    const unresolvedThreads = threads.filter((thread) => !thread.isResolved && !thread.isOutdated);

    if (unresolvedThreads.length === 0) {
      throw new GitHubImportError("No unresolved pull request review threads found.", 409);
    }

    const threadBlocks = unresolvedThreads
      .map((thread, index) => {
        const location = [thread.path ?? "(unknown path)", thread.line ?? thread.originalLine ?? "unknown line"].join(":");
        const commentBlocks = thread.comments.nodes
          .map((comment) => {
            const body = cleanMarkdownBlock(comment.body, 1800);
            if (!body) {
              return null;
            }

            const parts = [
              `- @${comment.author?.login ?? "unknown"} (${comment.createdAt})`,
              `  ${body.replace(/\n/g, "\n  ")}`,
              `  Source: ${comment.url}`
            ];

            const diffHunk = cleanMarkdownBlock(comment.diffHunk, 1200);
            if (diffHunk) {
              parts.push("", "  ```diff", `  ${diffHunk.replace(/\n/g, "\n  ")}`, "  ```");
            }

            return parts.join("\n");
          })
          .filter((value): value is string => Boolean(value));

        return [`### Thread ${index + 1} (${location})`, ...commentBlocks].join("\n");
      })
      .join("\n\n");

    const pullRequestBody = cleanMarkdownBlock(pullRequest.body, 4000);
    const title = input.title?.trim() || `PR #${pullRequest.number}: ${pullRequest.title}`;
    const prompt = [
      `Implement the unresolved review feedback from GitHub pull request #${pullRequest.number}: ${pullRequest.title}.`,
      `PR URL: ${pullRequest.html_url}`,
      `Default branch: ${pullRequest.base.ref}`,
      `PR branch: ${pullRequest.head.ref}`,
      pullRequestBody ? `## Pull Request Description\n${pullRequestBody}` : null,
      `## Unresolved Review Threads\n\n${threadBlocks}`
    ]
      .filter((value): value is string => Boolean(value))
      .join("\n\n");

    return {
      title,
      repoId: repository.id,
      prompt,
      notes: input.notes?.trim() ?? "",
      taskType: "build",
      provider: input.provider,
      providerProfile: input.providerProfile,
      modelOverride: input.modelOverride,
      baseBranch: pullRequest.head.ref,
      branchStrategy: "work_on_branch",
      model: input.model,
      reasoningEffort: input.reasoningEffort
    };
  }
}
