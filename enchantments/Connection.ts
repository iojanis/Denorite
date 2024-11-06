import { Module, Event } from "../decorators.ts";
import type { ScriptContext } from "../types.ts";

@Module({
  name: "connection-handler",
  version: "1.0.0"
})
export class ConnectionHandler {

  @Event("denorite_connected")
  handleConnection(context: ScriptContext) {
    const { connectionId, timestamp, type, address, status, metadata } = context.params;
    // Handle new connection...
    console.log(connectionId, timestamp, type, address, status, metadata)
  }

  @Event("denorite_disconnected")
  handleDisconnection(context: ScriptContext) {
    const { connectionId, timestamp, type, status, code, reason, wasClean } = context.params;
    // Handle disconnection...
    console.log(connectionId, timestamp, type, status, code, reason, wasClean)
  }
}
