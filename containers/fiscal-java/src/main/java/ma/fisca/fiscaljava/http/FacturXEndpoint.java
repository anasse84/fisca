package ma.fisca.fiscaljava.http;

import java.io.IOException;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;
import ma.fisca.fiscaljava.facturx.FacturXAssembler;
import ma.fisca.fiscaljava.facturx.MustangFacturXAssembler;
import ma.fisca.fiscaljava.pdf.InvoicePresentation;
import ma.fisca.fiscaljava.pdf.PresentationPdfBuilder;
import ma.fisca.fiscaljava.words.AmountInWords;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;
import org.xml.sax.SAXException;
import org.xml.sax.helpers.DefaultHandler;

/**
 * Logique de {@code POST /facturx} : analyse du corps JSON, contrôle de cohérence XML/présentation, calcul des arrêtés en
 * toutes lettres (source de vérité : Java, rejoué sur les vecteurs d'or), PDF de présentation puis assemblage PDF/A-3b.
 * Aucun contenu de facture n'est journalisé ; aucune URL n'est appelée (le QR n'est qu'encodé).
 */
final class FacturXEndpoint {

    /** Résultat : PDF, ou erreur (statut, code, chemin facultatif). */
    record Outcome(int status, byte[] pdf, String errorCode, String message, String path) {
        static Outcome ok(byte[] pdf) {
            return new Outcome(200, pdf, null, null, null);
        }

        static Outcome error(int status, String code, String message, String path) {
            return new Outcome(status, null, code, message, path);
        }
    }

    private static final String NS_CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";
    private static final Pattern AMOUNT = Pattern.compile("(-?)(\\d+)(?:\\.(\\d{1,2}))?");

    private final FacturXAssembler assembler;

    FacturXEndpoint() {
        this(new MustangFacturXAssembler());
    }

    FacturXEndpoint(FacturXAssembler assembler) {
        this.assembler = assembler;
    }

    Outcome handle(byte[] body) {
        FacturXRequest request;
        try {
            request = FacturXRequest.from(JsonReader.parse(body));
        } catch (JsonReader.JsonSyntaxException e) {
            return Outcome.error(400, "INVALID_JSON", "Corps JSON invalide", null);
        } catch (FacturXRequest.InvalidRequestException e) {
            return Outcome.error(400, "INVALID_REQUEST", "Requête invalide", e.path());
        }
        InvoicePresentation presentation = request.presentation();
        Document xml = parseXml(request.invoiceXml());
        if (xml == null) {
            return Outcome.error(422, "XML_INVALID", "Le XML n'est pas un document UBL 2.1 Invoice ou CreditNote bien formé", "xmlBase64");
        }
        String mismatch = crossCheck(xml, presentation);
        if (mismatch != null) {
            return Outcome.error(422, "PRESENTATION_XML_MISMATCH", "La présentation ne correspond pas au XML embarqué", mismatch);
        }
        long total = presentation.totals().taxInclusiveCents();
        String wordsFr = AmountInWords.fr(total);
        String wordsAr = AmountInWords.ar(total);
        FacturXRequest.ExpectedWords expected = request.expectedWords();
        if (expected != null && !(wordsFr.equals(expected.fr()) && wordsAr.equals(expected.ar()))) {
            return Outcome.error(422, "AMOUNT_IN_WORDS_MISMATCH", "Les arrêtés fournis diffèrent du calcul du conteneur", "expectedAmountInWords");
        }
        try {
            byte[] base = new PresentationPdfBuilder().build(presentation, request.verification());
            return Outcome.ok(assembler.assemble(request.invoiceXml(), base));
        } catch (IOException | RuntimeException e) {
            return Outcome.error(500, "PDF_BUILD_FAILED", "Génération du PDF impossible", null);
        }
    }

    private static Document parseXml(byte[] bytes) {
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(true);
            factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setXIncludeAware(false);
            factory.setExpandEntityReferences(false);
            DocumentBuilder builder = factory.newDocumentBuilder();
            builder.setErrorHandler(new DefaultHandler());
            Document document = builder.parse(new InputSource(new StringReader(new String(bytes, StandardCharsets.UTF_8))));
            String root = document.getDocumentElement().getLocalName();
            return "Invoice".equals(root) || "CreditNote".equals(root) ? document : null;
        } catch (ParserConfigurationException | SAXException | IOException e) {
            return null;
        }
    }

    /** Contrôle numéro et TTC : rend le chemin du champ de présentation incohérent, ou null. */
    private static String crossCheck(Document xml, InvoicePresentation presentation) {
        Element root = xml.getDocumentElement();
        String id = firstChildText(root, "ID");
        if (!presentation.invoiceNumber().equals(id)) {
            return "presentation.invoiceNumber";
        }
        NodeList totals = root.getElementsByTagNameNS("*", "LegalMonetaryTotal");
        if (totals.getLength() != 1) {
            return "presentation.totals.taxInclusiveCents";
        }
        Long cents = parseCents(firstChildText((Element) totals.item(0), "TaxInclusiveAmount"));
        if (cents == null || cents != presentation.totals().taxInclusiveCents()) {
            return "presentation.totals.taxInclusiveCents";
        }
        return null;
    }

    private static String firstChildText(Element parent, String localName) {
        for (Node n = parent.getFirstChild(); n != null; n = n.getNextSibling()) {
            if (n instanceof Element e && localName.equals(e.getLocalName()) && NS_CBC.equals(e.getNamespaceURI())) {
                return e.getTextContent().trim();
            }
        }
        return null;
    }

    /** « 1200.00 » -> 120000, sans flottant ; null si le format est inattendu. */
    static Long parseCents(String text) {
        if (text == null) {
            return null;
        }
        Matcher m = AMOUNT.matcher(text);
        if (!m.matches() || m.group(2).length() > 15) {
            return null;
        }
        String fraction = m.group(3) == null ? "00" : (m.group(3) + "0").substring(0, 2);
        long value = Long.parseLong(m.group(2)) * 100 + Long.parseLong(fraction);
        return m.group(1).isEmpty() ? value : -value;
    }

}
