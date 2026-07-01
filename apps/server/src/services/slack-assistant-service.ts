import type { Repository, User } from "@agentswarm/shared-types";
import type {
  SlackAssistantConversation,
  SlackAssistantStore,
  SlackAssistantTurn
} from "./slack-assistant-store.js";

const nowIso = (): string => new Date().toISOString();

export interface SlackAssistantMessageInput {
  repository: Repository;
  user: User;
  conversation: SlackAssistantConversation;
  text: string;
}

export interface SlackAssistantRuntime {
  respond(input: SlackAssistantMessageInput): Promise<string>;
}

export class DetachedSlackAssistantRuntime implements SlackAssistantRuntime {
  async respond(input: SlackAssistantMessageInput): Promise<string> {
    const recentMessages = input.conversation.turns.slice(-8);
    const contextNote =
      recentMessages.length > 0
        ? `I kept this DM context with ${recentMessages.length} recent message${recentMessages.length === 1 ? "" : "s"}.`
        : "I started a detached Slack DM conversation for you.";
    return [
      contextNote,
      "The repository-scoped Slack integration is connected. Detached Codex/Claude container execution is isolated from normal task workflows and will use GitHub plus AgentSwarm MCP context when the runtime runner is attached."
    ].join(" ");
  }
}

export class SlackAssistantService {
  constructor(
    private readonly conversationStore: SlackAssistantStore,
    private readonly runtime: SlackAssistantRuntime = new DetachedSlackAssistantRuntime()
  ) {}

  async handleMessage(input: SlackAssistantMessageInput): Promise<string> {
    const userTurn: SlackAssistantTurn = { role: "user", content: input.text, at: nowIso() };
    const conversationWithUserTurn = await this.conversationStore.appendTurn(input.conversation.id, userTurn);
    const reply = await this.runtime.respond({
      ...input,
      conversation: conversationWithUserTurn ?? input.conversation
    });
    await this.conversationStore.appendTurn(input.conversation.id, { role: "assistant", content: reply, at: nowIso() });
    return reply;
  }
}
