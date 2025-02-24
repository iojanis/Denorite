// core/logger.ts

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export class Logger {
  private logLevel: LogLevel;

  constructor() {
    this.logLevel = LogLevel.DEBUG; // Default log level
  }

  private log(level: LogLevel, message: string, ...args: unknown[]) {
    if (level >= this.logLevel) {
      const timestamp = new Date().toISOString();
      const levelString = LogLevel[level];
      console.log(`[${timestamp}] [${levelString}] ${message}`, ...args);
    }
  }

  debug(message: string, ...args: unknown[]) {
    this.log(LogLevel.DEBUG, message, ...args);
  }

  info(message: string, ...args: unknown[]) {
    this.log(LogLevel.INFO, message, ...args);
  }

  warn(message: string, ...args: unknown[]) {
    this.log(LogLevel.WARN, message, ...args);
  }

  error(message: string, ...args: unknown[]) {
    this.log(LogLevel.ERROR, message, ...args);
  }

  getLogEntries(
    _limit: number = 100,
    _level: LogLevel = LogLevel.DEBUG,
  ): Promise<string[]> {
    // This is a placeholder implementation. In a real-world scenario,
    // you might want to store logs in a file or database and retrieve them from there.
    console.warn(
      "getLogEntries is not implemented. It's a placeholder method.",
    );
    return Promise.resolve(["Log entry 1", "Log entry 2", "Log entry 3"]);
  }
}
