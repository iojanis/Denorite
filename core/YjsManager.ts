import * as Y from 'npm:yjs';
import { WebSocket } from "ws";
import { Logger } from "./logger.ts";
import { PlayerManager } from "./PlayerManager.ts";

interface YjsDocInfo {
  doc: Y.Doc;
  connections: Set<string>; // Set of connection IDs
  metadata: {
    creator: string;
    createdAt: number;
    lastModified: number;
    name: string;
    type: string;
  };
}

export class YjsManager {
  private docs: Map<string, YjsDocInfo> = new Map();
  private logger: Logger;
  private playerManager: PlayerManager;

  constructor(logger: Logger, playerManager: PlayerManager) {
    this.logger = logger;
    this.playerManager = playerManager;
  }

  async createDocument(
    docId: string,
    creator: string,
    metadata: { name: string; type: string },
  ): Promise<YjsDocInfo> {
    if (this.docs.has(docId)) {
      throw new Error(`Document ${docId} already exists`);
    }

    const doc = new Y.Doc();
    const docInfo: YjsDocInfo = {
      doc,
      connections: new Set(),
      metadata: {
        creator,
        createdAt: Date.now(),
        lastModified: Date.now(),
        ...metadata,
      },
    };

    this.docs.set(docId, docInfo);
    this.logger.info(`Created Yjs document: ${docId} by ${creator}`);
    return docInfo;
  }

  getDocument(docId: string): YjsDocInfo | undefined {
    return this.docs.get(docId);
  }

  async handleConnection(docId: string, connectionId: string, socket: WebSocket): Promise<void> {
    const docInfo = this.docs.get(docId);
    if (!docInfo) {
      throw new Error(`Document ${docId} not found`);
    }

    docInfo.connections.add(connectionId);

    // Set up awareness (optional)
    // const awareness = new awarenessProtocol.Awareness(docInfo.doc);

    // Handle incoming updates
    socket.on('message', (message: Uint8Array) => {
      try {
        Y.applyUpdate(docInfo.doc, message);
        docInfo.metadata.lastModified = Date.now();

        // Broadcast to other connections
        this.broadcastUpdate(docId, message, connectionId);
      } catch (error) {
        this.logger.error(`Error applying Yjs update: ${error.message}`);
      }
    });

    // Send initial state
    const initialState = Y.encodeStateAsUpdate(docInfo.doc);
    socket.send(initialState);

    this.logger.debug(`Client ${connectionId} connected to document ${docId}`);
  }

  private broadcastUpdate(docId: string, update: Uint8Array, excludeConnectionId?: string): void {
    const docInfo = this.docs.get(docId);
    if (!docInfo) return;

    for (const connectionId of docInfo.connections) {
      if (connectionId === excludeConnectionId) continue;

      const playerSocket = this.playerManager.getPlayerSocket(connectionId);
      if (playerSocket && playerSocket.readyState === WebSocket.OPEN) {
        playerSocket.send(update);
      }
    }
  }

  handleDisconnection(docId: string, connectionId: string): void {
    const docInfo = this.docs.get(docId);
    if (!docInfo) return;

    docInfo.connections.delete(connectionId);
    this.logger.debug(`Client ${connectionId} disconnected from document ${docId}`);

    // Clean up empty documents
    if (docInfo.connections.size === 0) {
      this.docs.delete(docId);
      this.logger.info(`Removed empty document: ${docId}`);
    }
  }

  getDocumentMetadata(docId: string): Partial<YjsDocInfo['metadata']> | undefined {
    const docInfo = this.docs.get(docId);
    if (!docInfo) return undefined;
    return { ...docInfo.metadata };
  }

  listDocuments(): Array<{ id: string; metadata: YjsDocInfo['metadata'] }> {
    return Array.from(this.docs.entries()).map(([id, info]) => ({
      id,
      metadata: { ...info.metadata },
    }));
  }

  deleteDocument(docId: string, requestingUser: string): boolean {
    const docInfo = this.docs.get(docId);
    if (!docInfo) return false;

    // Check permissions (only creator or operator can delete)
    if (docInfo.metadata.creator !== requestingUser &&
        !this.playerManager.isOperator(requestingUser)) {
      throw new Error('Permission denied');
    }

    // Notify all connected clients
    for (const connectionId of docInfo.connections) {
      const playerSocket = this.playerManager.getPlayerSocket(connectionId);
      if (playerSocket && playerSocket.readyState === WebSocket.OPEN) {
        playerSocket.send(JSON.stringify({
          type: 'yjs_document_deleted',
          docId,
        }));
      }
    }

    this.docs.delete(docId);
    this.logger.info(`Deleted document: ${docId}`);
    return true;
  }
}
