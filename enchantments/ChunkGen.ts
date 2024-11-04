import { Module, Command, Description, Permission } from '../decorators.ts';
import { ScriptContext } from '../types.ts';

@Module({
  name: 'ChunkGenTeleport',
  version: '1.0.0'
})
export class ChunkGenTeleport {
  private readonly TELEPORT_DELAY = 3000; // 3 seconds
  private readonly SPACING = 32; // Distance between teleports (2 chunks)
  private activeGenerators: Map<string, boolean> = new Map();

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private calculateSpiralOffset(step: number): { x: number, z: number } {
    // Calculate spiral position using parametric equations
    const angle = 0.5 * step;
    const radius = this.SPACING * (angle / (2 * Math.PI));

    return {
      x: Math.floor(radius * Math.cos(angle)),
      z: Math.floor(radius * Math.sin(angle))
    };
  }

  @Command(['gen', 'start'])
  @Description('Start continuous chunk generation teleport')
  @Permission('operator')
  async startGeneration({ params, api, log }: ScriptContext): Promise<void> {
    const { sender } = params;

    if (this.activeGenerators.get(sender)) {
      await api.executeCommand(
        `tellraw ${sender} {"text":"Chunk generation is already running!","color":"red"}`
      );
      return;
    }

    try {
      this.activeGenerators.set(sender, true);
      await api.executeCommand(
        `tellraw ${sender} {"text":"Starting chunk generation. Use /stopgen to stop.","color":"green"}`
      );

      let step = 0;

      while (this.activeGenerators.get(sender)) {
        const offset = this.calculateSpiralOffset(step);

        // Teleport player using relative coordinates
        await api.teleport(sender, `~${offset.x}`, `~`, `~${offset.z}`);

        // Log progress every 100 steps
        if (step % 100 === 0) {
          log(`Generation progress - Step: ${step}, Offset: ${offset.x}, ${offset.z}`);
          await api.executeCommand(
            `tellraw ${sender} {"text":"Generated offset: ${offset.x}, ${offset.z}","color":"gray"}`
          );
        }

        await this.sleep(this.TELEPORT_DELAY);
        step++;
      }

    } catch (error) {
      log(`Error in chunk generation for ${sender}: ${error}`);
      this.activeGenerators.delete(sender);
      await api.executeCommand(
        `tellraw ${sender} {"text":"Error during chunk generation: ${error.message}","color":"red"}`
      );
    }
  }

  @Command(['gen', 'stop'])
  @Description('Stop continuous chunk generation teleport')
  @Permission('operator')
  async stopGeneration({ params, api }: ScriptContext): Promise<void> {
    const { sender } = params;

    if (this.activeGenerators.get(sender)) {
      this.activeGenerators.delete(sender);
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

    const isActive = this.activeGenerators.get(sender);
    await api.executeCommand(
      `tellraw ${sender} {"text":"Chunk generation is currently ${isActive ? 'active' : 'inactive'}","color":"${isActive ? 'green' : 'red'}"}`
    );
  }
}
