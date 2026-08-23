#!/bin/bash
# Double-clic Finder : démarre la bridge et ouvre le viewer dans Google Chrome.
# Copie hors de Documents : macOS bloque sinon Node (EPERM / TCC).
SRC="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
SUPPORT="$HOME/Library/Application Support/LMU Telemetry Analyzer"
mkdir -p "$SUPPORT"

echo "============================================================"
echo "  LMU Telemetrie-Analyse"
echo "------------------------------------------------------------"
echo "  Démarre le serveur local et ouvre Chrome"
echo "  (http://localhost:8777)"
echo "  Laisse cette fenêtre ouverte pendant l'utilisation."
echo "  Pour quitter : ferme la fenêtre Chrome ou Ctrl+C ici."
echo "============================================================"
echo

NODE_EXE=""
if command -v node >/dev/null 2>&1; then
  NODE_EXE="$(command -v node)"
elif [ -x "/opt/homebrew/bin/node" ]; then
  NODE_EXE="/opt/homebrew/bin/node"
elif [ -x "/usr/local/bin/node" ]; then
  NODE_EXE="/usr/local/bin/node"
fi

if [ -z "$NODE_EXE" ]; then
  echo "Node.js est introuvable."
  echo "Installe-le depuis https://nodejs.org puis relance ce fichier."
  echo
  read -r -p "Appuie sur Entrée pour fermer…"
  exit 1
fi

cp "$SRC/lmu-bridge.js" "$SRC/lmu-telemetry-analyzer.html" "$SUPPORT/" || {
  echo "Impossible de copier les fichiers vers :"
  echo "  $SUPPORT"
  echo
  read -r -p "Appuie sur Entrée pour fermer…"
  exit 1
}

export LMU_APP_SRC="$SRC"
if [ -z "$LMU_TELEMETRY_DIR" ] && [ -d "$SRC/telemetry" ]; then
  export LMU_TELEMETRY_DIR="$SRC/telemetry"
fi

# Remplace une ancienne instance de l'app, mais ne touche pas à un autre
# programme qui utiliserait éventuellement le même port.
EXISTING_CONFIG="$(curl -fsS --max-time 1 http://127.0.0.1:8777/api/config 2>/dev/null || true)"
if [[ "$EXISTING_CONFIG" == *'"telDir"'* && "$EXISTING_CONFIG" == *'"duckdb"'* ]]; then
  curl -fsS --max-time 1 http://127.0.0.1:8777/api/quit >/dev/null 2>&1 || true
  for _ in {1..20}; do
    curl -fsS --max-time 1 http://127.0.0.1:8777/api/config >/dev/null 2>&1 || break
    sleep 0.1
  done
fi

cd "$SUPPORT" || exit 1
exec "$NODE_EXE" lmu-bridge.js "$@"
