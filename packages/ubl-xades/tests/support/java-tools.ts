import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';

/**
 * Outils Java de vérification INDÉPENDANTE (JDK 21 en mode source-file, Maven + BouncyCastle pour le CMS).
 * Convention FISCA_REQUIRE_PHIVE du paquet : CI posée OU FISCA_REQUIRE_PHIVE=1 → l'indisponibilité est un ÉCHEC avec message clair ;
 * hors CI, saut explicite et journalisé sur stderr (aucun marqueur de saut littéral dans les tests).
 */
export const JAVA_TESTS_DIR = new URL('./../java-verifier/', import.meta.url).pathname;

export const javaRequired: boolean = process.env['FISCA_REQUIRE_PHIVE'] === '1' || (process.env['CI'] ?? '') !== '';

function javaBinary(): string {
  const home = process.env['JAVA_HOME'];
  if (home !== undefined && home !== '' && existsSync(join(home, 'bin', 'java'))) return join(home, 'bin', 'java');
  return 'java';
}

export const JAVA = javaBinary();

export interface ToolAvailability {
  readonly available: boolean;
  readonly reason: string;
}

function probe(command: string, args: readonly string[], env?: NodeJS.ProcessEnv): ToolAvailability {
  const run = spawnSync(command, [...args], { encoding: 'utf8', ...(env === undefined ? {} : { env }) });
  if (run.error !== undefined || run.status !== 0) return { available: false, reason: `${command} indisponible` };
  return { available: true, reason: `${run.stdout}${run.stderr}`.split('\n')[0] ?? '' };
}

export const javaAvailability: ToolAvailability = (() => {
  const result = probe(JAVA, ['-version']);
  if (!result.available) return result;
  const version = /version "(\d+)/.exec(result.reason);
  return Number(version?.[1] ?? 0) >= 21 ? { available: true, reason: result.reason } : { available: false, reason: 'Java 21 requis (JAVA_HOME=/usr/lib/jvm/java-21-amazon-corretto.x86_64)' };
})();

export const mavenAvailability: ToolAvailability = probe('mvn', ['-v'], { ...process.env, JAVA_HOME: process.env['JAVA_HOME'] ?? '' });

export const opensslAvailability: ToolAvailability = probe('openssl', ['version']);

export function javaEnv(): NodeJS.ProcessEnv {
  return { ...process.env, ...(process.env['JAVA_HOME'] === undefined ? {} : { JAVA_HOME: process.env['JAVA_HOME'] }) };
}

/** Lance `java Fichier.java args…` et lève avec la sortie complète en cas d'échec. */
export function runJavaSource(file: string, args: readonly string[], classpath?: string): string {
  const command = classpath === undefined ? [file, ...args] : ['-cp', classpath, file, ...args];
  const run = spawnSync(JAVA, command, { encoding: 'utf8', cwd: JAVA_TESTS_DIR, env: javaEnv(), maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) {
    throw new Error(`java ${file} a échoué (code ${String(run.status)}) :\n${run.stdout}\n${run.stderr}`);
  }
  return run.stdout;
}

/**
 * Déclare le comportement de la suite selon la disponibilité : en mode requis, un test unique échoue avec la raison ;
 * hors mode requis, l'absence est journalisée et la suite n'est pas enregistrée (aucun saut silencieux).
 * Retourne true si la suite doit s'exécuter.
 */
export function guardTool(name: string, availability: ToolAvailability): boolean {
  if (availability.available) return true;
  if (javaRequired) {
    describe(`${name} obligatoire (CI ou FISCA_REQUIRE_PHIVE=1)`, () => {
      it('l’outil de vérification indépendante doit être disponible', () => {
        throw new Error(`${name} obligatoire (CI ou FISCA_REQUIRE_PHIVE=1) mais indisponible : ${availability.reason}.`);
      });
    });
  } else {
    process.stderr.write(`[ubl-xades] ${name} NON exécuté (${availability.reason}). FISCA_REQUIRE_PHIVE=1 le rend obligatoire.\n`);
  }
  return false;
}
