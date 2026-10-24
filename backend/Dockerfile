# ---------- Stage 1: Build Frontend SPA ----------
FROM node:20-alpine AS frontend-builder

WORKDIR /frontend

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY index.html tsconfig.json vite.config.ts metadata.json ./
COPY public ./public
COPY src ./src

RUN npm run build

# ---------- Stage 2: Build Backend API ----------
FROM node:20-alpine AS backend-builder

WORKDIR /app

COPY backend/package*.json ./
COPY backend/tsconfig.json tsconfig.json

RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY backend/src ./src
COPY Instruction.md ./Instruction.md

RUN npx tsc
RUN npm prune --production

# ---------- Stage 3: Unified Production Runtime ----------
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV SERVE_STATIC_SPA=true
ENV TRUST_PROXY=true
ENV FRONTEND_DIST_PATH=/app/frontend-dist

# Copy compiled backend, production dependencies, and mandatory corporate Instruction.md
COPY --from=backend-builder /app/dist ./dist
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/package.json ./package.json
COPY --from=backend-builder /app/Instruction.md ./Instruction.md
COPY --from=backend-builder /app/src/migrations ./dist/migrations

# Copy compiled React SPA bundle (zero UI changes, served on same origin)
COPY --from=frontend-builder /frontend/dist ./frontend-dist

EXPOSE 3000

CMD ["node", "dist/index.js"]

