# Homelab Docker Services

This repository manages Docker Compose configurations for various services running in my homelab environment. It provides a central location for defining, configuring, and deploying applications.

## Hosted Applications

- **Caddy**: A powerful, easy-to-use web server with automatic HTTPS.
- **CoreDNS**: A DNS server that chains plugins for service discovery.
- **frame-tv**: A service for managing and displaying art-pieces on a Samsung The Frame TV.
- **Glance**: A lightweight system monitoring dashboard.
- **Home Assistant**: Open-source home automation platform to control smart devices.
- **Hyperion**: Ambient lighting software for creating immersive experiences.
- **Jupyter-PyTorch**: A Jupyter Notebook environment preconfigured with PyTorch for machine learning tasks.
- **Karakeep**: A self-hosted bookmarking and archiving tool for saving, tagging, and retrieving web content.
- **Matter Server**: A bridge for Matter-compatible smart home devices.
- **n8n**: A workflow automation tool for connecting various services.
- **Obsidian**: A self-hosted note-taking and knowledge management tool.
- **Ollama**: A platform for hosting and managing AI models.
- **Open-WebUI**: A modern, extensible web interface for interacting with locally hosted AI models.
- **Syncthing**: A continuous file synchronization tool.
- **Vaultwarden**: A lightweight, self-hosted password manager.

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
