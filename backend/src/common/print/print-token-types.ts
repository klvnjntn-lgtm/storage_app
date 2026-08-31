export type PrintDocumentType =
  | 'invoice'
  | 'quotation'
  | 'sales-order'
  | 'delivery-order'
  | 'purchase-order';

export interface PrintTokenPayload {
  sub: string;              // documentId
  documentType: PrintDocumentType;
  organizationId: string;
  purpose: 'document-print';
}

export interface SignPrintTokenParams {
  documentType: PrintDocumentType;
  documentId: string;
  organizationId: string;
}

export interface VerifyPrintTokenParams {
  documentType: PrintDocumentType;
  documentId: string;
  organizationId: string;
}