import { Module, Command, Description, Permission, Event } from '../decorators.ts';
import { ScriptContext } from '../types.ts';

@Module({
  name: 'ChunkGenTeleport',
  version: '1.0.0'
})
export class ChunkGenTeleport {
  private readonly TELEPORT_DELAY = 3000; // 3 seconds
  private readonly SPACING = 128; // Distance between teleports (8 chunks)
  private readonly CENTER_X = 15360; // (30719 / 2)
  private readonly CENTER_Z = 7999;  // (15997 / 2)
  private activeGenerators: Map<string, { active: boolean; step: number }> = new Map();

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getSquareSpiral(step: number): { x: number, z: number } {
    // Convert step number to square spiral coordinates
    let x = 0;
    let z = 0;
    let layer = 0;

    if (step > 0) {
      layer = Math.floor((Math.sqrt(step + 1) - 1) / 2) + 1;
      let position = step - (4 * layer * layer - 4 * layer);
      let side = position / (2 * layer);

      switch (Math.floor(side)) {
        case 0: // right side
          x = layer;
          z = position - layer;
          break;
        case 1: // top side
          x = layer - (position - 2 * layer);
          z = layer;
          break;
        case 2: // left side
          x = -layer;
          z = layer - (position - 4 * layer);
          break;
        case 3: // bottom side
          x = -layer + (position - 6 * layer);
          z = -layer;
          break;
      }
    }

    return {
      x: this.CENTER_X + (x * this.SPACING),
      z: this.CENTER_Z + (z * this.SPACING)
    };
  }

  @Event('player_joined')
  async handlePlayerJoined({ params, log, kv, api }: ScriptContext): Promise<void> {
    const { playerName } = params;

    try {
      // Check if player was running generation before
      const savedState = await kv.get<{ step: number }>(['chunkgen', playerName]);

      if (savedState.value) {
        log(`Restoring chunk generation state for ${playerName}`);
        this.activeGenerators.set(playerName, {
          active: true,
          step: savedState.value.step
        });

        await api.executeCommand(
          `tellraw ${playerName} {"text":"Resuming chunk generation...","color":"green"}`
        );

        // Resume generation after a short delay to ensure player is loaded
        setTimeout(() => {
          this.resumeGeneration({ sender: playerName, api, log });
        }, 5000);
      }
    } catch (error) {
      log(`Error handling player join for ${playerName}: ${error}`);
    }
  }

  @Event('player_left')
  async handlePlayerLeft({ params, log, kv }: ScriptContext): Promise<void> {
    const { playerName } = params;

    try {
      const genState = this.activeGenerators.get(playerName);
      if (genState?.active) {
        // Save current generation state
        await kv.set(['chunkgen', playerName], {
          step: genState.step
        });
        log(`Saved generation state for ${playerName} at step ${genState.step}`);
      }
    } catch (error) {
      log(`Error handling player leave for ${playerName}: ${error}`);
    }
  }

  private async resumeGeneration({ sender, api, log }: { sender: string, api: any, log: (msg: string) => void }): Promise<void> {
    const state = this.activeGenerators.get(sender);
    if (!state?.active) return;

    try {
      while (this.activeGenerators.get(sender)?.active) {
        const pos = this.getSquareSpiral(state.step);

        // Teleport player keeping their current Y position
        await api.teleport(sender, pos.x, '~', pos.z);

        // Log progress every 100 steps
        if (state.step % 100 === 0) {
          log(`Generation progress - Step: ${state.step}, Position: ${pos.x}, ${pos.z}`);
          await api.executeCommand(
            `tellraw ${sender} {"text":"Generated position: ${pos.x}, ${pos.z}","color":"gray"}`
          );
        }

        await this.sleep(this.TELEPORT_DELAY);
        state.step++;
      }
    } catch (error) {
      log(`Error resuming generation for ${sender}: ${error}`);
      this.activeGenerators.delete(sender);
      await api.executeCommand(
        `tellraw ${sender} {"text":"Error during chunk generation: ${error}","color":"red"}`
      );
    }
  }

  @Command(['gen', 'start'])
  @Description('Start continuous chunk generation teleport')
  @Permission('operator')
  async startGeneration({ params, api, log }: ScriptContext): Promise<void> {
    const { sender } = params;

    if (this.activeGenerators.get(sender)?.active) {
      await api.executeCommand(
        `tellraw ${sender} {"text":"Chunk generation is already running!","color":"red"}`
      );
      return;
    }

    try {
      // First teleport to map center, keeping Y position
      await api.teleport(sender, this.CENTER_X, '~', this.CENTER_Z);
      await this.sleep(this.TELEPORT_DELAY);

      this.activeGenerators.set(sender, {
        active: true,
        step: 0
      });

      await api.executeCommand(
        `tellraw ${sender} {"text":"Starting chunk generation from map center. Use /gen stop to stop.","color":"green"}`
      );

      await this.resumeGeneration({ sender, api, log });

    } catch (error) {
      log(`Error in chunk generation for ${sender}: ${error}`);
      this.activeGenerators.delete(sender);
      await api.executeCommand(
        `tellraw ${sender} {"text":"Error during chunk generation: ${error}","color":"red"}`
      );
    }
  }

  @Command(['gen', 'stop'])
  @Description('Stop continuous chunk generation teleport')
  @Permission('operator')
  async stopGeneration({ params, api, kv }: ScriptContext): Promise<void> {
    const { sender } = params;

    const state = this.activeGenerators.get(sender);
    if (state?.active) {
      state.active = false;
      this.activeGenerators.delete(sender);
      // Clean up saved state
      await kv.delete(['chunkgen', sender]);
      await api.executeCommand(
        `tellraw ${sender} {"text":"Stopping chunk generation.","color":"green"}`
      );
    } else {
      await api.executeCommand(
        `tellraw ${sender} {"text":"No active chunk generation to stop.","color":"red"}`
      );
    }
  }

  @Command(['gen', 'status'])
  @Description('Check chunk generation status')
  @Permission('operator')
  async generationStatus({ params, api }: ScriptContext): Promise<void> {
    const { sender } = params;

    const state = this.activeGenerators.get(sender);
    const isActive = state?.active ?? false;
    const stepInfo = state ? ` (Step: ${state.step})` : '';

    await api.executeCommand(
      `tellraw ${sender} {"text":"Chunk generation is currently ${isActive ? 'active' : 'inactive'}${stepInfo}","color":"green"}`
    );
  }
}
