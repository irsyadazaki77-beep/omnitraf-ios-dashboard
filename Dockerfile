# Stage 1: Dependency & Build Stage
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Copy canonical npm package descriptors
COPY package.json package-lock.json ./

# Install the exact production dependency tree from the lockfile
RUN npm ci --omit=dev

# Copy application files
COPY . .

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
RUN chown -R node:node /usr/src/app

# Apply non-root container security instruction
USER node

# Expose application service port
EXPOSE 3000

# Production application entry point
CMD ["node", "server.js"]
