/**
 * Annuaire national `morocco_company_directory` (plan de contrôle ; Doc_04 § 04, Doc_07 § 02 « Identité & ICE »).
 * Port `CompanyDirectory` et adaptateur SQL au-dessus de `TenantSqlDriver` (le pilote du plan de contrôle). Seules les colonnes
 * du contrat de réponse sont lues : `taxe_pro` et tout ajout futur ne fuient jamais.
 */
import type { TenantSqlDriver } from '@fisca/shared-types';
import { ProblemError } from './problem-details.ts';
import type { IceLookupResponse } from './api-v1-schemas.ts';

export interface CompanyDirectory {
  /** Fiche de l'ICE (déjà validé : 15 chiffres, clé modulo 97) ; null si absent de l'annuaire. */
  findByIce(ice: string): Promise<IceLookupResponse | null>;
}

interface DirectoryRow {
  readonly ice: string;
  readonly identifiant_fiscal: string;
  readonly rc_number: string | null;
  readonly rc_tribunal: string | null;
  readonly raison_sociale_fr: string;
  readonly raison_sociale_ar: string | null;
  readonly legal_form: string | null;
  readonly share_capital_cents: number | string | null;
  readonly address_adc450: string;
  readonly verified_count: number | string;
}

export const DIRECTORY_UNAVAILABLE_PROBLEM = {
  status: 503,
  errorCode: 'DIRECTORY_UNAVAILABLE',
  title: 'Annuaire indisponible',
  detail: "L'annuaire des entreprises est momentanément indisponible, réessayez plus tard.",
} as const;

export const DIRECTORY_SQL = `SELECT ice, identifiant_fiscal, rc_number, rc_tribunal, raison_sociale_fr, raison_sociale_ar, legal_form,
    share_capital_cents, address_adc450, verified_count FROM morocco_company_directory WHERE ice = ?`;

export function createSqlCompanyDirectory(controlPlane: TenantSqlDriver): CompanyDirectory {
  return {
    findByIce: async (ice) => {
      let rows: readonly DirectoryRow[];
      try {
        rows = await controlPlane.query<DirectoryRow>({ sql: DIRECTORY_SQL, params: [ice] });
      } catch {
        throw new ProblemError(DIRECTORY_UNAVAILABLE_PROBLEM);
      }
      const row = rows[0];
      if (row === undefined) {
        return null;
      }
      return {
        ice: row.ice,
        identifiantFiscal: row.identifiant_fiscal,
        rcNumber: row.rc_number,
        rcTribunal: row.rc_tribunal,
        raisonSocialeFr: row.raison_sociale_fr,
        raisonSocialeAr: row.raison_sociale_ar,
        legalForm: row.legal_form,
        shareCapitalCents: row.share_capital_cents === null ? null : Number(row.share_capital_cents),
        addressAdc450: row.address_adc450,
        verifiedCount: Number(row.verified_count),
      };
    },
  };
}
