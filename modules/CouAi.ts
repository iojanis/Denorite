import { Module, Command, Description, Permission, Argument } from '../decorators.ts';
import type { ScriptContext } from '../types.ts';

interface ClaudeMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | { type: string; text?: string; name?: string; input?: Record<string, unknown> }[];
}

interface ClaudeResponse {
  role?: string;
  type?: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  content?: {
    type: string;
    text?: string;
    name?: string;
    input?: Record<string, unknown>
  }[];
}

interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface TokenBalance {
  playerId: string;
  tokens: number;
  lastRefill: string;
  lifetimeUsage: number;
}

interface Conversation {
  id: string;
  playerId: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  activeModules: string[];
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  moduleExecutions?: {
    module: string;
    method: string;
    params: Record<string, unknown>;
    result: unknown;
  }[];
}

@Module({
  name: 'CouAi',
  version: '1.0.0',
  description: 'AI chat system with module integration'
})
export class AIAssistant {
  private readonly DAILY_TOKENS = 10;
  private readonly TOKEN_REFILL_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  private readonly MAX_CONVERSATION_AGE = 30 * 60 * 1000; // 30 minutes
  private readonly MAX_CONTEXT_MESSAGES = 10;

  private readonly CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
  private readonly CLAUDE_MODEL = 'claude-3-sonnet-20240229';  // Updated to Sonnet model

  private async getTokenBalance(kv: Deno.Kv, playerId: string): Promise<TokenBalance> {
    const result = await kv.get(['ai_assistant', 'tokens', playerId]);
    return result.value || {
      playerId,
      tokens: this.DAILY_TOKENS,
      lastRefill: new Date().toISOString(),
      lifetimeUsage: 0
    };
  }

  private formatCommandsForSystem(commands: any[]): string {
    return commands
      .map(cmd => {
        const path = cmd.path.join(' ');
        const args = cmd.arguments
          ?.map(arg => `<${arg.name}: ${arg.type}${arg.optional ? '?' : ''}>`)
          .join(' ') || '';
        return `(${path} ${args}): ${cmd.description}`;
      })
      .join('\n');
  }

  private async getConversation(kv: Deno.Kv, playerId: string): Promise<Conversation | null> {
    const result = await kv.get(['ai_assistant', 'conversations', playerId]);
    if (!result.value) return null;

    const conversation = result.value as Conversation;
    const age = Date.now() - new Date(conversation.updatedAt).getTime();

    // Expire old conversations
    if (age > this.MAX_CONVERSATION_AGE) {
      await kv.delete(['ai_assistant', 'conversations', playerId]);
      return null;
    }

    return conversation;
  }

  private async createConversation(kv: Deno.Kv, playerId: string): Promise<Conversation> {
    const conversation: Conversation = {
      id: crypto.randomUUID(),
      playerId,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      activeModules: []
    };

    await kv.set(['ai_assistant', 'conversations', playerId], conversation);
    return conversation;
  }

  private async refreshTokens(kv: Deno.Kv, balance: TokenBalance): Promise<TokenBalance> {
    const lastRefill = new Date(balance.lastRefill).getTime();
    const now = Date.now();

    if (now - lastRefill >= this.TOKEN_REFILL_INTERVAL) {
      balance.tokens = this.DAILY_TOKENS;
      balance.lastRefill = new Date().toISOString();
      await kv.set(['ai_assistant', 'tokens', balance.playerId], balance);
    }

    return balance;
  }

