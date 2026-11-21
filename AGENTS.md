# Project writing rules

- Do not use em dashes (Unicode U+2014) in first-party project text, including UI copy, metadata, emails, comments, and documentation. Rewrite with a period, comma, parentheses, or a plain hyphen as appropriate.
- Use a vertical bar to separate the brand and tagline in page titles: `Engganyo | Small Taps. Big Crowds.`
- Apply the same title wording to homepage social metadata and structured data. Keep route-specific titles descriptive.
- Preserve external documents, vendored assets, identifiers, and historical migration behavior when cleaning punctuation. Flag external artifacts rather than modifying their contents silently.

# Verification constraints

- Keep heavy local services stopped. Use GitHub Actions for heavy builds and tests.
- Keep reCAPTCHA enabled and use normal owner-assisted login for authenticated acceptance. Never mint production tokens.
- Do not execute production cleanup or reset, enable pending gamification economics, or add deferred advertising without explicit owner authorization.
