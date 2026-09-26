# Stage 1: Dependency & Build Stage
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Copy package descriptors
COPY package.json ./

# Install all dependencies (including devDependencies)
RUN npm install

# Copy application files
COPY . .

# Prune development dependencies for production
RUN npm prune --production

# Stage 2: Secure Production Release Stage
FROM node:20-alpine

# Set secure production environments
ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /usr/src/app

# Copy pruned node_modules from builder
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
