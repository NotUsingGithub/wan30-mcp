FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node src/ ./src/
COPY --chown=node:node README.md LICENSE PROVENANCE.md ./
USER node
ENV WAN30_CONFIG_DIR=/home/node/.config/wan30
# Starts and lists its tools without credentials; tool calls ask for sign-in.
ENTRYPOINT ["node", "src/cli.mjs", "mcp", "--credential-store", "file"]
