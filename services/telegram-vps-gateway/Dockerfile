FROM node:24-alpine

WORKDIR /app
COPY --chown=node:node server.mjs configure-webhook.mjs ./

USER node
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["node", "server.mjs"]
