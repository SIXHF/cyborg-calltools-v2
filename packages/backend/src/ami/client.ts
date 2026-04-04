import { EventEmitter } from 'events';
import net from 'net';

const AMI_HOST = process.env.AMI_HOST ?? '127.0.0.1';
const AMI_PORT = Number(process.env.AMI_PORT ?? 5038);
const AMI_USER = process.env.AMI_USER ?? '';
const AMI_PASS = process.env.AMI_PASS ?? '';

export interface AmiEvent {
  event: string;
  [key: string]: string;
}

class AmiClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private buffer = '';
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private actionIdCounter = 0;

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ host: AMI_HOST, port: AMI_PORT }, () => {
        this.connected = true;
        this.login().then(resolve).catch(reject);
      });

      this.socket.setEncoding('utf-8');
      this.socket.on('data', (data: string) => this.onData(data));
      this.socket.on('close', () => this.onClose());
      this.socket.on('error', (err) => {
        if (!this.connected) reject(err);
        else this.emit('error', err);
      });
    });
  }

  private async login(): Promise<void> {
    return new Promise((resolve, reject) => {
      const actionId = this.nextActionId();
      const handler = (evt: AmiEvent) => {
        if (evt.actionid === actionId) {
          this.removeListener('response', handler);
          if (evt.response === 'Success') resolve();
          else reject(new Error(`AMI login failed: ${evt.message ?? 'unknown'}`));
        }
      };
      this.on('response', handler);
      this.sendAction('Login', { Username: AMI_USER, Secret: AMI_PASS, ActionID: actionId });
    });
  }

  sendAction(action: string, params: Record<string, string> = {}): void {
    if (!this.socket || !this.connected) return;

    let msg = `Action: ${action}\r\n`;
    for (const [key, val] of Object.entries(params)) {
      msg += `${key}: ${val}\r\n`;
    }
    msg += '\r\n';
    this.socket.write(msg);
  }

  private onData(data: string) {
    this.buffer += data;
    const messages = this.buffer.split('\r\n\r\n');
    this.buffer = messages.pop() ?? '';

    for (const raw of messages) {
      if (!raw.trim()) continue;
      const event = this.parseMessage(raw);
      if (event.response) this.emit('response', event);
      else if (event.event) this.emit('ami_event', event);
    }
  }

  private parseMessage(raw: string): AmiEvent {
    const result: Record<string, string> = {};
    for (const line of raw.split('\r\n')) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim().toLowerCase();
      const val = line.slice(idx + 1).trim();
      result[key] = val;
    }
    return result as AmiEvent;
  }

  private onClose() {
    this.connected = false;
    this.socket = null;
    this.emit('disconnected');
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
        console.log('[AMI] Reconnected.');
      } catch (err) {
        console.error('[AMI] Reconnect failed:', err);
        this.scheduleReconnect();
      }
    }, 5000);
  }

  private nextActionId(): string {
    return `ct2-${++this.actionIdCounter}`;
  }

  destroy() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.socket) this.socket.destroy();
    this.connected = false;
  }
}

let amiClient: AmiClient | null = null;

export async function initAmiClient(): Promise<AmiClient> {
  if (!AMI_USER || !AMI_PASS) {
    console.warn('[AMI] No credentials configured, skipping AMI connection.');
    amiClient = new AmiClient();
    return amiClient;
  }

  amiClient = new AmiClient();
  await amiClient.connect();
  return amiClient;
}

export function getAmiClient(): AmiClient | null {
  return amiClient;
}
