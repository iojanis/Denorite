import { Command } from "https://deno.land/x/cliffy@v1.0.0-rc.7/command/mod.ts";
import { colors } from "https://deno.land/x/cliffy@v1.0.0-rc.7/ansi/colors.ts";
import { Table } from "https://deno.land/x/cliffy@v1.0.0-rc.7/table/mod.ts";
import { join } from "https://deno.land/std@0.177.0/path/mod.ts";

const API_URL = "http://localhost:8000";
const kv = await Deno.openKv('mino_cli.db');

async function getToken(): Promise<string | null> {
  const entry = await kv.get(["auth_token"]);
  return entry.value as string | null;
}

async function setToken(token: string): Promise<void> {
  await kv.set(["auth_token"], token);
}

async function clearToken(): Promise<void> {
  await kv.delete(["auth_token"]);
}

async function apiRequest(endpoint: string, method = "GET", body?: unknown): Promise<Response> {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API request failed: ${response.status} ${response.statusText}\n${errorText}`);
  }

  return response;
}

async function login(username: string, password: string): Promise<void> {
  try {
    const response = await apiRequest("/login", "POST", { username, password });
    const { token } = await response.json();
    await setToken(token);
    console.log(colors.green("Login successful."));
  } catch (error) {
    console.error(colors.red("Login failed:"), (error as Error).message);
  }
}

async function logout(): Promise<void> {
  await clearToken();
  console.log(colors.green("Logged out successfully."));
}

async function listServers(): Promise<void> {
  try {
    const response = await apiRequest("/servers");
    const servers = await response.json();

    const table = new Table()
      .header(["Name", "ID", "IP", "Port", "Enchantments"])
      .body(servers.map((s: any) => [
        s.name,
        s.id,
        s.ip,
        s.port.toString(),
        s.enchantments.map((e: any) => `${e.name} (v${e.version})`).join(", ")
      ]));

    console.log(table.toString());
  } catch (error) {
    console.error(colors.red("Failed to list servers:"), (error as Error).message);
  }
}

async function listEnchantments(): Promise<void> {
  try {
    const response = await apiRequest("/enchantments");
    const enchantments = await response.json();

    const table = new Table()
      .header(["Name", "Version", "Description", "Author", "Public"])
      .body(enchantments.map((e: any) => [
        e.name,
        e.version,
        e.description,
        e.author,
        e.isPublic.toString()
      ]));

    console.log(table.toString());
  } catch (error) {
    console.error(colors.red("Failed to list enchantments:"), (error as Error).message);
  }
}

async function registerServer(name: string, ip: string, port: number): Promise<void> {
  try {
    await apiRequest("/register", "POST", { name, ip, port });
    console.log(colors.green(`Server "${name}" registered successfully.`));
  } catch (error) {
    console.error(colors.red("Failed to register server:"), (error as Error).message);
  }
}

async function uploadEnchantment(file: string, options: Command): Promise<void> {
  try {
    const content = await Deno.readTextFile(file);
    const moduleRegex = /@Module\(\s*\{([^}]+)\}\s*\)/s;
    const match = content.match(moduleRegex);

    if (!match) {
      throw new Error("No @Module decorator found in the enchantment file");
    }

    const moduleContent = match[1];
    const nameMatch = moduleContent.match(/name:\s*['"](.+)['"]/);
    const versionMatch = moduleContent.match(/version:\s*['"](.+)['"]/);
    const descriptionMatch = moduleContent.match(/description:\s*['"](.+)['"]/);

    if (!nameMatch || !versionMatch) {
      throw new Error("Name and version are required in the @Module decorator");
    }

    const name = nameMatch[1];
    const version = versionMatch[1];
    const description = descriptionMatch ? descriptionMatch[1] : "No description provided";

    const formData = new FormData();
    formData.append("file", new Blob([await Deno.readFile(file)]), name);
    formData.append("name", name);
    formData.append("version", version);
    formData.append("description", description);
    formData.append("isPublic", options.public.toString());

    const token = await getToken();
    if (!token) throw new Error("Not authenticated. Please login first.");

    const response = await fetch(`${API_URL}/enchantments/upload`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload enchantment: ${response.statusText}`);
    }

    console.log(colors.green(`Enchantment "${name}" (v${version}) uploaded successfully.`));
  } catch (error) {
    console.error(colors.red("Failed to upload enchantment:"), (error as Error).message);
  }
}

async function installEnchantment(serverId: string, enchantment: string, version: string): Promise<void> {
  try {
    const response = await apiRequest(`/servers/${serverId}/enchantments`, "POST", {
      enchantmentName: enchantment,
      version
    });
    const result = await response.json();
    console.log(colors.green(`Enchantment "${enchantment}" (v${version}) installed successfully on server.`));

    const downloadResponse = await fetch(`${API_URL}${result.downloadLink}`, {
      headers: { "Authorization": `Bearer ${await getToken()}` },
    });

    if (!downloadResponse.ok) {
      throw new Error(`Failed to download enchantment: ${downloadResponse.statusText}`);
    }

    const enchantmentsDir = join(Deno.cwd(), "enchantments");
    await Deno.mkdir(enchantmentsDir, { recursive: true });

    const fileName = `${enchantment}-v${version}.ts`;
    const filePath = join(enchantmentsDir, fileName);
    await Deno.writeFile(filePath, new Uint8Array(await downloadResponse.arrayBuffer()));

    console.log(colors.green(`Enchantment downloaded and saved to ${filePath}`));
  } catch (error) {
    console.error(colors.red("Failed to install enchantment:"), (error as Error).message);
  }
}

await new Command()
  .name("mino")
  .version("1.0.0")
  .description("MinoRegistry CLI")
  .command("login <username:string> <password:string>", "Login to MinoRegistry")
  .action(login)
  .command("logout", "Logout from MinoRegistry")
  .action(logout)
  .command("servers", "List all registered servers")
  .action(listServers)
  .command("enchantments", "List all available enchantments")
  .action(listEnchantments)
  .command("register <name:string> <ip:string> <port:number>", "Register a new server")
  .action(registerServer)
  .command("upload <file:string>", "Upload a new enchantment")
  .option("-p, --public", "Set the enchantment as public", { default: false })
  .action(uploadEnchantment)
  .command("install <serverId:string> <enchantment:string> <version:string>", "Install an enchantment on a server")
  .action(installEnchantment)
  .parse(Deno.args);
