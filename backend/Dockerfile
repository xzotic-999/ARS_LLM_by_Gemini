# ---------- Build stage ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy backend source and config files relative to the project root
COPY backend/package.json package.json
COPY backend/package-lock.json package-lock.json
COPY backend/tsconfig.json tsconfig.json

# Install all dependencies (including dev) needed for build
RUN npm ci

# Copy source files and mandatory corporate Instruction.md
COPY backend/src ./src
COPY Instruction.md ./Instruction.md

# Build TypeScript (compiles all .ts files in src/ to dist/)
RUN npx tsc

# Remove dev-dependencies after compilation
RUN npm prune --production

# ---------- Runtime stage ----------
FROM node:20-alpine

WORKDIR /app

# Copy built files, production deps, and corporate Instruction.md from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/Instruction.md ./Instruction.md

# Copy migration SQL files to the compiled output directory
COPY --from=builder /app/src/migrations ./dist/migrations

# Expose the backend port (default 3000)
EXPOSE 3000

# Run the compiled app
CMD ["node", "dist/index.js"]
