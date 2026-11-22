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
# Snapshots go to ${CF_SNAPSHOT_DIR:-$HOME/cf-snapshots} - outside the
# repository, so they can never be committed. API JSON is passed through
# a sanitizer that strips account/owner/token-shaped fields before it is
# called a snapshot. Endpoints that fail are recorded as INCONCLUSIVE,
# never as proof a setting is absent.
set -uo pipefail

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN (zone-scoped, read permissions)}"

API="https://api.cloudflare.com/client/v4"
AUTH=(-H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H "Content-Type: application/json")
SNAP="${CF_SNAPSHOT_DIR:-$HOME/cf-snapshots}/cf-snapshot-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$SNAP"
INCONCLUSIVE=()

# Recursively strips fields that could identify the account or carry
# secrets before the snapshot is stored or reported on.
sanitize() { # sanitize <file>
  python3 - "$1" <<'PY'
import json, sys
DROP = {'owner','account','meta','key_tag','secret','token','tokens',
        'api_token','email','phone'}
def clean(x):
    if isinstance(x, dict):
        return {k: clean(v) for k, v in x.items() if k.lower() not in DROP}
    if isinstance(x, list):
        return [clean(v) for v in x]
    return x
p = sys.argv[1]
try:
    d = json.load(open(p))
except Exception:
    sys.exit(0)
json.dump(clean(d), open(p, 'w'), indent=2)
PY
}

get() { # get <path> <outfile> -> 0 ok / 1 failed
  local path="$1" file="$2"
  if ! curl -fsS "${AUTH[@]}" "${API}${path}" -o "$SNAP/$file" 2>/dev/null; then
    echo "  $file: REQUEST_FAILED (inconclusive)"
    INCONCLUSIVE+=("$path")
    rm -f "$SNAP/$file"
    return 1
  fi
  local ok
  ok=$(python3 -c "import json;print('yes' if json.load(open('$SNAP/$file')).get('success') else 'no')" 2>/dev/null || echo no)
  if [ "$ok" != "yes" ]; then
    echo "  $file: API_ERROR (inconclusive)"
    INCONCLUSIVE+=("$path")
    rm -f "$SNAP/$file"
    return 1
  fi
  sanitize "$SNAP/$file"
  echo "  $file: ok"
  return 0
}

echo "== token verify"
get "/user/tokens/verify" token-verify.json || true

echo "== zone lookup"
if get "/zones?name=engganyo.com" zone.json; then
  ZONE_ID=$(python3 -c "import json;print(json.load(open('$SNAP/zone.json'))['result'][0]['id'])")
  python3 -c "import json;r=json.load(open('$SNAP/zone.json'))['result'][0];print('zone id:',r['id'],'plan:',r['plan']['name'],'status:',r['status'])"
else
  echo "ABORT: cannot resolve zone; nothing else is conclusive."
  exit 1
fi

echo "== zone settings (email obfuscation etc.)"
if get "/zones/$ZONE_ID/settings" settings-all.json; then
  python3 - "$SNAP/settings-all.json" <<'PY'
import json, sys
s={x['id']:x['value'] for x in json.load(open(sys.argv[1]))['result']}
for k in ['email_obfuscation','security_level','bot_fight_mode','challenge_ttl','server_side_exclude','hotlink_protection']:
    print(f'  {k}: {s.get(k)}')
PY
fi

echo "== WAF / bot rules"
get "/zones/$ZONE_ID/firewall/rules" waf-rules.json || true

echo "== ruleset listing -> per-ruleset contents"
if get "/zones/$ZONE_ID/rulesets" rulesets.json; then
  python3 - "$SNAP" <<'PY'
import json, subprocess, sys
snap = sys.argv[1]
rs = json.load(open(f'{snap}/rulesets.json'))['result']
for r in rs:
    print(f"  ruleset {r['id'][:8]}.. phase={r.get('phase')} name={r.get('name')} kind={r.get('kind')}")
PY
  # Fetch full contents (rules arrays), not just the listing.
  for id in $(python3 -c "import json;print(' '.join(r['id'] for r in json.load(open('$SNAP/rulesets.json'))['result']))"); do
    get "/zones/$ZONE_ID/rulesets/$id" "ruleset-$id.json" || true
  done
fi

echo "== response-header transform phases (CSP source check)"
get "/zones/$ZONE_ID/rulesets/phases/http_response_headers_transform/entrypoint" hdr-transform.json || true
get "/zones/$ZONE_ID/rulesets/phases/http_response_headers_managed_transform/entrypoint" hdr-managed.json || true
get "/zones/$ZONE_ID/managed_headers" managed-headers.json || true

echo "== page rules (cache)"
get "/zones/$ZONE_ID/pagerules" pagerules.json || true

echo "== workers routes"
get "/zones/$ZONE_ID/workers/routes" workers-routes.json || true

echo "== AI crawl control (endpoint variants; failure = inconclusive)"
get "/zones/$ZONE_ID/aibots" ai-crawl-a.json || true
get "/zones/$ZONE_ID/bot_management" ai-crawl-b.json || true

echo "== live headers (origin vs edge)"
curl -sI https://engganyo.com -o "$SNAP/live-headers.txt" || INCONCLUSIVE+=("live headers")
grep -i "content-security\|server:\|cf-" "$SNAP/live-headers.txt" 2>/dev/null | sed 's/\(cf-ray[^ ]*\).*/cf-ray-present/' || true

echo "== live robots managed block"
curl -fsS https://engganyo.com/robots.txt -o "$SNAP/live-robots.txt" || INCONCLUSIVE+=("live robots.txt")
head -20 "$SNAP/live-robots.txt" 2>/dev/null || true

echo "== live contact page email check"
if curl -fsS https://engganyo.com/contact -o "$SNAP/live-contact.html"; then
  python3 - "$SNAP/live-contact.html" <<'PY'
import re, sys
h=open(sys.argv[1],encoding='utf8',errors='replace').read()
print('  email-protection spans:',len(re.findall('email-protection|cfemail',h)))
print('  mailto: links:',re.findall('mailto:[^"<]+',h))
print('  visible contact@:', 'contact@engganyo.com' in h)
PY
else
  INCONCLUSIVE+=("live contact page")
fi

echo "== PerplexityBot probe (user-agent only; not crawler-identity proof)"
curl -s -o /dev/null -w "  PerplexityBot UA -> %{http_code}\n" \
  -A "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)" \
  https://engganyo.com/ || INCONCLUSIVE+=("PerplexityBot probe")

echo
if [ ${#INCONCLUSIVE[@]} -gt 0 ]; then
  echo "INCONCLUSIVE checks (endpoint unavailable or errored - NOT proof of absence):"
  printf '  - %s\n' "${INCONCLUSIVE[@]}"
fi
echo "Snapshot in $SNAP/ (sanitized - no tokens, outside the repository)"
