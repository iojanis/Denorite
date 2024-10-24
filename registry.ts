import { Application, Router } from "https://deno.land/x/oak/mod.ts";
import { create, verify } from "https://deno.land/x/djwt/mod.ts";
import * as bcrypt from "https://deno.land/x/bcrypt/mod.ts";

// Types
interface Server {
  id: string;
  name: string;
  owner: string;
  ip: string;
  port: number;
  enchantments: { name: string; version: string }[];
}

interface EnchantmentVersion {
  version: string;
  description: string;
  author: string;
  isPublic: boolean;
  filename: string;
  createdAt: number;
}

interface Enchantment {
  name: string;
  versions: EnchantmentVersion[];
}

interface User {
  username: string;
  password: string;
  role: "admin" | "user";
}

// Open Deno KV database
const kv = await Deno.openKv();

// JWT secret (use a secure method to generate and store this in production)
const jwtSecret = await crypto.subtle.generateKey(
  { name: "HMAC", hash: "SHA-512" },
  true,
  ["sign", "verify"]
);

// Create admin account on startup
async function createAdminAccount() {
  const adminUsername = "admin";
  const adminPassword = "changeme"; // You should change this in production

  const existingAdmin = await kv.get(["users", adminUsername]);
  if (!existingAdmin.value) {
    const hashedPassword = await bcrypt.hash(adminPassword);
    const adminUser: User = {
      username: adminUsername,
      password: hashedPassword,
      role: "admin",
    };
    await kv.set(["users", adminUsername], adminUser);
    console.log("Admin account created. Please change the password immediately.");
  } else {
    console.log("Admin account already exists.");
  }
}

// Call createAdminAccount on startup
await createAdminAccount();

// Authentication middleware
async function authMiddleware(ctx: any, next: () => Promise<void>) {
  const authHeader = ctx.request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    ctx.response.status = 401;
    ctx.response.body = { error: "Unauthorized" };
    return;
  }

  const token = authHeader.split(" ")[1];
  try {
    const payload = await verify(token, jwtSecret);
    ctx.state.user = payload;
    await next();
  } catch (error) {
    ctx.response.status = 401;
    ctx.response.body = { error: "Invalid token" };
  }
}

// Admin-only middleware
function adminOnly(ctx: any, next: () => Promise<void>) {
  if (ctx.state.user.role !== "admin") {
    ctx.response.status = 403;
    ctx.response.body = { error: "Admin access required" };
    return;
  }
  return next();
}

const router = new Router();

// Root endpoint
router.get("/", (ctx) => {
  ctx.response.body = {
    message: "Welcome to MinoRegistry",
    endpoints: [
      { path: "/servers", description: "List all registered servers" },
      { path: "/enchantments", description: "List all available enchantments" },
      { path: "/register", description: "Register a new server" },
      { path: "/login", description: "Login to get an access token" },
      { path: "/register-user", description: "Register a new user (admin only)" },
      { path: "/enchantments/upload", description: "Upload a new enchantment file" },
      { path: "/enchantments/:name/:version/download", description: "Download a specific enchantment version" },
      { path: "/servers/:serverId/enchantments", description: "Install a specific enchantment version on a server" },
    ],
  };
});

router.get("/enchantments", authMiddleware, async (ctx) => {
  const user = ctx.state.user;
  const enchantments: Enchantment[] = [];
  const entries = kv.list<Enchantment>({ prefix: ["enchantments"] });
  for await (const entry of entries) {
    const enchantment = entry.value;
    enchantment.versions = enchantment.versions.filter(version =>
      version.isPublic || version.author === user.username || user.role === "admin"
    );
    if (enchantment.versions.length > 0) {
      enchantments.push(enchantment);
    }
  }
  ctx.response.body = enchantments;
});

// List servers
router.get("/servers", async (ctx) => {
  const servers: Server[] = [];
  const entries = kv.list<Server>({ prefix: ["servers"] });
  for await (const entry of entries) {
    servers.push(entry.value);
  }
  ctx.response.body = servers;
});

// Login
router.post("/login", async (ctx) => {
  try {
    const result = await ctx.request.body.json();
    const { username, password } = result;

    if (!username || !password) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Username and password are required" };
      return;
    }

    const userEntry = await kv.get<User>(["users", username]);
    if (!userEntry.value || !(await bcrypt.compare(password, userEntry.value.password))) {
      ctx.response.status = 401;
      ctx.response.body = { error: "Invalid credentials" };
      return;
    }

    const token = await create({ alg: "HS512", typ: "JWT" }, { username, role: userEntry.value.role }, jwtSecret);
    ctx.response.body = { token };
  } catch (error) {
    console.error("Login error:", error);
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
  }
});

// Register a new server
router.post("/register", authMiddleware, async (ctx) => {
  try {
    const result = await ctx.request.body.json();
    const { name, ip, port } = result;

    if (!name || !ip || !port) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Name, IP, and port are required" };
      return;
    }

    const newServer: Server = {
      id: crypto.randomUUID(),
      name,
      owner: ctx.state.user.username,
      ip,
      port,
      enchantments: [],
    };
    await kv.set(["servers", newServer.id], newServer);
    ctx.response.status = 201;
    ctx.response.body = newServer;
  } catch (error) {
    console.error("Register server error:", error);
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
  }
});

