# Engganyo.com: FINAL COMPLETE FIX (step by step, for the developer and his AI)

Date: 2026-11-22. Live site: https://engganyo.com. Today's score: 87 of 100 (it was 50 on 20 November). This is the last file. It lists everything that is still open, in order, with exact steps, exact wording, and a command that proves each step worked. When every step is done and the final script (section 6) prints only PASS, the site has nothing left to fix in code or in Cloudflare.

## 0. Read this first

- Do the tasks in order. After each task run its CHECK. If a CHECK does not pass, stop and fix it before moving on.
- Do not change anything that is not in this file. Do not invent facts, prices, names, numbers or claims. If a fact is missing, ask the owner.
- Keep the site on theme: dark navy surfaces, blue and gold accents, the two pixel fonts already in use. Reuse the existing components and Tailwind tokens (for example `text-sc-text`, `text-sc-muted`, `bg-surface-card`, `bg-brand-500`, `text-brand-400`). No new fonts, no new colors.
- Writing rules for all new text: plain words, short sentences, no hype, no emojis, no arrows, no em dashes.
- Page addresses use lowercase letters and digits only, with no hyphens (already true today: /howitworks, /pricing, /safety, /blog). New blog posts follow the same rule.
- Public contact email is contact@engganyo.com. The only official channels are the website and Telegram https://t.me/Engganyo. Do not add any other social profile.

## 1. What is already done (do not redo)

The www redirect, /howitworks with a 301 from the old address, /pricing, /safety, /blog with the first post and RSS, structured data on every page, sharing images on nine pages, small WOFF2 fonts, homepage layout shift fixed (CLS 0), page weight about 360 KB, security headers (CSP in report-only mode), llms.txt, real sitemap dates, ai-input=yes, and consistent text without withdrawal wording.

## 2. What is left (13 tasks)

| # | Task | Why it matters | Time |
|---|---|---|---|
| 1 | Homepage sharing image and card type | Shared links show no picture today | 10 min |
| 2 | Homepage title | Still just the slogan | 5 min |
| 3 | Privacy page email | Crawlers see "[email protected]" | 10 min |
| 4 | Allow PerplexityBot | Blocked with 403 | 10 min |
| 5 | /pricing to 300 words or more | 293 words today | 5 min |
| 6 | Blog index text | Only 97 words | 5 min |
| 7 | Two more blog posts (text provided) | Content and AI search scores | 30 min |
| 8 | Real screenshots with alt text | Images score | 45 min |
| 9 | Enforce the security policy | Report-only does not block anything | 20 min |
| 10 | Defer the polyfills script | Small speed gain | 10 min |
| 11 | Delete the old unused font files | Clean up | 5 min |
| 12 | Merge the robots.txt groups | Tidy | 10 min |
| 13 | Final script and Lighthouse | Proof | 15 min |

## 3. Tasks 1 to 6 (these fix every failing check today)

### Task 1: Homepage sharing image and card type
Problem: the homepage has no `og:image`, no `twitter:image`, and `twitter:card` is "summary". Every other page is already correct.
Steps:
1. Open the homepage metadata (in the Next.js App Router this is the `metadata` export in `app/page.tsx` or the root `app/layout.tsx`).
2. Make it the same as the other pages:
```
openGraph: {
  title: "Engganyo: Creator Engagement Exchange - Earn Credits",
  description: "Engganyo is a creator engagement exchange where members complete small social tasks for each other, earn credits, and spend them on campaigns for their own accounts.",
  url: "https://engganyo.com/",
  images: [{ url: "/brand/social-1200x630.png", width: 1200, height: 630, alt: "Engganyo: Small Taps. Big Crowds." }],
},
twitter: {
  card: "summary_large_image",
  title: "Engganyo: Creator Engagement Exchange - Earn Credits",
  images: ["/brand/social-1200x630.png"],
},
```
3. Deploy.
CHECK: `curl -s https://engganyo.com/ | grep -c 'og:image'` is 1 or more, and `curl -s https://engganyo.com/ | grep -c summary_large_image` is 1 or more.

### Task 2: Homepage title
Problem: the title is `Engganyo | Small Taps. Big Crowds.`
Steps:
1. In the same homepage metadata set `title: { absolute: "Engganyo: Creator Engagement Exchange - Earn Credits" }` (use `absolute` so the title template does not add "| Engganyo" again).
2. Keep the visible H1 as it is now ("Engganyo: a creator engagement exchange").
CHECK: `curl -s https://engganyo.com/ | grep -o '<title>[^<]*'` prints `<title>Engganyo: Creator Engagement Exchange - Earn Credits`.

