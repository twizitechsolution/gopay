import os
import sys
import re

def auto_rebrand(
    new_app_name,
    new_domain,
    new_admin_domain=None,
    new_backend_url=None,
    target_root=None
):
    if not target_root:
        target_root = os.path.dirname(os.path.abspath(__file__))

    clean_domain = new_domain.replace("https://", "").replace("http://", "").rstrip("/")
    if not new_admin_domain:
        new_admin_domain = f"admin.{clean_domain}"
    if not new_backend_url:
        new_backend_url = f"https://api.{clean_domain}/api"

    old_app_names = ["Airwallex", "airwallex", "AIRWALLEX"]
    old_domains = [
        "airwallexus.online",
        "admin.airwallexus.online",
        "airwalx.us.cc",
        "airwallex-web.vercel.app",
        "airwallex-admin.vercel.app"
    ]
    old_api_urls = [
        "https://airwallex-backend-seven.vercel.app/api",
        "https://airwallexus.online/api",
        "http://airwallexus.online/api",
        "https://airwalx.us.cc/api"
    ]

    print("==================================================")
    print(f"  PROJECT-WIDE AUTOMATED REBRANDING TOOL")
    print(f"  Target Root:   {target_root}")
    print(f"  New App Name:  {new_app_name}")
    print(f"  User Domain:   {clean_domain}")
    print(f"  Admin Domain:  {new_admin_domain}")
    print(f"  Backend API:   {new_backend_url}")
    print("==================================================")

    valid_exts = ('.js', '.json', '.html', '.css', '.env', '.md', '.txt', '.conf', '.jsx')
    skip_dirs = {'node_modules', '.git', 'dist', 'temp_build', '.system_generated'}

    total_files = 0
    updated_files = 0

    for root, dirs, files in os.walk(target_root):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for f in files:
            if f.endswith(valid_exts):
                total_files += 1
                fp = os.path.join(root, f)
                try:
                    with open(fp, 'r', encoding='utf-8') as fh:
                        content = fh.read()
                    
                    new_content = content
                    
                    # 1. Replace Backend URLs
                    for u in old_api_urls:
                        new_content = new_content.replace(u, new_backend_url)

                    # 2. Replace Admin Domains
                    new_content = new_content.replace("admin.airwallexus.online", new_admin_domain)
                    new_content = new_content.replace("airwallex-admin.vercel.app", new_admin_domain)

                    # 3. Replace User Domains
                    new_content = new_content.replace("airwallexus.online", clean_domain)
                    new_content = new_content.replace("airwalx.us.cc", clean_domain)
                    new_content = new_content.replace("airwallex-web.vercel.app", clean_domain)

                    # 4. Replace App Names
                    new_content = new_content.replace("Airwallex", new_app_name)
                    new_content = new_content.replace("airwallex", new_app_name.lower())

                    if new_content != content:
                        with open(fp, 'w', encoding='utf-8') as fh:
                            fh.write(new_content)
                        updated_files += 1
                except Exception as e:
                    pass

    print(f"\n✅ Rebranding Complete!")
    print(f"Scanned: {total_files} files")
    print(f"Updated: {updated_files} files with new brand and URLs.")
    print("==================================================")
    return True

if __name__ == "__main__":
    if len(sys.argv) >= 3:
        name = sys.argv[1]
        domain = sys.argv[2]
        admin_dom = sys.argv[3] if len(sys.argv) > 3 else None
        api_url = sys.argv[4] if len(sys.argv) > 4 else None
        auto_rebrand(name, domain, admin_dom, api_url)
    else:
        print("--- Interactive Project Rebrander ---")
        name = input("Enter New App Name (e.g. MyBrand): ").strip()
        if not name:
            name = "MyBrand"
        domain = input("Enter New User Domain (e.g. mybrand.online): ").strip()
        if not domain:
            domain = f"{name.lower()}.online"
        admin_dom = input(f"Enter Admin Domain (default: admin.{domain}): ").strip()
        if not admin_dom:
            admin_dom = f"admin.{domain}"
        api_url = input(f"Enter Backend API URL (default: https://api.{domain}/api): ").strip()
        if not api_url:
            api_url = f"https://api.{domain}/api"

        auto_rebrand(name, domain, admin_dom, api_url)
