## 🔍 LootLook

***A self-hosted, stealthy price tracking application running on React and Node.js.***

LootLook allows you to track prices of products from various online stores (Amazon, eBay, etc.) and maintains a historical record of price changes. It uses a headless browser (Puppeteer) to bypass anti-bot protections and stores data locally in a lightweight SQLite database.

### ✨ Features

- 🕵️ Stealth Scraping: Uses Puppeteer with stealth plugins to bypass 403/CAPTCHA errors.

- 📊 Price Intelligence: Visual line charts showing price history over time.

- 📱 Mobile First: Responsive React UI that works perfectly on phones.

- 🧹 Auto-Janitor: Automatically deletes old data based on your retention settings (7, 30, 90, or 365 days).

- 🔔 Notifications: Integrated with ntfy.sh for instant price drop alerts.

### 🚀 One-Line Installation

Run this command on your LXC container or Ubuntu server. It handles everything (dependencies, timezone, installation).

```
curl -sL https://raw.githubusercontent.com/JungleeAadmi/LootLook/main/install.sh | bash
```
### 🛠️ Management Commands

Update App (Pull latest changes and rebuild):

```
curl -sL https://raw.githubusercontent.com/JungleeAadmi/LootLook/main/update.sh | bash

```
### Stop & Backup (Stops service, backs up DB, leaves files):

```
curl -sL https://raw.githubusercontent.com/JungleeAadmi/LootLook/main/remove.sh | bash

```

### Nuke (Delete EVERYTHING):
```
curl -sL https://raw.githubusercontent.com/JungleeAadmi/LootLook/main/nuke.sh | bash

```

### 🏗️ Tech Stack

Frontend: React + Vite

Backend: Node.js + Express

Database: SQLite3

Scraper: Puppeteer Extra + Stealth Plugin

Process Manager: PM2

### 📝 License

This project is open source.