package ma.fisca.fiscaljava.pdf;

import com.google.zxing.common.BitMatrix;
import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import ma.fisca.fiscaljava.words.AmountInWords;
import org.apache.pdfbox.pdfwriter.compress.CompressParameters;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType0Font;

/**
 * PDF de présentation A4 bilingue français/arabe (visuel de la facture). Polices Geist et IBM Plex Sans Arabic intégrées,
 * texte arabe mis en forme (formes contextuelles, ligatures, ordre RTL). Le PDF n'est pas encore PDF/A-3b : l'assembleur
 * ajoute le XML embarqué, le profil colorimétrique et les métadonnées XMP.
 *
 * <p>Géométrie en dixièmes de point (entiers). Les flottants n'apparaissent qu'à la frontière de l'API PDFBox (diviseur
 * {@code 10f}) ; aucun montant n'y transite : les montants restent des {@code long} de centimes formatés par {@link Amounts}.
 */
public final class PresentationPdfBuilder {

    private static final int PAGE_W = 5953;
    private static final int PAGE_H = 8419;
    private static final int MARGIN = 400;
    private static final int CONTENT_W = PAGE_W - 2 * MARGIN;
    private static final int BOTTOM = PAGE_H - 600;

    private static final int INK = 0x161616;
    private static final int MUTED = 0x555555;
    private static final int RULE = 0xBDBDBD;
    private static final int SHADE = 0xF0F0F0;

    private static final int[] COLUMN_WIDTHS = {280, 1850, 600, 750, 400, 450, 823};
    private static final String[][] COLUMN_TITLES = {
        {"N°", "رقم"}, {"Désignation", "البيان"}, {"Qté", "الكمية"}, {"PU HT", "الثمن الوحدوي"}, {"Rem.", "التخفيض"}, {"TVA", "الضريبة"}, {"Total HT", "المجموع"},
    };

    private enum Align { LEFT, RIGHT, CENTER }

    private PDDocument document;
    private PdfFonts fonts;
    private final List<PDPage> pages = new ArrayList<>();
    private PDPageContentStream stream;
    private int y;

    /** Construit le PDF de présentation ; l'arrêté en lettres est recalculé ici à partir du TTC en centimes. */
    public byte[] build(InvoicePresentation invoice, VerificationQr qr) throws IOException {
        try (PDDocument doc = new PDDocument()) {
            this.document = doc;
            this.fonts = PdfFonts.load(doc);
            newPage();
            header(invoice);
            titleBlock(invoice);
            customerBlock(invoice.customer());
            lineTable(invoice);
            summary(invoice);
            arretes(invoice);
            mentions(invoice);
            qrBlock(qr);
            stream.close();
            stream = null;
            footers();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            // Xref classique et objets non compressés : requis par la signature PAdES du paquet ubl-xades (échec fermé sinon).
            doc.save(out, CompressParameters.NO_COMPRESSION);
            return out.toByteArray();
        } finally {
            pages.clear();
        }
    }

    // ---- primitives -------------------------------------------------------------------------------------------

    private void newPage() throws IOException {
        if (stream != null) {
            stream.close();
        }
        PDPage page = new PDPage(PDRectangle.A4);
        document.addPage(page);
        pages.add(page);
        stream = new PDPageContentStream(document, page);
        y = MARGIN;
    }

    private void ensure(int needed) throws IOException {
        if (y + needed > BOTTOM) {
            newPage();
        }
    }

    private String visual(String logical, boolean arabicScript, boolean bold) {
        PDType0Font font = fonts.pick(arabicScript, bold);
        String shown = arabicScript ? ArabicText.toVisual(logical) : logical;
        return PdfFonts.printable(font, shown);
    }

    private int width(String logical, boolean bold, int size) throws IOException {
        boolean arabicScript = ArabicText.containsArabic(logical);
        PDType0Font font = fonts.pick(arabicScript, bold);
        return Math.round(font.getStringWidth(visual(logical, arabicScript, bold)) * size / 1000);
    }

