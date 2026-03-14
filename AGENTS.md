# Docker Homelab Agent Guidelines

## Alias
- **mc**: Shortcut for `./manage-container.sh` (e.g., `mc <service> u`, `mc <service> r pb`)

## Build/Deploy Commands
- **Start service**: `mc <service> u [flags]` (flags: p=pull, b=build)
- **Stop service**: `mc <service> d`
- **Restart service**: `mc <service> r`
- **View logs**: `cd <service>/ && docker compose logs -f`
- **Test single service**: `cd <service>/ && docker compose up -d --build`

## Code Style & Configuration

### YAML Files
- Use 2-space indentation for all YAML files
- Start comments with `#` and organize sections with separators like `# ─── Section ───`
- Use kebab-case for keys (e.g., `container_name`, `restart_policy`)
- Keep section headers concise and descriptive

### Shell Scripts
- Shebang: `#!/bin/bash`
- Use `|| exit 1` for error handling
- Validate arguments with clear error messages
- Use `BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"` for script location
- Quote all variables: `"${VAR}"`
- Use descriptive variable names (uppercase for constants)
- Include usage documentation in comments

### Environment Variables
- Use uppercase with underscores: `IMMICH_URL`, `COMPUTE_IP`
- Document variables in `.env.example` with section headers
- Placeholders should be clear: `your-domain.com`, `your-api-key`
- Use `${VAR:-default}` syntax for optional values

### Docker Compose
- Use `restart: unless-stopped` for production services
- Container names must match service directory names
- Named volumes for persistent data (e.g., `ollama`, `caddy_data`)
- External networks for service communication (e.g., `caddy-net`, `ollama-net`)
- Bind ports to specific IPs via `${SERVER_IP}:port:port` pattern
- Include comments explaining non-obvious configurations

### .env Files & Gitignore
- Group patterns by category with section headers
- Use `# ─── Category ────` style separators
- Never commit `.env` files or secrets
- Keep important YAML files in `.gitignore` with `!pattern` exclusions

## File Structure
- Each service in its own directory with `docker-compose.yml`
- `.env.example` files document required environment variables
- Custom configs/scripts go in service subdirectories
- Use consistent naming: service directories → container names

## Verification & Status
- Use `docker ps` to check running containers
- Use `docker compose ps` to check service status
- Use `docker inspect <container>` for detailed container info
- Use `docker logs <container>` to view logs

## Security & Best Practices
- Never commit `.env` files or secrets (see `.gitignore`)
- Use external networks for service communication
- Bind ports to specific IPs via `${SERVER_IP}:port:port`
- Store persistent data in named volumes or bind mounts
- Use read-only mounts for system files and security-sensitive mounts (docker.sock, certificates)