### Task 3: Privacy page email (Cloudflare)
Problem: /privacy still shows the email as "[email protected]" to crawlers (one place).
Steps:
1. Log in to Cloudflare and open the engganyo.com site.
2. Go to **Scrape Shield** (in newer dashboards: Security, Settings, search "Email Address Obfuscation").
3. Switch **Email Address Obfuscation** to **Off**. If you want to keep it on for other paths, create a Configuration Rule for the path `/privacy` and set Email Obfuscation to Off.
4. In the code, make sure the address is written as a normal link: `<a href="mailto:contact@engganyo.com">contact@engganyo.com</a>`.
5. Purge the Cloudflare cache for /privacy (Caching, Configuration, Custom Purge).
CHECK: `curl -s https://engganyo.com/privacy | grep -c email-protection` returns 0.

### Task 4: Allow PerplexityBot (Cloudflare)
Problem: `curl -A PerplexityBot https://engganyo.com/` returns 403. Cloudflare blocks it. Leave ClaudeBot and the training crawlers (GPTBot, CCBot, Google-Extended, Bytespider and similar) blocked on purpose.
Steps:
1. Cloudflare, engganyo.com, **AI Crawl Control** (it may sit under Security or Bots). Open the **Crawlers** tab. Find **Perplexity** and set it to **Allow**. Save.
2. Test (command below). If it is still 403, another rule is blocking it:
   a. **Security, Bots:** turn off **Block AI bots** only if step 1 did not work, because it blocks all AI crawlers at once. If you must turn it off, re-block the training crawlers one by one in AI Crawl Control.
   b. **Security, WAF, Custom rules:** look for a rule that blocks or challenges bots. Add a new rule at the top: when **User Agent contains `PerplexityBot`**, action **Skip** (all remaining custom rules and bot protections) or **Allow**.
3. Wait two minutes and test again.
CHECK: `curl -s -o /dev/null -w '%{http_code}' -A PerplexityBot https://engganyo.com/` returns 200. Also confirm `curl -s -o /dev/null -w '%{http_code}' -A ClaudeBot https://engganyo.com/` still returns 403 (expected).

### Task 5: /pricing needs 300 words or more
Problem: 293 words.
Steps: at the end of the "Where credits go" section add this paragraph:
"If you are not sure how much to buy, start with the free 200 credits, do a few tasks, and see how approval works before you decide. You can read how the whole loop works on the how Engganyo works page, and you can find answers to common questions in the FAQ."
Make "how Engganyo works" a link to /howitworks and "FAQ" a link to /faq.
CHECK: `curl -s https://engganyo.com/pricing | sed 's/<script[^>]*>[^<]*<\/script>//g;s/<[^>]*>/ /g' | wc -w` prints 300 or more.

### Task 6: Blog index text
Problem: the blog index has only 97 words. Replace the intro with this and keep the post list below it:
"Plain guides and updates for creators who want to grow their pages. We say what we checked and what we could not confirm.
What you will find here: guides for new members, plain explanations of how credits work, safety tips for doing tasks on any exchange site, and product updates. New posts are added as we learn what members ask for. Have a topic you want covered? Write to contact@engganyo.com or join the community on Telegram at t.me/Engganyo."
Link "contact@engganyo.com" as a mailto link and "t.me/Engganyo" to https://t.me/Engganyo.
CHECK: `curl -s https://engganyo.com/blog | sed 's/<script[^>]*>[^<]*<\/script>//g;s/<[^>]*>/ /g' | wc -w` prints 150 or more.

## 4. Task 7: Two more blog posts (text is provided, use it as written)

Each post follows the same setup as the first post: its own title, meta description, canonical, og:image (`/brand/social-1200x630.png`), BlogPosting structured data (headline, datePublished, dateModified, author "Engganyo", image), a sitemap entry with the real date, a link in the blog index and in the RSS feed. Set datePublished to the day you publish.

### Post 2
- Slug: `howcreditsworkonengganyo`
- Title: `How credits work on Engganyo`
- Meta description: `A plain explanation of how credits work on Engganyo: how you earn them, how you can buy them, and where they go.`
- Body:

"Credits are the money inside Engganyo. They let creators help each other without anyone paying cash for a task. Here is how they work in plain words.

How you earn credits. You open the Tasks page and pick a task for a platform you use. You do the action, such as a follow or a join, and upload a screenshot as proof. The campaign owner reviews your proof. When it is approved, the credits arrive in your wallet. Some tasks, like certain Twitch and Spotify follows, can verify automatically through a linked account instead.

