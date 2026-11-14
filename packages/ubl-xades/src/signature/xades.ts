import { bytesEqual, fromBase64, sha256, toBase64, toHex } from './bytes.ts';
import { C14N11_ALGORITHM, canonicalizeTree, EXC_C14N_ALGORITHM, type C14nOptions } from './c14n.ts';
import { distinguishedNameRfc2253, importCertificatePublicKey, issuerSerialV2Base64, parseCertificate, type ParsedCertificate } from './certificate.ts';
import { UblSignatureError, type UblSignatureErrorCode } from './errors.ts';
import { parseTimeStampToken } from './timestamp.ts';
import type { DigestSigner, SignatureAlgorithm, TimestampProvider } from './types.ts';
import {
  attributeValue,
  childElements,
  descendantElements,
  parseXml,
  textContent,
  type XmlDocument,
  type XmlElement,
} from './xml-parser.ts';
import { escapeXml } from '../generator/xml.ts';

/**
 * Enveloppe XAdES-Baseline-T (XML-DSig enveloped) injectée dans UBLExtensions/UBLExtension/ExtensionContent d'une facture UBL 2.1.
 * PROFIL PROVISOIRE (ERRATA B-13) : aucune spécification DGI/xHub publiée ; jamais « qualifiée » sans HSM Barid eSign réel.
 * Aucune clé privée ici : la signature vient de `DigestSigner`, le jeton RFC 3161 de `TimestampProvider`.
 */

export const NS_DS = 'http://www.w3.org/2000/09/xmldsig#';
export const NS_XADES = 'http://uri.etsi.org/01903/v1.3.2#';
export const NS_UBL_EXT = 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2';
const NS_UBL_PREFIX = 'urn:oasis:names:specification:ubl:schema:xsd:';
const SIGNED_PROPERTIES_TYPE = 'http://uri.etsi.org/01903#SignedProperties';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const SHA256_URI = 'http://www.w3.org/2001/04/xmlenc#sha256';
const SIGNATURE_METHODS: Readonly<Record<SignatureAlgorithm, string>> = {
  ECDSA_P256_SHA256: 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256',
  RSA_PKCS1_SHA256: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
};
const UBL_ROOTS = new Set(['Invoice', 'CreditNote', 'DebitNote']);

export interface SignaturePolicyHypothesis {
  /** Identifiant de politique (URI ou OID) : HYPOTHÈSE, aucune politique de signature marocaine n'est publiée. */
  readonly identifier: string;
  readonly digestSha256: Uint8Array;
}

export interface SignUblXadesOptions {
  readonly certificateDer: Uint8Array;
  readonly signer: DigestSigner;
  readonly timestampProvider: TimestampProvider;
  /** Heure de signature (défaut : maintenant). */
  readonly signingTime?: Date;
  readonly signaturePolicy?: SignaturePolicyHypothesis;
  /**
   * Élément de référence du certificat signataire. Défaut « SigningCertificate » (XAdES 1.3.2 avec condensé SHA-256 et ds:X509IssuerSerial) :
   * seul accepté par les XSD OASIS UBL 2.1 vendorisés (UBL-XAdESv132-2.1.xsd ne définit pas SigningCertificateV2).
   * « SigningCertificateV2 » (EN 319 132-1, IssuerSerialV2) est correct pour XML-DSig mais REFUSÉ par ces XSD (xmllint).
   */
  readonly signingCertificateElement?: 'SigningCertificate' | 'SigningCertificateV2';
  /**
   * Numéro de série de certificat de plus de `XMLLINT_MAX_SERIAL_DIGITS` chiffres décimaux avec « SigningCertificate » :
   * refusé par défaut (échec fermé UBL_SIGNATURE_SERIAL_UNSUPPORTED), car xmllint (libxml2) refuse alors le XML au XSD alors
   * que `xs:integer` est non borné. `true` : émet quand même le XML (valide pour un validateur sans cette limite, non validé par xmllint).
   */
  readonly allowLongSerialNumber?: boolean;
}

/**
 * Nombre maximal de chiffres décimaux de `ds:X509SerialNumber` (`xs:integer`) accepté par xmllint (libxml2 2.10.x, mesuré :
 * 24 chiffres valides, 25 refusés). Limite de l'outil de validation, pas du schéma XSD OASIS.
 */
