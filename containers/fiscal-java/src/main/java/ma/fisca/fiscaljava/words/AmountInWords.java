package ma.fisca.fiscaljava.words;

import java.util.Map;

/** Arrêté bilingue déterministe (centimes entiers, long) : texte du montant et phrase complète par type de document UBL. */
public final class AmountInWords {

    /** Plafond technique en centimes (999 999 999 999,99 MAD). */
    public static final long MAX_CENTS = AmountWordsSupport.MAX_CENTS;

    private static final Map<String, String> PREFIX_FR = Map.of(
            "380", "Arrêtée la présente facture à la somme de : ",
            "381", "Arrêté le présent avoir à la somme de : ",
            "383", "Arrêtée la présente note de débit à la somme de : ",
            "386", "Arrêtée la présente facture d’acompte à la somme de : ",
            "389", "Arrêtée la présente autofacture à la somme de : ");

    private static final Map<String, String> PREFIX_AR = Map.of(
            "380", "أوقفت هذه الفاتورة عند مبلغ: ",
            "381", "أوقف هذا الإشعار الدائن عند مبلغ: ",
            "383", "أوقف هذا الإشعار المدين عند مبلغ: ",
            "386", "أوقفت فاتورة الدفعة المقدمة هذه عند مبلغ: ",
            "389", "أوقفت هذه الفاتورة الذاتية عند مبلغ: ");

    private AmountInWords() {
    }

    public static String fr(long totalCents) {
        return FrenchAmountInWords.of(totalCents);
    }

    public static String ar(long totalCents) {
        return ArabicAmountInWords.of(totalCents);
    }

    /** Phrase d'arrêté française complète ; type inconnu : IllegalArgumentException. */
    public static String arreteFr(String typeCode, long totalCents) {
        return prefix(PREFIX_FR, typeCode) + fr(totalCents);
    }

    public static String arreteAr(String typeCode, long totalCents) {
        return prefix(PREFIX_AR, typeCode) + ar(totalCents);
    }

    private static String prefix(Map<String, String> table, String typeCode) {
        String value = table.get(typeCode);
        if (value == null) {
            throw new IllegalArgumentException("Type de document inconnu");
        }
        return value;
    }
}
