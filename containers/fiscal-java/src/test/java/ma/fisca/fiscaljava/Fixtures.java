package ma.fisca.fiscaljava;

import java.io.IOException;
import java.io.InputStream;

final class Fixtures {
    private Fixtures() {
    }

    static byte[] load(String name) {
        try (InputStream in = Fixtures.class.getResourceAsStream("/fixtures/" + name)) {
            if (in == null) {
                throw new IllegalStateException("Fixture absente : " + name);
            }
            return in.readAllBytes();
        } catch (IOException e) {
            throw new IllegalStateException("Fixture illisible : " + name, e);
        }
    }
}
