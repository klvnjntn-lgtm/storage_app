FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

ARG BACKEND_URL=http://backend:3000
ENV BACKEND_URL=$BACKEND_URL

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time,
# not read at runtime — must be passed as a build ARG here, not just
# set in docker-compose.yml's environment block (that's too late).
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build


FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./

RUN npm ci --omit=dev

COPY --from=builder /app/.next ./.next

COPY --from=builder /app/public ./public

COPY --from=builder /app/next.config.ts ./next.config.ts

EXPOSE 3000

CMD ["npm","run","start"]