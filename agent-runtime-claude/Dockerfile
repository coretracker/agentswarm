FROM node:20-alpine

ENV CLAUDE_INSTALL_ROOT=/runtime/home \
  PATH=/runtime/home/.local/bin:$PATH \
  USE_BUILTIN_RIPGREP=0 \
  DISABLE_AUTOUPDATER=1 \
  HOME=/runtime/home

RUN apk add --no-cache git bash openssh-client ripgrep curl libgcc libstdc++ su-exec \
  && addgroup -S agent \
  && adduser -S -G agent -h /home/agent agent \
  && mkdir -p "$CLAUDE_INSTALL_ROOT" /home/agent /runtime \
  && curl -fsSL https://claude.ai/install.sh | bash \
  && test -x "$CLAUDE_INSTALL_ROOT/.local/bin/claude" \
  && "$CLAUDE_INSTALL_ROOT/.local/bin/claude" --version >/dev/null \
  && chown -R agent:agent /home/agent /runtime \
  && chmod -R a+rX "$CLAUDE_INSTALL_ROOT"

WORKDIR /runtime
COPY run-task.mjs /usr/local/bin/run-task.mjs

ENTRYPOINT ["node", "/usr/local/bin/run-task.mjs"]
