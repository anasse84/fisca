package ma.fisca.fiscaljava.facturx;

/**
 * Contrat d'assemblage Factur-X (PDF/A-3b portant le XML UBL ou CII). L'implémentation, fondée sur
 * Mustangproject, est livrée par le ticket P2A-06 ; ce ticket n'installe que la dépendance et le contrat.
 */
public interface FacturXAssembler {

    /**
     * Embarque le XML de facture dans le PDF de base et retourne le PDF/A-3b résultant.
     *
     * @param invoiceXml XML de facture déjà validé
     * @param basePdf    PDF visuel (bilingue français/arabe) à enrichir
     * @return octets du PDF/A-3b Factur-X
     */
    byte[] assemble(byte[] invoiceXml, byte[] basePdf);
}
