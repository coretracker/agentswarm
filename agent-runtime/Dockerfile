FROM node:20-bookworm

ENV CLAUDE_INSTALL_ROOT=/runtime/home \
  PATH=/runtime/home/.local/bin:$PATH \
  USE_BUILTIN_RIPGREP=0 \
  DISABLE_AUTOUPDATER=1 \
  HOME=/runtime/home

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    diffutils \
    docker.io \
    g++ \
    gh \
    git \
    gosu \
    make \
    neovim \
    openssh-client \
    python3 \
    ripgrep \
    vim \
  && rm -rf /var/lib/apt/lists/* \
  && ln -sf /usr/sbin/gosu /usr/local/bin/su-exec \
  && npm install -g @openai/codex \
  && addgroup --system agent \
  && adduser --system --ingroup agent --home /home/agent agent \
  && mkdir -p "$CLAUDE_INSTALL_ROOT" /home/agent /runtime \
  && curl -fsSL https://claude.ai/install.sh | bash \
  && test -x "$CLAUDE_INSTALL_ROOT/.local/bin/claude" \
  && "$CLAUDE_INSTALL_ROOT/.local/bin/claude" --version >/dev/null \
  && chown -R agent:agent /home/agent /runtime \
  && chmod -R a+rX "$CLAUDE_INSTALL_ROOT"

RUN ln -sf "$CLAUDE_INSTALL_ROOT/.local/bin/claude" /usr/local/bin/claude

ENV HOME=/root \
  PATH=/runtime/home/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

WORKDIR /runtime
COPY run-task-codex.mjs /usr/local/bin/run-task-codex.mjs
COPY run-task-claude.mjs /usr/local/bin/run-task-claude.mjs

CMD ["bash"]
