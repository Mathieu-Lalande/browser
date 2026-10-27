# Relais de synchronisation de Browser (ADR-018). Aucune dépendance d'exécution : Node 22 seul.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY package.json docker-entrypoint.sh ./
# Mounted volumes (Fly.io, Render) are often owned by root: the entrypoint fixes the ownership of
# DATA_DIR, then runs the relay as the unprivileged `node` user.
RUN apk add --no-cache su-exec && mkdir -p /data && chown node:node /data && chmod +x docker-entrypoint.sh
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
