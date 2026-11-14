package ma.fisca.fiscaljava.validation;

import java.util.List;
import org.w3c.dom.Document;

/**
 * Profil provisoire CIUS-MA. Aucune spécification technique officielle de la facturation électronique
 * n'est publiée (ERRATA B-13) : ce profil est le point de remplacement des règles marocaines.
 * Il ne contient aucune règle dans ce ticket ; les règles sont ajoutées par le ticket P2A-02.
 */
final class CiusMaProvisionalProfile implements ValidationProfile {

    @Override
    public String name() {
        return ValidationProfiles.CIUS_MA_PROVISIONAL;
    }

    @Override
    public String status() {
        return "PROVISIONAL - non publié par la DGI, conformité officielle non vérifiée";
    }

    @Override
    public List<ValidationIssue> check(Document document) {
        return List.of();
    }
}
