#!/usr/bin/env bash
# Regressions for deploy-bot.sh using stubbed docker/git on PATH.
# Each test builds a fresh fixture: BOT_DIR with .env/data/DEPLOYED_SHA plus
# a docker stub that logs every invocation and follows MOCK_* switches.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NEW_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
PREV_IMAGE='ghcr.io/botro-plays/engganyo-project/telegram-bot:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
GOOD_LOGS='INFO guardbot.platform_api: platform channel: verified bot identity @EngganyoBot
INFO telegram.ext.Application: Application started
INFO guardbot: Engganyo (@EngganyoBot) is running'
BAD_LOGS='INFO guardbot: booting...'

PASS=0; FAILT=0
ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAILT=$((FAILT+1)); echo "FAIL: $1"; }
expect() { # desc, condition result (0/1)
  if [ "$2" -eq 0 ]; then ok "$1"; else bad "$1"; fi
}
has_call() { grep -qF "$1" "$CALL_LOG"; }
no_call()  { ! grep -qF "$1" "$CALL_LOG"; }

setup_fixture() {
  T="$(mktemp -d)"
  export T BOT_DIR="$T/bot" GIT_DIR="$T/git" MOCK_DIR="$T/mock" CALL_LOG="$T/calls.log"
  mkdir -p "$BOT_DIR/data" "$BOT_DIR/logs" "$MOCK_DIR" "$GIT_DIR" "$T/bin"
  printf 'BOT_TOKEN=x\nENGGANYO_API_BASE=https://api.test\nENGGANYO_BOT_SERVICE_KEY=k\nENGGANYO_BOT_USERNAME=EngganyoBot\n' > "$BOT_DIR/.env"
  printf '%s previous deploy\n' "$NEW_SHA" > "$BOT_DIR/DEPLOYED_SHA"
  touch "$BOT_DIR/data/guardbot.db"
  : > "$CALL_LOG"
  cat > "$T/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >> "$CALL_LOG"
cmd="$1"; shift || true
case "$cmd" in
  login) cat >/dev/null; exit 0 ;;
  pull) [ "${MOCK_PULL_OK:-1}" = "1" ]; exit ;;
  image) [ "${MOCK_LOCAL_IMG:-0}" = "1" ]; exit ;;
  exec)
    # Health probe is the only exec with -i whose command ends 'python -'
    # (script on stdin). 'python -c ...' (sqlite backup) must not match.
    if [[ "$1" == "-i" && "$*" == *" python -" ]]; then
      cat > "$MOCK_DIR/probe_stdin"
      if [ "${MOCK_PROBE_OK:-1}" = "1" ]; then
        echo 'verify: getMe=@EngganyoBot inbox_health=200'; exit 0
      fi
      exit 1
    fi
    exit 0 ;;   # sqlite backup etc.
  run)
    if [[ "$*" == *"--rm"* ]]; then [ "${MOCK_QUICKCHECK_OK:-1}" = "1" ]; exit; fi
    [ "${!#}" = "${MOCK_RUN_FAIL_FOR:-__none__}" ] && exit 1
    exit 0 ;;
  stop|rm) exit 0 ;;
  logs) printf '%s\n' "${MOCK_LOGS:-}"; exit 0 ;;
  inspect)
    case "$*" in
      *Config.Image*)   echo "${MOCK_PREV_IMAGE:-}" ;;
      *State.Running*)  echo "${MOCK_RUNNING:-true}" ;;
      *RestartCount*)   echo "0" ;;
      *) echo "" ;;
    esac; exit 0 ;;
  ps) echo "${MOCK_PS_NAME:-engganyo_bot}"; exit 0 ;;
esac
exit 0
STUB
  printf '#!/usr/bin/env bash\necho "git $*" >> "$CALL_LOG"\nexit 0\n' > "$T/bin/git"
  # flock stub: logs the acquisition and succeeds (serialization itself is
  # exercised on the VPS; these tests cover script logic only).
  printf '#!/usr/bin/env bash\necho "flock $*" >> "$CALL_LOG"\nexit 0\n' > "$T/bin/flock"
  chmod +x "$T/bin/"*
  export PATH="$T/bin:$PATH"
  export MOCK_PREV_IMAGE="$PREV_IMAGE" MOCK_LOGS="$GOOD_LOGS"
}

run_deploy() { # extra env passed as VAR=val args
  env DEPLOY_BOT_DIR="$BOT_DIR" DEPLOY_BOT_GIT_DIR="$GIT_DIR" \
      DEPLOY_SHA="$NEW_SHA" GHCR_TOKEN=x GITHUB_ACTOR=tester \
      DEPLOY_BOT_VERIFY_TRIES=1 DEPLOY_BOT_VERIFY_SLEEP_S=0 \
      DEPLOY_BOT_SUSTAIN_S=0 DEPLOY_BOT_ROLLBACK_WAIT_S=0 \
      "$@" bash "$SCRIPT_DIR/deploy-bot.sh" > "$T/out.log" 2>&1
}
deployed_sha() { awk '{print $1}' "$BOT_DIR/DEPLOYED_SHA"; }

