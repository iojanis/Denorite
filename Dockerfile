FROM denoland/deno:alpine-2.0.2

WORKDIR /app

# Copy files while still root user
COPY . .

# Create directories if they don't exist and set permissions
RUN mkdir -p /app/components /app/modules && \
    chown -R deno:deno /app/components /app/modules && \
    chmod 755 /app/components /app/modules

# Create a backup of the original modules
RUN cp -r /app/modules /app/modules.original

# Switch to deno user after setting permissions
USER deno

RUN deno cache main.ts

EXPOSE 8082
EXPOSE 8081

ENV DENO_KV_URL="http://kv:4512"

# Use a startup script instead of directly running main.ts
CMD ["run", "-A", "--unstable-kv", "startup.ts"]
