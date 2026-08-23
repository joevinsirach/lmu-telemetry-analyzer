#!/bin/bash
# Double-clic Finder : démarre la bridge et ouvre le viewer dans Google Chrome.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

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

exec "$NODE_EXE" lmu-bridge.js
