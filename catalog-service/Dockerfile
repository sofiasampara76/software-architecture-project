FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json ./
RUN npm install --omit=dev

# Copy source
COPY src/ ./src/
COPY .env.example ./.env

EXPOSE 3001

CMD ["node", "src/index.js"]