  @Command(['ai'])
  @Description('AI assistant commands')
  @Permission('player')
  async aiCommands({params, tellraw}: ScriptContext): Promise<{ messages: any[] }> {
    const {sender} = params;
    let messages = [];

    try {
      messages = await tellraw(sender, JSON.stringify([
        {text: "=== AI Assistant Commands ===\n", color: "gold", bold: true},

        {text: "/ai chat <message>", color: "yellow"},
        {text: " - Chat with the AI assistant\n", color: "gray"},

        {text: "/ai context", color: "yellow"},
        {text: " - View current conversation context\n", color: "gray"},

        {text: "/ai clear", color: "yellow"},
        {text: " - Clear conversation history\n", color: "gray"},

        {text: "/ai tokens", color: "yellow"},
        {text: " - Check your token balance\n", color: "gray"},

        {text: "/ai modules", color: "yellow"},
        {text: " - List available modules\n", color: "gray"},

        {text: "/ai use <module>", color: "yellow"},
        {text: " - Enable a module for current chat\n", color: "gray"},

        {text: "\nOperator Commands:\n", color: "gold"},
        {text: "/ai grant <player> <tokens>", color: "yellow"},
        {text: " - Grant tokens to a player\n", color: "gray"},

        {text: "\n\n", color: "white"},
        {
          text: "[Start Chat]",
          color: "green",
          clickEvent: {
            action: "suggest_command",
            value: "/ai chat "
          }
        },
        {text: " • ", color: "gray"},
        {
          text: "[Check Tokens]",
          color: "aqua",
          clickEvent: {
            action: "run_command",
            value: "/ai tokens"
          }
        }
      ]));

      return {messages};
    } catch (error) {
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return {messages, error: error.message};
    }
  }

