package ma.fisca.fiscaljava;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertTrue;

import ma.fisca.fiscaljava.facturx.FacturXAssembler;
import org.junit.jupiter.api.Test;

class MustangLibraryTest {

    @Test
    void laBibliothequeMustangprojectSeCharge() {
        assertDoesNotThrow(() -> Class.forName("org.mustangproject.ZUGFeRD.ZUGFeRDExporterFromA3"));
        assertDoesNotThrow(() -> Class.forName("org.mustangproject.Invoice"));
    }

    @Test
    void linterfaceFacturXAssemblerEstDeclaree() {
        assertTrue(FacturXAssembler.class.isInterface());
    }
}
