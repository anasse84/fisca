package ma.fisca.fiscaljava.words;

import java.util.ArrayList;
import java.util.List;

/**
 * Montant en toutes lettres, français, orthographe traditionnelle (traits d'union). Miroir exact de
 * {@code packages/ubl-xades/src/amount-in-words/fr.ts} : les deux sont rejoués sur le même fichier de vecteurs d'or.
 * PROVISOIRE : orthographe à faire relire par un locuteur natif (ERRATA section E).
 */
public final class FrenchAmountInWords {

    private static final String[] UNITS = {"zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize"};
    private static final String[] TENS = {"", "", "vingt", "trente", "quarante", "cinquante", "soixante"};

    private FrenchAmountInWords() {
    }

    private static String below100(int n, boolean last) {
        if (n <= 16) {
            return UNITS[n];
        }
        if (n < 20) {
            return "dix-" + UNITS[n - 10];
        }
        if (n < 70) {
            int ten = n / 10;
            int one = n % 10;
            if (one == 0) {
                return TENS[ten];
            }
            return one == 1 ? TENS[ten] + " et un" : TENS[ten] + "-" + UNITS[one];
        }
        if (n < 80) {
            int one = n - 60;
            return one == 11 ? "soixante et onze" : "soixante-" + below100(one, false);
        }
        if (n == 80) {
            return last ? "quatre-vingts" : "quatre-vingt";
        }
        return "quatre-vingt-" + below100(n - 80, false);
    }

    private static String below1000(int n, boolean last) {
        int hundreds = n / 100;
        int rest = n % 100;
        List<String> parts = new ArrayList<>(2);
        if (hundreds == 1) {
            parts.add("cent");
        } else if (hundreds > 1) {
            parts.add(UNITS[hundreds] + " cent" + (rest == 0 && last ? "s" : ""));
        }
        if (rest > 0) {
            parts.add(below100(rest, last));
        }
        return String.join(" ", parts);
    }

    private static String plural(long count, String singular) {
        return count > 1 ? singular + "s" : singular;
    }

    /** Montant en centimes entiers en toutes lettres françaises, sans préfixe d'arrêté. */
    public static String of(long totalCents) {
        AmountWordsSupport.Split split = AmountWordsSupport.split(totalCents);
        List<String> parts = new ArrayList<>(4);
        boolean endsWithScale = false;
        if (split.billions() > 0) {
            parts.add(below1000(split.billions(), true) + " " + plural(split.billions(), "milliard"));
            endsWithScale = true;
        }
        if (split.millions() > 0) {
            parts.add(below1000(split.millions(), true) + " " + plural(split.millions(), "million"));
            endsWithScale = true;
        }
        if (split.thousands() > 0) {
            parts.add(split.thousands() == 1 ? "mille" : below1000(split.thousands(), false) + " mille");
            endsWithScale = false;
        }
        if (split.units() > 0) {
            parts.add(below1000(split.units(), true));
            endsWithScale = false;
        }
        String words = split.dirhams() == 0 ? "zéro" : String.join(" ", parts);
        String noun = endsWithScale ? "de dirhams" : plural(split.dirhams(), "dirham");
        String dirhamPhrase = words + " " + noun;
        if (split.centimes() == 0) {
            return dirhamPhrase;
        }
        return dirhamPhrase + " et " + below100(split.centimes(), true) + " " + plural(split.centimes(), "centime");
    }
}
