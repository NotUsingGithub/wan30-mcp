FROM apify/actor-node:22-slim

COPY --chown=myuser:myuser package*.json ./

RUN npm --quiet set progress=false \
 && npm ci --omit=dev --omit=optional \
 && echo "Installed NPM packages:" \
 && (npm list --omit=dev --omit=optional --all || true) \
 && echo "Node.js version:" \
 && node --version \
 && echo "NPM version:" \
 && npm --version

COPY --chown=myuser:myuser . ./

CMD ["node", "src/main.js"]
