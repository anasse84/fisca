package ma.fisca.fiscaljava.validation;

import java.util.List;

/**
 * Rapport structuré de validation.
 *
 * @param valid         vrai si aucun constat de gravité ERROR
 * @param ruleSet       nom du jeu de règles appliqué
 * @param profile       nom du profil national appliqué
 * @param profileStatus statut du profil (provisoire tant qu'aucun texte officiel n'est publié)
 * @param issues        constats, dans l'ordre d'émission
 */
public record ValidationReport(
        boolean valid, String ruleSet, String profile, String profileStatus, List<ValidationIssue> issues) {

    public ValidationReport {
        issues = List.copyOf(issues);
    }

    public int errorCount() {
        return (int) issues.stream().filter(i -> i.severity() == Severity.ERROR).count();
    }

    public int warningCount() {
        return (int) issues.stream().filter(i -> i.severity() == Severity.WARNING).count();
    }
}
