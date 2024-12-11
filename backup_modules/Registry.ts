import { Module, Command, Description, Permission, Argument } from '../decorators.ts';
import { ScriptContext } from '../types.ts';
import { join, basename, extname } from "https://deno.land/std/path/mod.ts";

interface Package {
  name: string;
  version: string;
  metadata: Record<string, any>;
  content: string;
  userspace: string;
  createdAt: number;
}

interface PackageConfig {
  registryUrl: string;
  serverToken: string;
  defaultUserspace: string;
}

interface InstallRecord {
  name: string;
  version: string;
  userspace: string;
  type: 'module' | 'component';
  installedAt: number;
}

interface Backup {
  id: string;
  package: Package;
  type: 'module' | 'component';
  createdAt: number;
}

@Module({
  name: 'Registry',
  version: '1.2.1',
  description: 'Manages modules and components from registry'
})
export class PackageManager {
  private readonly MODULES_DIR = './modules';
  private readonly COMPONENTS_DIR = './components';

  private parsePackagePath(path: string, defaultUserspace: string): { userspace: string, name: string } {
    if (path.includes('/')) {
      const [userspace, ...nameParts] = path.split('/');
      return { userspace, name: nameParts.join('/') };
    }
    return { userspace: defaultUserspace, name: path };
  }

  private async getConfig(kv: Deno.Kv): Promise<PackageConfig> {
    const defaultConfig: PackageConfig = {
      registryUrl: 'https://registry.cou.sh',
      serverToken: 'eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJ0eXBlIjoic2VydmVyIiwidXNlcnNwYWNlIjoiY291IiwiZXhwIjoxNzMyNzM4Nzg1fQ.zc7C7sKiY8F9j3zfV7KlNjaPoEHHegCrASm7xq402g5BD0yPUu9YVZXBD-IO9IvQxtAZyQbG7AVYB4rEwKoHxQ',
      defaultUserspace: 'cou'
    };

    const config = await kv.get(['config', 'package-manager']);
    return config.value as PackageConfig || defaultConfig;
  }

  private async createBackup(kv: Deno.Kv, pkg: Package, type: 'module' | 'component'): Promise<string> {
    const backupId = crypto.randomUUID();
    const backup: Backup = {
      id: backupId,
      package: pkg,
      type,
      createdAt: Date.now()
    };
    await kv.set(['backups', backupId], backup);
    return backupId;
  }

  private async restoreFromBackup(kv: Deno.Kv, backupId: string): Promise<Package | null> {
    const backup = await kv.get(['backups', backupId]);
    if (!backup.value) return null;
    return (backup.value as Backup).package;
  }

