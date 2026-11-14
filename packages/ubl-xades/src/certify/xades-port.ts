/** Adaptateur du port de signature sur `signUblXades` : le signataire (CSC Barid eSign, contrôle OID bloquant) et la TSA sont injectés. */
import type { DigestSigner, TimestampProvider } from '../signature/types.ts';
import { signUblXades } from '../signature/xades.ts';
import type { XadesSigningPort } from './ports.ts';

export interface XadesSigningPortOptions {
  readonly certificateDer: Uint8Array;
  readonly signer: DigestSigner;
  readonly timestampProvider: TimestampProvider;
}

export function createXadesSigningPort(options: XadesSigningPortOptions): XadesSigningPort {
  return {
    async sign(xml, signingTime) {
      const signed = await signUblXades(xml, { certificateDer: options.certificateDer, signer: options.signer, timestampProvider: options.timestampProvider, signingTime });
      return { signedXml: signed.xml };
    },
  };
}
