# Dockerfile — used by Fly.io (see fly.toml). Render builds this project with its
# native Node runtime instead, so this file can also be ignored entirely.
#
# There is nothing to install: the site, the app server and the console use only
# Node's standard library. That keeps the image small and the build reproducible.

FROM node:20-alpine

RUN apk add --no-cache tini su-exec

WORKDIR /app
COPY . .

# the volume arrives owned by root; the entrypoint hands it to the app user
RUN mkdir -p /var/data \
 && chown -R node:node /app /var/data \
 && chmod +x /usr/local/bin/docker-entrypoint.sh || true
COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8788

EXPOSE 8788 8787

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server/start.mjs"]

# /health answers as soon as the app server is up:
#   HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8788/health || exit 1
