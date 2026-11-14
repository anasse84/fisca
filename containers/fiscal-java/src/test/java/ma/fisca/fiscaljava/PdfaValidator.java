package ma.fisca.fiscaljava;

import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.List;
import org.verapdf.gf.foundry.VeraGreenfieldFoundryProvider;
import org.verapdf.pdfa.Foundries;
import org.verapdf.pdfa.PDFAParser;
import org.verapdf.pdfa.PDFAValidator;
import org.verapdf.pdfa.flavours.PDFAFlavour;
import org.verapdf.pdfa.results.TestAssertion;
import org.verapdf.pdfa.results.ValidationResult;

/** Validation PDF/A-3b par veraPDF (org.verapdf:validation-model, analyseur Greenfield) : rend les règles violées. */
final class PdfaValidator {

    static final PDFAFlavour FLAVOUR = PDFAFlavour.PDFA_3_B;

    record Outcome(boolean compliant, List<String> violations, String flavour) {
    }

    private PdfaValidator() {
    }

    static synchronized Outcome validate(byte[] pdf) {
        try {
            VeraGreenfieldFoundryProvider.initialise();
            try (PDFAParser parser = Foundries.defaultInstance().createParser(new ByteArrayInputStream(pdf), FLAVOUR);
                    PDFAValidator validator = Foundries.defaultInstance().createValidator(FLAVOUR, false)) {
                ValidationResult result = validator.validate(parser);
                List<String> violations = new ArrayList<>();
                for (TestAssertion assertion : result.getTestAssertions()) {
                    if (assertion.getStatus() == TestAssertion.Status.FAILED) {
                        violations.add(assertion.getRuleId().getSpecification() + " " + assertion.getRuleId().getClause() + "-" + assertion.getRuleId().getTestNumber() + " : " + assertion.getMessage());
                    }
                }
                return new Outcome(result.isCompliant(), violations, result.getPDFAFlavour().getId());
            }
        } catch (Exception e) {
            throw new IllegalStateException("veraPDF a échoué", e);
        }
    }
}
