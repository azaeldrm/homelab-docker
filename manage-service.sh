#!/bin/bash

# Set base directory
BASE_DIR="$HOME/***REMOVED***"

# Args: service, action, optional flags (e.g., p, r, rp)
if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
    echo "Usage: $0 <service_name> <up|down> [flags]"
    echo "  flags: p = pull image before up, r = rebuild"
    exit 1
fi

SERVICE_NAME_RAW=$1
SERVICE_NAME="${SERVICE_NAME_RAW%/}"   # strip one trailing "/"
ACTION=$2
FLAGS=${3:-}  # optional; may contain 'p' and/or 'r'

# Validate action
if [[ "$ACTION" != "u" && "$ACTION" != "d" ]]; then
    echo "Error: Action must be '(u)p' or '(d)own'"
    exit 1
fi

# Validate flags (only p/r allowed)
if [[ -n "$FLAGS" && ! "$FLAGS" =~ ^[pr]+$ ]]; then
    echo "Error: Flags may only include 'p' and/or 'r' (e.g., 'p', 'r', 'rp')"
    exit 1
fi

SERVICE_PATH="$BASE_DIR/$SERVICE_NAME"
COMPOSE_FILE="$SERVICE_PATH/docker-compose.yml"

if [ ! -d "$SERVICE_PATH" ]; then
    echo "Error: Service '$SERVICE_NAME' does not exist in $BASE_DIR"
    exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
    echo "Error: No docker-compose.yml found in $SERVICE_PATH"
    exit 1
fi

echo "Running 'docker compose $ACTION' for $SERVICE_NAME..."

if [[ "$ACTION" == "u" ]]; then
    # Pull only if 'p' flag present
    if [[ "$FLAGS" == *p* ]]; then
        echo "Pulling latest image for $SERVICE_NAME..."
        (cd "$SERVICE_PATH" && docker compose pull "$SERVICE_NAME") || exit 1
    fi

    # Rebuild if 'r' flag present
    if [[ "$FLAGS" == *r* ]]; then
        echo "Rebuilding the service..."
        (cd "$SERVICE_PATH" && docker compose up -d --build "$SERVICE_NAME") || exit 1
    else
        echo "Starting without rebuild..."
        (cd "$SERVICE_PATH" && docker compose up -d "$SERVICE_NAME") || exit 1
    fi
else
    (cd "$SERVICE_PATH" && docker compose down) || exit 1
fi

# echo "Service '$SERVICE_NAME' is now $ACTION-ed."
