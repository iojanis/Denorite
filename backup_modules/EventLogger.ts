import { Event, Module } from "../decorators.ts";
import type { ScriptContext } from "../types";

interface EventLog {
  type: string;
  timestamp: number;
  data: Record<string, any>;
}

@Module({
  name: "EventLogger",
  version: "1.0.0",
})
export class EventLogger {
  private readonly MAX_EVENTS = 1000; // Maximum events to store per type
  private readonly CLEANUP_THRESHOLD = 0.9; // Cleanup when 90% full

  // Helper method to store events
  private async logEvent(
    context: ScriptContext,
    eventType: string,
    eventData: Record<string, any>,
  ): Promise<void> {
    const { kv, log } = context;

    try {
      const event: EventLog = {
        type: eventType,
        timestamp: Date.now(),
        data: eventData,
      };

      // Store event in sequential log
      const eventId = crypto.randomUUID();
      await kv.set(["events", "all", eventId], event);

      // Store event by type
      await kv.set(["events", "byType", eventType, eventId], event);

      // Store event by player if applicable
      if (eventData.playerName || eventData.playerId) {
        const playerIdentifier = eventData.playerName || eventData.playerId;
        await kv.set(["events", "byPlayer", playerIdentifier, eventId], event);
      }

      // Update event counts
      const countResult = await kv.get<number>(["events", "counts", eventType]);
      const currentCount = (countResult.value || 0) + 1;
      await kv.set(["events", "counts", eventType], currentCount);

      // Check if cleanup is needed
      if (currentCount > this.MAX_EVENTS * this.CLEANUP_THRESHOLD) {
        await this.cleanupOldEvents(context, eventType);
      }

      // log(`Logged ${eventType} event: ${JSON.stringify(eventData)}`);
    } catch (error) {
      log(`Error logging ${eventType} event: ${error}`);
    }
  }

  // Helper method to clean up old events
  private async cleanupOldEvents(
    context: ScriptContext,
    eventType: string,
  ): Promise<void> {
    const { kv, log } = context;

    try {
      // Get all events of this type
      const events = kv.list<EventLog>({
        prefix: ["events", "byType", eventType],
      });
      const eventArray: Array<{ key: Deno.KvKey; value: EventLog }> = [];

      for await (const event of events) {
        eventArray.push(event);
      }

      // Sort by timestamp and keep only the most recent MAX_EVENTS
      eventArray.sort((a, b) => b.value.timestamp - a.value.timestamp);
      const toDelete = eventArray.slice(this.MAX_EVENTS);

      // Delete old events
      for (const event of toDelete) {
        await kv.delete(event.key);
        // Also delete from all events list
        await kv.delete(["events", "all", event.key[3]]); // key[3] is the eventId
        // And from player events if applicable
        if (event.value.data.playerName) {
          await kv.delete([
            "events",
            "byPlayer",
            event.value.data.playerName,
            event.key[3],
          ]);
        }
      }

      // Update count
      await kv.set(["events", "counts", eventType], this.MAX_EVENTS);

      log(`Cleaned up ${toDelete.length} old events of type ${eventType}`);
    } catch (error) {
      log(`Error cleaning up old events: ${error}`);
    }
  }

  // Server Events
  @Event("server_starting")
  async handleServerStarting(context: ScriptContext): Promise<void> {
    await this.logEvent(context, "server_starting", context.params);
  }

  @Event("server_started")
  async handleServerStarted(context: ScriptContext): Promise<void> {
    await this.logEvent(context, "server_started", context.params);
  }

  @Event("server_stopping")
  async handleServerStopping(context: ScriptContext): Promise<void> {
    await this.logEvent(context, "server_stopping", context.params);
  }

  @Event("server_stopped")
  async handleServerStopped(context: ScriptContext): Promise<void> {
    await this.logEvent(context, "server_stopped", context.params);
  }

  // Player Events
  @Event("player_joined")
  async handlePlayerJoined(context: ScriptContext): Promise<void> {
    await this.logEvent(context, "player_joined", context.params);
  }

  @Event("player_left")
  async handlePlayerLeft(context: ScriptContext): Promise<void> {
    await this.logEvent(context, "player_left", context.params);
  }

