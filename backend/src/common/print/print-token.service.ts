import { Injectable, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  PrintTokenPayload,
  SignPrintTokenParams,
  VerifyPrintTokenParams,
  PrintDocumentType,
} from './print-token-types';

@Injectable()
export class PrintTokenService {
  private readonly secret: string;

  constructor(private jwtService: JwtService) {
    const secret = process.env.PRINT_TOKEN_SECRET;
    if (!secret) {
      throw new Error('PRINT_TOKEN_SECRET is not set — cannot sign or verify print tokens');
    }
    this.secret = secret;
  }

  sign(params: SignPrintTokenParams): string {
    const payload: PrintTokenPayload = {
      sub: params.documentId,
      documentType: params.documentType,
      organizationId: params.organizationId,
      purpose: 'document-print',
    };
    return this.jwtService.sign(payload, {
      secret: this.secret,
      expiresIn: '2m',
    });
  }

  // Use when the CALLER already knows and trusts organizationId from an
  // authenticated context (e.g. an admin-facing endpoint checking a token
  // against the org the logged-in user belongs to). Rejects if the token's
  // org claim doesn't match what the caller expected.
  verifyUserContext(token: string, expected: VerifyPrintTokenParams): PrintTokenPayload {
    const payload = this.decode(token);

    if (
      payload.purpose !== 'document-print' ||
      payload.documentType !== expected.documentType ||
      payload.sub !== expected.documentId ||
      payload.organizationId !== expected.organizationId
    ) {
      throw new ForbiddenException('Print token does not match the requested document');
    }

    return payload;
  }

  // Use when the caller does NOT yet know organizationId — e.g. an
  // unauthenticated print route hit by Puppeteer, where the token itself
  // is the only credential. organizationId is read from the payload and
  // trusted because the JWT signature guarantees it wasn't tampered with.
  //
  // CALLER OBLIGATION: you MUST use payload.organizationId (never a
  // caller-supplied value) to scope every subsequent lookup. This method
  // only proves "this token is valid for exactly this document" — it does
  // NOT prove the caller is allowed to see any particular org's data
  // beyond what the token itself already grants.
  verifyDocumentToken(
    token: string,
    documentType: PrintDocumentType,
    documentId: string,
  ): PrintTokenPayload {
    const payload = this.decode(token);

    if (
      payload.purpose !== 'document-print' ||
      payload.documentType !== documentType ||
      payload.sub !== documentId
    ) {
      throw new ForbiddenException('Print token does not match the requested document');
    }

    return payload;
  }

  private decode(token: string): PrintTokenPayload {
    try {
      return this.jwtService.verify(token, { secret: this.secret });
    } catch {
      throw new ForbiddenException('Invalid or expired print token');
    }
  }
}