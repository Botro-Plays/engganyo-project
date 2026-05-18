# SSL Certificates

This directory is mounted into the nginx container at `/etc/ssl/cf/`.

Place these two files here **on the VPS only** — they are gitignored and must never be committed.

| File | Description |
|------|-------------|
| `cert.pem` | Cloudflare Origin Certificate (public cert) |
| `key.pem` | Private key for the origin certificate |

## How to Generate (Cloudflare Origin Certificate)

1. Go to **Cloudflare Dashboard → engganyo.com → SSL/TLS → Origin Server**
2. Click **Create Certificate**
3. Select RSA 2048, add hostnames: `engganyo.com` and `*.engganyo.com`
4. Set validity (15 years is fine — the cert is only trusted by Cloudflare)
5. Download both files and save them here as `cert.pem` and `key.pem`

## On the VPS

```bash
# After git pull, place your cert files:
nano /opt/engganyo-project/infra/nginx/ssl/cert.pem   # paste certificate
nano /opt/engganyo-project/infra/nginx/ssl/key.pem    # paste private key

# Set permissions
chmod 644 /opt/engganyo-project/infra/nginx/ssl/cert.pem
chmod 600 /opt/engganyo-project/infra/nginx/ssl/key.pem
```

These files are mounted into the nginx container at the **same absolute path**:
`/opt/engganyo-project/infra/nginx/ssl/cert.pem` and `key.pem`

> **Note:** These files persist on the VPS across deploys because `git pull` does not
> touch untracked/gitignored files. You only need to place them once.
