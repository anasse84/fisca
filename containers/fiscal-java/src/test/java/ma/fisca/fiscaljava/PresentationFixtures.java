package ma.fisca.fiscaljava;

import java.util.ArrayList;
import java.util.List;
import ma.fisca.fiscaljava.pdf.InvoicePresentation;
import ma.fisca.fiscaljava.pdf.VerificationQr;

/** Données de test (aucune donnée réelle) : vendeur et client fictifs, ICE de test divisibles par 97. */
final class PresentationFixtures {

    static final String XHUB_UUID = "3f2b8c1e-5d4a-4e7b-9a10-2c6d8e0f1a23";
    static final String BASE_URL = "https://verif.exemple.test";

    private PresentationFixtures() {
    }

    static VerificationQr qr() {
        return new VerificationQr(BASE_URL, XHUB_UUID);
    }

    static InvoicePresentation.Party supplier() {
        return new InvoicePresentation.Party(
                "Vendeur Test SARL AU", "شركة البائع للتجارب ش.م.م", "000970000000097", "12345678", "123456", "98765432", "1234567", "SARL AU",
                10000000L, List.of("1 rue de Test", "10000 Rabat, MA"));
    }

    static InvoicePresentation.Party customer() {
        return new InvoicePresentation.Party(
                "Acheteur Test SA", "شركة المشتري للتجارب ش.م", "001197530853397", null, null, null, null, null, null, List.of("2 avenue de Test", "20000 Casablanca, MA"));
    }

    /** Facture de 1 200,00 MAD TTC (même total que la fixture XML invoice-valid-380.xml). */
    static InvoicePresentation simple() {
        return new InvoicePresentation(
                "380", "FA-TEST-0001", "2026-11-13", "2026-12-13", "MAD", supplier(), customer(),
                List.of(new InvoicePresentation.Line("Article de test", "مادة للتجربة", 10000, "C62", 10000, 0, 2000, 100000)),
                List.of(new InvoicePresentation.VatBreakdown(2000, 100000, 20000)),
                new InvoicePresentation.Totals(100000, 20000, 0, 100000, 120000, 0, 120000),
                List.of("Mentions légales de test."), List.of("بيانات قانونية تجريبية."));
    }

    /** Facture avec timbre, retenue et beaucoup de lignes (pagination), TTC = somme arrondie des lignes de test. */
    static InvoicePresentation long80Lines() {
        List<InvoicePresentation.Line> lines = new ArrayList<>();
        long sum = 0;
        for (int i = 1; i <= 80; i++) {
            long total = 1000L * i;
            sum += total;
            lines.add(new InvoicePresentation.Line("Prestation numéro " + i + " : description assez longue pour passer à la ligne dans la colonne désignation du tableau", i % 2 == 0 ? "خدمة رقم " + i + " مع وصف طويل يمر إلى السطر الموالي داخل العمود" : null, 1000, "C62", total, 0, 2000, total));
        }
        long vat = sum / 5;
        return new InvoicePresentation(
                "380", "FA-TEST-0002", "2026-11-13", null, "MAD", supplier(), customer(), lines,
                List.of(new InvoicePresentation.VatBreakdown(2000, sum, vat)),
                new InvoicePresentation.Totals(sum, vat, 32, sum + 32, sum + 32 + vat, 10000, sum + 32 + vat - 10000),
                List.of(), List.of());
    }
}
