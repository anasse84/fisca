package ma.fisca.fiscaljava.pdf;

import java.util.List;

/**
 * Données de présentation de la facture (montants en centimes entiers, taux en points de base, quantités en milli-unités).
 * Le PDF de présentation est une vue ; la facture de référence est le XML UBL 2.1 embarqué.
 */
public record InvoicePresentation(
        String typeCode,
        String invoiceNumber,
        String issueDate,
        String dueDate,
        String currencyCode,
        Party supplier,
        Party customer,
        List<Line> lines,
        List<VatBreakdown> vatBreakdown,
        Totals totals,
        List<String> legalMentionsFr,
        List<String> legalMentionsAr) {

    /** Partie (vendeur ou client) ; les identifiants légaux sont facultatifs. */
    public record Party(
            String name,
            String nameAr,
            String ice,
            String identifiantFiscal,
            String rc,
            String taxeProfessionnelle,
            String cnss,
            String legalForm,
            Long shareCapitalCents,
            List<String> addressLines) {
    }

    public record Line(
            String descriptionFr,
            String descriptionAr,
            long quantityMilli,
            String unitCode,
            long unitPriceCents,
            long discountBps,
            long vatRateBps,
            long lineTotalCents) {
    }

    public record VatBreakdown(long vatRateBps, long taxableCents, long taxCents) {
    }

    public record Totals(
            long lineExtensionCents,
            long taxTotalCents,
            long stampDutyCents,
            long taxExclusiveCents,
            long taxInclusiveCents,
            long retentionCents,
            long payableCents) {
    }
}
