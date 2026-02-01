# Homelab Docker Services

This repository manages Docker Compose configurations for various services running in my homelab environment. It provides a central location for defining, configuring, and deploying applications.

## Hosted Applications

### Media Management
- **ARR**: A suite of media management services including Prowlarr (trackers), Radarr (movies), Sonarr (TV), Lidarr (music), and Bazarr (subs).
- **Jellyfin**: A media server for streaming video and audio content.

### Backup & Sync
- **Immich**: A self-hosted mobile photo and video backup solution with AI photo management.
- **Nebula Sync**: A cloud backup service for maintaining redundant copies of your files.
- **Syncthing**: A continuous file synchronization tool for real-time data sync across devices.

### AI & Machine Learning
- **Ollama**: A platform for hosting and managing AI models locally.
- **Open-WebUI**: A modern, extensible web interface for interacting with locally hosted AI models.
- **Jupyter-PyTorch**: A Jupyter Notebook environment preconfigured with PyTorch for machine learning tasks.
- **Kokoro FastAPI**: A GPU-accelerated FastAPI service.

### Security & Password Management
- **Vaultwarden**: A lightweight, self-hosted password manager compatible with Bitwarden.
- **CoreDNS**: A DNS server with plugin support for service discovery.

### Monitoring & Automation
- **Glance**: A lightweight system monitoring dashboard.
- **Beszel Hub**: Central monitoring server for Beszel agents.
- **Beszel Agent**: Monitoring agent for collecting system metrics.
- **n8n**: A workflow automation tool for connecting various services.

### Smart Home
- **Home Assistant**: Open-source home automation platform to control smart devices.
- **Matter Server**: A bridge for Matter-compatible smart home devices.

### Networking & Infrastructure
- **Caddy**: A powerful, easy-to-use web server with automatic HTTPS.
- **docker-socket-proxy**: A secure Docker socket proxy for controlling the Docker daemon.

### Utilities
- **Paperless-ngx**: A document management application that transforms physical documents into searchable archives.
- **Karakeep**: A self-hosted bookmarking and archiving tool for saving, tagging, and retrieving web content.
- **Obsidian**: A self-hosted client for the Obsidian note-taking app.
- **frame-tv**: A service for managing and displaying art-pieces on a Samsung The Frame TV.
- **Hyperion**: Ambient lighting software for creating immersive experiences.
- **BentoPDF**: A PDF conversion and manipulation service.
- **qbittorrent**: A BitTorrent client with VPN support (Gluetun).
- **steam**: Steam container for gaming.

## Environment Setup

Each service requires specific environment variables to function properly.
Follow these steps to set up your homelab:

### Quick Setup
1. Copy environment templates:
   ```bash
   # For each service directory, copy the .env.example to .env
   find . -name ".env.example" -execdir cp {} .env \;

2. Edit environment files:
   - nano caddy/.env         # Network IP addresses
   - nano coredns/.env        # Local DNS resolution
   - nano vaultwarden/.env    # Vaultwarden URL and admin token

3. Enable required ports and networks:
   - Add port mappings in docker-compose.yml as needed
   - Create external networks (e.g., caddy-net, ollama-net, media-net)

### Network Configuration
Many services are connected to external networks defined in their respective docker-compose files:

- **caddy-net**: Used by Caddy, Glance, Beszel Hub, Syncthing, and Vaultwarden
- **ollama-net**: Used by Kokoro FastAPI
- **media-net**: Used by ARR, Jellyfin, and qbittorrent