# Social Identity Uniqueness & Unlink Cooldown

Status: implemented for **verified (OAuth) identities**; manual-platform
exclusive claims are **proposed, not enabled** (see §4).

## 1. Model

- `social_accounts` keeps `@@unique([userId, platform])` - one link slot
  per user per platform.
- A **partial unique index**
  `social_accounts_verified_platform_identity_key`
  `(platform, platform_user_id) WHERE is_verified = true` makes a
  verified identity exclusive to one Engganyo user. The index is DB-level
  so concurrent OAuth callbacks cannot both win.
- `social_identity_reservations` `(platform, identity_key)` unique - 24h cooldown after a verified unlink. `released_by_user_id` is a plain
  string (no FK): account deletion cannot bypass a reservation.

## 2. Identity key

The authoritative key is `platform + platform_user_id` - the stable
provider-side account id returned by OAuth (YouTube channel id, Twitch
user id, Spotify user id). Handles are display metadata and may be
renamed; they are never the reservation key for verified identities.

Unverified rows use synthetic/username `platform_user_id` values and are
excluded from both the unique index and reservations.

## 3. Flows

- **OAuth link** (`social-auth` callback): transaction =
  release-old-identity (if switching verified ids) → reservation claim →
  upsert `is_verified=true` → consume reservation. Conflict →
  `?error=identity_reserved&until=<iso>`; unique-index race →
  `?error=identity_taken`.
- **Verified unlink** (`DELETE social-auth/:platform`,
  `DELETE users/me/social/:platform`, admin user deletion): transaction =
  upsert reservation `now()+24h` → delete row (tokens die with it).
  Response carries `reservedUntil` for the owner's display only.
- **Cooldown semantics**: original owner may reconnect after re-proving
  (OAuth) - claim consumes the reservation. Others must wait for
  `reservedUntil`. Failed attempts never write, so they cannot extend
  the window. Re-unlink after reconnect upserts a fresh 24h.
- **Unverified declarations** (`manual-link`, `PUT /users/me/social`)
  never reserve, never block, and remain usable for manual-proof task
  participation. `PUT /users/me/social` no longer rewrites
  `platform_user_id` on verified rows.

## 4. Manual platforms - proposed verification (NOT enabled)

Twitter/X, TikTok, Instagram, Facebook, Telegram, Discord, Trustpilot,
Google have no OAuth integration today, so no verified ownership proof
exists. Until one is implemented, exclusive claims stay disabled for
them - handle declarations remain non-exclusive by design.

Proposed flow when ready (per platform):

- **Twitter/X**: OAuth 2.0 PKCE (`tweet.read` + `users.read`) → stable
  `data.id`. Limitations: requires X developer app approval; renamed
  handles keep the same id - correct behavior.
- **Instagram / Facebook**: Meta OAuth → immutable `user_id` / Page id.
  Limitations: app review for advanced access; personal vs Page
  identity distinction must be specified.
- **TikTok**: OAuth → `open_id` (stable) + `union_id`. Limitations:
  scopes audited by TikTok; handle changes keep `open_id` stable.
- **Telegram**: no public OAuth; verification could use a bot-issued
  proof (user starts bot, bot confirms account) - documented as weaker
  assurance; reserve only after owner approves the flow.
- **Discord**: OAuth2 `users.id` - straightforward once an app exists.
- **Trustpilot / Google**: no suitable public OAuth for review identity;
  keep declaration-only unless a documented proof method is approved.

Normalization policy for future handle-based claims: normalize per
platform rules only (strip leading `@`, lowercase where the platform is
case-insensitive, canonicalize URL host variants) - never a blanket
rule; case-sensitive platforms (e.g., some gaming IDs) keep case.

## 5. Display

- Disconnect response → owner sees exact `reservedUntil` local time.
- OAuth conflict → `identity_reserved` + `until` param → frontend shows
  availability time; previous owner is never exposed.
- `identity_taken` → already linked to another account.

## 6. Tests

`social-identity.integration.spec.ts` (real PostgreSQL): exclusive
verified claims + concurrent race, unverified non-reservation,
normalization, both unlink paths, cooldown conflict/owner-reconnect,
24h boundary, failed-attempt immutability, fresh cooldown on
re-unlink, identity-switch release + rollback, deletion survival,
verified-id preservation on profile edits.
