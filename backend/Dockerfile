FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npx prisma generate

RUN npm run build


FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

# Chromium for Puppeteer — Alpine is musl libc, so Puppeteer's own
# downloaded Chromium (built for glibc) won't run here regardless of
# install flags. Install the Alpine-native package instead and skip
# Puppeteer's download entirely.
RUN apk add --no-cache \
    su-exec \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY package*.json ./

RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3000

# Starts as root only to fix volume ownership, then drops to the "node"
# user (see entrypoint.sh) — the server and Chromium never run as root.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]