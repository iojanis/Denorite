import { Module, Command, Description, Permission, Argument } from '../decorators.ts';
import { ScriptContext } from '../types.ts';

interface ModrinthProject {
  slug: string;
  title: string;
  description: string;
  categories: string[];
  versions: string[];
  downloads: number;
  loaders: string[];
}

interface ModrinthVersion {
  id: string;
  project_id: string;
  version_number: string;
  game_versions: string[];
  files: {
    url: string;
    filename: string;
    primary: boolean;
  }[];
}

interface InstalledDatapack {
  slug: string;
  title: string;
  version: string;
  filename: string;
  installedAt: number;
}

@Module({
  name: 'Datapack',
  version: '1.0.0',
  description: 'Manage Minecraft Datapacks from Modrinth'
})
export class DatapackManager {
  // Helper methods remain unchanged
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
      v.game_versions.includes(mcVersion)
    );

    return compatibleVersions.sort((a, b) =>
      b.version_number.localeCompare(a.version_number)
    )[0] || null;
  }

  private async updateInstalledDatapacks(kv: Deno.Kv, datapack: InstalledDatapack | null, action: 'add' | 'remove'): Promise<void> {
    if (action === 'add' && datapack) {
      await kv.set(['installed_datapacks', datapack.slug], datapack);
    } else if (action === 'remove' && datapack) {
      await kv.delete(['installed_datapacks', datapack.slug]);
    }
  }

  private async downloadDatapackFile(sendToMinecraft: any, files: any, url: string, filename: string): Promise<void> {
    const response = await sendToMinecraft({
      type: "files",
      subcommand: "download",
      arguments: {
        url: url,
        targetPath: `world/datapacks/${filename}`
      }
    });

    if (!response) {
      throw new Error(response.error || 'Failed to download datapack file');
    }
  }

  private async deleteDatapackFile(sendToMinecraft: any, files: any, filename: string): Promise<void> {
    const response = await sendToMinecraft({
      type: "files",
      subcommand: "delete",
      arguments: {
        path: `world/datapacks/${filename}`
      }
    });

    if (!response) {
      throw new Error(response.error || 'Failed to delete datapack file');
    }
  }

  @Command(['datapack'])
  @Description('Datapack management commands')
  @Permission('operator')
  async datapack({ params, kv, tellraw, api }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;
    let messages = [];

    try {
      messages = await tellraw(sender, JSON.stringify([
        {text: "=== Datapack Commands ===\n", color: "gold", bold: true},
        {text: "/datapack search <query>", color: "yellow"},
        {text: " - Search for datapacks on Modrinth\n", color: "gray"},
        {text: "/datapack install <slug>", color: "yellow"},
        {text: " - Install a datapack from Modrinth\n", color: "gray"},
        {text: "/datapack uninstall <slug>", color: "yellow"},
        {text: " - Remove an installed datapack\n", color: "gray"},
        {text: "/datapack installed", color: "yellow"},
        {text: " - View all installed datapacks\n", color: "gray"},
        {text: "/datapack update", color: "yellow"},
        {text: " - Check for and install datapack updates\n", color: "gray"},
        {text: "\n", color: "white"},
        {
          text: "[Suggest Command]",
          color: "green",
          clickEvent: {
            action: "suggest_command",
            value: "/datapack "
          },
          hoverEvent: {
            action: "show_text",
            value: "Click to write a datapack command"
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

  @Command(['datapack', 'search'])
  @Description('Search for datapacks on Modrinth')
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
        `/search?query=${encodeURIComponent(query)}&facets=[[%22project_type:datapack%22]]`
      );
      const results = await response.json();

      messages = await tellraw(sender, JSON.stringify({
        text: `=== Datapack Search Results for "${query}" ===`,
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
        const datapack = hit as ModrinthProject;
        messages = await tellraw(sender, JSON.stringify([
          {text: "\n"},
          {
            text: datapack.title,
            color: "yellow",
            bold: true,
            clickEvent: {
              action: "suggest_command",
              value: `/datapack install ${datapack.slug}`
            },
            hoverEvent: {
              action: "show_text",
              value: "Click to install"
            }
          },
          {text: ` (${datapack.slug})\n`, color: "gray"},
          {text: `${datapack.description}\n`, color: "white"},
          {text: `Categories: ${datapack.categories.join(", ")}\n`, color: "aqua"},
          {text: `Downloads: ${datapack.downloads}`, color: "green"}
        ]));
      }

      log(`Searched for datapacks matching "${query}"`);
      return { messages, results: results.hits };
    } catch (error) {
      log(`Error searching datapacks: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, error: error.message };
    }
  }

  @Command(['datapack', 'install'])
  @Description('Install a datapack from Modrinth')
  @Permission('operator')
  @Argument([
    { name: 'slug', type: 'string', description: 'Datapack slug/ID' }
  ])
  async install({
                  params, tellraw, log, kv, files, sendToMinecraft, api
                }: ScriptContext): Promise<{ messages: any[], success?: boolean, installedDatapack?: InstalledDatapack }> {
    const { sender, args } = params;
    const { slug } = args;
    const mcVersion = await this.getServerVersion(kv);
    let messages = [];

    try {
      const installed = await kv.get(['installed_datapacks', slug]);
      if (installed.value) {
        throw new Error(`Datapack ${slug} is already installed`);
      }

      messages = await tellraw(sender, JSON.stringify({
        text: `Fetching information for ${slug}...`,
        color: "yellow"
      }));

      const projectResponse = await this.fetchFromModrinth(`/project/${slug}`);
      const project = await projectResponse.json() as ModrinthProject;

      if (!project.loaders.includes('datapack')) {
        throw new Error('This project is not a datapack');
      }

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

      await this.downloadDatapackFile(sendToMinecraft, files, file.url, file.filename);

      const installedDatapack: InstalledDatapack = {
        slug,
        title: project.title,
        version: version.version_number,
        filename: file.filename,
        installedAt: Date.now()
      };
      await this.updateInstalledDatapacks(kv, installedDatapack, 'add');

      await api.execute(`datapack enable "file/${file.filename}"`);

      messages = await tellraw(sender, JSON.stringify({
        text: `Successfully installed and enabled ${project.title} v${version.version_number}`,
        color: "green"
      }));

      log(`Installed datapack ${slug} v${version.version_number}`);
      return { messages, success: true, installedDatapack };
    } catch (error) {
      log(`Error installing datapack: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Command(['datapack', 'uninstall'])
  @Description('Uninstall a datapack')
  @Permission('operator')
  @Argument([
    { name: 'slug', type: 'string', description: 'Datapack slug/ID' }
  ])
  async uninstall({
                    params, tellraw, log, kv, files, sendToMinecraft, api
                  }: ScriptContext): Promise<{ messages: any[], success?: boolean }> {
    const { sender, args } = params;
    const { slug } = args;
    let messages = [];

    try {
      const installed = await kv.get(['installed_datapacks', slug]);
      if (!installed.value) {
        throw new Error(`Datapack ${slug} is not installed`);
      }

      const datapack = installed.value as InstalledDatapack;

      messages = await tellraw(sender, JSON.stringify({
        text: `Uninstalling ${datapack.title}...`,
        color: "yellow"
      }));

      await api.execute(`datapack disable "${datapack.filename.replace('.zip', '')}"`);
      await this.deleteDatapackFile(sendToMinecraft, files, datapack.filename);
      await this.updateInstalledDatapacks(kv, datapack, 'remove');

      messages = await tellraw(sender, JSON.stringify({
        text: `Successfully uninstalled ${datapack.title}`,
        color: "green"
      }));

      log(`Uninstalled datapack ${slug}`);
      return { messages, success: true };
    } catch (error) {
      log(`Error uninstalling datapack: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Command(['datapack', 'installed'])
  @Description('List installed datapacks')
  @Permission('operator')
  async list({ params, tellraw, log, kv }: ScriptContext): Promise<{ messages: any[], datapacks?: InstalledDatapack[] }> {
    const { sender } = params;
    let messages = [];
    const datapacks: InstalledDatapack[] = [];

    try {
      for await (const entry of kv.list({ prefix: ['installed_datapacks'] })) {
        datapacks.push(entry.value as InstalledDatapack);
      }

      messages = await tellraw(sender, JSON.stringify({
        text: "=== Installed Datapacks ===",
        color: "gold",
        bold: true
      }));

      if (datapacks.length === 0) {
        messages = await tellraw(sender, JSON.stringify({
          text: "\nNo datapacks installed",
          color: "yellow"
        }));
        return { messages, datapacks };
      }

      for (const datapack of datapacks) {
        messages = await tellraw(sender, JSON.stringify([
          {text: "\n"},
          {
            text: datapack.title,
            color: "yellow",
            clickEvent: {
              action: "suggest_command",
              value: `/datapack uninstall ${datapack.slug}`
            },
            hoverEvent: {
              action: "show_text",
              value: "Click to uninstall"
            }
          },
          {text: ` (${datapack.slug})\n`, color: "gray"},
          {text: `Version: ${datapack.version}\n`, color: "white"},
          {text: `File: ${datapack.filename}`, color: "aqua"}
        ]));
      }

      log('Listed installed datapacks');
      return { messages, datapacks };
    } catch (error) {
      log(`Error listing datapacks: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages };
    }
  }

  @Command(['datapack', 'update'])
  @Description('Check for and install datapack updates')
  @Permission('operator')
  async update({ params, tellraw, log, kv, files, sendToMinecraft, api }: ScriptContext): Promise<{
    messages: any[],
    success?: boolean,
    updatedCount?: number
  }> {
    const { sender } = params;
    const mcVersion = await this.getServerVersion(kv);
    let messages = [];
    let updatedCount = 0;

    try {
      const datapacks: InstalledDatapack[] = [];
      for await (const entry of kv.list({ prefix: ['installed_datapacks'] })) {
        datapacks.push(entry.value as InstalledDatapack);
      }

      if (datapacks.length === 0) {
        messages = await tellraw(sender, JSON.stringify({
          text: "No datapacks installed",
          color: "yellow"
        }));
        return { messages, success: true, updatedCount: 0 };
      }

      messages = await tellraw(sender, JSON.stringify({
        text: "Checking for updates...",
        color: "yellow"
      }));

      for (const datapack of datapacks) {
        try {
          const versionsResponse = await this.fetchFromModrinth(`/project/${datapack.slug}/version`);
          const versions = await versionsResponse.json() as ModrinthVersion[];
          const latestVersion = await this.getCompatibleVersion(versions, mcVersion);

          if (!latestVersion) continue;

          if (latestVersion.version_number !== datapack.version) {
            const file = latestVersion.files.find(f => f.primary);
            if (!file) continue;

            messages = await tellraw(sender, JSON.stringify({
              text: `Updating ${datapack.title}...`,
              color: "yellow"
            }));

            await api.execute(`datapack disable "${datapack.filename.replace('.zip', '')}"`);
            await this.downloadDatapackFile(sendToMinecraft, files, file.url, file.filename);
            await this.deleteDatapackFile(sendToMinecraft, files, datapack.filename);
            await api.execute(`datapack enable "${file.filename.replace('.zip', '')}"`);

            const updatedDatapack: InstalledDatapack = {
              ...datapack,
              version: latestVersion.version_number,
              filename: file.filename
            };
            await this.updateInstalledDatapacks(kv, updatedDatapack, 'add');

            messages = await tellraw(sender, JSON.stringify({
              text: `Updated ${datapack.title} from v${datapack.version} to v${latestVersion.version_number}`,
              color: "green"
            }));

            updatedCount++;
          }
        } catch (error) {
          log(`Error checking update for ${datapack.slug}: ${error.message}`);
          messages = await tellraw(sender, JSON.stringify({
            text: `Error updating ${datapack.title}: ${error.message}`,
            color: "red"
          }));
        }
      }

      if (updatedCount === 0) {
        messages = await tellraw(sender, JSON.stringify({
          text: "All datapacks are up to date",
          color: "green"
        }));
      } else {
        messages = await tellraw(sender, JSON.stringify({
          text: `Updated ${updatedCount} datapack${updatedCount === 1 ? '' : 's'}`,
          color: "green"
        }));
      }

      log(`Checked for updates, updated ${updatedCount} datapacks`);
      return { messages, success: true, updatedCount };
    } catch (error) {
      log(`Error updating datapacks: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }
}
