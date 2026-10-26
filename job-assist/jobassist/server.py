"""Локальный HTTP-сервер на 127.0.0.1: отдаёт интерфейс и JSON API."""
import json
import os
import sys
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import base64

from . import ai, jobs, resume
from .store import Store


def web_dir() -> Path:
    base = getattr(sys, "_MEIPASS", None)
    return Path(base) / "jobassist" / "web" if base else Path(__file__).parent / "web"


class Api:
    """Каждый метод post_* / get_* принимает тело запроса и возвращает JSON или (bytes, тип, имя файла)."""

    def __init__(self, store: Store):
        self.store = store
        self.lock = threading.Lock()

    def state(self) -> dict:
        with self.lock:
            return self.store.load()

    def get_state(self, _):
        return self.state()

    def post_state(self, body):
        with self.lock:
            self.store.save(body)
        return {"saved": datetime.now().strftime("%H:%M:%S")}

    def get_info(self, _):
        return {"data_file": str(self.store.path), "providers": {k: v[2] for k, v in ai.PROVIDERS.items()},
                "env_keys": {k: bool(v[1] and os.environ.get(v[1])) for k, v in ai.PROVIDERS.items()}}

    def post_hh_search(self, body):
        items = jobs.hh_search(body.get("text", ""), body.get("area", ""), str(body.get("salary") or ""),
                               bool(body.get("remote")), int(body.get("period") or 7))
        return self._scored(items)

    def post_score(self, body):
        return self._scored(body.get("items", []))

    def post_hh_full(self, body):
        return {"text": jobs.hh_full_text(body["id"])}

    def post_ai(self, body):
        st = self.state()
        return {"text": ai.run_task(body.get("task", ""), body.get("vacancy", ""), body.get("resume", ""),
                                    st.get("profile") or {}, st.get("settings") or {}, body.get("extra", ""))}

    def post_ai_mock(self, body):
        st = self.state()
        return {"text": ai.mock_interview(body.get("role", "HR"), body.get("vacancy", ""), body.get("resume", ""),
                                          body.get("history", []), st.get("profile") or {}, st.get("settings") or {})}

    def post_resume_parse(self, body):
        text = resume.extract_text(body.get("filename", ""), base64.b64decode(body.get("data", "")))
        if not text.strip():
            raise ValueError("В файле нет текстового слоя. Скачайте резюме с hh.ru в PDF заново.")
        return {"text": text, "fields": resume.parse_hh(text)}

    def post_ai_resume(self, body):
        return ai.extract_resume(body.get("resume", ""), self.state().get("settings") or {})

    def post_ai_grill(self, body):
        return {"text": ai.grill(body.get("resume", ""), body.get("context", ""), body.get("vacancies", []),
                                 self.state().get("settings") or {})}

    def post_ai_requirements(self, body):
        return {"requirements": ai.vacancy_requirements(body.get("vacancy", ""), self.state().get("settings") or {})}

    def get_export_xlsx(self, _):
        name = f"jobassist-{datetime.now():%Y-%m-%d}.xlsx"
        return jobs.export_xlsx(self.state()), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name

    def get_export_json(self, _):
        st = self.state()
        st.get("settings", {}).pop("ai_key", None)  # ключ в бэкап не попадает
        data = json.dumps(st, ensure_ascii=False, indent=1).encode("utf-8")
        return data, "application/json", f"jobassist-{datetime.now():%Y-%m-%d}.json"

    def _scored(self, items):
        profile = self.state().get("profile") or {}
        for it in items:
            it.update(jobs.score_vacancy(it, profile))
        return sorted(items, key=lambda x: -(x["score"] or 0))


def make_handler(api: Api):
    web = web_dir()
    types = {".html": "text/html", ".js": "text/javascript", ".css": "text/css"}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, payload, ctype="application/json", filename=None):
            data = payload if isinstance(payload, bytes) else json.dumps(payload, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype + "; charset=utf-8" if ctype.startswith(("text", "application/json")) else ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            if filename:
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            path = urlparse(self.path).path
            if path.startswith("/api/"):
                return self._api("get", path, {})
            f = (web / ("index.html" if path in ("", "/") else path.lstrip("/"))).resolve()
            if web.resolve() not in f.parents or not f.is_file():
                return self._send(404, {"error": "not found"})
            self._send(200, f.read_bytes(), types.get(f.suffix, "application/octet-stream"))

        def do_POST(self):
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            except json.JSONDecodeError:
                return self._send(400, {"error": "bad json"})
            self._api("post", urlparse(self.path).path, body)

        def _api(self, method, path, body):
            # Запросы со сторонних сайтов, открытых в том же браузере, отклоняются.
            origin = self.headers.get("Origin")
            if origin and not origin.startswith(("http://127.0.0.1", "http://localhost")):
                return self._send(403, {"error": "forbidden origin"})
            fn = getattr(api, f"{method}_" + path[5:].replace("/", "_"), None)
            if not fn:
                return self._send(404, {"error": "unknown api"})
            try:
                res = fn(body)
            except Exception as e:  # текст ошибки показывается в интерфейсе
                return self._send(500, {"error": str(e)})
            if isinstance(res, tuple):
                return self._send(200, res[0], res[1], res[2])
            self._send(200, res)

    return Handler


def serve(port: int = 0, store: Store | None = None) -> ThreadingHTTPServer:
    httpd = ThreadingHTTPServer(("127.0.0.1", port), make_handler(Api(store or Store())))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd
