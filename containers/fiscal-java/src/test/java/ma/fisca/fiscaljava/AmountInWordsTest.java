package ma.fisca.fiscaljava;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import ma.fisca.fiscaljava.http.JsonReader;
import ma.fisca.fiscaljava.words.AmountInWords;
import ma.fisca.fiscaljava.words.AmountOutOfRangeException;
import org.junit.jupiter.api.Test;

/**
 * Rejoue le fichier de vecteurs d'or du paquet TypeScript (source de vérité unique) : aucune copie, aucune divergence.
 * Si le fichier est introuvable, le test échoue (jamais de saut silencieux).
 */
class AmountInWordsTest {

    static final Path VECTORS = Path.of("..", "..", "packages", "ubl-xades", "tests", "golden", "amount-in-words.vectors.json");

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> vectors() throws IOException {
        Map<String, Object> root = (Map<String, Object>) JsonReader.parse(Files.readAllBytes(VECTORS));
        return (List<Map<String, Object>>) root.get("vectors");
    }

    @Test
    @SuppressWarnings("unchecked")
    void rejoueTousLesVecteursOrFrEtAr() throws IOException {
        int accepted = 0;
        int rejected = 0;
        for (Map<String, Object> vector : vectors()) {
            String id = (String) vector.get("id");
            long cents = Long.parseLong((String) ((Map<String, Object>) vector.get("input")).get("amountCents"));
            assertEquals("PROVISOIRE", vector.get("status"), id);
            assertEquals("PROVISOIRE — orthographe à faire relire par un locuteur natif", vector.get("statusNote"), id);
            if (vector.containsKey("expectedError")) {
                assertEquals(AmountOutOfRangeException.CODE, vector.get("expectedError"), id);
                assertThrows(AmountOutOfRangeException.class, () -> AmountInWords.fr(cents), id);
                assertThrows(AmountOutOfRangeException.class, () -> AmountInWords.ar(cents), id);
                rejected++;
            } else {
                Map<String, Object> expected = (Map<String, Object>) vector.get("expected");
                assertEquals(expected.get("fr"), AmountInWords.fr(cents), id + " FR");
                assertEquals(expected.get("ar"), AmountInWords.ar(cents), id + " AR");
                accepted++;
            }
        }
        assertTrue(accepted >= 40, "au moins 40 montants, trouvés : " + accepted);
        assertTrue(rejected >= 2);
    }

    @Test
    @SuppressWarnings("unchecked")
    void lePlafondDuFichierEstCeluiDuCode() throws IOException {
        Map<String, Object> root = (Map<String, Object>) JsonReader.parse(Files.readAllBytes(VECTORS));
        assertEquals(Long.parseLong((String) root.get("maxCents")), AmountInWords.MAX_CENTS);
    }

    @Test
    @SuppressWarnings("unchecked")
    void lesPrefixesDArreteSontCeuxDuFichier() throws IOException {
        Map<String, Object> root = (Map<String, Object>) JsonReader.parse(Files.readAllBytes(VECTORS));
        Map<String, Object> prefixes = (Map<String, Object>) root.get("prefixes");
        assertEquals(5, prefixes.size());
        for (Map.Entry<String, Object> entry : prefixes.entrySet()) {
            Map<String, Object> pair = (Map<String, Object>) entry.getValue();
            assertEquals(pair.get("fr"), AmountInWords.arreteFr(entry.getKey(), 0).replace("zéro dirham", ""));
            assertEquals(pair.get("ar"), AmountInWords.arreteAr(entry.getKey(), 0).replace("صفر درهم", ""));
        }
    }

    @Test
    void phrasesCompletesDuTicket() {
        assertEquals("Arrêtée la présente facture à la somme de : mille deux cent vingt dirhams et cinquante centimes", AmountInWords.arreteFr("380", 122050));
        assertEquals("أوقفت هذه الفاتورة عند مبلغ: ألف ومائتان وعشرون درهما وخمسون سنتيما", AmountInWords.arreteAr("380", 122050));
        assertTrue(AmountInWords.arreteFr("381", 100).startsWith("Arrêté le présent avoir"));
        assertThrows(IllegalArgumentException.class, () -> AmountInWords.arreteFr("999", 1));
    }
}
