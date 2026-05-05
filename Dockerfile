FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY src/ ./src/

EXPOSE 3000

USER node

CMD ["node", "src/index.js"]
