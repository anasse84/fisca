/**
 * Validation des requêtes REST v1 (ticket T-S1B-12) : traduit un échec Zod en `ProblemError` RFC 9457 avec `issues[]`.
 * Les messages viennent des schémas (textes fixes) ; aucune valeur reçue n'est recopiée au-delà du nom du champ.
 */
import type { z } from 'zod';
import { ProblemError, type ProblemIssue } from './problem-details.ts';

const ROOT_PATH = '(racine)';

export const REQUEST_VALIDATION_PROBLEM = {
  status: 400,
  errorCode: 'REQUEST_VALIDATION_FAILED',
  title: 'Requête invalide',
  detail: 'La requête ne respecte pas le contrat de la route : voir issues[].',
} as const;

const BODY_UNREADABLE = {
  status: 400,
  errorCode: 'REQUEST_BODY_INVALID',
  title: 'Corps invalide',
  detail: 'Le corps de la requête est illisible.',
} as const;

function issuePath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? ROOT_PATH : path.map((segment) => String(segment)).join('.');
}

export function issuesOf(error: z.ZodError): readonly ProblemIssue[] {
  return error.issues.map((issue) => ({ path: issuePath(issue.path), message: issue.message }));
}

/** Valide `value` ; lève `ProblemError` 400 `REQUEST_VALIDATION_FAILED` avec `issues[]` sinon. */
export function parseWithSchema<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ProblemError({ ...REQUEST_VALIDATION_PROBLEM, issues: issuesOf(result.error) });
  }
  return result.data;
}

/** Corps JSON : `undefined` si vide ; `ProblemError` 400 `REQUEST_BODY_INVALID` si illisible. */
export async function readJsonBody(text: () => Promise<string>): Promise<unknown> {
  const raw = await text();
  if (raw.trim().length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new ProblemError(BODY_UNREADABLE);
  }
}
