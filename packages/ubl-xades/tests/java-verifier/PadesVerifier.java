import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.Security;
import java.security.cert.X509Certificate;
import java.util.Arrays;
import java.util.Collection;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.bouncycastle.asn1.ASN1Encodable;
import org.bouncycastle.asn1.ASN1ObjectIdentifier;
import org.bouncycastle.asn1.cms.Attribute;
import org.bouncycastle.asn1.cms.AttributeTable;
import org.bouncycastle.asn1.cms.CMSAttributes;
import org.bouncycastle.asn1.cms.ContentInfo;
import org.bouncycastle.asn1.ess.ESSCertIDv2;
import org.bouncycastle.asn1.ess.SigningCertificateV2;
import org.bouncycastle.asn1.pkcs.PKCSObjectIdentifiers;
import org.bouncycastle.cert.X509CertificateHolder;
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter;
import org.bouncycastle.cms.CMSProcessableByteArray;
import org.bouncycastle.cms.CMSSignedData;
import org.bouncycastle.cms.SignerInformation;
import org.bouncycastle.cms.jcajce.JcaSimpleSignerInfoVerifierBuilder;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.bouncycastle.tsp.TimeStampToken;
import org.bouncycastle.util.Store;

/**
 * Vérification INDÉPENDANTE (BouncyCastle bcpkix) d'une signature PAdES-Baseline-T :
 *  - /ByteRange couvre tout le fichier sauf /Contents ; CMS détaché vérifié sur les plages signées ;
 *  - attributs signés : contentType, messageDigest, signingTime, ESS signing-certificate-v2 (condensé du certificat) ;
 *  - attribut non signé id-aa-timeStampToken : empreinte == SHA-256 de la valeur de signature, signature de la TSA de test vérifiée.
 * Usage : java -cp <classpath bcpkix> PadesVerifier.java <fichier.pdf>   → code 0 et « PADES_VALID » si tout est correct.
 */
public class PadesVerifier {
  static void check(boolean condition, String message) {
    if (!condition) { System.out.println("PADES_INVALID: " + message); System.exit(3); }
  }

  public static void main(String[] args) {
    try {
      run(args);
    } catch (Exception e) {
      System.out.println("PADES_INVALID: " + e.getClass().getSimpleName());
      System.exit(3);
    }
  }

  static void run(String[] args) throws Exception {
    Security.addProvider(new BouncyCastleProvider());
    byte[] pdf = Files.readAllBytes(Path.of(args[0]));
    String text = new String(pdf, StandardCharsets.ISO_8859_1);
    Matcher m = Pattern.compile("/ByteRange\\s*\\[\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*\\]").matcher(text);
    check(m.find(), "ByteRange absent");
    int[] br = { Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)), Integer.parseInt(m.group(4)) };
    check(br[0] == 0 && br[2] + br[3] == pdf.length, "ByteRange ne couvre pas le fichier");
    check(text.charAt(br[1]) == '<' && text.charAt(br[2] - 1) == '>', "Contents mal délimité");
    String hex = text.substring(br[1] + 1, br[2] - 1);
    byte[] contents = new byte[hex.length() / 2];
    for (int i = 0; i < contents.length; i++) contents[i] = (byte) Integer.parseInt(hex.substring(2 * i, 2 * i + 2), 16);
    // Longueur DER exacte (le reste est le remplissage à zéro de la réserve).
    int lenByte = contents[1] & 0xff;
    int total = lenByte < 0x80 ? 2 + lenByte : 2 + (lenByte & 0x7f) + new java.math.BigInteger(1, Arrays.copyOfRange(contents, 2, 2 + (lenByte & 0x7f))).intValue();
    byte[] cms = Arrays.copyOf(contents, total);
    byte[] signed = new byte[br[1] + br[3]];
    System.arraycopy(pdf, 0, signed, 0, br[1]);
    System.arraycopy(pdf, br[2], signed, br[1], br[3]);

    CMSSignedData sd = new CMSSignedData(new CMSProcessableByteArray(signed), cms);
    check(sd.getSignerInfos().size() == 1, "un signataire attendu");
    SignerInformation si = sd.getSignerInfos().getSigners().iterator().next();
    @SuppressWarnings("unchecked") Store<X509CertificateHolder> certs = sd.getCertificates();
    @SuppressWarnings("unchecked") Collection<X509CertificateHolder> matches = certs.getMatches(si.getSID());
    check(matches.size() == 1, "certificat du signataire absent du CMS");
    X509CertificateHolder holder = matches.iterator().next();
    X509Certificate cert = new JcaX509CertificateConverter().setProvider("BC").getCertificate(holder);
    check(si.verify(new JcaSimpleSignerInfoVerifierBuilder().setProvider("BC").build(cert)), "signature CMS invalide");

    AttributeTable signedAttrs = si.getSignedAttributes();
    check(signedAttrs.get(CMSAttributes.contentType) != null, "attribut contentType absent");
    check(signedAttrs.get(CMSAttributes.messageDigest) != null, "attribut messageDigest absent");
    check(signedAttrs.get(CMSAttributes.signingTime) != null, "attribut signingTime absent");
    Attribute ess = signedAttrs.get(PKCSObjectIdentifiers.id_aa_signingCertificateV2);
    check(ess != null, "ESS signing-certificate-v2 absent");
    SigningCertificateV2 scv2 = SigningCertificateV2.getInstance(ess.getAttrValues().getObjectAt(0));
    ESSCertIDv2 id = scv2.getCerts()[0];
    check(Arrays.equals(id.getCertHash(), MessageDigest.getInstance("SHA-256").digest(cert.getEncoded())), "condensé ESS ≠ certificat");

    Attribute stamp = si.getUnsignedAttributes() == null ? null : si.getUnsignedAttributes().get(PKCSObjectIdentifiers.id_aa_signatureTimeStampToken);
    check(stamp != null, "attribut non signé id-aa-timeStampToken absent (PAdES-T)");
    ASN1Encodable tokenAsn1 = stamp.getAttrValues().getObjectAt(0);
    TimeStampToken token = new TimeStampToken(ContentInfo.getInstance(tokenAsn1));
    byte[] expectedImprint = MessageDigest.getInstance("SHA-256").digest(si.getSignature());
    check(Arrays.equals(token.getTimeStampInfo().getMessageImprintDigest(), expectedImprint), "empreinte du jeton ≠ SHA-256(signature)");
    @SuppressWarnings("unchecked") Collection<X509CertificateHolder> tsaMatches = token.getCertificates().getMatches(token.getSID());
    check(tsaMatches.size() == 1, "certificat TSA absent du jeton");
    X509Certificate tsaCert = new JcaX509CertificateConverter().setProvider("BC").getCertificate(tsaMatches.iterator().next());
    token.validate(new JcaSimpleSignerInfoVerifierBuilder().setProvider("BC").build(tsaCert));

    System.out.println("signer=" + cert.getSigAlgName() + " keyAlg=" + cert.getPublicKey().getAlgorithm() + " cmsBytes=" + cms.length);
    System.out.println("timestamp.genTime=" + token.getTimeStampInfo().getGenTime().toInstant());
    System.out.println("PADES_VALID");
  }
}
