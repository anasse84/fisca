package ma.fisca.fiscaljava.facturx;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import org.mustangproject.ZUGFeRD.IExportableTransaction;
import org.mustangproject.ZUGFeRD.IXMLProvider;
import org.mustangproject.ZUGFeRD.PDFAConformanceLevel;
import org.mustangproject.ZUGFeRD.Profile;
import org.mustangproject.ZUGFeRD.ZUGFeRDExporterFromA3;

/**
 * Assembleur fondé sur Mustangproject 2.26.0 ({@code ZUGFeRDExporterFromA3}).
 *
 * <p>Comportement réel de Mustang, vérifié par tests : {@code setXML(byte[])} refuse tout XML qui ne contient pas
 * {@code rsm:CrossIndustry} (CII), donc l'UBL 2.1 de Fisca est rejeté par cette voie ; Mustang nomme alors la pièce
 * {@code factur-x.xml} et déclare dans le XMP un profil CII. Pour ne pas déclarer un format que le XML n'est pas, le mode
 * par défaut ({@link EmbeddingMode#UBL_PROVISIONAL}) injecte l'UBL par un fournisseur XML dédié, nomme la pièce
 * {@value #UBL_ATTACHMENT_NAME} et déclare le profil {@value #PROVISIONAL_PROFILE_NAME} dans le XMP.
 * Mustang enregistre sans compression (xref classique). Aucune conformité Factur-X n'est affirmée.
 */
public final class MustangFacturXAssembler implements FacturXAssembler {

    /** Nom de la pièce jointe en mode provisoire (aucun nom normalisé n'existe pour un UBL dans un PDF Factur-X). */
    public static final String UBL_ATTACHMENT_NAME = "ubl-invoice.xml";
    /** Profil XMP déclaré en mode provisoire (valeur de fx:ConformanceLevel). */
    public static final String PROVISIONAL_PROFILE_NAME = "UBL21-PROVISIONAL";
    private static final String DESCRIPTION = "Facture UBL 2.1 (profil provisoire cius-ma-provisional, non publié par la DGI)";

    /** Mode d'embarquement. */
    public enum EmbeddingMode {
        /** Pièce {@value #UBL_NAME}, profil XMP provisoire : n'affirme pas un format Factur-X. */
        UBL_PROVISIONAL,
        /** Nommage par défaut de Mustang ({@code factur-x.xml}, profil EN 16931) : documenté par test, trompeur pour de l'UBL. */
        MUSTANG_DEFAULT_NAMING;

        private static final String UBL_NAME = UBL_ATTACHMENT_NAME;
    }

    /** Relation de la pièce au contenu du PDF (clé /AFRelationship). */
    public enum Relationship {
        ALTERNATIVE("Alternative"),
        DATA("Data");

        private final String pdfName;

        Relationship(String pdfName) {
            this.pdfName = pdfName;
        }

        public String pdfName() {
            return pdfName;
        }
    }

    private final EmbeddingMode mode;
    private final Relationship relationship;

    public MustangFacturXAssembler() {
        this(EmbeddingMode.UBL_PROVISIONAL, Relationship.ALTERNATIVE);
    }

    public MustangFacturXAssembler(EmbeddingMode mode, Relationship relationship) {
        this.mode = mode;
        this.relationship = relationship;
    }

    @Override
    public byte[] assemble(byte[] invoiceXml, byte[] basePdf) {
        try (UblExporter exporter = new UblExporter(mode)) {
            exporter.load(basePdf);
            exporter.setConformanceLevel(PDFAConformanceLevel.BASIC);
            exporter.setCreator("Fisca");
            exporter.setCreatorTool("fiscal-java");
            exporter.setProducer("Fisca fiscal-java");
            exporter.embed(invoiceXml, relationship.pdfName());
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            exporter.export(out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException("Assemblage PDF/A-3b impossible", e);
        }
    }

    /** Exporteur Mustang dont le fournisseur XML et le nom de pièce sont maîtrisés (le XML n'est pas du CII). */
    private static final class UblExporter extends ZUGFeRDExporterFromA3 implements AutoCloseable {

        private final EmbeddingMode mode;

        UblExporter(EmbeddingMode mode) {
            this.mode = mode;
            disableAutoClose(true);
        }

        @Override
        public String getFilenameForVersion(int ver, Profile profile) {
            return mode == EmbeddingMode.UBL_PROVISIONAL ? UBL_ATTACHMENT_NAME : super.getFilenameForVersion(ver, profile);
        }

        void embed(byte[] xml, String afRelationship) throws IOException {
            Profile profile = mode == EmbeddingMode.UBL_PROVISIONAL
                    ? new Profile(PROVISIONAL_PROFILE_NAME, "urn:fisca:ubl21:provisional")
                    : org.mustangproject.ZUGFeRD.Profiles.getByName("EN16931");
            setXMLProvider(new RawXmlProvider(xml, profile));
            prepareDocument();
            PDFAttachGenericFile(doc, getFilenameForVersion(zfVersion, profile), afRelationship, DESCRIPTION, "text/xml", xml);
        }

        @Override
        public void close() throws IOException {
            super.close();
        }
    }

    /** Fournisseur qui rend tel quel le XML déjà produit (aucune génération CII). */
    private static final class RawXmlProvider implements IXMLProvider {

        private final byte[] xml;
        private Profile profile;

        RawXmlProvider(byte[] xml, Profile profile) {
            this.xml = xml;
            this.profile = profile;
        }

        @Override
        public byte[] getXML() {
            return xml;
        }

        @Override
        public void generateXML(IExportableTransaction trans) {
            // Le XML est fourni par l'appelant : rien à générer.
        }

        @Override
        public void setProfile(Profile p) {
            this.profile = p;
        }

        @Override
        public Profile getProfile() {
            return profile;
        }
    }
}
