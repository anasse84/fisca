package ma.fisca.fiscaljava;

import java.net.InetAddress;
import ma.fisca.fiscaljava.http.FiscalJavaServer;

/** Point d'entrée du conteneur : écoute sur FISCAL_JAVA_PORT (8080 par défaut), toutes interfaces internes. */
public final class Main {

    private static final int DEFAULT_PORT = 8080;

    private Main() {
    }

    public static void main(String[] args) throws Exception {
        String configured = System.getenv("FISCAL_JAVA_PORT");
        int port = configured == null || configured.isBlank() ? DEFAULT_PORT : Integer.parseInt(configured.trim());
        FiscalJavaServer server = FiscalJavaServer.start(InetAddress.getByName("0.0.0.0"), port);
        System.out.println("fiscal-java en écoute sur le port " + server.port());
    }
}
