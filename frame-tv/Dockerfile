# Use Python base image
FROM python:3.12-slim

# Set working directory
WORKDIR /app

# Install system dependencies (including Git)
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Clone the repository inside the container
RUN git clone https://github.com/azaeldrm/samsung-tv-ws-api.git /app/samsung-tv-ws-api

# Install dependencies from requirements.txt
RUN pip install --no-cache-dir -r /app/samsung-tv-ws-api/requirements.txt

# Install the package itself using setup.py
RUN pip install --no-cache-dir /app/samsung-tv-ws-api

# Copy your custom scripts into the container
COPY . /app