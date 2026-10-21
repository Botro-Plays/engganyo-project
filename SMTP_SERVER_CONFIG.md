# SMTP configuration in Server Config

## Operator setup

After this change is deployed, open **Server Config → Email** as `admin` or `botro` (SUPER_ADMIN).

1. Choose the Resend or SendGrid preset, or enter another provider's host/port/login.
2. Enter the provider password/API key and a sender address verified with that provider.
3. Enable **Use Server Config for email delivery**, then save.
4. Click **Send test to my email**. This submits a message to the signed-in super admin's email address. Check the actual inbox/spam folder; SMTP submission alone is not proof of inbox delivery.

Resend uses `smtp.resend.com`, port 465 with implicit TLS, username `resend`, and its API key as the password. SendGrid uses `smtp.sendgrid.net`, port 587 with STARTTLS, username `apikey`, and its API key as the password.

## Runtime behavior

- Saved overrides apply to queued verification, password reset, email 2FA, digests, announcements, direct announcement tests, and the SMTP test endpoint. No API restart or frontend rebuild is required to change settings.
- Each send resolves the latest saved settings. Existing waiting/retried queue jobs also use the current configuration when they execute.
- When the override switch is off (or no row exists), the existing `SMTP_*` environment configuration is used. Turning it off does **not** disable email. This is configuration fallback, not automatic provider failover after a send failure.
- Passwords are encrypted using the existing AES-256-GCM utility and the VPS `ENCRYPTION_KEY`. Keep that key in the secure off-host backup alongside database backups. It is required to decrypt saved credentials.
- The API returns a `passwordSet` flag, never plaintext or ciphertext. An empty password input preserves the existing credential. Changing the SMTP server, port, TLS mode, or login while enabling the override requires a replacement password so an old credential is not inadvertently sent to another server. Leave the username empty only for an intentional unauthenticated SMTP server.
- Settings are stored atomically in one private `platformConfig` row, `smtp_settings`. No schema migration is needed. The generic Server Config endpoints cannot modify this row. Existing public configuration responses do not expose it.
- The three endpoints (`GET/PATCH /admin/smtp-settings`, `POST /admin/smtp-settings/test`, under the API prefix) inherit the admin authentication, role, 2FA, and PIN guards and require SUPER_ADMIN. Tests send only to the current authenticated account, not an arbitrary recipient.
- Changes create an audit entry containing the action and flags, without submitted credentials. SMTP errors returned to the API and queue are sanitized. Existing broader authentication findings remain separate audit work.

## Validation and release

This work is prepared on `codex/smtp-server-config`. It does not configure any real provider or send email during automated tests. Publish it through the normal checked workflow after review; do not edit production secrets into source files.

The live release still needs a real provider test, verification/password-reset delivery checks, and a browser check of the Email tab. Existing queued email failures are not automatically retried by saving settings; retry intentionally from queue management after configuration.