  @Event("player_death")
  async handlePlayerDeath(context: ScriptContext): Promise<void> {
    await this.logEvent(context, "player_death", context.params);
  }

  @Event("player_respawned")
  async handlePlayerRespawned(context: ScriptContext): Promise<void> {
    await this.logEvent(context, "player_respawned", context.params);
  }

  @Event("player_chat")
  async handlePlayerChat(context: ScriptContext): Promise<void> {
    await this.logEvent(context, "player_chat", context.params);
  }

  @Event("player_command")
  async handlePlayerCommand(context: ScriptContext): Promise<void> {
    await this.logEvent(context, "player_command", context.params);
  }

  // Entity Events
  @Event("entity_death")
  async handleEntityDeath(context: ScriptContext): Promise<void> {
    await this.logEvent(context, "entity_death", context.params);
  }

  @Event("entity_changed_world")
  async handleEntityChangedWorld(context: ScriptContext): Promise<void> {
    await this.logEvent(context, "entity_changed_world", context.params);
  }

  // World Events
  @Event("world_load")
  async handleWorldLoad(context: ScriptContext): Promise<void> {
    await this.logEvent(context, "world_load", context.params);
  }

  @Event("world_unload")
  async handleWorldUnload(context: ScriptContext): Promise<void> {
    await this.logEvent(context, "world_unload", context.params);
  }

  // Block Events
  @Event("player_break_block_after")
  async handlePlayerBreakBlock(context: ScriptContext): Promise<void> {
    await this.logEvent(context, "player_break_block_after", context.params);
  }

  @Event("player_attack_block")
  async handlePlayerAttackBlock(context: ScriptContext): Promise<void> {
    await this.logEvent(context, "player_attack_block", context.params);
  }

  @Event("player_use_block")
  async handlePlayerUseBlock(context: ScriptContext): Promise<void> {
    await this.logEvent(context, "player_use_block", context.params);
  }

  // Item Events
  @Event("player_use_item")
  async handlePlayerUseItem(context: ScriptContext): Promise<void> {
    await this.logEvent(context, "player_use_item", context.params);
  }

  // Container Events
  @Event("container_interaction_start")
  async handleContainerInteractionStart(context: ScriptContext): Promise<void> {
    await this.logEvent(context, "container_interaction_start", context.params);
  }

  @Event("container_interaction_end")
  async handleContainerInteractionEnd(context: ScriptContext): Promise<void> {
    await this.logEvent(context, "container_interaction_end", context.params);
  }

  // Static helper methods for other modules to use
  static async getRecentEvents(
    kv: Deno.Kv,
    limit: number = 100,
  ): Promise<EventLog[]> {
    const events: EventLog[] = [];
    const iterator = kv.list<EventLog>({ prefix: ["events", "all"] });

    for await (const event of iterator) {
      events.push(event.value);
      if (events.length >= limit) break;
    }

    return events.sort((a, b) => b.timestamp - a.timestamp);
  }

  static async getPlayerEvents(
    kv: Deno.Kv,
    playerName: string,
    limit: number = 100,
  ): Promise<EventLog[]> {
    const events: EventLog[] = [];
    const iterator = kv.list<EventLog>({
      prefix: ["events", "byPlayer", playerName],
    });

    for await (const event of iterator) {
      events.push(event.value);
      if (events.length >= limit) break;
    }

    return events.sort((a, b) => b.timestamp - a.timestamp);
  }

  static async getEventsByType(
    kv: Deno.Kv,
    eventType: string,
    limit: number = 100,
  ): Promise<EventLog[]> {
    const events: EventLog[] = [];
    const iterator = kv.list<EventLog>({
      prefix: ["events", "byType", eventType],
    });

    for await (const event of iterator) {
      events.push(event.value);
      if (events.length >= limit) break;
    }

    return events.sort((a, b) => b.timestamp - a.timestamp);
  }

  static async getEventCount(kv: Deno.Kv, eventType: string): Promise<number> {
    const result = await kv.get<number>(["events", "counts", eventType]);
    return result.value || 0;
  }
}
