# 🚀 GitHub + aaPanel Automated Deployment Guide for Gopay

Aapke project ka local Git repository initialize ho chuka hai aur saare files commit ho chuke hain.
Ab aapko files manually upload karne ki zaroorat nahi padegi! Jab bhi aap GitHub par code push karenge, aaPanel automatic live ho jayega.

---

## 📌 Step 1: Apne GitHub par New Repository Banayein
1. [GitHub](https://github.com/new) par jayein aur ek nayi repository banayein (e.g. `gopay`).
2. Repository ko **Public** ya **Private** select karein (Private recommended).
3. "Initialize this repository with a README" ko **uncheck** rehne dein.
4. Repository create hone ke baad uska URL copy karein (e.g. `https://github.com/your-username/gopay.git`).

---

## 💻 Step 2: Local Code ko GitHub par Push Karein
Apne computer ke terminal / PowerShell mein ye do commands chalayein:

```powershell
git remote add origin https://github.com/twizitechsolution/gopay.git
git push -u origin main
```

---

## 🖥️ Step 3: aaPanel Server par Initial Clone Karein
Apne aaPanel server terminal (SSH) mein jayein aur ye run karein:

```bash
# 1. Root directory mein jayein
cd /www/wwwroot

# 2. GitHub repository clone karein
git clone https://github.com/twizitechsolution/gopay.git gopay

# 3. Backend dependencies install karein
cd /www/wwwroot/gopay/backend
npm install --production

# 4. Environment file banayein
cp .env.example .env
nano .env
```
*( `.env` mein apna aaPanel MySQL password aur database name `gopay_db` set kar dein).*

---

## ⚡ Step 4: aaPanel Webhook Setup (Auto-Deploy on Git Push)

Ye setting karne ke baad, jab bhi aap PC par `git push` karenge, aaPanel apne aap naya code pull karega aur server restart kar dega:

1. **aaPanel App Store** mein jayein aur search karein: **WebHook**
2. **WebHook** plugin install karein aur open karein.
3. **Add Hook** par click karein:
   - **Name**: `gopay_deploy`
   - **Script**: Niche diya gaya script paste karein:
```bash
#!/bin/bash
echo "=== Starting Gopay Deployment from GitHub ==="
date

cd /www/wwwroot/gopay
git fetch origin main
git reset --hard origin/main

cd /www/wwwroot/gopay/backend
npm install --production --no-audit

# PM2 reload
if pm2 describe gopay-backend > /dev/null 2>&1; then
    pm2 reload gopay-backend --update-env
else
    pm2 start ecosystem.config.json --name "gopay-backend"
fi
pm2 save

echo "=== Deployment Finished Successfully ==="
```
4. Click **Submit**.
5. Hook list mein `gopay_deploy` ke aage **View Key** par click karein aur **Webhook URL** copy karein:
   - Example: `http://your-server-ip:8888/hook?access_key=xxxxxxxx&params=gopay_deploy`

---

## 🔗 Step 5: GitHub Repository mein Webhook Add Karein
1. Apne GitHub repository mein jayein -> **Settings** tab par click karein.
2. Left menu se **Webhooks** par click karein -> **Add webhook**.
3. **Payload URL**: aaPanel se copy kiya hua Webhook URL paste karein.
4. **Content type**: `application/json` select karein.
5. **Which events would you like to trigger this webhook?**: `Just the push event`.
6. Click **Add webhook**.

---

## 🎉 Result (Ab se Kaise Kaam Hoga):
Jab bhi aap apne PC par koi bhi change karenge, bas ye 3 commands chalana hai:
```powershell
git add .
git commit -m "Update payment feature / branding"
git push origin main
```
👉 **GitHub** automatically aaPanel ke webhook ko ping karega.
👉 **aaPanel** latest code pull karke backend ko zero-downtime reload kar dega!
