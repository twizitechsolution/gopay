import os
import sys
import shutil
import zipfile
import subprocess
import json

def rebrand_apk(
    new_app_name,
    new_domain,
    new_backend_url=None,
    new_package_id=None,
    new_logo_path=None,
    output_apk=None
):
    base_dir = os.path.dirname(os.path.abspath(__file__))
    source_apk = os.path.join(base_dir, "base_app.apk")
    
    if not output_apk:
        output_apk = os.path.join(base_dir, f"{new_app_name.replace(' ', '_')}.apk")
    
    unaligned_apk = os.path.join(base_dir, "temp_unaligned.apk")
    temp_dir = os.path.join(base_dir, "temp_build")
    keystore_path = os.path.join(base_dir, "release.keystore")
    alias = "release_key"
    storepass = "release123"

    clean_domain = new_domain.replace("https://", "").replace("http://", "").rstrip("/")
    if not new_backend_url:
        new_backend_url = f"https://api.{clean_domain}/api"
    if not new_package_id:
        clean_name = ''.join(c for c in new_app_name.lower() if c.isalnum())
        new_package_id = f"com.{clean_name}.app"

    print("==================================================")
    print(f"  Rebranding & Building Native Android APK")
    print(f"  App Name:     {new_app_name}")
    print(f"  Package ID:   {new_package_id}")
    print(f"  Web Domain:   {clean_domain}")
    print(f"  Backend URL:  {new_backend_url}")
    print(f"  Output APK:   {output_apk}")
    print("==================================================")

    if not os.path.exists(source_apk):
        print(f"[ERROR] Source base APK not found at: {source_apk}")
        return False

    # 1. Read original compression types
    orig_compress_map = {}
    with zipfile.ZipFile(source_apk, 'r') as z_orig:
        for info in z_orig.infolist():
            orig_compress_map[info.filename] = info.compress_type

    if os.path.exists(temp_dir):
        shutil.rmtree(temp_dir)
    os.makedirs(temp_dir, exist_ok=True)

    # 2. Extract APK
    print("[1/5] Extracting base APK contents...")
    with zipfile.ZipFile(source_apk, 'r') as z:
        z.extractall(temp_dir)

    # 3. Remove old signature (META-INF)
    meta_inf = os.path.join(temp_dir, "META-INF")
    if os.path.exists(meta_inf):
        shutil.rmtree(meta_inf)

    # 4. Update assets/capacitor.config.json
    cap_cfg = os.path.join(temp_dir, "assets", "capacitor.config.json")
    if os.path.exists(cap_cfg):
        try:
            with open(cap_cfg, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            cfg["appId"] = new_package_id
            cfg["appName"] = new_app_name
            with open(cap_cfg, 'w', encoding='utf-8') as f:
                json.dump(cfg, f, indent=2)
            print("  -> Updated capacitor.config.json")
        except Exception as e:
            print(f"  -> Error updating capacitor.config.json: {e}")

    # 5. Replace branding in assets/public
    print("[2/5] Replacing API URL and Brand Name in bundled assets...")
    pub_dir = os.path.join(temp_dir, "assets")
    replaced = 0
    old_urls = [
        "https://airwallex-backend-seven.vercel.app/api",
        "https://airwallexus.online/api",
        "http://airwallexus.online/api",
        "https://airwalx.us.cc/api"
    ]
    old_brands = ["Airwallex", "airwallex", "AIRWALLEX", "Airwalks", "airwalks", "Airwalk", "airwalk"]

    for root, dirs, files in os.walk(pub_dir):
        for f in files:
            if f.endswith(('.js', '.html', '.css', '.json')):
                fp = os.path.join(root, f)
                try:
                    with open(fp, 'r', encoding='utf-8') as fh:
                        c = fh.read()
                    nc = c

                    # Replace backend API URLs
                    for u in old_urls:
                        nc = nc.replace(u, new_backend_url)

                    # Replace web domain for invites
                    nc = nc.replace("airwalx.us.cc", clean_domain)
                    nc = nc.replace("airwallexus.online", clean_domain)

                    # Replace Telegram links
                    nc = nc.replace("https://t.me/Airwallex", f"https://t.me/{new_app_name}")
                    nc = nc.replace("https://t.me/airwallex", f"https://t.me/{new_app_name}")
                    nc = nc.replace("https://t.me/your_channel", f"https://t.me/{new_app_name}")

                    # Replace token storage key
                    nc = nc.replace("Airwallex_token", f"{new_app_name}_token")
                    nc = nc.replace("airwallex_token", f"{new_app_name.lower()}_token")
                    nc = nc.replace("airwallex1@upi", f"{new_app_name.lower()}1@upi")

                    # Replace brand name
                    nc = nc.replace("Airwallex", new_app_name)
                    nc = nc.replace("airwallex", new_app_name.lower())
                    nc = nc.replace("Airwalks", new_app_name)
                    nc = nc.replace("airwalks", new_app_name.lower())
                    nc = nc.replace("Airwalk", new_app_name)
                    nc = nc.replace("airwalk", new_app_name.lower())

                    if nc != c:
                        with open(fp, 'w', encoding='utf-8') as fh:
                            fh.write(nc)
                        replaced += 1
                except Exception as e:
                    pass

    print(f"  -> Rebranded {replaced} asset files.")

    # 6. Optional: Replace App Icon if provided
    if not new_logo_path:
        default_icon = os.path.join(base_dir, "gopay_icon.png")
        if os.path.exists(default_icon):
            new_logo_path = default_icon

    if new_logo_path and os.path.exists(new_logo_path):
        print("[2b/5] Replacing app launcher icons...")
        res_dir = os.path.join(temp_dir, "res")
        if os.path.exists(res_dir):
            for root, dirs, files in os.walk(res_dir):
                for f in files:
                    if f.startswith("ic_launcher") and f.endswith(".png"):
                        target_ic = os.path.join(root, f)
                        try:
                            shutil.copy2(new_logo_path, target_ic)
                        except Exception as e:
                            pass
            print("  -> Launcher icons updated.")

    # 7. Repack APK
    print("[3/5] Compressing files into unaligned APK...")
    if os.path.exists(unaligned_apk):
        os.remove(unaligned_apk)

    with zipfile.ZipFile(unaligned_apk, 'w') as zout:
        for root, dirs, files in os.walk(temp_dir):
            for file in files:
                fp = os.path.join(root, file)
                rel = os.path.relpath(fp, temp_dir).replace('\\', '/')
                if rel == "resources.arsc" or rel.endswith('.png') or rel.endswith('.so'):
                    c_type = zipfile.ZIP_STORED
                elif rel in orig_compress_map:
                    c_type = orig_compress_map[rel]
                else:
                    c_type = zipfile.ZIP_DEFLATED
                zout.write(fp, rel, compress_type=c_type)

    shutil.rmtree(temp_dir)

    # 8. Zipalign (if available) or Rename
    tools_dir = r"C:\Users\nirod\tools\android-sdk\build-tools\34.0.0"
    zipalign_bin = os.path.join(tools_dir, "zipalign.exe")
    apksigner_bat = os.path.join(tools_dir, "apksigner.bat")

    has_zipalign = os.path.exists(zipalign_bin)
    if has_zipalign:
        print("[4/5] Aligning APK (4-byte alignment)...")
        if os.path.exists(output_apk):
            os.remove(output_apk)
        subprocess.run([zipalign_bin, "-p", "-f", "4", unaligned_apk, output_apk], capture_output=True)
        if os.path.exists(unaligned_apk):
            os.remove(unaligned_apk)
    else:
        if os.path.exists(output_apk):
            os.remove(output_apk)
        os.rename(unaligned_apk, output_apk)

    # 9. Sign APK
    print("[5/5] Signing APK with keystore...")
    signed = False
    if not os.path.exists(keystore_path):
        cmd_gen = [
            "keytool", "-genkeypair", "-v",
            "-keystore", keystore_path,
            "-alias", alias,
            "-keyalg", "RSA",
            "-keysize", "2048",
            "-validity", "10000",
            "-storepass", storepass,
            "-keypass", storepass,
            "-dname", f"CN={new_app_name}, OU=Mobile, O={new_app_name}, L=Mumbai, ST=Maharashtra, C=IN",
            "-noprompt"
        ]
        subprocess.run(cmd_gen, capture_output=True)

    if os.path.exists(apksigner_bat):
        cmd_sign = [
            "cmd.exe", "/c", apksigner_bat, "sign",
            "--ks", keystore_path,
            "--ks-key-alias", alias,
            "--ks-pass", f"pass:{storepass}",
            "--key-pass", f"pass:{storepass}",
            "--v1-signing-enabled", "true",
            "--v2-signing-enabled", "true",
            output_apk
        ]
        res = subprocess.run(cmd_sign, capture_output=True, text=True)
        if res.returncode == 0:
            signed = True
            print("  -> Signed successfully with apksigner (v1 + v2).")

    if not signed:
        cmd_jar = [
            "jarsigner", "-verbose",
            "-sigalg", "SHA256withRSA",
            "-digestalg", "SHA-256",
            "-keystore", keystore_path,
            "-storepass", storepass,
            output_apk, alias
        ]
        res = subprocess.run(cmd_jar, capture_output=True, text=True)
        if res.returncode == 0:
            signed = True
            print("  -> Signed successfully with jarsigner.")

    print("==================================================")
    print(f"[OK] APK Generation Completed!")
    print(f"File Location: {output_apk}")
    print(f"Size: {os.path.getsize(output_apk) / (1024*1024):.2f} MB")
    print("==================================================")
    return True

if __name__ == "__main__":
    if len(sys.argv) >= 3:
        name = sys.argv[1]
        domain = sys.argv[2]
        api_url = sys.argv[3] if len(sys.argv) > 3 else None
        pkg_id = sys.argv[4] if len(sys.argv) > 4 else None
        rebrand_apk(name, domain, api_url, pkg_id)
    else:
        print("Usage:")
        print("python rebrand_and_build_apk.py <AppName> <Domain> [BackendApiUrl] [PackageId]")
        print("Example:")
        print("python rebrand_and_build_apk.py 'CashPay' 'cashpay.online' 'https://api.cashpay.online/api' 'com.cashpay.app'")
