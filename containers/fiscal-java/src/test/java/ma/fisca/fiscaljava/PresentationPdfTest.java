package ma.fisca.fiscaljava;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.common.HybridBinarizer;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import javax.imageio.ImageIO;
import ma.fisca.fiscaljava.pdf.ArabicText;
import ma.fisca.fiscaljava.pdf.PresentationPdfBuilder;
import ma.fisca.fiscaljava.pdf.QrMatrix;
import ma.fisca.fiscaljava.pdf.VerificationQr;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.cos.COSName;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.Test;

class PresentationPdfTest {

    static {
        System.setProperty("java.awt.headless", "true");
    }

    private static byte[] build() throws IOException {
        return new PresentationPdfBuilder().build(PresentationFixtures.simple(), PresentationFixtures.qr());
    }

    static String decodeQr(BufferedImage image) throws Exception {
        int[] pixels = image.getRGB(0, 0, image.getWidth(), image.getHeight(), null, 0, image.getWidth());
        BinaryBitmap bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(image.getWidth(), image.getHeight(), pixels)));
        Map<DecodeHintType, Object> hints = new EnumMap<>(DecodeHintType.class);
        hints.put(DecodeHintType.TRY_HARDER, Boolean.TRUE);
        hints.put(DecodeHintType.POSSIBLE_FORMATS, List.of(com.google.zxing.BarcodeFormat.QR_CODE));
        return new MultiFormatReader().decode(bitmap, hints).getText();
    }

    @Test
    void lePdfEstUnA4DUneSeulePageAvecToutesLesPolicesIntegrees() throws Exception {
        byte[] pdf = build();
        assertTrue(new String(pdf, 0, 5, java.nio.charset.StandardCharsets.ISO_8859_1).startsWith("%PDF-"));
        try (PDDocument doc = Loader.loadPDF(pdf)) {
            assertEquals(1, doc.getNumberOfPages());
            PDPage page = doc.getPage(0);
            assertEquals(595, Math.round(page.getMediaBox().getWidth()));
            assertEquals(842, Math.round(page.getMediaBox().getHeight()));
            Set<String> families = new HashSet<>();
            for (COSName name : page.getResources().getFontNames()) {
                PDFont font = page.getResources().getFont(name);
                assertTrue(font.isEmbedded(), "police non intégrée : " + font.getName());
                families.add(font.getName().replaceFirst("^[A-Z]{6}\\+", "").replaceAll("-(Regular|Bold)$", ""));
            }
            assertTrue(families.contains("Geist"), families.toString());
            assertTrue(families.contains("IBMPlexSansArabic"), families.toString());
        }
    }

    @Test
    void leTexteArabeEstMisEnFormeLigatureLamAlefEtOrdreVisuel() {
        // « لا » : lam + alef -> ligature isolée U+FEFB ; « الفاتورة » : formes contextuelles (aucune lettre de base 0627-064A isolée).
        assertEquals("\uFEFB", ArabicText.toVisual("لا"));
        String visual = ArabicText.toVisual("الفاتورة");
        assertTrue(visual.chars().allMatch(c -> c >= 0xFE70 && c <= 0xFEFF), visual);
        assertTrue(ArabicText.toVisual("ولا").contains("\uFEFB") || ArabicText.toVisual("ولا").contains("\uFEFC"), "ligature lam-alef attendue");
        // ordre visuel : le premier caractère logique (alef) est dessiné le plus à droite (dernier de la chaîne visuelle).
        assertEquals('\uFE8D', ArabicText.toVisual("ا").charAt(0));
        assertTrue(ArabicText.containsArabic("abc د"));
        assertTrue(!ArabicText.containsArabic("abc 123"));
    }

    @Test
    void lePdfRasteriseContientUnQrDecodableALUrlDeVerification() throws Exception {
        byte[] pdf = build();
        try (PDDocument doc = Loader.loadPDF(pdf)) {
            BufferedImage image = new PDFRenderer(doc).renderImageWithDPI(0, 300);
            Path out = Path.of("target", "pdf-samples");
            Files.createDirectories(out);
            ImageIO.write(image, "png", out.resolve("presentation-simple.png").toFile());
            String decoded = decodeQr(image);
            assertEquals(PresentationFixtures.BASE_URL + "/api/v1/public/verify/" + PresentationFixtures.XHUB_UUID, decoded);
        }
    }

    @Test
    void leQrSourceSeDecodeEtPorteLUrlConfiguree() throws Exception {
        VerificationQr qr = new VerificationQr("https://autre.exemple.test/", PresentationFixtures.XHUB_UUID.toUpperCase());
        assertEquals("https://autre.exemple.test/api/v1/public/verify/" + PresentationFixtures.XHUB_UUID, qr.url());
        var matrix = QrMatrix.encode(qr.url());
        int scale = 8;
        int quiet = 4;
        int size = (matrix.getWidth() + 2 * quiet) * scale;
        BufferedImage image = new BufferedImage(size, size, BufferedImage.TYPE_INT_RGB);
        for (int px = 0; px < size; px++) {
            for (int py = 0; py < size; py++) {
                int mx = px / scale - quiet;
                int my = py / scale - quiet;
                boolean dark = mx >= 0 && my >= 0 && mx < matrix.getWidth() && my < matrix.getHeight() && matrix.get(mx, my);
                image.setRGB(px, py, dark ? 0x000000 : 0xFFFFFF);
            }
        }
        assertEquals(qr.url(), decodeQr(image));
    }

    @Test
    void lesParametresDuQrSontValides() {
        for (String bad : new String[] {"http://x.test", "ftp://x.test", "https://", "https://u:p@x.test", "https://x.test/?a=1", "https://x.test/#f", "pas une url", ""}) {
            org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class, () -> new VerificationQr(bad, PresentationFixtures.XHUB_UUID), bad);
        }
        org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class, () -> new VerificationQr("https://x.test", "pas-un-uuid"));
    }

    @Test
    void lePdfContientLesArretesEnToutesLettresEtLesMentionsProvisoires() throws Exception {
        byte[] pdf = build();
        try (PDDocument doc = Loader.loadPDF(pdf)) {
            String text = new PDFTextStripper().getText(doc);
            assertTrue(text.contains("Arrêtée la présente facture à la somme de : mille deux cents dirhams"), text);
            assertTrue(text.contains("QR provisoire, non publié par la DGI/xHub"), text);
            assertTrue(text.contains("Validation simulée"), text);
            assertTrue(text.contains("FA-TEST-0001"));
            assertTrue(text.contains("1 200,00"));
            assertTrue(text.contains("000970000000097"));
        }
    }

    @Test
    void laPaginationAjouteDesPagesEtLesNumerote() throws Exception {
        byte[] pdf = new PresentationPdfBuilder().build(PresentationFixtures.long80Lines(), PresentationFixtures.qr());
        try (PDDocument doc = Loader.loadPDF(pdf)) {
            int pages = doc.getNumberOfPages();
            assertTrue(pages >= 3, "pages : " + pages);
            String text = new PDFTextStripper().getText(doc);
            assertTrue(text.contains("Page 1 / " + pages));
            assertTrue(text.contains("Page " + pages + " / " + pages));
            BufferedImage last = new PDFRenderer(doc).renderImageWithDPI(pages - 1, 300);
            assertEquals(PresentationFixtures.BASE_URL + "/api/v1/public/verify/" + PresentationFixtures.XHUB_UUID, decodeQr(last));
        }
    }
}
