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

# Streams and labels the virtual display for `make e2e-headed`. Its own layer so it doesn't
# invalidate the cached tauri-driver build above.
RUN apt-get update && apt-get install -y --no-install-recommends x11vnc x11-xserver-utils x11-utils \
    && rm -rf /var/lib/apt/lists/*

# .NET 8 and the AWS Lambda Test Tool, for the spec that runs examples/order-lambda for real.
# The version must match the shim path in that example's launchSettings.json.
ENV DOTNET_ROOT=/usr/share/dotnet \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1 \
    LAMBDA_TEST_TOOL_DIR=/opt/lambda-test-tool
ENV PATH="$PATH:$DOTNET_ROOT"
RUN curl -fsSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0 --install-dir "$DOTNET_ROOT" \
    && dotnet tool install --tool-path "$LAMBDA_TEST_TOOL_DIR" Amazon.Lambda.TestTool --version 0.16.1

WORKDIR /app

# Install JS dependencies in their own layers so source edits don't reinstall them.
COPY package.json bun.lock ./
# --ignore-scripts skips `prepare` (lefthook install), which needs a git checkout.
RUN bun install --frozen-lockfile --ignore-scripts
COPY e2e/package.json e2e/bun.lock e2e/
RUN cd e2e && bun install --frozen-lockfile
COPY examples/order-lambda/src/OrderLambda/OrderLambda.csproj examples/order-lambda/src/OrderLambda/
RUN dotnet restore examples/order-lambda/src/OrderLambda

COPY . .

CMD ["bash", "e2e/run-in-docker.sh"]
