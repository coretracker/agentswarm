FROM node:20-alpine

RUN apk add --no-cache git bash openssh-client ripgrep su-exec \
  && npm install -g @anthropic-ai/claude-code \
  && addgroup -S agent \
  && adduser -S -G agent -h /home/agent agent \
  && mkdir -p /home/agent /runtime \
  && chown -R agent:agent /home/agent /runtime

WORKDIR /runtime
ENV HOME=/home/agent
COPY run-task.mjs /usr/local/bin/run-task.mjs

ENTRYPOINT ["node", "/usr/local/bin/run-task.mjs"]
