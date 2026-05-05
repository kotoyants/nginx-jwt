FROM nginx:1.27-alpine
RUN apk add --no-cache nginx-module-njs
COPY jwt.js /etc/nginx/njs/jwt.js
