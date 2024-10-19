FROM denoland/deno:alpine-2.0.2

WORKDIR /app

USER deno

COPY . .
RUN deno cache main.ts

EXPOSE 8080
EXPOSE 8081

CMD ["run", "-A", "--unstable-kv", "main.ts"]
