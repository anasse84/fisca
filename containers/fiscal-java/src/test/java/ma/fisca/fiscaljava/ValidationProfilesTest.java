package ma.fisca.fiscaljava;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import ma.fisca.fiscaljava.validation.UnknownProfileException;
import ma.fisca.fiscaljava.validation.ValidationProfile;
import ma.fisca.fiscaljava.validation.ValidationProfiles;
import org.junit.jupiter.api.Test;

class ValidationProfilesTest {

    @Test
    void resolveProfileRetourneLeProfilProvisoire() {
        ValidationProfile profile = ValidationProfiles.resolveProfile("cius-ma-provisional");
        assertEquals("cius-ma-provisional", profile.name());
    }

    @Test
    void profilInconnuEstRefuse() {
        assertThrows(UnknownProfileException.class, () -> ValidationProfiles.resolveProfile("inexistant"));
    }
}
