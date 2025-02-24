// DenoriteProtocol.ts

export class DenoriteProtocol {
  private static PROTOCOL_VERSION = 0x01;

  // Message Types
  static readonly MESSAGE_TYPE_EVENT = 0x01;
  static readonly MESSAGE_TYPE_REQUEST = 0x02;
  static readonly MESSAGE_TYPE_RESPONSE = 0x03;
  static readonly MESSAGE_TYPE_ERROR = 0x04;
  static readonly MESSAGE_TYPE_PING = 0x05;
  static readonly MESSAGE_TYPE_PONG = 0x06;

  // Categories
  static readonly CATEGORY_PLAYER = 0x01;
  static readonly CATEGORY_WORLD = 0x02;
  static readonly CATEGORY_ENTITY = 0x03;
  static readonly CATEGORY_BLOCK = 0x04;
  static readonly CATEGORY_CHAT = 0x05;
  static readonly CATEGORY_COMMAND = 0x06;
  static readonly CATEGORY_FILES = 0x07;

  private static stringTable = new Map<string, number>([
    ["player_joined", 0],
    ["player_left", 1],
    ["player_chat", 2],
    ["block_break", 3],
    ["entity_death", 4],
    ["playerId", 5],
    ["playerName", 6],
    ["position", 7],
    ["dimension", 8],
    ["type", 9],
  ]);

  static encodeMessage(type: number, id: number, data: any): Uint8Array {
    const writer = new DataWriter();

    // Write header
    writer.writeUint8(this.PROTOCOL_VERSION);
    writer.writeUint8(type);
    writer.writeUint16(id);

    // Write data
    this.writeData(writer, data);

    return writer.getBuffer();
  }

  static decodeMessage(data: Uint8Array): {
    version: number;
    type: number;
    id: number;
    data: any;
  } {
    const reader = new DataReader(data);

    const version = reader.readUint8();
    const type = reader.readUint8();
    const id = reader.readUint16();
    const messageData = this.readData(reader);

    return { version, type, id, data: messageData };
  }

  private static writeData(writer: DataWriter, data: any): void {
    if (data === null || data === undefined) {
      writer.writeUint8(0); // null type
      return;
    }

    switch (typeof data) {
      case "string":
        writer.writeUint8(1);
        writer.writeString(data);
        break;

      case "number":
        if (Number.isInteger(data)) {
          writer.writeUint8(2);
          writer.writeInt32(data);
        } else {
          writer.writeUint8(3);
          writer.writeFloat64(data);
        }
        break;

      case "boolean":
        writer.writeUint8(4);
        writer.writeBoolean(data);
        break;

      case "object":
        if (Array.isArray(data)) {
          writer.writeUint8(5);
          writer.writeUint16(data.length);
          data.forEach((item) => this.writeData(writer, item));
        } else {
          writer.writeUint8(6);
          const entries = Object.entries(data);
          writer.writeUint16(entries.length);
          entries.forEach(([key, value]) => {
            writer.writeString(key);
            this.writeData(writer, value);
          });
        }
        break;
    }
  }

  private static readData(reader: DataReader): any {
    const type = reader.readUint8();

    switch (type) {
      case 0:
        return null;
      case 1:
        return reader.readString();
      case 2:
        return reader.readInt32();
      case 3:
        return reader.readFloat64();
      case 4:
        return reader.readBoolean();
      case 5: {
        const length = reader.readUint16();
        const array = new Array(length);
        for (let i = 0; i < length; i++) {
          array[i] = this.readData(reader);
        }
        return array;
      }
      case 6: {
        const result: Record<string, any> = {};
        const entries = reader.readUint16();
        for (let i = 0; i < entries; i++) {
          const key = reader.readString();
          result[key] = this.readData(reader);
        }
        return result;
      }
      default:
        throw new Error(`Unknown type: ${type}`);
    }
  }
}

class DataWriter {
  private buffer: number[] = [];

  writeUint8(value: number) {
    this.buffer.push(value & 0xFF);
  }

  writeUint16(value: number) {
    this.buffer.push((value >> 8) & 0xFF);
    this.buffer.push(value & 0xFF);
  }

  writeInt32(value: number) {
    this.buffer.push((value >> 24) & 0xFF);
    this.buffer.push((value >> 16) & 0xFF);
    this.buffer.push((value >> 8) & 0xFF);
    this.buffer.push(value & 0xFF);
  }

  writeFloat64(value: number) {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setFloat64(0, value, false);
    const view = new Uint8Array(buffer);
    view.forEach((byte) => this.buffer.push(byte));
  }

  writeBoolean(value: boolean) {
    this.buffer.push(value ? 1 : 0);
  }

  writeString(str: string) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    this.writeUint16(bytes.length);
    bytes.forEach((byte) => this.buffer.push(byte));
  }

  getBuffer(): Uint8Array {
    return new Uint8Array(this.buffer);
  }
}

class DataReader {
  private position = 0;
  private view: DataView;
  private decoder = new TextDecoder();

  constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer);
  }

  readUint8(): number {
    const value = this.view.getUint8(this.position);
    this.position += 1;
    return value;
  }

  readUint16(): number {
    const value = this.view.getUint16(this.position);
    this.position += 2;
    return value;
  }

  readInt32(): number {
    const value = this.view.getInt32(this.position);
    this.position += 4;
    return value;
  }

  readFloat64(): number {
    const value = this.view.getFloat64(this.position);
    this.position += 8;
    return value;
  }

  readBoolean(): boolean {
    return this.readUint8() !== 0;
  }

  readString(): string {
    const length = this.readUint16();
    const bytes = this.buffer.slice(this.position, this.position + length);
    this.position += length;
    return this.decoder.decode(bytes);
  }
}
