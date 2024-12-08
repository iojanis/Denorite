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

  @Command(['datapack', 'search'])
  @Description('Search for datapacks on Modrinth')
  @Permission('operator')
  @Argument([
    { name: 'query', type: 'string', description: 'Search query' }
  ])
  async search({ params, api, log, kv }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const query = args.query;
    const mcVersion = await this.getServerVersion(kv);

    try {
      // Use Modrinth's search with datapack category filter
      const response = await this.fetchFromModrinth(
        `/search?query=${encodeURIComponent(query)}&facets=[[%22project_type:datapack%22]]`
      );
      const results = await response.json();

      await api.tellraw(sender, JSON.stringify({
        text: `=== Datapack Search Results for "${query}" ===`,
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
        const datapack = hit as ModrinthProject;
        await api.tellraw(sender, JSON.stringify([
          { text: "\n" },
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
          { text: ` (${datapack.slug})\n`, color: "gray" },
          { text: `${datapack.description}\n`, color: "white" },
          { text: `Categories: ${datapack.categories.join(", ")}\n`, color: "aqua" },
          { text: `Downloads: ${datapack.downloads}`, color: "green" }
        ]));
      }

      log(`Searched for datapacks matching "${query}"`);
    } catch (error) {
      log(`Error searching datapacks: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['datapack', 'install'])
  @Description('Install a datapack from Modrinth')
  @Permission('operator')
  @Argument([
    { name: 'slug', type: 'string', description: 'Datapack slug/ID' }
  ])
  async install({ params, api, log, kv, files, sendToMinecraft }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const { slug } = args;
    const mcVersion = await this.getServerVersion(kv);

    try {
      // Check if already installed
      const installed = await kv.get(['installed_datapacks', slug]);
      if (installed.value) {
        throw new Error(`Datapack ${slug} is already installed`);
      }

      await api.tellraw(sender, JSON.stringify({
        text: `Fetching information for ${slug}...`,
        color: "yellow"
      }));

      // Get project info from Modrinth
      const projectResponse = await this.fetchFromModrinth(`/project/${slug}`);
      const project = await projectResponse.json() as ModrinthProject;


      // Verify it's a datapack
      if (!project.loaders.includes('datapack')) {
        throw new Error('This project is not a datapack');
      }

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

      // Download datapack
      await this.downloadDatapackFile(sendToMinecraft, files, file.url, file.filename);

      // Record installation
      const installedDatapack: InstalledDatapack = {
        slug,
        title: project.title,
        version: version.version_number,
        filename: file.filename,
        installedAt: Date.now()
      };
      await this.updateInstalledDatapacks(kv, installedDatapack, 'add');

      // Enable the datapack
      await api.execute(`datapack enable "file/${file.filename}"`);

      await api.tellraw(sender, JSON.stringify({
        text: `Successfully installed and enabled ${project.title} v${version.version_number}`,
        color: "green"
      }));

      log(`Installed datapack ${slug} v${version.version_number}`);
    } catch (error) {
      log(`Error installing datapack: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['datapack', 'uninstall'])
  @Description('Uninstall a datapack')
  @Permission('operator')
  @Argument([
    { name: 'slug', type: 'string', description: 'Datapack slug/ID' }
  ])
  async uninstall({ params, api, log, kv, files, sendToMinecraft }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const { slug } = args;

    try {
      const installed = await kv.get(['installed_datapacks', slug]);
      if (!installed.value) {
        throw new Error(`Datapack ${slug} is not installed`);
      }

      const datapack = installed.value as InstalledDatapack;

      await api.tellraw(sender, JSON.stringify({
        text: `Uninstalling ${datapack.title}...`,
        color: "yellow"
      }));

      // Disable the datapack first
      await api.execute(`datapack disable "${datapack.filename.replace('.zip', '')}"`);

      // Delete the file
      await this.deleteDatapackFile(sendToMinecraft, files, datapack.filename);
      await this.updateInstalledDatapacks(kv, datapack, 'remove');

      await api.tellraw(sender, JSON.stringify({
        text: `Successfully uninstalled ${datapack.title}`,
        color: "green"
      }));

      log(`Uninstalled datapack ${slug}`);
    } catch (error) {
      log(`Error uninstalling datapack: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['datapack', 'installed'])
  @Description('List installed datapacks')
  @Permission('operator')
  async list({ params, api, log, kv }: ScriptContext): Promise<void> {
    const { sender } = params;

    try {
      const datapacks: InstalledDatapack[] = [];
      for await (const entry of kv.list({ prefix: ['installed_datapacks'] })) {
        datapacks.push(entry.value as InstalledDatapack);
      }

      await api.tellraw(sender, JSON.stringify({
        text: "=== Installed Datapacks ===",
        color: "gold",
        bold: true
      }));

      if (datapacks.length === 0) {
        await api.tellraw(sender, JSON.stringify({
          text: "\nNo datapacks installed",
          color: "yellow"
        }));
        return;
      }

      for (const datapack of datapacks) {
        await api.tellraw(sender, JSON.stringify([
          { text: "\n" },
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
          { text: ` (${datapack.slug})\n`, color: "gray" },
          { text: `Version: ${datapack.version}\n`, color: "white" },
          { text: `File: ${datapack.filename}`, color: "aqua" }
        ]));
      }

      log('Listed installed datapacks');
    } catch (error) {
      log(`Error listing datapacks: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['datapack', 'update'])
  @Description('Check for and install datapack updates')
  @Permission('operator')
  async update({ params, api, log, kv, files, sendToMinecraft }: ScriptContext): Promise<void> {
    const { sender } = params;
    const mcVersion = await this.getServerVersion(kv);

    try {
      const datapacks: InstalledDatapack[] = [];
      for await (const entry of kv.list({ prefix: ['installed_datapacks'] })) {
        datapacks.push(entry.value as InstalledDatapack);
      }

      if (datapacks.length === 0) {
        await api.tellraw(sender, JSON.stringify({
          text: "No datapacks installed",
          color: "yellow"
        }));
        return;
      }

      await api.tellraw(sender, JSON.stringify({
        text: "Checking for updates...",
        color: "yellow"
      }));

      let updatedCount = 0;

      for (const datapack of datapacks) {
        try {
          const versionsResponse = await this.fetchFromModrinth(`/project/${datapack.slug}/version`);
          const versions = await versionsResponse.json() as ModrinthVersion[];
          const latestVersion = await this.getCompatibleVersion(versions, mcVersion);

          if (!latestVersion) {
            continue;
          }

          if (latestVersion.version_number !== datapack.version) {
            const file = latestVersion.files.find(f => f.primary);
            if (!file) continue;

            await api.tellraw(sender, JSON.stringify({
              text: `Updating ${datapack.title}...`,
              color: "yellow"
            }));

            // Disable current version
            await api.execute(`datapack disable "${datapack.filename.replace('.zip', '')}"`);

            // Download new version
            await this.downloadDatapackFile(sendToMinecraft, files, file.url, file.filename);

            // Delete old version
            await this.deleteDatapackFile(sendToMinecraft, files, datapack.filename);

            // Enable new version
            await api.execute(`datapack enable "${file.filename.replace('.zip', '')}"`);

            // Update installation record
            const updatedDatapack: InstalledDatapack = {
              ...datapack,
              version: latestVersion.version_number,
              filename: file.filename
            };
            await this.updateInstalledDatapacks(kv, updatedDatapack, 'add');

            await api.tellraw(sender, JSON.stringify({
              text: `Updated ${datapack.title} from v${datapack.version} to v${latestVersion.version_number}`,
              color: "green"
            }));

            updatedCount++;
          }
        } catch (error) {
          log(`Error checking update for ${datapack.slug}: ${error.message}`);
          await api.tellraw(sender, JSON.stringify({
            text: `Error updating ${datapack.title}: ${error.message}`,
            color: "red"
          }));
        }
      }

      if (updatedCount === 0) {
        await api.tellraw(sender, JSON.stringify({
          text: "All datapacks are up to date",
          color: "green"
        }));
      } else {
        await api.tellraw(sender, JSON.stringify({
          text: `Updated ${updatedCount} datapack${updatedCount === 1 ? '' : 's'}`,
          color: "green"
        }));
      }

      log(`Checked for updates, updated ${updatedCount} datapacks`);
    } catch (error) {
      log(`Error updating datapacks: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }
}
