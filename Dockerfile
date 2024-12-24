FROM denoland/deno:alpine-2.0.2

WORKDIR /app

# Install unzip while still root
RUN apk add --no-cache unzip

# Copy files while still root user
COPY . .

# Create directories if they don't exist and set permissions
RUN mkdir -p /app/components /app/modules /app/minecraft-data/config /app/minecraft-data/mods && \
    chown -R deno:deno /app/components /app/modules /app/core /app/main.ts && \
    chmod 755 /app/components /app/modules /app/core /app/main.ts

# Create a backup of the original modules
RUN cp -r /app/modules /app/modules.original

# Create the entrypoint script
COPY <<'EOF' /app/docker-entrypoint.sh
#!/bin/sh

# Unzip denorite.zip into /app/mods if it exists
if [ -f /app/denorite.zip ]; then
    unzip -o /app/denorite.zip -d /app/minecraft-data/mods/
fi

# Generate config file
cat > /app/minecraft-data/config/denorite.json << EOJSON
{
    "jwtToken": "${JWT_TOKEN}",
    "serverUrl": "${SERVER_URL:-wss://denorite.cou.ai/minecraft}",
    "mcServerUrl": "${MC_SERVER_URL:-https://cou.ai}",
    "strictMode": ${STRICT_MODE:-true}
    ${ADDITIONAL_CONFIG:-}
}
EOJSON

exec deno run -A --unstable-kv startup.ts
EOF

RUN chmod +x /app/docker-entrypoint.sh

# Switch to deno user after setting permissions
USER deno

RUN deno cache main.ts

EXPOSE 8082
EXPOSE 8081

# Use the entrypoint script
ENTRYPOINT ["/app/docker-entrypoint.sh"]
