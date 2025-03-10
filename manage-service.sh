#!/bin/bash

# Set base directory
BASE_DIR="$HOME/docker"

# Check if the correct number of arguments is passed
if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <service_name> <up|down>"
    exit 1
fi

# Assign input arguments
SERVICE_NAME=$1
ACTION=$2

# Validate action
if [[ "$ACTION" != "up" && "$ACTION" != "down" ]]; then
    echo "Error: Action must be 'up' or 'down'"
    exit 1
fi

# Check if the service folder exists
SERVICE_PATH="$BASE_DIR/$SERVICE_NAME"
if [ ! -d "$SERVICE_PATH" ]; then
    echo "Error: Service '$SERVICE_NAME' does not exist in $BASE_DIR"
    exit 1
fi

# Check if docker-compose.yml exists in the service folder
COMPOSE_FILE="$SERVICE_PATH/docker-compose.yml"
if [ ! -f "$COMPOSE_FILE" ]; then
    echo "Error: No docker-compose.yml found in $SERVICE_PATH"
    exit 1
fi

# Execute the action
echo "Running 'docker compose $ACTION' for $SERVICE_NAME..."
(cd "$SERVICE_PATH" && docker compose $ACTION -d)

echo "Service '$SERVICE_NAME' is now $ACTION-ed."
