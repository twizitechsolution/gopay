#!/bin/bash
# ==============================================================================
# Gopay aaPanel Automated Git Webhook Deployment Script
# Place this script inside aaPanel -> WebHook -> "gopay_deploy"
# ==============================================================================

set -e

PROJECT_ROOT="/www/wwwroot/gopay"
BACKEND_DIR="$PROJECT_ROOT/backend"

echo "--------------------------------------------------------"
echo "🚀 [$(date '+%Y-%m-%d %H:%M:%S')] Starting Gopay Auto-Deployment from GitHub..."
echo "--------------------------------------------------------"

# 1. Pull latest commit from GitHub
if [ -d "$PROJECT_ROOT/.git" ]; then
    echo "📥 Pulling latest changes from GitHub (main branch)..."
    cd "$PROJECT_ROOT"
    git fetch origin main
    git reset --hard origin/main
else
    echo "⚠️ Git repository not found at $PROJECT_ROOT. Please clone your repository first:"
    echo "git clone https://github.com/twizitechsolution/gopay.git $PROJECT_ROOT"
    exit 1
fi

# 2. Update backend dependencies if needed
echo "📦 Checking and installing backend dependencies..."
cd "$BACKEND_DIR"
npm install --production --no-audit

# 3. Reload or start backend PM2 process
echo "🔄 Reloading Gopay Backend Server in PM2..."
if pm2 describe gopay-backend > /dev/null 2>&1; then
    pm2 reload gopay-backend --update-env
else
    pm2 start ecosystem.config.json --name "gopay-backend"
fi

pm2 save

echo "--------------------------------------------------------"
echo "✅ [$(date '+%Y-%m-%d %H:%M:%S')] Gopay successfully deployed and running live!"
echo "--------------------------------------------------------"
