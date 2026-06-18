FROM node:20-alpine

RUN apk add --no-cache python3 make g++

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=1024

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN npm ci

COPY . .

ENV NODE_ENV=production

RUN npm run build -w @agentswarm/shared-types
RUN npm run build -w @agentswarm/web

EXPOSE 3217
CMD ["npm", "run", "start", "-w", "@agentswarm/web"]
