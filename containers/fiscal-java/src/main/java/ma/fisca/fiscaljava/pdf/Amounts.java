package ma.fisca.fiscaljava.pdf;

/** Formats d'affichage en arithmétique entière : centimes, milli-unités, points de base. */
public final class Amounts {

    private Amounts() {
    }

    /** 123456 centimes -> « 1 234,56 ». */
    public static String cents(long value) {
        long abs = Math.abs(value);
        String whole = Long.toString(abs / 100);
        StringBuilder grouped = new StringBuilder();
        for (int i = 0; i < whole.length(); i++) {
            if (i > 0 && (whole.length() - i) % 3 == 0) {
                grouped.append(' ');
            }
            grouped.append(whole.charAt(i));
        }
        long fraction = abs % 100;
        return (value < 0 ? "-" : "") + grouped + "," + (fraction < 10 ? "0" : "") + fraction;
    }

    /** 2500 milli-unités -> « 2,5 » ; 10000 -> « 10 ». */
    public static String milli(long value) {
        long abs = Math.abs(value);
        String fraction = String.format("%03d", abs % 1000).replaceAll("0+$", "");
        return (value < 0 ? "-" : "") + (abs / 1000) + (fraction.isEmpty() ? "" : "," + fraction);
    }

    /** 2000 points de base -> « 20 % » ; 750 -> « 7,5 % ». */
    public static String bps(long value) {
        String fraction = String.format("%02d", Math.abs(value) % 100).replaceAll("0+$", "");
        return (value < 0 ? "-" : "") + (Math.abs(value) / 100) + (fraction.isEmpty() ? "" : "," + fraction) + " %";
    }
}
