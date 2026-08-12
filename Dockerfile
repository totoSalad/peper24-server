FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY --chown=node:node app ./app
COPY --chown=node:node config ./config
COPY --chown=node:node database ./database
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node typings ./typings
COPY --chown=node:node tsconfig.json ./

# Egg's production loader consumes JavaScript. Keep the repository's normal
# type-check-only build, then emit runtime JS inside the image.
RUN pnpm build \
  && pnpm exec tsc --noEmit false --sourceMap false \
  && pnpm prune --prod

ENV NODE_ENV=production

USER node

EXPOSE 7001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:7001/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["pnpm", "exec", "eggctl", "start", "-c", "2", "--env=prod", "--title=egg-server-peper24-server"]
