package ma.fisca.fiscaljava;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import ma.fisca.fiscaljava.facturx.MustangFacturXAssembler;
import ma.fisca.fiscaljava.facturx.MustangFacturXAssembler.EmbeddingMode;
import ma.fisca.fiscaljava.facturx.MustangFacturXAssembler.Relationship;
import ma.fisca.fiscaljava.pdf.PresentationPdfBuilder;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.cos.COSArray;
import org.apache.pdfbox.cos.COSDictionary;
import org.apache.pdfbox.cos.COSName;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.common.filespecification.PDComplexFileSpecification;
import org.apache.pdfbox.pdmodel.common.filespecification.PDEmbeddedFile;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.PDPage;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.mustangproject.ZUGFeRD.ZUGFeRDExporterFromA3;

/**
 * Comportement RÉEL de Mustangproject 2.26.0 avec un XML UBL 2.1 et validation PDF/A-3b par veraPDF.
 * Statut documenté : « PDF/A-3b avec facture UBL embarquée, profil provisoire » ; jamais « Factur-X conforme ».
 */
class FacturXAssemblerTest {

    private static byte[] xml;
    private static byte[] basePdf;
    private static byte[] assembled;

    @BeforeAll
    static void build() throws IOException {
        xml = Fixtures.load("invoice-valid-380.xml");
        basePdf = new PresentationPdfBuilder().build(PresentationFixtures.simple(), PresentationFixtures.qr());
        assembled = new MustangFacturXAssembler().assemble(xml, basePdf);
        Path out = Path.of("target", "pdf-samples");
        Files.createDirectories(out);
        Files.write(out.resolve("invoice-pdfa3b-ubl.pdf"), assembled);
    }

    private static String xmpOf(PDDocument doc) throws IOException {
        return new String(doc.getDocumentCatalog().getMetadata().toByteArray(), StandardCharsets.UTF_8);
    }

    @Test
    void veraPdfValideLePdfAssembleEnPdfA3b() {
        PdfaValidator.Outcome outcome = PdfaValidator.validate(assembled);
        assertEquals("3b", outcome.flavour());
        assertEquals(List.of(), outcome.violations(), "violations PDF/A-3b rapportées par veraPDF");
        assertTrue(outcome.compliant());
    }

    @Test
    void veraPdfRefuseLePdfDeBaseNonEnrichi() {
        // Contrôle négatif : sans XMP PDF/A, sans profil colorimétrique, le PDF de présentation seul n'est pas PDF/A-3b.
        PdfaValidator.Outcome outcome = PdfaValidator.validate(basePdf);
        assertFalse(outcome.compliant());
        assertFalse(outcome.violations().isEmpty());
    }

    @Test
    void laPieceJointeUblEstEmbarqueeAvecSaRelationEtSonNom() throws Exception {
        try (PDDocument doc = Loader.loadPDF(assembled)) {
            Map<String, PDComplexFileSpecification> files = doc.getDocumentCatalog().getNames().getEmbeddedFiles().getNames();
            assertEquals(1, files.size());
            PDComplexFileSpecification spec = files.get(MustangFacturXAssembler.UBL_ATTACHMENT_NAME);
            assertNotNull(spec, "pièce attendue : " + MustangFacturXAssembler.UBL_ATTACHMENT_NAME + ", trouvées : " + files.keySet());
            assertEquals("Alternative", spec.getCOSObject().getNameAsString("AFRelationship"));
            PDEmbeddedFile embedded = spec.getEmbeddedFile();
            assertEquals("text/xml", embedded.getSubtype());
            assertTrue(Arrays.equals(xml, embedded.toByteArray()), "le XML embarqué est identique octet pour octet");
            COSArray af = doc.getDocumentCatalog().getCOSObject().getCOSArray(COSName.getPDFName("AF"));
            assertNotNull(af);
            assertEquals(1, af.size());
        }
    }

    @Test
    void leXmpDeclareLeProfilProvisoireEtPasUnProfilFacturXCii() throws Exception {
        try (PDDocument doc = Loader.loadPDF(assembled)) {
            String xmp = xmpOf(doc);
            assertTrue(xmp.contains("<pdfaid:part>3</pdfaid:part>"), xmp);
            assertTrue(xmp.contains("<pdfaid:conformance>B</pdfaid:conformance>"), xmp);
            assertTrue(xmp.contains("<fx:DocumentFileName>ubl-invoice.xml</fx:DocumentFileName>"), xmp);
            assertTrue(xmp.contains("<fx:DocumentType>INVOICE</fx:DocumentType>"), xmp);
            assertTrue(xmp.contains("<fx:Version>1.0</fx:Version>"), xmp);
            assertTrue(xmp.contains("<fx:ConformanceLevel>UBL21-PROVISIONAL</fx:ConformanceLevel>"), xmp);
            assertFalse(xmp.contains("EN 16931"), "aucun profil CII/EN 16931 déclaré");
            assertFalse(xmp.contains("factur-x.xml"));
            assertTrue(xmp.contains("urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"), "espace de noms fx de Mustang (écart avec le standard, voir FACTURX-NOTES.md)");
        }
    }

