package ma.fisca.fiscaljava;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import ma.fisca.fiscaljava.http.FiscalJavaServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class FiscalJavaServerTest {

    private FiscalJavaServer server;
    private String base;
    private final HttpClient client = HttpClient.newHttpClient();

    @BeforeEach
    void start() throws Exception {
        server = FiscalJavaServer.start(InetAddress.getLoopbackAddress(), 0);
        base = "http://127.0.0.1:" + server.port();
    }

    @AfterEach
    void stop() {
        server.stop();
    }

    private HttpResponse<String> send(HttpRequest request) throws Exception {
        return client.send(request, HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void healthRepondOk() throws Exception {
        HttpResponse<String> response = send(HttpRequest.newBuilder(URI.create(base + "/health")).GET().build());
        assertEquals(200, response.statusCode());
        assertTrue(response.body().contains("\"status\":\"ok\""));
    }

    @Test
    void validateAccepteUneFactureValide() throws Exception {
        HttpResponse<String> response = send(HttpRequest.newBuilder(URI.create(base + "/validate"))
                .header("Content-Type", "application/xml")
                .POST(HttpRequest.BodyPublishers.ofByteArray(Fixtures.load("invoice-valid-380.xml")))
                .build());
        assertEquals(200, response.statusCode());
        assertTrue(response.body().contains("\"valid\":true"), response.body());
        assertTrue(response.body().contains("cius-ma-provisional"));
    }

    @Test
    void validateSignaleUnTotalFaux() throws Exception {
        HttpResponse<String> response = send(HttpRequest.newBuilder(URI.create(base + "/validate"))
                .POST(HttpRequest.BodyPublishers.ofByteArray(Fixtures.load("invoice-wrong-total.xml")))
                .build());
        assertEquals(200, response.statusCode());
        assertTrue(response.body().contains("\"valid\":false"));
        assertTrue(response.body().contains("BR-CO-15"));
    }

    @Test
    void validateAvecXmlMalFormeRepondUnRapport() throws Exception {
        HttpResponse<String> response = send(HttpRequest.newBuilder(URI.create(base + "/validate"))
                .POST(HttpRequest.BodyPublishers.ofByteArray(Fixtures.load("invoice-malformed.xml")))
                .build());
        assertEquals(200, response.statusCode());
        assertTrue(response.body().contains("XML-NOT-WELL-FORMED"));
    }

    @Test
    void validateRefuseLesMethodesAutresQuePost() throws Exception {
        HttpResponse<String> response = send(HttpRequest.newBuilder(URI.create(base + "/validate")).GET().build());
        assertEquals(405, response.statusCode());
    }

    @Test
    void profilInconnuDonne400() throws Exception {
        HttpResponse<String> response = send(HttpRequest.newBuilder(URI.create(base + "/validate?profile=zzz"))
                .POST(HttpRequest.BodyPublishers.ofByteArray(Fixtures.load("invoice-valid-380.xml")))
                .build());
        assertEquals(400, response.statusCode());
    }

    @Test
    void routeInconnueDonne404() throws Exception {
        HttpResponse<String> response = send(HttpRequest.newBuilder(URI.create(base + "/nope")).GET().build());
        assertEquals(404, response.statusCode());
    }
}
