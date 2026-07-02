export interface SlackUserProfile {
  id: string;
  name: string | null;
  displayName?: string | null;
  realName?: string | null;
}

export interface SlackClient {
  getUserProfile(botToken: string, slackUserId: string): Promise<SlackUserProfile | null>;
  postMessage(botToken: string, channel: string, text: string): Promise<void>;
  addReaction(botToken: string, channel: string, timestamp: string, name: string): Promise<void>;
}

const slackApiFetch = async (path: string, botToken: string, init: RequestInit = {}): Promise<Record<string, unknown>> => {
  const response = await fetch(`https://slack.com/api/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) {
    throw new Error(`Slack API request failed with ${response.status}.`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  if (payload.ok !== true) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Slack API request failed.");
  }
  return payload;
};

const stringValue = (record: Record<string, unknown>, key: string): string | null =>
  typeof record[key] === "string" && record[key].trim().length > 0 ? record[key].trim() : null;

export class FetchSlackClient implements SlackClient {
  async getUserProfile(botToken: string, slackUserId: string): Promise<SlackUserProfile | null> {
    const payload = await slackApiFetch(`users.info?user=${encodeURIComponent(slackUserId)}`, botToken, { method: "GET" });
    const user = payload.user && typeof payload.user === "object" ? (payload.user as Record<string, unknown>) : null;
    if (!user) {
      return null;
    }
    const profile = user.profile && typeof user.profile === "object" ? (user.profile as Record<string, unknown>) : null;
    return {
      id: stringValue(user, "id") ?? slackUserId,
      name:
        stringValue(user, "name") ??
        (profile ? stringValue(profile, "display_name_normalized") ?? stringValue(profile, "real_name_normalized") : null),
      displayName: profile ? stringValue(profile, "display_name") ?? stringValue(profile, "display_name_normalized") : null,
      realName: profile ? stringValue(profile, "real_name") ?? stringValue(profile, "real_name_normalized") : null
    };
  }

  async postMessage(botToken: string, channel: string, text: string): Promise<void> {
    await slackApiFetch("chat.postMessage", botToken, {
      method: "POST",
      body: JSON.stringify({ channel, text })
    });
  }

  async addReaction(botToken: string, channel: string, timestamp: string, name: string): Promise<void> {
    await slackApiFetch("reactions.add", botToken, {
      method: "POST",
      body: JSON.stringify({ channel, timestamp, name })
    });
  }
}
