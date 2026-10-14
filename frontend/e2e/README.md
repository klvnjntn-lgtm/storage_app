# Browser smoke tests

Playwright walks the self-serve flows end to end in Chromium. They need a
running stack on a **throwaway database** (they create organizations):

```bash
# backend, against the isolated test DB (npm run test:db:up in backend/)
cd backend && npm run build && \
  PORT=3100 DATABASE_URL=postgresql://postgres:test@localhost:5434/waresys_test?schema=public \
  SELF_SERVE_BILLING=true APP_URL=http://localhost:3101 FRONTEND_URL=http://localhost:3101 \
  node dist/src/main

# frontend, proxying /api to that backend
cd frontend && BACKEND_URL=http://localhost:3100 npx next dev -p 3101

# then
cd frontend && npx playwright install chromium && npm run test:e2e
```

Leave `ONLINE_PAYMENTS_ENABLED` and `WHATSAPP_ENABLED` unset: the tests
check that billing and WhatsApp show as "coming soon" with no buy buttons.
