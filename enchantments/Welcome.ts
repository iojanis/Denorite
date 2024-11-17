import { Module, Command, Description, Permission, Socket, Event } from '../decorators.ts';
import { ScriptContext } from '../types.ts';

@Module({
  name: 'Welcome',
  version: '1.0.0'
})
export class Welcome {

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async getPlayerData(playerName: string, kv: ScriptContext['kv']): Promise<any | null> {
    const [firstJoin, lastSeen, totalPlayTime, loginCount] = await Promise.all([
      kv.get<string>(['player', playerName, 'firstJoin']),
      kv.get<string>(['player', playerName, 'lastSeen']),
      kv.get<number>(['player', playerName, 'totalPlayTime']),
      kv.get<number>(['player', playerName, 'loginCount'])
    ]);

    if (!firstJoin.value) return null;

    return {
      username: playerName,
      firstJoin: firstJoin.value,
      lastSeen: lastSeen.value,
      stats: {
        totalPlayTime: totalPlayTime.value || 0,
        loginCount: loginCount.value || 0
      }
    };
  }

  private async getLastSession(playerName: string, kv: ScriptContext['kv']): Promise<any | null> {
    const sessionsIterator = kv.list<any>({ prefix: ['player', playerName, 'sessions'], reverse: true, limit: 1 });
    for await (const session of sessionsIterator) {
      return session.value;
    }
    return null;
  }

  private getTimeSinceLastSeen(lastSeen: string): string {
    try {
      const lastSeenDate = new Date(lastSeen);
      const now = new Date();

      // Check if the lastSeenDate is valid
      if (isNaN(lastSeenDate.getTime())) {
        console.error(`Invalid lastSeen date: ${lastSeen}`);
        return "an unknown amount of time";
      }

      const diffSeconds = Math.max(0, Math.floor((now.getTime() - lastSeenDate.getTime()) / 1000));

      if (diffSeconds === 0) {
        return "just now";
      }

      return this.formatDuration(diffSeconds);
    } catch (error) {
      console.error(`Error calculating time since last seen: ${error}`);
      return "an unknown amount of time";
    }
  }

  private formatDuration(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    const parts = [];
    if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
    if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
    if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);

    return parts.length > 0 ? parts.join(', ') : "less than a minute";
  }

  private async sendWelcomeMessage(playerName: string, message: string, api: ScriptContext['api']) {
    await api.executeCommand(`tellraw ${playerName} {"text":"${message}","color":"gold"}`);
  }

  @Event('player_joined')
  async handlePlayerJoined({ params, kv, log, api }: ScriptContext): Promise<void> {
    const { playerId, playerName } = params;

    log(`Welcoming player: ${playerName} (ID: ${playerId})`);

    await this.delay(100);

    try {
      const playerData = await this.getPlayerData(playerName, kv);

      if (!playerData) {
        // New player
        await this.sendWelcomeMessage(playerName, `Welcome to the server, ${playerName}! We hope you enjoy your stay!`, api);
        return;
      }

      // Returning player
      const timeSinceLastSeen = playerData.lastSeen ? this.getTimeSinceLastSeen(playerData.lastSeen) : 'some time';
      const totalPlayTime = playerData.stats.totalPlayTime ? this.formatDuration(playerData.stats.totalPlayTime) : 'an unknown amount of time';
      const loginCount = playerData.stats.loginCount || 1;

      let welcomeMessage = `Hello, ${playerName}! `;
      welcomeMessage += `It's been ${timeSinceLastSeen} since we last saw you. `;
      // welcomeMessage += `You've played for a total of ${totalPlayTime}. `;
      welcomeMessage += `This is your ${loginCount}${this.getOrdinalSuffix(loginCount)} login.`;

      await this.sendWelcomeMessage(playerName, welcomeMessage, api);

      const lastSession = await this.getLastSession(playerName, kv);
      if (lastSession && lastSession.endLocation) {
        const lastLocation = lastSession.endLocation;
        const locationMessage = `Your last known location was at x: ${Math.floor(lastLocation.x)}, y: ${Math.floor(lastLocation.y)}, z: ${Math.floor(lastLocation.z)} in ${lastLocation.dimension}.`;
        // await this.sendWelcomeMessage(playerName, locationMessage, api);
      }

      // Server announcements or tips
      // await this.sendServerAnnouncements(playerName, api);

    } catch (error) {
      log(`Error in handlePlayerJoined for ${playerName} (ID: ${playerId}): ${error}`);
      await this.sendWelcomeMessage(playerName, `Welcome, ${playerName}! We're glad to see you!`, api);
    }
  }

  private getOrdinalSuffix(n: number): string {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return (s[(v - 20) % 10] || s[v] || s[0]);
  }

  private async sendServerAnnouncements(playerName: string, api: ScriptContext['api']) {
    const announcements = [
      "Don't forget to check out our new minigame area at spawn!",
      "Join our community Discord server for the latest updates and events!",
      "Remember to use /sethome to set your home point for easy teleportation.",
      "Looking for a challenge? Try our parkour course at x: 100, y: 64, z: -200!",
    ];

    const randomAnnouncement = announcements[Math.floor(Math.random() * announcements.length)];
    await this.sendWelcomeMessage(playerName, `Server Announcement: ${randomAnnouncement}`, api);
  }

  @Command(['welcome'])
  @Description('Display your welcome message and stats')
  @Permission('player')
  async welcomeCommand({ params, kv, api, log }: ScriptContext): Promise<void> {
    const { sender } = params;

    try {
      const playerData = await this.getPlayerData(sender, kv);
      if (!playerData) {
        await this.sendWelcomeMessage(sender, "Welcome! It looks like you're new here. Enjoy your stay!", api);
        return;
      }

      const timeSinceFirstJoin = this.getTimeSinceLastSeen(playerData.firstJoin);
      const totalPlayTime = this.formatDuration(playerData.stats.totalPlayTime);
      const loginCount = playerData.stats.loginCount;

      let welcomeMessage = `Welcome, ${sender}! `;
      welcomeMessage += `You first joined ${timeSinceFirstJoin} ago. `;
      welcomeMessage += `You've played for a total of ${totalPlayTime}. `;
      welcomeMessage += `This is your ${loginCount}${this.getOrdinalSuffix(loginCount)} login.`;

      await this.sendWelcomeMessage(sender, welcomeMessage, api);

    } catch (error) {
      log(`Error in welcomeCommand for ${sender}: ${error}`);
      await api.executeCommand(`tellraw ${sender} {"text":"Error retrieving welcome data.","color":"red"}`);
    }
  }
}
