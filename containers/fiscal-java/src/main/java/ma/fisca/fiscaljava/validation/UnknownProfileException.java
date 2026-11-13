package ma.fisca.fiscaljava.validation;

/** Levée quand {@link ValidationProfiles#resolveProfile(String)} ne connaît pas le nom demandé. */
public final class UnknownProfileException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public UnknownProfileException(String name) {
        super("Profil de validation inconnu : " + name);
    }
}
