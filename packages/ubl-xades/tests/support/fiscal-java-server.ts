import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JAVA, javaEnv } from './java-tools.ts';
import type { FiscalJavaHttpClient, FiscalJavaHttpResponse, FiscalJavaRequestInit } from '../../src/index.ts';

/** Répertoire du conteneur (lecture seule : le test le compile et l'exécute en local, sans Docker). */
export const FISCAL_JAVA_DIR = new URL('../../../../containers/fiscal-java/', import.meta.url).pathname;

export interface RunningFiscalJava {
  readonly baseUrl: string;
  stop(): void;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** Compile le conteneur (Maven), résout son classpath puis lance `ma.fisca.fiscaljava.Main` sur un port libre. */
export async function startFiscalJava(): Promise<RunningFiscalJava> {
  const work = mkdtempSync(join(tmpdir(), 'fisca-fiscal-java-'));
  const env = javaEnv();
  const compile = spawnSync('mvn', ['-q', '-B', 'compile'], { cwd: FISCAL_JAVA_DIR, env, encoding: 'utf8' });
  if (compile.status !== 0) throw new Error(`mvn compile a échoué :\n${compile.stdout}\n${compile.stderr}`);
  const classpathFile = join(work, 'cp.txt');
  const resolve = spawnSync('mvn', ['-q', '-B', 'dependency:build-classpath', `-Dmdep.outputFile=${classpathFile}`], { cwd: FISCAL_JAVA_DIR, env, encoding: 'utf8' });
  if (resolve.status !== 0) throw new Error(`Résolution du classpath impossible :\n${resolve.stdout}\n${resolve.stderr}`);
  const classpath = `${join(FISCAL_JAVA_DIR, 'target', 'classes')}:${readFileSync(classpathFile, 'utf8').trim()}`;
  const port = await freePort();
  const child: ChildProcess = spawn(JAVA, ['-Djava.awt.headless=true', '-cp', classpath, 'ma.fisca.fiscaljava.Main'], {
    env: { ...env, FISCAL_JAVA_PORT: String(port) },
    stdio: 'ignore',
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) break;
    } catch {
      // le serveur démarre : nouvel essai
    }
    if (Date.now() > deadline || child.exitCode !== null) {
      child.kill();
      throw new Error('Le conteneur fiscal-java n’a pas démarré.');
    }
    await new Promise((done) => setTimeout(done, 150));
  }
  return {
    baseUrl,
    stop: () => {
      child.kill();
      rmSync(work, { recursive: true, force: true });
    },
  };
}

/** Transport réel pour les tests seulement : adapte le fetch de Node à l'interface injectée du client. */
export const nodeFetchTransport: FiscalJavaHttpClient = {
  async fetch(url: string, init: FiscalJavaRequestInit): Promise<FiscalJavaHttpResponse> {
    const response = await fetch(url, {
      method: init.method,
      headers: { ...init.headers },
      ...(init.body === undefined ? {} : { body: new Blob([init.body]) }),
      ...(init.signal === undefined ? {} : { signal: init.signal }),
    });
    return response;
  },
};

/** Extrait le XML embarqué (flux non compressé écrit par Mustang) et la structure /AF d'un PDF, en latin1. */
export function extractEmbeddedXml(pdf: Uint8Array): Uint8Array {
  const text = Array.from(pdf, (byte) => String.fromCharCode(byte)).join('');
  const marker = text.indexOf('/Type /EmbeddedFile');
  if (marker < 0) throw new Error('Flux /EmbeddedFile introuvable.');
  const dictStart = text.lastIndexOf('<<', marker);
  const streamKeyword = text.indexOf('stream', marker);
  const dictionary = text.slice(dictStart, streamKeyword);
  const length = /\/Length (\d+)/.exec(dictionary);
  if (length === null) throw new Error('/Length absent du flux embarqué.');
  let start = streamKeyword + 'stream'.length;
  if (text[start] === '\r') start += 1;
  if (text[start] === '\n') start += 1;
  return pdf.slice(start, start + Number(length[1]));
}
