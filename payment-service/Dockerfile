FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src/ ./src/
COPY db/  ./db/

EXPOSE 3003

CMD ["node", "src/index.js"]
