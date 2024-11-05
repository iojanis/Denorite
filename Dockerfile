FROM denoland/deno:alpine-2.0.2

WORKDIR /app

# Copy files while still root user
COPY . .

# Create directories if they don't exist and set permissions
RUN mkdir -p /app/enchantments /app/modules && \
    chown -R deno:deno /app/enchantments /app/modules && \
    chmod 755 /app/enchantments /app/modules

# Switch to deno user after setting permissions
USER deno

RUN deno cache main.ts

EXPOSE 8082
EXPOSE 8081

ENV DENO_KV_URL="http://kv:4512"

CMD ["run", "-A", "--unstable-kv", "main.ts"]
