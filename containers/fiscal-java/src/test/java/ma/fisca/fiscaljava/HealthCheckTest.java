package ma.fisca.fiscaljava;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.InetAddress;
import ma.fisca.fiscaljava.http.FiscalJavaServer;
import org.junit.jupiter.api.Test;

class HealthCheckTest {

    @Test
    void sondeReussitSurUnServeurActif() throws Exception {
        FiscalJavaServer server = FiscalJavaServer.start(InetAddress.getLoopbackAddress(), 0);
        try {
            assertTrue(HealthCheck.probe(server.port()));
        } finally {
            server.stop();
        }
    }

    @Test
    void sondeEchoueSansServeur() throws Exception {
        FiscalJavaServer server = FiscalJavaServer.start(InetAddress.getLoopbackAddress(), 0);
        int port = server.port();
        server.stop();
        assertFalse(HealthCheck.probe(port));
    }
}