export const XMLLINT_MAX_SERIAL_DIGITS = 24;

export interface SignedUblXades {
  readonly xml: string;
  readonly signatureId: string;
  readonly signatureAlgorithm: SignatureAlgorithm;
  readonly timestampGenTime: Date;
}

const refusal = (code: UblSignatureErrorCode, message: string): UblSignatureError => new UblSignatureError(code, message);

const isElement = (element: XmlElement, ns: string, local: string): boolean => element.ns === ns && element.local === local;

function childOf(parent: XmlElement, ns: string, local: string): XmlElement | undefined {
  return childElements(parent).find((child) => isElement(child, ns, local));
}

function isoSeconds(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

function digestMethodXml(): string {
  return `<ds:DigestMethod Algorithm="${SHA256_URI}"/>`;
}

function dsAlgorithmElement(name: string, algorithm: string): string {
  return `<ds:${name} Algorithm="${algorithm}"/>`;
}

/** Canonisation d'un sous-arbre selon l'algorithme déclaré (c14n11 ou exclusive), pour la vérification et la signature. */
function canonOptionsFor(algorithmUri: string, extra: Omit<C14nOptions, 'algorithm'> = {}): C14nOptions {
  if (algorithmUri === C14N11_ALGORITHM) return { ...extra, algorithm: 'c14n11' };
  if (algorithmUri === EXC_C14N_ALGORITHM) return { ...extra, algorithm: 'exc-c14n' };
  throw refusal('XADES_ALGORITHM_REFUSED', 'Algorithme de canonisation refusé.');
}

function findByPath(root: XmlElement, path: readonly (readonly [string, string])[]): XmlElement | undefined {
  let current: XmlElement | undefined = root;
  for (const [ns, local] of path) {
    if (current === undefined) return undefined;
    current = childOf(current, ns, local);
  }
  return current;
}

interface InsertionPlan {
  readonly prefix: string;
  readonly suffix: string;
  readonly extPrefix: string;
  /** Texte inséré autour du contenu de l'ExtensionContent : [avant, après]. */
  readonly wrap: readonly [string, string];
}

/** Choisit où insérer UBLExtensions (premier enfant obligatoire, XSD OASIS) ou la nouvelle UBLExtension dans une UBLExtensions existante. */
function planInsertion(document: XmlDocument): InsertionPlan {
  const root = document.root;
  if (!root.ns.startsWith(NS_UBL_PREFIX) || !UBL_ROOTS.has(root.local) || root.selfClosing) {
    throw refusal('XML_NOT_UBL_DOCUMENT', 'Document UBL 2.1 (Invoice, CreditNote ou DebitNote) attendu.');
  }
  const source = document.source;
  const existing = childOf(root, NS_UBL_EXT, 'UBLExtensions');
  if (existing !== undefined) {
    if (existing.selfClosing) throw refusal('XML_NOT_UBL_DOCUMENT', 'UBLExtensions vide non supporté.');
    const extPrefix = existing.prefix === '' ? '' : `${existing.prefix}:`;
    const cut = existing.contentEnd;
    return {
      prefix: source.slice(0, cut),
      suffix: source.slice(cut),
      extPrefix,
      wrap: [`<${extPrefix}UBLExtension><${extPrefix}ExtensionContent>`, `</${extPrefix}ExtensionContent></${extPrefix}UBLExtension>`],
    };
  }
  const first = childElements(root)[0];
  if (first === undefined) throw refusal('XML_NOT_UBL_DOCUMENT', 'Document UBL vide.');
  // Préfixe déjà lié à l'espace d'extensions dans la portée de la racine ?
  let boundPrefix: string | undefined;
  for (const [prefix, uri] of root.nsDecls) if (uri === NS_UBL_EXT && prefix !== '') boundPrefix = prefix;
  const taken = new Set(root.nsDecls.keys());
  const declared = boundPrefix !== undefined;
  const chosen = boundPrefix ?? ['ext', 'ubl-ext', 'fisca-ext'].find((candidate) => !taken.has(candidate)) ?? 'fisca-ext';
  const declaration = declared ? '' : ` xmlns:${chosen}="${NS_UBL_EXT}"`;
  const cut = first.start;
  return {
    prefix: source.slice(0, cut),
    suffix: source.slice(cut),
    extPrefix: `${chosen}:`,
    wrap: [
      `<${chosen}:UBLExtensions${declaration}><${chosen}:UBLExtension><${chosen}:ExtensionContent>`,
      `</${chosen}:ExtensionContent></${chosen}:UBLExtension></${chosen}:UBLExtensions>`,
    ],
  };
}

function signedPropertiesXml(input: {
  readonly signatureId: string;
  readonly signedPropertiesId: string;
  readonly signingTime: Date;
  readonly certificate: ParsedCertificate;
  readonly certDigest: Uint8Array;
  readonly policy: SignaturePolicyHypothesis | undefined;
  readonly certificateElement: 'SigningCertificate' | 'SigningCertificateV2';
}): string {
  const certificateReference =
    input.certificateElement === 'SigningCertificateV2'
      ? `<xades:SigningCertificateV2><xades:Cert><xades:CertDigest>${digestMethodXml()}<ds:DigestValue>${toBase64(input.certDigest)}</ds:DigestValue></xades:CertDigest>` +
        `<xades:IssuerSerialV2>${issuerSerialV2Base64(input.certificate)}</xades:IssuerSerialV2></xades:Cert></xades:SigningCertificateV2>`
      : `<xades:SigningCertificate><xades:Cert><xades:CertDigest>${digestMethodXml()}<ds:DigestValue>${toBase64(input.certDigest)}</ds:DigestValue></xades:CertDigest>` +
        `<xades:IssuerSerial><ds:X509IssuerName>${escapeXml(distinguishedNameRfc2253(input.certificate.issuerDer))}</ds:X509IssuerName><ds:X509SerialNumber>${input.certificate.serialNumber.toString()}</ds:X509SerialNumber></xades:IssuerSerial></xades:Cert></xades:SigningCertificate>`;
  const policy =
    input.policy === undefined
      ? ''
      : `<xades:SignaturePolicyIdentifier><xades:SignaturePolicyId><xades:SigPolicyId><xades:Identifier>${escapeXml(input.policy.identifier)}</xades:Identifier></xades:SigPolicyId><xades:SigPolicyHash>${digestMethodXml()}<ds:DigestValue>${toBase64(input.policy.digestSha256)}</ds:DigestValue></xades:SigPolicyHash></xades:SignaturePolicyId></xades:SignaturePolicyIdentifier>`;
  return (
    `<xades:SignedProperties Id="${input.signedPropertiesId}"><xades:SignedSignatureProperties>` +
    `<xades:SigningTime>${isoSeconds(input.signingTime)}</xades:SigningTime>` +
    certificateReference +
    `${policy}</xades:SignedSignatureProperties></xades:SignedProperties>`
  );
}

interface SignatureXmlInput {
  readonly signatureId: string;
  readonly signatureMethod: string;
  readonly documentDigest: Uint8Array;
  readonly signedPropertiesDigest: Uint8Array;
  readonly signedPropertiesId: string;
  readonly signedPropertiesXml: string;
  readonly signatureValue: Uint8Array;
  readonly certificateDer: Uint8Array;
  readonly timestampToken: Uint8Array | undefined;
}

function signatureXml(input: SignatureXmlInput): string {
  const transformsDocument = `<ds:Transforms>${dsAlgorithmElement('Transform', ENVELOPED)}${dsAlgorithmElement('Transform', C14N11_ALGORITHM)}</ds:Transforms>`;
  const transformsProperties = `<ds:Transforms>${dsAlgorithmElement('Transform', C14N11_ALGORITHM)}</ds:Transforms>`;
  const signedInfo =
    `<ds:SignedInfo>${dsAlgorithmElement('CanonicalizationMethod', C14N11_ALGORITHM)}${dsAlgorithmElement('SignatureMethod', input.signatureMethod)}` +
    `<ds:Reference Id="${input.signatureId}-ref-doc" URI="">${transformsDocument}${digestMethodXml()}<ds:DigestValue>${toBase64(input.documentDigest)}</ds:DigestValue></ds:Reference>` +
    `<ds:Reference Id="${input.signatureId}-ref-sp" Type="${SIGNED_PROPERTIES_TYPE}" URI="#${input.signedPropertiesId}">${transformsProperties}${digestMethodXml()}<ds:DigestValue>${toBase64(input.signedPropertiesDigest)}</ds:DigestValue></ds:Reference>` +
    `</ds:SignedInfo>`;
  const unsigned =
    input.timestampToken === undefined
      ? ''
      : `<xades:UnsignedProperties><xades:UnsignedSignatureProperties><xades:SignatureTimeStamp>${dsAlgorithmElement('CanonicalizationMethod', C14N11_ALGORITHM)}<xades:EncapsulatedTimeStamp>${toBase64(input.timestampToken)}</xades:EncapsulatedTimeStamp></xades:SignatureTimeStamp></xades:UnsignedSignatureProperties></xades:UnsignedProperties>`;
  return (
    `<ds:Signature xmlns:ds="${NS_DS}" Id="${input.signatureId}">${signedInfo}` +
    `<ds:SignatureValue Id="${input.signatureId}-value">${toBase64(input.signatureValue)}</ds:SignatureValue>` +
    `<ds:KeyInfo><ds:X509Data><ds:X509Certificate>${toBase64(input.certificateDer)}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>` +
    `<ds:Object><xades:QualifyingProperties xmlns:xades="${NS_XADES}" Target="#${input.signatureId}">${input.signedPropertiesXml}${unsigned}</xades:QualifyingProperties></ds:Object></ds:Signature>`
  );
}

function locate(document: XmlDocument, predicate: (element: XmlElement) => boolean): XmlElement {
  for (const element of descendantElements(document.root)) if (predicate(element)) return element;
  throw refusal('XADES_STRUCTURE_INVALID', 'Structure XAdES attendue absente.');
}

async function digestOf(bytes: Uint8Array): Promise<Uint8Array> {
  return sha256(bytes);
}

/**
 * Signe une facture UBL 2.1 (texte XML UTF-8) : retourne le XML avec `ds:Signature` (XAdES-BASELINE-T) dans
 * UBLExtensions/UBLExtension/ExtensionContent, placée avant cbc:UBLVersionID (XSD OASIS). Les fins de ligne CRLF/CR du document
 * sont normalisées en LF (XML 1.0 § 2.11), sans effet sur la canonisation.
 */
export async function signUblXades(xml: string, options: SignUblXadesOptions): Promise<SignedUblXades> {
  const document = parseXml(xml);
  for (const element of descendantElements(document.root)) {
    if (isElement(element, NS_DS, 'Signature')) throw refusal('XML_ALREADY_SIGNED', 'Le document porte déjà une signature.');
  }
  const certificate = parseCertificate(options.certificateDer);
  const algorithm = certificate.algorithm;
  if (
    (options.signingCertificateElement ?? 'SigningCertificate') === 'SigningCertificate' &&
    options.allowLongSerialNumber !== true &&
    certificate.serialNumber.toString().length > XMLLINT_MAX_SERIAL_DIGITS
  ) {
    throw refusal(
      'UBL_SIGNATURE_SERIAL_UNSUPPORTED',
      `Numéro de série du certificat de plus de ${XMLLINT_MAX_SERIAL_DIGITS} chiffres décimaux : refusé par xmllint dans xades:SigningCertificate (option allowLongSerialNumber pour passer outre).`,
    );
  }
  const plan = planInsertion(document);
  const assemble = (signature: string): string => `${plan.prefix}${plan.wrap[0]}${signature}${plan.wrap[1]}${plan.suffix}`;

  // 1. Condensé du document (transformation enveloped-signature : le document avec l'ExtensionContent vide, puis c14n11).
  const skeleton = parseXml(assemble(''));
  const documentDigest = await digestOf(canonicalizeTree(skeleton, { algorithm: 'c14n11' }));
  const signatureId = `xmldsig-${toHex(documentDigest.subarray(0, 8))}`;
  const signedPropertiesId = `${signatureId}-signedprops`;
  const signingTime = options.signingTime ?? new Date();
  const certDigest = await sha256(certificate.der);
  const properties = signedPropertiesXml({ signatureId, signedPropertiesId, signingTime, certificate, certDigest, policy: options.signaturePolicy, certificateElement: options.signingCertificateElement ?? 'SigningCertificate' });
  const base: Omit<SignatureXmlInput, 'signedPropertiesDigest' | 'signatureValue' | 'timestampToken'> = {
    signatureId,
    signatureMethod: SIGNATURE_METHODS[algorithm],
    documentDigest,
    signedPropertiesId,
    signedPropertiesXml: properties,
    certificateDer: certificate.der,
  };
  const zeroDigest = new Uint8Array(32);
  const pendingValue = new Uint8Array(1);

  // 2. Condensé de SignedProperties (contexte d'espaces de noms hérité des ancêtres dans le document final).
  const stage1 = parseXml(assemble(signatureXml({ ...base, signedPropertiesDigest: zeroDigest, signatureValue: pendingValue, timestampToken: undefined })));
  const propertiesElement = locate(stage1, (element) => isElement(element, NS_XADES, 'SignedProperties') && attributeValue(element, 'Id') === signedPropertiesId);
  const signedPropertiesDigest = await digestOf(canonicalizeTree(propertiesElement, { algorithm: 'c14n11' }));

  // 3. Condensé de SignedInfo → signature distante du condensé seul.
  const stage2 = parseXml(assemble(signatureXml({ ...base, signedPropertiesDigest, signatureValue: pendingValue, timestampToken: undefined })));
  const signedInfo = locate(stage2, (element) => isElement(element, NS_DS, 'SignedInfo'));
  const signedInfoDigest = await digestOf(canonicalizeTree(signedInfo, { algorithm: 'c14n11' }));
  const rawSignature = await options.signer.signDigest(signedInfoDigest, algorithm);
  if (algorithm === 'ECDSA_P256_SHA256' ? rawSignature.length !== 64 : rawSignature.length < 128) {
    throw refusal('SIGNER_RESULT_INVALID', 'Signature du signataire au format inattendu (ECDSA : r||s de 64 octets ; RSA : octets bruts).');
  }

  // 4. Jeton d'horodatage RFC 3161 sur le SignatureValue canonisé.
  const stage3 = parseXml(assemble(signatureXml({ ...base, signedPropertiesDigest, signatureValue: rawSignature, timestampToken: undefined })));
  const valueElement = locate(stage3, (element) => isElement(element, NS_DS, 'SignatureValue'));
  const imprint = await digestOf(canonicalizeTree(valueElement, { algorithm: 'c14n11' }));
  const token = await options.timestampProvider.timestamp(imprint);
  const parsedToken = parseTimeStampToken(token, { expectedImprintSha256: imprint });

  const finalXml = assemble(signatureXml({ ...base, signedPropertiesDigest, signatureValue: rawSignature, timestampToken: token }));
  return { xml: finalXml, signatureId, signatureAlgorithm: algorithm, timestampGenTime: parsedToken.genTime };
}

export interface VerifyUblXadesOptions {
  /** XAdES-BASELINE-T : jeton d'horodatage obligatoire (défaut true). */
  readonly requireTimestamp?: boolean;
}

export interface VerifyUblXadesResult {
  readonly valid: boolean;
  /** Code du premier échec ; vide si valide. */
  readonly failure: UblSignatureErrorCode | undefined;
  readonly signingTime: Date | undefined;
  readonly timestampGenTime: Date | undefined;
  readonly certificateSha256Hex: string | undefined;
  readonly signatureAlgorithm: SignatureAlgorithm | undefined;
  /**
   * Ce que la vérification NE couvre PAS : chaîne de certification, révocation, signature CMS de la TSA, politique de signature.
   * Toujours « NOT_EVALUATED » ici (ancres de confiance Barid eSign : ticket P2A-05).
   */
  readonly trust: 'NOT_EVALUATED';
}

function failed(code: UblSignatureErrorCode): VerifyUblXadesResult {
  return { valid: false, failure: code, signingTime: undefined, timestampGenTime: undefined, certificateSha256Hex: undefined, signatureAlgorithm: undefined, trust: 'NOT_EVALUATED' };
}

function transformsOf(reference: XmlElement): string[] {
  const transforms = childOf(reference, NS_DS, 'Transforms');
  if (transforms === undefined) return [];
  return childElements(transforms).map((transform) => {
    if (!isElement(transform, NS_DS, 'Transform')) throw refusal('XADES_STRUCTURE_INVALID', 'Transform attendu.');
    return attributeValue(transform, 'Algorithm') ?? '';
  });
}

async function referenceDigest(document: XmlDocument, signature: XmlElement, reference: XmlElement): Promise<Uint8Array> {
  const uri = attributeValue(reference, 'URI');
  const transforms = transformsOf(reference);
  let canonical: string | undefined;
  let enveloped = false;
  for (const transform of transforms) {
    if (transform === ENVELOPED) enveloped = true;
    else if (transform === C14N11_ALGORITHM || transform === EXC_C14N_ALGORITHM) canonical = transform;
    else throw refusal('XADES_ALGORITHM_REFUSED', 'Transformation refusée (liste blanche : enveloped-signature, c14n11, exc-c14n).');
  }
  if (canonical === undefined) throw refusal('XADES_ALGORITHM_REFUSED', 'Une transformation de canonisation est obligatoire.');
  if (uri === '') {
    if (!enveloped) throw refusal('XADES_STRUCTURE_INVALID', 'La référence au document exige la transformation enveloped-signature.');
    return digestOf(canonicalizeTree(document, canonOptionsFor(canonical, { omit: new Set([signature]) })));
  }
  if (uri === undefined || !uri.startsWith('#') || uri.length < 2) throw refusal('XADES_STRUCTURE_INVALID', 'URI de référence non supportée.');
  const id = uri.slice(1);
  const matches: XmlElement[] = [];
  for (const element of descendantElements(document.root)) {
    for (const attribute of element.attributes) if (attribute.local === 'Id' && attribute.value === id) matches.push(element);
  }
  if (matches.length !== 1) throw refusal('XADES_REFERENCE_AMBIGUOUS', 'Identifiant de référence absent ou dupliqué.');
  const target = matches[0] as XmlElement;
  if (enveloped) throw refusal('XADES_STRUCTURE_INVALID', 'enveloped-signature n’a de sens que pour la référence au document.');
  return digestOf(canonicalizeTree(target, canonOptionsFor(canonical)));
}

/**
 * Vérifie une signature XAdES-BASELINE-T produite par `signUblXades` (ou structurellement équivalente) avec WebCrypto :
 * recalcul des condensés canonisés, crypto.subtle.verify avec la clé du certificat de KeyInfo, cohérence de SigningCertificateV2,
 * jeton RFC 3161 (empreinte du SignatureValue canonisé). Ne lève jamais pour un document invalide : retourne `valid: false` et un code.
 * Ne valide PAS la chaîne de certification ni la signature de la TSA (voir `trust`).
 */
export async function verifyUblXades(xml: string, options: VerifyUblXadesOptions = {}): Promise<VerifyUblXadesResult> {
  try {
    return await verifyInternal(xml, options.requireTimestamp ?? true);
  } catch (error) {
    if (error instanceof UblSignatureError) return failed(error.code);
    return failed('XADES_STRUCTURE_INVALID');
  }
}

async function verifyInternal(xml: string, requireTimestamp: boolean): Promise<VerifyUblXadesResult> {
  const document = parseXml(xml);
  const signatures = [...descendantElements(document.root)].filter((element) => isElement(element, NS_DS, 'Signature'));
  if (signatures.length !== 1) throw refusal('XADES_STRUCTURE_INVALID', 'Exactement une ds:Signature attendue.');
  const signature = signatures[0] as XmlElement;
  if (signature.parent === null || !isElement(signature.parent, NS_UBL_EXT, 'ExtensionContent')) {
    throw refusal('XADES_STRUCTURE_INVALID', 'La signature doit être dans UBLExtensions/UBLExtension/ExtensionContent.');
  }
  const signatureId = attributeValue(signature, 'Id');
  const signedInfo = childOf(signature, NS_DS, 'SignedInfo');
  const valueElement = childOf(signature, NS_DS, 'SignatureValue');
  const keyInfo = childOf(signature, NS_DS, 'KeyInfo');
  if (signedInfo === undefined || valueElement === undefined || keyInfo === undefined || signatureId === undefined) {
    throw refusal('XADES_STRUCTURE_INVALID', 'SignedInfo, SignatureValue, KeyInfo et Id attendus.');
  }
  const canonicalizationUri = attributeValue(childOf(signedInfo, NS_DS, 'CanonicalizationMethod') ?? signedInfo, 'Algorithm') ?? '';
  const canonOptions = canonOptionsFor(canonicalizationUri);
  const methodUri = attributeValue(childOf(signedInfo, NS_DS, 'SignatureMethod') ?? signedInfo, 'Algorithm') ?? '';
  const algorithm = (Object.keys(SIGNATURE_METHODS) as SignatureAlgorithm[]).find((candidate) => SIGNATURE_METHODS[candidate] === methodUri);
  if (algorithm === undefined) throw refusal('XADES_ALGORITHM_REFUSED', 'Méthode de signature refusée (ECDSA P-256 / RSA PKCS#1 v1.5 avec SHA-256 seulement).');

  // Références : document (URI="") et SignedProperties, digests SHA-256 recalculés.
  const references = childElements(signedInfo).filter((element) => isElement(element, NS_DS, 'Reference'));
  let documentReferenced = false;
  let propertiesReferenced: XmlElement | undefined;
  for (const reference of references) {
    const digestMethod = attributeValue(childOf(reference, NS_DS, 'DigestMethod') ?? reference, 'Algorithm');
    if (digestMethod !== SHA256_URI) throw refusal('XADES_ALGORITHM_REFUSED', 'Seul SHA-256 est accepté pour les références.');
    const declared = childOf(reference, NS_DS, 'DigestValue');
    if (declared === undefined) throw refusal('XADES_STRUCTURE_INVALID', 'DigestValue attendu.');
    const actual = await referenceDigest(document, signature, reference);
    if (!bytesEqual(actual, fromBase64(textContent(declared)))) throw refusal('XADES_DIGEST_MISMATCH', 'Condensé de référence invalide.');
    const uri = attributeValue(reference, 'URI');
    if (uri === '') documentReferenced = true;
    else if (attributeValue(reference, 'Type') === SIGNED_PROPERTIES_TYPE && uri !== undefined) {
      const found = [...descendantElements(document.root)].find((element) => attributeValue(element, 'Id') === uri.slice(1));
      if (found !== undefined) propertiesReferenced = found;
    }
  }
  if (!documentReferenced || propertiesReferenced === undefined) {
    throw refusal('XADES_STRUCTURE_INVALID', 'Références au document et à SignedProperties obligatoires.');
  }
  if (!isElement(propertiesReferenced, NS_XADES, 'SignedProperties')) throw refusal('XADES_STRUCTURE_INVALID', 'La référence xades ne désigne pas SignedProperties.');
  // SignedProperties doit appartenir à CETTE signature (anti-déplacement).
  let ancestor: XmlElement | null = propertiesReferenced;
  while (ancestor !== null && ancestor !== signature) ancestor = ancestor.parent;
  if (ancestor === null) throw refusal('XADES_STRUCTURE_INVALID', 'SignedProperties hors de la signature.');
  const qualifying = propertiesReferenced.parent;
  if (qualifying === null || !isElement(qualifying, NS_XADES, 'QualifyingProperties') || attributeValue(qualifying, 'Target') !== `#${signatureId}`) {
    throw refusal('XADES_STRUCTURE_INVALID', 'QualifyingProperties/@Target ne désigne pas la signature.');
  }

  // Certificat et signature.
  const certificateElement = findByPath(keyInfo, [
    [NS_DS, 'X509Data'],
    [NS_DS, 'X509Certificate'],
  ]);
  if (certificateElement === undefined) throw refusal('XADES_STRUCTURE_INVALID', 'KeyInfo/X509Data/X509Certificate attendu.');
  const certificate = parseCertificate(fromBase64(textContent(certificateElement)));
  if (certificate.algorithm !== algorithm) throw refusal('XADES_CERTIFICATE_MISMATCH', 'La clé du certificat ne correspond pas à la méthode de signature.');
  const signatureBytes = fromBase64(textContent(valueElement));
  const signedInfoBytes = canonicalizeTree(signedInfo, canonOptions);
  const key = await importCertificatePublicKey(certificate);
  const verified = await crypto.subtle.verify(
    algorithm === 'ECDSA_P256_SHA256' ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' },
    key,
    signatureBytes,
    signedInfoBytes,
  );
  if (!verified) throw refusal('XADES_SIGNATURE_INVALID', 'Signature numérique invalide.');

  // XAdES : SigningCertificateV2 lié au certificat de KeyInfo.
  const signed = childOf(propertiesReferenced, NS_XADES, 'SignedSignatureProperties');
  if (signed === undefined) throw refusal('XADES_STRUCTURE_INVALID', 'SignedSignatureProperties attendu.');
  const isV2 = childOf(signed, NS_XADES, 'SigningCertificateV2') !== undefined;
  const signingCertificate = childOf(signed, NS_XADES, isV2 ? 'SigningCertificateV2' : 'SigningCertificate');
  const cert = signingCertificate === undefined ? undefined : childOf(signingCertificate, NS_XADES, 'Cert');
  const certDigestParent = cert === undefined ? undefined : childOf(cert, NS_XADES, 'CertDigest');
  const certDigest = certDigestParent === undefined ? undefined : childOf(certDigestParent, NS_DS, 'DigestValue');
  if (cert === undefined || certDigestParent === undefined || certDigest === undefined) throw refusal('XADES_STRUCTURE_INVALID', 'SigningCertificate(V2) attendu.');
  if (attributeValue(childOf(certDigestParent, NS_DS, 'DigestMethod') ?? certDigestParent, 'Algorithm') !== SHA256_URI) {
    throw refusal('XADES_ALGORITHM_REFUSED', 'Condensé du certificat : SHA-256 seulement.');
  }
  const certificateHash = await sha256(certificate.der);
  if (!bytesEqual(certificateHash, fromBase64(textContent(certDigest)))) throw refusal('XADES_CERTIFICATE_MISMATCH', 'La référence du certificat signataire ne correspond pas au certificat de KeyInfo.');
  if (isV2) {
    const issuerSerial = childOf(cert, NS_XADES, 'IssuerSerialV2');
    if (issuerSerial !== undefined && textContent(issuerSerial).trim() !== issuerSerialV2Base64(certificate)) {
      throw refusal('XADES_CERTIFICATE_MISMATCH', 'IssuerSerialV2 ne correspond pas au certificat de KeyInfo.');
    }
  } else {
    const issuerSerial = childOf(cert, NS_XADES, 'IssuerSerial');
    const serial = issuerSerial === undefined ? undefined : childOf(issuerSerial, NS_DS, 'X509SerialNumber');
    if (serial !== undefined && textContent(serial).trim() !== certificate.serialNumber.toString()) {
      throw refusal('XADES_CERTIFICATE_MISMATCH', 'Le numéro de série référencé ne correspond pas au certificat de KeyInfo.');
    }
  }
  const signingTimeElement = childOf(signed, NS_XADES, 'SigningTime');
  const signingTime = signingTimeElement === undefined ? undefined : new Date(textContent(signingTimeElement).trim());
  if (signingTime === undefined || Number.isNaN(signingTime.getTime())) throw refusal('XADES_STRUCTURE_INVALID', 'SigningTime invalide.');

  // Jeton d'horodatage.
  const stampContainer = findByPath(qualifying, [
    [NS_XADES, 'UnsignedProperties'],
    [NS_XADES, 'UnsignedSignatureProperties'],
    [NS_XADES, 'SignatureTimeStamp'],
  ]);
  const encapsulated = stampContainer === undefined ? undefined : childOf(stampContainer, NS_XADES, 'EncapsulatedTimeStamp');
  let timestampGenTime: Date | undefined;
  if (encapsulated === undefined) {
    if (requireTimestamp) throw refusal('XADES_TIMESTAMP_MISSING', 'Jeton d’horodatage RFC 3161 absent (XAdES-BASELINE-T).');
  } else {
    const stampCanonUri = attributeValue(childOf(stampContainer as XmlElement, NS_DS, 'CanonicalizationMethod') ?? signedInfo, 'Algorithm') ?? canonicalizationUri;
    const imprint = await sha256(canonicalizeTree(valueElement, canonOptionsFor(stampCanonUri)));
    timestampGenTime = parseTimeStampToken(fromBase64(textContent(encapsulated)), { expectedImprintSha256: imprint }).genTime;
  }
  return { valid: true, failure: undefined, signingTime, timestampGenTime, certificateSha256Hex: toHex(certificateHash), signatureAlgorithm: algorithm, trust: 'NOT_EVALUATED' };
}