    /** Écrit un texte logique ; la chaîne arabe est mise en forme et réordonnée, puis alignée selon sa largeur visuelle. */
    private void text(String logical, boolean bold, int size, int color, Align align, int refX, int baseline) throws IOException {
        if (logical.isEmpty()) {
            return;
        }
        boolean arabicScript = ArabicText.containsArabic(logical);
        PDType0Font font = fonts.pick(arabicScript, bold);
        String shown = visual(logical, arabicScript, bold);
        int w = Math.round(font.getStringWidth(shown) * size / 1000);
        int x = switch (align) {
            case LEFT -> refX;
            case RIGHT -> refX - w;
            case CENTER -> refX - w / 2;
        };
        stream.beginText();
        stream.setFont(font, size / 10f);
        stream.setNonStrokingColor(new Color(color));
        stream.newLineAtOffset(x / 10f, (PAGE_H - baseline) / 10f);
        stream.showText(shown);
        stream.endText();
    }

    private void fillRect(int x, int top, int w, int h, int color) throws IOException {
        stream.setNonStrokingColor(new Color(color));
        stream.addRect(x / 10f, (PAGE_H - top - h) / 10f, w / 10f, h / 10f);
        stream.fill();
    }

    private void hLine(int x1, int x2, int top, int color) throws IOException {
        stream.setStrokingColor(new Color(color));
        stream.setLineWidth(0.5f);
        stream.moveTo(x1 / 10f, (PAGE_H - top) / 10f);
        stream.lineTo(x2 / 10f, (PAGE_H - top) / 10f);
        stream.stroke();
    }

    private void box(int x, int top, int w, int h, int color) throws IOException {
        stream.setStrokingColor(new Color(color));
        stream.setLineWidth(0.5f);
        stream.addRect(x / 10f, (PAGE_H - top - h) / 10f, w / 10f, h / 10f);
        stream.stroke();
    }

    private static int leading(int size) {
        return size * 13 / 10;
    }

    /** Coupe un texte logique en lignes de largeur maximale donnée ; un mot trop long est coupé par caractères. */
    private List<String> wrap(String logical, boolean bold, int size, int maxWidth) throws IOException {
        List<String> lines = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        for (String word : logical.split(" +")) {
            if (word.isEmpty()) {
                continue;
            }
            String candidate = current.isEmpty() ? word : current + " " + word;
            if (width(candidate, bold, size) <= maxWidth) {
                current.setLength(0);
                current.append(candidate);
                continue;
            }
            if (!current.isEmpty()) {
                lines.add(current.toString());
                current.setLength(0);
            }
            String rest = word;
            while (width(rest, bold, size) > maxWidth && rest.length() > 1) {
                int cut = rest.length() - 1;
                while (cut > 1 && width(rest.substring(0, cut), bold, size) > maxWidth) {
                    cut--;
                }
                lines.add(rest.substring(0, cut));
                rest = rest.substring(cut);
            }
            current.append(rest);
        }
        if (!current.isEmpty()) {
            lines.add(current.toString());
        }
        return lines;
    }

    // ---- sections ---------------------------------------------------------------------------------------------

    private static List<String> identifiersFr(InvoicePresentation.Party p) {
        List<String> out = new ArrayList<>();
        if (p.ice() != null) {
            out.add("ICE : " + p.ice());
        }
        if (p.identifiantFiscal() != null) {
            out.add("IF : " + p.identifiantFiscal());
        }
        if (p.rc() != null) {
            out.add("RC : " + p.rc());
        }
        if (p.taxeProfessionnelle() != null) {
            out.add("TP : " + p.taxeProfessionnelle());
        }
        if (p.cnss() != null) {
            out.add("CNSS : " + p.cnss());
        }
        return out;
    }

