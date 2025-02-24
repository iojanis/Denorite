import { Module, Permission, Socket } from "../decorators.ts";
import { ScriptContext } from "../types.ts";

interface PackageConfig {
  registryUrl: string;
  serverToken: string;
  defaultUserspace: string;
}

interface InstallRecord {
  name: string;
  version: string;
  userspace: string;
  type: "module" | "component";
  installedAt: number;
  updatedAt?: number;
}

@Module({
  name: "RegistryHelper",
  version: "1.0.0",
})
export class RegistryHelper {
  private async getConfig(kv: Deno.Kv): Promise<PackageConfig> {
    const defaultConfig: PackageConfig = {
      registryUrl: "https://registry.cou.sh",
      serverToken:
        "eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJ0eXBlIjoic2VydmVyIiwidXNlcnNwYWNlIjoiY291IiwiZXhwIjoxNzMyNzM4Nzg1fQ.zc7C7sKiY8F9j3zfV7KlNjaPoEHHegCrASm7xq402g5BD0yPUu9YVZXBD-IO9IvQxtAZyQbG7AVYB4rEwKoHxQ",
      defaultUserspace: "cou",
    };

    const config = await kv.get(["config", "registry"]);
    return config.value as PackageConfig || defaultConfig;
  }

  @Socket("registry.list")
  @Permission("operator")
  async handleList({ log, kv }: ScriptContext): Promise<{
    packages: InstallRecord[];
  }> {
    try {
      const packages = [];
      const iterator = kv.list({ prefix: ["installed"] });

      for await (const entry of iterator) {
        packages.push(entry.value);
      }

      log(`Listed ${packages.length} installed packages`);
      return { packages };
    } catch (error) {
      log(`Error listing packages: ${error.message}`);
      throw error;
    }
  }

  @Socket("registry.packages")
  @Permission("operator")
  async handleGetPackages({ params, log, kv }: ScriptContext): Promise<{
    modules: any[];
    components: any[];
  }> {
    try {
      const { type } = params;
      const config = await this.getConfig(kv);

      // Get installed packages for version comparison
      const installed = new Map<string, string>();
      const installedIterator = kv.list({ prefix: ["installed"] });
      for await (const entry of installedIterator) {
        const record = entry.value as InstallRecord;
        installed.set(`${record.type}/${record.name}`, record.version);
      }

      const modules = [];
      const components = [];

      // Fetch and process modules
      if (!type || type === "module") {
        // Get public modules with content
        const moduleResp = await fetch(`${config.registryUrl}/public/modules`, {
          headers: {
            "Authorization": `Bearer ${config.serverToken}`,
          },
        });

        if (moduleResp.ok) {
          const moduleData = await moduleResp.json();
          for (const mod of moduleData) {
            // Fetch full module data including content
            const fullModuleResp = await fetch(
              `${config.registryUrl}/${
                mod.userspace || "public"
              }/modules/${mod.name}`,
              {
                headers: {
                  "Authorization": `Bearer ${config.serverToken}`,
                },
              },
            );

            if (fullModuleResp.ok) {
              const fullModule = await fullModuleResp.json();
              const installedVersion = installed.get(`module/${mod.name}`);
              modules.push({
                ...mod,
                ...fullModule,
                type: "module",
                isInstalled: !!installedVersion,
                updateAvailable: installedVersion &&
                  installedVersion !== mod.version,
              });
            }
          }
        }
      }

      // Fetch and process components
      if (!type || type === "component") {
        const componentResp = await fetch(
          `${config.registryUrl}/public/components`,
          {
            headers: {
              "Authorization": `Bearer ${config.serverToken}`,
            },
          },
        );

        if (componentResp.ok) {
          const componentData = await componentResp.json();
          for (const comp of componentData) {
            // Fetch full component data including content
            const fullCompResp = await fetch(
              `${config.registryUrl}/${
                comp.userspace || "public"
              }/components/${comp.name}`,
              {
                headers: {
                  "Authorization": `Bearer ${config.serverToken}`,
                },
              },
            );

            if (fullCompResp.ok) {
              const fullComponent = await fullCompResp.json();
              const installedVersion = installed.get(`component/${comp.name}`);
              components.push({
                ...comp,
                ...fullComponent,
                type: "component",
                isInstalled: !!installedVersion,
                updateAvailable: installedVersion &&
                  installedVersion !== comp.version,
              });
            }
          }
        }
      }

      log(
        `Retrieved ${modules.length} modules and ${components.length} components`,
      );
      return { modules, components };
    } catch (error) {
      log(`Error getting packages: ${error.message}`);
      throw error;
    }
  }

