# WPFL match tracker — optional container (Capek-Web runs it under PM2, see README).
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY src ./src
COPY public ./public
ENV HOST=0.0.0.0 PORT=3110 DATA_DIR=/data TRUST_PROXY=1
VOLUME /data
EXPOSE 3110
USER node
CMD ["node", "server.js"]
