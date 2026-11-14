package ma.fisca.fiscaljava.words;

/** Socle commun des montants en toutes lettres : plafond, séparation dirhams/centimes, groupes de trois chiffres (long, divisions entières). */
final class AmountWordsSupport {

    /** Plafond technique : 999 999 999 999,99 MAD = 99 999 999 999 999 centimes (ce n'est pas une règle fiscale). */
    static final long MAX_CENTS = 99_999_999_999_999L;

    private AmountWordsSupport() {
    }

    /** Dirhams entiers, centimes restants (0 à 99) et les quatre groupes milliards, millions, milliers, unités. */
    record Split(long dirhams, int centimes, int billions, int millions, int thousands, int units) {
    }

    static Split split(long totalCents) {
        if (totalCents < 0 || totalCents > MAX_CENTS) {
            throw new AmountOutOfRangeException();
        }
        long dirhams = totalCents / 100;
        return new Split(
                dirhams,
                (int) (totalCents % 100),
                (int) ((dirhams / 1_000_000_000L) % 1000),
                (int) ((dirhams / 1_000_000L) % 1000),
                (int) ((dirhams / 1000L) % 1000),
                (int) (dirhams % 1000));
    }
}
