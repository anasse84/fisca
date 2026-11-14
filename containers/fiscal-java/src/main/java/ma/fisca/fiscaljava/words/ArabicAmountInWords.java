package ma.fisca.fiscaljava.words;

import java.util.ArrayList;
import java.util.List;

/**
 * Montant en toutes lettres, arabe classique sans voyelles brèves. Miroir exact de
 * {@code packages/ubl-xades/src/amount-in-words/ar.ts} (mêmes règles, mêmes vecteurs d'or).
 * PROVISOIRE : à faire relire par un locuteur natif (ERRATA section E).
 */
public final class ArabicAmountInWords {

    private static final String[] MASC_UNITS = {"", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة"};
    private static final String[] TEENS = {"عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"};
    private static final String[] TENS = {"", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"};
    private static final String[] HUNDREDS = {"", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"};

    /** Formes d'un nom compté ou d'une échelle : singulier, duel, duel en annexion, pluriel (3 à 10), accusatif singulier (11 à 99). */
    private record Forms(String singular, String dual, String dualAnnexed, String plural, String accusative) {
    }

    private static final Forms DIRHAM = new Forms("درهم", "درهمان", "درهما", "دراهم", "درهما");
    private static final Forms CENTIME = new Forms("سنتيم", "سنتيمان", "سنتيما", "سنتيمات", "سنتيما");
    private static final Forms THOUSAND = new Forms("ألف", "ألفان", "ألفا", "آلاف", "ألفا");
    private static final Forms MILLION = new Forms("مليون", "مليونان", "مليونا", "ملايين", "مليونا");
    private static final Forms BILLION = new Forms("مليار", "ملياران", "مليارا", "مليارات", "مليارا");

    private ArabicAmountInWords() {
    }

    private static String wordsFrom3(int n) {
        if (n <= 10) {
            return MASC_UNITS[n];
        }
        if (n < 20) {
            return TEENS[n - 10];
        }
        int ten = n / 10;
        int one = n % 10;
        if (one == 0) {
            return TENS[ten];
        }
        String unit = one == 1 ? "أحد" : MASC_UNITS[one];
        return unit + " و" + TENS[ten];
    }

    private static String tail(int count, Forms forms, boolean annexed, boolean isScale) {
        if (count >= 11) {
            return annexed && isScale ? forms.singular() : forms.accusative();
        }
        return forms.plural();
    }

    private static List<String> terms(int n, Forms forms, boolean annexed, boolean isScale) {
        int hundreds = n / 100;
        int rest = n % 100;
        if (hundreds == 0) {
            if (rest == 1) {
                return List.of(forms.singular());
            }
            if (rest == 2) {
                return List.of(annexed ? forms.dualAnnexed() : forms.dual());
            }
            return List.of(wordsFrom3(rest) + " " + tail(rest, forms, annexed, isScale));
        }
        if (rest == 0) {
            String word = hundreds == 2 ? "مائتا" : HUNDREDS[hundreds];
            return List.of(word + " " + forms.singular());
        }
        if (rest == 1 || rest == 2) {
            String head;
            if (hundreds == 2 && isScale) {
                head = "مائتا " + forms.singular();
            } else if (isScale) {
                head = HUNDREDS[hundreds] + " " + forms.singular();
            } else {
                head = HUNDREDS[hundreds];
            }
            String last = rest == 1 ? forms.singular() : (annexed ? forms.dualAnnexed() : forms.dual());
            return List.of(head, last);
        }
        return List.of(HUNDREDS[hundreds] + " و" + wordsFrom3(rest) + " " + tail(rest, forms, annexed, isScale));
    }

    private static String joinTerms(List<String> items) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < items.size(); i++) {
            if (i > 0) {
                out.append(" و");
            }
            out.append(items.get(i));
        }
        return out.toString();
    }

    /** Montant en centimes entiers en toutes lettres arabes, sans préfixe d'arrêté. */
    public static String of(long totalCents) {
        AmountWordsSupport.Split split = AmountWordsSupport.split(totalCents);
        int[] counts = {split.billions(), split.millions(), split.thousands()};
        Forms[] scales = {BILLION, MILLION, THOUSAND};
        boolean unitsFollow = split.units() > 0;
        int lastScale = -1;
        for (int i = 0; i < counts.length; i++) {
            if (counts[i] > 0) {
                lastScale = i;
            }
        }
        List<String> parts = new ArrayList<>(8);
        for (int i = 0; i < counts.length; i++) {
            if (counts[i] > 0) {
                parts.addAll(terms(counts[i], scales[i], !unitsFollow && i == lastScale, true));
            }
        }
        String dirhamPhrase;
        if (unitsFollow) {
            parts.addAll(terms(split.units(), DIRHAM, false, false));
            dirhamPhrase = joinTerms(parts);
        } else if (split.dirhams() == 0) {
            dirhamPhrase = "صفر " + DIRHAM.singular();
        } else {
            // Le nom du dirham s'ajoute au dernier terme par annexion, sans « و ».
            dirhamPhrase = joinTerms(parts) + " " + DIRHAM.singular();
        }
        if (split.centimes() == 0) {
            return dirhamPhrase;
        }
        return dirhamPhrase + " و" + joinTerms(terms(split.centimes(), CENTIME, false, false));
    }
}
