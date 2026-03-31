FROM denoland/deno:2.7.4

WORKDIR /app

# Cache dependencies by copying config first
COPY deno.json deno.lock .
RUN deno install --frozen

# Copy source code
COPY src/ src/

# Create output directory
RUN mkdir -p /app/output

# Run the dump
CMD ["deno", "run", "-A", "src/main.ts"]
