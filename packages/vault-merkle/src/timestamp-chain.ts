import { parseTimeStampToken, UblSignatureError } from '@fisca/ubl-xades';
import { bytesEqual, concatBytes, sha256, utf8Encode } from './bytes.ts';

/** OID SHA-256 (2.16.840.1.101.3.4.2.1) : seul algorithme de condensé géré par le TimestampProvider de @fisca/ubl-xades. */
export const SHA256_OID = '2.16.840.1.101.3.4.2.1';

/** Préfixe de séparation de domaine du ré-horodatage LTA (chaînage ancien jeton + racine). */
export const LTA_RENEWAL_DOMAIN = 'FISCA-LTA-RENEWAL-V1\u0000';

/**
 * Condensé présenté à la TSA lors d'un ré-horodatage : SHA-256( domaine || ancien jeton DER || racine de Merkle (32 octets) ).
 * Il couvre à la fois l'ancien jeton et la racine (esprit de RFC 4998 Evidence Record Syntax : chaîne de preuves à renouveler
 * avant l'obsolescence des algorithmes ou des certificats) ; la racine, de longueur fixe en fin de message, rend le codage non ambigu.
 */
export async function renewalImprint(previousToken: Uint8Array, root: Uint8Array): Promise<Uint8Array> {
  return sha256(concatBytes(utf8Encode(LTA_RENEWAL_DOMAIN), previousToken, root));
}

export type TokenFailure = 'TOKEN_UNREADABLE' | 'TOKEN_IMPRINT_MISMATCH' | 'TOKEN_CHAIN_BROKEN' | 'TOKEN_TIME_REGRESSION';

export interface TokenCheck {
  readonly index: number;
  readonly ok: boolean;
  readonly failure?: TokenFailure;
  readonly genTimeIso?: string;
}

/**
 * Contrôle d'une chaîne de jetons : jeton 0 → racine ; jeton i ≥ 1 → renewalImprint(jeton i-1, racine) ; genTime non décroissant.
 * Contrôle STRUCTUREL seulement (empreinte, genTime) : signature de la TSA et chaîne de certification ne sont pas évaluées
 * (même limite que `parseTimeStampToken`, trust = NOT_EVALUATED).
 */
export async function checkTimestampChain(tokens: readonly Uint8Array[], root: Uint8Array): Promise<readonly TokenCheck[]> {
  const checks: TokenCheck[] = [];
  let previousGenMs: number | undefined;
  for (const [index, token] of tokens.entries()) {
    let parsed: ReturnType<typeof parseTimeStampToken>;
    try {
      parsed = parseTimeStampToken(token);
    } catch (error) {
      if (error instanceof UblSignatureError) {
        checks.push({ index, ok: false, failure: 'TOKEN_UNREADABLE' });
        continue;
      }
      throw error;
    }
    const genTimeIso = `${parsed.genTime.toISOString().slice(0, 19)}Z`;
    const expected = index === 0 ? root : await renewalImprint(tokens[index - 1] as Uint8Array, root);
    if (parsed.hashAlgorithmOid !== SHA256_OID || !bytesEqual(parsed.messageImprint, expected)) {
      checks.push({ index, ok: false, failure: index === 0 ? 'TOKEN_IMPRINT_MISMATCH' : 'TOKEN_CHAIN_BROKEN', genTimeIso });
      continue;
    }
    const genMs = parsed.genTime.getTime();
    if (previousGenMs !== undefined && genMs < previousGenMs) {
      checks.push({ index, ok: false, failure: 'TOKEN_TIME_REGRESSION', genTimeIso });
      continue;
    }
    previousGenMs = genMs;
    checks.push({ index, ok: true, genTimeIso });
  }
  return checks;
}
