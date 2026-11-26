import http.cookiejar, json, sys, urllib.request, uuid

B = "http://project-331.local/api/v0"
import os
COURSE = os.environ["COURSE"]
CHAPTER = os.environ["CHAPTER"]
JAR = sys.argv[1]
WANTED = sys.argv[2:] or ["python3_simple"]

jar = http.cookiejar.MozillaCookieJar(JAR)
jar.load(ignore_discard=True, ignore_expires=True)
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(method, path, body=None):
    req = urllib.request.Request(B + path, method=method, data=None if body is None else json.dumps(body).encode(), headers={"content-type": "application/json"})
    try:
        return json.load(opener.open(req))
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path} -> {e.code}: {e.read().decode()[:2000]}")


repo_exercises = {r["name"]: r for r in call("GET", f"/cms/repository-exercises/{COURSE}")}
exercises, slides, tasks, blocks = [], [], [], []
for n, name in enumerate(WANTED, 1):
    ex, sl, tk, bl = (str(uuid.uuid4()) for _ in range(4))
    blocks.append({"clientId": bl, "name": "moocfi/exercise", "isValid": True, "attributes": {"id": ex, "name": name, "dropCap": False}, "innerBlocks": []})
    exercises.append({"id": ex, "name": name, "order_number": n, "score_maximum": 1, "max_tries_per_slide": None, "limit_number_of_tries": False, "deadline": None, "needs_peer_review": False, "needs_self_review": False, "use_course_default_peer_or_self_review_config": True, "teacher_reviews_answer_after_locking": True, "peer_or_self_review_config": None, "peer_or_self_review_questions": None})
    slides.append({"id": sl, "exercise_id": ex, "order_number": 1})
    tasks.append({"id": tk, "exercise_slide_id": sl, "assignment": [], "exercise_type": "tmc", "private_spec": {"type": "editor", "repository_exercise": repo_exercises[name]}, "order_number": 0, "private_spec_files": []})

page = call("POST", "/main-frontend/pages", {"exercises": exercises, "exercise_slides": slides, "exercise_tasks": tasks, "content": blocks, "url_path": os.environ.get("URL_PATH", "/chapter-1/tmc-exercises"), "title": "TMC exercises", "course_id": COURSE, "exam_id": None, "chapter_id": CHAPTER, "front_page_of_chapter_id": None, "content_search_language": None, "hidden": False})
# The server assigns its own exercise ids.
saved = call("GET", f"/main-frontend/courses/{COURSE}/exercises")
print(json.dumps({"page_id": page["id"], "exercises": {e["name"]: e["id"] for e in saved if e["page_id"] == page["id"] and not e["deleted_at"]}}, indent=2))
