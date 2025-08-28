# Docker Homelab Agent Guidelines

## Build/Deploy Commands
- **Start service**: `./manage-service.sh <service> u [flags]` (flags: p=pull, b=build)
- **Stop service**: `./manage-service.sh <service> d`
- **Restart service**: `./manage-service.sh <service> r`
- **View logs**: `cd <service>/ && docker compose logs -f`
- **Test single service**: `cd <service>/ && docker compose up -d --build`

## Code Style & Configuration
- Use YAML for docker-compose files with 2-space indentation
- Environment variables go in `.env` files (copy from `.env.example`)
- Container names should match service directory names
- Use `restart: unless-stopped` for production services
- Mount volumes for persistent data and configuration files

## File Structure
- Each service in its own directory with `docker-compose.yml`
- `.env.example` files document required environment variables
- Custom configs/scripts go in service subdirectories
- Use comments with `#` prefix for documentation

## Security & Best Practices
- Never commit `.env` files or secrets (see `.gitignore`)
- Use external networks for service communication
- Bind ports to specific IPs via `${SERVER_IP}:port:port`
- Store persistent data in named volumes or bind mounts