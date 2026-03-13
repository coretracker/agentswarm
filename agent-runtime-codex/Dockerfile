FROM node:20-alpine

RUN apk add --no-cache git bash openssh-client ripgrep curl \
  && npm install -g @openai/codex

WORKDIR /runtime
COPY run-task.mjs /usr/local/bin/run-task.mjs

ENTRYPOINT ["node", "/usr/local/bin/run-task.mjs"]