# ─── 1. Health probe actually reaches Python via -i + stdin ────────────────
setup_fixture
run_deploy; rc=$?
expect "probe: deploy succeeds" "$([ $rc -eq 0 ]; echo $?)"
expect "probe: docker exec used -i" "$(has_call 'exec -i engganyo_bot python -'; echo $?)"
expect "probe: script stdin reached python" "$(grep -q 'inbox/health' "$MOCK_DIR/probe_stdin"; echo $?)"

# ─── 2. Failed identity/health probe rejects and preserves metadata ────────
setup_fixture
run_deploy MOCK_PROBE_OK=0; rc=$?
expect "probe-fail: deploy exits non-zero" "$([ $rc -ne 0 ]; echo $?)"
expect "probe-fail: DEPLOYED_SHA unchanged" "$([ "$(deployed_sha)" = "$NEW_SHA" ] && grep -q 'previous deploy' "$BOT_DIR/DEPLOYED_SHA"; echo $?)"
expect "probe-fail: previous image relaunched" "$(has_call "run -d --name engganyo_bot --restart unless-stopped -v $BOT_DIR/.env:/app/.env:ro -v $BOT_DIR/data:/app/data -v $BOT_DIR/logs:/app/logs $PREV_IMAGE"; echo $?)"
expect "probe-fail: rollback reported" "$(grep -q 'rollback: previous image' "$T/out.log"; echo $?)"

# ─── 3. Replacement launch failure restores previous image ───────────────
setup_fixture
NEW_REF="ghcr.io/botro-plays/engganyo-project/telegram-bot:$NEW_SHA"
run_deploy MOCK_RUN_FAIL_FOR="$NEW_REF"; rc=$?
expect "launch-fail: deploy exits non-zero" "$([ $rc -ne 0 ]; echo $?)"
expect "launch-fail: rollback launched previous image" "$(has_call "run -d --name engganyo_bot --restart unless-stopped -v $BOT_DIR/.env:/app/.env:ro -v $BOT_DIR/data:/app/data -v $BOT_DIR/logs:/app/logs $PREV_IMAGE"; echo $?)"
expect "launch-fail: rollback reported" "$(grep -q 'rollback: previous image' "$T/out.log"; echo $?)"
expect "launch-fail: DEPLOYED_SHA unchanged" "$(grep -q 'previous deploy' "$BOT_DIR/DEPLOYED_SHA"; echo $?)"

# ─── 4. Verification failure restores previous image ──────────────────────
setup_fixture
export MOCK_LOGS="$BAD_LOGS"
run_deploy; rc=$?
expect "verify-fail: deploy exits non-zero" "$([ $rc -ne 0 ]; echo $?)"
expect "verify-fail: rollback launched previous image" "$(has_call "run -d --name engganyo_bot --restart unless-stopped -v $BOT_DIR/.env:/app/.env:ro -v $BOT_DIR/data:/app/data -v $BOT_DIR/logs:/app/logs $PREV_IMAGE"; echo $?)"
expect "verify-fail: rollback verify also reported" "$(grep -qE 'rollback: previous image|rollback image failed verification' "$T/out.log"; echo $?)"
expect "verify-fail: DEPLOYED_SHA unchanged" "$(grep -q 'previous deploy' "$BOT_DIR/DEPLOYED_SHA"; echo $?)"

# ─── 5. Pull failure leaves the running bot untouched ─────────────────────
setup_fixture
run_deploy MOCK_PULL_OK=0 MOCK_LOCAL_IMG=0; rc=$?
expect "pull-fail: deploy exits non-zero" "$([ $rc -ne 0 ]; echo $?)"
expect "pull-fail: old container never stopped" "$(no_call 'stop engganyo_bot'; echo $?)"
expect "pull-fail: no container launched" "$(no_call 'run -d --name engganyo_bot'; echo $?)"
expect "pull-fail: DEPLOYED_SHA unchanged" "$(grep -q 'previous deploy' "$BOT_DIR/DEPLOYED_SHA"; echo $?)"

# ─── 6. Success: metadata written, and only after verification ────────────
setup_fixture
run_deploy; rc=$?
expect "success: deploy exits zero" "$([ $rc -eq 0 ]; echo $?)"
expect "success: DEPLOYED_SHA = new sha" "$([ "$(deployed_sha)" = "$NEW_SHA" ]; echo $?)"
expect "success: metadata records gha deploy" "$(grep -q 'monorepo apps/telegram-bot (gha' "$BOT_DIR/DEPLOYED_SHA"; echo $?)"
expect "success: probe ran before metadata" "$(has_call 'exec -i engganyo_bot python -'; echo $?)"
# Probe-failure test above proves metadata is withheld when verification fails.

echo
echo "deploy-bot regressions: $PASS passed, $FAILT failed"
[ "$FAILT" -eq 0 ]