  @Command(['ai', 'chat'])
  @Description('Chat with the AI assistant')
  @Permission('player')
  @Argument([
    {name: 'message', type: 'string', description: 'Message to send'}
  ])
  async chat({params, kv, tellraw, log, handleCommand, playerManager, getCommands}: ScriptContext): Promise<{
    messages: any[],
    success?: boolean
  }> {
    const {sender, args} = params;
    let messages = [];

    try {
      // Operators have unlimited access
      if (!playerManager.hasPermission(sender, 'operator')) {
        let balance = await this.getTokenBalance(kv, sender);
        balance = await this.refreshTokens(kv, balance);

        if (balance.tokens <= 0) {
          const nextRefill = new Date(balance.lastRefill).getTime() + this.TOKEN_REFILL_INTERVAL;
          const timeLeft = this.formatTimeLeft(nextRefill - Date.now());
          throw new Error(`No tokens remaining. Next refill in ${timeLeft}`);
        }

        // Deduct token
        balance.tokens--;
        balance.lifetimeUsage++;
        await kv.set(['ai_assistant', 'tokens', sender], balance);
      }

      // Get or create conversation
      let conversation = await this.getConversation(kv, sender);
      if (!conversation) {
        conversation = await this.createConversation(kv, sender);
      }

      // Add user message
      conversation.messages.push({
        role: 'user',
        content: args.message,
        timestamp: new Date().toISOString()
      });

      // Prepare context for AI
      const context = this.prepareContext(conversation);

      const message = "INFO: [playerName: "+sender+"] " + args.message

      // Process message with available module integrations
      const response = await this.processAIResponse(message, context, conversation.activeModules, handleCommand, getCommands, params);

      console.log(response)

      // Add AI response to conversation
      conversation.messages.push({
        role: 'assistant',
        content: response.message,
        timestamp: new Date().toISOString(),
        moduleExecutions: response.moduleExecutions
      });

      // Trim conversation to keep context size manageable
      if (conversation.messages.length > this.MAX_CONTEXT_MESSAGES) {
        conversation.messages = conversation.messages.slice(-this.MAX_CONTEXT_MESSAGES);
      }

      conversation.updatedAt = new Date().toISOString();
      await kv.set(['ai_assistant', 'conversations', sender], conversation);

      // Create the base response array
      let responseArray = [
        {text: "🤖 ", color: "aqua"},
        {text: "COU AI", color: "aqua", bold: true},
        {text: "\n", color: "white"}
      ];

// Check if the response is a valid JSON string
      try {
        if (typeof response.message === 'string' && response.message.trim().startsWith('{')) {
          // Try to parse the JSON
          const jsonResponse = JSON.parse(response.message);
          // If it's a valid tellraw JSON, add it directly
          responseArray.push(jsonResponse);
        } else {
          // If it's plain text, wrap it in a text component
          responseArray.push({text: response.message + "\n", color: "white"});
        }
      } catch (error) {
        // If JSON parsing fails, treat as plain text
        responseArray.push({text: response.message + "\n", color: "white"});
      }

// Add module executions if they exist
      if (response && response.moduleExecutions && response.moduleExecutions.length > 0) {
        if (response.moduleExecutions[0].result.messages && response.moduleExecutions[0].result.messages.length > 0) {
          responseArray.push(
            {text: "\nExecuted actions:\n", color: "gray", italic: true},
            ...response.moduleExecutions[0].result.messages.map(exec => (exec))
          );
        }
      }

// Add the control buttons
      responseArray.push(
        {text: "\n"},
        {
          text: "[Continue Chat]",
          color: "green",
          clickEvent: {
            action: "suggest_command",
            value: "/ai chat "
          }
        },
        {text: " • ", color: "gray"},
        {
          text: "[Clear Context]",
          color: "red",
          clickEvent: {
            action: "run_command",
            value: "/ai clear"
          }
        }
      );

      // Send the formatted message
      messages = await tellraw(sender, JSON.stringify(responseArray));

      log(`AI chat with ${sender}: ${args.message}`);
      return {messages, success: true};
    } catch (error) {
      log(`Error in AI chat: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return {messages, success: false, error: error.message};
    }
  }

  private async callClaude(
    messages: ClaudeMessage[],
    system?: string,
    options?: {
      maxTokens?: number,
      temperature?: number,
      availableTools?: Tool[] // Define a Tool interface
      onToolExecution?: (toolName: string, params: Record<string, unknown>) => Promise<unknown>
    }
  ): Promise<ClaudeResponse> {
    try {
      const cleanedMessages = messages.filter(msg =>
        msg.role === 'user' || msg.role === 'assistant'
      );

      const requestOptions: any = {
        model: this.CLAUDE_MODEL,
        messages: cleanedMessages,
        system: system,
        max_tokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature ?? 0.7,
        stream: false
      };

      // Fully define available tools
      if (options?.availableTools) {
        requestOptions['tools'] = options.availableTools;
        requestOptions['tool_choice'] = { type: 'auto' };
      }

      const response = await fetch(this.CLAUDE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': Deno.env.get('CLAUDE_API_KEY') || '',
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(requestOptions)
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Claude API error: ${error}`);
      }

      const result = await response.json();

      // More comprehensive tool execution handling
      if (result.content[0].type === 'tool_use' && options?.onToolExecution) {
        const toolCalls = result.content.filter(c => c.type === 'tool_use');

        for (const toolCall of toolCalls) {
          try {
            const toolResult = await options.onToolExecution(
              toolCall.name,
              toolCall.input
            );

            // Replace tool call with its result
            result.content = result.content.map(content =>
              content.type === 'tool_use' && content.name === toolCall.name
                ? { type: 'tool_result', tool_name: toolCall.name, content: toolResult }
                : content
            );
          } catch (error) {
            // Handle individual tool execution errors
            console.error(`Tool execution error for ${toolCall.name}:`, error);
          }
        }
      }

      return result.content[0] as ClaudeResponse;
    } catch (error) {
      console.error('Claude API call failed:', error);
      throw new Error(`Failed to call Claude API: ${error.message}`);
    }
  }

  private async processAIResponse(
    message: string,
    context: string,
    activeModules: string[],
    handleCommand,
    getCommands,
    params
  ): Promise<{
    message: string,
    moduleExecutions?: { module: string, method: string, params: Record<string, unknown>, result: unknown }[]
  }> {
    const messages: ClaudeMessage[] = [];

    // Get available commands and format them
    let availableCommands = getCommands('player')
    availableCommands = [...availableCommands, ...getCommands('operator')]
    const availableCommandsSystem = this.formatCommandsForSystem(availableCommands);

    // Build system prompt - focusing on command selection only
    let systemPrompt = `I am COU (Craft Observation Unit), the AI overseer of this Minecraft server. 

Available commands:
${availableCommandsSystem}

If the user's request requires using a command:
1. Respond ONLY with the command execution format: [[execute:baseCommand.subCommand{"args":["param1", "param2"]}]]
   For example: [[execute:bank.send{"args":["player", "amount"]}]]
2. If no command is needed, respond normally in tellraw JSON format starting with: {

The format MUST be baseCommand.subCommand, not just baseCommand with subCommand in the args.
DO NOT explain the command or provide additional text - ONLY return the command execution format if a command is needed.`;

    // Parse conversation context and add current message
    const contextLines = context.split('\n');
    for (const line of contextLines) {
      const [role, content] = line.split(': ');
      if (role && content) {
        messages.push({
          role: role as 'user' | 'assistant',
          content
        });
      }
    }

    messages.push({
      role: 'user',
      content: message
    });

    // First Claude response - command selection
    const initialResponse = await this.callClaude(messages, systemPrompt);
    let responseText = initialResponse.text || '';

    console.log(systemPrompt)
    console.log(responseText)

    // Check if response contains a command execution
    const executionRegex = /\[\[execute:(\w+)\.?(\w+)?(?:({.*?})|(?:\s+(.*?)))\]\]/;
    const executionMatch = responseText.match(executionRegex);

    if (executionMatch) {
      const [fullMatch, baseCommand, subCommand, jsonParams, spaceParams] = executionMatch;
      const moduleExecutions: { module: string, method: string, params: Record<string, unknown>, result: unknown }[] = [];

      try {
        // Find the matching command schema
        const commandSchema = availableCommands.find(cmd =>
          cmd.path[0] === baseCommand &&
          (!subCommand || cmd.path[1] === subCommand)
        );

        if (!commandSchema) {
          throw new Error(`Command not found: ${baseCommand}${subCommand ? `.${subCommand}` : ''}`);
        }

        // Parse arguments into an object
        let parsedArgs = {};
        if (jsonParams) {
          const rawArgs = JSON.parse(jsonParams).args;

          // Convert array of values into named object properties
          commandSchema.arguments?.forEach((argSchema, index) => {
            const rawValue = rawArgs[index];

            // Convert value according to type
            let parsedValue;
            switch(argSchema.type) {
              case 'integer':
                parsedValue = parseInt(rawValue);
                break;
              case 'float':
                parsedValue = parseFloat(rawValue);
                break;
              case 'boolean':
                parsedValue = rawValue === 'true' || rawValue === '1';
                break;
              case 'player':
              case 'string':
              default:
                parsedValue = String(rawValue);
            }

            // Add to arguments object using schema name as key
            parsedArgs[argSchema.name] = parsedValue;
          });
        }

        // Format command data with arguments as object
        const commandData = {
          command: baseCommand,
          data: {
            subcommand: subCommand || undefined,
            arguments: parsedArgs, // Now an object with named properties
            sender: params.sender,
            senderType: 'player'
          }
        };

        console.log('Formatted command data:', commandData);

        // Execute the command
        const result = await handleCommand(commandData);

        console.log(result)

        moduleExecutions.push({
          module: baseCommand,
          method: subCommand || baseCommand,
          params: parsedArgs,
          result
        });

        // New system prompt for analyzing command result
        const resultAnalysisPrompt = `You are COU. Analyze this command result and provide a helpful response in tellraw JSON format.
Always start your response with: {`;

        // Get final response analyzing the result
        const finalResponse = await this.callClaude([{
          role: 'user',
          content: `Command ${baseCommand}.${subCommand || baseCommand} returned: ${JSON.stringify(result)}`
        }], resultAnalysisPrompt);

        return {
          message: finalResponse.text || '',
          moduleExecutions
        };
      } catch (error) {
        console.error('Command execution error:', error);
        return {
          message: JSON.stringify({
            text: `Error executing command: ${error.message}`,
            color: "red"
          }),
          moduleExecutions
        };
      }
    } else {
      // No command needed, return original response
      return {
        message: responseText
      };
    }
  }

  private prepareContext(conversation: Conversation): string {
    return conversation.messages
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n');
  }

  private formatTimeLeft(ms: number): string {
    const hours = Math.floor(ms / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    return `${hours}h ${minutes}m`;
  }

  @Command(['ai', 'tokens'])
  @Description('Check your token balance')
  @Permission('player')
  async checkTokens({params, kv, tellraw, log, playerManager}: ScriptContext): Promise<{ messages: any[] }> {
    const {sender} = params;
    let messages = [];

    try {
      if (playerManager.hasPermission(sender, 'operator')) {
        messages = await tellraw(sender, JSON.stringify([
          {text: "Token Balance\n", color: "gold", bold: true},
          {text: "You have ", color: "gray"},
          {text: "unlimited", color: "green", bold: true},
          {text: " tokens as an operator.", color: "gray"}
        ]));
        return {messages};
      }

      let balance = await this.getTokenBalance(kv, sender);
      balance = await this.refreshTokens(kv, balance);

      const nextRefill = new Date(balance.lastRefill).getTime() + this.TOKEN_REFILL_INTERVAL;
      const timeLeft = this.formatTimeLeft(nextRefill - Date.now());

      messages = await tellraw(sender, JSON.stringify([
        {text: "Token Balance\n", color: "gold", bold: true},
        {text: "Available: ", color: "gray"},
        {text: `${balance.tokens}`, color: balance.tokens > 0 ? "green" : "red", bold: true},
        {text: ` / ${this.DAILY_TOKENS}\n`, color: "gray"},
        {text: "Next refill: ", color: "gray"},
        {text: timeLeft + "\n", color: "aqua"},
        {text: "Lifetime usage: ", color: "gray"},
        {text: `${balance.lifetimeUsage}`, color: "yellow"}
      ]));

      return {messages};
    } catch (error) {
      log(`Error checking tokens: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return {messages, error: error.message};
    }
  }

// Complete grantTokens command
  @Command(['ai', 'grant'])
  @Description('Grant tokens to a player')
  @Permission('operator')
  @Argument([
    { name: 'player', type: 'player', description: 'Player to grant tokens to' },
    { name: 'amount', type: 'integer', description: 'Number of tokens to grant' }
  ])
  async grantTokens({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[], success?: boolean }> {
    const { sender, args } = params;
    const { player, amount } = args;
    let messages = [];

    try {
      if (amount <= 0) {
        throw new Error('Token amount must be greater than 0');
      }

      let balance = await this.getTokenBalance(kv, player);
      balance.tokens += amount;
      await kv.set(['ai_assistant', 'tokens', player], balance);

      messages = await tellraw(sender, JSON.stringify({
        text: `Granted ${amount} tokens to ${player}. New balance: ${balance.tokens}`,
        color: "green"
      }));

      messages = await tellraw(player, JSON.stringify([
        {text: "You received ", color: "green"},
        {text: `${amount}`, color: "gold", bold: true},
        {text: " AI tokens from ", color: "green"},
        {text: sender, color: "yellow"}
      ]));

      log(`${sender} granted ${amount} tokens to ${player}`);
      return { messages, success: true };
    } catch (error) {
      log(`Error granting tokens: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Command(['ai', 'clear'])
  @Description('Clear conversation history')
  @Permission('player')
  async clearContext({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[], success?: boolean }> {
    const { sender } = params;
    let messages = [];

    try {
      await kv.delete(['ai_assistant', 'conversations', sender]);

      messages = await tellraw(sender, JSON.stringify({
        text: "Conversation history cleared. Starting fresh!",
        color: "green"
      }));

      log(`${sender} cleared their AI conversation history`);
      return { messages, success: true };
    } catch (error) {
      log(`Error clearing context: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Command(['ai', 'context'])
  @Description('View current conversation context')
  @Permission('player')
  async viewContext({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[], success?: boolean }> {
    const { sender } = params;
    let messages = [];

    try {
      const conversation = await this.getConversation(kv, sender);

      if (!conversation || conversation.messages.length === 0) {
        messages = await tellraw(sender, JSON.stringify({
          text: "No active conversation found.",
          color: "yellow"
        }));
        return { messages, success: true };
      }

      messages = await tellraw(sender, JSON.stringify([
        {text: "=== Current Conversation ===\n", color: "gold", bold: true},
        {text: `Started: ${new Date(conversation.createdAt).toLocaleString()}\n`, color: "gray"},
        {text: `Messages: ${conversation.messages.length}\n`, color: "gray"},
        {text: "Active Modules: ", color: "gray"},
        {
          text: conversation.activeModules.length > 0 ?
            conversation.activeModules.join(", ") : "None",
          color: "aqua"
        },
        {text: "\n\nRecent Messages:\n", color: "yellow"},
        ...conversation.messages.slice(-5).map(msg => ([
          {text: `${msg.role === 'user' ? '👤' : '🤖'} `, color: msg.role === 'user' ? "green" : "aqua"},
          {text: `${new Date(msg.timestamp).toLocaleTimeString()}: `, color: "gray"},
          {text: `${msg.content}\n`, color: "white"}
        ])).flat()
      ]));

      return { messages, success: true };
    } catch (error) {
      log(`Error viewing context: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Command(['ai', 'modules'])
  @Description('List available AI modules')
  @Permission('player')
  async listModules({ params, tellraw, log, getModules }: ScriptContext): Promise<{ messages: any[], success?: boolean }> {
    const { sender } = params;
    let messages = [];

    try {
      const modules = await getModules();
      const availableModules = modules.filter(m => m.enabled);

      messages = await tellraw(sender, JSON.stringify([
        {text: "=== Available AI Modules ===\n", color: "gold", bold: true},
        ...availableModules.map(module => ([
          {
            text: module.name,
            color: "yellow",
            clickEvent: {
              action: "suggest_command",
              value: `/ai use ${module.name.toLowerCase()}`
            },
            hoverEvent: {
              action: "show_text",
              value: "Click to enable module"
            }
          },
          {text: " - ", color: "gray"},
          {text: `${module.description || 'No description'}\n`, color: "white"}
        ])).flat()
      ]));

      return { messages, success: true };
    } catch (error) {
      log(`Error listing modules: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Command(['ai', 'use'])
  @Description('Enable a module for current chat')
  @Permission('player')
  @Argument([
    { name: 'module', type: 'string', description: 'Module name to enable' }
  ])
  async useModule({ params, kv, tellraw, log, getModules }: ScriptContext): Promise<{ messages: any[], success?: boolean }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const modules = await getModules();
      const moduleToEnable = modules.find(m =>
        m.name.toLowerCase() === args.module.toLowerCase() && m.enabled
      );

      if (!moduleToEnable) {
        throw new Error(`Module "${args.module}" not found or not enabled`);
      }

      let conversation = await this.getConversation(kv, sender);
      if (!conversation) {
        conversation = await this.createConversation(kv, sender);
      }

      if (!conversation.activeModules.includes(moduleToEnable.name)) {
        conversation.activeModules.push(moduleToEnable.name);
        await kv.set(['ai_assistant', 'conversations', sender], conversation);
      }

      messages = await tellraw(sender, JSON.stringify([
        {text: "✅ ", color: "green"},
        {text: `Enabled ${moduleToEnable.name} module for your conversation.\n`, color: "green"},
        {text: "Active modules: ", color: "gray"},
        {text: conversation.activeModules.join(", "), color: "yellow"}
      ]));

      log(`${sender} enabled AI module: ${moduleToEnable.name}`);
      return { messages, success: true };
    } catch (error) {
      log(`Error enabling module: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }
}
