# Engganyo VPS setup and automatic deployment

This is the fresh-server guide for Ubuntu 24.04. Both project collaborators may push to main. The deployment changes described here must first be reviewed and pushed to main; local edits do not change the workflow running on GitHub.

## How an update reaches the server

1. Either collaborator pushes a complete change to main.
2. GitHub Actions runs API lint/unit tests/build and web lint/build.
3. Playwright E2E runs only after both CI jobs pass.
4. GitHub builds API and web Docker images, using the root package-lock.json, and publishes commit-tagged images to GHCR.
5. GitHub connects to the VPS over SSH. The VPS checks out that exact tested commit for configuration and pulls its matching images.
6. Docker starts PostgreSQL/Redis as needed, then API/web. The API entrypoint runs database migrations before starting the API.
7. Deployment waits for healthy API/web containers, recreates Nginx, and checks its configuration. A health timeout fails deployment.

The API compiled dist and Next.js standalone build are inside the images. The VPS does not need Node.js/npm and does not compile the application. A successful push deploys automatically once this workflow is on main and the host is configured. Manual Run workflow remains available on main. Other branches cannot publish or deploy through this workflow. Running deployments are not cancelled by a later push; intermediate pending runs may be superseded by newer pushes.

There is no owner-only actor restriction. A failing check prevents deployment, but a direct push has already changed main: coordinate fixes and do not bypass checks. Application security findings in AUDIT_2026-10-21.md still require separate repair before handling real payments.

## 1. Install Docker on the fresh VPS

Run as root in the Ubuntu SSH session, not in Windows PowerShell:

```bash
apt-get update
apt-get install -y ca-certificates curl git openssl python3
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker --version
docker compose version
```

