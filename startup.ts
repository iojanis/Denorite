import { exists } from 'https://deno.land/std/fs/mod.ts';
import { listMetadata } from "./decorators.ts";

interface ModuleMetadata {
  name: string;
  version: string;
}

async function getModuleInfo(filePath: string): Promise<ModuleMetadata | null> {
  try {
    // Import the module dynamically
    const module = await import(filePath);

    // Find the first exported class that has module metadata
    for (const exportKey of Object.keys(module)) {
      const exportedItem = module[exportKey];
      if (typeof exportedItem === 'function') {
        const metadata = listMetadata(exportedItem);
        if (metadata.module) {
          return metadata.module as ModuleMetadata;
        }
      }
    }
    return null;
  } catch (error) {
    console.error(`Error reading module info from ${filePath}:`, error);
    return null;
  }
}

function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;
    if (part1 > part2) return 1;
    if (part1 < part2) return -1;
  }
  return 0;
}

async function shouldUpdateModule(
  originalPath: string,
  currentPath: string
): Promise<boolean> {
  const originalInfo = await getModuleInfo(originalPath);
  const currentInfo = await getModuleInfo(currentPath);

  if (!originalInfo || !currentInfo) {
    return false;
  }

  // Check if module names match
  if (originalInfo.name !== currentInfo.name) {
    return false;
  }

  // Compare versions
  return compareVersions(originalInfo.version, currentInfo.version) < 0;
}

async function initializeModules() {
  const modulesDir = "/app/modules";
  const originalModulesDir = "/app/modules.original";

  try {
    // Create modules directory if it doesn't exist
    if (!await exists(modulesDir)) {
      await Deno.mkdir(modulesDir, { recursive: true });
    }

    // Check if modules directory is empty
    const dirEntries = Array.from(Deno.readDirSync(modulesDir));

    // if (dirEntries.length === 0) {
    if (true) {
      console.log("Modules directory is empty. Copying original modules...");

      // Copy contents from original modules backup
      const copyProcess = new Deno.Command("cp", {
        args: ["-r", `${originalModulesDir}/.`, modulesDir],
      });

      const { success, code } = await copyProcess.output();

      if (!success) {
        console.error(`Failed to copy modules. Exit code: ${code}`);
        Deno.exit(1);
      }

      console.log("Successfully initialized modules directory.");
    } else {
      console.log("Checking for module updates...");

      // Get list of all module files in both directories
      const originalFiles = Array.from(Deno.readDirSync(originalModulesDir))
        .filter(entry => entry.isFile && entry.name.endsWith('.ts'));

      // Check each original module for updates
      for (const file of originalFiles) {
        const originalPath = `file://${originalModulesDir}/${file.name}`;
        const currentPath = `file://${modulesDir}/${file.name}`;

        if (!await exists(currentPath)) {
          console.log(`New module found: ${file.name}`);
          await Deno.copyFile(
            `${originalModulesDir}/${file.name}`,
            `${modulesDir}/${file.name}`
          );
          continue;
        }

        try {
          if (await shouldUpdateModule(currentPath, originalPath)) {
            console.log(`Updating module: ${file.name}`);
            await Deno.copyFile(
              `${originalModulesDir}/${file.name}`,
              `${modulesDir}/${file.name}`
            );
          } else {
            console.log(`No update needed for: ${file.name}`);
          }
        } catch (error) {
          console.error(`Error checking updates for ${file.name}:`, error);
        }
      }
    }

  } catch (error) {
    console.error("Error during module initialization:", error);
    Deno.exit(1);
  }
}

// Initialize modules and then start the main application
await initializeModules();
console.log("Starting main application...");

// Import and run the main application
await import("./main.ts");
