FROM node:20-alpine

RUN apk add --no-cache git bash openssh-client ripgrep curl

WORKDIR /runtime
COPY run-task.sh /usr/local/bin/run-task.sh
RUN chmod +x /usr/local/bin/run-task.sh

ENTRYPOINT ["/usr/local/bin/run-task.sh"]
