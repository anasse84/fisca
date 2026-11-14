package ma.fisca.fiscaljava;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import ma.fisca.fiscaljava.pdf.PresentationPdfBuilder;
import org.junit.jupiter.api.Test;

/** Polices OFL vendorisées : empreintes SHA-256 épinglées (fonts/FILES.sha256), présentes dans le classpath, aucun lien externe dans le PDF. */
class VendoredFontsTest {

    private static final Path FONTS = Path.of("fonts");

    @Test
    void lesPolicesDuDepotCorrespondentAuxEmpreintesEpinglees() throws Exception {
        List<String> lines = Files.readAllLines(FONTS.resolve("FILES.sha256"));
        assertTrue(lines.size() >= 6, "4 polices et 2 licences attendues");
        for (String line : lines) {
            String[] parts = line.split("\\s+", 2);
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(FONTS.resolve(parts[1].trim())));
            assertEquals(parts[0], HexFormat.of().formatHex(digest), parts[1]);
        }
    }

    @Test
    void lesPolicesEtLeursLicencesSontDansLeClasspath() throws IOException {
        for (String name : List.of("Geist-Regular.ttf", "Geist-Bold.ttf", "IBMPlexSansArabic-Regular.ttf", "IBMPlexSansArabic-Bold.ttf", "OFL-Geist.txt", "LICENSE-IBMPlexSansArabic.txt")) {
            try (InputStream in = VendoredFontsTest.class.getResourceAsStream("/fonts/" + name)) {
                assertTrue(in != null && in.readAllBytes().length > 1000, name);
            }
        }
    }

    @Test
    void lePdfNePorteAucuneActionNiLienExterne() throws IOException {
        byte[] pdf = new PresentationPdfBuilder().build(PresentationFixtures.simple(), PresentationFixtures.qr());
        String raw = new String(pdf, StandardCharsets.ISO_8859_1);
        assertFalse(raw.contains("/URI"));
        assertFalse(raw.contains("/Launch"));
        assertFalse(raw.contains("/JavaScript"));
    }
}
