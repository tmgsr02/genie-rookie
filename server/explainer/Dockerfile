FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npx playwright install --with-deps chromium && mkdir -p /work && chmod 777 /work && cp -a /root/.cache/ms-playwright /ms-playwright && chmod -R a+rX /ms-playwright
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY vendor/anatomy ./vendor/anatomy
COPY vendor/anatomy.commit ./vendor/anatomy.commit
COPY src ./src
COPY runtime ./runtime
USER node
ENTRYPOINT ["/bin/sh", "-c", "export CHROME_PATH=$(node -e 'process.stdout.write(require(\"playwright\").chromium.executablePath())'); exec \"$@\"", "--"]
