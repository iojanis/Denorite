import { Argument, Command, Module, Permission } from "../decorators.ts";
import { ScriptContext } from "../types.ts";
import { alert, button, container, divider, text } from "../tellraw-ui.ts";

interface MagistryConfig {
  repositories: Record<string, {
    url: string;
    branch?: string;
    lastUpdate?: number;
  }>;
  installed: Record<string, {
    repository: string;
    module: string;
    version: string;
    installedAt: number;
    updatedAt?: number;
  }>;
}

@Module({
  name: "Magistry",
  version: "1.0.0",
})
export class Magistry {
  private readonly DEFAULT_CONFIG: MagistryConfig = {
    repositories: {},
    installed: {},
  };

  private async getConfig(kv: Deno.Kv): Promise<MagistryConfig> {
    const config = await kv.get(["magistry", "config"]);
    return config.value as MagistryConfig || this.DEFAULT_CONFIG;
  }

  private async saveConfig(kv: Deno.Kv, config: MagistryConfig): Promise<void> {
    await kv.set(["magistry", "config"], config);
  }

  private async cloneRepository(url: string, path: string): Promise<void> {
    const command = new Deno.Command("git", {
      args: ["clone", url, path],
    });
    const output = await command.output();
    if (!output.success) {
      throw new Error(
        `Failed to clone repository: ${
          new TextDecoder().decode(output.stderr)
        }`,
      );
    }
  }

  private async pullRepository(path: string): Promise<void> {
    const command = new Deno.Command("git", {
      args: ["pull"],
      cwd: path,
    });
    const output = await command.output();
    if (!output.success) {
      throw new Error(
        `Failed to pull repository: ${new TextDecoder().decode(output.stderr)}`,
      );
    }
  }

  private async findModules(repoPath: string): Promise<string[]> {
    const modules: string[] = [];
    for await (const entry of Deno.readDir(repoPath)) {
      if (entry.isFile && entry.name.endsWith(".ts")) {
        const content = await Deno.readTextFile(`${repoPath}/${entry.name}`);
        if (content.includes("@Module")) {
          modules.push(entry.name.replace(".ts", ""));
        }
      }
    }
    return modules;
  }

