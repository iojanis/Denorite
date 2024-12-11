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

  @Command(['mod'])
  @Description('Modrinth mod management commands')
  @Permission('operator')
  async mod({ params, kv, tellraw, api,  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;
    let messages = [];

    try {
      messages = await tellraw(sender, JSON.stringify([
        {text: "=== Modrinth Mod Commands ===\n", color: "gold", bold: true},
        {text: "/mod search <query>", color: "yellow"},
        {text: " - Search for Fabric mods on Modrinth\n", color: "gray"},
        {text: "/mod install <slug>", color: "yellow"},
        {text: " - Install a mod from Modrinth\n", color: "gray"},
        {text: "/mod uninstall <slug>", color: "yellow"},
        {text: " - Remove an installed mod\n", color: "gray"},
        {text: "/mod list", color: "yellow"},
        {text: " - View all installed mods\n", color: "gray"},
        {text: "/mod update", color: "yellow"},
        {text: " - Check for and install mod updates\n", color: "gray"},
        {text: "\n", color: "white"},
        {
          text: "[Suggest Command]",
          color: "green",
          clickEvent: {
            action: "suggest_command",
            value: "/mod "
          },
          hoverEvent: {
            action: "show_text",
            value: "Click to write a mod command"
          }
        }
      ]));

      return { messages };
    } catch (error) {
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, error: error.message };
    }
  }

  @Command(['mod', 'search'])
  @Description('Search for Fabric mods on Modrinth')
  @Permission('operator')
  @Argument([
    { name: 'query', type: 'string', description: 'Search query' }
  ])
  async search({ params, tellraw, log, kv }: ScriptContext): Promise<{ messages: any[], results?: ModrinthProject[] }> {
    const { sender, args } = params;
    const query = args.query;
    const mcVersion = await this.getServerVersion(kv);
    let messages = [];

    try {
      const response = await this.fetchFromModrinth(
        `/search?query=${encodeURIComponent(query)}&facets=[[%22categories:fabric%22]]`
      );
      const results = await response.json();

      messages = await tellraw(sender, JSON.stringify({
        text: `=== Search Results for "${query}" ===`,
        color: "gold",
        bold: true
      }));

      if (results.hits.length === 0) {
        messages = await tellraw(sender, JSON.stringify({
          text: "No results found",
          color: "red"
        }));
        return { messages, results: [] };
      }

      for (const hit of results.hits.slice(0, 5)) {
        const project = hit as ModrinthProject;
        messages = await tellraw(sender, JSON.stringify([
          {text: "\n"},
          {
            text: project.title,
            color: "yellow",
            bold: true,
            clickEvent: {
              action: "suggest_command",
              value: `/mod install ${project.slug}`
            },
            hoverEvent: {
              action: "show_text",
              value: "Click to install"
            }
          },
          {text: ` (${project.slug})\n`, color: "gray"},
          {text: `${project.description}\n`, color: "white"},
          {text: `Categories: ${project.categories.join(", ")}`, color: "aqua"}
        ]));
      }

      log(`Searched for mods matching "${query}"`);
      return { messages, results: results.hits };
    } catch (error) {
      log(`Error searching mods: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, error: error.message };
    }
  }

  @Command(['mod', 'install'])
  @Description('Install a Fabric mod from Modrinth')
  @Permission('operator')
  @Argument([
    { name: 'slug', type: 'string', description: 'Mod slug/ID' }
  ])
  async install({
                  params, tellraw, log, kv, files, sendToMinecraft
                }: ScriptContext): Promise<{ messages: any[], success?: boolean, installedMod?: InstalledMod }> {
    const { sender, args } = params;
    const { slug } = args;
    const mcVersion = await this.getServerVersion(kv);
    let messages = [];

    try {
      const installed = await kv.get(['installed_mods', slug]);
      if (installed.value) {
        throw new Error(`Mod ${slug} is already installed`);
      }

      messages = await tellraw(sender, JSON.stringify({
        text: `Fetching information for ${slug}...`,
        color: "yellow"
      }));

      const projectResponse = await this.fetchFromModrinth(`/project/${slug}`);
      const project = await projectResponse.json() as ModrinthProject;

      const versionsResponse = await this.fetchFromModrinth(`/project/${slug}/version`);
      const versions = await versionsResponse.json() as ModrinthVersion[];

      const version = await this.getCompatibleVersion(versions, mcVersion);
      if (!version) {
        throw new Error(`No compatible version found for Minecraft ${mcVersion}`);
      }

      const file = version.files.find(f => f.primary);
      if (!file) {
        throw new Error('No primary file found');
      }

      messages = await tellraw(sender, JSON.stringify({
        text: `Downloading ${project.title} v${version.version_number}...`,
        color: "yellow"
      }));

      await this.downloadModFile(sendToMinecraft, files, file.url, file.filename);

      const installedMod: InstalledMod = {
        slug,
        title: project.title,
        version: version.version_number,
        filename: file.filename,
        installedAt: Date.now()
      };
      await this.updateInstalledMods(kv, installedMod, 'add');

      messages = await tellraw(sender, JSON.stringify({
        text: `Successfully installed ${project.title} v${version.version_number}`,
        color: "green"
      }));

      log(`Installed mod ${slug} v${version.version_number}`);
      return { messages, success: true, installedMod };
    } catch (error) {
      log(`Error installing mod: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Command(['mod', 'uninstall'])
  @Description('Uninstall a Fabric mod')
  @Permission('operator')
  @Argument([
    { name: 'slug', type: 'string', description: 'Mod slug/ID' }
  ])
  async uninstall({
                    params, tellraw, log, kv, files, sendToMinecraft
                  }: ScriptContext): Promise<{ messages: any[], success?: boolean }> {
    const { sender, args } = params;
    const { slug } = args;
    let messages = [];

    try {
      const installed = await kv.get(['installed_mods', slug]);
      if (!installed.value) {
        throw new Error(`Mod ${slug} is not installed`);
      }

      const mod = installed.value as InstalledMod;

      messages = await tellraw(sender, JSON.stringify({
        text: `Uninstalling ${mod.title}...`,
        color: "yellow"
      }));

      await this.deleteModFile(sendToMinecraft, files, mod.filename);
      await this.updateInstalledMods(kv, mod, 'remove');

      messages = await tellraw(sender, JSON.stringify({
        text: `Successfully uninstalled ${mod.title}`,
        color: "green"
      }));

      log(`Uninstalled mod ${slug}`);
      return { messages, success: true };
    } catch (error) {
      log(`Error uninstalling mod: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Command(['mod', 'list'])
  @Description('List installed mods')
  @Permission('operator')
  async list({ params, tellraw, log, kv }: ScriptContext): Promise<{ messages: any[], mods?: InstalledMod[] }> {
    const { sender } = params;
    let messages = [];
    const mods: InstalledMod[] = [];

    try {
      for await (const entry of kv.list({ prefix: ['installed_mods'] })) {
        mods.push(entry.value as InstalledMod);
      }

      messages = await tellraw(sender, JSON.stringify({
        text: "=== Installed Mods ===",
        color: "gold",
        bold: true
      }));

      if (mods.length === 0) {
        messages = await tellraw(sender, JSON.stringify({
          text: "\nNo mods installed",
          color: "yellow"
        }));
        return { messages, mods };
      }

      for (const mod of mods) {
        messages = await tellraw(sender, JSON.stringify([
          {text: "\n"},
          {
            text: mod.title,
            color: "yellow",
            clickEvent: {
              action: "suggest_command",
              value: `/mod uninstall ${mod.slug}`
            },
            hoverEvent: {
              action: "show_text",
              value: "Click to uninstall"
            }
          },
          {text: ` (${mod.slug})\n`, color: "gray"},
          {text: `Version: ${mod.version}\n`, color: "white"},
          {text: `File: ${mod.filename}`, color: "aqua"}
        ]));
      }

      log('Listed installed mods');
      return { messages, mods };
    } catch (error) {
      log(`Error listing mods: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages };
    }
  }

  @Command(['mod', 'update'])
  @Description('Check for and install mod updates')
  @Permission('operator')
  async update({ params, tellraw, log, kv, files, sendToMinecraft }: ScriptContext): Promise<{
    messages: any[],
    success?: boolean,
    updatedCount?: number
  }> {
    const { sender } = params;
    const mcVersion = await this.getServerVersion(kv);
    let messages = [];
    let updatedCount = 0;

    try {
      const mods: InstalledMod[] = [];
      for await (const entry of kv.list({ prefix: ['installed_mods'] })) {
        mods.push(entry.value as InstalledMod);
      }

      if (mods.length === 0) {
        messages = await tellraw(sender, JSON.stringify({
          text: "No mods installed",
          color: "yellow"
        }));
        return { messages, success: true, updatedCount: 0 };
      }

      messages = await tellraw(sender, JSON.stringify({
        text: "Checking for updates...",
        color: "yellow"
      }));

      for (const mod of mods) {
        try {
          const versionsResponse = await this.fetchFromModrinth(`/project/${mod.slug}/version`);
          const versions = await versionsResponse.json() as ModrinthVersion[];
          const latestVersion = await this.getCompatibleVersion(versions, mcVersion);

          if (!latestVersion) continue;

          if (latestVersion.version_number !== mod.version) {
            const file = latestVersion.files.find(f => f.primary);
            if (!file) continue;

            messages = await tellraw(sender, JSON.stringify({
              text: `Updating ${mod.title}...`,
              color: "yellow"
            }));

            await this.downloadModFile(sendToMinecraft, files, file.url, file.filename);
            await this.deleteModFile(sendToMinecraft, files, mod.filename);

            const updatedMod: InstalledMod = {
              ...mod,
              version: latestVersion.version_number,
              filename: file.filename
            };
            await this.updateInstalledMods(kv, updatedMod, 'add');

            messages = await tellraw(sender, JSON.stringify({
              text: `Updated ${mod.title} from v${mod.version} to v${latestVersion.version_number}`,
              color: "green"
            }));

            updatedCount++;
          }
        } catch (error) {
          log(`Error checking update for ${mod.slug}: ${error.message}`);
          messages = await tellraw(sender, JSON.stringify({
            text: `Error updating ${mod.title}: ${error.message}`,
            color: "red"
          }));
        }
      }

      if (updatedCount === 0) {
        messages = await tellraw(sender, JSON.stringify({
          text: "All mods are up to date",
          color: "green"
        }));
      } else {
        messages = await tellraw(sender, JSON.stringify({
          text: `Updated ${updatedCount} mod${updatedCount === 1 ? '' : 's'}`,
          color: "green"
        }));
      }

      log(`Checked for updates, updated ${updatedCount} mods`);
      return { messages, success: true, updatedCount };
    } catch (error) {
      log(`Error updating mods: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }
}
