// deno-lint-ignore-file
// core/authService.ts

import {
  create,
  getNumericDate,
  Header,
  verify,
} from "https://deno.land/x/djwt@v2.8/mod.ts";
import { ConfigManager } from "./ConfigManager.ts";
import { KvManager } from "./kvManager.ts";
import { Logger } from "./logger.ts";

export class AuthService {
  private config: ConfigManager;
  private kv: KvManager;
  private logger: Logger;
  private jwtSecret: CryptoKey;
  private denoriteSecret: CryptoKey;

  constructor(
    config: ConfigManager,
    kv: KvManager,
    logger: Logger,
    jwtSecret: CryptoKey,
    denoriteSecret: CryptoKey,
  ) {
    this.config = config;
    this.kv = kv;
    this.logger = logger;
    this.jwtSecret = jwtSecret;
    this.denoriteSecret = denoriteSecret;
  }

  async createToken(
    payload: { [key: string]: any },
    expiresIn: number = 360 * 24 * 60 * 60,
  ): Promise<string> {
    const header: Header = { alg: "HS256", typ: "JWT" };
    const nowInSeconds = Math.floor(Date.now() / 1000);
    const expirationTime = nowInSeconds + expiresIn;

    const jwtPayload = {
      ...payload,
      iat: nowInSeconds,
      exp: expirationTime,
    };

    try {
      return await create(header, jwtPayload, this.jwtSecret);
    } catch (error: any) {
      this.logger.error(`Token creation failed: ${error.message}`);
      throw error;
    }
  }

  async verifyToken(token: string): Promise<any> {
    try {
      return await verify(token, this.jwtSecret);
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`Token verification failed: ${error.message}`);
      } else {
        this.logger.error("Token verification failed: Unknown error");
      }
      return null;
    }
  }

  async createDenoriteToken(
    expiresIn: number = 360 * 24 * 60 * 60,
  ): Promise<string> {
    const payload = {
      iss: "denorite-server",
      exp: getNumericDate(expiresIn),
    };

    try {
      return await create(
        { alg: "HS256", typ: "JWT" },
        payload,
        this.denoriteSecret,
      );
    } catch (error: any) {
      this.logger.error(`Denorite token creation failed: ${error.message}`);
      throw error;
    }
  }

  async verifyDenoriteToken(token: string): Promise<any> {
    return await verify(token, this.denoriteSecret);
  }

  async checkPermission(
    token: string | null,
    requiredLevel: "guest" | "player" | "operator",
    operatorLevel?: number,
  ): Promise<boolean> {
    if (!token && requiredLevel === "guest") {
      return true;
    }

    if (!token) {
      return false;
    }

    try {
      const payload = await this.verifyToken(token);
      if (!payload) {
        return false;
      }

      switch (requiredLevel) {
        case "guest":
          return true;
        case "player":
          return payload.role === "player" || payload.role === "operator";
        case "operator":
          if (payload.role !== "operator") {
            return false;
          }
          if (operatorLevel && payload.operatorLevel < operatorLevel) {
            return false;
          }
          return true;
        default:
          return false;
      }
    } catch (error: any) {
      this.logger.error(`Permission check failed: ${error.message}`);
      return false;
    }
  }

  async getPlayerIdFromName(playerName: string): Promise<string | null> {
    const playerId = await this.kv.get(["playerNameToId", playerName]);
    return playerId ? playerId as string : null;
  }

  async getPlayerNameFromId(playerId: string): Promise<string | null> {
    const playerName = await this.kv.get(["playerIdToName", playerId]);
    return playerName ? playerName as string : null;
  }
}
