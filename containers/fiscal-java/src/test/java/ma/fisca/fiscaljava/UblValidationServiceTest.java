package ma.fisca.fiscaljava;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import ma.fisca.fiscaljava.validation.Severity;
import ma.fisca.fiscaljava.validation.UblValidationService;
import ma.fisca.fiscaljava.validation.ValidationIssue;
import ma.fisca.fiscaljava.validation.ValidationProfiles;
import ma.fisca.fiscaljava.validation.ValidationReport;
import org.junit.jupiter.api.Test;

class UblValidationServiceTest {

    private final UblValidationService service =
            new UblValidationService(ValidationProfiles.resolveProfile(ValidationProfiles.CIUS_MA_PROVISIONAL));

    @Test
    void factureMinimaleValideEn16931Passe() {
        ValidationReport report = service.validate(Fixtures.load("invoice-valid-380.xml"));
        assertTrue(report.valid(), "Erreurs inattendues : " + report.issues());
        assertEquals(0, report.errorCount());
    }

    @Test
    void totalFauxEchoueAvecRegleBrCo() {
        ValidationReport report = service.validate(Fixtures.load("invoice-wrong-total.xml"));
        assertFalse(report.valid());
        assertTrue(report.errorCount() > 0);
        boolean regleTotal = report.issues().stream()
                .filter(i -> i.severity() == Severity.ERROR)
                .anyMatch(i -> i.rule().equals("BR-CO-15"));
        assertTrue(regleTotal, "Règle BR-CO-15 absente dans : " + report.issues());
        for (ValidationIssue issue : report.issues()) {
            assertNotNull(issue.location());
            assertFalse(issue.message().isBlank());
        }
    }

    @Test
    void xmlMalFormeDonneUnRapportSansException() {
        ValidationReport report = assertDoesNotThrow(() -> service.validate(Fixtures.load("invoice-malformed.xml")));
        assertFalse(report.valid());
        assertEquals("XML-NOT-WELL-FORMED", report.issues().get(0).rule());
    }

    @Test
    void entreeVideOuNulleDonneUnRapport() {
        assertFalse(assertDoesNotThrow(() -> service.validate(new byte[0])).valid());
        assertFalse(assertDoesNotThrow(() -> service.validate(null)).valid());
    }

    @Test
    void doctypeEstRefuse() {
        byte[] xxe = "<?xml version=\"1.0\"?><!DOCTYPE a [<!ENTITY e \"x\">]><a>&e;</a>"
                .getBytes(java.nio.charset.StandardCharsets.UTF_8);
        ValidationReport report = assertDoesNotThrow(() -> service.validate(xxe));
        assertFalse(report.valid());
    }

    @Test
    void leRapportNommeLeJeuDeReglesEtLeProfil() {
        ValidationReport report = service.validate(Fixtures.load("invoice-valid-380.xml"));
        assertEquals(
                "OASIS UBL 2.1 + EN 16931 (PHIVE), profil CIUS-MA : cius-ma-provisional, non publié par la DGI",
                report.ruleSet());
        assertEquals("cius-ma-provisional", report.profile());
        assertTrue(report.profileStatus().contains("PROVISIONAL"));
    }
}
