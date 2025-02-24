async function combineModules() {
  try {
    let combinedContent = "# Combined Modules\n\n";

    // Read all .ts files from modules directory
    for await (const entry of Deno.readDir("./modules")) {
      if (entry.isFile && entry.name.endsWith(".ts")) {
        console.log(`Processing: ${entry.name}`);

        // Read file content
        const content = await Deno.readTextFile(`./modules/${entry.name}`);

        // Add file name as header and content
        combinedContent += `## ${entry.name}\n\n`;
        combinedContent += "```typescript\n";
        combinedContent += content;
        combinedContent += "\n```\n\n";
      }
    }

    // Write combined content to output file
    await Deno.writeTextFile("./all_modules.md", combinedContent);
    console.log("Successfully created all_modules.md");
  } catch (error) {
    console.error("Error:", error);
  }
}

async function combineCore() {
  try {
    let combinedContent = "# Combined Core\n\n";

    // Read all .ts files from modules directory
    for await (const entry of Deno.readDir("./core")) {
      if (entry.isFile && entry.name.endsWith(".ts")) {
        console.log(`Processing: ${entry.name}`);

        // Read file content
        const content = await Deno.readTextFile(`./core/${entry.name}`);

        // Add file name as header and content
        combinedContent += `## ${entry.name}\n\n`;
        combinedContent += "```typescript\n";
        combinedContent += content;
        combinedContent += "\n```\n\n";
      }
    }

    // Write combined content to output file
    await Deno.writeTextFile("./complete_core.md", combinedContent);
    console.log("Successfully created complete_core.md");
  } catch (error) {
    console.error("Error:", error);
  }
}

// Run the function
combineModules();
combineCore()
