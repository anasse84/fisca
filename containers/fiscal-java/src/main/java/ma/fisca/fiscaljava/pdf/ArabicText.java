package ma.fisca.fiscaljava.pdf;

import com.ibm.icu.text.ArabicShaping;
import com.ibm.icu.text.ArabicShapingException;
import com.ibm.icu.text.Bidi;
import java.util.regex.Pattern;

/**
 * Mise en forme du texte arabe pour un PDF : formes contextuelles et ligatures (ICU4J ArabicShaping, formes de présentation
 * Unicode FExx, présentes dans IBM Plex Sans Arabic), puis réordonnancement bidirectionnel (UAX #9, paragraphe de base RTL).
 * Le résultat est la chaîne VISUELLE à dessiner de gauche à droite.
 */
public final class ArabicText {

    private ArabicText() {
    }

    /** Vrai si la chaîne contient au moins un caractère de l'écriture arabe (blocs de base, supplément et formes de présentation). */
    public static boolean containsArabic(String text) {
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if ((c >= 0x0600 && c <= 0x06FF) || (c >= 0x0750 && c <= 0x077F) || (c >= 0xFB50 && c <= 0xFDFF) || (c >= 0xFE70 && c <= 0xFEFF)) {
                return true;
            }
        }
        return false;
    }

    private static final Pattern LATIN_TOKEN = Pattern.compile("[0-9A-Za-z][0-9A-Za-z\\-./:_@]*(?: [0-9A-Za-z][0-9A-Za-z\\-./:_@]*)*");

    /**
     * Enferme chaque suite de jetons latins ou numériques (dates, numéros, ICE, « UBL 2.1 ») dans un isolat gauche-à-droite : sans cela, UAX #9 traite
     * les chiffres qui suivent une lettre arabe comme des chiffres arabes et inverse « 2026-11-13 » en « 13-11-2026 ».
     */
    private static String isolateLatinTokens(String shaped) {
        return LATIN_TOKEN.matcher(shaped).replaceAll(match -> "\u2066" + match.group() + "\u2069");
    }

    /** Texte logique -> chaîne visuelle (formes contextuelles, ligature lam-alef, ordre RTL, parenthèses miroir). */
    public static String toVisual(String logical) {
        try {
            ArabicShaping shaping = new ArabicShaping(
                    ArabicShaping.LETTERS_SHAPE | ArabicShaping.LENGTH_GROW_SHRINK | ArabicShaping.TEXT_DIRECTION_LOGICAL | ArabicShaping.DIGITS_NOOP);
            String shaped = isolateLatinTokens(shaping.shape(logical));
            Bidi bidi = new Bidi(shaped, Bidi.DIRECTION_RIGHT_TO_LEFT);
            return bidi.writeReordered(Bidi.DO_MIRRORING | Bidi.REMOVE_BIDI_CONTROLS);
        } catch (ArabicShapingException e) {
            throw new IllegalStateException("Mise en forme arabe impossible", e);
        }
    }
}
