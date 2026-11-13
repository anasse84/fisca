package ma.fisca.fiscaljava.validation;

import com.helger.diagnostics.error.IError;
import com.helger.diagnostics.error.level.EErrorLevel;
import com.helger.diver.api.coord.DVRCoordinate;
import com.helger.phive.api.execute.ValidationExecutionManager;
import com.helger.phive.api.executorset.IValidationExecutorSet;
import com.helger.phive.api.executorset.ValidationExecutorSetRegistry;
import com.helger.phive.api.result.ValidationResultList;
import com.helger.phive.api.validity.IValidityDeterminator;
import com.helger.phive.en16931.EN16931Validation;
import com.helger.phive.xml.source.IValidationSourceXML;
import com.helger.phive.xml.source.ValidationSourceXML;
import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import org.xml.sax.InputSource;

/**
 * Validation UBL 2.1 + EN 16931 par PHIVE (XSD OASIS et Schematron embarqués dans les jars),
 * suivie du profil national choisi. Ne lève jamais d'exception sur une entrée invalide.
 */
public final class UblValidationService {

    public static final String RULE_SET_BASE = "OASIS UBL 2.1 + EN 16931 (PHIVE)";

    private static final String ROOT_CREDIT_NOTE = "CreditNote";
    private static final ValidationExecutorSetRegistry<IValidationSourceXML> REGISTRY = buildRegistry();

    private static final String RULE_XML = "XML-NOT-WELL-FORMED";
    private static final String RULE_NO_INPUT = "INPUT-EMPTY";
    private static final String RULE_ENGINE = "VALIDATION-ENGINE";

    private final ValidationProfile profile;

    public UblValidationService(ValidationProfile profile) {
        this.profile = profile;
    }

    /** Nom du jeu de règles, incluant le profil et son statut provisoire. */
    public String ruleSetName() {
        return RULE_SET_BASE + ", profil CIUS-MA : " + profile.name() + ", non publié par la DGI";
    }

    public ValidationReport validate(byte[] xml) {
        if (xml == null || xml.length == 0) {
            return report(List.of(new ValidationIssue(RULE_NO_INPUT, "", Severity.ERROR, "Document vide")));
        }
        Document document;
        try {
            document = parse(xml);
        } catch (Exception e) {
            return report(List.of(new ValidationIssue(RULE_XML, "", Severity.ERROR, "XML mal formé ou refusé")));
        }
        List<ValidationIssue> issues = new ArrayList<>();
        try {
            issues.addAll(runPhive(document));
            issues.addAll(profile.check(document));
        } catch (RuntimeException e) {
            issues.add(new ValidationIssue(RULE_ENGINE, "", Severity.ERROR,
                    "Échec du moteur de validation : " + e.getClass().getSimpleName()));
        }
        return report(issues);
    }

    private ValidationReport report(List<ValidationIssue> issues) {
        boolean valid = issues.stream().noneMatch(i -> i.severity() == Severity.ERROR);
        return new ValidationReport(valid, ruleSetName(), profile.name(), profile.status(), issues);
    }

    private static List<ValidationIssue> runPhive(Document document) {
        DVRCoordinate id = ROOT_CREDIT_NOTE.equals(document.getDocumentElement().getLocalName())
                ? EN16931Validation.VID_UBL_CREDIT_NOTE_1317
                : EN16931Validation.VID_UBL_INVOICE_1317;
        IValidationExecutorSet<IValidationSourceXML> executorSet = REGISTRY.getOfID(id);
        ValidationSourceXML source = ValidationSourceXML.create("document", document);
        IValidityDeterminator<IValidationSourceXML> determinator = IValidityDeterminator.createDefault();
        ValidationResultList results =
                ValidationExecutionManager.executeValidation(determinator, executorSet, source, Locale.ENGLISH);
        List<ValidationIssue> issues = new ArrayList<>();
        results.forEachFlattened(error -> issues.add(toIssue(error)));
        return issues;
    }

    private static ValidationIssue toIssue(IError error) {
        String field = error.getErrorFieldName();
        String location = field != null && !field.isBlank() ? field : error.getErrorLocation().getAsString();
        String rule = error.getErrorID();
        Severity severity;
        if (error.getErrorLevel().isError()) {
            severity = Severity.ERROR;
        } else if (error.getErrorLevel().isGE(EErrorLevel.WARN)) {
            severity = Severity.WARNING;
        } else {
            severity = Severity.INFO;
        }
        return new ValidationIssue(
                rule == null || rule.isBlank() ? "UBL-XSD" : rule,
                location,
                severity,
                error.getErrorText(Locale.ENGLISH));
    }

    private static Document parse(byte[] xml) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        factory.setXIncludeAware(false);
        factory.setExpandEntityReferences(false);
        DocumentBuilder builder = factory.newDocumentBuilder();
        builder.setErrorHandler(new org.xml.sax.helpers.DefaultHandler() {
            @Override
            public void fatalError(org.xml.sax.SAXParseException e) throws org.xml.sax.SAXException {
                throw e;
            }
        });
        return builder.parse(new InputSource(new ByteArrayInputStream(xml)));
    }

    private static ValidationExecutorSetRegistry<IValidationSourceXML> buildRegistry() {
        ValidationExecutorSetRegistry<IValidationSourceXML> registry = new ValidationExecutorSetRegistry<>();
        EN16931Validation.initEN16931(registry);
        return registry;
    }
}
