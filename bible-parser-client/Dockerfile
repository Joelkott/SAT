FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY index.js ./

# Set environment to production
ENV NODE_ENV=production

# Start the application
CMD ["node", "index.js"]
