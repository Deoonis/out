"""Вакансии: поиск на hh.ru, скоринг по профилю пользователя, экспорт в Excel."""
import io
import json
import re
import urllib.error
import urllib.parse
import urllib.request

HH_API = "https://api.hh.ru/vacancies"
USER_AGENT = "JobAssist/2.0 (personal job search tool)"


def http_json(url: str, data: dict | None = None, headers: dict | None = None, timeout=30):
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, method="POST" if body else "GET")
    req.add_header("User-Agent", USER_AGENT)
    if body:
        req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:500]}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"Нет соединения: {e.reason}") from e


def strip_tags(s: str | None) -> str:
    return re.sub(r"<[^>]+>", "", s or "").strip()


def hh_search(text: str, area: str = "", salary: str = "", remote: bool = False,
              period: int = 7, page: int = 0, per_page: int = 50) -> list[dict]:
    params = {"text": text, "per_page": per_page, "page": page, "period": period, "order_by": "publication_time"}
    if area:
        params["area"] = area
    if salary:
        params["salary"] = salary
    if remote:
        params["schedule"] = "remote"
    data = http_json(HH_API + "?" + urllib.parse.urlencode(params))
    return [normalize_hh(item) for item in data.get("items", [])]


def normalize_hh(item: dict) -> dict:
    sal = item.get("salary") or {}
    snippet = item.get("snippet") or {}
    return {
        "id": "hh-" + str(item.get("id")),
        "source": "hh",
        "title": item.get("name", ""),
        "company": (item.get("employer") or {}).get("name", ""),
        "city": (item.get("area") or {}).get("name", ""),
        "salary_from": sal.get("from"),
        "salary_to": sal.get("to"),
        "currency": sal.get("currency") or "RUR",
        "schedule": (item.get("schedule") or {}).get("name", ""),
        "url": item.get("alternate_url", ""),
        "published": (item.get("published_at") or "")[:10],
        "text": " ".join(filter(None, [strip_tags(snippet.get("requirement")),
                                       strip_tags(snippet.get("responsibility"))])),
    }


def hh_full_text(vacancy_id: str) -> str:
    vid = vacancy_id.removeprefix("hh-")
    return strip_tags(http_json(f"{HH_API}/{urllib.parse.quote(vid)}").get("description"))


def words(value) -> list[str]:
    """Список слов профиля: строка через запятую/перенос или массив."""
    items = value if isinstance(value, list) else re.split(r"[,\n;]", value or "")
    return [w.strip().lower() for w in items if w and w.strip()]


def to_int(v) -> int:
    digits = re.sub(r"\D", "", str(v or ""))
    return int(digits) if digits else 0


FORMAT_HINTS = {"удалёнка": ["удален", "удалён", "remote"], "гибрид": ["гибрид", "hybrid"],
                "офис": ["полный день", "офис", "на месте"]}


def score_vacancy(vac: dict, profile: dict) -> dict:
    """Оценка 0–100 по словам из профиля. Без заполненных ролей и навыков скоринг не считается."""
    roles, skills, stop = words(profile.get("roles")), words(profile.get("keywords")), words(profile.get("stopwords"))
    if not roles and not skills:
        return {"score": None, "reasons": ["Заполните целевые роли и ключевые навыки в профиле"]}
    title = (vac.get("title") or "").lower()
    body = " ".join([title, (vac.get("text") or "").lower(), (vac.get("company") or "").lower()])
    reasons, score = [], 0

    if roles:
        hit = [w for w in roles if w in title]
        if hit:
            score += 35
            reasons.append(f"+35 роль: {', '.join(hit[:3])}")
        elif any(w in body for w in roles):
            score += 15
            reasons.append("+15 роль упомянута в тексте")
        else:
            reasons.append("0 роль не совпадает")

    hits = [w for w in skills if w in body]
    pts = min(30, 6 * len(hits))
    score += pts
    reasons.append(f"+{pts} навыки: {', '.join(hits[:6]) or 'нет совпадений'}")

    expected = to_int(profile.get("salary"))
    top = vac.get("salary_to") or vac.get("salary_from")
    if expected and top and vac.get("currency", "RUR") in ("RUR", "RUB"):
        pts, why = (20, "вилка не ниже ожиданий") if top >= expected else \
            (10, "вилка чуть ниже ожиданий") if top >= expected * 0.85 else (-10, "вилка ниже ожиданий")
        score += pts
        reasons.append(f"{pts:+d} {why}")
    else:
        score += 8
        reasons.append("+8 вилка не указана")

    formats = profile.get("formats") or []
    sched = (vac.get("schedule") or "").lower() + " " + body
    if not formats or any(any(h in sched for h in FORMAT_HINTS.get(f, [f])) for f in formats):
        score += 15
        reasons.append("+15 формат работы подходит")

    flags = [w for w in stop if w in body]
    if flags:
        score -= 15 * len(flags)
        reasons.append(f"-{15 * len(flags)} стоп-слова: {', '.join(flags)}")
    return {"score": max(0, min(100, score)), "reasons": reasons}


def export_xlsx(state: dict) -> bytes:
    import openpyxl
    from openpyxl.styles import Font

    stage = {str(i): n for i, n in enumerate(["", "Отклик", "Скрининг резюме", "Интервью с HR", "Тестовое задание",
                                              "Тех. интервью", "Интервью с ЛПР", "Оффер"]) if n}
    sheets = {
        "Отклики": (["Компания", "Позиция", "Канал", "Тир", "Этап", "Статус", "Балл", "Создан", "Обновлён",
                     "Ссылка", "Контакт", "Зарплата до", "Заметки", "Причина отказа"],
                    [[v.get("company"), v.get("title"), v.get("channel"), v.get("tier"), stage.get(str(v.get("stage")), v.get("stage")),
                      v.get("status"), v.get("score"), v.get("created"), v.get("updated"), v.get("url"), v.get("contact"),
                      v.get("salary_to") or v.get("salary_from"), v.get("notes"), v.get("rejectReason")]
                     for v in state.get("vacancies", [])]),
        "Навыки": (["Блок", "Навык", "Оценка", "Как докажу"],
                   [[s.get("block"), s.get("name"), s.get("level"), s.get("proof")] for s in state.get("skills", [])]),
        "Отказы": (["Дата", "Компания", "Позиция", "Этап", "Причина", "Выводы"],
                   [[r.get("date"), r.get("company"), r.get("title"), r.get("stage"), r.get("reason"), r.get("note")]
                    for r in state.get("rejections", [])]),
    }
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for name, (head, rows) in sheets.items():
        ws = wb.create_sheet(name)
        ws.append(head)
        for c in ws[1]:
            c.font = Font(bold=True)
        for row in rows:
            ws.append(["" if x is None else x for x in row])
        ws.freeze_panes = "A2"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
