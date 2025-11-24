#!/bin/bash

# --- LootLook Universal Updater ---
# Usage: curl -sL https://raw.githubusercontent.com/JungleeAadmi/LootLook/main/update.sh | bash

APP_DIR="$HOME/LootLook"

echo ">>> 🚀 LootLook Updater"

if [ ! -d "$APP_DIR" ]; then
    echo "❌ Error: LootLook directory not found at $APP_DIR"
    echo "   Please run the install command first."
    exit 1
fi

# 1. Pull Code
echo ">>> [1/4] Pulling latest code..."
cd "$APP_DIR"
git pull

# 2. Update Server
echo ">>> [2/4] Updating Server Logic..."
cd "$APP_DIR/server"
npm install

# 3. Update Client
echo ">>> [3/4] Rebuilding Frontend..."
cd "$APP_DIR/client"
npm install
npm run build

# 4. Restart Process
echo ">>> [4/4] Restarting Service..."
pm2 restart lootlook

echo "✅ Update Complete at $(date)"