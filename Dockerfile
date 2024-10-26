FROM denoland/deno:alpine-2.0.2

WORKDIR /app

USER deno

RUN mkdir -p /app/modules && chown deno:deno /app/modules

COPY . .
RUN deno cache main.ts

EXPOSE 8082
EXPOSE 8081

ENV DENO_KV_URL="http://kv:4512"

CMD ["run", "-A", "--unstable-kv", "main.ts"]
