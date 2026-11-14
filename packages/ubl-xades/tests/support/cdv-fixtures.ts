/** Fixtures CDV de test (UBL 2.1 ApplicationResponse minimal valide contre le XSD OASIS). Aucune donnée réelle. */
export interface CdvFixtureOptions {
  readonly id?: string;
  readonly responseCode?: string;
  readonly invoiceNumber?: string;
  readonly extraPrologue?: string;
}

export function buildCdvXml(options: CdvFixtureOptions = {}): string {
  const id = options.id ?? 'CDV-0001';
  const code = options.responseCode ?? 'AP';
  const number = options.invoiceNumber ?? 'FAC-2026-000001';
  return `<?xml version="1.0" encoding="UTF-8"?>${options.extraPrologue ?? ''}
<ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:ID>${id}</cbc:ID>
  <cbc:IssueDate>2026-11-13</cbc:IssueDate>
  <cac:SenderParty>
    <cac:PartyIdentification><cbc:ID>ACHETEUR-TEST</cbc:ID></cac:PartyIdentification>
  </cac:SenderParty>
  <cac:ReceiverParty>
    <cac:PartyIdentification><cbc:ID>VENDEUR-TEST</cbc:ID></cac:PartyIdentification>
  </cac:ReceiverParty>
  <cac:DocumentResponse>
    <cac:Response>
      <cbc:ResponseCode>${code}</cbc:ResponseCode>
    </cac:Response>
    <cac:DocumentReference>
      <cbc:ID>${number}</cbc:ID>
    </cac:DocumentReference>
  </cac:DocumentResponse>
</ApplicationResponse>
`;
}