// Upload a new enchantment version
router.post("/enchantments/upload", authMiddleware, async (ctx) => {
  try {
    const body = await ctx.request.body.formData();
    const file = body.get("file") as File;
    const name = body.get("name") as string;
    const version = body.get("version") as string;
    const description = body.get("description") as string;
    const isPublic = body.get("isPublic") === "true";

    if (!file || !name || !version || !description) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Missing required fields" };
      return;
    }

    const newVersion: EnchantmentVersion = {
      version,
      description,
      author: ctx.state.user.username,
      isPublic,
      filename: file.name,
      createdAt: Date.now(),
    };

    // Get existing enchantment or create a new one
    const enchantmentEntry = await kv.get<Enchantment>(["enchantments", name]);
    let enchantment: Enchantment;
    if (enchantmentEntry.value) {
      enchantment = enchantmentEntry.value;
      // Check if version already exists
      if (enchantment.versions.some(v => v.version === version)) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Version already exists" };
        return;
      }
      enchantment.versions.push(newVersion);
    } else {
      enchantment = {
        name,
        versions: [newVersion],
      };
    }

    // Store updated enchantment metadata
    await kv.set(["enchantments", name], enchantment);

    // Store enchantment file content
    const fileContent = await file.arrayBuffer();
    await kv.set(["enchantment_files", name, version], new Uint8Array(fileContent));

    ctx.response.status = 201;
    ctx.response.body = { message: "Enchantment version uploaded successfully", enchantment: newVersion };
  } catch (error) {
    console.error("Upload enchantment error:", error);
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
  }
});

// Download a specific enchantment version
router.get("/enchantments/:name/:version/download", authMiddleware, async (ctx) => {
  try {
    const { name, version } = ctx.params;
    const enchantmentEntry = await kv.get<Enchantment>(["enchantments", name]);

    if (!enchantmentEntry.value) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Enchantment not found" };
      return;
    }

    const enchantment = enchantmentEntry.value;
    const enchantmentVersion = enchantment.versions.find(v => v.version === version);

    if (!enchantmentVersion) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Enchantment version not found" };
      return;
    }

    if (!enchantmentVersion.isPublic && enchantmentVersion.author !== ctx.state.user.username && ctx.state.user.role !== "admin") {
      ctx.response.status = 403;
      ctx.response.body = { error: "You don't have permission to download this enchantment version" };
      return;
    }

    const fileContentEntry = await kv.get<Uint8Array>(["enchantment_files", name, version]);
    if (!fileContentEntry.value) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Enchantment file not found" };
      return;
    }

    ctx.response.headers.set("Content-Type", "application/octet-stream");
    ctx.response.headers.set("Content-Disposition", `attachment; filename="${enchantmentVersion.filename}"`);
    ctx.response.body = fileContentEntry.value;
  } catch (error) {
    console.error("Download enchantment error:", error);
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
  }
});

// Install a specific enchantment version
router.post("/servers/:serverId/enchantments", authMiddleware, async (ctx) => {
  try {
    const { serverId } = ctx.params;
    const result = await ctx.request.body.json();
    const { enchantmentName, version } = result;

    const serverEntry = await kv.get<Server>(["servers", serverId]);
    if (!serverEntry.value) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Server not found" };
      return;
    }

    const server = serverEntry.value;
    if (server.owner !== ctx.state.user.username && ctx.state.user.role !== "admin") {
      ctx.response.status = 403;
      ctx.response.body = { error: "You don't have permission to modify this server" };
      return;
    }

    const enchantmentEntry = await kv.get<Enchantment>(["enchantments", enchantmentName]);
    if (!enchantmentEntry.value) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Enchantment not found" };
      return;
    }

    const enchantment = enchantmentEntry.value;
    const enchantmentVersion = enchantment.versions.find(v => v.version === version);

    if (!enchantmentVersion) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Enchantment version not found" };
      return;
    }

    if (!enchantmentVersion.isPublic && enchantmentVersion.author !== ctx.state.user.username && ctx.state.user.role !== "admin") {
      ctx.response.status = 403;
      ctx.response.body = { error: "You don't have permission to install this enchantment version" };
      return;
    }

    // Remove any existing version of this enchantment
    server.enchantments = server.enchantments.filter(e => e.name !== enchantmentName);
    // Add the new version
    server.enchantments.push({ name: enchantmentName, version });
    await kv.set(["servers", serverId], server);

    // Provide download link for the enchantment file
    const downloadLink = `/enchantments/${enchantmentName}/${version}/download`;

    ctx.response.body = {
      message: "Enchantment version installed successfully",
      downloadLink: downloadLink
    };
  } catch (error) {
    console.error("Install enchantment error:", error);
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
  }
});

// User registration (admin only)
router.post("/register-user", authMiddleware, adminOnly, async (ctx) => {
  try {
    const result = await ctx.request.body.json();
    const { username, password, role = "user" } = result;
    const existingUser = await kv.get(["users", username]);
    if (existingUser.value) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Username already exists" };
      return;
    }

    const hashedPassword = await bcrypt.hash(password);
    const newUser: User = { username, password: hashedPassword, role };
    await kv.set(["users", username], newUser);
    ctx.response.status = 201;
    ctx.response.body = { message: "User registered successfully" };
  } catch (error) {
    console.error("Register user error:", error);
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
  }
});

const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());

console.log("MinoRegistry is running on http://localhost:8000");
await app.listen({ port: 8000 });
