package ma.fisca.fiscaljava.http;

import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import ma.fisca.fiscaljava.facturx.MustangFacturXAssembler.Relationship;
import ma.fisca.fiscaljava.pdf.InvoicePresentation;
import ma.fisca.fiscaljava.pdf.VerificationQr;
import ma.fisca.fiscaljava.words.AmountInWords;

/**
 * Corps JSON de {@code POST /facturx}, lu en mode strict : toute clé inconnue, tout type inattendu et tout entier hors
 * bornes sont refusés ; l'erreur désigne un chemin de champ, jamais une valeur (aucune donnée personnelle dans les erreurs).
 */
public record FacturXRequest(
        byte[] invoiceXml,
        Relationship relationship,
        InvoicePresentation presentation,
        VerificationQr verification,
        ExpectedWords expectedWords) {

    /** Arrêtés calculés par l'appelant (facultatifs) : le conteneur les recalcule et refuse toute divergence. */
    public record ExpectedWords(String fr, String ar) {
    }

    /** Requête invalide : code HTTP 400 {@code INVALID_REQUEST}, avec le chemin du champ fautif. */
    public static final class InvalidRequestException extends RuntimeException {
        private final String path;

        InvalidRequestException(String path) {
            super("Champ invalide : " + path);
            this.path = path;
        }

        public String path() {
            return path;
        }
    }

    private static final long MAX_CENTS = AmountInWords.MAX_CENTS;
    private static final Pattern DATE = Pattern.compile("\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])");
    private static final Pattern DIGITS_ID = Pattern.compile("[0-9A-Za-z/-]{1,20}");
    private static final Pattern ICE = Pattern.compile("\\d{15}");
    private static final Pattern UNIT = Pattern.compile("[A-Z0-9]{2,3}");
    private static final Set<String> TYPES = Set.of("380", "381", "383", "386", "389");

    /** Lecteur d'objet qui mémorise les clés consommées pour refuser les clés inconnues. */
    private static final class Obj {
        private final Map<String, Object> map;
        private final String path;
        private final Set<String> used = new HashSet<>();

        Obj(Object raw, String path) {
            if (!(raw instanceof Map<?, ?> m)) {
                throw new InvalidRequestException(path);
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> typed = (Map<String, Object>) m;
            this.map = typed;
            this.path = path;
        }

        String at(String key) {
            return path.isEmpty() ? key : path + "." + key;
        }

        Object raw(String key) {
            used.add(key);
            return map.get(key);
        }

        boolean has(String key) {
            used.add(key);
            return map.containsKey(key) && map.get(key) != null;
        }

        String string(String key, boolean required, int maxLength) {
            Object value = raw(key);
            if (value == null) {
                if (required) {
                    throw new InvalidRequestException(at(key));
                }
                return null;
            }
            if (!(value instanceof String s) || s.isEmpty() || s.length() > maxLength || hasForbiddenChar(s)) {
                throw new InvalidRequestException(at(key));
            }
            return s;
        }

        String pattern(String key, boolean required, Pattern pattern) {
            String value = string(key, required, 100);
            if (value != null && !pattern.matcher(value).matches()) {
                throw new InvalidRequestException(at(key));
            }
            return value;
        }

        long integer(String key, boolean required, long min, long max, long fallback) {
            Object value = raw(key);
            if (value == null) {
                if (required) {
                    throw new InvalidRequestException(at(key));
                }
                return fallback;
            }
            if (!(value instanceof Long l) || l < min || l > max) {
                throw new InvalidRequestException(at(key));
            }
            return l;
        }

        long cents(String key) {
            return integer(key, true, 0, MAX_CENTS, 0);
        }

        List<Object> list(String key, boolean required, int minSize, int maxSize) {
            Object value = raw(key);
            if (value == null) {
                if (required) {
                    throw new InvalidRequestException(at(key));
                }
                return List.of();
            }
            if (!(value instanceof List<?> l) || l.size() < minSize || l.size() > maxSize) {
                throw new InvalidRequestException(at(key));
            }
            @SuppressWarnings("unchecked")
            List<Object> typed = (List<Object>) l;
            return typed;
        }

        void done() {
            for (String key : map.keySet()) {
                if (!used.contains(key)) {
                    throw new InvalidRequestException(at(key));
                }
            }
        }
    }

    private static boolean hasForbiddenChar(String s) {
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if ((c < 0x20 && c != '\t') || c == 0x7F || (c >= 0xD800 && c <= 0xDFFF && !Character.isSurrogate(c))) {
                return true;
            }
        }
        return false;
    }

    /** Lit l'objet JSON déjà analysé. */
    public static FacturXRequest from(Object json) {
        Obj root = new Obj(json, "");
        String b64 = root.string("xmlBase64", true, 14_000_000);
        byte[] xml;
        try {
            xml = Base64.getDecoder().decode(b64);
        } catch (IllegalArgumentException e) {
            throw new InvalidRequestException("xmlBase64");
        }
        if (xml.length == 0) {
            throw new InvalidRequestException("xmlBase64");
        }
        Relationship relationship = Relationship.ALTERNATIVE;
        String rel = root.string("attachmentRelationship", false, 20);
        if (rel != null) {
            relationship = switch (rel) {
                case "Alternative" -> Relationship.ALTERNATIVE;
                case "Data" -> Relationship.DATA;
                default -> throw new InvalidRequestException("attachmentRelationship");
            };
        }
        InvoicePresentation presentation = presentation(new Obj(root.raw("presentation"), "presentation"));
        Obj ver = new Obj(root.raw("verification"), "verification");
        VerificationQr qr;
        String baseUrl = ver.string("baseUrl", true, 200);
        String uuid = ver.string("xhubUuid", true, 36);
        ver.done();
        try {
            qr = new VerificationQr(baseUrl, uuid);
        } catch (IllegalArgumentException e) {
            throw new InvalidRequestException("verification");
        }
        ExpectedWords expected = null;
        if (root.has("expectedAmountInWords")) {
            Obj words = new Obj(root.raw("expectedAmountInWords"), "expectedAmountInWords");
            expected = new ExpectedWords(words.string("fr", true, 2000), words.string("ar", true, 2000));
            words.done();
        }
        root.done();
        return new FacturXRequest(xml, relationship, presentation, qr, expected);
    }

    private static InvoicePresentation presentation(Obj p) {
        String typeCode = p.string("typeCode", true, 3);
        if (!TYPES.contains(typeCode)) {
            throw new InvalidRequestException("presentation.typeCode");
        }
        String number = p.string("invoiceNumber", true, 64);
        String issue = p.pattern("issueDate", true, DATE);
        String due = p.pattern("dueDate", false, DATE);
        String currency = p.string("currencyCode", false, 3);
        if (currency != null && !"MAD".equals(currency)) {
            throw new InvalidRequestException("presentation.currencyCode");
        }
        InvoicePresentation.Party supplier = party(new Obj(p.raw("supplier"), "presentation.supplier"));
        InvoicePresentation.Party customer = party(new Obj(p.raw("customer"), "presentation.customer"));
        List<InvoicePresentation.Line> lines = new ArrayList<>();
        List<Object> rawLines = p.list("lines", true, 1, 999);
        for (int i = 0; i < rawLines.size(); i++) {
            lines.add(line(new Obj(rawLines.get(i), "presentation.lines[" + i + "]")));
        }
        List<InvoicePresentation.VatBreakdown> vat = new ArrayList<>();
        List<Object> rawVat = p.list("vatBreakdown", false, 0, 20);
        for (int i = 0; i < rawVat.size(); i++) {
            Obj v = new Obj(rawVat.get(i), "presentation.vatBreakdown[" + i + "]");
            vat.add(new InvoicePresentation.VatBreakdown(v.integer("vatRateBps", true, 0, 10000, 0), v.cents("taxableCents"), v.cents("taxCents")));
            v.done();
        }
        Obj t = new Obj(p.raw("totals"), "presentation.totals");
        InvoicePresentation.Totals totals = new InvoicePresentation.Totals(
                t.cents("lineExtensionCents"), t.cents("taxTotalCents"), t.integer("stampDutyCents", false, 0, MAX_CENTS, 0),
                t.cents("taxExclusiveCents"), t.cents("taxInclusiveCents"), t.integer("retentionCents", false, 0, MAX_CENTS, 0), t.cents("payableCents"));
        t.done();
        List<String> mentionsFr = strings(p, "legalMentionsFr");
        List<String> mentionsAr = strings(p, "legalMentionsAr");
        p.done();
        return new InvoicePresentation(typeCode, number, issue, due, "MAD", supplier, customer, lines, vat, totals, mentionsFr, mentionsAr);
    }

    private static List<String> strings(Obj parent, String key) {
        List<Object> raw = parent.list(key, false, 0, 10);
        List<String> out = new ArrayList<>();
        for (int i = 0; i < raw.size(); i++) {
            if (!(raw.get(i) instanceof String s) || s.isEmpty() || s.length() > 500 || hasForbiddenChar(s)) {
                throw new InvalidRequestException(parent.at(key) + "[" + i + "]");
            }
            out.add(s);
        }
        return out;
    }

    private static InvoicePresentation.Party party(Obj o) {
        String name = o.string("name", true, 200);
        String nameAr = o.string("nameAr", false, 200);
        String ice = o.pattern("ice", false, ICE);
        String identifiantFiscal = o.pattern("identifiantFiscal", false, Pattern.compile("\\d{5,15}"));
        String rc = o.pattern("rc", false, DIGITS_ID);
        String tp = o.pattern("taxeProfessionnelle", false, DIGITS_ID);
        String cnss = o.pattern("cnss", false, DIGITS_ID);
        String legalForm = o.string("legalForm", false, 60);
        Long capital = o.has("shareCapitalCents") ? Long.valueOf(o.integer("shareCapitalCents", true, 0, MAX_CENTS, 0)) : null;
        List<String> address = strings(o, "addressLines");
        if (address.isEmpty() || address.size() > 4) {
            throw new InvalidRequestException(o.at("addressLines"));
        }
        o.done();
        return new InvoicePresentation.Party(name, nameAr, ice, identifiantFiscal, rc, tp, cnss, legalForm, capital, address);
    }

    private static InvoicePresentation.Line line(Obj o) {
        String descriptionFr = o.string("descriptionFr", true, 500);
        String descriptionAr = o.string("descriptionAr", false, 500);
        long quantity = o.integer("quantityMilli", true, -MAX_CENTS, MAX_CENTS, 0);
        String unit = o.string("unitCode", false, 3);
        if (unit != null && !UNIT.matcher(unit).matches()) {
            throw new InvalidRequestException(o.at("unitCode"));
        }
        long unitPrice = o.cents("unitPriceCents");
        long discount = o.integer("discountBps", false, 0, 10000, 0);
        long vat = o.integer("vatRateBps", true, 0, 10000, 0);
        long total = o.integer("lineTotalCents", true, -MAX_CENTS, MAX_CENTS, 0);
        o.done();
        return new InvoicePresentation.Line(descriptionFr, descriptionAr, quantity, unit == null ? "C62" : unit, unitPrice, discount, vat, total);
    }
}
