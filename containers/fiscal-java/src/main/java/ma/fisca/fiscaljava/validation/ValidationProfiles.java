package ma.fisca.fiscaljava.validation;

import java.util.Map;

/** Registre des profils nationaux disponibles. */
public final class ValidationProfiles {

    public static final String CIUS_MA_PROVISIONAL = "cius-ma-provisional";

    private static final Map<String, ValidationProfile> PROFILES =
            Map.of(CIUS_MA_PROVISIONAL, new CiusMaProvisionalProfile());

    private ValidationProfiles() {
    }

    /**
     * Point unique de choix du profil.
     *
     * @throws UnknownProfileException si le nom est inconnu
     */
    public static ValidationProfile resolveProfile(String name) {
        ValidationProfile profile = name == null ? null : PROFILES.get(name);
        if (profile == null) {
            throw new UnknownProfileException(String.valueOf(name));
        }
        return profile;
    }
}
