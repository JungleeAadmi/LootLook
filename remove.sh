#!/bin/bash

# --- LootLook Remover ---
# Usage: curl -sL https://raw.githubusercontent.com/JungleeAadmi/LootLook/main/remove.sh | bash

APP_DIR="$HOME/LootLook"

echo "🛑 LootLook Removal Wizard"

if [ ! -d "$APP_DIR" ]; then
    echo "❌ LootLook is not installed at $APP_DIR"
    exit 1
fi

# 1. Stop Service
echo ">>> Stopping background service..."
pm2 stop lootlook 2>/dev/null
pm2 delete lootlook 2>/dev/null
pm2 save

# 2. Backup
# We assume YES for backup if running via curl to be safe, or use default logic
echo ">>> Backing up database to $HOME..."
BACKUP_NAME="lootlook_backup_$(date +%F_%H-%M).db"
if [ -f "$APP_DIR/database/lootlook.db" ]; then
    cp "$APP_DIR/database/lootlook.db" "$HOME/$BACKUP_NAME"
    echo "✅ Database saved to: $HOME/$BACKUP_NAME"
else
    echo "⚠️  No database found to backup."
fi

echo ">>> Service stopped. Files remain in $APP_DIR."
echo ">>> To delete files completely, run the nuke command."