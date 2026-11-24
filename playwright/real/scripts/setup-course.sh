#!/bin/bash
# Additive only (no reseed): adds testmycode/tmc-testcourse to COURSE, a page with $EXERCISES in CHAPTER unless a
# python3_simple exists, enrolls $STUDENTS in INSTANCE, and writes the ids to ids.env. Rerun after every reseed;
# after a redeploy (downloads 404) rerun with RESYNC=1.
set -euo pipefail
E2E="$(cd "$(dirname "$0")" && pwd)"
rm -f "$E2E/ids.env"
source "$E2E/env.sh"
export COURSE="${COURSE:-7f36cf71-c2d2-41fc-b2ae-bbbcafab0ea5}" # introduction-to-everything, fixed by the seed
STUDENTS="${STUDENTS:-user student1 student2 student3 student4 student5 student6 student7 student8}"
curl -s -c "$E2E/admin.jar" -o /dev/null -w 'admin login %{http_code}\n' -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"admin"}' "$B/auth/login"
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
# Chapter and instance ids change with every reseed.
export CHAPTER="${CHAPTER:-$(curl -sf -b "$E2E/admin.jar" "$B/main-frontend/chapters/$COURSE/all-chapters-for-course" |
  json '[c["id"] for c in d if c["name"]=="The Basics" and not c["deleted_at"]][0]')}"
export INSTANCE="${INSTANCE:-$(curl -sf -b "$E2E/admin.jar" "$B/main-frontend/courses/$COURSE/course-instances" |
  json '[i["id"] for i in d if i["name"] is None and not i["deleted_at"]][0]')}"
echo "COURSE=$COURSE CHAPTER=$CHAPTER INSTANCE=$INSTANCE"
st=$(curl -s -b "$E2E/admin.jar" "$B/main-frontend/exercise-repositories/course/$COURSE")
if [ -n "${RESYNC:-}" ]; then
  # bin/test's file store is pod-local: a redeploy keeps the DB but loses the synced archives, so
  # downloads 404. Drop the repository and our tmc pages, then sync and create them again.
  for repo in $(echo "$st" | json '" ".join(r["id"] for r in d)'); do
    curl -s -b "$E2E/admin.jar" -o /dev/null -w "delete repository $repo %{http_code}\n" -X DELETE "$B/main-frontend/exercise-repositories/$repo"
  done
  for page in $(curl -sf -b "$E2E/admin.jar" "$B/main-frontend/courses/$COURSE/exercises" |
    json '" ".join(sorted({e["page_id"] for e in d if e["name"] in ("python3_simple","python3_mockio") and not e["deleted_at"]}))'); do
    curl -s -b "$E2E/admin.jar" -o /dev/null -w "delete page $page %{http_code}\n" -X DELETE "$B/main-frontend/pages/$page"
  done
  st="[]"
fi
if [ "$st" = "[]" ]; then
  curl -s -b "$E2E/admin.jar" -H 'content-type: application/json' \
    -d "{\"course_id\":\"$COURSE\",\"exam_id\":null,\"git_url\":\"https://github.com/testmycode/tmc-testcourse\",\"public_key\":null,\"deploy_key\":null}" \
    "$B/main-frontend/exercise-repositories/new"; echo
fi
for _ in $(seq 1 100); do
  st=$(curl -s -b "$E2E/admin.jar" "$B/main-frontend/exercise-repositories/course/$COURSE")
  echo "$st" | grep -q '"Pending"' || break
  sleep 3
done
echo "$st"
# A page from an earlier run survives a redeploy (only a reseed drops it); reuse it.
PAGE=$(curl -sf -b "$E2E/admin.jar" "$B/main-frontend/courses/$COURSE/exercises" |
  json 'next((e["page_id"] for e in d if e["name"]=="python3_simple" and not e["deleted_at"]), "")')
if [ -z "$PAGE" ]; then
  page=$(python3 "$E2E/create_tmc_page.py" "$E2E/admin.jar" ${EXERCISES:-python3_simple python3_mockio})
  echo "$page"
  PAGE=$(echo "$page" | json 'd["page_id"]')
else
  echo "reusing page $PAGE"
fi
for who in $STUDENTS; do
  curl -s -c "$E2E/student.jar" -o /dev/null -w "$who login %{http_code} " -H 'content-type: application/json' \
    -d "{\"email\":\"$who@example.com\",\"password\":\"$who\"}" "$B/auth/login"
  curl -s -b "$E2E/student.jar" -o /dev/null -w 'enroll %{http_code}\n' -H 'content-type: application/json' \
    -d '{"background_question_answers":[]}' "$B/course-material/course-instances/$INSTANCE/save-course-settings"
done
printf 'COURSE=%s\nCHAPTER=%s\nINSTANCE=%s\nPAGE=%s\n' "$COURSE" "$CHAPTER" "$INSTANCE" "$PAGE" >"$E2E/ids.env"
curl -sf -b "$E2E/admin.jar" "$B/main-frontend/courses/$COURSE/exercises" |
  json '"\n".join("EXERCISE_" + e["name"].upper() + "=" + e["id"] for e in d if e["page_id"]=="'"$PAGE"'" and not e["deleted_at"])' >>"$E2E/ids.env"
cat "$E2E/ids.env"
