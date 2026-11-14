import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

export interface PhiveIssue {
  readonly rule: string;
  readonly location: string;
  readonly severity: string;
  readonly message: string;
}

export interface PhiveReport {
  readonly valid: boolean;
  readonly ruleSet: string;
  readonly profile: string;
  readonly profileStatus: string;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly issues: readonly PhiveIssue[];
}

const FISCAL_JAVA_DIR = new URL('../../../../containers/fiscal-java/', import.meta.url).pathname;

/** Jar construit par `mvn -q -B package -DskipTests` (le jar « original- » de maven-shade est exclu). */
export function findFiscalJavaJar(): string | undefined {
  const target = join(FISCAL_JAVA_DIR, 'target');
  if (!existsSync(target)) return undefined;
  const jar = readdirSync(target)
    .filter((name) => name.endsWith('.jar') && !name.startsWith('original-'))
    .sort()[0];
  return jar === undefined ? undefined : join(target, jar);
}

function javaCommand(): string {
  const home = process.env['JAVA_HOME'];
  return home !== undefined && home !== '' ? join(home, 'bin', 'java') : 'java';
}

/** Retourne la version majeure de Java, ou undefined si Java est indisponible. */
export function javaMajorVersion(): number | undefined {
  const run = spawnSync(javaCommand(), ['-version'], { encoding: 'utf8' });
  if (run.error !== undefined) return undefined;
  return parseJavaMajor(`${run.stdout}${run.stderr}`);
}

function parseJavaMajor(text: string): number | undefined {
  const match = /version "(\d+)/.exec(text);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/** Vrai si le validateur PHIVE (jar du ticket T-P2A-01 + Java 21) est utilisable ici. */
export function phiveAvailability(): { readonly available: boolean; readonly reason: string } {
  const jar = findFiscalJavaJar();
  if (jar === undefined) {
    return { available: false, reason: 'jar absent : cd containers/fiscal-java && mvn -q -B package -DskipTests' };
  }
  const major = javaMajorVersion();
  if (major === undefined || major < 21) {
    return { available: false, reason: `Java 21 requis (trouvé : ${major ?? 'aucun'}) ; définir JAVA_HOME` };
  }
  return { available: true, reason: jar };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export interface PhiveServer {
  readonly port: number;
  validate(xml: string): Promise<PhiveReport>;
  stop(): Promise<void>;
}

export async function startPhiveServer(jar: string): Promise<PhiveServer> {
  const port = await freePort();
  const child: ChildProcess = spawn(javaCommand(), ['-jar', jar], {
    env: { ...process.env, FISCAL_JAVA_PORT: String(port) },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`fiscal-java s'est arrêté (code ${child.exitCode})`);
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) break;
    } catch {
      // serveur pas encore prêt
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error('fiscal-java ne répond pas sur /health après 60 s');
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return {
    port,
    async validate(xml: string): Promise<PhiveReport> {
      const response = await fetch(`${base}/validate?profile=cius-ma-provisional`, {
        method: 'POST',
        headers: { 'content-type': 'application/xml; charset=utf-8' },
        body: xml,
      });
      return (await response.json()) as PhiveReport;
    },
    stop(): Promise<void> {
      return new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', () => resolve());
        child.kill();
      });
    },
  };
}