This uses [Docker's official Ubuntu apt installation](https://docs.docker.com/engine/install/ubuntu/). The audited host had no Docker installation; existing hosts with conflicting Docker packages require the additional removal guidance in that document.

## 2. Create a dedicated deployment account

Still as root:

```bash
id engganyo >/dev/null 2>&1 || adduser --disabled-password --gecos '' engganyo
usermod -aG docker engganyo
install -d -m 0755 -o engganyo -g engganyo /opt/engganyo-project
install -d -m 0700 -o engganyo -g engganyo /home/engganyo/.ssh
```

The docker group has root-equivalent control through Docker; keep this account's key restricted to trusted automation. No general passwordless sudo rule is needed.

## 3. Set up GitHub Actions to VPS SSH access

There are two different SSH key pairs. Do not confuse this deployment-login key with the repository-read key in step 4.

On your Windows PC, generate a new dedicated key (choose another filename if this one already exists):

```powershell
ssh-keygen -t ed25519 -C "engganyo-actions-to-vps" -f "$env:USERPROFILE\.ssh\engganyo_actions"
```

Press Enter twice for an empty passphrase for this automation key. Keep the private key private. View only its public part to copy to the VPS:

```powershell
Get-Content "$env:USERPROFILE\.ssh\engganyo_actions.pub"
```

On the VPS as root, open the file below and paste the entire public-key line. Add `restrict ` before `ssh-ed25519` to disable forwarding and PTY allocation while allowing the noninteractive deployment command:

```bash
nano /home/engganyo/.ssh/authorized_keys
chown engganyo:engganyo /home/engganyo/.ssh/authorized_keys
chmod 600 /home/engganyo/.ssh/authorized_keys
```

Test from PowerShell:

```powershell
ssh -i "$env:USERPROFILE\.ssh\engganyo_actions" engganyo@134.255.225.158 "id; docker info >/dev/null && echo Docker-access-OK"
```

Add the full private key to the repository secret VPS_SSH_KEY, directly in GitHub Settings > Secrets and variables > Actions. On Windows, copy it to your clipboard with:

```powershell
Get-Content -Raw "$env:USERPROFILE\.ssh\engganyo_actions" | Set-Clipboard
```

Do not paste the private key in chat, a commit, or an issue. Existing Actions secrets may still refer to the old server's deleted authorized_keys.

Verify the server fingerprint through the provider console:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256
```

Use that independently verified SHA256 value as VPS_HOST_FINGERPRINT. The value reported in the recovery conversation was SHA256:FpRke85Jh9Qw1/TbDjL7ThghyOciePFRiPCeN8f7++I; the code does not assume it was verified.

## 4. Set up VPS to repository read access

On the VPS as root, switch to the deployment account:

```bash
su - engganyo
ssh-keygen -t ed25519 -N '' -C "engganyo-vps-repository-read" -f ~/.ssh/github_repo
cat ~/.ssh/github_repo.pub
```

Add this PUBLIC key in the repository's Settings > Deploy keys. Leave Allow write access unchecked. Its private key stays only on the VPS; it is not VPS_SSH_KEY.

As engganyo, add this host entry to ~/.ssh/config (preserve any existing entries):

```text
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/github_repo
  IdentitiesOnly yes
```

Then:

```bash
chmod 600 ~/.ssh/config
ssh -T git@github.com
```

Verify GitHub's fingerprint against [GitHub's published host fingerprints](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints) before accepting it. A successful authentication message says GitHub does not provide shell access and can exit with code 1; that is normal for this test.

Clone into the empty directory prepared earlier:

```bash
git clone git@github.com:Botro-Plays/engganyo-project.git /opt/engganyo-project
cd /opt/engganyo-project
```

Do not clone over an existing checkout. Deployments leave this checkout detached at a release commit; that is intentional. Do application development on your PCs rather than editing tracked files here.

## 5. Create the new environment configuration

There is no recovered database in this setup. These commands initialize configuration for an intentional fresh installation. They refuse to overwrite an existing .env.

As engganyo in /opt/engganyo-project:

```bash
python3 - <<'PY'
from pathlib import Path
import secrets
path = Path('.env')
if path.exists():
    raise SystemExit('.env already exists; inspect it instead of overwriting it')
password = secrets.token_hex(32)
values = {
    'DATABASE_HOST': 'postgres',
    'DATABASE_PASSWORD': password,
    'DATABASE_URL': f'postgresql://engganyo:{password}@postgres:5432/engganyo_prod?connection_limit=10&pool_timeout=30',
    'JWT_ACCESS_SECRET': secrets.token_hex(64),
    'JWT_REFRESH_SECRET': secrets.token_hex(64),
    'COOKIE_SECRET': secrets.token_hex(32),
    'ENCRYPTION_KEY': secrets.token_hex(32),
    'ADMIN_PASSWORD': secrets.token_urlsafe(32),
    'SENTRY_DSN': '',
}
lines = Path('.env.production.example').read_text().splitlines()
text = '\n'.join(f'{line.split("=", 1)[0]}={values[line.split("=", 1)[0]]}'
                 if '=' in line and line.split('=', 1)[0] in values else line
                 for line in lines) + '\n'
with path.open('x') as output:
    path.chmod(0o600)
    output.write(text)
print('Created .env with generated secrets; review remaining settings privately.')
PY
nano .env
```

Set SMTP credentials, ADMIN_EMAIL, domain URLs, and any intentional feature settings. Keep ENCRYPTION_KEY and other generated secrets in a secure off-host backup. These are new keys for a new database, not substitutes for keys required to decrypt an old backup. Do not use JWT_SECRET: this app reads JWT_ACCESS_SECRET and JWT_REFRESH_SECRET.

Docker Compose supplies the internal PostgreSQL connection. Database passwords generated above are hex, so they are safe in a connection URL. PostgreSQL and Redis have no host-published ports in the updated compose file. API/web ports bind to localhost; Nginx exposes 80/443. REDIS_PASSWORD remains empty for this isolated Docker-network configuration; changing only that variable does not configure the Redis server to require it.

## 6. Restore domain routing and HTTPS

The checked-in Nginx config expects engganyo.com and www.engganyo.com. Point the Cloudflare DNS records to 134.255.225.158, keep the records proxied, and use Full (strict) TLS with a valid Cloudflare Origin Certificate.

Place the certificate and its matching private key on the VPS:

```bash
nano infra/nginx/ssl/cert.pem
nano infra/nginx/ssl/key.pem
chmod 644 infra/nginx/ssl/cert.pem
chmod 600 infra/nginx/ssl/key.pem
```

Nginx requires a client certificate on every TLS handshake (Authenticated Origin Pulls), so direct requests to the VPS IP cannot reach the application — only traffic through the proxied Cloudflare hostnames connects. The trust anchor is `infra/nginx/ssl/origin-pull-client.pem`: our own client certificate generated on the VPS (key `origin-pull-key.pem`, mode 600). Upload BOTH `origin-pull-client.pem` and `origin-pull-key.pem` as a per-hostname Authenticated Origin Pull certificate for `engganyo.com` and `www.engganyo.com` via the Cloudflare API (`PUT /zones/{zone}/origin_tls_client_auth/hostnames`), and enable it — this binds verification to our zone's presented certificate rather than the shared public Cloudflare origin-pull CA, which only proves "some Cloudflare zone". Configure it before or with this deployment; the origin fails closed (rejects all TLS) until the matching CF-side config exists.

Allow inbound SSH (22, unless deliberately changed), HTTP 80 and HTTPS 443 in the provider firewall. Do not open PostgreSQL/Redis/API/web ports publicly. GitHub-hosted runners must be able to reach the SSH port. If the domain is different, update Nginx, API CORS/socket origins, app URLs and the frontend build setting together.

A Cloudflare Origin Certificate is trusted by Cloudflare, not ordinary browsers connecting directly to the IP. Test the website through the configured domain.

## 7. Repository Actions secrets and package access

Set these in [repository Actions secrets](https://github.com/Botro-Plays/engganyo-project/settings/secrets/actions):

| Secret | Value |
|---|---|
| VPS_HOST | 134.255.225.158 |
| VPS_USER | engganyo |
| VPS_SSH_PORT | 22, or the configured SSH port |
| VPS_SSH_KEY | Dedicated Actions-to-VPS private key from step 3 |
| VPS_HOST_FINGERPRINT | Independently verified SHA256 server host fingerprint |
| NEXT_PUBLIC_API_URL | https://engganyo.com/api |
| NEXT_PUBLIC_RECAPTCHA_SITE_KEY | Your public site key, if reCAPTCHA is used |

GITHUB_TOKEN is supplied automatically for publishing/pulling this repository's packages. No long-lived GHCR token is needed for the normal workflow. Ensure the API and web GHCR packages grant this repository Actions access; otherwise login/pull/push can fail even though the SSH key works. See [GitHub Container Registry authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

## 8. First release, seed, and verification

Complete server setup before pushing the restored automatic workflow to main. Once that push passes all checks, GitHub deploys it. Do not manually copy dist or install Node on the VPS. If the configuration commit was already pushed before host setup, use Actions > Deploy > Run workflow > main to retry the complete pipeline.

The first startup applies migrations automatically. After the deployment succeeds, seed the NEW database once, as engganyo:

```bash
cd /opt/engganyo-project
docker compose --env-file .env --env-file .release.env exec -T api npm run db:seed
```

Seeding is deliberately not part of every deploy. Read your generated admin password privately from .env, sign in, enable admin 2FA, and configure integrations with sandbox credentials. The audit's application-level authentication and payment defects remain separate launch blockers.

Check:

```bash
cat .deployed-sha
docker compose --env-file .env --env-file .release.env ps
curl -fsS http://127.0.0.1:3001/api/health
curl -I https://engganyo.com/login
```

The API health JSON must report status ok (inside data), and containers should be healthy. A green CI run alone is not a successful deploy: check the final Deploy to VPS job too.

## Deferred reCAPTCHA (initial restricted deployment)

reCAPTCHA is disabled for the first team-only deployment: `ENABLE_RECAPTCHA=false` in `.env`, and no `recaptcha_enabled` row exists in the fresh database (backend enforcement reads the `platformConfig` DB row, default off; the frontend reads the public config and skips token generation, so registration/login work without a widget). To activate later:

1. Set `RECAPTCHA_SECRET` in the VPS `.env`.
2. Ensure `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` is set in repository Actions secrets — the frontend embeds it at build time.
3. Set `recaptcha_enabled=true`, `recaptcha_v3_site_key`, and `recaptcha_v3_secret_key` in `platformConfig` (admin server-config UI), then rebuild/redeploy the frontend through the normal checked pipeline and recreate affected containers.
4. Verify a real production-hostname v3 token (hostname `engganyo.com`, expected action, successful siteverify) plus working register/login.

## Troubleshooting and operations

- SSH authentication failure: verify VPS_USER, port, private/public key pairing, ownership and modes, and docker-group membership in a fresh login.
- Host fingerprint mismatch: verify the new key through the provider console; update the secret only after verification.
- Git permission denied: repair the separate read-only deploy key, not VPS_SSH_KEY.
- GHCR denied: check the repository/package Actions access and job package permissions.
- Missing .env/certificate: finish steps 5-6. Deployment fails before replacing applications.
- Migration/startup failure: inspect API logs; never use prisma migrate reset on the VPS.
- Deployment rejects tracked changes: inspect and preserve server edits; move intended changes into Git rather than using a destructive reset.
- Health timeout: inspect logs and fix/revert through Git. There is no automatic schema rollback.

For compose operations after deployment, include both env files so recreation preserves the recorded release image tags. `docker compose ... restart` restarts existing containers; it does not fetch new code.

Do not enable the legacy auto-deploy.service at boot. Docker's restart policies restart existing services after reboot. The legacy script can bypass checks and select mutable latest images; it is not the automatic GitHub pipeline. If an old host had it enabled, disable it with systemctl disable --now auto-deploy as root.

Back up PostgreSQL, uploads and encryption/environment material off-host and verify restoration. A failed update may leave services unavailable; keep the previous release tags and a pre-migration backup available. Coordinate database schema changes between both collaborators.
