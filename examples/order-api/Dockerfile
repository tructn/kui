FROM oven/bun:1.2.19-alpine
WORKDIR /app
COPY server.ts .
USER bun
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --retries=10 CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["bun", "server.ts"]
