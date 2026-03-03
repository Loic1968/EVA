# Full EVA — Digital Twin (chat, documents, voice, calendar, etc.)
FROM node:20-alpine AS builder

WORKDIR /app

# Build eva web
COPY web/package*.json web/
WORKDIR /app/web
RUN npm ci
COPY web/ .
ENV VITE_EVA_API_URL=
RUN npm run build

# Runtime
FROM node:20-alpine
RUN apk add --no-cache python3 make g++ wget

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY server/ ./server/
COPY scripts/ ./scripts/
COPY migrations/ ./migrations/

COPY --from=builder /app/web/dist ./web/dist

ENV NODE_ENV=production
ENV EVA_PORT=5002
ENV EVA_HOST=0.0.0.0

EXPOSE 5002

CMD ["sh", "-c", "node scripts/run-migrations.js && node server/index.js"]
