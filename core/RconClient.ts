// RconClient.ts
const PACKET_TYPE = {
  AUTH: 3,
  AUTH_RESPONSE: 2,
  COMMAND: 2,
  COMMAND_RESPONSE: 0,
} as const;

export class RconClient {
  private conn: Deno.Conn | null = null;
  private requestId = 0;
  private authenticated = false;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();

  constructor(
    private host: string,
    private port: number,
    private password: string,
  ) {}

  async connect(): Promise<void> {
    try {
      this.conn = await Deno.connect({
        hostname: this.host,
        port: this.port,
      });
      await this.authenticate();
    } catch (error) {
      throw new Error(`Failed to connect to RCON server: ${error.message} ${this.host} ${this.port}`);
    }
  }

  private async authenticate(): Promise<void> {
    if (!this.conn) throw new Error("Not connected");

    console.log(this.password)

    const authPacket = this.createPacket(PACKET_TYPE.AUTH, this.password);
    await this.conn.write(authPacket);

    const response = await this.readPacket();
    if (response.id === -1) {
      throw new Error("Authentication failed");
    }

    this.authenticated = true;
  }

  async executeCommand(command: string): Promise<string> {
    if (!this.conn || !this.authenticated) {
      throw new Error("Not connected or not authenticated");
    }

    const packet = this.createPacket(PACKET_TYPE.COMMAND, command);
    await this.conn.write(packet);

    const response = await this.readPacket();
    return response.payload;
  }

  async disconnect(): Promise<void> {
    if (this.conn) {
      try {
        this.conn.close();
      } catch (error) {
        console.error("Error closing connection:", error);
      }
      this.conn = null;
      this.authenticated = false;
    }
  }

  private createPacket(type: number, payload: string): Uint8Array {
    const id = ++this.requestId;
    const payloadBytes = this.encoder.encode(payload);
    const length = 10 + payloadBytes.length; // 4 (length) + 4 (id) + 4 (type) + payload + 2 (null terminators)

    const buffer = new Uint8Array(length + 4);
    const view = new DataView(buffer.buffer);

    // Write length (excluding the length field itself)
    view.setInt32(0, length, true);
    // Write request ID
    view.setInt32(4, id, true);
    // Write packet type
    view.setInt32(8, type, true);

    // Write payload
    buffer.set(payloadBytes, 12);
    // Add null terminators
    buffer[buffer.length - 2] = 0;
    buffer[buffer.length - 1] = 0;

    return buffer;
  }

  private async readPacket(): Promise<{ id: number; type: number; payload: string }> {
    if (!this.conn) throw new Error("Not connected");

    // Read length
    const lengthBuffer = new Uint8Array(4);
    const lengthRead = await this.conn.read(lengthBuffer);
    if (lengthRead === null) throw new Error("Connection closed");

    const length = new DataView(lengthBuffer.buffer).getInt32(0, true);

    // Read the rest of the packet
    const packetBuffer = new Uint8Array(length);
    const packetRead = await this.conn.read(packetBuffer);
    if (packetRead === null) throw new Error("Connection closed");

    const view = new DataView(packetBuffer.buffer);
    const id = view.getInt32(0, true);
    const type = view.getInt32(4, true);

    // Extract payload (excluding null terminators)
    const payloadBytes = packetBuffer.slice(8, packetBuffer.length - 2);
    const payload = this.decoder.decode(payloadBytes);

    return { id, type, payload };
  }
}
