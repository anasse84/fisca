package ma.fisca.fiscaljava.pdf;

import java.io.IOException;
import java.io.InputStream;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.font.PDType0Font;

/**
 * Polices vendorisées (SIL OFL), lues dans le jar et intégrées (sous-ensemble) dans le PDF, comme l'exige PDF/A :
 * Geist pour le latin, IBM Plex Sans Arabic pour l'arabe. Aucune police système, aucun accès réseau.
 */
final class PdfFonts {

    final PDType0Font latin;
    final PDType0Font latinBold;
    final PDType0Font arabic;
    final PDType0Font arabicBold;

    private PdfFonts(PDType0Font latin, PDType0Font latinBold, PDType0Font arabic, PDType0Font arabicBold) {
        this.latin = latin;
        this.latinBold = latinBold;
        this.arabic = arabic;
        this.arabicBold = arabicBold;
    }

    static PdfFonts load(PDDocument document) throws IOException {
        return new PdfFonts(
                read(document, "Geist-Regular.ttf"),
                read(document, "Geist-Bold.ttf"),
                read(document, "IBMPlexSansArabic-Regular.ttf"),
                read(document, "IBMPlexSansArabic-Bold.ttf"));
    }

    private static PDType0Font read(PDDocument document, String name) throws IOException {
        try (InputStream in = PdfFonts.class.getResourceAsStream("/fonts/" + name)) {
            if (in == null) {
                throw new IOException("Police vendorisée absente du jar : " + name);
            }
            return PDType0Font.load(document, in, true);
        }
    }

    PDType0Font pick(boolean arabicScript, boolean bold) {
        if (arabicScript) {
            return bold ? arabicBold : arabic;
        }
        return bold ? latinBold : latin;
    }

    /** Remplace par « ? » tout point de code sans glyphe dans la police, et supprime les caractères de contrôle. */
    static String printable(PDType0Font font, String text) {
        StringBuilder out = new StringBuilder(text.length());
        text.codePoints().forEach(codePoint -> {
            if (codePoint < 0x20 || codePoint == 0x7F) {
                return;
            }
            String single = new String(Character.toChars(codePoint));
            try {
                font.encode(single);
                out.append(single);
            } catch (IOException | IllegalArgumentException e) {
                out.append('?');
            }
        });
        return out.toString();
    }
}