How you can get more. Every new member starts with 200 free credits. The dashboard also shows a daily streak reward and a free daily spin. If you want to move faster, you can buy credits in the Wallet. The packages are priced in USD and larger packages include bonus credits. Prices and bonuses can change, so check the Wallet for the current packages. Bought credits and earned credits work the same way.

Where credits go. You spend credits on campaigns for your own accounts. When you create a campaign you choose a platform, add your link, set the reward for each task and decide how many people you want. You can also challenge another member in a 1v1 challenge. The reward for a challenge is reserved up front. The store is another place to spend credits.

What credits are not. Credits are used inside Engganyo only. They cannot be withdrawn as money.

Keep your account safe. Never share a social media password with anyone. Engganyo never asks for it. Read the rules of each platform before you do a task. Doing tasks on any exchange site can go against a platform's rules, and platforms can warn, restrict or ban accounts.

Want the full picture? Read how Engganyo works, the pricing page and the FAQ. If you still have a question, write to contact@engganyo.com or ask on Telegram at t.me/Engganyo."

Links inside the text: "how Engganyo works" to /howitworks, "pricing page" to /pricing, "FAQ" to /faq.

### Post 3
- Slug: `stayingsafewithtaskexchanges`
- Title: `Staying safe when you use a task exchange site`
- Meta description: `Simple safety rules for using any task exchange site: passwords, platform rules, small first steps and what to do if something goes wrong.`
- Body:

"Task exchange sites can help small creators get noticed. They also carry risk. These simple rules apply to Engganyo and to any similar site.

Rule 1: Never share a password. No honest site needs your social media password. Engganyo never asks for it. If a site asks, leave.

Rule 2: Read the platform's rules first. Every platform decides what is allowed. Doing tasks on any exchange site can go against a platform's rules, and platforms can warn, restrict or ban accounts. Engganyo cannot change that, so read the rules before you start.

Rule 3: Start small. Do one or two tasks and see what happens. Do not run a big campaign on day one.

Rule 4: Keep proof clear. Upload a clean screenshot that shows what the task asked for. Clear proof gets approved faster.

Rule 5: Check who reviews your work. On Engganyo the campaign owner reviews your proof before credits are released, and some tasks verify automatically through a linked account. Know which kind of task you are doing.

Rule 6: Keep your money plan simple. Credits cannot be withdrawn as money on Engganyo. Only buy credits if you want to run campaigns, and only the amount you are happy to spend.

If something goes wrong. If a platform warns or restricts an account, Engganyo cannot reverse that, because the platform makes that decision alone. If a task was approved or rejected by mistake, write to us with your username and the task, by email or on Telegram.

More details are on the safety page and in the FAQ. Questions? contact@engganyo.com or t.me/Engganyo."

Links inside the text: "safety page" to /safety, "FAQ" to /faq.

CHECK for both posts: the two addresses return 200, appear in `/sitemap.xml`, appear in `/blog/rss.xml`, and `curl -s URL | grep -c BlogPosting` is 1 or more.

## 5. Tasks 8 to 12 (quality and tidy-up)

### Task 8: Real screenshots with alt text (Images score)
Today the pages have only two small logo images. Add real pictures of the product.
Important: do NOT use the old screenshots in the SEO project folder. They show the old homepage with the wording "no bots, no fake engagement", "Real humans only" and made-up counters. Take fresh ones:
1. Sign in with a test account on the live app at a laptop size of 1440 by 900.
2. Capture three screens: (a) the Tasks page with open tasks and rewards, (b) the Campaigns page (create campaign form), (c) the Wallet page showing the credit packages. Hide or blur any personal data and any real usernames.
3. Convert to WebP (about 80 percent quality, max width 1200): `cwebp -q 80 -resize 1200 0 input.png -o output.webp`. Or use `next/image`, which converts automatically.
4. Save in `/public/brand/` as `product-tasks.webp`, `product-campaigns.webp`, `product-wallet.webp`.
5. Use `next/image` with explicit `width` and `height`, `loading="lazy"` (below the fold), and this alt text:
   - `Engganyo Tasks page showing open tasks and the credit reward for each one`
   - `Engganyo Campaigns page with the form for creating a campaign`
   - `Engganyo Wallet page showing credit packages`
