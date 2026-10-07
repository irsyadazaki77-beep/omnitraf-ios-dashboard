# Stage 1: Dependency & Build Stage
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Copy canonical npm package descriptors
COPY package.json package-lock.json ./

# Install the locked build and runtime dependencies.
RUN npm ci

# Copy application files
COPY . .
RUN npm run build && npm prune --omit=dev

# Stage 2: Secure Production Release Stage
FROM node:20-alpine

# Set secure production environments
ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /usr/src/app

# Copy locked production dependencies
COPY --from=builder /usr/src/app/node_modules ./node_modules

# Copy application files from builder
COPY --from=builder /usr/src/app ./

# Enforce secure container directory permissions
RUN mkdir -p /usr/src/app/data && chown -R node:node /usr/src/app

ENV DB_PATH=/usr/src/app/data/omnitraf.sqlite

# Apply non-root container security instruction
USER node

# Expose application service port
EXPOSE 3000

# Production application entry point
CMD ["node", "server.js"]
