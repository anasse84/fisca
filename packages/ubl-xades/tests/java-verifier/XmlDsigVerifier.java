import java.io.ByteArrayInputStream;
import java.io.File;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.Base64;
import java.util.Iterator;
import javax.xml.XMLConstants;
import javax.xml.crypto.dsig.Reference;
import javax.xml.crypto.dsig.XMLSignature;
import javax.xml.crypto.dsig.XMLSignatureFactory;
import javax.xml.crypto.dsig.dom.DOMValidateContext;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/**
 * Vérification INDÉPENDANTE d'une signature XML-DSig/XAdES par le JDK (javax.xml.crypto.dsig, Santuario) :
 * validation DOM avec la clé publique du certificat de KeyInfo, validation sécurisée activée.
 * Usage : java XmlDsigVerifier.java <document.xml>   → code 0 et « VALID » si la signature et toutes les références sont valides.
 */
public class XmlDsigVerifier {
  public static void main(String[] args) throws Exception {
    DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
    dbf.setNamespaceAware(true);
    dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
    dbf.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
    Document doc = dbf.newDocumentBuilder().parse(new File(args[0]));

    // Les attributs Id sont des identifiants pour la résolution des références « #id ».
    NodeList all = doc.getElementsByTagName("*");
    for (int i = 0; i < all.getLength(); i++) {
      Element e = (Element) all.item(i);
      if (e.hasAttribute("Id")) e.setIdAttribute("Id", true);
    }
    NodeList signatures = doc.getElementsByTagNameNS(XMLSignature.XMLNS, "Signature");
    if (signatures.getLength() != 1) { System.out.println("INVALID: " + signatures.getLength() + " signature(s)"); System.exit(2); }
    NodeList certs = doc.getElementsByTagNameNS(XMLSignature.XMLNS, "X509Certificate");
    byte[] der = Base64.getMimeDecoder().decode(certs.item(0).getTextContent().trim());
    X509Certificate cert = (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(new ByteArrayInputStream(der));

    DOMValidateContext ctx = new DOMValidateContext(cert.getPublicKey(), signatures.item(0));
    XMLSignatureFactory fac = XMLSignatureFactory.getInstance("DOM");
    XMLSignature signature = fac.unmarshalXMLSignature(ctx);
    boolean valid = signature.validate(ctx);
    System.out.println("signatureValue=" + signature.getSignatureValue().validate(ctx));
    for (Iterator<?> it = signature.getSignedInfo().getReferences().iterator(); it.hasNext();) {
      Reference r = (Reference) it.next();
      System.out.println("reference[" + r.getURI() + "]=" + r.validate(ctx));
    }
    System.out.println("algorithm=" + cert.getPublicKey().getAlgorithm() + " c14n=" + signature.getSignedInfo().getCanonicalizationMethod().getAlgorithm());
    System.out.println(valid ? "VALID" : "INVALID");
    System.exit(valid ? 0 : 3);
  }
}
