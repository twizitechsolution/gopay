# 🚀 Gopay aaPanel & MySQL Live Server Deployment Guide

Complete step-by-step guide for deploying **Gopay** (User Web, Admin Dashboard, Backend API & Native APK) on a live server running **aaPanel** with local **MySQL**.

---

## 📋 Pre-requisites on your aaPanel Server
Inside your aaPanel dashboard (App Store):
1. **Nginx** (Installed, e.g. 1.22 / 1.24)
2. **MySQL** (Installed, 5.7 or 8.0)
3. **Node.js Version Manager** or **PM2 Manager** (Installed via App Store, Node v18 / v20 / v22)
4. **phpMyAdmin** (Optional, for easy MySQL import via browser)

---

## 🗄️ Step 1: Create & Import MySQL Database in aaPanel

1. In aaPanel, go to **Databases** in the left menu.
2. Click **Add Database**:
   - **Database Name**: `gopay_db`
   - **DB Type**: MySQL / utf8mb4
   - **Username**: `gopay_db` (or your choice)
   - **Password**: *(Set a strong password and save it)*
   - **Access Permission**: `Local server` (127.0.0.1)
   - Click **Submit**.
3. **Import SQL Schema**:
   - In aaPanel Databases list, click **Import** next to `gopay_db`.
   - Upload and import [`gopay_schema.sql`](file:///c:/Users/nirod/OneDrive/Desktop/gopay/gopay_schema.sql) (located in your project root).
   - *Alternatively via phpMyAdmin*: Open phpMyAdmin -> select `gopay_db` -> click **Import** tab -> choose `gopay_schema.sql` -> click **Go**.

> **Note**: `gopay_schema.sql` automatically creates all required tables (`users`, `orders`, `bank_accounts`, `transactions`, `withdrawals`, `products`, `settings`, etc.) and seeds default admin credentials and plans.

---

## 📂 Step 2: Upload Project Files to aaPanel

In aaPanel, go to **Files** and create these folders under `/www/wwwroot/`:

```text
/www/wwwroot/
├── gopay_backend/        <-- Upload contents of your local 'backend/' folder
├── gopay_user_web/       <-- Upload contents of your local 'user_web/' folder
└── gopay_admin_panel/    <-- Upload contents of your local 'admin_panel/' folder
```

*Tip: You can zip each folder on your PC, upload the zip in aaPanel Files, and click "Unzip" for 10x faster upload.*

---

## ⚙️ Step 3: Configure Backend Environment (`.env`)

Inside `/www/wwwroot/gopay_backend/`:
1. Create or edit `.env` file (copy from `.env.example`):
```env
PORT=5000
NODE_ENV=production
JWT_SECRET=Gopay_super_secret_jwt_key_2026

# Admin Credentials
ADMIN_USER=gopayadmin
ADMIN_PASS=gopay@143#!

# MySQL Database (aaPanel Local MySQL)
DB_TYPE=mysql
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=gopay_db
MYSQL_PASSWORD=your_aapanel_mysql_password
MYSQL_DATABASE=gopay_db
```
*(Replace `your_aapanel_mysql_password` with the password you set in Step 1).*

---

## 🚀 Step 4: Run Backend with Node.js / PM2 in aaPanel

### Method A: Using aaPanel "Node Project" (Recommended GUI)
1. Go to **Website** -> **Node project** tab -> **Add Node project**.
2. Fill the settings:
   - **Project Name**: `gopay-backend`
   - **Run Opt**: `start`
   - **Project Path**: `/www/wwwroot/gopay_backend`
   - **Run file**: `src/server.js`
   - **Node version**: Select Node `v18.x`, `v20.x`, or `v22.x`
   - **Port**: `5000`
3. Click **Submit**.
4. aaPanel will install dependencies (`npm install`) and start the server.
5. Click on the project name and check **Project log** to confirm:
   ```text
   [MySQL] Successfully connected to database "gopay_db" on 127.0.0.1:3306
   Gopay Backend API running at http://localhost:5000
   ```

### Method B: Using SSH Terminal + PM2
```bash
cd /www/wwwroot/gopay_backend
npm install --production
pm2 start ecosystem.config.json --name "gopay-backend"
pm2 save
pm2 startup
```

---

## 🌐 Step 5: Setup Websites & Nginx in aaPanel

### Site 1: User Web App (`yourdomain.com`)
1. In aaPanel, go to **Website** -> **Add site**.
2. **Domain name**: `yourdomain.com` (and `www.yourdomain.com`)
3. **Root directory**: `/www/wwwroot/gopay_user_web`
4. Click **Submit**.
5. Click **Settings** on the site -> go to **Config** (Nginx Configuration) -> Add inside `server { ... }`:
   ```nginx
   # API Reverse Proxy
   location /api/ {
       proxy_pass http://127.0.0.1:5000/api/;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       client_max_body_size 50m;
   }

   # Uploads proxy
   location /uploads/ {
       proxy_pass http://127.0.0.1:5000/uploads/;
       proxy_set_header Host $host;
   }

   # React SPA routing
   location / {
       try_files $uri $uri/ /index.html;
   }
   ```
6. Click **Save**.

### Site 2: Admin Dashboard (`admin.yourdomain.com`)
1. In aaPanel, go to **Website** -> **Add site**.
2. **Domain name**: `admin.yourdomain.com`
3. **Root directory**: `/www/wwwroot/gopay_admin_panel`
4. Click **Submit**.
5. Click **Settings** on the site -> go to **Config** (Nginx Configuration) -> Add inside `server { ... }`:
   ```nginx
   # API Reverse Proxy
   location /api/ {
       proxy_pass http://127.0.0.1:5000/api/;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       client_max_body_size 50m;
   }

   # Uploads proxy
   location /uploads/ {
       proxy_pass http://127.0.0.1:5000/uploads/;
       proxy_set_header Host $host;
   }

   # React SPA routing
   location / {
       try_files $uri $uri/ /index.html;
   }
   ```
6. Click **Save**.

### Free SSL (HTTPS) for both sites:
In aaPanel, for each site -> **Settings** -> **SSL** tab -> select **Let's Encrypt** -> check domains -> click **Apply**.
Enable **Force HTTPS**.

---

## 📱 Step 6: Generate Branded APK for Your Live Domain

Once your live domain is pointed to your server:
Run this single command on your PC to compile and sign a production `.apk` that connects to your live server:

```powershell
python android_apk/rebrand_and_build_apk.py "Gopay" "yourdomain.com" "https://yourdomain.com/api" "com.gopay.app"
```

1. This outputs: `android_apk/Gopay.apk` (Signed with production keystore).
2. Copy `Gopay.apk` into `/www/wwwroot/gopay_user_web/Gopay.apk`.
3. Now any user who visits `https://yourdomain.com` can download and install the app!

---

## 🔐 Production Login Credentials

- **Admin Dashboard**: `https://admin.yourdomain.com`
  - **Username**: `gopayadmin`
  - **Password**: `gopay@143#!` (or `admin123`)
- **Super Admin (User / PIN login)**:
  - **Mobile**: `9999999999`
  - **PIN**: `1234`
- **Telegram Channel**: `https://t.me/Gopay`
- **User SMS OTP Bypass (for testing)**: `123456`
