package ma.fisca.fiscaljava.pdf;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Contenu du QR : URL publique de vérification Fisca {@code <baseUrl>/api/v1/public/verify/<xhubUuid>} (route du ticket T-P2A-09).
 * Le domaine est un paramètre de configuration fourni par l'appelant, jamais une constante. Le format du QR officiel de la
 * DGI/xHub n'est pas publié (ERRATA B-13) : ce QR est PROVISOIRE et le conteneur n'appelle jamais l'URL.
 */
public record VerificationQr(String baseUrl, String xhubUuid) {

    public static final String VERIFY_PATH = "/api/v1/public/verify/";

    private static final Pattern UUID = Pattern.compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");

    public VerificationQr {
        if (xhubUuid == null || !UUID.matcher(xhubUuid).matches()) {
            throw new IllegalArgumentException("UUID xHub invalide");
        }
        xhubUuid = xhubUuid.toLowerCase(Locale.ROOT);
        baseUrl = normalizeBase(baseUrl);
    }

    private static String normalizeBase(String raw) {
        if (raw == null || raw.length() > 200) {
            throw new IllegalArgumentException("Domaine de vérification invalide");
        }
        URI uri;
        try {
            uri = new URI(raw);
        } catch (URISyntaxException e) {
            throw new IllegalArgumentException("Domaine de vérification invalide");
        }
        boolean valid = "https".equals(uri.getScheme())
                && uri.getHost() != null
                && uri.getUserInfo() == null
                && uri.getRawQuery() == null
                && uri.getRawFragment() == null;
        if (!valid) {
            throw new IllegalArgumentException("Domaine de vérification invalide");
        }
        return raw.endsWith("/") ? raw.substring(0, raw.length() - 1) : raw;
    }

    /** URL de vérification publique encodée dans le QR. */
    public String url() {
        return baseUrl + VERIFY_PATH + xhubUuid;
    }
}