  @Socket("registry.install")
  @Permission("operator")
  async handleInstall({ params, log, kv }: ScriptContext): Promise<void> {
    try {
      const { type, path } = params;
      const config = await this.getConfig(kv);

      // Parse path
      const [userspace, ...nameParts] = path.includes("/")
        ? path.split("/")
        : [config.defaultUserspace, path];
      const name = nameParts.join("/");

      // Check if already installed
      const installed = await kv.get(["installed", type, name]);
      if (installed.value) {
        throw new Error(`Package ${name} is already installed`);
      }

      // Fetch package with content
      const response = await fetch(
        `${config.registryUrl}/${userspace}/${type}s/${name}`,
        {
          headers: {
            "Authorization": `Bearer ${config.serverToken}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch package: ${response.statusText}`);
      }

      const pkg = await response.json();

      // Create the file
      const baseDir = type === "module" ? "./modules" : "./components";
      const ext = type === "module" ? ".ts" : ".vue";
      const fileName = `${userspace}_${name}${ext}`;

      // Ensure directory exists
      await Deno.mkdir(baseDir, { recursive: true });

      // Write file
      await Deno.writeTextFile(`${baseDir}/${fileName}`, pkg.content);

      // Save installation record
      const installRecord: InstallRecord = {
        name,
        version: pkg.metadata.version,
        userspace,
        type: type as "module" | "component",
        installedAt: Date.now(),
      };

      await kv.set(["installed", type, name], installRecord);

      log(`Installed ${type} ${name} v${pkg.metadata.version}`);
    } catch (error) {
      log(`Error installing package: ${error.message}`);
      throw error;
    }
  }

  @Socket("registry.uninstall")
  @Permission("operator")
  async handleUninstall({ params, log, kv }: ScriptContext): Promise<void> {
    try {
      const { type, name } = params;

      const installed = await kv.get(["installed", type, name]);
      if (!installed.value) {
        throw new Error(`Package ${name} is not installed`);
      }

      await kv.delete(["installed", type, name]);

      log(`Uninstalled ${type} ${name}`);
    } catch (error) {
      log(`Error uninstalling package: ${error.message}`);
      throw error;
    }
  }

  @Socket("registry.update")
  @Permission("operator")
  async handleUpdate({ params, log, kv }: ScriptContext): Promise<void> {
    try {
      const { type, name } = params;
      const config = await this.getConfig(kv);

      const installed = await kv.get(["installed", type, name]);
      if (!installed.value) {
        throw new Error(`Package ${name} is not installed`);
      }

      const record = installed.value as InstallRecord;

      // Fetch latest version
      const response = await fetch(
        `${config.registryUrl}/${record.userspace}/${type}s/${name}`,
        {
          headers: {
            "Authorization": `Bearer ${config.serverToken}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch package: ${response.statusText}`);
      }

      const pkg = await response.json();

      if (pkg.metadata.version === record.version) {
        throw new Error(
          `Package ${name} is already up to date (v${record.version})`,
        );
      }

      // Update installation record
      const updateRecord: InstallRecord = {
        ...record,
        version: pkg.metadata.version,
        updatedAt: Date.now(),
      };

      await kv.set(["installed", type, name], updateRecord);

      log(`Updated ${type} ${name} to v${pkg.metadata.version}`);
    } catch (error) {
      log(`Error updating package: ${error.message}`);
      throw error;
    }
  }

  @Socket("registry.get")
  @Permission("operator")
  async handleGet({ params, log, kv }: ScriptContext): Promise<{
    metadata: any;
    content: string;
  }> {
    try {
      const { type, name } = params;
      const config = await this.getConfig(kv);

      // For public packages, first try to get from public listing
      const publicList = await fetch(`${config.registryUrl}/public/${type}s`, {
        headers: {
          "Authorization": `Bearer ${config.serverToken}`,
        },
      });

      if (publicList.ok) {
        const packages = await publicList.json();
        const pkg = packages.find((p: any) => p.name === name);
        if (pkg) {
          log(`Retrieved public package ${type}/${name}`);
          return {
            metadata: pkg,
            content: pkg.content || "",
          };
        }
      }

      // If not found in public, try userspace
      const userspace = config.defaultUserspace;
      const response = await fetch(
        `${config.registryUrl}/${userspace}/${type}s/${name}`,
        {
          headers: {
            "Authorization": `Bearer ${config.serverToken}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Package not found: ${name}`);
      }

      const pkg = await response.json();
      log(`Retrieved package ${type}/${name} from ${userspace}`);
      return pkg;
    } catch (error) {
      log(`Error getting package: ${error.message}`);
      throw error;
    }
  }
}
