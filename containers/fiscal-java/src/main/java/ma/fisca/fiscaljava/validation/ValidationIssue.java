package ma.fisca.fiscaljava.validation;

/**
 * Un constat de validation : règle (par exemple BR-CO-15), emplacement (XPath ou ligne/colonne),
 * gravité et message. Ne contient jamais le contenu du document.
 */
public record ValidationIssue(String rule, String location, Severity severity, String message) {

    public ValidationIssue {
        rule = rule == null ? "" : rule;
        location = location == null ? "" : location;
        message = message == null ? "" : message;
    }
}
