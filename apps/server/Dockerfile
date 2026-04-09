FROM node:20-alpine

RUN apk add --no-cache docker-cli git bash vim python3 make g++

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN npm ci

COPY . .

ENV NODE_ENV=production

EXPOSE 4000
CMD ["npm", "run", "start", "-w", "@agentswarm/server"]