  private async fetchFromRegistry(path: string, config: PackageConfig, method = 'GET', body?: unknown): Promise<Response> {
    try {
      const response = await fetch(`${config.registryUrl}${path}`, {
        method,
        headers: {
          'Authorization': `Bearer ${config.serverToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
      });

      // Log response details in debug mode
      if (!response.ok) {
        const errorText = await response.text();
        console.debug(`Registry request failed: ${response.status} - ${errorText}`);
        throw new Error(errorText || `Request failed with status ${response.status}`);
      }

      return response;
    } catch (error) {
      console.error('Registry request error:', error);
      throw error;
    }
  }

  private async savePackage(kv: Deno.Kv, pkg: Package, type: 'module' | 'component'): Promise<void> {
    const baseDir = type === 'module' ? this.MODULES_DIR : this.COMPONENTS_DIR;
    const ext = type === 'module' ? '.ts' : '.vue';

    await Deno.mkdir(baseDir, { recursive: true });
    const fileName = `${pkg.userspace}_${pkg.name}${ext}`;
    const filePath = join(baseDir, fileName);
    await Deno.writeTextFile(filePath, pkg.content);

    const installRecord: InstallRecord = {
      name: pkg.name,
      version: pkg.version,
      userspace: pkg.userspace,
      type,
      installedAt: Date.now()
    };

    await kv.set(['installed', type, pkg.name], installRecord);
  }

  private async getInstalledPackages(kv: Deno.Kv, type?: 'module' | 'component'): Promise<InstallRecord[]> {
    const packages: InstallRecord[] = [];
    const prefix = type ? ['installed', type] : ['installed'];

    for await (const entry of kv.list({ prefix })) {
      packages.push(entry.value as InstallRecord);
    }

    return packages;
  }

  @Command(['registry', 'install'])
  @Description('Install a module or component from the registry')
  @Permission('operator')
  @Argument([
    { name: 'type', type: 'string', description: 'Type of package (module/component)' },
    { name: 'path', type: 'string', description: 'Package path (e.g., userspace/name or just name)' }
  ])
  async install({ params, api, log, kv }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const { type } = args;
    const config = await this.getConfig(kv);
    const { userspace, name } = this.parsePackagePath(args.path, config.defaultUserspace);

    if (!['module', 'component'].includes(type)) {
      await api.tellraw(sender, JSON.stringify({
        text: "Type must be either 'module' or 'component'",
        color: "red"
      }));
      return;
    }

    try {
      const installed = await kv.get(['installed', type, name]);
      if (installed.value) {
        const record = installed.value as InstallRecord;
        throw new Error(`Package ${name} is already installed (v${record.version} from ${record.userspace})`);
      }

      const response = await this.fetchFromRegistry(`/${userspace}/${type}s/${name}`, config);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch package');
      }

      const responseData = await response.json();
      if (!responseData || !responseData.metadata || !responseData.content) {
        throw new Error('Invalid package data received from registry');
      }

      const pkg: Package = {
        name,
        version: responseData.metadata.version,
        metadata: responseData.metadata,
        content: responseData.content,
        userspace,
        createdAt: Date.now()
      };

      const backupId = await this.createBackup(kv, pkg, type as 'module' | 'component');

      try {
        await this.savePackage(kv, pkg, type as 'module' | 'component');

        await api.tellraw(sender, JSON.stringify({
          text: `Successfully installed ${type} ${userspace}/${name} v${pkg.version}`,
          color: "green"
        }));

        log(`Installed ${type} ${userspace}/${name} v${pkg.version}`);
      } catch (error) {
        const backup = await this.restoreFromBackup(kv, backupId);
        if (backup) {
          await this.savePackage(kv, backup, type as 'module' | 'component');
          throw new Error(`Installation failed, rolled back to previous version: ${error.message}`);
        }
        throw error;
      }
    } catch (error) {
      log(`Error installing ${type} ${userspace}/${name}: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['registry', 'uninstall'])
  @Description('Uninstall a module or component')
  @Permission('operator')
  @Argument([
    { name: 'type', type: 'string', description: 'Type of package (module/component)' },
    { name: 'name', type: 'string', description: 'Name of the package' }
  ])
  async uninstall({ params, api, log, kv }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const { type, name } = args;

    if (!['module', 'component'].includes(type)) {
      await api.tellraw(sender, JSON.stringify({
        text: "Type must be either 'module' or 'component'",
        color: "red"
      }));
      return;
    }

    try {
      const installed = await kv.get(['installed', type, name]);
      if (!installed.value) {
        throw new Error(`Package ${name} is not installed`);
      }

      const record = installed.value as InstallRecord;
      const baseDir = type === 'module' ? this.MODULES_DIR : this.COMPONENTS_DIR;
      const ext = type === 'module' ? '.ts' : '.vue';
      const fileName = `${record.userspace}_${name}${ext}`;
      const filePath = join(baseDir, fileName);

      const content = await Deno.readTextFile(filePath);
      const pkg: Package = {
        name,
        version: record.version,
        userspace: record.userspace,
        content,
        metadata: {},
        createdAt: record.installedAt
      };

      const backupId = await this.createBackup(kv, pkg, type as 'module' | 'component');

      try {
        await Deno.remove(filePath);
        await kv.delete(['installed', type, name]);

        await api.tellraw(sender, JSON.stringify({
          text: `Successfully uninstalled ${type} ${name}`,
          color: "green"
        }));

        log(`Uninstalled ${type} ${name}`);
      } catch (error) {
        const backup = await this.restoreFromBackup(kv, backupId);
        if (backup) {
          await this.savePackage(kv, backup, type as 'module' | 'component');
          throw new Error(`Uninstall failed, rolled back to previous state: ${error.message}`);
        }
        throw error;
      }
    } catch (error) {
      log(`Error uninstalling ${type} ${name}: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['registry', 'update'])
  @Description('Update a specific module or component')
  @Permission('operator')
  @Argument([
    { name: 'type', type: 'string', description: 'Type of package (module/component)' },
    { name: 'name', type: 'string', description: 'Name of the package' }
  ])
  async update({ params, api, log, kv }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const { type, name } = args;
    const config = await this.getConfig(kv);

    if (!['module', 'component'].includes(type)) {
      await api.tellraw(sender, JSON.stringify({
        text: "Type must be either 'module' or 'component'",
        color: "red"
      }));
      return;
    }

    try {
      const installed = await kv.get(['installed', type, name]);
      if (!installed.value) {
        throw new Error(`Package ${name} is not installed`);
      }

      const record = installed.value as InstallRecord;
      const response = await this.fetchFromRegistry(`/${record.userspace}/${type}s/${name}`, config);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch package');
      }

      const pkg = await response.json();

      if (pkg.version === record.version) {
        await api.tellraw(sender, JSON.stringify({
          text: `${type} ${name} is already up to date (v${record.version})`,
          color: "yellow"
        }));
        return;
      }

      const backupId = await this.createBackup(kv, pkg, type as 'module' | 'component');

      try {
        await this.savePackage(kv, pkg, type as 'module' | 'component');

        await api.tellraw(sender, JSON.stringify({
          text: `Updated ${type} ${name} from v${record.version} to v${pkg.version}`,
          color: "green"
        }));

        log(`Updated ${type} ${name} to v${pkg.version}`);
      } catch (error) {
        const backup = await this.restoreFromBackup(kv, backupId);
        if (backup) {
          await this.savePackage(kv, backup, type as 'module' | 'component');
          throw new Error(`Update failed, rolled back to v${record.version}: ${error.message}`);
        }
        throw error;
      }
    } catch (error) {
      log(`Error updating ${type} ${name}: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['registry', 'list'])
  @Description('List installed packages and their versions')
  @Permission('operator')
  async list({ params, api, log, kv }: ScriptContext): Promise<void> {
    const { sender } = params;

    try {
      const [modules, components] = await Promise.all([
        this.getInstalledPackages(kv, 'module'),
        this.getInstalledPackages(kv, 'component')
      ]);

      await api.tellraw(sender, JSON.stringify({
        text: "=== Installed Packages ===",
        color: "gold",
        bold: true
      }));

      if (modules.length > 0) {
        await api.tellraw(sender, JSON.stringify({
          text: "\nModules:",
          color: "yellow"
        }));

        for (const pkg of modules) {
          await api.tellraw(sender, JSON.stringify({
            text: `  ${pkg.name} (v${pkg.version}) [${pkg.userspace}]`,
            color: "white"
          }));
        }
      }

      if (components.length > 0) {
        await api.tellraw(sender, JSON.stringify({
          text: "\nComponents:",
          color: "yellow"
        }));

        for (const pkg of components) {
          await api.tellraw(sender, JSON.stringify({
            text: `  ${pkg.name} (v${pkg.version}) [${pkg.userspace}]`,
            color: "white"
          }));
        }
      }

      if (modules.length === 0 && components.length === 0) {
        await api.tellraw(sender, JSON.stringify({
          text: "\nNo packages installed",
          color: "yellow"
        }));
      }

      log('Listed installed packages');
    } catch (error) {
      log(`Error listing packages: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }
  // Add these commands to the PackageManager class:

  @Command(['registry', 'packages'])
  @Description('List all available public or accessible packages')
  @Permission('operator')
  @Argument([
    { name: 'type', type: 'string', description: 'Type of package (module/component)', optional: true },
    { name: 'userspace', type: 'string', description: 'Filter by userspace', optional: true }
  ])
  async packages({ params, api, log, kv }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const config = await this.getConfig(kv);
    const userspace = args.userspace || config.defaultUserspace;
    const type = args.type?.toLowerCase();

    if (type && !['module', 'component'].includes(type)) {
      await api.tellraw(sender, JSON.stringify({
        text: "Type must be either 'module' or 'component'",
        color: "red"
      }));
      return;
    }

    try {
      // Fetch all packages
      const responses = await Promise.all([
        type !== 'component' ? this.fetchFromRegistry('/public/modules', config) : null,
        type !== 'module' ? this.fetchFromRegistry('/public/components', config) : null,
        this.fetchFromRegistry(`/${userspace}/modules`, config),
        this.fetchFromRegistry(`/${userspace}/components`, config)
      ]);

      const [publicModules, publicComponents, userspaceModules, userspaceComponents] = await Promise.all(
        responses.map(r => r ? r.json().catch(() => ({})) : {})
      );

      await api.tellraw(sender, JSON.stringify({
        text: "=== Available Packages ===",
        color: "gold",
        bold: true
      }));

      if (!type || type === 'module') {
        await api.tellraw(sender, JSON.stringify({
          text: "\nPublic Modules:",
          color: "yellow"
        }));

        if (publicModules.length > 0) {
          for (const pkg of publicModules) {
            await api.tellraw(sender, JSON.stringify({
              text: `  ${pkg.name} (v${pkg.version}) [public]`,
              color: "white",
              clickEvent: {
                action: "suggest_command",
                value: `/registry install module ${pkg.name}`
              },
              hoverEvent: {
                action: "show_text",
                value: `Click to install ${pkg.name}`
              }
            }));
          }
        } else {
          await api.tellraw(sender, JSON.stringify({
            text: "  No public modules available",
            color: "gray"
          }));
        }

        await api.tellraw(sender, JSON.stringify({
          text: `\nModules in ${userspace}:`,
          color: "yellow"
        }));

        if (userspaceModules.length > 0) {
          for (const pkg of userspaceModules) {
            await api.tellraw(sender, JSON.stringify({
              text: `  ${pkg.name} (v${pkg.version}) [${userspace}]`,
              color: "white",
              clickEvent: {
                action: "suggest_command",
                value: `/registry install module ${pkg.name} ${userspace}`
              },
              hoverEvent: {
                action: "show_text",
                value: `Click to install ${pkg.name}`
              }
            }));
          }
        } else {
          await api.tellraw(sender, JSON.stringify({
            text: `  No modules available in ${userspace}`,
            color: "gray"
          }));
        }
      }

      if (!type || type === 'component') {
        await api.tellraw(sender, JSON.stringify({
          text: "\nPublic Components:",
          color: "yellow"
        }));

        if (publicComponents.length > 0) {
          for (const pkg of publicComponents) {
            await api.tellraw(sender, JSON.stringify({
              text: `  ${pkg.name} (v${pkg.version}) [public]`,
              color: "white",
              clickEvent: {
                action: "suggest_command",
                value: `/registry install component ${pkg.name}`
              },
              hoverEvent: {
                action: "show_text",
                value: `Click to install ${pkg.name}`
              }
            }));
          }
        } else {
          await api.tellraw(sender, JSON.stringify({
            text: "  No public components available",
            color: "gray"
          }));
        }

        await api.tellraw(sender, JSON.stringify({
          text: `\nComponents in ${userspace}:`,
          color: "yellow"
        }));

        if (userspaceComponents.length > 0) {
          for (const pkg of userspaceComponents) {
            await api.tellraw(sender, JSON.stringify({
              text: `  ${pkg.name} (v${pkg.version}) [${userspace}]`,
              color: "white",
              clickEvent: {
                action: "suggest_command",
                value: `/registry install component ${pkg.name} ${userspace}`
              },
              hoverEvent: {
                action: "show_text",
                value: `Click to install ${pkg.name}`
              }
            }));
          }
        } else {
          await api.tellraw(sender, JSON.stringify({
            text: `  No components available in ${userspace}`,
            color: "gray"
          }));
        }
      }

      log('Listed available packages');
    } catch (error) {
      log(`Error listing available packages: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['registry', 'publish'])
  @Description('Publish a module or component to the registry')
  @Permission('operator')
  @Argument([
    { name: 'userspace', type: 'string', description: 'Target userspace' },
    { name: 'file', type: 'string', description: 'Path to the file' }
  ])
  async publish({ params, api, log, kv }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const { userspace, file } = args;
    const config = await this.getConfig(kv);

    try {
      // Read and validate file
      const content = await Deno.readTextFile(file);
      const ext = extname(file);
      const type = ext === '.ts' ? 'module' : ext === '.vue' ? 'component' : null;

      if (!type) {
        throw new Error('Invalid file type. Must be .ts or .vue');
      }

      // Extract metadata
      let metadata = {};
      let version = '1.0.0';
      let name = basename(file).replace(ext, '');

      if (type === 'module') {
        const moduleMatch = content.match(/@Module\(\{([^}]+)\}\)/);
        if (moduleMatch) {
          const moduleContent = moduleMatch[1];
          const nameMatch = moduleContent.match(/name:\s*['"]([^'"]+)['"]/);
          const versionMatch = moduleContent.match(/version:\s*['"]([^'"]+)['"]/);

          if (nameMatch) name = nameMatch[1];
          if (versionMatch) version = versionMatch[1];
          metadata = { name, version };
        } else {
          throw new Error('Invalid module: Missing @Module decorator');
        }
      } else {
        const appMatch = content.match(/<!--\s*@app\s*({[^}]+})\s*-->/);
        if (appMatch) {
          try {
            metadata = JSON.parse(appMatch[1]);
            version = metadata.version || version;
            name = metadata.name || name;
          } catch {
            throw new Error('Invalid component: Malformed @app metadata');
          }
        } else {
          throw new Error('Invalid component: Missing @app metadata');
        }
      }

      const formData = new FormData();
      const fileBlob = new Blob([content], { type: 'text/plain' });
      formData.append('file', fileBlob, `${name}${ext}`);
      formData.append('name', name);
      formData.append('version', version);
      formData.append('metadata', JSON.stringify(metadata));
      formData.append('isPublic', 'true');

      // Upload to registry
      const response = await fetch(
        `${config.registryUrl}/${userspace}/upload`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.serverToken}`
          },
          body: formData
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      await api.tellraw(sender, JSON.stringify({
        text: `Successfully published ${type} ${name} v${version} to ${userspace}`,
        color: "green"
      }));

      log(`Published ${type} ${name} v${version} to ${userspace}`);
    } catch (error) {
      log(`Error publishing file: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }
}
