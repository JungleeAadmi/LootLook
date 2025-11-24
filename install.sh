#!/bin/bash

# --- LootLook Universal Installer ---
# Usage: curl -sL https://raw.githubusercontent.com/JungleeAadmi/LootLook/main/install.sh | bash

APP_DIR="$HOME/LootLook"
REPO_URL="https://github.com/JungleeAadmi/LootLook.git"

echo ">>> 🔍 Starting LootLook Installation..."
echo ">>> Target Directory: $APP_DIR"

# 1. System Prep & Timezone
echo ">>> [1/6] System Preparation..."

# Fix: Force apt to not ask questions (Non-Interactive Mode)
export DEBIAN_FRONTEND=noninteractive

if [ "$EUID" -ne 0 ]; then
  echo "--- Requesting sudo permissions..."
  # We use < /dev/tty here to ensure password prompt works via curl pipe
  sudo -v < /dev/tty
fi

echo "--- Updating System..."
sudo -E apt-get update && sudo -E apt-get upgrade -y

echo "--- Configuring Timezone..."
# Logic: If running via curl pipe, explicitly force input from terminal (/dev/tty)
if [ ! -f /etc/timezone ] && [ ! -f /etc/localtime ]; then
    echo "--- Timezone not set. Launching selector..."
    # THE FIX: < /dev/tty tells it to listen to keyboard, not the curl pipe
    sudo dpkg-reconfigure tzdata < /dev/tty
else
    # If it exists, we just show it. 
    # If you WANT to change it, run: sudo dpkg-reconfigure tzdata
    CURRENT_TZ=$(cat /etc/timezone 2>/dev/null || date +%Z)
    echo "--- Timezone is currently: $CURRENT_TZ"
fi

# 2. Install System Dependencies
echo ">>> [2/6] Installing System Dependencies..."
# -E preserves environment variables (like noninteractive)
sudo -E apt-get install -y \
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
    # We pipe this to bash, but it's non-interactive so it's safe
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo -E apt-get install -y nodejs
fi
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
pm2 startup | grep "sudo" | bash 2>/dev/null

# Make scripts executable
chmod +x "$APP_DIR"/*.sh

echo "✅ LootLook Installation Complete!"
echo "   Access it at http://$(hostname -I | cut -d' ' -f1):3001"