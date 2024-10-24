// main.ts
import { encode as base64Encode, decode as base64Decode } from "https://deno.land/std@0.177.0/encoding/base64.ts";
import "jsr:@std/dotenv/load";

import { ConfigManager } from "./core/configManager.ts";
import { KvManager } from "./core/kvManager.ts";
import { Logger } from "./core/logger.ts";
import { AuthService } from "./core/authService.ts";
import { ScriptManager } from "./core/scriptManager.ts";
import { WebSocketManager } from "./core/webSocketManager.ts";

// Default configuration
const DEFAULT_CONFIG = {
  MINECRAFT_WS_PORT: 8082,
  PLAYER_WS_PORT: 8081,
  COMMAND_TIMEOUT: 5000,
  LOG_LEVEL: 'info',
  RATE_LIMIT_TOKENS: 10,
  RATE_LIMIT_INTERVAL: 1000,
  RATE_LIMIT_BURST: 20,
  ALLOWED_ORIGIN: 'http://localhost'
};

async function loadOrGenerateJwtSecret(envVarName: string): Promise<CryptoKey> {
  let secretString = Deno.env.get(envVarName);

  if (!secretString) {
    // Generate a new secret if it doesn't exist
    const newSecret = crypto.getRandomValues(new Uint8Array(32)); // 256 bits for SHA-256
    secretString = base64Encode(newSecret);

    // Set the new secret in the environment
    Deno.env.set(envVarName, secretString);

    console.log(`New JWT secret generated for ${envVarName}`);
    console.log(`Please add the following line to your .env file:`);
    console.log(`${envVarName}="${secretString}"`);
  }

  // Decode the base64 secret string
  const secretBuffer = base64Decode(secretString);

  // Import the secret as a CryptoKey
  return await crypto.subtle.importKey(
    "raw",
    secretBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function main() {
  const logger = new Logger();

  const kvManager = new KvManager(logger);
  await kvManager.init();

  const configManager = new ConfigManager(kvManager, logger);
  await configManager.init(DEFAULT_CONFIG);

  // Load JWT secrets
  const denoriteSecret = await loadOrGenerateJwtSecret("DENORITE_SECRET");
  const jwtSecret = await loadOrGenerateJwtSecret("JWT_SECRET");

  const authService = new AuthService(configManager, kvManager, logger, jwtSecret, denoriteSecret);

  const scriptManager = new ScriptManager(configManager, kvManager, logger, authService);
  await scriptManager.init();
  await scriptManager.loadModules(); // Added this line to load modules

  const wsManager = new WebSocketManager(configManager, scriptManager, logger, authService);
  await wsManager.init();

  const minecraftWsPort = await configManager.get('MINECRAFT_WS_PORT') as number;
  const playerWsPort = await configManager.get('PLAYER_WS_PORT') as number;

  // Generate and log a Denorite server token
  const serverToken = await authService.createDenoriteToken(360 * 24 * 60 * 60); // 360 days
  // logger.info('Mino Server Token: ' + serverToken);

  wsManager.startMinecraftServer(minecraftWsPort);
  wsManager.startPlayerServer(playerWsPort);

  // Keep the process running
  await new Promise(() => {});
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  Deno.exit(1);
});
