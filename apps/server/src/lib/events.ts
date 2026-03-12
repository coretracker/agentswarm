import type Redis from "ioredis";
import type { RealtimeEvent } from "@agentswarm/shared-types";

export class EventBus {
  constructor(
    private readonly publisher: Redis,
    private readonly channel: string
  ) {}

  async publish(event: RealtimeEvent): Promise<void> {
    await this.publisher.publish(this.channel, JSON.stringify(event));
  }
}
