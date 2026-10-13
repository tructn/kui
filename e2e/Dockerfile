# Linux image that builds KUI and runs every test against Kafka in Docker.
# Used by `docker compose --profile e2e run --build --rm e2e` (see docker-compose.yml).
FROM rust:1-bookworm

# Tauri's Linux dependencies, WebKitWebDriver, a virtual display, and CMake for librdkafka.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake curl file pkg-config \
    libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev \
    webkit2gtk-driver xvfb xauth dbus-x11 \
    && rm -rf /var/lib/apt/lists/*

# Bun installs packages and runs scripts. Node is still needed because
# WebdriverIO's test runner is a Node program.
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN cargo install tauri-driver --locked

WORKDIR /app

# Install JS dependencies in their own layers so source edits don't reinstall them.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY e2e/package.json e2e/bun.lock e2e/
RUN cd e2e && bun install --frozen-lockfile

COPY . .

CMD ["bash", "e2e/run-in-docker.sh"]
