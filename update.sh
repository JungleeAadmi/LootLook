#!/bin/bash

# --- LootLook Universal Updater ---
# Usage: curl -sL https://raw.githubusercontent.com/JungleeAadmi/LootLook/main/update.sh | bash

APP_DIR="$HOME/LootLook"

echo ">>> 🚀 LootLook Updater (Aggressive Mode)"

if [ ! -d "$APP_DIR" ]; then
    echo "❌ Error: LootLook directory not found at $APP_DIR"
    exit 1
fi

# 1. Pull Code
echo ">>> [1/5] Pulling latest code..."
cd "$APP_DIR"
git reset --hard origin/main
git pull

# 2. Update Server
echo ">>> [2/5] Updating Server Logic..."
cd "$APP_DIR/server"
rm -rf node_modules
npm install

# 3. Update Client (Clean Build)
echo ">>> [3/5] Rebuilding Frontend (Clean Slate)..."
cd "$APP_DIR/client"
rm -rf node_modules dist
npm install
npm run build

# 4. Restart Process
echo ">>> [4/5] Restarting Service..."
pm2 restart lootlook

echo "✅ Update Complete at $(date)"
echo "👉 PLEASE REFRESH YOUR BROWSER (CTRL+SHIFT+R)"