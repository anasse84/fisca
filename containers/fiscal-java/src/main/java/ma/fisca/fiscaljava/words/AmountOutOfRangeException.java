package ma.fisca.fiscaljava.words;

/** Montant négatif ou supérieur au plafond technique de la mise en toutes lettres (code AMOUNT_OUT_OF_RANGE). */
public final class AmountOutOfRangeException extends IllegalArgumentException {

    public static final String CODE = "AMOUNT_OUT_OF_RANGE";

    public AmountOutOfRangeException() {
        super("Montant hors de l'intervalle admis pour la mise en toutes lettres.");
    }
}
