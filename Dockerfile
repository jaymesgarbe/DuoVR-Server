# Use Node.js 18 with Alpine for smaller image size
FROM node:18-alpine

# Install FFmpeg and other required packages
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S duovr -u 1001 -G nodejs

# Create necessary directories with proper permissions
RUN mkdir -p /tmp/uploads /tmp/thumbnails /tmp/transcoded && \
    chown -R duovr:nodejs /app /tmp/uploads /tmp/thumbnails /tmp/transcoded

# Switch to non-root user
USER duovr

# Expose port (Cloud Run will set PORT env var)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { \
    if (res.statusCode === 200) process.exit(0); else process.exit(1); \
  }).on('error', () => process.exit(1));"

# Set environment variables
ENV NODE_ENV=production
ENV TEMP_DIR=/tmp

# Start the application
CMD ["npm", "start"]