    private static List<String> identifiersAr(InvoicePresentation.Party p) {
        List<String> out = new ArrayList<>();
        if (p.ice() != null) {
            out.add("المعرف الموحد للمقاولة (ICE): " + p.ice());
        }
        if (p.identifiantFiscal() != null) {
            out.add("المعرف الجبائي: " + p.identifiantFiscal());
        }
        if (p.rc() != null) {
            out.add("السجل التجاري: " + p.rc());
        }
        if (p.taxeProfessionnelle() != null) {
            out.add("الضريبة المهنية: " + p.taxeProfessionnelle());
        }
        if (p.cnss() != null) {
            out.add("الضمان الاجتماعي: " + p.cnss());
        }
        return out;
    }

    private void header(InvoicePresentation invoice) throws IOException {
        InvoicePresentation.Party s = invoice.supplier();
        int left = y + 130;
        text(s.name(), true, 130, INK, Align.LEFT, MARGIN, left);
        int right = y + 130;
        if (s.nameAr() != null) {
            text(s.nameAr(), true, 130, INK, Align.RIGHT, PAGE_W - MARGIN, right);
        }
        left += 40;
        right += 40;
        for (String line : s.addressLines()) {
            left += leading(85);
            text(line, false, 85, INK, Align.LEFT, MARGIN, left);
        }
        if (s.legalForm() != null) {
            left += leading(80);
            String capital = s.shareCapitalCents() == null ? "" : " — capital : " + Amounts.cents(s.shareCapitalCents()) + " MAD";
            text(s.legalForm() + capital, false, 80, MUTED, Align.LEFT, MARGIN, left);
        }
        for (String line : identifiersFr(s)) {
            left += leading(80);
            text(line, false, 80, MUTED, Align.LEFT, MARGIN, left);
        }
        for (String line : identifiersAr(s)) {
            right += leading(80);
            text(line, false, 80, MUTED, Align.RIGHT, PAGE_W - MARGIN, right);
        }
        y = Math.max(left, right) + 120;
        hLine(MARGIN, PAGE_W - MARGIN, y, INK);
        y += 100;
    }

    private static String[] titleOf(String typeCode) {
        return switch (typeCode) {
            case "381" -> new String[] {"AVOIR", "إشعار دائن"};
            case "383" -> new String[] {"NOTE DE DÉBIT", "إشعار مدين"};
            case "386" -> new String[] {"FACTURE D’ACOMPTE", "فاتورة دفعة مقدمة"};
            case "389" -> new String[] {"AUTOFACTURE", "فاتورة ذاتية"};
            default -> new String[] {"FACTURE", "فاتورة"};
        };
    }

    private void titleBlock(InvoicePresentation invoice) throws IOException {
        String[] title = titleOf(invoice.typeCode());
        y += 120;
        text(title[0], true, 200, INK, Align.LEFT, MARGIN, y);
        text(title[1], true, 200, INK, Align.RIGHT, PAGE_W - MARGIN, y);
        y += leading(90) + 40;
        text("N° " + invoice.invoiceNumber(), true, 95, INK, Align.LEFT, MARGIN, y);
        text("رقم: " + invoice.invoiceNumber(), true, 95, INK, Align.RIGHT, PAGE_W - MARGIN, y);
        y += leading(85);
        text("Date d’émission : " + invoice.issueDate(), false, 85, INK, Align.LEFT, MARGIN, y);
        text("تاريخ الإصدار: " + invoice.issueDate(), false, 85, INK, Align.RIGHT, PAGE_W - MARGIN, y);
        if (invoice.dueDate() != null) {
            y += leading(85);
            text("Échéance : " + invoice.dueDate(), false, 85, INK, Align.LEFT, MARGIN, y);
            text("تاريخ الاستحقاق: " + invoice.dueDate(), false, 85, INK, Align.RIGHT, PAGE_W - MARGIN, y);
        }
        y += 120;
    }

