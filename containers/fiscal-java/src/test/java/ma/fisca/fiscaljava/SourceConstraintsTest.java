package ma.fisca.fiscaljava;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

class SourceConstraintsTest {

    private static final Path MAIN = Path.of("src", "main");

    private static List<Path> sources() throws IOException {
        try (Stream<Path> walk = Files.walk(MAIN)) {
            return walk.filter(Files::isRegularFile).toList();
        }
    }

    private static List<String> offending(Pattern pattern) throws IOException {
        return sources().stream()
                .filter(p -> {
                    try {
                        return pattern.matcher(Files.readString(p)).find();
                    } catch (IOException e) {
                        throw new IllegalStateException(e);
                    }
                })
                .map(Path::toString)
                .toList();
    }

    @Test
    void aucunFlottantDansSrcMain() throws IOException {
        assertTrue(sources().size() > 0);
        assertEquals(List.of(), offending(Pattern.compile("\\b(double|float|Double|Float|BigDecimal)\\b")));
    }

    // Seul le nom de fonctionnalité Xerces (identifiant, pas une adresse résolue) est toléré.
    @Test
    void aucuneUrlDistanteDansSrcMain() throws IOException {
        assertEquals(List.of(), offending(Pattern.compile("https?://(?!apache\\.org/xml/features/)")));
    }

    @Test
    void aucunMarqueurDeCodeFactice() throws IOException {
        assertEquals(List.of(), offending(Pattern.compile(String.join("|", "TO" + "DO", "FIX" + "ME", "HA" + "CK", "PLACE" + "HOLDER"))));
    }

    @Test
    void aucuneMentionDeConformiteDgi() throws IOException {
        assertEquals(List.of(), offending(Pattern.compile("(?i)conforme DGI|homologu|certifi")));
    }
}
