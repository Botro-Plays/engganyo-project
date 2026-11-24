# Chat transfer idempotency

Contract and rollout state for sender-scoped request identities on
credit-moving chat operations (tips and `/rain`). Stored in
`chat_request_keys` (migration `20261126000000_chat_request_keys`).

## Financial entry-point inventory

| Entry point | Transport | Path | Key support |
|-------------|-----------|------|-------------|
| Send tip | REST | `POST /api/channels/tips` (`SendTipDto.idempotencyKey`) | Optional key, persisted `tip` record |
| Rain command | REST | `POST /api/channels/messages` with `/rain N M` (`SendMessageDto.idempotencyKey`) | Optional key, persisted `rain` record incl. recipient allocation |
| Rain command | Socket | `chat:send` `{channelId, content, idempotencyKey}` -> `sendMessage` | Optional key, same contract |
| Plain chat message | REST / socket | same routes, non-`/rain` content | Not financial; key accepted but no record stored |

`sendTip` and `handleRainCommand` enforce the same contract on every
transport: pre-check, settlement transaction writes the key row, P2002
reads back the committed result, params-hash mismatch returns 409
`IDEMPOTENCY_KEY_REUSED`.

## What "retry-safe" means today

Transfers are retry-safe **only for callers that send a valid
`idempotencyKey` (8-128 chars)**. A keyless call executes as a new
transfer every time - there is no dedupe and no recovery handle. The
web app's own send paths attach persisted keys, but third-party or
legacy clients (including socket `chat:send` callers that omit the
field) remain non-idempotent by design until the transition below ends.

## Compatibility transition (bounded)

Phase 1 (current): keys optional everywhere.

- `CHAT_TRANSFER_REQUIRE_KEY` env flag (default off). When `true`,
  `sendTip` and `handleRainCommand` validate the key before anything
  else and return 400 for keyless calls on every transport.
- `GET /api/channels/transfers/lookup/:key` is a read-only,
  sender-scoped recovery check: returns the committed transfer record
  or `null`. It never settles anything.

Phase 2 (proposed, owner decision): measure before enforcing.

- Add a counter/log line for keyless financial calls per transport for
  one observation period (e.g. two weeks). If keyless volume is
  confined to known legacy clients, announce a cutoff date.
- At the cutoff, set `CHAT_TRANSFER_REQUIRE_KEY=true`. Keyless callers
  then get a 400 naming the required field instead of a silent
  non-idempotent transfer.

Phase 3 (optional): after the flag has been on one release cycle with
no legitimate keyless traffic, remove the flag and make the key
required in the DTOs (`@IsNotEmpty`), dropping the `undefined` branch.

## Client durable intents

`apps/web/src/lib/idempotency.ts` persists one
`PendingTransferIntent` per `(userId, scope)` in localStorage under
`engganyo:chat:pending:<userId>:<encodedScope>`:

- Persisted before the request fires; params frozen at creation. If the
  durable write or its read-back verification fails
  (`IntentPersistenceError`), the financial send is refused - no
  unprotected transfer goes out.
- Outcome classification: only authoritative signals clear a slot - a
  successful response, a committed lookup, or the user hiding the
  notice. NO HTTP error status clears an intent: the axios interceptor
  can retry a committed-but-lost request and surface a guard-level
  401/403/429 (or any other refusal) that ran before the replay check,
  so no status proves non-settlement. A 409 is only meaningful with the
  structured `IDEMPOTENCY_KEY_REUSED` code - and it means the key
  committed under different params, i.e. money moved, so the record is
  kept for the lookup to resolve rather than treated as a rejection.
- Exact identity: the slot key embeds the URI-encoded scope verbatim
  (no hashing, so no collisions), reads re-verify the stored scope, and
  `resolve` only clears when the acknowledged request key matches the
  stored one - a stale ack cannot clear a different in-flight request.
- Hide, never delete: hiding the notice sets a flag but keeps the full
  recoverable record (key + params). It never cancels a transfer and
  never frees the scope - an identical send reuses the stored key, so
  an unresolved intent cannot silently rotate into a new keyed
  transfer. A hidden intent un-hides when the user re-attempts it.
- Account + session fencing: slots are namespaced per userId, the
  stored userId is re-verified on read, and recovery actions recheck
  both the authenticated account AND the session generation (access
  token) captured at request time - so a stale response landing after
  logout, account switch, or logout->login-as-same-user cannot update
  or resolve work in the new session. A rotated token can only
  false-fence (the intent stays pending), never false-resolve. Each
  lookup result embeds the session that requested it (provenance
  travels with the result, never through shared mutable state), rows
  are never hidden by an unprovenanced committed result, and resend
  error notifications are fenced to the session that initiated them.
- Recovery banner lists unfinished intents, asks the lookup endpoint
  whether the key committed (auto-resolving committed ones), and
  offers an explicit Resend that replays the original key and params
  plus a Hide for dismissing the notice. Another account's intents are
  fenced off by the per-user namespace and re-verified `userId` inside
  the payload.

Regression coverage: `apps/web/e2e/chat-transfer-recovery.spec.ts`
(lost response, reload, committed-then-guard-denied interceptor
sequence, storage-failure blocking, hide-then-identical-resend key
reuse, intervening intent, account switch, held lookup across token
refresh and across logout->relogin, same-account session change) and
`apps/web/src/lib/idempotency.test.ts` (store semantics, exact
identity, key-matched resolution/hiding, persistence failure,
structured-conflict code recognition).
