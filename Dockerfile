# Debian (glibc), no Alpine: better-sqlite3 y argon2 se prueban con binarios precompilados para glibc.
# --- Etapa de construcción: herramientas de compilación solo aquí ---
FROM node:22-bookworm-slim AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- Etapa final: misma base (mismo ABI), así que node_modules se copia tal cual ---
FROM node:22-bookworm-slim
ENV NODE_ENV=production
# sqlite3: cliente de línea de comandos para consultas y copias de seguridad (.backup)
RUN apt-get update \
 && apt-get install -y --no-install-recommends sqlite3 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY migrations ./migrations
COPY scripts ./scripts
COPY public ./public
COPY content ./content

# El usuario "node" de la imagen oficial tiene uid 1000.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

# Si better-sqlite3 o argon2 no funcionan en esta imagen, el build se rompe aquí (no al desplegar).
RUN node scripts/comprobar-arranque.js --exigir-cli

EXPOSE 3000
# La imagen no trae wget ni curl: se usa el fetch de Node.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "src/index.js"]
