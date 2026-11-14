package ma.fisca.fiscaljava.facturx;

/**
 * Contrat d'assemblage : PDF/A-3b portant la facture XML (UBL 2.1 dans ce dépôt). L'implémentation est
 * {@link MustangFacturXAssembler}.
 *
 * <p>Statut : « PDF/A-3b avec facture UBL embarquée, profil provisoire ». Ce n'est pas un Factur-X conforme : la norme
 * Factur-X exige un XML CII (Cross Industry Invoice), voir {@code FACTURX-NOTES.md}.
 */
public interface FacturXAssembler {

    /**
     * Embarque le XML de facture dans le PDF de base et retourne le PDF/A-3b résultant.
     *
     * @param invoiceXml XML de facture déjà validé
     * @param basePdf    PDF visuel (bilingue français/arabe) à enrichir
     * @return octets du PDF/A-3b avec facture embarquée
     */
    byte[] assemble(byte[] invoiceXml, byte[] basePdf);
}
