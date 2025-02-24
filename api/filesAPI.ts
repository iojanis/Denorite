interface FileInfo {
  name: string;
  isDirectory: boolean;
  size: number;
  lastModified: number;
}

interface FileSystemResponse {
  success: boolean;
  error?: string;
  files?: FileInfo[];
  path?: string;
  source?: string;
  destination?: string;
  extracted?: boolean;
  gameDir?: string;
}

export type ServerDirectory =
  | "world" // Main world folder (from server.properties level-name)
  | "world_nether" // Nether dimension
  | "world_the_end" // End dimension
  | "mods" // Fabric/Forge mods
  | "config" // Mod configurations
  | "logs" // Server logs
  | "crash-reports"; // Crash reports

export function createFilesAPI(
  sendToMinecraft: (data: unknown) => Promise<unknown>,
  log: (message: string) => void,
) {
  const gameDir: string | null = null;

  async function sendCommand(
    subcommand: string,
    args: Record<string, string>,
  ): Promise<unknown> {
    return await sendToMinecraft({
      type: "files",
      subcommand,
      arguments: args,
    });
  }

  function isDownloadAllowed(directory: ServerDirectory): boolean {
    return ["mods", "config"].includes(directory);
  }

  return {
    /**
     * Gets the server's base directory
     */
    async getGameDirectory(): Promise<string> {
      const response = await sendCommand(
        "getGameDir",
        {},
      ) as FileSystemResponse;
      if (!response.success || !response.gameDir) {
        throw new Error(response.error || "Failed to get game directory");
      }
      return response.gameDir;
    },

    /**
     * Lists files in a server directory
     * @param directory The server directory to list
     * @param subPath Optional subdirectory path
     */
    async listFiles(
      directory: ServerDirectory,
      subPath: string = "",
    ): Promise<FileInfo[]> {
      const basePath = await this.getGameDirectory();
      const fullPath = subPath
        ? `${basePath}/${directory}/${subPath}`
        : `${basePath}/${directory}`;

      const response = await sendCommand("list", {
        path: fullPath,
      }) as FileSystemResponse;
      if (!response.success || !response.files) {
        throw new Error(response.error || "Failed to list files");
      }
      return response.files;
    },

    /**
     * Downloads a file to the server
     * Note: Only allowed in certain directories (mods, config)
     * @param url Source URL to download from
     * @param directory Target server directory
     * @param targetPath Path within the directory
     */
    async downloadFile(
      url: string,
      directory: ServerDirectory,
      targetPath: string,
    ): Promise<string> {
      if (!isDownloadAllowed(directory)) {
        throw new Error(
          `Downloads are not allowed in the ${directory} directory`,
        );
      }

      const basePath = await this.getGameDirectory();
      const fullPath = `${basePath}/${directory}/${targetPath}`;

      const response = await sendCommand("download", {
        url,
        targetPath: fullPath,
      }) as FileSystemResponse;

      if (!response.success || !response.path) {
        throw new Error(response.error || "Failed to download file");
      }
      return response.path;
    },

    /**
     * Deletes a file or directory from the server
     * @param directory Server directory containing the file
     * @param path Path within the directory
     */
    async deleteFile(
      directory: ServerDirectory,
      path: string,
    ): Promise<string> {
      const basePath = await this.getGameDirectory();
      const fullPath = `${basePath}/${directory}/${path}`;

      const response = await sendCommand("delete", {
        path: fullPath,
      }) as FileSystemResponse;
      if (!response.success || !response.path) {
        throw new Error(response.error || "Failed to delete file");
      }
      return response.path;
    },

    /**
     * Moves or renames a file within the server
     * @param sourceDir Source server directory
     * @param sourcePath Source path within directory
     * @param destDir Destination server directory
     * @param destPath Destination path within directory
     */
    async moveFile(
      sourceDir: ServerDirectory,
      sourcePath: string,
      destDir: ServerDirectory,
      destPath: string,
    ): Promise<{ source: string; destination: string }> {
      const basePath = await this.getGameDirectory();
      const fullSourcePath = `${basePath}/${sourceDir}/${sourcePath}`;
      const fullDestPath = `${basePath}/${destDir}/${destPath}`;

      const response = await sendCommand("move", {
        source: fullSourcePath,
        destination: fullDestPath,
      }) as FileSystemResponse;

      if (!response.success || !response.source || !response.destination) {
        throw new Error(response.error || "Failed to move file");
      }
      return {
        source: response.source,
        destination: response.destination,
      };
    },
  };
}

// Example usage:
/*
const filesAPI = createFilesAPI(sendToMinecraft, console.log);

// List files in mods directory
const mods = await filesAPI.listFiles('mods');

// Download a mod
await filesAPI.downloadFile('https://example.com/mod.jar', 'mods', 'newmod.jar');

// Move a config file
await filesAPI.moveFile('config', 'old.json', 'config', 'new.json');

// List world files
const worldFiles = await filesAPI.listFiles('world');

// Delete a crash report
await filesAPI.deleteFile('crash-reports', 'crash-2024-01-01.txt');
*/
