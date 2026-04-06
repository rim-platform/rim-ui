# =============================================================================
# RIM UI — Production Dockerfile (Web SPA)
# Multi-stage build: deps → builder → runtime (nginx)
# Serves the web build of RIM (Tauri desktop features disabled at runtime)
# =============================================================================

# ---------- Stage 1: Dependencies --------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
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

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Custom nginx config for SPA routing
COPY <<'NGINX' /etc/nginx/conf.d/rim.conf
server {
    listen 80;
    listen [::]:80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

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

    # SPA fallback — all routes serve index.html
    location / {
        try_files $uri $uri/ /index.html;
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
