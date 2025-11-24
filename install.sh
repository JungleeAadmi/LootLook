#!/bin/bash

# --- LootLook Universal Installer ---
# Usage: curl -sL https://raw.githubusercontent.com/JungleeAadmi/LootLook/main/install.sh | bash

APP_DIR="$HOME/LootLook"
REPO_URL="https://github.com/JungleeAadmi/LootLook.git"

echo ">>> 🔍 Starting LootLook Installation..."
echo ">>> Target Directory: $APP_DIR"

# 1. System Prep & Timezone (Critical for schedulers)
echo ">>> [1/6] System Preparation..."
if [ "$EUID" -ne 0 ]; then
  echo "--- Requesting sudo permissions for system updates..."
fi
sudo apt-get update && sudo apt-get upgrade -y

echo "--- Configuring Timezone..."
# Non-interactive timezone config to prevent hanging in curl pipe
if [ ! -f /etc/timezone ]; then
    sudo dpkg-reconfigure tzdata
else
    echo "--- Timezone already set to $(cat /etc/timezone)"
fi

# 2. Install System Dependencies (Ubuntu Plucky/Modern Support)
echo ">>> [2/6] Installing System Dependencies..."
sudo apt-get install -y \
  curl git unzip sqlite3 \
  ca-certificates fonts-liberation libasound2t64 \
  libatk-bridge2.0-0t64 libatk1.0-0t64 libc6 libcairo2 libcups2t64 \
  libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc1 libglib2.0-0t64 \
  libgtk-3-0t64 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 \
  libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 \
  libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 \
  libxtst6 lsb-release wget xdg-utils

# 3. Clone Repository
echo ">>> [3/6] Fetching Code..."
if [ -d "$APP_DIR" ]; then
    echo "--- Directory exists. Pulling latest changes..."
    cd "$APP_DIR" && git pull
else
    echo "--- Cloning from GitHub..."
    git clone "$REPO_URL" "$APP_DIR"
    cd "$APP_DIR"
fi

# 4. Node.js Environment
echo ">>> [4/6] Setting up Node.js..."
if ! command -v node &> /dev/null; then
    echo "--- Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi
# Ensure PM2 is installed
sudo npm install -g pm2

# 5. Application Build
echo ">>> [5/6] Building Application..."
echo "--- Installing Server Dependencies..."
cd "$APP_DIR/server" && npm install
echo "--- Installing Client Dependencies & Building..."
cd "$APP_DIR/client" && npm install && npm run build

# 6. Database & Startup
echo ">>> [6/6] Finalizing..."
mkdir -p "$APP_DIR/database"

echo "--- Starting Service..."
pm2 delete lootlook 2>/dev/null || true
cd "$APP_DIR/server"
pm2 start index.js --name lootlook
pm2 save
pm2 startup | grep "sudo" | bash 2>/dev/null # Auto-configure startup

# Make scripts executable for local use later
chmod +x "$APP_DIR"/*.sh

echo "✅ LootLook Installation Complete!"
echo "   Access it at http://$(hostname -I | cut -d' ' -f1):3001"