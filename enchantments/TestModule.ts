import { Module, Event } from "../decorators.ts";
import type { ScriptContext } from "../types.ts";

@Module({
  name: "denorite-test-module",
  version: "1.0.0"
})
export class DenoriteTestModule {
  // Server Events
  @Event("server_starting")
  onServerStarting(context: ScriptContext) {
    console.log("Server is starting...");
  }

  @Event("server_started")
  onServerStarted(context: ScriptContext) {
    console.log("Server has started");
  }

  @Event("server_stopping")
  onServerStopping(context: ScriptContext) {
    console.log("Server is stopping...");
  }

  @Event("server_stopped")
  onServerStopped(context: ScriptContext) {
    console.log("Server has stopped");
  }

  // @Event("server_tick_start")
  // onServerTickStart(context: ScriptContext) {
  //   console.log("Server tick starting...");
  // }
  //
  // @Event("server_tick_end")
  // onServerTickEnd(context: ScriptContext) {
  //   console.log("Server tick ended");
  // }

  @Event("server_before_save")
  onServerBeforeSave(context: ScriptContext) {
    console.log("Server preparing to save...");
  }

  @Event("server_after_save")
  onServerAfterSave(context: ScriptContext) {
    console.log("Server finished saving");
  }

  // Player Events
  @Event("player_joined")
  onPlayerJoined(context: ScriptContext) {
    const { playerId, playerName, x, y, z, dimension } = context.params;
    console.log(`Player ${playerName} joined at ${x}, ${y}, ${z} in ${dimension}`);
  }

  @Event("player_left")
  onPlayerLeft(context: ScriptContext) {
    const { playerId, playerName } = context.params;
    console.log(`Player ${playerName} left the game`);
  }

  @Event("player_death")
  onPlayerDeath(context: ScriptContext) {
    const { playerId, playerName, deathMessage, attackerId, attackerType } = context.params;
    console.log(`Player ${playerName} died: ${deathMessage}`);
  }

  @Event("player_respawned")
  onPlayerRespawn(context: ScriptContext) {
    const { playerId, playerName, alive, x, y, z, dimension } = context.params;
    console.log(`Player ${playerName} respawned at ${x}, ${y}, ${z} in ${dimension}`);
  }

  @Event("player_chat")
  onPlayerChat(context: ScriptContext) {
    const { playerId, playerName, message } = context.params;
    console.log(`${playerName}: ${message}`);
  }

  // Block Events
  @Event("player_break_block_before")
  onBlockBreakBefore(context: ScriptContext) {
    const { playerId, x, y, z, block } = context.params;
    console.log(`Player attempting to break ${block} at ${x}, ${y}, ${z}`);
  }

  @Event("player_break_block_after")
  onBlockBreakAfter(context: ScriptContext) {
    const { playerId, x, y, z, block } = context.params;
    console.log(`Player broke ${block} at ${x}, ${y}, ${z}`);
  }

  @Event("player_break_block_canceled")
  onBlockBreakCanceled(context: ScriptContext) {
    const { playerId, x, y, z, block } = context.params;
    console.log(`Block break cancelled for ${block} at ${x}, ${y}, ${z}`);
  }

  @Event("player_use_block")
  onBlockUse(context: ScriptContext) {
    const { playerId, x, y, z, block } = context.params;
    console.log(`Player used ${block} at ${x}, ${y}, ${z}`);
  }

  // Container Events
  @Event("container_interaction_start")
  onContainerStart(context: ScriptContext) {
    const { playerId, playerName, blockType, x, y, z, dimension } = context.params;
    console.log(`${playerName} opened ${blockType} at ${x}, ${y}, ${z}`);
  }

  @Event("container_interaction_end")
  onContainerEnd(context: ScriptContext) {
    const { playerId, playerName, blockType, x, y, z } = context.params;
    console.log(`${playerName} closed ${blockType}`);
  }

  // Entity Events
  @Event("entity_death")
  onEntityDeath(context: ScriptContext) {
    const { killedEntity, killer, deathMessage } = context.params;
    console.log(`Entity death: ${deathMessage}`);
  }

  @Event("entity_changed_world")
  onEntityWorldChange(context: ScriptContext) {
    const { entityId, entityType, originalWorld, newWorld, x, y, z } = context.params;
    console.log(`${entityType} changed from ${originalWorld} to ${newWorld}`);
  }

