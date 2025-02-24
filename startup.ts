import { exists } from "https://deno.land/std/fs/mod.ts";

async function initializeModules() {
  const modulesDir = "/app/modules";
  const originalModulesDir = "/app/modules.original";

  try {
    // Create modules directory if it doesn't exist
    if (!await exists(modulesDir)) {
      await Deno.mkdir(modulesDir, { recursive: true });
    } else {
      // Clean existing modules directory
      console.log("Cleaning existing modules directory...");
      const rmProcess = new Deno.Command("rm", {
        args: ["-rf", `${modulesDir}/*`],
      });

      const { success: rmSuccess, code: rmCode } = await rmProcess.output();

      if (!rmSuccess) {
        console.error(
          `Failed to clean modules directory. Exit code: ${rmCode}`,
        );
        Deno.exit(1);
      }
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