6. Place them: tasks and campaigns images on /howitworks (next to steps 2 and 4), wallet image on /pricing. Add a visible caption under each image.
CHECK: `curl -s https://engganyo.com/howitworks | grep -o '<img[^>]*>' | grep -c 'alt="[A-Za-z]'` returns 3 or more (logos included), and every `<img>` has `width` and `height`.

### Task 9: Enforce the security policy
1. Look at the report-only Content-Security-Policy reports (or the browser console on each page) for blocked items.
2. If nothing legitimate is blocked, rename the header from `Content-Security-Policy-Report-Only` to `Content-Security-Policy`. Keep the same value. Allow only what the site uses (Google reCAPTCHA, Cloudflare Insights).
3. Open the homepage, a task page, login, register and the wallet in a browser and confirm nothing breaks.
CHECK: `curl -sI https://engganyo.com/ | grep -i '^content-security-policy:'` prints a line (not `-report-only`).

### Task 10: Defer the polyfills script
The `polyfills` script blocks rendering. If your supported browsers do not need it, remove it. If you cannot be sure, add `defer`. Test the main flows.
CHECK: Lighthouse mobile performance stays 90 or more.

### Task 11: Delete the old unused font files
The old TTF font files (DotGothic16 and VT323 .ttf) are still on the server but nothing loads them. Delete them from `/public` or the fonts folder and redeploy.
CHECK: `curl -s -o /dev/null -w '%{http_code}' https://engganyo.com/<path of the old ttf>` returns 404.

### Task 12: Merge the robots.txt groups
There are two `User-agent: *` groups. Cloudflare's managed block is one of them.
1. Keep Cloudflare's managed AI crawler block as it is (it is managed by Cloudflare).
2. Put all your own rules into a single `User-agent: *` group: `Allow: /`, `Disallow: /api/`, and the Content-Signal line `Content-Signal: search=yes, ai-input=yes, ai-train=no`.
3. Keep the `Sitemap: https://engganyo.com/sitemap.xml` line.
If Cloudflare re-adds its own wildcard group above yours, that is acceptable. Write that in your report and leave it.
CHECK: `curl -s https://engganyo.com/robots.txt | grep -ci '^user-agent: \*$'` prints 1, or 2 if Cloudflare's own group stays (acceptable).

## 6. Task 13: Final script (run last, paste the whole output in the report)

Run in any shell. Every line must say PASS. The only acceptable exception is the robots line when it prints 2 because of Cloudflare's own group.

