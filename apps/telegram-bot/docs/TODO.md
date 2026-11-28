# To do and known fixes 📝

What is still open. Update it when something is done.

## Languages 🌍

- [x] 24 languages fully translated offline (Argos Translate, no limits): it, es, pt, de, fr, ro, nl, tr, zh, zh-tw, uk, ru, id, az, ms, sq, el, ar, ko, fa, hi, bn, ur, he.
- [x] The most-used buttons of those 24 are hand-checked (`guardbot/core_ui.py`, `core_hand.py`), because machine translation ruins one-word labels.
- [x] Filipino was added near the top of the picker with a full generated translation and hand-checked core words.
- [x] 8 languages have full generated translations and hand-written core words: kk, uz, uz-cyr, so, sr, am, ku, si. Kurdish uses Central Kurdish and Uzbek Cyrillic is transliterated from Uzbek Latin.
- [ ] Have a native speaker review the machine-translated menus of the languages you care about most; fix wording in `locales/<code>.json` (set `"_hand": true` to keep hand edits when rebuilding).
- [ ] Texts that contain names or numbers inside them stay English (dynamic strings).

## Testing still worth doing 🧪

- [ ] Re-run flood and anti-spam rules live (only unit-tested).
- [ ] Walk through every group-settings screen live with both accounts (Telegram Web is slow, the automatic clicker loses its place).
- [ ] Try the Join Check before-join message with a real join-request link (tested with the test harness only).
- [ ] Test the language flow with account B and with the clone bot.

## Small things

- [ ] Set a profile photo for the bot in @BotFather.
- [ ] If a picture shows a download arrow on a phone: Telegram Settings > Data and Storage > Auto-download media > Photos.
- [ ] The portal check happens in chat (button or maths), not on a hosted web page.
- [ ] Optional: a `/reloadlocales` developer command; a `PICTURE_MODE` switch (photo / off).

## Done in the last rounds ✅

- Green 🟢 on / red 🔴 off on every toggle.
- Join Check rebuilt: before-join message, letting people in (automatic or after verification, or by hand) and the after-join welcome all work on their own.
- Many users at once: parallel updates, per-chat ordering, rate limiter, load test.
- Pictures: small JPEGs, auto-fitting titles, fonts for every script.
- All menus checked in every language for dead ends and for the Main menu keys.
