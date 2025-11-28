#!/bin/bash

# --- LootLook Nuke ---
# Usage: curl -sL https://raw.githubusercontent.com/JungleeAadmi/LootLook/main/nuke.sh | bash

APP_DIR="$HOME/LootLook"

echo "☢️  NUCLEAR OPTION INITIATED ☢️"
echo "Target: $APP_DIR"

if [ ! -d "$APP_DIR" ]; then
    echo "❌ Nothing to nuke here."
    exit 1
fi

echo "!!! WARNING: This will delete the App and Data immediately. !!!"
echo "To proceed, you have 5 seconds to press Ctrl+C"
sleep 5

echo ">>> Destroying..."
pm2 delete lootlook 2>/dev/null
rm -rf "$APP_DIR"

echo "💥 LootLook has been removed."