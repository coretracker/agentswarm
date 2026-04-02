FROM node:20-alpine

ENV CLAUDE_INSTALL_ROOT=/opt/claude-code \
  PATH=/opt/claude-code/.local/bin:$PATH \
  USE_BUILTIN_RIPGREP=0 \
  DISABLE_AUTOUPDATER=1

RUN apk add --no-cache git bash openssh-client ripgrep curl libgcc libstdc++ su-exec \
  && mkdir -p "$CLAUDE_INSTALL_ROOT" \
  && export HOME="$CLAUDE_INSTALL_ROOT" \
  && curl -fsSL https://claude.ai/install.sh | bash \
  && test -x "$CLAUDE_INSTALL_ROOT/.local/bin/claude" \
  && "$CLAUDE_INSTALL_ROOT/.local/bin/claude" --version >/dev/null \
  && chmod -R a+rX "$CLAUDE_INSTALL_ROOT" \
  && addgroup -S agent \
  && adduser -S -G agent -h /home/agent agent \
  && mkdir -p /home/agent /runtime \
  && chown -R agent:agent /home/agent /runtime

WORKDIR /runtime
ENV HOME=/home/agent
COPY run-task.mjs /usr/local/bin/run-task.mjs

ENTRYPOINT ["node", "/usr/local/bin/run-task.mjs"]
