import { Module, Command, Description, Permission, Socket, Argument, Event } from '../decorators.ts';
import type { ScriptContext } from '../types'

interface ChatMessage {
  type: 'chat' | 'join' | 'leave' | 'death' | 'system'
  player?: string
  message: string
  timestamp: number
}

@Module({
  name: 'Chat',
  version: '1.0.0'
})
export class ChatModule {
  // Handle player join event
  @Event('player_joined')
  async handlePlayerJoin(context: ScriptContext) {
    const { params, broadcastPlayers } = context
    await broadcastPlayers({
      type: 'chat',
      player: params.playerName,
      message: `${params.playerName} joined the game`,
      timestamp: Date.now()
    })
  }

  // Handle player leave event
  @Event('player_left')
  async handlePlayerLeave(context: ScriptContext) {
    const { params, broadcastPlayers } = context
    await broadcastPlayers({
      type: 'chat',
      player: params.playerName,
      message: `${params.playerName} left the game`,
      timestamp: Date.now()
    })
  }

  // Handle player death event
  @Event('player_death')
  async handlePlayerDeath(context: ScriptContext) {
    const { params,broadcastPlayers} = context
    await broadcastPlayers({
      type: 'chat',
      player: params.playerName,
      message: params.deathMessage,
      timestamp: Date.now()
    })
  }

  // Handle player chat event
  @Event('player_chat')
  async handlePlayerChat(context: ScriptContext) {
    const { params, broadcastPlayers } = context
    await broadcastPlayers({
      type: 'chat',
      player: params.playerName,
      message: params.message,
      timestamp: Date.now()
    })
  }

  @Description('Send a chat message')
  @Permission('player')
  @Socket('send_chat')
  async sendChat(context: ScriptContext) {
    const { params, sender } = context

    if (!params.sender || !params?.message) {
      throw new Error('Invalid message or unauthorized')
    }

    // Send the message to Minecraft server
    await context.api.tellraw('@a', JSON.stringify({
      text: `<${params.sender}> ${params.message}`,
      color: 'white'
    }))

    return { success: true }
  }
}
