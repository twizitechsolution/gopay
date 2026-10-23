import os
import sys
import re
import shutil
import subprocess

def run_rebrand():
    root_dir = os.path.dirname(os.path.abspath(__file__))
    new_app_name = "Gopay"
    new_app_lower = "gopay"
    new_domain = "gopay.online"
    new_admin_domain = "admin.gopay.online"
    local_backend_url = "http://localhost:5000/api"
    new_telegram = "https://t.me/Gopay"
    
    print(f"[*] Starting full rebranding to '{new_app_name}'...")
    print(f"[*] Root Directory: {root_dir}")

    # Specific replacements map (ordered from specific to general)
    replacements = [
        # Telegram links
        ("https://t.me/Airwallex", new_telegram),
        ("https://t.me/airwallex", new_telegram),
        ("https://t.me/your_channel", new_telegram),
        ("t.me/Airwallex", "t.me/Gopay"),

        # Old API endpoints
        ("https://airwallex-backend-seven.vercel.app/api", local_backend_url),
        ("https://airwallex-backend-seven.vercel.app", "http://localhost:5000"),
        ("https://airwallexus.online/api", local_backend_url),
        ("http://airwallexus.online/api", local_backend_url),
        ("https://airwalx.us.cc/api", local_backend_url),
        ("https://register.Airwallex.us.cc/api", f"{local_backend_url}"),

        # Old domains
        ("admin.airwallexus.online", new_admin_domain),
        ("airwallex-admin.vercel.app", new_admin_domain),
        ("airwallex-web.vercel.app", new_domain),
        ("airwallexus.online", new_domain),
        ("airwalx.us.cc", new_domain),

        # Specific App Tokens & Configs
        ("Airwallex_token", f"{new_app_name}_token"),
        ("airwallex_token", f"{new_app_lower}_token"),
        ("Airwallex_secret_jwt_key", f"{new_app_name}_secret_jwt_key"),
        ("airwallex-backend", f"{new_app_lower}-backend"),
        ("airwallexusadmin", f"{new_app_lower}admin"),
        ("airwallexus@143#!", f"{new_app_lower}@143#!"),
        ("tushar@Airwallex.com", f"admin@{new_domain}"),
        ("airwallex1@upi", f"{new_app_lower}1@upi"),
        ("airwallex2@upi", f"{new_app_lower}2@upi"),
        ("Airwallex.apk", f"{new_app_name}.apk"),
        ("airwallex.apk", f"{new_app_lower}.apk"),

        # General Brand Names (Case-sensitive)
        ("Airwallex", new_app_name),
        ("AIRWALLEX", new_app_name.upper()),
        ("airwallex", new_app_lower),
        ("Airwalks", new_app_name),
        ("AIRWALKS", new_app_name.upper()),
        ("airwalks", new_app_lower),
        ("Airwalk", new_app_name),
        ("airwalk", new_app_lower),
    ]

    valid_exts = ('.js', '.json', '.html', '.css', '.env', '.md', '.txt', '.jsx')
    skip_dirs = {'node_modules', '.git', 'dist', 'temp_build', '.system_generated', 'android-sdk'}

    total_files = 0
    updated_files = 0

    for root, dirs, files in os.walk(root_dir):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for f in files:
            if f.endswith(valid_exts):
                total_files += 1
                fp = os.path.join(root, f)
                try:
                    with open(fp, 'r', encoding='utf-8') as fh:
                        content = fh.read()

                    new_content = content
                    for old_val, new_val in replacements:
                        if old_val in new_content:
                            new_content = new_content.replace(old_val, new_val)

                    if new_content != content:
                        with open(fp, 'w', encoding='utf-8') as fh:
                            fh.write(new_content)
                        updated_files += 1
                        print(f"  [+] Updated: {os.path.relpath(fp, root_dir)}")
                except Exception as e:
                    print(f"  [!] Error processing {fp}: {e}")

    print(f"\n[✓] Text Rebranding Complete! Updated {updated_files}/{total_files} files.")

if __name__ == "__main__":
    run_rebrand()
