import type { PrinterConnection, PrinterTransport } from './transport.ts';

export type PrintErrorCode = 'PRINTER_ABSENT' | 'PAPER_OUT' | 'TIMEOUT' | 'UNSUPPORTED' | 'TRANSPORT_FAILED';

/** Erreur d'impression typée : le code choisit le libellé affiché (clé `ui.pos.print.error.*`), jamais un texte brut. */
export class PrintError extends Error {
  readonly code: PrintErrorCode;
  constructor(code: PrintErrorCode, message: string) {
    super(message);
    this.name = 'PrintError';
    this.code = code;
  }
}

export interface PrintQueueConfig {
  readonly transport: PrinterTransport;
  readonly deviceId: string;
  readonly timeoutMs: number;
}

interface Job {
  readonly bytes: Uint8Array;
  readonly resolvers: { resolve: () => void; reject: (error: PrintError) => void }[];
}

function toPrintError(error: unknown): PrintError {
  if (error instanceof PrintError) return error;
  return new PrintError('TRANSPORT_FAILED', error instanceof Error ? error.message : String(error));
}

/**
 * File d'impression FIFO, un travail à la fois. Un travail en échec reste en tête de file (jamais perdu) : `retry()` le relance.
 * Avant d'écrire, l'état de l'imprimante est lu quand le transport le permet (papier, capot).
 */
export class PrintQueue {
  private readonly config: PrintQueueConfig;
  private readonly jobs: Job[] = [];
  private readonly listeners = new Set<() => void>();
  private failure: PrintError | null = null;
  private running: Promise<void> | null = null;

  constructor(config: PrintQueueConfig) {
    this.config = config;
  }

  pendingCount(): number {
    return this.jobs.length;
  }

  lastError(): PrintError | null {
    return this.failure;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  enqueue(bytes: Uint8Array): Promise<void> {
    const promise = new Promise<void>((resolve, reject) => {
      this.jobs.push({ bytes, resolvers: [{ resolve, reject }] });
    });
    this.notify();
    void this.drain().catch(() => undefined);
    return promise;
  }

  /** Relance la file après une erreur (nouveau papier, imprimante rebranchée). */
  retry(): Promise<void> {
    return this.drain();
  }

  private drain(): Promise<void> {
    if (this.running !== null) return this.running;
    this.running = this.process().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async process(): Promise<void> {
    while (this.jobs.length > 0) {
      const job = this.jobs[0];
      if (job === undefined) return;
      try {
        await this.print(job.bytes);
      } catch (error) {
        const printError = toPrintError(error);
        this.failure = printError;
        const pending = job.resolvers.splice(0);
        for (const r of pending) r.reject(printError);
        this.notify();
        return;
      }
      this.jobs.shift();
      this.failure = null;
      for (const r of job.resolvers) r.resolve();
      this.notify();
    }
  }

  private async print(bytes: Uint8Array): Promise<void> {
    const { transport, deviceId } = this.config;
    if (!transport.isSupported()) throw new PrintError('UNSUPPORTED', 'Transport d’impression non pris en charge.');
    const connection = await this.withTimeout(transport.connect(deviceId));
    try {
      await this.checkStatus(connection);
      await this.withTimeout(connection.write(bytes));
    } finally {
      await connection.close().catch(() => undefined);
    }
  }

  private async checkStatus(connection: PrinterConnection): Promise<void> {
    if (connection.readStatus === undefined) return;
    const status = await this.withTimeout(connection.readStatus());
    if (status.paperOut || status.coverOpen) throw new PrintError('PAPER_OUT', 'Fin de papier ou capot ouvert.');
    if (status.offline) throw new PrintError('PRINTER_ABSENT', 'Imprimante hors ligne.');
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new PrintError('TIMEOUT', `Imprimante sans réponse après ${String(this.config.timeoutMs)} ms.`)), this.config.timeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(toPrintError(error));
        },
      );
    });
  }
}