  @Event("entity_elytra_check")
  onElytraCheck(context: ScriptContext) {
    const { entityId, entityType } = context.params;
    console.log(`Elytra check for ${entityType}`);
  }

  // Combat Events
  @Event("player_attack_entity")
  onPlayerAttackEntity(context: ScriptContext) {
    const { playerId, entityId, entityType } = context.params;
    console.log(`Player attacked ${entityType}`);
  }

  @Event("projectile_kill")
  onProjectileKill(context: ScriptContext) {
    const { projectileType, ownerId, ownerType, target } = context.params;
    console.log(`${projectileType} from ${ownerType} killed target`);
  }

  // Item Events
  @Event("player_use_item")
  onItemUse(context: ScriptContext) {
    const { playerId, item, count } = context.params;
    console.log(`Player used ${item} (${count})`);
  }

  @Event("inventory_slot_click")
  onInventoryClick(context: ScriptContext) {
    const { playerId, playerName, inventory } = context.params;
    console.log(`${playerName} clicked inventory slot`);
  }

  @Event("item_dropped")
  onItemDrop(context: ScriptContext) {
    const { playerId, item } = context.params;
    console.log(`Player dropped ${item.item} (${item.count})`);
  }

  // Advancement Events
  @Event("advancement_complete")
  onAdvancementComplete(context: ScriptContext) {
    const { playerId, playerName, advancementId, title } = context.params;
    console.log(`${playerName} completed advancement: ${title}`);
  }

  // Experience Events (SPAM)
  // @Event("experience_update")
  // onExperienceUpdate(context: ScriptContext) {
  //   const { playerId, level, progress } = context.params;
  //   console.log(`Player ${playerId} XP update - Level: ${level}, Progress: ${progress}%`);
  // }

  // Trade Events
  @Event("merchant_interaction")
  onMerchantInteraction(context: ScriptContext) {
    const { playerId, merchantId, merchantType } = context.params;
    console.log(`Player ${playerId} interacting with ${merchantId} ${merchantType}`);
  }

  // Weather Events
  // @Event("weather_update")
  // onWeatherUpdate(context: ScriptContext) {
  //   const { dimension, isRaining, isThundering, rainGradient } = context.params;
  //   console.log(`Weather in ${dimension}: Rain: ${isRaining}, Thunder: ${isThundering}`);
  // }

  // Redstone Events
  @Event("redstone_update")
  onRedstoneUpdate(context: ScriptContext) {
    const { x, y, z, power } = context.params;
    console.log(`Redstone power ${power} at ${x}, ${y}, ${z}`);
  }

  // World Events
  @Event("world_load")
  onWorldLoad(context: ScriptContext) {
    const { dimensionKey, time, difficultyLevel } = context.params;
    console.log(`World loaded: ${dimensionKey}`);
  }

  @Event("world_unload")
  onWorldUnload(context: ScriptContext) {
    const { dimensionKey } = context.params;
    console.log(`World unloaded: ${dimensionKey}`);
  }

  // Data Pack Events
  @Event("data_pack_reload_start")
  onDataPackReloadStart(context: ScriptContext) {
    console.log("Data pack reload starting...");
  }

  @Event("data_pack_reload_end")
  onDataPackReloadEnd(context: ScriptContext) {
    const { success } = context.params;
    console.log(`Data pack reload ${success ? "succeeded" : "failed"}`);
  }

  @Event("data_pack_sync")
  onDataPackSync(context: ScriptContext) {
    const { playerId, playerName, joined } = context.params;
    console.log(`Data pack sync for ${playerName} (joined: ${joined})`);
  }

  // Sleep Events
  @Event("entity_start_sleeping")
  onStartSleep(context: ScriptContext) {
    const { entityId, entityType, x, y, z, dimension } = context.params;
    console.log(`${entityType} started sleeping at ${x}, ${y}, ${z}`);
  }

  @Event("entity_stop_sleeping")
  onStopSleep(context: ScriptContext) {
    const { entityId, entityType } = context.params;
    console.log(`${entityType} stopped sleeping`);
  }

  // Command Events
  @Event("command_message")
  onCommandMessage(context: ScriptContext) {
    const { playerId, playerName, message } = context.params;
    console.log(`Command message from ${playerName}: ${message}`);
  }

  @Event("game_message")
  onGameMessage(context: ScriptContext) {
    const { message, overlay } = context.params;
    console.log(`Game message: ${message} (overlay: ${overlay})`);
  }
}
