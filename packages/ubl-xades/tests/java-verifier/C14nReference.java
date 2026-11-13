import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import javax.xml.XMLConstants;
import javax.xml.crypto.Data;
import javax.xml.crypto.OctetStreamData;
import javax.xml.crypto.dom.DOMCryptoContext;
import javax.xml.crypto.NodeSetData;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import org.w3c.dom.NamedNodeMap;
import javax.xml.crypto.dsig.CanonicalizationMethod;
import javax.xml.crypto.dsig.XMLSignatureFactory;
import javax.xml.crypto.dsig.spec.C14NMethodParameterSpec;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

/**
 * Canonisation de RÉFÉRENCE : implémentation du JDK (Apache Santuario, javax.xml.crypto.dsig).
 * Usage : java C14nReference.java <répertoire d'entrée> <répertoire de sortie>
 * Pour chaque *.xml : <nom>.c14n11 (document entier), <nom>.exc (exclusive 1.0), et, si un élément porte Id="sub",
 * <nom>.sub.c14n11 (sous-arbre inclusif). Aucun accès réseau, DOCTYPE refusé.
 */
public class C14nReference {
  /** Ensemble de nœuds XPath du sous-arbre : nœud, attributs (xmlns compris), enfants, dans l'ordre du document. */
  static final class SubTree implements NodeSetData<Node> {
    private final List<Node> nodes = new ArrayList<>();
    SubTree(Node root) { collect(root); }
    private void collect(Node n) {
      nodes.add(n);
      NamedNodeMap attrs = n.getAttributes();
      if (attrs != null) for (int i = 0; i < attrs.getLength(); i++) nodes.add(attrs.item(i));
      for (Node c = n.getFirstChild(); c != null; c = c.getNextSibling()) collect(c);
    }
    public Iterator<Node> iterator() { return nodes.iterator(); }
  }

  static byte[] canon(String algorithm, C14NMethodParameterSpec spec, Node node) throws Exception {
    XMLSignatureFactory fac = XMLSignatureFactory.getInstance("DOM");
    CanonicalizationMethod method = fac.newCanonicalizationMethod(algorithm, spec);
    DOMCryptoContext ctx = new DOMCryptoContext() { };
    Data out = method.transform(new SubTree(node), ctx);
    return ((OctetStreamData) out).getOctetStream().readAllBytes();
  }

  public static void main(String[] args) throws Exception {
    Path inDir = Path.of(args[0]);
    Path outDir = Path.of(args[1]);
    Files.createDirectories(outDir);
    File[] files = inDir.toFile().listFiles((d, n) -> n.endsWith(".xml"));
    java.util.Arrays.sort(files);
    for (File f : files) {
      DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
      dbf.setNamespaceAware(true);
      dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
      dbf.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
      Document doc = dbf.newDocumentBuilder().parse(f);
      String base = f.getName().substring(0, f.getName().length() - 4);
      Files.write(outDir.resolve(base + ".c14n11"), canon(CanonicalizationMethod.INCLUSIVE_11, null, doc));
      Files.write(outDir.resolve(base + ".exc"), canon(CanonicalizationMethod.EXCLUSIVE, null, doc));
      NodeList all = doc.getElementsByTagName("*");
      for (int i = 0; i < all.getLength(); i++) {
        Element e = (Element) all.item(i);
        if ("sub".equals(e.getAttribute("Id"))) {
          Files.write(outDir.resolve(base + ".sub.c14n11"), canon(CanonicalizationMethod.INCLUSIVE_11, null, e));
        }
      }
    }
  }
}
