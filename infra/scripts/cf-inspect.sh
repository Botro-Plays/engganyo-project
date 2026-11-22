#!/usr/bin/env bash
# Read-only Cloudflare inspection for engganyo.com.
#
# Token: set CLOUDFLARE_API_TOKEN (never committed, never printed).
# Required minimum scopes (zone-locked to engganyo.com):
#   Zone / Zone                    : Read        (zone id, plan, status)
#   Zone / Zone Settings           : Read        (email obfuscation etc.)
#   Zone / Firewall Services (WAF) : Read        (custom rules, managed rulesets, bot rules)
#   Zone / Transform Rules         : Read        (response-header transforms - CSP source check)
#   Zone / Page Rules              : Read        (cache behavior)
#   Zone / Workers Routes          : Read        (header injection via worker, if any)
# NOT required: DNS edit, Cache purge, Billing, Account-level anything,
# SSL/TLS edit, Workers write, any write permission for this phase.
#
# Writes a sanitized JSON snapshot to ./cf-snapshot-<ts>/ (no secrets).
set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN (zone-scoped, read permissions)}"

API="https://api.cloudflare.com/client/v4"
AUTH=(-H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H "Content-Type: application/json")
OUT="cf-snapshot-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"

get() { # get <path> <outfile>
  curl -fsS "${AUTH[@]}" "${API}$1" -o "$OUT/$2" \
    && python3 -c "import json,sys;d=json.load(open('$OUT/$2'));print('$2','ok' if d.get('success') else 'FAIL',d.get('errors') or '')" \
    || echo "$2 REQUEST_FAILED"
}

echo "== token verify"
get "/user/tokens/verify" token-verify.json

echo "== zone lookup"
get "/zones?name=engganyo.com" zone.json
ZONE_ID=$(python3 -c "import json;print(json.load(open('$OUT/zone.json'))['result'][0]['id'])")
echo "zone id: $ZONE_ID"

echo "== plan + settings"
python3 -c "import json;r=json.load(open('$OUT/zone.json'))['result'][0];print('plan:',r['plan']['name'],'status:',r['status'])"
get "/zones/$ZONE_ID/settings" settings-all.json
python3 -c "
import json
s={x['id']:x['value'] for x in json.load(open('$OUT/settings-all.json'))['result']}
for k in ['email_obfuscation','security_level','bot_fight_mode','challenge_ttl','server_side_exclude','hotlink_protection']:
    print(f'  {k}: {s.get(k)}')"

echo "== WAF / bot rules"
get "/zones/$ZONE_ID/firewall/rules" waf-rules.json || true
get "/zones/$ZONE_ID/rulesets" rulesets.json || true

echo "== response header transforms (CSP source check)"
get "/zones/$ZONE_ID/rulesets/phases/http_response_headers_managed_transform/entrypoint" hdr-transform.json || true

echo "== page rules (cache)"
get "/zones/$ZONE_ID/pagerules" pagerules.json || true

echo "== workers routes"
get "/zones/$ZONE_ID/workers/routes" workers-routes.json || true

echo "== AI crawl control (endpoint variants; 404 = not available on plan)"
get "/zones/$ZONE_ID/aibots" ai-crawl-a.json || true

echo "== live headers (origin vs edge)"
curl -sI https://engganyo.com -o "$OUT/live-headers.txt" || true
grep -i "content-security\|server:\|cf-" "$OUT/live-headers.txt" | sed 's/\(cf-ray[^ ]*\).*/edge-present/' || true

echo "== live robots managed block"
curl -fsS https://engganyo.com/robots.txt -o "$OUT/live-robots.txt" || true
head -20 "$OUT/live-robots.txt" || true

echo "== live contact page email check"
curl -fsS https://engganyo.com/contact -o "$OUT/live-contact.html" || true
python3 -c "
h=open('$OUT/live-contact.html',encoding='utf8',errors='replace').read()
import re
print('  email-protection spans:',len(re.findall('email-protection|cfemail',h)))
print('  mailto: links:',re.findall('mailto:[^\"<]+',h))
print('  visible contact@:', 'contact@engganyo.com' in h)"

echo "== PerplexityBot probe (user-agent only; not crawler-identity proof)"
curl -s -o /dev/null -w "  PerplexityBot UA -> %{http_code}\n" -A "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)" https://engganyo.com/ || true

echo
echo "Snapshot in $OUT/ (sanitized - contains no tokens)"
