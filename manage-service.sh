#!/bin/bash

# Set base directory
BASE_DIR="$HOME/***REMOVED***"

# Args: stack_dir, action (u|d|r), optional flags (e.g., p, b, pb)
if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
    echo "Usage: $0 <stack_dir> <u|d|r> [flags]"
    echo "  flags: p = pull images before up (whole stack), b = build (use --build)"
    exit 1
fi

STACK_DIR_RAW=$1
STACK_DIR="${STACK_DIR_RAW%/}"   # accept "karakeep/" or "karakeep"
ACTION=$2
FLAGS=${3:-}  # optional; may contain 'p' and/or 'b'

# Validate action
if [[ "$ACTION" != "u" && "$ACTION" != "d" && "$ACTION" != "r" ]]; then
    echo "Error: Action must be '(u)p', '(d)own', or '(r)estart'"
    exit 1
fi

# Validate flags (only p/b allowed)
if [[ -n "$FLAGS" && ! "$FLAGS" =~ ^[pb]+$ ]]; then
    echo "Error: Flags may only include 'p' and/or 'b' (e.g., 'p', 'b', 'pb')"
    exit 1
fi

STACK_PATH="$BASE_DIR/$STACK_DIR"
COMPOSE_FILE="$STACK_PATH/docker-compose.yml"

if [ ! -d "$STACK_PATH" ]; then
    echo "Error: Stack '$STACK_DIR' does not exist in $BASE_DIR"
    exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
    echo "Error: No docker-compose.yml found in $STACK_PATH"
    exit 1
fi

echo "Running action '$ACTION' for stack '$STACK_DIR'..."

cd "$STACK_PATH" || exit 1

if [[ "$ACTION" == "u" ]]; then
    # Pull only if 'p' flag present (whole stack)
    if [[ "$FLAGS" == *p* ]]; then
        echo "Pulling latest images for stack '$STACK_DIR'..."
        docker compose pull || exit 1
    fi

    # Build if 'b' flag present, otherwise normal up (whole stack)
    if [[ "$FLAGS" == *b* ]]; then
        echo "Bringing stack up with build (--build)..."
        docker compose up -d --build || exit 1
    else
        echo "Bringing stack up without build..."
        docker compose up -d || exit 1
    fi

elif [[ "$ACTION" == "r" ]]; then
    # Restart ignores flags by design (no pull/build)
    if [[ -n "$FLAGS" ]]; then
        echo "Note: flags are ignored for restart."
    fi
    echo "Restarting stack '$STACK_DIR'..."
    docker compose restart || exit 1

else
    echo "Bringing stack down..."
    docker compose down || exit 1
fi

# echo "Stack '$STACK_DIR' action '$ACTION' completed."