  private async getModuleMetadata(
    filePath: string,
  ): Promise<{ name: string; version: string; description?: string } | null> {
    try {
      const content = await Deno.readTextFile(filePath);
      const moduleMatch = content.match(/@Module\s*\(\s*{([^}]+)}\s*\)/);
      if (!moduleMatch) return null;

      const decoratorContent = moduleMatch[1];
      const nameMatch = decoratorContent.match(/name\s*:\s*['"]([^'"]+)['"]/);
      const versionMatch = decoratorContent.match(
        /version\s*:\s*['"]([^'"]+)['"]/,
      );
      const descriptionMatch = decoratorContent.match(
        /description\s*:\s*['"]([^'"]+)['"]/,
      );

      if (!nameMatch || !versionMatch) return null;

      return {
        name: nameMatch[1],
        version: versionMatch[1],
        description: descriptionMatch ? descriptionMatch[1] : undefined,
      };
    } catch {
      return null;
    }
  }

  private async adjustImportPaths(content: string): Promise<string> {
    // Replace all imports from ../ with ../../../
    return content.replace(
      /from\s+['"]\.\.\/([^'"]+)['"]/g,
      'from "../../$1"',
    );
  }

  private async repositoryExists(repoPath: string): Promise<boolean> {
    try {
      await Deno.stat(`./repositories/${repoPath}`);
      return true;
    } catch {
      return false;
    }
  }

  @Command(["mag", "install"])
  @Permission("operator")
  @Argument([
    {
      name: "module",
      type: "string",
      description:
        "Module to install in format user:repo[:Module]. If Module is omitted, installs all modules from repository",
    },
  ])
  async handleInstall(
    { params, kv, tellraw }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    let messages = await tellraw(
      params.sender,
      text("Starting installation...\n", { style: { color: "gray" } })
        .render(),
    );

    try {
      const fullPath = params.args.module as string;
      const parts = fullPath.split(":");
      if (!fullPath?.includes(":")) {
        messages = await tellraw(
          params.sender,
          alert([], {
            variant: "destructive",
            title: "Error",
            description: "Invalid format. Use: gh_user:repository[:Module]",
          }).render(),
        );
        return { messages };
      }

      const [user, repo, specificModule] = parts;
      const repoPath = `${user}:${repo}`;

      const config = await this.getConfig(kv);
      if (!config.repositories[repoPath]) {
        messages = await tellraw(
          params.sender,
          alert([], {
            variant: "destructive",
            title: "Error",
            description: `Repository ${repoPath} not found`,
          }).render(),
        );
        return { messages };
      }

      let modulesToInstall: string[];
      if (specificModule) {
        modulesToInstall = [specificModule];
      } else {
        // Install all modules from repository
        modulesToInstall = await this.findModules(`./repositories/${repoPath}`);
        messages = await tellraw(
          params.sender,
          container([
            text("Found ", { style: { color: "white" } }),
            text(`${modulesToInstall.length}`, { style: { color: "gold" } }),
            text(" modules to install\n", { style: { color: "white" } }),
          ]).render(),
        );
      }

      for (const moduleName of modulesToInstall) {
        try {
          const moduleId = `${repoPath}:${moduleName}`;

          // Skip if already installed
          if (config.installed[moduleId]) {
            messages = await tellraw(
              params.sender,
              container([
                text("Skipping ", { style: { color: "yellow" } }),
                text(moduleName, { style: { color: "gold" } }),
                text(" - already installed\n", { style: { color: "yellow" } }),
              ]).render(),
            );
            continue;
          }

          const sourcePath = `./repositories/${repoPath}/${moduleName}.ts`;
          const targetDir = `./modules/${user}:${repo}`;
          const targetPath = `${targetDir}/${moduleName}.ts`;

          const metadata = await this.getModuleMetadata(sourcePath);
          if (!metadata) {
            throw new Error(
              `Could not extract metadata from module ${moduleName}`,
            );
          }

          // Read the source file and adjust import paths
          const sourceContent = await Deno.readTextFile(sourcePath);
          const adjustedContent = await this.adjustImportPaths(sourceContent);

          // Create target directory and write adjusted module content
          await Deno.mkdir(targetDir, { recursive: true });
          await Deno.writeTextFile(targetPath, adjustedContent);

          config.installed[moduleId] = {
            repository: repoPath,
            module: moduleName,
            version: metadata.version,
            installedAt: Date.now(),
          };

          messages = await tellraw(
            params.sender,
            container([
              text("Installed ", { style: { color: "green" } }),
              text(moduleName, { style: { color: "gold" } }),
              text(` v${metadata.version}\n`, { style: { color: "gray" } }),
            ]).render(),
          );
        } catch (error) {
          messages = await tellraw(
            params.sender,
            alert([], {
              variant: "destructive",
              title: `Failed to install ${moduleName}`,
              description: error.message,
            }).render(),
          );
        }
      }

      await this.saveConfig(kv, config);

      messages = await tellraw(
        params.sender,
        container([
          text("\nInstallation complete!\n", { style: { color: "green" } }),
          text(
            `Successfully installed ${modulesToInstall.length} module(s)\n`,
            { style: { color: "white" } },
          ),
          divider(),
          button("View Installed Modules", {
            variant: "outline",
            tooltip: "View all installed modules",
            onClick: {
              action: "run_command",
              value: "/mag installed",
            },
          }),
          text(" "),
          button("Browse Repositories", {
            variant: "outline",
            tooltip: "View available repositories",
            onClick: {
              action: "run_command",
              value: "/mag repos",
            },
          }),
        ]).render(),
      );

      return { messages };
    } catch (error) {
      messages = await tellraw(
        params.sender,
        alert([], {
          variant: "destructive",
          title: "Installation failed",
          description: error.message,
        }).render(),
      );
      return { messages };
    }
  }

  @Command(["mag", "add"])
  @Permission("operator")
  @Argument([
    {
      name: "repository",
      type: "string",
      description: "GitHub repository in format user:repo",
    },
  ])
  async handleAddRepository(
    { params, kv, tellraw }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    let messages = await tellraw(
      params.sender,
      text("Adding repository...", { style: { color: "gray" } })
        .render(),
    );

    try {
      const repoPath = params.args.repository as string;
      if (!repoPath?.includes(":")) {
        messages = await tellraw(
          params.sender,
          alert([], {
            variant: "destructive",
            title: "Error",
            description: "Invalid repository format. Use: gh_user:repository",
          }).render(),
        );
        return { messages };
      }

      const config = await this.getConfig(kv);
      if (config.repositories[repoPath]) {
        messages = await tellraw(
          params.sender,
          alert([], {
            variant: "destructive",
            title: "Error",
            description: `Repository ${repoPath} is already added`,
          }).render(),
        );
        return { messages };
      }

      const url = `https://github.com/${repoPath.replace(":", "/")}.git`;
      const localPath = `./repositories/${repoPath}`;

      await this.cloneRepository(url, localPath);

      // Search for available modules in the repository
      const modules = await this.findModules(localPath);
      const moduleMetadata = await Promise.all(
        modules.map(async (module) => {
          const metadata = await this.getModuleMetadata(
            `${localPath}/${module}.ts`,
          );
          return { module, metadata };
        }),
      );

      config.repositories[repoPath] = {
        url,
        lastUpdate: Date.now(),
      };
      await this.saveConfig(kv, config);

      // Show success message with repository info
      messages = await tellraw(
        params.sender,
        container([
          text("Successfully added repository ", { style: { color: "green" } }),
          text(repoPath, { style: { color: "gold" } }),
          text("\n\n"),
          text(`Found ${modules.length} available modules:\n`, {
            style: { color: "white" },
          }),
          divider(),
        ]).render(),
      );

      // Display available modules with install buttons
      for (const { module, metadata } of moduleMetadata) {
        if (!metadata) continue;

        messages = await tellraw(
          params.sender,
          container([
            text(`• ${module}`, { style: { color: "white" } }),
            text(` v${metadata.version}`, { style: { color: "gold" } }),
            text("\n  "),
            button("Install", {
              variant: "success",
              tooltip: "Install this module",
              onClick: {
                action: "run_command",
                value: `/mag install "${repoPath}:${module}"`,
              },
            }),
            metadata.description
              ? text(`\n  ${metadata.description}`, {
                style: { color: "gray" },
              })
              : text(""),
            text("\n"),
          ]).render(),
        );
      }

      // Add footer with actions
      messages = await tellraw(
        params.sender,
        container([
          divider(),
          button("Install All", {
            variant: "success",
            tooltip: "Install all modules from this repository",
            onClick: {
              action: "run_command",
              value: `/mag install "${repoPath}"`,
            },
          }),
          text(" "),
          button("View Details", {
            variant: "outline",
            tooltip: "Show detailed repository information",
            onClick: {
              action: "run_command",
              value: `/mag repo "${repoPath}"`,
            },
          }),
        ]).render(),
      );

      return { messages };
    } catch (error) {
      messages = await tellraw(
        params.sender,
        alert([], {
          variant: "destructive",
          title: "Error adding repository",
          description: error.message,
        }).render(),
      );
      return { messages };
    }
  }

  @Command(["mag", "update"])
  @Permission("operator")
  async handleUpdateRepositories(
    { params, kv, tellraw }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    let messages = await tellraw(
      params.sender,
      text("Updating repositories...", { style: { color: "gray" } })
        .render(),
    );

    try {
      const config = await this.getConfig(kv);
      const updated: string[] = [];
      const failed: { repository: string; error: string }[] = [];

      for (const [repoPath, repo] of Object.entries(config.repositories)) {
        try {
          const localPath = `./repositories/${repoPath}`;
          await this.pullRepository(localPath);
          config.repositories[repoPath].lastUpdate = Date.now();
          updated.push(repoPath);

          messages = await tellraw(
            params.sender,
            container([
              text("Updated repository ", { style: { color: "green" } }),
              text(repoPath, { style: { color: "gold" } }),
              text("\n"),
            ]).render(),
          );
        } catch (error) {
          failed.push({ repository: repoPath, error: error.message });
          messages = await tellraw(
            params.sender,
            alert([], {
              variant: "destructive",
              title: `Failed to update ${repoPath}`,
              description: error.message,
            }).render(),
          );
        }
      }

      await this.saveConfig(kv, config);

      messages = await tellraw(
        params.sender,
        container([
          text("\nUpdate Summary:\n", { style: { color: "gold" } }),
          text(`Updated: ${updated.length} repositories\n`, {
            style: { color: "green" },
          }),
          text(`Failed: ${failed.length} repositories\n`, {
            style: { color: failed.length > 0 ? "red" : "green" },
          }),
          divider(),
          button("View Repositories", {
            variant: "outline",
            tooltip: "View all repositories",
            onClick: {
              action: "run_command",
              value: "/mag repos",
            },
          }),
          text(" "),
          button("Check Updates", {
            variant: "outline",
            tooltip: "Check for module updates",
            onClick: {
              action: "run_command",
              value: "/mag upgrade",
            },
          }),
        ]).render(),
      );

      return { messages };
    } catch (error) {
      messages = await tellraw(
        params.sender,
        alert([], {
          variant: "destructive",
          title: "Update Failed",
          description: error.message,
        }).render(),
      );
      return { messages };
    }
  }

  @Command(["mag", "repos"])
  @Permission("operator")
  async handleListRepositories(
    { params, kv, tellraw }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    let messages = [];
    try {
      const config = await this.getConfig(kv);
      const repositories = Object.entries(config.repositories);

      if (repositories.length === 0) {
        messages = await tellraw(
          params.sender,
          container([
            text("No repositories added yet\n", { style: { color: "gray" } }),
            button("Add Repository", {
              variant: "outline",
              tooltip: "Add a new repository from GitHub",
              onClick: {
                action: "suggest_command",
                value: "/mag add ",
              },
            }),
          ]).render(),
        );
        return { messages };
      }

      messages = await tellraw(
        params.sender,
        container([
          text("Available Repositories:\n", { style: { color: "gold" } }),
          button("Add New", {
            variant: "outline",
            tooltip: "Add a new repository from GitHub",
            onClick: {
              action: "suggest_command",
              value: "/mag add ",
            },
          }),
          text(" "),
          button("Update All", {
            variant: "outline",
            tooltip: "Pull latest changes from all repositories",
            onClick: {
              action: "run_command",
              value: "/mag update",
            },
          }),
          divider(),
        ]).render(),
      );

      for (const [repoPath, repo] of repositories) {
        messages = await tellraw(
          params.sender,
          container([
            text(`• ${repoPath}\n`, { style: { color: "white" } }),
            text(
              `  Last updated: ${
                new Date(repo.lastUpdate || 0).toLocaleString()
              }\n`,
              { style: { color: "gray" } },
            ),
            button("View Modules", {
              variant: "outline",
              tooltip: "Show available modules in this repository",
              onClick: {
                action: "run_command",
                value: `/mag repo "${repoPath}"`,
              },
            }),
            text(" "),
            button("Install All", {
              variant: "success",
              tooltip: "Install all modules from this repository",
              onClick: {
                action: "run_command",
                value: `/mag install "${repoPath}"`,
              },
            }),
            text("\n"),
          ]).render(),
        );
      }

      return { messages };
    } catch (error) {
      messages = await tellraw(
        params.sender,
        alert([], {
          variant: "destructive",
          title: "Error",
          description: error.message,
        }).render(),
      );
      return { messages };
    }
  }

  @Command(["mag", "repo"])
  @Permission("operator")
  @Argument([
    {
      name: "repository",
      type: "string",
      description: "GitHub repository to view in format user:repo",
    },
  ])
  async handleShowRepository(
    { params, kv, tellraw }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    let messages = [];
    try {
      const repoPath = params.args.repository as string;
      if (!repoPath?.includes(":")) {
        messages = await tellraw(
          params.sender,
          alert([], {
            variant: "destructive",
            title: "Error",
            description: "Invalid repository format. Use: gh_user:repository",
          }).render(),
        );
        return { messages };
      }

      const config = await this.getConfig(kv);
      if (!config.repositories[repoPath]) {
        messages = await tellraw(
          params.sender,
          alert([], {
            variant: "destructive",
            title: "Error",
            description: `Repository ${repoPath} not found`,
          }).render(),
        );
        return { messages };
      }

      const localPath = `./repositories/${repoPath}`;
      const modules = await this.findModules(localPath);

      if (modules.length === 0) {
        messages = await tellraw(
          params.sender,
          container([
            text("No modules found in repository\n", {
              style: { color: "gray" },
            }),
            button("Back to Repositories", {
              variant: "outline",
              tooltip: "Return to repository list",
              onClick: {
                action: "run_command",
                value: "/mag repos",
              },
            }),
          ]).render(),
        );
        return { messages };
      }

      messages = await tellraw(
        params.sender,
        container([
          text(`Modules in ${repoPath}:\n`, { style: { color: "gold" } }),
          button("Install All", {
            variant: "success",
            tooltip: "Install all modules from this repository",
            onClick: {
              action: "run_command",
              value: `/mag install "${repoPath}"`,
            },
          }),
          text(" "),
          button("Back", {
            variant: "outline",
            tooltip: "Return to repository list",
            onClick: {
              action: "run_command",
              value: "/mag repos",
            },
          }),
          divider(),
        ]).render(),
      );

      for (const module of modules) {
        const metadata = await this.getModuleMetadata(
          `${localPath}/${module}.ts`,
        );
        if (!metadata) continue;

        const installedModule = Object.entries(config.installed).find(
          ([id, m]) => m.repository === repoPath && m.module === module,
        );

        const elements = [
          text(`• ${module}`, { style: { color: "white" } }),
          text(` v${metadata.version}`, { style: { color: "gold" } }),
        ];

        if (installedModule) {
          const [_, moduleInfo] = installedModule;
          elements.push(
            text(` (installed v${moduleInfo.version})`, {
              style: { color: "green" },
            }),
          );

          // Add update/uninstall buttons for installed modules
          elements.push(text("\n  "));
          if (moduleInfo.version !== metadata.version) {
            elements.push(
              button("Update", {
                variant: "success",
                tooltip: `Update to v${metadata.version}`,
                onClick: {
                  action: "run_command",
                  value: `/mag upgrade "${repoPath}:${module}"`,
                },
              }),
            );
            elements.push(text(" "));
          }
          elements.push(
            button("Uninstall", {
              variant: "destructive",
              tooltip: "Remove this module",
              onClick: {
                action: "run_command",
                value: `/mag uninstall "${repoPath}:${module}"`,
              },
            }),
          );
        } else {
          // Add install button for uninstalled modules
          elements.push(text("\n  "));
          elements.push(
            button("Install", {
              variant: "success",
              tooltip: "Install this module",
              onClick: {
                action: "run_command",
                value: `/mag install "${repoPath}:${module}"`,
              },
            }),
          );
        }

        elements.push(text("\n"));
        if (metadata.description) {
          elements.push(
            text(`  ${metadata.description}\n`, { style: { color: "gray" } }),
          );
        }

        messages = await tellraw(
          params.sender,
          container(elements).render(),
        );
      }

      messages = await tellraw(
        params.sender,
        container([
          button("Back to Repositories", {
            variant: "outline",
            tooltip: "Return to repository list",
            onClick: {
              action: "run_command",
              value: "/mag repos",
            },
          }),
        ]).render(),
      );

      return { messages };
    } catch (error) {
      messages = await tellraw(
        params.sender,
        alert([], {
          variant: "destructive",
          title: "Error",
          description: error.message,
        }).render(),
      );
      return { messages };
    }
  }

  @Command(["mag", "installed"])
  @Permission("operator")
  async handleListInstalled(
    { params, kv, tellraw }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    let messages = [];
    try {
      const config = await this.getConfig(kv);
      const installed = Object.entries(config.installed);

      if (installed.length === 0) {
        messages = await tellraw(
          params.sender,
          container([
            text("No modules installed\n", { style: { color: "gray" } }),
            button("Browse Repositories", {
              variant: "outline",
              tooltip: "View available repositories and modules",
              onClick: {
                action: "run_command",
                value: "/mag repos",
              },
            }),
          ]).render(),
        );
        return { messages };
      }

      messages = await tellraw(
        params.sender,
        container([
          text("Installed Modules:\n", { style: { color: "gold" } }),
          button("Check Updates", {
            variant: "outline",
            tooltip: "Check for available updates",
            onClick: {
              action: "run_command",
              value: "/mag upgrade",
            },
          }),
          text(" "),
          button("Backup", {
            variant: "outline",
            tooltip: "Create a backup of installed modules",
            onClick: {
              action: "run_command",
              value: "/mag backup",
            },
          }),
          divider(),
        ]).render(),
      );

      for (const [id, module] of installed) {
        messages = await tellraw(
          params.sender,
          container([
            text(`• ${module.repository}:${module.module}\n`, {
              style: { color: "white" },
            }),
            text(`  Version: ${module.version}\n`, {
              style: { color: "gray" },
            }),
            text(
              `  Installed: ${new Date(module.installedAt).toLocaleString()}\n`,
              { style: { color: "gray" } },
            ),
            module.updatedAt
              ? text(
                `  Updated: ${new Date(module.updatedAt).toLocaleString()}\n`,
                { style: { color: "gray" } },
              )
              : text(""),
            button("Uninstall", {
              variant: "destructive",
              tooltip: "Remove this module",
              onClick: {
                action: "run_command",
                value: `/mag uninstall ${id}`,
              },
            }),
            text("\n"),
          ]).render(),
        );
      }

      return { messages };
    } catch (error) {
      messages = await tellraw(
        params.sender,
        alert([], {
          variant: "destructive",
          title: "Error",
          description: error.message,
        }).render(),
      );
      return { messages };
    }
  }

  @Command(["mag", "uninstall"])
  @Permission("operator")
  @Argument([
    {
      name: "module",
      type: "string",
      description:
        "Module to uninstall in format user:repo[:Module]. If Module is omitted, uninstalls all modules from repository",
    },
  ])
  async handleUninstall(
    { params, kv, tellraw }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    let messages = await tellraw(
      params.sender,
      text("Starting uninstallation...\n", { style: { color: "gray" } })
        .render(),
    );

    try {
      const fullPath = params.args.module as string;
      const parts = fullPath.split(":");

      if (parts.length < 2 || parts.length > 3) {
        messages = await tellraw(
          params.sender,
          alert([], {
            variant: "destructive",
            title: "Error",
            description: "Invalid format. Use: gh_user:repository[:Module]",
          }).render(),
        );
        return { messages };
      }

      const [user, repo, specificModule] = parts;
      const repoPath = `${user}:${repo}`;
      const config = await this.getConfig(kv);

      // Check if any modules from this repository are installed
      const installedModules = Object.entries(config.installed)
        .filter(([id, module]) => module.repository === repoPath)
        .map(([id, module]) => ({
          id,
          module: module.module,
        }));

      if (installedModules.length === 0) {
        messages = await tellraw(
          params.sender,
          alert([], {
            variant: "destructive",
            title: "Error",
            description: `No modules installed from repository ${repoPath}`,
          }).render(),
        );
        return { messages };
      }

      // If a specific module is specified, filter to just that one
      let modulesToUninstall = installedModules;
      if (specificModule) {
        modulesToUninstall = installedModules.filter((m) =>
          m.module === specificModule
        );
        if (modulesToUninstall.length === 0) {
          messages = await tellraw(
            params.sender,
            alert([], {
              variant: "destructive",
              title: "Error",
              description:
                `Module ${specificModule} is not installed from repository ${repoPath}`,
            }).render(),
          );
          return { messages };
        }
      }

      // Uninstall each module
      for (const { id, module } of modulesToUninstall) {
        try {
          const modulePath = `./modules/${user}:${repo}/${module}.ts`;
          await Deno.remove(modulePath);
          delete config.installed[id];

          messages = await tellraw(
            params.sender,
            container([
              text("Uninstalled ", { style: { color: "green" } }),
              text(`${module}`, { style: { color: "gold" } }),
              text("\n"),
            ]).render(),
          );
        } catch (error) {
          messages = await tellraw(
            params.sender,
            alert([], {
              variant: "destructive",
              title: `Failed to uninstall ${module}`,
              description: error.message,
            }).render(),
          );
        }
      }

      // Try to clean up empty directories
      try {
        await Deno.remove(`./modules/${user}:${repo}`);
      } catch {
        // Ignore errors if directories are not empty
      }

      await this.saveConfig(kv, config);

      messages = await tellraw(
        params.sender,
        container([
          text("\nUninstallation complete!\n", { style: { color: "green" } }),
          text(
            `Successfully uninstalled ${modulesToUninstall.length} module(s)\n`,
            { style: { color: "white" } },
          ),
          divider(),
          button("View Installed Modules", {
            variant: "outline",
            tooltip: "View remaining installed modules",
            onClick: {
              action: "run_command",
              value: "/mag installed",
            },
          }),
          text(" "),
          button("Browse Repositories", {
            variant: "outline",
            tooltip: "View available repositories",
            onClick: {
              action: "run_command",
              value: "/mag repos",
            },
          }),
        ]).render(),
      );

      return { messages };
    } catch (error) {
      messages = await tellraw(
        params.sender,
        alert([], {
          variant: "destructive",
          title: "Error uninstalling module(s)",
          description: error.message,
        }).render(),
      );
      return { messages };
    }
  }

  @Command(["mag", "backup"])
  @Permission("operator")
  async handleBackup(
    { params, kv, tellraw }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    let messages = await tellraw(
      params.sender,
      text("Creating backup...\n", { style: { color: "gray" } })
        .render({ platform: "minecraft", player: params.sender }),
    );

    try {
      const config = await this.getConfig(kv);
      const backupPath = "./modules/module.json";
      await Deno.writeTextFile(backupPath, JSON.stringify(config, null, 2));

      messages = await tellraw(
        params.sender,
        container([
          text("Successfully created backup at ", {
            style: { color: "green" },
          }),
          text(backupPath, { style: { color: "gold" } }),
          text("\n"),
          divider(),
          button("View Installed", {
            variant: "outline",
            tooltip: "View installed modules",
            onClick: {
              action: "run_command",
              value: "/mag installed",
            },
          }),
          text(" "),
          button("Restore Backup", {
            variant: "outline",
            tooltip: "Restore from this backup",
            onClick: {
              action: "run_command",
              value: "/mag restore",
            },
          }),
        ]).render(),
      );

      return { messages };
    } catch (error) {
      messages = await tellraw(
        params.sender,
        alert([], {
          variant: "destructive",
          title: "Backup failed",
          description: error.message,
        }).render({ platform: "minecraft", player: params.sender }),
      );
      return { messages };
    }
  }

  @Command(["mag", "restore"])
  @Permission("operator")
  async handleRestore(
    { params, kv, tellraw }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    let messages = await tellraw(
      params.sender,
      text("Starting restore from backup...\n", { style: { color: "gray" } })
        .render(),
    );

    try {
      const backupContent = await Deno.readTextFile("./modules/module.json");
      const backupConfig = JSON.parse(backupContent) as MagistryConfig;

      // Restore repositories
      for (
        const [repoPath, repo] of Object.entries(backupConfig.repositories)
      ) {
        try {
          if (!await this.repositoryExists(repoPath)) {
            const localPath = `./repositories/${repoPath}`;
            await this.cloneRepository(repo.url, localPath);

            messages = await tellraw(
              params.sender,
              container([
                text("\nRestore complete!\n", { style: { color: "green" } }),
                text(
                  `Repositories: ${
                    Object.keys(backupConfig.repositories).length
                  }\n`,
                  { style: { color: "white" } },
                ),
                text(
                  `Modules: ${Object.keys(backupConfig.installed).length}\n`,
                  { style: { color: "white" } },
                ),
                divider(),
                button("View Installed", {
                  variant: "outline",
                  tooltip: "View installed modules",
                  onClick: {
                    action: "run_command",
                    value: "/mag installed",
                  },
                }),
                text(" "),
                button("View Repositories", {
                  variant: "outline",
                  tooltip: "View available repositories",
                  onClick: {
                    action: "run_command",
                    value: "/mag repos",
                  },
                }),
              ]).render(),
            );
          }
        } catch (error) {
          messages = await tellraw(
            params.sender,
            alert([], {
              variant: "destructive",
              title: `Failed to restore repository ${repoPath}`,
              description: error.message,
            }).render(),
          );
        }
      }

      // Restore modules
      for (const [moduleId, module] of Object.entries(backupConfig.installed)) {
        try {
          const [user, repo, moduleName] = moduleId.split(":");
          const repoPath = `${user}:${repo}`;

          const sourcePath = `./repositories/${repoPath}/${moduleName}.ts`;
          const targetDir = `./modules/${user}:${repo}`;
          const targetPath = `${targetDir}/${moduleName}.ts`;

          // Read the source file and adjust import paths, just like in install
          const sourceContent = await Deno.readTextFile(sourcePath);
          const adjustedContent = await this.adjustImportPaths(sourceContent);

          // Create target directory and write adjusted module content
          await Deno.mkdir(targetDir, { recursive: true });
          await Deno.writeTextFile(targetPath, adjustedContent);

          messages = await tellraw(
            params.sender,
            container([
              text("Restored module ", { style: { color: "green" } }),
              text(`${moduleId} `, { style: { color: "gold" } }),
              text(`v${module.version}\n`, { style: { color: "gray" } }),
            ]).render(),
          );
        } catch (error) {
          messages = await tellraw(
            params.sender,
            alert([], {
              variant: "destructive",
              title: `Failed to restore module ${moduleId}`,
              description: error.message,
            }).render(),
          );
        }
      }

      await this.saveConfig(kv, backupConfig);

      messages = await tellraw(
        params.sender,
        container([
          text("\nRestore complete!\n", { style: { color: "green" } }),
          text(
            `Repositories: ${Object.keys(backupConfig.repositories).length}\n`,
            { style: { color: "white" } },
          ),
          text(`Modules: ${Object.keys(backupConfig.installed).length}`, {
            style: { color: "white" },
          }),
        ]).render(),
      );

      return { messages };
    } catch (error) {
      messages = await tellraw(
        params.sender,
        alert([], {
          variant: "destructive",
          title: "Restore failed",
          description: error.message,
        }).render(),
      );
      return { messages };
    }
  }

  @Command(["mag", "upgrade"])
  @Permission("operator")
  async handleUpgrade(
    { params, kv, tellraw }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    let messages = await tellraw(
      params.sender,
      text("Checking for module updates...\n", { style: { color: "gray" } })
        .render(),
    );

    try {
      const config = await this.getConfig(kv);
      const updates: {
        moduleId: string;
        oldVersion: string;
        newVersion: string;
      }[] = [];
      const failed: {
        moduleId: string;
        error: string;
      }[] = [];
      const notInstalled: {
        moduleId: string;
        version: string;
      }[] = [];

      // First update all repositories to get latest versions
      for (const [repoPath, repo] of Object.entries(config.repositories)) {
        try {
          const localPath = `./repositories/${repoPath}`;
          await this.pullRepository(localPath);
          config.repositories[repoPath].lastUpdate = Date.now();

          // Find all available modules in this repository
          const availableModules = await this.findModules(localPath);
          for (const moduleName of availableModules) {
            const moduleId = `${repoPath}:${moduleName}`;

            // Skip if already installed
            if (config.installed[moduleId]) continue;

            // Get module metadata
            const metadata = await this.getModuleMetadata(
              `${localPath}/${moduleName}.ts`,
            );
            if (metadata) {
              notInstalled.push({
                moduleId,
                version: metadata.version,
              });

              messages = await tellraw(
                params.sender,
                container([
                  text("\nUpgrade Summary:\n", { style: { color: "gold" } }),
                  text(`Updated: ${updates.length} module(s)\n`, {
                    style: { color: "green" },
                  }),
                  text(`Failed: ${failed.length} module(s)\n`, {
                    style: { color: failed.length > 0 ? "red" : "green" },
                  }),
                  text(
                    `No updates needed: ${
                      Object.keys(config.installed).length - updates.length -
                      failed.length
                    } module(s)\n`,
                    {
                      style: { color: "gray" },
                    },
                  ),
                  text(`Not installed: ${notInstalled.length} module(s)\n`, {
                    style: { color: "yellow" },
                  }),
                  divider(),
                  button("View Installed", {
                    variant: "outline",
                    tooltip: "View installed modules",
                    onClick: {
                      action: "run_command",
                      value: "/mag installed",
                    },
                  }),
                  text(" "),
                  button("Browse Repositories", {
                    variant: "outline",
                    tooltip: "Browse available modules",
                    onClick: {
                      action: "run_command",
                      value: "/mag repos",
                    },
                  }),
                ]).render(),
              );
            }
          }
        } catch (error) {
          messages = await tellraw(
            params.sender,
            alert([], {
              variant: "destructive",
              title: `Failed to update repository ${repoPath}`,
              description: error.message,
            }).render(),
          );
        }
      }

      // Check each installed module for updates
      for (const [moduleId, module] of Object.entries(config.installed)) {
        try {
          const [user, repo, moduleName] = moduleId.split(":");
          const repoPath = `${user}:${repo}`;
          const sourcePath = `./repositories/${repoPath}/${moduleName}.ts`;

          // Get latest module metadata
          const metadata = await this.getModuleMetadata(sourcePath);
          if (!metadata) {
            throw new Error("Could not read module metadata");
          }

          // Compare versions
          if (metadata.version !== module.version) {
            updates.push({
              moduleId,
              oldVersion: module.version,
              newVersion: metadata.version,
            });

            // Copy updated module
            const targetDir = `./modules/${user}:${repo}`;
            const targetPath = `${targetDir}/${moduleName}.ts`;
            await Deno.mkdir(targetDir, { recursive: true });
            // Read and adjust import paths before writing
            const sourceContent = await Deno.readTextFile(sourcePath);
            const adjustedContent = await this.adjustImportPaths(sourceContent);
            await Deno.writeTextFile(targetPath, adjustedContent);

            // Update config
            config.installed[moduleId] = {
              ...module,
              version: metadata.version,
              updatedAt: Date.now(),
            };

            messages = await tellraw(
              params.sender,
              container([
                text("Updated ", { style: { color: "green" } }),
                text(moduleId, { style: { color: "gold" } }),
                text(` from v${module.version} to v${metadata.version}\n`, {
                  style: { color: "gray" },
                }),
              ]).render(),
            );
          }
        } catch (error) {
          failed.push({
            moduleId,
            error: error.message,
          });
          messages = await tellraw(
            params.sender,
            alert([], {
              variant: "destructive",
              title: `Failed to update ${moduleId}`,
              description: error.message,
            }).render(),
          );
        }
      }

      await this.saveConfig(kv, config);

      messages = await tellraw(
        params.sender,
        container([
          text("\nUpgrade Summary:\n", { style: { color: "gold" } }),
          text(`Updated: ${updates.length} module(s)\n`, {
            style: { color: "green" },
          }),
          text(`Failed: ${failed.length} module(s)\n`, {
            style: { color: failed.length > 0 ? "red" : "green" },
          }),
          text(
            `No updates needed: ${
              Object.keys(config.installed).length - updates.length -
              failed.length
            } module(s)\n`,
            {
              style: { color: "gray" },
            },
          ),
          text(`Not installed: ${notInstalled.length} module(s)`, {
            style: { color: "yellow" },
          }),
        ]).render(),
      );

      return { messages };
    } catch (error) {
      messages = await tellraw(
        params.sender,
        alert([], {
          variant: "destructive",
          title: "Upgrade failed",
          description: error.message,
        }).render(),
      );
      return { messages };
    }
  }
}
