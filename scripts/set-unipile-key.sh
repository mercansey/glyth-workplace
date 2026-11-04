#!/bin/zsh
# Prompts for Unipile credentials and writes them SERVER-SIDE into .env.
# API key + webhook secret are entered hidden and never echoed.
set -e
cd "$(dirname "$0")/.."

printf "Paste Unipile API key (input hidden): "
read -s UNIPILE_KEY; echo ""
if [ -z "$UNIPILE_KEY" ]; then echo "No key entered — .env left unchanged."; exit 1; fi
printf "Unipile DSN (e.g. api1.unipile.com:13111 — from your Unipile dashboard): "
read UNIPILE_DSN_INPUT
printf "Unipile webhook secret (input hidden, Enter to skip for now): "
read -s UNIPILE_SECRET; echo ""
printf "Reconnect account ID only if you already have a connected acc_... account (Enter to skip — first-time connect does not need one): "
read UNIPILE_ACCOUNT_INPUT

python3 - "$UNIPILE_KEY" "$UNIPILE_DSN_INPUT" "$UNIPILE_SECRET" "$UNIPILE_ACCOUNT_INPUT" << 'PY'
import pathlib, sys
key, dsn, secret = sys.argv[1].strip(), sys.argv[2].strip(), sys.argv[3].strip()
account_id = sys.argv[4].strip() if len(sys.argv) > 4 else ""
if dsn and "://" not in dsn: dsn = "https://" + dsn
values = {"UNIPILE_API_KEY": key, "UNIPILE_DSN": dsn.rstrip("/"), "UNIPILE_API_VERSION": "v2"}
if secret: values["UNIPILE_WEBHOOK_SECRET"] = secret
if account_id: values["UNIPILE_ACCOUNT_ID"] = account_id
p = pathlib.Path(".env"); lines = p.read_text().splitlines() if p.exists() else []
seen = set(); out = []
for line in lines:
    k = line.split("=", 1)[0] if "=" in line else None
    if k in values: out.append(f"{k}={values[k]}"); seen.add(k)
    else: out.append(line)
for k, v in values.items():
    if k not in seen: out.append(f"{k}={v}")
p.write_text("\n".join(out) + "\n")
print(f"Saved: UNIPILE_API_KEY ({len(key)} chars), UNIPILE_DSN={values['UNIPILE_DSN']}, webhook secret {'set' if secret else 'skipped'}")
PY
unset UNIPILE_KEY UNIPILE_SECRET

echo ""
echo "Next steps:"
echo "  1. Restart Start-Glyth (Ctrl+C, relaunch) so the server reads these"
echo "  2. In the app: Support -> Messages -> Connect Instagram (or LinkedIn/WhatsApp)"
echo "  3. Complete the provider login in the window that opens, then come back and reopen Messages"
