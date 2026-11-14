package ma.fisca.fiscaljava.validation;

import java.util.List;
import org.w3c.dom.Document;

/**
 * Profil national de validation, appliqué après les règles UBL 2.1 et EN 16931.
 * Les règles propres au Maroc vivent dans une implémentation remplaçable de cette interface,
 * jamais dans {@link UblValidationService}.
 */
public interface ValidationProfile {

    /** Identifiant stable du profil, par exemple {@code cius-ma-provisional}. */
    String name();

    /** Statut lisible : régime provisoire tant qu'aucun texte officiel n'est publié (ERRATA B-13). */
    String status();

    /** Constats propres au profil pour un document déjà bien formé. */
    List<ValidationIssue> check(Document document);
}
