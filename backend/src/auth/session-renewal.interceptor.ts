import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { readSessionCookie, setSessionCookie } from './session-cookie';

// Keeps a session going while it's being used.
//
// A session token lasts 7 days. Without renewal it ran out exactly 7 days
// after sign-in, whatever the person was doing — a driver could be signed
// out mid-route. Now a request made with a token more than a day old gets a
// fresh one in its reply (same session, so nothing else changes): the 7
// days count from the last day it was used.
//
// Not forever, though: a session started more than MAX_SESSION_DAYS ago is
// left to run out, so a stolen cookie that keeps being used still dies, and
// everyone signs in again once a month. Only for the browser cookie — an
// API key or a bearer token is the caller's own to manage.
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;
export const MAX_SESSION_DAYS = 30;
const MAX_SESSION_MS = MAX_SESSION_DAYS * 24 * 60 * 60 * 1000;

type SessionClaims = {
  sub: string;
  email: string;
  role: string;
  organizationId: string;
  sessionId: string;
  // When the person signed in (ms). Tokens made before this existed use iat.
  loginAt?: number;
  iat?: number;
};

@Injectable()
export class SessionRenewalInterceptor implements NestInterceptor {
  constructor(private jwt: JwtService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request & { user?: { sub?: string; apiKeyId?: string } }>();
    const res = context.switchToHttp().getResponse<Response>();
    // Signed in by the cookie (not a bearer token or API key), and the guard accepted it.
    if (!req.user?.sub || req.user.apiKeyId || req.headers.authorization) return next.handle();
    // Signing out clears the cookie in the same reply.
    if (/\/auth\/logout\/?$/.test(req.path)) return next.handle();
    const token = readSessionCookie(req);
    if (!token) return next.handle();

    const claims = this.jwt.decode<SessionClaims | null>(token);
    if (!claims?.iat || claims.sub !== req.user.sub) return next.handle();
    const now = Date.now();
    const loginAt = claims.loginAt ?? claims.iat * 1000;
    if (now - claims.iat * 1000 >= RENEW_AFTER_MS && now - loginAt < MAX_SESSION_MS) {
      const renewed = this.jwt.sign(
        {
          sub: claims.sub,
          email: claims.email,
          role: claims.role,
          organizationId: claims.organizationId,
          sessionId: claims.sessionId,
          loginAt,
        },
        // Never past the 30-day mark.
        { expiresIn: Math.max(60, Math.floor(Math.min(7 * 24 * 60 * 60 * 1000, MAX_SESSION_MS - (now - loginAt)) / 1000)) },
      );
      setSessionCookie(req, res, renewed);
    }
    return next.handle();
  }
}
