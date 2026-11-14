package ma.fisca.fiscaljava;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.awt.image.BufferedImage;
import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import ma.fisca.fiscaljava.http.FiscalJavaServer;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class FacturXEndpointTest {

    private static final String ARRETE_FR = "mille deux cents dirhams";
    private static final String ARRETE_AR = "ألف ومائتا درهم";

    private FiscalJavaServer server;
    private String base;
    private final HttpClient client = HttpClient.newHttpClient();

    @BeforeEach
    void start() throws Exception {
        System.setProperty("java.awt.headless", "true");
        server = FiscalJavaServer.start(InetAddress.getLoopbackAddress(), 0);
        base = "http://127.0.0.1:" + server.port();
    }

    @AfterEach
    void stop() {
        server.stop();
    }

    private static String body(byte[] xml, String totalCents, String extraRoot) {
        String b64 = Base64.getEncoder().encodeToString(xml);
        return """
            {
              "xmlBase64": "%s",
              "presentation": {
                "typeCode": "380",
                "invoiceNumber": "FA-TEST-0001",
                "issueDate": "2026-11-13",
                "dueDate": "2026-12-13",
                "currencyCode": "MAD",
                "supplier": {"name": "Vendeur Test SARL AU", "nameAr": "شركة البائع للتجارب", "ice": "000970000000097", "identifiantFiscal": "12345678",
                  "rc": "123456", "legalForm": "SARL AU", "shareCapitalCents": 10000000, "addressLines": ["1 rue de Test", "10000 Rabat, MA"]},
                "customer": {"name": "Acheteur Test SA", "ice": "001197530853397", "addressLines": ["2 avenue de Test"]},
                "lines": [{"descriptionFr": "Article de test", "descriptionAr": "مادة للتجربة", "quantityMilli": 10000, "unitCode": "C62",
                  "unitPriceCents": 10000, "discountBps": 0, "vatRateBps": 2000, "lineTotalCents": 100000}],
                "vatBreakdown": [{"vatRateBps": 2000, "taxableCents": 100000, "taxCents": 20000}],
                "totals": {"lineExtensionCents": 100000, "taxTotalCents": 20000, "stampDutyCents": 0, "taxExclusiveCents": 100000,
                  "taxInclusiveCents": %s, "retentionCents": 0, "payableCents": %s}
              },
              "verification": {"baseUrl": "https://verif.exemple.test", "xhubUuid": "3f2b8c1e-5d4a-4e7b-9a10-2c6d8e0f1a23"}%s
            }
            """.formatted(b64, totalCents, totalCents, extraRoot);
    }

    private HttpResponse<byte[]> post(String json) throws Exception {
        return client.send(
                HttpRequest.newBuilder(URI.create(base + "/facturx")).header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(json)).build(),
                HttpResponse.BodyHandlers.ofByteArray());
    }

    private static String text(HttpResponse<byte[]> response) {
        return new String(response.body(), StandardCharsets.UTF_8);
    }

    @Test
    void retourneUnPdfA3bValideAvecLeXmlEmbarqueEtLeQrDecodable() throws Exception {
        byte[] xml = Fixtures.load("invoice-valid-380.xml");
        HttpResponse<byte[]> response = post(body(xml, "120000", ""));
        assertEquals(200, response.statusCode(), text(response));
        assertEquals("application/pdf", response.headers().firstValue("Content-Type").orElse(""));
        PdfaValidator.Outcome outcome = PdfaValidator.validate(response.body());
        assertEquals(java.util.List.of(), outcome.violations());
        try (PDDocument doc = Loader.loadPDF(response.body())) {
            var spec = doc.getDocumentCatalog().getNames().getEmbeddedFiles().getNames().get("ubl-invoice.xml");
            assertArrayEquals(xml, spec.getEmbeddedFile().toByteArray());
            String pdfText = new PDFTextStripper().getText(doc);
            assertTrue(pdfText.contains(ARRETE_FR), pdfText);
            BufferedImage page = new PDFRenderer(doc).renderImageWithDPI(0, 300);
            assertEquals("https://verif.exemple.test/api/v1/public/verify/3f2b8c1e-5d4a-4e7b-9a10-2c6d8e0f1a23", PresentationPdfTest.decodeQr(page));
        }
    }

    @Test
    void accepteLesArretesAttendusCalculesParLAppelantEtRefuseUneDivergence() throws Exception {
        byte[] xml = Fixtures.load("invoice-valid-380.xml");
        String good = ",\"expectedAmountInWords\": {\"fr\": \"" + ARRETE_FR + "\", \"ar\": \"" + ARRETE_AR + "\"}";
        assertEquals(200, post(body(xml, "120000", good)).statusCode());
        String bad = ",\"expectedAmountInWords\": {\"fr\": \"mille deux cent dirhams\", \"ar\": \"" + ARRETE_AR + "\"}";
        HttpResponse<byte[]> response = post(body(xml, "120000", bad));
        assertEquals(422, response.statusCode());
        assertTrue(text(response).contains("AMOUNT_IN_WORDS_MISMATCH"));
    }

    @Test
    void refuseUnTotalDePresentationDifferentDuXml() throws Exception {
        HttpResponse<byte[]> response = post(body(Fixtures.load("invoice-valid-380.xml"), "120001", ""));
        assertEquals(422, response.statusCode());
        assertTrue(text(response).contains("PRESENTATION_XML_MISMATCH"));
        assertTrue(text(response).contains("presentation.totals.taxInclusiveCents"));
    }

    @Test
    void refuseUnXmlMalFormeOuNonUbl() throws Exception {
        assertEquals(422, post(body(Fixtures.load("invoice-malformed.xml"), "120000", "")).statusCode());
        assertEquals(422, post(body("<a/>".getBytes(StandardCharsets.UTF_8), "120000", "")).statusCode());
        String doctype = "<?xml version=\"1.0\"?><!DOCTYPE x [<!ENTITY e \"v\">]><Invoice xmlns=\"urn:oasis:names:specification:ubl:schema:xsd:Invoice-2\"/>";
        assertEquals(422, post(body(doctype.getBytes(StandardCharsets.UTF_8), "120000", "")).statusCode());
    }

    @Test
    void refuseUnJsonInvalidePuisUneCleInconnueUnNombreNonEntierEtUnChampManquant() throws Exception {
        assertEquals(400, post("pas du json").statusCode());
        assertTrue(text(post("{")).contains("INVALID_JSON"));
        byte[] xml = Fixtures.load("invoice-valid-380.xml");
        HttpResponse<byte[]> unknown = post(body(xml, "120000", ",\"inconnu\": 1"));
        assertEquals(400, unknown.statusCode());
        assertTrue(text(unknown).contains("\"path\":\"inconnu\""));
        HttpResponse<byte[]> fraction = post(body(xml, "1200.5", ""));
        assertEquals(400, fraction.statusCode());
        assertTrue(text(fraction).contains("INVALID_JSON"), "un nombre non entier est refusé dès la lecture");
        HttpResponse<byte[]> missing = post(body(xml, "120000", "").replace("\"invoiceNumber\": \"FA-TEST-0001\",", ""));
        assertEquals(400, missing.statusCode());
        assertTrue(text(missing).contains("presentation.invoiceNumber"));
        HttpResponse<byte[]> negative = post(body(xml, "-5", ""));
        assertEquals(400, negative.statusCode());
    }

    @Test
    void refuseUnDomaineDeVerificationNonHttpsSansEcrireLaValeurDansLErreur() throws Exception {
        byte[] xml = Fixtures.load("invoice-valid-380.xml");
        HttpResponse<byte[]> response = post(body(xml, "120000", "").replace("https://verif.exemple.test", "http://verif.exemple.test"));
        assertEquals(400, response.statusCode());
        String answer = text(response);
        assertTrue(answer.contains("\"path\":\"verification\""));
        assertFalse(answer.contains("verif.exemple.test"), "aucune valeur reprise dans l'erreur");
    }

    @Test
    void lesErreursNeReprennentJamaisLeContenuDeLaFacture() throws Exception {
        byte[] xml = Fixtures.load("invoice-valid-380.xml");
        HttpResponse<byte[]> response = post(body(xml, "120000", "").replace("000970000000097", "123"));
        assertEquals(400, response.statusCode());
        assertFalse(text(response).contains("123"));
        assertFalse(text(response).contains("Vendeur"));
    }

    @Test
    void refuseLesMethodesAutresQuePost() throws Exception {
        HttpResponse<byte[]> response = client.send(HttpRequest.newBuilder(URI.create(base + "/facturx")).GET().build(), HttpResponse.BodyHandlers.ofByteArray());
        assertEquals(405, response.statusCode());
    }

    @Test
    void refuseUnCorpsTropGros() throws Exception {
        byte[] huge = new byte[FiscalJavaServer.MAX_BODY_BYTES + 1];
        java.util.Arrays.fill(huge, (byte) ' ');
        HttpResponse<byte[]> response = client.send(
                HttpRequest.newBuilder(URI.create(base + "/facturx")).POST(HttpRequest.BodyPublishers.ofByteArray(huge)).build(), HttpResponse.BodyHandlers.ofByteArray());
        assertEquals(413, response.statusCode());
    }
}
