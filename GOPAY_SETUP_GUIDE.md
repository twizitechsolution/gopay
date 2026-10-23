# 🚀 Gopay - Master Setup, Local Testing & Deployment Guide

Welcome to **Gopay**! This platform has been completely rebranded from Airwalks/Airwallex to **Gopay** across the entire codebase, including all backend API endpoints, admin dashboard, user web interface, Telegram links, graphics, and native mobile Android APK.

---

## 📌 Quick Summary of Changes
1. **Brand Renamed Everywhere**: All occurrences of `Airwalks`, `Airwallex`, `airwalx`, etc. have been cleanly replaced with **`Gopay`** / **`gopay`**.
2. **Telegram Links Updated**: All channel and customer care links updated to `https://t.me/Gopay`.
3. **Logos & Icons Generated**: Fresh modern gradient **Gopay** app icons, banner logos, and white logos created in `user_web/` and `android_apk/`.
4. **Android APK Rebuilt**: Fresh signed, 4-byte aligned Android APK `Gopay.apk` (36.37 MB) generated in `android_apk/` and placed in `user_web/Gopay.apk` for in-app downloads.
5. **Unified Local Server Setup**: Backend and frontends are configured so running the server gives instant access to User Web, Admin Panel, and API on a single port (`5000`) without CORS issues.

---

## ⚡ How to Run Locally (1-Click)

### Method 1: Using the Batch Launcher (Easiest)
Simply double-click:
```text
RUN_GOPAY.bat
```
This will automatically launch the server and open both the User App and Admin Dashboard in your browser!

### Method 2: Command Line
```powershell
cd backend
node src/server.js
```

---

## 🌐 Local Access URLs

| Application / Service | Local URL | Description |
| :--- | :--- | :--- |
| **User Web Application** | `http://localhost:5000` | Full user-facing investment & payout app |
| **Admin Dashboard** | `http://localhost:5000/admin` | Management portal for orders, users, plans |
| **Backend API Health** | `http://localhost:5000/api/health` | API health check & server status |
| **Android APK Direct Download** | `http://localhost:5000/Gopay.apk` | Download signed Android APK |

---

## 🔐 Credentials & Default Logins

### 1. Admin Panel Direct Login:
- **Username**: `gopayadmin`
- **Password**: `gopay@143#!` (or `admin123`)

### 2. Super Admin User (Database):
- **Mobile**: `9999999999`
- **PIN**: `1234`
- **Password**: `admin123`
- **UID**: `M100001`
- **Referral Code**: `admin001`

### 3. User Registration / OTP Testing:
- Any 10-digit mobile number can be registered.
- **Bypass OTP for instant testing**: `123456`

---

## 📱 Rebuilding Android APK for Live Server / Custom IP

Whenever you deploy to a live domain or VPS, you can regenerate a brand new signed `Gopay.apk` in one command:

```powershell
python android_apk/rebrand_and_build_apk.py "Gopay" "yourdomain.com" "https://api.yourdomain.com/api" "com.gopay.app"
```

The script will automatically:
1. Extract and update `capacitor.config.json`.
2. Update all internal API URLs to your live domain.
3. Replace the launcher icon with `gopay_icon.png`.
4. Run 4-byte alignment (`zipalign`).
5. Sign the APK using `release.keystore` (Scheme v1 & v2).
6. Output `android_apk/Gopay.apk` ready for distribution.

---

## 🚀 Live Server Deployment (When Ready)

### Option A: Cloud VPS (Ubuntu + Nginx + PM2)
1. **Copy files to VPS**:
   - Backend: `/var/www/gopay_backend`
   - User Web: `/var/www/gopay_web`
   - Admin Panel: `/var/www/gopay_admin`
2. **Start Backend with PM2**:
   ```bash
   cd /var/www/gopay_backend
   npm install --production
   pm2 start ecosystem.config.json --name "gopay-backend"
   pm2 save
   ```
3. **Nginx Reverse Proxy**:
   - Point your main domain (e.g. `gopay.online`) to `/var/www/gopay_web`
   - Point admin subdomain (e.g. `admin.gopay.online`) to `/var/www/gopay_admin`
   - Proxy `/api/` to `http://127.0.0.1:5000`

### Option B: Vercel (100% Serverless)
Each folder (`backend`, `admin_panel`, `user_web`) already has a pre-configured `vercel.json`:
1. `cd backend && vercel --prod`
2. `cd ../admin_panel && vercel --prod`
3. `cd ../user_web && vercel --prod`
