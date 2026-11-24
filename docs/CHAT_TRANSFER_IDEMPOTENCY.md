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
`engganyo:chat:pending:<userId>:<scopeHash>`:

- Persisted before the request fires; params frozen at creation.
- `committed` and `rejected` (definitive 4xx) clear the slot;
  `uncertain` (network error, 5xx, lost response) keeps it.
- Recovery banner lists unfinished intents, asks the lookup endpoint
  whether the key committed, offers an explicit Resend that replays the
  original key and params. Another account's intents are fenced off by
  the per-user namespace and re-verified `userId` inside the payload.

Regression coverage: `apps/web/e2e/chat-transfer-recovery.spec.ts`
(lost response, reload, intervening intent, account switch) and
`apps/web/src/lib/idempotency.test.ts` (store semantics).
