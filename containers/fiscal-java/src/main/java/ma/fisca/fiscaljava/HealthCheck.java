package ma.fisca.fiscaljava;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

/** Sonde de santé du conteneur : requête GET /health sur la boucle locale, code de sortie 0 si HTTP 200. */
public final class HealthCheck {

    private static final int TIMEOUT_MS = 3000;

    private HealthCheck() {
    }

    public static boolean probe(int port) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(InetAddress.getLoopbackAddress(), port), TIMEOUT_MS);
            socket.setSoTimeout(TIMEOUT_MS);
            socket.getOutputStream().write(
                    "GET /health HTTP/1.0\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
            socket.getOutputStream().flush();
            String statusLine = new String(socket.getInputStream().readNBytes(12), StandardCharsets.US_ASCII);
            return statusLine.startsWith("HTTP/1.") && statusLine.endsWith(" 200");
        } catch (IOException e) {
            return false;
        }
    }

    public static void main(String[] args) {
        String configured = System.getenv("FISCAL_JAVA_PORT");
        int port = configured == null || configured.isBlank() ? 8080 : Integer.parseInt(configured.trim());
        System.exit(probe(port) ? 0 : 1);
    }
}
