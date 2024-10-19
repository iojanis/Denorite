export class FreshWebSocketClient {
  private socket: WebSocket | null = null;
  private messageQueue: Map<string, { resolve: (value: any) => void, reject: (reason: any) => void }> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(private url: string) {}

  connect() {
    this.socket = new WebSocket(this.url);
    this.socket.onopen = () => {
      console.log('Connected to WebSocket server');
      this.reconnectAttempts = 0;
    };
    this.socket.onmessage = (event) => this.handleMessage(event);
    this.socket.onerror = (error) => console.error('WebSocket error:', error);
    this.socket.onclose = (event) => {
      console.log(`Disconnected from WebSocket server. Code: ${event.code}, Reason: ${event.reason}`);
      this.reconnect();
    };
  }

  private reconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      setTimeout(() => this.connect(), 1000 * this.reconnectAttempts);
    } else {
      console.error('Max reconnection attempts reached. Please check the server.');
    }
  }

  private handleMessage(event: MessageEvent) {
    const message = JSON.parse(event.data);
    console.log('Received message:', message);
    if (message.id) {
      const queueItem = this.messageQueue.get(message.id);
      if (queueItem) {
        queueItem.resolve(message);
        this.messageQueue.delete(message.id);
      }
    }
  }

  async sendAndWait(type: string, data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (this.socket?.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket is not connected'));
        return;
      }

      const id = Date.now().toString();
      const message = { id, type, ...data };

      this.messageQueue.set(id, { resolve, reject });
      this.socket.send(JSON.stringify(message));
      console.log('Sent message:', message);

      setTimeout(() => {
        if (this.messageQueue.has(id)) {
          this.messageQueue.delete(id);
          reject(new Error('WebSocket request timed out'));
        }
      }, 10000); // 10 second timeout
    });
  }
}
