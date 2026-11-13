package ma.fisca.fiscaljava.http;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import ma.fisca.fiscaljava.validation.UblValidationService;
import ma.fisca.fiscaljava.validation.UnknownProfileException;
import ma.fisca.fiscaljava.validation.ValidationProfiles;

/**
 * Facade HTTP interne du conteneur : {@code POST /validate} (corps XML, réponse JSON) et {@code GET /health}.
 * Aucun appel sortant ; aucun contenu de document n'est journalisé.
 */
public final class FiscalJavaServer {

    public static final int MAX_BODY_BYTES = 10 * 1024 * 1024;

    private static final String JSON = "application/json; charset=utf-8";
    private static final String PROFILE_PARAM = "profile=";

    private final HttpServer server;
    private final ExecutorService executor;

    private FiscalJavaServer(HttpServer server, ExecutorService executor) {
        this.server = server;
        this.executor = executor;
    }

    /** Démarre le serveur ; le port 0 choisit un port libre. */
    public static FiscalJavaServer start(InetAddress address, int port) throws IOException {
        HttpServer http = HttpServer.create(new InetSocketAddress(address, port), 0);
        ExecutorService pool = Executors.newFixedThreadPool(4);
        http.setExecutor(pool);
        http.createContext("/health", FiscalJavaServer::health);
        http.createContext("/validate", FiscalJavaServer::validate);
        http.createContext("/", exchange -> send(exchange, 404, Json.error("NOT_FOUND", "Route inconnue")));
        http.start();
        return new FiscalJavaServer(http, pool);
    }

    public int port() {
        return server.getAddress().getPort();
    }

    public void stop() {
        server.stop(0);
        executor.shutdownNow();
    }

    private static void health(HttpExchange exchange) throws IOException {
        if (!"GET".equals(exchange.getRequestMethod())) {
            send(exchange, 405, Json.error("METHOD_NOT_ALLOWED", "GET attendu"));
            return;
        }
        send(exchange, 200, "{\"status\":\"ok\",\"service\":\"fiscal-java\"}");
    }

    private static void validate(HttpExchange exchange) throws IOException {
        if (!"POST".equals(exchange.getRequestMethod())) {
            send(exchange, 405, Json.error("METHOD_NOT_ALLOWED", "POST attendu"));
            return;
        }
        String profileName = requestedProfile(exchange.getRequestURI().getRawQuery());
        UblValidationService service;
        try {
            service = new UblValidationService(ValidationProfiles.resolveProfile(profileName));
        } catch (UnknownProfileException e) {
            send(exchange, 400, Json.error("UNKNOWN_PROFILE", "Profil de validation inconnu"));
            return;
        }
        byte[] body = readBounded(exchange.getRequestBody());
        if (body == null) {
            send(exchange, 413, Json.error("BODY_TOO_LARGE", "Corps supérieur à la limite"));
            return;
        }
        send(exchange, 200, Json.report(service.validate(body)));
    }

    private static String requestedProfile(String rawQuery) {
        if (rawQuery != null) {
            for (String pair : rawQuery.split("&")) {
                if (pair.startsWith(PROFILE_PARAM)) {
                    return pair.substring(PROFILE_PARAM.length());
                }
            }
        }
        return ValidationProfiles.CIUS_MA_PROVISIONAL;
    }

    private static byte[] readBounded(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int read;
        while ((read = in.read(buffer)) != -1) {
            if (out.size() + read > MAX_BODY_BYTES) {
                return null;
            }
            out.write(buffer, 0, read);
        }
        return out.toByteArray();
    }

    private static void send(HttpExchange exchange, int status, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", JSON);
        exchange.sendResponseHeaders(status, bytes.length);
        try (var out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }
}
