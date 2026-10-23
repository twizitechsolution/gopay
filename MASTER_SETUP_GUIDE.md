# 🚀 Master Setup & Deployment Guide: New Application Replica

Welcome to your complete application project bundle. This package contains everything required to launch a 100% independent clone of the platform under your new brand name, new logo, new domain, and fresh database.

---

## 📂 1. Directory Structure Overview

Inside this package, you will find 4 main modules and helper tools:

```text
New_App_Replica_Package/
├── backend/                  <-- Node.js / Express API Server & Database
│   ├── src/                  <-- Core controllers, routes, db.js, server.js
│   ├── data/
│   │   └── database.json     <-- Clean database starter (Zero users, 1 Super Admin)
│   ├── package.json
│   ├── ecosystem.config.json <-- PM2 configuration for VPS
│   ├── vercel.json           <-- Vercel deployment config
│   └── .env.example          <-- Environment variables template
│
├── admin_panel/              <-- Admin Dashboard (React SPA)
│   ├── index.html            <-- Entrypoint with latest v38 cache buster
│   ├── assets/               <-- Production JS, CSS, FontAwesome icons
│   ├── src/                  <-- Source React components (UserDetailsModal, Reports, etc.)
│   ├── favicon.svg           <-- Admin icon
│   └── vercel.json           <-- Vercel routing rules
│
├── user_web/                 <-- User Facing Web Application (SPA)
│   ├── index.html            <-- User application entrypoint
│   ├── assets/               <-- Production JS, CSS, 3D icons, UI assets
│   ├── gopay_logo.png    <-- Replace with your new logo
│   ├── gopay_icon.png    <-- Replace with your new app icon
│   └── vercel.json
│
├── android_apk/              <-- Native Android App Builder
│   ├── base_app.apk          <-- Native Capacitor base APK
│   ├── release.keystore      <-- Android cryptographic keystore
│   └── rebrand_and_build_apk.py <-- 1-Click APK rebuilder & signer script
│
├── AUTO_RENAME_TOOL.py       <-- 1-Click project-wide renamer script
└── MASTER_SETUP_GUIDE.md     <-- This master guide
```

---

## ⚡ 2. Rebrand in 1 Single Step (Automated)

Instead of manually editing hundreds of files, simply run the automated renaming script:

```bash
python AUTO_RENAME_TOOL.py "YourAppName" "yourdomain.com" "admin.yourdomain.com" "https://api.yourdomain.com/api"
```

**Or run interactively:**
```bash
python AUTO_RENAME_TOOL.py
```
It will prompt you for:
1. **New App Name** (e.g. `PayFlow`)
2. **New User Domain** (e.g. `payflow.online`)
3. **Admin Domain** (e.g. `admin.payflow.online`)
4. **Backend API URL** (e.g. `https://api.payflow.online/api`)

Within 2 seconds, all API endpoints, brand names, and page titles across the entire backend, admin panel, and user web app will be updated!

---

## 🎨 3. Updating Logos & Icons

To change the visual branding:

### For User Web Application (`user_web/`):
Replace these image files with your new brand graphics (keep the filenames or update references):
- `gopay_logo.png` (Transparent PNG, recommended: 512x150 px)
- `gopay_icon.png` (Square PNG, recommended: 512x512 px)
- `Gopay_logo_white.png` (White version of logo for dark headers)
- `favicon.svg` (Browser tab icon)

### For Admin Panel (`admin_panel/`):
- `favicon.svg` (Admin tab icon)
- `admin_avatar.png` (Admin avatar)

---

## 🗄️ 4. Clean Database & Super Admin Login

The database is pre-configured with a clean slate in `backend/data/database.json`.

- **Total Registered Users**: 0 regular users
- **Default Super Admin Credentials**:
  - **Mobile**: `9999999999`
  - **PIN**: `1234`
  - **Password**: `admin123`
  - **UID**: `M100001`
  - **Referral Code**: `admin001`

*(Note: You can change the admin mobile number or PIN directly in `backend/data/database.json` before starting).*

---

## 🌐 5. Deployment Options

### Option A: Cloud VM / VPS (Ubuntu Linux / Nginx / PM2)

#### 1. Setup Backend:
```bash
cd backend
npm install --production
# Start with PM2
pm2 start ecosystem.config.json --name "newapp-backend"
pm2 save
```

#### 2. Setup Nginx Server Blocks:
Point your Nginx configurations to the folders:
- **Admin**: root `/var/www/admin_panel`
- **User Web**: root `/var/www/user_web`
- **Backend API**: proxy pass `http://127.0.0.1:5000` for `/api/`

#### 3. Free SSL Certificate:
```bash
sudo certbot --nginx -d yourdomain.com -d admin.yourdomain.com -d api.yourdomain.com
```

---

### Option B: Vercel (Serverless - 100% Free Hosting)

All three folders (`backend`, `admin_panel`, `user_web`) already contain `vercel.json`!

1. Install Vercel CLI:
   ```bash
   npm i -g vercel
   ```
2. Deploy Backend:
   ```bash
   cd backend
   vercel --prod
   ```
   (Note your backend URL, e.g. `https://your-backend.vercel.app/api`)
3. Deploy Admin Panel:
   ```bash
   cd ../admin_panel
   vercel --prod
   ```
4. Deploy User Web App:
   ```bash
   cd ../user_web
   vercel --prod
   ```

---

## 📱 6. Generating Your Branded Native Android APK

This package includes a 100% native Capacitor Android build tool (`android_apk/rebrand_and_build_apk.py`).

To generate a new, signed, production-ready `.apk`:

```bash
cd android_apk
python rebrand_and_build_apk.py "YourAppName" "yourdomain.com" "https://api.yourdomain.com/api" "com.yourapp.app"
```

### What this tool does automatically:
1. Extracts `base_app.apk`.
2. Updates `capacitor.config.json` with your new App Name & Package ID.
3. Points all internal API endpoints to your new backend URL.
4. Updates referral invite links.
5. 4-byte aligns the APK with `zipalign`.
6. Signs the APK with Android Scheme v1 & v2 using `release.keystore`.
7. Outputs `YourAppName.apk` ready for public distribution and device install!

---

## ✅ 7. Pre-Launch Checklist

- [ ] Run `AUTO_RENAME_TOOL.py` with your new name and domain.
- [ ] Replace logos in `user_web/`.
- [ ] Start Backend and verify `curl http://localhost:5000/api/health` or check in browser.
- [ ] Log in to Admin Panel using `9999999999` / PIN `1234`.
- [ ] Test User Registration and Login in `user_web/`.
- [ ] Generate your branded APK and install it on an Android phone.
- [ ] Test deposit and withdrawal flow.