    @Test
    void mustangRefuseNativementUnXmlUblCarIlExigeDuCii() {
        RuntimeException refused = assertThrows(RuntimeException.class, () -> {
            try (ZUGFeRDExporterFromA3 exporter = new ZUGFeRDExporterFromA3()) {
                exporter.load(basePdf);
                exporter.setXML(xml);
            }
        });
        assertTrue(refused.getMessage().contains("rsm:CrossIndustry"), refused.getMessage());
    }

    @Test
    void lenommageParDefautDeMustangDeclareFacturXEn16931PourDuUblCeQuiEstTrompeur() throws Exception {
        byte[] naive = new MustangFacturXAssembler(EmbeddingMode.MUSTANG_DEFAULT_NAMING, Relationship.ALTERNATIVE).assemble(xml, basePdf);
        try (PDDocument doc = Loader.loadPDF(naive)) {
            String xmp = xmpOf(doc);
            assertTrue(xmp.contains("<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>"), xmp);
            assertTrue(xmp.contains("<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>"), xmp);
            assertTrue(doc.getDocumentCatalog().getNames().getEmbeddedFiles().getNames().containsKey("factur-x.xml"));
        }
        // Le même PDF reste valide PDF/A-3b : la validité PDF/A ne dit rien de la nature (UBL ou CII) de la pièce.
        assertTrue(PdfaValidator.validate(naive).compliant());
    }

    @Test
    void laRelationDataEstSupportee() throws Exception {
        byte[] data = new MustangFacturXAssembler(EmbeddingMode.UBL_PROVISIONAL, Relationship.DATA).assemble(xml, basePdf);
        try (PDDocument doc = Loader.loadPDF(data)) {
            PDComplexFileSpecification spec = doc.getDocumentCatalog().getNames().getEmbeddedFiles().getNames().get(MustangFacturXAssembler.UBL_ATTACHMENT_NAME);
            assertEquals("Data", spec.getCOSObject().getNameAsString("AFRelationship"));
        }
        assertTrue(PdfaValidator.validate(data).compliant());
    }

    @Test
    void lesPolicesRestentIntegreesApresAssemblage() throws Exception {
        try (PDDocument doc = Loader.loadPDF(assembled)) {
            PDPage page = doc.getPage(0);
            int count = 0;
            for (COSName name : page.getResources().getFontNames()) {
                PDFont font = page.getResources().getFont(name);
                assertTrue(font.isEmbedded(), font.getName());
                count++;
            }
            assertTrue(count >= 2);
        }
    }

    @Test
    void lePdfAssembleUtiliseUneTableXrefClassiqueEtAucunFluxDObjets() throws Exception {
        String raw = new String(assembled, StandardCharsets.ISO_8859_1);
        assertTrue(raw.contains("\nxref\n") || raw.contains("\r\nxref\r\n") || raw.contains("xref\n0 "), "table xref classique attendue");
        assertFalse(raw.contains("/Type /XRef") || raw.contains("/Type/XRef"), "pas de flux xref");
        assertFalse(raw.contains("/Type /ObjStm") || raw.contains("/Type/ObjStm"), "pas de flux d'objets");
    }

    @Test
    void unPdfDeBaseCompresseDonneUnTrailerEnFluxXrefMelangeAUneTableClassique() throws Exception {
        // Comportement observé de Mustang 2.26.0 / PDFBox 3.0.8 : sur une entrée à flux xref, la sortie « sans compression »
        // porte une table xref classique ET un trailer qui garde /Type /XRef, /W, /Index, /Filter : valide pour veraPDF,
        // mais hybride. D'où le PDF de base écrit sans compression par PresentationPdfBuilder.
        byte[] compressed;
        try (PDDocument doc = Loader.loadPDF(basePdf); java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream()) {
            doc.save(out);
            compressed = out.toByteArray();
        }
        assertTrue(new String(compressed, StandardCharsets.ISO_8859_1).contains("/Type /XRef"), "le PDF recompressé a un flux xref");
        byte[] hybrid = new MustangFacturXAssembler().assemble(xml, compressed);
        String raw = new String(hybrid, StandardCharsets.ISO_8859_1);
        assertTrue(raw.contains("\nxref\n") && raw.contains("/Type /XRef"), "table classique et trailer /Type /XRef mêlés");
        assertTrue(PdfaValidator.validate(hybrid).compliant());
    }

    @Test
    void lePdfAssembleSeRelitEtGardeLaMiseEnPageEtLeDocumentCatalog() throws Exception {
        try (PDDocument doc = Loader.loadPDF(new ByteArrayInputStream(assembled).readAllBytes())) {
            assertEquals(1, doc.getNumberOfPages());
            COSDictionary catalog = doc.getDocumentCatalog().getCOSObject();
            assertNotNull(catalog.getDictionaryObject(COSName.getPDFName("OutputIntents")));
        }
    }
}