    private void customerBlock(InvoicePresentation.Party c) throws IOException {
        List<String> fr = new ArrayList<>();
        fr.add(c.name());
        fr.addAll(c.addressLines());
        fr.addAll(identifiersFr(c));
        List<String> ar = new ArrayList<>();
        if (c.nameAr() != null) {
            ar.add(c.nameAr());
        }
        ar.addAll(identifiersAr(c));
        int rows = Math.max(fr.size(), ar.size());
        int height = 260 + rows * leading(85) + 100;
        ensure(height + 100);
        fillRect(MARGIN, y, CONTENT_W, 200, SHADE);
        box(MARGIN, y, CONTENT_W, height, RULE);
        text("Client", true, 80, INK, Align.LEFT, MARGIN + 100, y + 140);
        text("الزبون", true, 80, INK, Align.RIGHT, PAGE_W - MARGIN - 100, y + 140);
        int base = y + 200 + 40;
        for (int i = 0; i < fr.size(); i++) {
            base += leading(85);
            text(fr.get(i), i == 0, 85, INK, Align.LEFT, MARGIN + 100, base);
        }
        int baseAr = y + 200 + 40;
        for (int i = 0; i < ar.size(); i++) {
            baseAr += leading(85);
            text(ar.get(i), i == 0 && c.nameAr() != null, 85, INK, Align.RIGHT, PAGE_W - MARGIN - 100, baseAr);
        }
        y += height + 150;
    }

    private int columnX(int index) {
        int x = MARGIN;
        for (int i = 0; i < index; i++) {
            x += COLUMN_WIDTHS[i];
        }
        return x;
    }

    private void tableHeader() throws IOException {
        fillRect(MARGIN, y, CONTENT_W, 330, SHADE);
        for (int i = 0; i < COLUMN_TITLES.length; i++) {
            int center = columnX(i) + COLUMN_WIDTHS[i] / 2;
            text(COLUMN_TITLES[i][0], true, 70, INK, Align.CENTER, center, y + 130);
            text(COLUMN_TITLES[i][1], true, 70, INK, Align.CENTER, center, y + 260);
        }
        y += 330;
        hLine(MARGIN, PAGE_W - MARGIN, y, INK);
    }

    private void lineTable(InvoicePresentation invoice) throws IOException {
        ensure(330 + 400);
        tableHeader();
        int index = 0;
        for (InvoicePresentation.Line line : invoice.lines()) {
            index++;
            int descWidth = COLUMN_WIDTHS[1] - 140;
            List<String> fr = wrap(line.descriptionFr(), false, 85, descWidth);
            List<String> ar = line.descriptionAr() == null ? List.of() : wrap(line.descriptionAr(), false, 80, descWidth);
            int rowHeight = 80 + fr.size() * leading(85) + ar.size() * leading(80) + 60;
            if (y + rowHeight > BOTTOM) {
                newPage();
                tableHeader();
            }
            int base = y + 40;
            int right = columnX(1) + COLUMN_WIDTHS[1] - 70;
            for (String text : fr) {
                base += leading(85);
                text(text, false, 85, INK, Align.LEFT, columnX(1) + 70, base);
            }
            for (String text : ar) {
                base += leading(80);
                text(text, false, 80, MUTED, Align.RIGHT, right, base);
            }
            int numberBase = y + 40 + leading(85);
            text(Integer.toString(index), false, 80, INK, Align.CENTER, columnX(0) + COLUMN_WIDTHS[0] / 2, numberBase);
            text(Amounts.milli(line.quantityMilli()) + " " + line.unitCode(), false, 80, INK, Align.RIGHT, columnX(3) - 60, numberBase);
            text(Amounts.cents(line.unitPriceCents()), false, 80, INK, Align.RIGHT, columnX(4) - 60, numberBase);
            text(line.discountBps() == 0 ? "—" : Amounts.bps(line.discountBps()), false, 80, INK, Align.RIGHT, columnX(5) - 60, numberBase);
            text(Amounts.bps(line.vatRateBps()), false, 80, INK, Align.RIGHT, columnX(6) - 60, numberBase);
            text(Amounts.cents(line.lineTotalCents()), true, 80, INK, Align.RIGHT, PAGE_W - MARGIN - 60, numberBase);
            y += rowHeight;
            hLine(MARGIN, PAGE_W - MARGIN, y, RULE);
        }
        text("Montants en dirhams (MAD)", false, 65, MUTED, Align.LEFT, MARGIN, y + 150);
        text("المبالغ بالدرهم المغربي", false, 65, MUTED, Align.RIGHT, PAGE_W - MARGIN, y + 150);
        y += 250;
    }

