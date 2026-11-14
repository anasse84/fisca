package ma.fisca.fiscaljava.http;

import java.util.List;
import ma.fisca.fiscaljava.validation.ValidationIssue;
import ma.fisca.fiscaljava.validation.ValidationReport;

/** Sérialisation JSON minimale et sans dépendance du rapport de validation. */
final class Json {

    private Json() {
    }

    static String quote(String value) {
        StringBuilder out = new StringBuilder(value.length() + 2).append('"');
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> {
                    if (c < 0x20) {
                        out.append(String.format("\\u%04x", (int) c));
                    } else {
                        out.append(c);
                    }
                }
            }
        }
        return out.append('"').toString();
    }

    static String report(ValidationReport report) {
        StringBuilder out = new StringBuilder(256);
        out.append("{\"valid\":").append(report.valid())
                .append(",\"ruleSet\":").append(quote(report.ruleSet()))
                .append(",\"profile\":").append(quote(report.profile()))
                .append(",\"profileStatus\":").append(quote(report.profileStatus()))
                .append(",\"errorCount\":").append(report.errorCount())
                .append(",\"warningCount\":").append(report.warningCount())
                .append(",\"issues\":[");
        List<ValidationIssue> issues = report.issues();
        for (int i = 0; i < issues.size(); i++) {
            ValidationIssue issue = issues.get(i);
            if (i > 0) {
                out.append(',');
            }
            out.append("{\"rule\":").append(quote(issue.rule()))
                    .append(",\"location\":").append(quote(issue.location()))
                    .append(",\"severity\":").append(quote(issue.severity().name()))
                    .append(",\"message\":").append(quote(issue.message()))
                    .append('}');
        }
        return out.append("]}").toString();
    }

    static String error(String code, String message, String path) {
        if (path == null) {
            return error(code, message);
        }
        return "{\"error\":" + quote(code) + ",\"message\":" + quote(message) + ",\"path\":" + quote(path) + "}";
    }

    static String error(String code, String message) {
        return "{\"error\":" + quote(code) + ",\"message\":" + quote(message) + "}";
    }
}
