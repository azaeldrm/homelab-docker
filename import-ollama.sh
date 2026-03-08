#!/bin/bash
# Usage: ./ollama-import.sh <hf_gguf_url> <model_name> [num_ctx] [temperature]

HF_URL=$1
MODEL_NAME=$2
NUM_CTX=${3:-32768}
TEMPERATURE=${4:-1.0}
CONTAINER=${OLLAMA_CONTAINER:-ollama}

if [ -z "$HF_URL" ] || [ -z "$MODEL_NAME" ]; then
  echo "Usage: $0 <hf_gguf_url> <model_name> [num_ctx] [temperature]"
  exit 1
fi

TMPFILE="/tmp/${MODEL_NAME}.gguf"
MODELFILE="/tmp/${MODEL_NAME}.Modelfile"

echo "⬇️  Downloading model..."
curl -L "$HF_URL" -o "$TMPFILE" || { echo "❌ Download failed"; exit 1; }

echo "📝 Creating Modelfile..."
cat <<EOF > "$MODELFILE"
FROM /tmp/${MODEL_NAME}.gguf
PARAMETER temperature $TEMPERATURE
PARAMETER num_ctx $NUM_CTX
EOF

echo "📦 Copying into container..."
docker cp "$TMPFILE" "${CONTAINER}:/tmp/" || { echo "❌ docker cp failed"; exit 1; }
docker cp "$MODELFILE" "${CONTAINER}:/tmp/" || { echo "❌ docker cp failed"; exit 1; }

echo "🔨 Registering model with Ollama..."
docker exec -it "$CONTAINER" ollama create "$MODEL_NAME" -f "/tmp/${MODEL_NAME}.Modelfile" || { echo "❌ ollama create failed"; exit 1; }

echo "🧹 Cleaning up..."
rm "$TMPFILE" "$MODELFILE"

echo "✅ $MODEL_NAME is ready!"
