# Stage 1: Clone and prepare application
FROM mcr.microsoft.com/playwright/python:v1.40.0-jammy AS builder
ARG REPO=https://github.com/azaeldrm/ezcopper.git
ARG REPO_BRANCH=main

# Use GITHUB_TOKEN env var or fallback to SSH
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/* && \
    git clone --depth 1 --branch ${REPO_BRANCH} ${REPO} /tmp/ezcopper

# Stage 2: Final image
FROM mcr.microsoft.com/playwright/python:v1.40.0-jammy

# Install VNC and noVNC dependencies
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    fluxbox \
    websockify \
    git \
    net-tools \
    procps \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

# Install noVNC
RUN git clone --depth 1 https://github.com/novnc/noVNC.git /opt/noVNC \
    && git clone --depth 1 https://github.com/novnc/websockify.git /opt/noVNC/utils/websockify \
    && ln -s /opt/noVNC/vnc.html /opt/noVNC/index.html

# Set working directory
WORKDIR /app

# Copy application code from cloned repo
COPY --from=builder /tmp/ezcopper/app/ ./app/
COPY --from=builder /tmp/ezcopper/entrypoint.sh .
RUN chmod +x entrypoint.sh

# Install Python dependencies
COPY --from=builder /tmp/ezcopper/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create data directories
RUN mkdir -p /data/profile /data/artifacts /data

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV DISPLAY=:99
ENV PYTHONPATH=/app

# Expose ports
EXPOSE 6080 8000

# Entrypoint
ENTRYPOINT ["./entrypoint.sh"]