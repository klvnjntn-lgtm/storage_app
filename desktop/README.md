# WareSys Desktop

A Windows app with only the INVOICE_POS side of WareSys: Sales, Purchasing
and Accounting, plus Customers, Products, Settings and user Admin. Selling
is POS-style: straight to an invoice. Quotations, sales orders and delivery
orders are hidden; they stay on the web version. It needs no server, and several PCs in one office
can share the same data. The same installer goes on every PC, and each PC
is set up on first launch as one of these:

- **Main PC** (one per office): holds the data. It runs the bundled
  **PostgreSQL 16**, **NestJS backend** and **Next.js frontend**. Only the
  frontend (TCP 47331) is reachable from the office network; the backend
  (47330) and database (47432) stay on 127.0.0.1. It holds the license,
  exports/imports backups, and answers discovery broadcasts (UDP 47333) so
  clients can find it. It must be on while anyone uses WareSys.
- **Client**: runs nothing locally. It finds the main PC on the network
  (or you type its address) and opens its WareSys. It needs no license
  key and no internet. If the main PC's IP address changes, the client
  finds it again by its PC name.

This works like Accurate's license manager. The main PC is the only PC
that talks to the licensing service (Keygen), with one license per
business.

**User seats** come from the license. In Keygen, give the license a
metadata key `seats` (e.g. `5`). The main PC applies it to the business's
seat limit at every license check: at startup and every 12 hours, when
online. Without `seats`, the limit stays as it is (default 1).

A company registers on first launch of the main PC and gets INVOICE_POS
switched on automatically (`AUTO_ENABLE_MODULES` in
`backend/src/auth/auth.service.ts`). In the app, the frontend hides
everything else (`frontend/lib/desktop.ts`).

The installer adds Windows Firewall rules for TCP 47331 and UDP 47333 on
**Private and Domain networks only**, the same as the server install. If
the office network is set to *Public* in Windows, clients can't reach the
main PC until it is switched to *Private*.

## Moving between web and desktop

**Settings → Export business data** (web or desktop, admins) downloads the
whole business as an encrypted `.wsexport`. That covers every row of the
business, plus its uploaded files, with a password chosen at export.
- **Web → desktop:** on the main PC's first launch, use *Import your data*
  on the registration page instead of registering.
- **Desktop → web:** in the platform console, use **Import business**, then
  set its modules, seats and billing as for any customer. The console can
  also export any business.

Both sides must run the same WareSys version (same last migration), and no
user email may already exist on the receiving side. Users keep their
passwords. Billing, modules, login sessions and push subscriptions are not
carried over. The code is in `backend/src/org-transfer/`.

## Where things live on the PC

| What | Where (main PC) |
|---|---|
| Database, uploads, settings, logs | `%APPDATA%\WareSys` (of the Windows user who runs it) |

**Backups only happen when the customer exports one.** Use **File → Export
Backup…** on the main PC. It asks where to save the file (a USB drive, a
Google Drive folder…), stops WareSys for a moment so the copy is
consistent (the other PCs briefly lose their connection), and writes a
single `.wsbak` file. **File → Import Backup…** replaces all data with one.
Importing is also how the data moves to a new main PC.

A `.wsbak` holds the database folder and uploaded files, gzipped and
encrypted (AES-256-GCM) with a key derived from the business's license key.
It only imports on an install with the same license key, and a damaged or
altered file is refused without touching the live data. It is not a
`pg_dump`, so it doesn't load into the server install.

PDFs are rendered with Microsoft Edge, which is preinstalled on Windows
10/11.

## Building the installer

`KEYGEN_ACCOUNT_ID` is read from the repo's `.env`, the same Keygen account
the server install uses. Set it in the environment to override.

```sh
# From WSL/Linux (Docker builds the Windows installer)
cd desktop && npm install && npm run dist:wsl

# From Windows (PowerShell)
cd desktop; npm install; npm run dist
```

The output is `desktop/dist/WareSys-Setup-<version>.exe`. Bump `version`
in `package.json` for each release.

`scripts/stage.mjs` builds the frontend (`DESKTOP_BUILD=1`, as a
standalone server) and the backend (with production `node_modules` and
the Prisma engine for Windows), and fetches the PostgreSQL binaries into
`desktop/app/`. `scripts/after-pack.js` then copies them into the app,
because electron-builder won't copy `node_modules` itself.

To run from source on Linux/WSL: `npm run stage:linux && npm start`.

Database migrations are applied at startup by `src/services.js`. It uses
the same `_prisma_migrations` bookkeeping as `prisma migrate deploy`, so
no Prisma CLI is shipped.
