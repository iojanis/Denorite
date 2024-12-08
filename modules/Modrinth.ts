import { Module, Command, Description, Permission, Argument } from '../decorators.ts';
import { ScriptContext } from '../types.ts';

interface ModrinthProject {
  slug: string;
  title: string;
  description: string;
  categories: string[];
  client_side: string;
  server_side: string;
  versions: string[];
}

interface ModrinthVersion {
  id: string;
  project_id: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  files: {
    url: string;
    filename: string;
    primary: boolean;
  }[];
}

interface InstalledMod {
  slug: string;
  title: string;
  version: string;
  filename: string;
  installedAt: number;
}

@Module({
  name: 'mod',
  version: '1.0.0',
  description: 'Manage Fabric mods from Modrinth'
})
export class ModrinthManager {
  private async getServerVersion(kv: Deno.Kv): Promise<string> {
    const version = await kv.get(['server', 'version']);
    return version.value as string || '1.21.1';
  }

  private async fetchFromModrinth(path: string): Promise<Response> {
    const response = await fetch(`https://api.modrinth.com/v2${path}`, {
      headers: {
        'User-Agent': 'Denorite/1.0.0 (cou.sh)'
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || `Request failed with status ${response.status}`);
    }

    return response;
  }

  private async getCompatibleVersion(versions: ModrinthVersion[], mcVersion: string): Promise<ModrinthVersion | null> {
    const compatibleVersions = versions.filter(v =>
      v.game_versions.includes(mcVersion) &&
      v.loaders.includes('fabric')
    );

    // Sort by version number (newest first)
    return compatibleVersions.sort((a, b) =>
      b.version_number.localeCompare(a.version_number)
    )[0] || null;
  }

  private async updateInstalledMods(kv: Deno.Kv, mod: InstalledMod | null, action: 'add' | 'remove'): Promise<void> {
    if (action === 'add' && mod) {
      await kv.set(['installed_mods', mod.slug], mod);
    } else if (action === 'remove' && mod) {
      await kv.delete(['installed_mods', mod.slug]);
    }
  }

  private async downloadModFile(sendToMinecraft: any, files: any, url: string, filename: string): Promise<void> {
    const response = await sendToMinecraft({
      type: "files",
      subcommand: "download",
      arguments: {
        url: url,
        targetPath: `mods/${filename}`
      }
    });

    if (!response) {
      throw new Error(response.error || 'Failed to download mod file');
    }
  }

  private async deleteModFile(sendToMinecraft: any, files: any, filename: string): Promise<void> {
    const response = await sendToMinecraft({
      type: "files",
      subcommand: "delete",
      arguments: {
        path: `mods/${filename}`
      }
    });

    if (!response) {
      throw new Error(response.error || 'Failed to delete mod file');
    }
  }

  @Command(['mod', 'search'])
  @Description('Search for Fabric mods on Modrinth')
  @Permission('operator')
  @Argument([
    { name: 'query', type: 'string', description: 'Search query' }
  ])
  async search({ params, api, log, kv }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const query = args.query;
    const mcVersion = await this.getServerVersion(kv);

    try {
      const response = await this.fetchFromModrinth(
        `/search?query=${encodeURIComponent(query)}&facets=[[%22categories:fabric%22]]`
      );
      const results = await response.json();

      await api.tellraw(sender, JSON.stringify({
        text: `=== Search Results for "${query}" ===`,
        color: "gold",
        bold: true
      }));

      if (results.hits.length === 0) {
        await api.tellraw(sender, JSON.stringify({
          text: "No results found",
          color: "red"
        }));
        return;
      }

      for (const hit of results.hits.slice(0, 5)) {
        const project = hit as ModrinthProject;
        await api.tellraw(sender, JSON.stringify([
          { text: "\n" },
          {
            text: project.title,
            color: "yellow",
            bold: true,
            clickEvent: {
              action: "suggest_command",
              value: `/modrinth install ${project.slug}`
            },
            hoverEvent: {
              action: "show_text",
              value: "Click to install"
            }
          },
          { text: ` (${project.slug})\n`, color: "gray" },
          { text: `${project.description}\n`, color: "white" },
          { text: `Categories: ${project.categories.join(", ")}`, color: "aqua" }
        ]));
      }

      log(`Searched for mods matching "${query}"`);
    } catch (error) {
      log(`Error searching mods: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['mod', 'install'])
  @Description('Install a Fabric mod from Modrinth')
  @Permission('operator')
  @Argument([
    { name: 'slug', type: 'string', description: 'Mod slug/ID' }
  ])
  async install({ params, api, log, kv, files, sendToMinecraft }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const { slug } = args;
    const mcVersion = await this.getServerVersion(kv);

    try {
      // Check if already installed
      const installed = await kv.get(['installed_mods', slug]);
      if (installed.value) {
        throw new Error(`Mod ${slug} is already installed`);
      }

      await api.tellraw(sender, JSON.stringify({
        text: `Fetching information for ${slug}...`,
        color: "yellow"
      }));

      // Get project info
      const projectResponse = await this.fetchFromModrinth(`/project/${slug}`);
      const project = await projectResponse.json() as ModrinthProject;

      // Get versions
      const versionsResponse = await this.fetchFromModrinth(`/project/${slug}/version`);
      const versions = await versionsResponse.json() as ModrinthVersion[];

      // Find compatible version
      const version = await this.getCompatibleVersion(versions, mcVersion);
      if (!version) {
        throw new Error(`No compatible version found for Minecraft ${mcVersion}`);
      }

      // Get primary file
      const file = version.files.find(f => f.primary);
      if (!file) {
        throw new Error('No primary file found');
      }

      await api.tellraw(sender, JSON.stringify({
        text: `Downloading ${project.title} v${version.version_number}...`,
        color: "yellow"
      }));

      // Download mod using modified download method
      await this.downloadModFile(sendToMinecraft, files, file.url, file.filename);

      // Record installation
      const mod: InstalledMod = {
        slug,
        title: project.title,
        version: version.version_number,
        filename: file.filename,
        installedAt: Date.now()
      };
      await this.updateInstalledMods(kv, mod, 'add');

      await api.tellraw(sender, JSON.stringify({
        text: `Successfully installed ${project.title} v${version.version_number}`,
        color: "green"
      }));

      log(`Installed mod ${slug} v${version.version_number}`);
    } catch (error) {
      log(`Error installing mod: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['mod', 'uninstall'])
  @Description('Uninstall a Fabric mod')
  @Permission('operator')
  @Argument([
    { name: 'slug', type: 'string', description: 'Mod slug/ID' }
  ])
  async uninstall({ params, api, log, kv, files, sendToMinecraft }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const { slug } = args;

    try {
      const installed = await kv.get(['installed_mods', slug]);
      if (!installed.value) {
        throw new Error(`Mod ${slug} is not installed`);
      }

      const mod = installed.value as InstalledMod;

      await api.tellraw(sender, JSON.stringify({
        text: `Uninstalling ${mod.title}...`,
        color: "yellow"
      }));

      await this.deleteModFile(sendToMinecraft, files, mod.filename);
      await this.updateInstalledMods(kv, mod, 'remove');

      await api.tellraw(sender, JSON.stringify({
        text: `Successfully uninstalled ${mod.title}`,
        color: "green"
      }));

      log(`Uninstalled mod ${slug}`);
    } catch (error) {
      log(`Error uninstalling mod: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['mod', 'list'])
  @Description('List installed mods')
  @Permission('operator')
  async list({ params, api, log, kv }: ScriptContext): Promise<void> {
    const { sender } = params;

    try {
      const mods: InstalledMod[] = [];
      for await (const entry of kv.list({ prefix: ['installed_mods'] })) {
        mods.push(entry.value as InstalledMod);
      }

      await api.tellraw(sender, JSON.stringify({
        text: "=== Installed Mods ===",
        color: "gold",
        bold: true
      }));

      if (mods.length === 0) {
        await api.tellraw(sender, JSON.stringify({
          text: "\nNo mods installed",
          color: "yellow"
        }));
        return;
      }

      for (const mod of mods) {
        await api.tellraw(sender, JSON.stringify([
          { text: "\n" },
          {
            text: mod.title,
            color: "yellow",
            clickEvent: {
              action: "suggest_command",
              value: `/modrinth uninstall ${mod.slug}`
            },
            hoverEvent: {
              action: "show_text",
              value: "Click to uninstall"
            }
          },
          { text: ` (${mod.slug})\n`, color: "gray" },
          { text: `Version: ${mod.version}\n`, color: "white" },
          { text: `File: ${mod.filename}`, color: "aqua" }
        ]));
      }

      log('Listed installed mods');
    } catch (error) {
      log(`Error listing mods: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['mod', 'update'])
  @Description('Check for and install mod updates')
  @Permission('operator')
  async update({ params, api, log, kv, files, sendToMinecraft }: ScriptContext): Promise<void> {
    const { sender } = params;
    const mcVersion = await this.getServerVersion(kv);

    try {
      const mods: InstalledMod[] = [];
      for await (const entry of kv.list({ prefix: ['installed_mods'] })) {
        mods.push(entry.value as InstalledMod);
      }

      if (mods.length === 0) {
        await api.tellraw(sender, JSON.stringify({
          text: "No mods installed",
          color: "yellow"
        }));
        return;
      }

      await api.tellraw(sender, JSON.stringify({
        text: "Checking for updates...",
        color: "yellow"
      }));

      let updatedCount = 0;

      for (const mod of mods) {
        try {
          const versionsResponse = await this.fetchFromModrinth(`/project/${mod.slug}/version`);
          const versions = await versionsResponse.json() as ModrinthVersion[];
          const latestVersion = await this.getCompatibleVersion(versions, mcVersion);

          if (!latestVersion) {
            continue;
          }

          if (latestVersion.version_number !== mod.version) {
            const file = latestVersion.files.find(f => f.primary);
            if (!file) continue;

            await api.tellraw(sender, JSON.stringify({
              text: `Updating ${mod.title}...`,
              color: "yellow"
            }));

            // Download new version
            await this.downloadModFile(sendToMinecraft, files, file.url, file.filename);

            // Delete old version
            await this.deleteModFile(sendToMinecraft, files, mod.filename);

            // Update installation record
            const updatedMod: InstalledMod = {
              ...mod,
              version: latestVersion.version_number,
              filename: file.filename
            };
            await this.updateInstalledMods(kv, updatedMod, 'add');

            await api.tellraw(sender, JSON.stringify({
              text: `Updated ${mod.title} from v${mod.version} to v${latestVersion.version_number}`,
              color: "green"
            }));

            updatedCount++;
          }
        } catch (error) {
          log(`Error checking update for ${mod.slug}: ${error.message}`);
          await api.tellraw(sender, JSON.stringify({
            text: `Error updating ${mod.title}: ${error.message}`,
            color: "red"
          }));
        }
      }

      if (updatedCount === 0) {
        await api.tellraw(sender, JSON.stringify({
          text: "All mods are up to date",
          color: "green"
        }));
      } else {
        await api.tellraw(sender, JSON.stringify({
          text: `Updated ${updatedCount} mod${updatedCount === 1 ? '' : 's'}`,
          color: "green"
        }));
      }

      log(`Checked for updates, updated ${updatedCount} mods`);
    } catch (error) {
      log(`Error updating mods: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }
}
