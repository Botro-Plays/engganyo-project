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