    private void summary(InvoicePresentation invoice) throws IOException {
        InvoicePresentation.Totals t = invoice.totals();
        List<Object[]> rows = new ArrayList<>();
        rows.add(new Object[] {"Total HT", "المجموع دون احتساب الضريبة", t.lineExtensionCents(), false});
        if (t.stampDutyCents() != 0) {
            rows.add(new Object[] {"Droit de timbre", "رسم الطابع", t.stampDutyCents(), false});
        }
        rows.add(new Object[] {"TVA", "الضريبة على القيمة المضافة", t.taxTotalCents(), false});
        rows.add(new Object[] {"Total TTC", "المجموع بالرسوم", t.taxInclusiveCents(), true});
        if (t.retentionCents() != 0) {
            rows.add(new Object[] {"Retenue de garantie", "الضمان المحتجز", t.retentionCents(), false});
            rows.add(new Object[] {"Net à payer", "الصافي المستحق", t.payableCents(), true});
        }
        int rowH = 210;
        int boxW = 3400;
        int height = rows.size() * rowH;
        ensure(Math.max(height, 400) + 200);
        int x = PAGE_W - MARGIN - boxW;
        int top = y;
        for (int i = 0; i < rows.size(); i++) {
            Object[] row = rows.get(i);
            boolean strong = (Boolean) row[3];
            int rowTop = top + i * rowH;
            if (strong) {
                fillRect(x, rowTop, boxW, rowH, SHADE);
            }
            int base = rowTop + 140;
            text((String) row[0], strong, 85, INK, Align.LEFT, x + 80, base);
            text((String) row[1], false, 75, MUTED, Align.RIGHT, x + 2400, base);
            text(Amounts.cents((Long) row[2]), strong, 90, INK, Align.RIGHT, x + boxW - 80, base);
            hLine(x, x + boxW, rowTop + rowH, RULE);
        }
        List<InvoicePresentation.VatBreakdown> vat = invoice.vatBreakdown();
        if (!vat.isEmpty()) {
            int vatTop = top;
            text("Détail TVA", true, 75, INK, Align.LEFT, MARGIN, vatTop + 140);
            text("تفصيل الضريبة", true, 75, INK, Align.RIGHT, MARGIN + 1650, vatTop + 140);
            hLine(MARGIN, MARGIN + 1650, vatTop + rowH, INK);
            for (int i = 0; i < vat.size(); i++) {
                InvoicePresentation.VatBreakdown v = vat.get(i);
                int base = vatTop + rowH + (i + 1) * 180 - 40;
                text(Amounts.bps(v.vatRateBps()), false, 75, INK, Align.LEFT, MARGIN, base);
                text(Amounts.cents(v.taxableCents()), false, 75, INK, Align.RIGHT, MARGIN + 1000, base);
                text(Amounts.cents(v.taxCents()), false, 75, INK, Align.RIGHT, MARGIN + 1650, base);
            }
        }
        y = top + Math.max(height, vat.isEmpty() ? 0 : rowH + vat.size() * 180) + 150;
    }

    private void arretes(InvoicePresentation invoice) throws IOException {
        long total = invoice.totals().taxInclusiveCents();
        String fr = AmountInWords.arreteFr(invoice.typeCode(), total);
        String ar = AmountInWords.arreteAr(invoice.typeCode(), total);
        int inner = CONTENT_W - 200;
        List<String> frLines = wrap(fr, true, 90, inner);
        List<String> arLines = wrap(ar, true, 95, inner);
        int height = 160 + frLines.size() * leading(90) + 120 + arLines.size() * leading(95) + 120;
        ensure(height + 100);
        fillRect(MARGIN, y, CONTENT_W, height, SHADE);
        int base = y + 100;
        for (String line : frLines) {
            base += leading(90);
            text(line, true, 90, INK, Align.LEFT, MARGIN + 100, base);
        }
        base += 120;
        for (String line : arLines) {
            base += leading(95);
            text(line, true, 95, INK, Align.RIGHT, PAGE_W - MARGIN - 100, base);
        }
        y += height + 150;
    }

    private void mentions(InvoicePresentation invoice) throws IOException {
        List<String> fr = new ArrayList<>(invoice.legalMentionsFr());
        fr.add("Document de présentation : PDF/A-3b avec facture UBL 2.1 embarquée (profil provisoire). Validation simulée, conformité officielle non vérifiée.");
        List<String> ar = new ArrayList<>(invoice.legalMentionsAr());
        ar.add("وثيقة عرض: PDF/A-3b مع فاتورة UBL 2.1 مضمنة (ملف مؤقت). تحقق محاكى، والمطابقة الرسمية غير متحقق منها.");
        for (String mention : fr) {
            for (String line : wrap(mention, false, 70, CONTENT_W)) {
                ensure(leading(70) + 20);
                y += leading(70);
                text(line, false, 70, MUTED, Align.LEFT, MARGIN, y);
            }
        }
        y += 60;
        for (String mention : ar) {
            for (String line : wrap(mention, false, 70, CONTENT_W)) {
                ensure(leading(70) + 20);
                y += leading(70);
                text(line, false, 70, MUTED, Align.RIGHT, PAGE_W - MARGIN, y);
            }
        }
        y += 100;
    }

    private void qrBlock(VerificationQr qr) throws IOException {
        BitMatrix matrix = QrMatrix.encode(qr.url());
        int modules = matrix.getWidth();
        int module = 1000 / (modules + 8) + 1;
        int size = modules * module;
        int quiet = 4 * module;
        int frame = size + 2 * quiet;
        ensure(frame + 150);
        int top = y;
        fillRect(MARGIN, top, frame, frame, 0xFFFFFF);
        stream.setNonStrokingColor(new Color(0x000000));
        for (int row = 0; row < modules; row++) {
            int col = 0;
            while (col < modules) {
                if (!matrix.get(col, row)) {
                    col++;
                    continue;
                }
                int start = col;
                while (col < modules && matrix.get(col, row)) {
                    col++;
                }
                stream.addRect((MARGIN + quiet + start * module) / 10f, (PAGE_H - top - quiet - (row + 1) * module) / 10f, (col - start) * module / 10f, module / 10f);
            }
        }
        stream.fill();
        int textX = MARGIN + frame + 200;
        int textW = CONTENT_W - frame - 200;
        int base = top + 100;
        for (String line : wrap("QR provisoire, non publié par la DGI/xHub", true, 80, textW)) {
            base += leading(80);
            text(line, true, 80, INK, Align.LEFT, textX, base);
        }
        for (String line : wrap("Vérification publique Fisca :", false, 70, textW)) {
            base += leading(70);
            text(line, false, 70, MUTED, Align.LEFT, textX, base);
        }
        for (String line : wrap(qr.url(), false, 62, textW)) {
            base += leading(62);
            text(line, false, 62, MUTED, Align.LEFT, textX, base);
        }
        base += 120;
        for (String line : wrap("رمز QR مؤقت، غير منشور من طرف المديرية العامة للضرائب أو xHub", true, 80, textW)) {
            base += leading(80);
            text(line, true, 80, INK, Align.LEFT, textX, base);
        }
        y = top + frame + 100;
    }

    private void footers() throws IOException {
        int total = pages.size();
        for (int i = 0; i < total; i++) {
            stream = new PDPageContentStream(document, pages.get(i), PDPageContentStream.AppendMode.APPEND, true, true);
            text("Page " + (i + 1) + " / " + total, false, 65, MUTED, Align.CENTER, PAGE_W / 2, PAGE_H - 300);
            stream.close();
        }
        stream = null;
    }
}