```
#!/bin/sh
B=https://engganyo.com; U="Mozilla/5.0"
chk(){ if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1 (got $2, want $3)"; fi; }
yes_no(){ if [ "$1" -ge "$2" ]; then echo yes; else echo no; fi; }
words(){ curl -s -A "$U" "$1" | sed 's/<script[^>]*>[^<]*<\/script>//g;s/<[^>]*>/ /g' | wc -w | tr -d ' '; }
chk "www redirect 301" "$(curl -s -o /dev/null -w '%{http_code}' -A "$U" https://www.engganyo.com/about)" 301
chk "old how-it-works redirects 301" "$(curl -s -o /dev/null -w '%{http_code}' -A "$U" $B/how-it-works)" 301
for p in howitworks pricing safety blog blog/rss.xml blog/yourfirstweekonengganyo blog/howcreditsworkonengganyo blog/stayingsafewithtaskexchanges llms.txt; do chk "$p is 200" "$(curl -s -o /dev/null -w '%{http_code}' -A "$U" $B/$p)" 200; done
chk "unknown url is 404" "$(curl -s -o /dev/null -w '%{http_code}' -A "$U" $B/nope-xyz)" 404
chk "PerplexityBot allowed" "$(curl -s -o /dev/null -w '%{http_code}' -A PerplexityBot $B/)" 200
chk "OAI-SearchBot allowed" "$(curl -s -o /dev/null -w '%{http_code}' -A OAI-SearchBot $B/)" 200
chk "Googlebot allowed" "$(curl -s -o /dev/null -w '%{http_code}' -A Googlebot $B/)" 200
chk "bingbot allowed" "$(curl -s -o /dev/null -w '%{http_code}' -A bingbot $B/)" 200
chk "ClaudeBot stays blocked (on purpose)" "$(curl -s -o /dev/null -w '%{http_code}' -A ClaudeBot $B/)" 403
chk "no hyphen in sitemap page paths" "$(curl -s $B/sitemap.xml | grep -o '<loc>[^<]*' | sed 's#<loc>https://engganyo.com##' | grep -c -- '-')" 0
chk "sitemap has no old url" "$(curl -s $B/sitemap.xml | grep -c how-it-works)" 0
chk "sitemap lists both new posts" "$(curl -s $B/sitemap.xml | grep -c -E 'howcreditsworkonengganyo|stayingsafewithtaskexchanges')" 2
chk "rss lists both new posts" "$(curl -s $B/blog/rss.xml | grep -c -E 'howcreditsworkonengganyo|stayingsafewithtaskexchanges')" 2
for p in "" about faq contact privacy terms howitworks pricing safety blog blog/yourfirstweekonengganyo blog/howcreditsworkonengganyo blog/stayingsafewithtaskexchanges; do
  H=$(curl -s -A "$U" $B/$p)
  chk "/$p JSON-LD" "$(yes_no $(echo "$H" | grep -c 'application/ld+json') 1)" yes
  chk "/$p one H1" "$(echo "$H" | grep -o '<h1' | wc -l | tr -d ' ')" 1
  chk "/$p canonical" "$(yes_no $(echo "$H" | grep -c 'rel="canonical"') 1)" yes
  chk "/$p og:image" "$(yes_no $(echo "$H" | grep -c 'og:image') 1)" yes
  chk "/$p twitter large card" "$(yes_no $(echo "$H" | grep -c 'summary_large_image') 1)" yes
  chk "/$p plain email" "$(echo "$H" | grep -c 'email-protection')" 0
done
chk "home title" "$(curl -s -A "$U" $B/ | grep -c '<title>Engganyo: Creator Engagement Exchange - Earn Credits')" 1
chk "no bots claim on home" "$(curl -s -A "$U" $B/ | grep -ci 'no bots')" 0
chk "no withdraw-as-money wording" "$(for p in about faq terms privacy howitworks pricing; do curl -s -A "$U" $B/$p; done | grep -ciE 'withdraw(al)? (as|of) money|paypal|bank transfer|pesos')" 0
chk "CSP enforced (not report-only)" "$(curl -sI -A "$U" $B/ | grep -ci '^content-security-policy:')" 1
chk "Permissions-Policy header" "$(curl -sI -A "$U" $B/ | grep -ci 'permissions-policy')" 1
chk "robots wildcard groups (2 ok if Cloudflare's own stays)" "$(curl -s $B/robots.txt | grep -ci '^user-agent: \*$')" 1
chk "robots has ai-input=yes" "$(curl -s $B/robots.txt | grep -ci 'ai-input=yes')" 1
for p in howitworks pricing safety; do chk "/$p at least 300 words" "$( [ $(words $B/$p) -ge 300 ] && echo yes || echo no)" yes; done
chk "/blog at least 150 words" "$( [ $(words $B/blog) -ge 150 ] && echo yes || echo no)" yes
for p in howitworks pricing; do chk "/$p has real images" "$(yes_no $(curl -s -A "$U" $B/$p | grep -o '<img' | wc -l | tr -d ' ') 3)" yes; done
echo "Now run Lighthouse (mobile) on /, /about, /faq, /howitworks: performance 90 or more, SEO 100, CLS 0.1 or less."
```

Lighthouse:
```
npx lighthouse https://engganyo.com --only-categories=performance,seo,accessibility,best-practices --form-factor=mobile --quiet --chrome-flags="--headless" --output=json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);for(const k in j.categories)console.log(k,Math.round(j.categories[k].score*100));console.log('CLS',j.audits['cumulative-layout-shift'].displayValue,'LCP',j.audits['largest-contentful-paint'].displayValue)})"
```

## 7. What the owner does after you finish (not your job)

1. In Google Search Console (property engganyo.com): open URL inspection, paste each of these and click "Request indexing": `/howitworks`, `/pricing`, `/safety`, `/blog`, and the three blog post addresses. Then Sitemaps: re-submit `https://engganyo.com/sitemap.xml`.
2. Ask for a final re-audit.
3. Later (not code): publish one new blog post every one or two weeks, and keep adding free profile links.

## 8. Honest note on 100 percent

After this file, all the automated checks can print PASS, and the audit score should land around 92 to 95. A literal 100 out of 100 also depends on things outside code: Google indexing the new pages, how many posts exist over time, and mentions from other sites. Rankings and traffic cannot be promised. Do not add filler text, keyword stuffing or fake claims to push a number.

## 9. Report format (reply to the owner)

A table: task number, what changed, CHECK output. Then the full output of the final script and the Lighthouse numbers. List anything you skipped and why. If a Cloudflare setting is not available on the current plan, say which one and what you did instead.
