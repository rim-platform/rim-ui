# =============================================================================
# RIM UI — Production Dockerfile (Web SPA)
# Multi-stage build: deps → builder → runtime (nginx)
# Serves the web build of RIM (Tauri desktop features disabled at runtime)
# =============================================================================

# ---------- Stage 1: Dependencies --------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# .npmrc carries legacy-peer-deps (see its comment); without it npm ci fails on ERESOLVE.
COPY package.json package-lock.json* .npmrc ./
RUN npm ci --ignore-scripts

# ---------- Stage 2: Builder -------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time config: set the GraphQL endpoint for the production API
# Override at build time: docker build --build-arg VITE_GRAPHQL_ENDPOINT=https://api.rim.app/api
ARG VITE_GRAPHQL_ENDPOINT=http://localhost:8080/api
ENV VITE_GRAPHQL_ENDPOINT=${VITE_GRAPHQL_ENDPOINT}

RUN npm run build

# ---------- Stage 3: Runtime (nginx) -----------------------------------------
FROM nginx:1.27-alpine AS runtime

# API host for CSP connect-src — derived from the same build arg used by Vite.
# Pass the same value used in the builder stage:
#   docker build --build-arg VITE_GRAPHQL_ENDPOINT=https://api.rim.app/api .
# The RUN step below strips the path component to produce the bare origin
# (e.g. https://api.rim.app) used in the CSP connect-src directive.
ARG VITE_GRAPHQL_ENDPOINT=http://localhost:8080/api

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Derive the bare origin (scheme + host, no path) from the endpoint arg.
# Example: "https://api.rim.app/api" → "https://api.rim.app"
# The ws(s):// variant mirrors the http(s):// scheme for WebSocket support.
RUN API_ORIGIN=$(echo "$VITE_GRAPHQL_ENDPOINT" | sed 's|^\(https\?://[^/]*\).*|\1|') && \
    WS_ORIGIN=$(echo "$API_ORIGIN" | sed 's|^http|ws|') && \
    cat > /etc/nginx/conf.d/rim.conf <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    # X-XSS-Protection "1; mode=block" is deprecated — set to "0" and rely on
    # CSP for XSS defense-in-depth instead (L2).
    add_header X-XSS-Protection "0" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    # Content-Security-Policy (M2): XSS defense-in-depth for the web build.
    # connect-src is pinned to the API origin derived from VITE_GRAPHQL_ENDPOINT
    # at docker build time — no wildcard localhost allowed in production.
    # style-src includes 'unsafe-inline' because Tailwind CSS v4 injects inline
    # styles at build time; tightening to a nonce requires build-pipeline changes
    # beyond this scope (flagged per spec M2 review note).
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' $API_ORIGIN $WS_ORIGIN; frame-ancestors 'none'" always;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_min_length 256;
    gzip_types
        text/plain
        text/css
        text/javascript
        application/javascript
        application/json
        application/xml
        image/svg+xml;

    # Cache hashed assets aggressively (Vite adds content hash)
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # The web plugin frame shell states its own content security policy in a
    # <meta>. Policies intersect, so this location sends that same baseline
    # (plus frame-ancestors) instead of the app's, whose script-src 'self' would
    # block the blob: scripts plugins run from. The app's default-src 'self'
    # already lets its pages frame these files.
    location /plugin-frame/ {
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header Content-Security-Policy "default-src 'none'; script-src 'self' blob: 'wasm-unsafe-eval'; style-src 'self' blob: 'unsafe-inline'; img-src 'self' blob: data: https:; font-src blob: data:; media-src blob: data:; connect-src https: wss:; worker-src blob:; frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'" always;
    }

    # SPA fallback — all routes serve index.html
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Health check endpoint
    location = /health {
        access_log off;
        return 200 "ok";
        add_header Content-Type text/plain;
    }
}
NGINX

# Copy built SPA from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Non-root nginx (alpine image supports this)
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown -R nginx:nginx /var/run/nginx.pid

USER nginx

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
