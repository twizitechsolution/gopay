import os
import sys
import shutil
import zipfile
import subprocess
import json
from PIL import Image

def rebrand_tpayx_to_gopay():
    base_dir = r"C:\Users\nirod\OneDrive\Desktop\gopay\android_apk"
    source_apk = r"C:\Users\nirod\OneDrive\Desktop\Data\airwallex\TpayX.apk"
    output_apk = os.path.join(base_dir, "Gopay.apk")
    unaligned_apk = os.path.join(base_dir, "temp_unaligned.apk")
    temp_dir = os.path.join(base_dir, "temp_tpayx_build")
    
    keystore_path = os.path.join(base_dir, "release.keystore")
    alias = "release_key"
    storepass = "release123"

    print("==================================================")
    print("  Rebranding TpayX.apk -> Gopay.apk")
    print(f"  Source: {source_apk}")
    print(f"  Target: {output_apk}")
    print("==================================================")

    if not os.path.exists(source_apk):
        print(f"[ERROR] Source APK not found at: {source_apk}")
        return False

    orig_compress_map = {}
    with zipfile.ZipFile(source_apk, 'r') as z_orig:
        for info in z_orig.infolist():
            orig_compress_map[info.filename] = info.compress_type

    if os.path.exists(temp_dir):
        shutil.rmtree(temp_dir)
    os.makedirs(temp_dir, exist_ok=True)

    # 1. Extract APK
    print("[1/5] Extracting TpayX APK contents...")
    with zipfile.ZipFile(source_apk, 'r') as z:
        z.extractall(temp_dir)

    # 2. Remove old signatures
    meta_inf = os.path.join(temp_dir, "META-INF")
    if os.path.exists(meta_inf):
        shutil.rmtree(meta_inf)

    # 3. Update assets/capacitor.config.json
    cap_cfg = os.path.join(temp_dir, "assets", "capacitor.config.json")
    if os.path.exists(cap_cfg):
        try:
            with open(cap_cfg, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            # Retain appId matching AndroidManifest.xml (com.tpayx.app)
            cfg["appId"] = "com.tpayx.app"
            cfg["appName"] = "Gopay"
            if "plugins" in cfg and "CapacitorHttp" in cfg["plugins"]:
                cfg["plugins"]["CapacitorHttp"]["enabled"] = False
            with open(cap_cfg, 'w', encoding='utf-8') as f:
                json.dump(cfg, f, indent=2)
            print("  -> Updated capacitor.config.json (appName: Gopay, appId: com.tpayx.app)")
        except Exception as e:
            print(f"  -> Error updating capacitor.config.json: {e}")

    # 3b. Update application label in resources.arsc (TpayX -> Gopay)
    arsc_path = os.path.join(temp_dir, "resources.arsc")
    if os.path.exists(arsc_path):
        try:
            with open(arsc_path, "rb") as f:
                arsc_data = bytearray(f.read())
            if b"TpayX" in arsc_data:
                arsc_data = arsc_data.replace(b"TpayX", b"Gopay")
                with open(arsc_path, "wb") as f:
                    f.write(arsc_data)
                print("  -> Updated application label in resources.arsc: TpayX -> Gopay")
        except Exception as e:
            print(f"  -> Error updating resources.arsc: {e}")

    # 4. Replace branding in assets/public
    print("[2/5] Replacing branding & backend URLs in bundled assets...")
    pub_dir = os.path.join(temp_dir, "assets", "public")
    replaced = 0

    replacements = [
        ("https://tpayx.us.cc/api", "https://gopay.us.cc/api"),
        ("http://tpayx.us.cc/api", "https://gopay.us.cc/api"),
        ("tpayx.us.cc", "gopay.us.cc"),
        ("https://t.me/TpayX", "https://t.me/Gopay"),
        ("https://t.me/tpayx", "https://t.me/Gopay"),
        ("TpayX", "Gopay"),
        ("tpayx", "gopay"),
        ("TPAYX", "GOPAY"),
    ]

    for root, dirs, files in os.walk(pub_dir):
        for f in files:
            if f.endswith(('.js', '.html', '.css', '.json')):
                fp = os.path.join(root, f)
                try:
                    with open(fp, 'r', encoding='utf-8') as fh:
                        c = fh.read()
                    nc = c
                    for old_val, new_val in replacements:
                        nc = nc.replace(old_val, new_val)

                    if nc != c:
                        with open(fp, 'w', encoding='utf-8') as fh:
                            fh.write(nc)
                        replaced += 1
                except Exception as e:
                    pass

    print(f"  -> Rebranded {replaced} web asset files.")

    # 5. Splash screen white logo
    splash_logo = os.path.join(base_dir, "Gopay_logo_white.png")
    if os.path.exists(splash_logo):
        for splash_name in [
            "tpayx_logo_white.png",
            "Gopay_logo_white.png",
            "Airwallex_logo_white.png",
            "logo.png"
        ]:
            for target_loc in [
                os.path.join(temp_dir, "assets", "public", splash_name),
                os.path.join(temp_dir, "assets", "public", "assets", splash_name),
            ]:
                if os.path.exists(os.path.dirname(target_loc)):
                    shutil.copy2(splash_logo, target_loc)
        print("  -> Injected official Gopay white splash logo.")

    # 6. Generate and replace app launcher icons for all densities
    print("[3/5] Generating launcher & adaptive icons from gopay_user_icon.png...")
    icon_src = os.path.join(base_dir, "gopay_user_icon.png")
    src_img = Image.open(icon_src).convert('RGBA')
    bbox = src_img.getbbox()
    content = src_img.crop(bbox)

    # Master classic icon (512x512) with transparent breathing margin
    master_classic = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
    classic_target = int(512 * 0.88)
    content_scaled = content.resize((classic_target, classic_target), Image.Resampling.LANCZOS)
    offset = (512 - classic_target) // 2
    master_classic.paste(content_scaled, (offset, offset), content_scaled)

    densities = {
        'mipmap-mdpi': (48, 108),
        'mipmap-hdpi': (72, 162),
        'mipmap-xhdpi': (96, 216),
        'mipmap-xxhdpi': (144, 324),
        'mipmap-xxxhdpi': (192, 432),
        'mipmap-mdpi-v4': (48, 108),
        'mipmap-hdpi-v4': (72, 162),
        'mipmap-xhdpi-v4': (96, 216),
        'mipmap-xxhdpi-v4': (144, 324),
        'mipmap-xxxhdpi-v4': (192, 432),
    }

    res_dir = os.path.join(temp_dir, "res")
    if os.path.exists(res_dir):
        for folder, (l_size, fg_size) in densities.items():
            fpath = os.path.join(res_dir, folder)
            if not os.path.exists(fpath):
                continue
            # Classic & round icons
            l_img = master_classic.resize((l_size, l_size), Image.Resampling.LANCZOS)
            l_img.save(os.path.join(fpath, 'ic_launcher.png'), 'PNG')
            l_img.save(os.path.join(fpath, 'ic_launcher_round.png'), 'PNG')

            # Adaptive foreground (65% safe zone) on opaque Gopay blue background (1, 59, 228, 255)
            # Guarantees ZERO white corners or patches on all Android launchers!
            fg_canvas = Image.new('RGBA', (fg_size, fg_size), (1, 59, 228, 255))
            fg_inner = int(fg_size * 0.65)
            fg_content = content.resize((fg_inner, fg_inner), Image.Resampling.LANCZOS)
            fg_offset = (fg_size - fg_inner) // 2
            fg_canvas.paste(fg_content, (fg_offset, fg_offset), fg_content)
            fg_canvas.save(os.path.join(fpath, 'ic_launcher_foreground.png'), 'PNG')
        print("  -> Launcher icons generated successfully for all mipmaps.")

    # Remove any stray vector foregrounds if they exist
    for legacy_xml in [
        os.path.join(temp_dir, "res", "drawable-v24", "ic_launcher_foreground.xml"),
        os.path.join(temp_dir, "res", "drawable-v24", "$ic_launcher_foreground__0.xml"),
    ]:
        if os.path.exists(legacy_xml):
            os.remove(legacy_xml)

    # 7. Repack APK
    print("[4/5] Repacking into unaligned APK...")
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

    # 8. 4-byte zipalign
    tools_dir = r"C:\Users\nirod\tools\android-sdk\build-tools\34.0.0"
    zipalign_bin = os.path.join(tools_dir, "zipalign.exe")
    apksigner_bat = os.path.join(tools_dir, "apksigner.bat")

    print("[5/5] Aligning & Signing APK...")
    if os.path.exists(output_apk):
        os.remove(output_apk)
    subprocess.run([zipalign_bin, "-p", "-f", "4", unaligned_apk, output_apk], check=True)
    if os.path.exists(unaligned_apk):
        os.remove(unaligned_apk)

    # 9. Sign with release keystore
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
        print("  -> Signed successfully with apksigner (v1 + v2).")
    else:
        print(f"  -> Apksigner warning: {res.stderr}")

    # Copy to user_web
    user_web_apk = os.path.join(base_dir, "..", "user_web", "Gopay.apk")
    shutil.copy2(output_apk, user_web_apk)
    print(f"  -> Successfully copied to {user_web_apk}")

    print("==================================================")
    print("[SUCCESS] Gopay.apk successfully generated from TpayX!")
    print(f"Size: {os.path.getsize(output_apk) / (1024*1024):.2f} MB")
    print("==================================================")
    return True

if __name__ == "__main__":
    rebrand_tpayx_to_gopay()
