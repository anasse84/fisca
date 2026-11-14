import { PrintError } from '../print-queue.ts';
import type { PrinterConnection, PrinterDescriptor, PrinterTransport } from '../transport.ts';

/**
 * Impression IP par un pont local (WebSocket ou HTTP). Le navigateur ne parle pas au port 9100 d'une imprimante réseau :
 * un pont, déployé par le commerçant, relaie les octets. Aucune adresse, aucun chemin, aucun protocole de pont n'est supposé :
 * l'URL complète est injectée telle quelle ; HTTP envoie un POST binaire (`application/octet-stream`), WebSocket une trame binaire.
 */

export interface WebSocketLike {
  readyState: number;
  binaryType: string;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data: Uint8Array): void;
  close(): void;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface IpBridgeConfig {
  readonly mode: 'http' | 'websocket';
  readonly bridgeUrl: string;
  readonly label: string;
  readonly fetchImpl?: FetchLike;
  readonly webSocketFactory?: (url: string) => WebSocketLike;
}

const SOCKET_OPEN = 1;

export function createIpBridgeTransport(config: IpBridgeConfig): PrinterTransport {
  if (config.bridgeUrl.trim() === '') throw new RangeError('Pont IP : adresse obligatoire, aucune adresse par défaut.');
  const id = `ip:${config.bridgeUrl}`;
  const descriptor: PrinterDescriptor = { kind: 'ip', id, label: config.label, vendorId: null, productId: null };
  const doFetch: FetchLike = config.fetchImpl ?? ((url, init) => fetch(url, init));
  const makeSocket = config.webSocketFactory ?? ((url: string): WebSocketLike => new WebSocket(url) as unknown as WebSocketLike);
  const supported = config.mode === 'http' ? (config.fetchImpl !== undefined || typeof fetch === 'function') : (config.webSocketFactory !== undefined || typeof WebSocket === 'function');

  return {
    kind: 'ip',
    isSupported: () => supported,
    requestDevice: async () => descriptor,
    async connect(deviceId): Promise<PrinterConnection> {
      if (deviceId !== id) throw new PrintError('PRINTER_ABSENT', `Pont IP « ${deviceId} » non configuré.`);
      if (config.mode === 'http') {
        return {
          async write(data) {
            let response: Response;
            try {
              response = await doFetch(config.bridgeUrl, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(data) });
            } catch (error) {
              throw new PrintError('PRINTER_ABSENT', error instanceof Error ? error.message : String(error));
            }
            if (!response.ok) throw new PrintError('TRANSPORT_FAILED', `Pont d’impression : réponse ${String(response.status)}.`);
          },
          async close() {
            /* requête sans état : rien à fermer */
          },
        };
      }
      const socket = makeSocket(config.bridgeUrl);
      socket.binaryType = 'arraybuffer';
      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = () => reject(new PrintError('PRINTER_ABSENT', 'Pont d’impression injoignable (WebSocket).'));
        socket.onclose = () => reject(new PrintError('PRINTER_ABSENT', 'Pont d’impression fermé.'));
        if (socket.readyState === SOCKET_OPEN) resolve();
      });
      return {
        async write(data) {
          if (socket.readyState !== SOCKET_OPEN) throw new PrintError('PRINTER_ABSENT', 'Pont d’impression déconnecté.');
          socket.send(data);
        },
        async close() {
          socket.close();
        },
      };
    },
  };
}
