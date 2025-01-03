import { exists } from 'https://deno.land/std/fs/mod.ts';

async function initializeModules() {
  const modulesDir = "/app/modules";
  const originalModulesDir = "/app/modules.original";

  try {
    // Create modules directory if it doesn't exist
    if (!await exists(modulesDir)) {
      await Deno.mkdir(modulesDir, { recursive: true });
    }

    console.log("Copying modules from original...");

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
