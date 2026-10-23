#!/bin/bash
set -u
cd /opt/engganyo-project/infra/nginx/ssl
J=/tmp/fixture.json
UTOK=$(python3 -c "import json;print(json.load(open('$J'))['userTok'])")
ATOK=$(python3 -c "import json;print(json.load(open('$J'))['adminTok'])")
SUB=$(python3 -c "import json;print(json.load(open('$J'))['subId'])")
LIKE=$(python3 -c "import json;print(json.load(open('$J'))['likeId'])")
CMP=$(python3 -c "import json;print(json.load(open('$J'))['completionId'])")
C="curl -s -k --cert origin-pull-client.pem --key origin-pull-key.pem --resolve engganyo.com:443:127.0.0.1"
b=https://engganyo.com/api
echo "== assign YOUTUBE_SUBSCRIBE campaign =="
$C -X POST -H "Authorization: Bearer $UTOK" $b/tasks/$SUB/assign | head -c 300; echo
echo "== submit on SUBMITTED YOUTUBE_LIKE completion =="
$C -X POST -H "Authorization: Bearer $UTOK" -H 'Content-Type: application/json' -d '{"proofUrl":"https://example.com/p.png"}' $b/tasks/$LIKE/submit | head -c 300; echo
echo "== recheck YOUTUBE_LIKE =="
$C -X POST -H "Authorization: Bearer $UTOK" $b/tasks/$LIKE/recheck | head -c 300; echo
echo "== create YOUTUBE_WATCH campaign =="
$C -X POST -H "Authorization: Bearer $UTOK" -H 'Content-Type: application/json' -d '{"title":"test watch campaign","taskType":"YOUTUBE_WATCH","targetUrl":"https://youtube.com/watch?v=x","totalSlots":10,"creditPerTask":5,"requiresProof":true}' $b/campaigns | head -c 300; echo
echo "== owner approve on YOUTUBE submission =="
$C -X PATCH -H "Authorization: Bearer $ATOK" -H 'Content-Type: application/json' -d '{"action":"approve"}' $b/campaigns/$LIKE/submissions/$CMP/review | head -c 300; echo
echo "== owner reject (control, should still work) =="
$C -X PATCH -H "Authorization: Bearer $ATOK" -H 'Content-Type: application/json' -d '{"action":"reject","reason":"policy-disabled"}' $b/campaigns/$LIKE/submissions/$CMP/review | head -c 300; echo
echo "== health sanity =="
$C -o /dev/null -w '%{http_code}\n' $b/health
