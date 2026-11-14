package ma.fisca.fiscaljava.http;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Lecteur JSON strict et sans dépendance. Les nombres sont des entiers (Long) : une fraction ou un exposant est refusé,
 * conformément à la règle « montants entiers uniquement ». Profondeur limitée ; aucune valeur n'apparaît dans les erreurs.
 */
public final class JsonReader {

    /** JSON invalide ; le message ne contient jamais le contenu lu. */
    public static final class JsonSyntaxException extends RuntimeException {
        JsonSyntaxException(String message) {
            super(message);
        }
    }

    private static final int MAX_DEPTH = 32;

    private final String text;
    private int position;

    private JsonReader(String text) {
        this.text = text;
    }

    /** Objet (Map), tableau (List), String, Long, Boolean ou null (valeur JSON null). */
    public static Object parse(byte[] bytes) {
        JsonReader reader = new JsonReader(new String(bytes, StandardCharsets.UTF_8));
        reader.skipWhitespace();
        Object value = reader.readValue(0);
        reader.skipWhitespace();
        if (reader.position != reader.text.length()) {
            throw new JsonSyntaxException("Contenu après la valeur JSON");
        }
        return value;
    }

    private Object readValue(int depth) {
        if (depth > MAX_DEPTH) {
            throw new JsonSyntaxException("Imbrication excessive");
        }
        if (position >= text.length()) {
            throw new JsonSyntaxException("Fin inattendue");
        }
        char c = text.charAt(position);
        return switch (c) {
            case '{' -> readObject(depth);
            case '[' -> readArray(depth);
            case '"' -> readString();
            case 't' -> literal("true", Boolean.TRUE);
            case 'f' -> literal("false", Boolean.FALSE);
            case 'n' -> literal("null", null);
            default -> readInteger();
        };
    }

    private Object literal(String word, Object value) {
        if (!text.startsWith(word, position)) {
            throw new JsonSyntaxException("Littéral invalide");
        }
        position += word.length();
        return value;
    }

    private Map<String, Object> readObject(int depth) {
        Map<String, Object> map = new LinkedHashMap<>();
        position++;
        skipWhitespace();
        if (peek() == '}') {
            position++;
            return map;
        }
        while (true) {
            skipWhitespace();
            if (peek() != '"') {
                throw new JsonSyntaxException("Clé attendue");
            }
            String key = readString();
            skipWhitespace();
            expect(':');
            skipWhitespace();
            if (map.containsKey(key)) {
                throw new JsonSyntaxException("Clé dupliquée");
            }
            map.put(key, readValue(depth + 1));
            skipWhitespace();
            char next = take();
            if (next == '}') {
                return map;
            }
            if (next != ',') {
                throw new JsonSyntaxException("Séparateur attendu");
            }
        }
    }

    private List<Object> readArray(int depth) {
        List<Object> list = new ArrayList<>();
        position++;
        skipWhitespace();
        if (peek() == ']') {
            position++;
            return list;
        }
        while (true) {
            skipWhitespace();
            list.add(readValue(depth + 1));
            skipWhitespace();
            char next = take();
            if (next == ']') {
                return list;
            }
            if (next != ',') {
                throw new JsonSyntaxException("Séparateur attendu");
            }
        }
    }

    private String readString() {
        position++;
        StringBuilder out = new StringBuilder();
        while (true) {
            if (position >= text.length()) {
                throw new JsonSyntaxException("Chaîne non terminée");
            }
            char c = text.charAt(position++);
            if (c == '"') {
                return out.toString();
            }
            if (c < 0x20) {
                throw new JsonSyntaxException("Caractère de contrôle dans une chaîne");
            }
            if (c != '\\') {
                out.append(c);
                continue;
            }
            if (position >= text.length()) {
                throw new JsonSyntaxException("Échappement incomplet");
            }
            char escaped = text.charAt(position++);
            switch (escaped) {
                case '"', '\\', '/' -> out.append(escaped);
                case 'b' -> out.append('\b');
                case 'f' -> out.append('\f');
                case 'n' -> out.append('\n');
                case 'r' -> out.append('\r');
                case 't' -> out.append('\t');
                case 'u' -> {
                    if (position + 4 > text.length()) {
                        throw new JsonSyntaxException("Échappement unicode incomplet");
                    }
                    try {
                        out.append((char) Integer.parseInt(text.substring(position, position + 4), 16));
                    } catch (NumberFormatException e) {
                        throw new JsonSyntaxException("Échappement unicode invalide");
                    }
                    position += 4;
                }
                default -> throw new JsonSyntaxException("Échappement inconnu");
            }
        }
    }

    private Long readInteger() {
        int start = position;
        if (peek() == '-') {
            position++;
        }
        int digitsStart = position;
        while (position < text.length() && text.charAt(position) >= '0' && text.charAt(position) <= '9') {
            position++;
        }
        int digits = position - digitsStart;
        if (digits == 0 || (digits > 1 && text.charAt(digitsStart) == '0')) {
            throw new JsonSyntaxException("Nombre invalide");
        }
        if (position < text.length() && (text.charAt(position) == '.' || text.charAt(position) == 'e' || text.charAt(position) == 'E')) {
            throw new JsonSyntaxException("Nombre non entier refusé");
        }
        try {
            return Long.parseLong(text.substring(start, position));
        } catch (NumberFormatException e) {
            throw new JsonSyntaxException("Entier hors limites");
        }
    }

    private void skipWhitespace() {
        while (position < text.length()) {
            char c = text.charAt(position);
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
                position++;
            } else {
                return;
            }
        }
    }

    private char peek() {
        if (position >= text.length()) {
            throw new JsonSyntaxException("Fin inattendue");
        }
        return text.charAt(position);
    }

    private char take() {
        char c = peek();
        position++;
        return c;
    }

    private void expect(char expected) {
        if (take() != expected) {
            throw new JsonSyntaxException("Caractère attendu");
        }
    }
}
