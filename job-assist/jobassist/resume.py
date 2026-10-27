"""Импорт резюме: извлечение текста из PDF/DOCX/TXT и разбор формата hh.ru правилами."""
import io
import re

HEADERS = {
    "desired": ("Желаемая должность", "Desired position"),
    "experience": ("Опыт работы", "Work experience"),
    "education": ("Образование", "Education"),
    "courses": ("Повышение квалификации", "Professional development"),
    "skills": ("Навыки", "Ключевые навыки", "Skills", "Key skills"),
    "extra": ("Дополнительная информация", "Additional information"),
    "about": ("Обо мне", "About me"),
}
FORMAT_MAP = {"удалённо": "удалёнка", "удаленно": "удалёнка", "remote": "удалёнка", "гибрид": "гибрид",
              "hybrid": "гибрид", "на месте работодателя": "офис", "on-site": "офис"}
MONTHS_SHORT = r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Янв|Фев|Мар|Апр|Май|Июн|Июл|Авг|Сен|Окт|Ноя|Дек)[a-zа-я]*\.?"
MONTHS = r"(Январь|Февраль|Март|Апрель|Май|Июнь|Июль|Август|Сентябрь|Октябрь|Ноябрь|Декабрь|January|February|March|April|May|June|July|August|September|October|November|December)"


def extract_text(filename: str, data: bytes) -> str:
    name = filename.lower()
    if name.endswith(".pdf"):
        from pypdf import PdfReader
        pages = PdfReader(io.BytesIO(data)).pages
        text = "\n".join(p.extract_text() or "" for p in pages)
        if _fragmented(text):
            # PDF из Word/Google Docs: каждое слово отдельным объектом, обычный режим даёт «слово на строку»
            text = "\n".join(p.extract_text(extraction_mode="layout") or "" for p in pages)
            text = "\n".join(re.sub(r"\s{2,}", " ", x).strip() for x in text.splitlines())
        return text
    if name.endswith(".docx"):
        import docx
        return "\n".join(p.text for p in docx.Document(io.BytesIO(data)).paragraphs)
    if name.endswith((".txt", ".md")):
        for enc in ("utf-8-sig", "cp1251"):
            try:
                return data.decode(enc)
            except UnicodeDecodeError:
                continue
    raise ValueError("Поддерживаются PDF, DOCX и TXT. На hh.ru: «Скачать» → PDF.")


def _fragmented(text: str) -> bool:
    lines = [x.strip() for x in text.splitlines() if x.strip()]
    return len(lines) > 30 and sum(len(x.split()) == 1 for x in lines) / len(lines) > 0.6


def clean_lines(text: str) -> list[str]:
    lines = []
    for raw in text.replace("\xa0", " ").splitlines():
        line = raw.strip()
        if not line or re.search(r"Резюме обновлено|Resume updated", line):
            continue  # колонтитул hh с ФИО и датой
        lines.append(line)
    return lines


def _starts(line: str, key: str) -> bool:
    return any(line.startswith(h) for h in HEADERS[key])


def _index(lines: list[str], key: str, start: int = 0) -> int:
    return next((i for i in range(start, len(lines)) if _starts(lines[i], key)), -1)


def parse_hh(text: str) -> dict:
    """Разбор резюме, выгруженного с hh.ru. Возвращает только найденные поля."""
    lines = clean_lines(text)
    out: dict = {"is_hh": _index(lines, "desired") >= 0 and _index(lines, "experience") >= 0}
    if not lines:
        return out
    if not out["is_hh"]:
        return {**out, **parse_generic(lines)}
    d = _index(lines, "desired")
    e = _index(lines, "experience")
    if d >= 0:
        block = lines[d + 1:e if e > d else len(lines)]
        rest = re.sub(r"^(Желаемая должность( и зарплата)?|Desired position( and salary)?)[:\s]*", "", lines[d]).strip()
        if rest:
            block = [rest] + block  # заголовок и должность склеены в одну строку
        if block:
            out["title"] = block[0]
        out["specializations"] = [re.sub(r"^[—–-]\s*", "", x) for x in block if re.match(r"^[—–-]\s", x)]
        sal = next((x for x in block if re.search(r"\d[\d ]*\s*(₽|руб|USD|\$|EUR|€)", x)), "")
        if sal:
            out["salary"] = re.sub(r"\D", "", sal.split("₽")[0])
        joined = " ".join(block)
        fm = re.search(r"(Формат работы|Work format):\s*(.+?)(?=\s[А-ЯA-Z][^:]{2,40}:|$)", joined)
        if fm:
            out["formats"] = sorted({v for k, v in FORMAT_MAP.items() if k in fm.group(2).lower()})
        emp = re.search(r"(Тип занятости|Employment):\s*(.+?)(?=\s[А-ЯA-Z][^:]{2,40}:|$)", joined)
        if emp:
            out["employment"] = emp.group(2).strip()
    g = next((i for i, x in enumerate(lines[:6]) if re.match(r"^(Мужчина|Женщина|Male|Female)", x)), -1)
    if g > 0:
        out["name"] = " ".join(lines[max(0, g - 3):g])  # ФИО бывает перенесено на две строки
    city = next((x.split(":", 1)[1].strip() for x in lines if x.startswith(("Проживает:", "Location:"))), "")
    if city:
        out["city"] = city
    if e >= 0:
        m = re.search(r"[—–-]\s*(.+)$", lines[e])
        if m:
            out["experience_total"] = m.group(1).strip()
        out["jobs"] = _jobs(lines[e + 1:_end_of_experience(lines, e)])

    s = next((i for i in range(len(lines)) if re.match(r"^(Ключевые навыки|Навыки|Key skills|Skills)\s*(:|\s{2,})\s*\S", lines[i])), -1)
    if s < 0:  # заголовок отдельной строкой, а навыки ниже (после блока языков)
        s = next((i for i in range(len(lines)) if re.match(r"^(Ключевые навыки|Навыки|Key skills|Skills)\s*:?$", lines[i])), -1)
    if s >= 0:
        head = re.sub(r"^(Ключевые навыки|Навыки|Key skills|Skills)\s*:?", "", lines[s]).strip()
        chunk = [head] if head else []
        for x in lines[s + 1:]:
            if re.match(r"^(Опыт вождения|Права|Дополнительная|Обо мне|Driving|Additional|About)", x):
                break
            if re.match(r"^(Знание языков|Languages)", x) or ("—" in x and re.search(r"(Родной|Native|A1|A2|B1|B2|C1|C2)", x)):
                continue
            chunk.append(x)
        sep = r"\s{2,}|\s*[•·;,|]\s*" if any(re.search(r"\s{2,}|[•·;,|]", c) for c in chunk) else r"\n"
        out["skills"] = [k.strip(" -—–") for k in re.split(sep, "\n".join(c.strip() for c in chunk) if sep == r"\n" else "  ".join(c.strip() for c in chunk)) if k.strip(" -—–") and len(k) < 80]
    langs = [x.replace("Знание языков", "").strip() for x in lines if "—" in x and re.search(r"(Родной|Native|A1|A2|B1|B2|C1|C2)", x)]
    if langs:
        out["languages"] = langs
    a = next((i for i in range(len(lines)) if _starts(lines[i], "about")), -1)
    if a >= 0:
        first = re.sub(r"^(Обо мне|About me)\s*", "", lines[a])
        out["about"] = " ".join([first] + lines[a + 1:]).strip()
    return out


def _end_of_experience(lines, e):
    ends = [i for i in (_index(lines, k, e + 1) for k in ("education", "courses", "skills", "extra")) if i > e]
    return min(ends) if ends else len(lines)


def _jobs(block: list[str]) -> list[dict]:
    """Места работы: период, компания, должность (первая строка после компании, не локация и не отрасль)."""
    jobs, i = [], 0
    while i < len(block):
        m = re.match(rf"^{MONTHS}\s+\d{{4}}\s*[—–-]\s*(.*)$", block[i])
        if not m:
            i += 1
            continue
        start = block[i].split("—")[0].strip()
        end = m.group(2).strip() or (block[i + 1] if i + 1 < len(block) else "")
        j = i + (1 if m.group(2).strip() else 2)
        if j < len(block) and re.match(r"^\d+\s+(год|лет|года|месяц|year|month)", block[j]):
            j += 1
        company = block[j] if j < len(block) else ""
        window = block[j + 1:j + 10]
        bullets = [k for k, x in enumerate(window) if x.startswith("•")]
        if bullets:
            # после списка отраслей hh: пропускаем переносы длинных строк, следующая строка = должность
            k = bullets[-1] + 1
            while k < len(window) and len(window[k - 1]) >= 60:
                k += 1
        else:
            # без отраслей: компания, затем строка с городом/сайтом (одно слово или через запятую)
            k = 1 if window and (len(window[0].split()) == 1 or "," in window[0]) else 0
        title = window[k] if k < len(window) else ""
        jobs.append({"period": f"{start} — {end}", "company": company, "title": title})
        i = j + 1
    return jobs


SECTIONS = {
    "about": ("ОБОМНЕ", "ОСЕБЕ", "ABOUTME", "ABOUT", "SUMMARY", "PROFILE", "ПРОФИЛЬ"),
    "experience": ("ОПЫТРАБОТЫ", "ОПЫТ", "WORKEXPERIENCE", "EXPERIENCE", "PROFESSIONALEXPERIENCE"),
    "education": ("ОБРАЗОВАНИЕ", "EDUCATION"),
    "skills": ("НАВЫКИ", "КЛЮЧЕВЫЕНАВЫКИ", "КОМПЕТЕНЦИИ", "SKILLS", "KEYSKILLS", "CORECOMPETENCIES", "TECHNICALSKILLS", "ИНСТРУМЕНТЫ", "TOOLS"),
    "other": ("ЯЗЫКИ", "LANGUAGES", "КУРСЫ", "СЕРТИФИКАТЫ", "CERTIFICATES", "ДОСТИЖЕНИЯ", "ПРОЕКТЫ", "PROJECTS", "КОНТАКТЫ", "CONTACTS"),
}
_DATE = rf"({MONTHS}\s+\d{{4}}|{MONTHS_SHORT}\s+\d{{4}}|\d{{2}}\.\d{{2,4}}|\d{{4}})"
PERIOD = rf"{_DATE}\s*[–—-]\s*((to |по )?(настоящее время|наст\. время|present|now|сейчас)|{_DATE})"


def _section(line: str) -> str:
    """Заголовок раздела: КАПСОМ (в т.ч. «ОПЫТ Р АБОТЫ» из PDF) или обычный текст отдельной строкой."""
    if len(line) > 40:
        return ""
    if re.match(r"^(Опыт работы|Work experience)\s*[—–-]", line):
        return "experience"
    key = re.sub(r"[^A-ZА-ЯЁ]", "", line.upper())
    if line != line.upper() and not re.fullmatch(r"[А-ЯЁA-Z][а-яёa-z ]+", line):
        return ""
    return next((k for k, names in SECTIONS.items() if key in names), "")


def _unwrap(lines: list[str]) -> str:
    """Склеивает строки абзаца и переносы слов «проек-\nтами»."""
    text = ""
    for x in lines:
        text = text[:-1] + x if text.endswith("-") and x[:1].islower() else (text + " " + x if text else x)
    return text.strip()


def parse_generic(lines: list[str]) -> dict:
    """Резюме не с hh.ru (свой шаблон, LaTeX, Word): ищем разделы по заголовкам КАПСОМ."""
    out: dict = {}
    parts: dict = {}
    cur = "head"
    for x in lines:
        sec = _section(x)
        if sec:
            cur = sec
            continue
        parts.setdefault(cur, []).append(x)
    head = parts.get("head", [])
    total = next((re.split(r"[—–-]", x, 1)[1].strip() for x in lines if re.match(r"^(Опыт работы|Work experience)\s*[—–-]\s*\d", x)), "")
    if total:
        out["experience_total"] = total
    formats = {v for k, v in {**FORMAT_MAP, "офис": "офис", "office": "офис"}.items() if any(k in x.lower() for x in head[1:5])}
    if formats:
        out["formats"] = sorted(formats)
    if head and re.fullmatch(r"[A-Za-zА-Яа-яЁё\- ]{5,60}", head[0]) and 2 <= len(head[0].split()) <= 4:
        out["name"] = head[0].title() if head[0].isupper() else head[0]
    for seg in re.split(r"[⋄•|·;]", " ⋄ ".join(head[1:4])):
        seg = seg.strip().split(",")[0].strip()
        if re.fullmatch(r"[А-ЯЁ][а-яё\-]+|[A-Z][a-z\-]+", seg) and seg not in ("Telegram", "Email", "Гражданство"):
            out["city"] = seg
            break
    if parts.get("about"):
        out["about"] = _unwrap(parts["about"])
    jobs = []
    for i, x in enumerate(parts.get("experience", [])):
        m = re.search(PERIOD + r"\s*$", x)
        if not m or x.startswith(("•", "●")):
            continue
        title = x[:m.start()].strip(" ,–—-")
        nxt = parts["experience"][i + 1] if i + 1 < len(parts["experience"]) else ""
        nxt = re.sub(r"\s+[А-ЯЁA-Z][а-яёa-z\-]+, [А-ЯЁA-Z][а-яёa-z\-]+$", "", nxt)  # «ООО Пример Москва, Россия»
        nxt = re.sub(r",\s*[A-ZА-ЯЁ][\w\-]+(,\s*[A-ZА-ЯЁ][\w\-]+)*$", "", nxt)  # «Example Ltd, Cyprus, Limassol»
        if "," in title:  # «Компания, Город, 06.24-03.26», должность строкой ниже
            title, nxt = nxt, title.split(",")[0]
        company = re.sub(r"\s+[А-ЯЁA-Z][а-яёa-z\-]+, [А-ЯЁA-Z][а-яёa-z\-]+$", "", nxt).strip()
        if not title:  # период отдельной строкой: порядок блоков в PDF не надёжен, место работы не угадываем
            continue
        jobs.append({"period": m.group(0).strip(), "company": company, "title": title})
    if jobs:
        out["jobs"] = jobs
        out["title"] = jobs[0]["title"]
    elif len(head) > 1 and len(head[1]) <= 60 and not re.search(r"@|\+\d|\d{3}|telegram|http", head[1], re.I):
        out["title"] = head[1]  # строка под ФИО: «Product Manager (B2B)»
    skills = []
    raw = parts.get("skills", [])
    if raw and not any(re.search(r"[•,;:]|\s{2,}", x) for x in raw):
        # навыки через одиночный пробел: новый навык начинается с заглавной после строчной
        raw = [", ".join(k for x in raw for k in re.split(r"(?<=[a-zа-яё0-9)])\s+(?=[A-ZА-ЯЁ])", x))]
    for x in [_unwrap([y]) for y in _bullets(raw)]:
        body = x.split(":", 1)[1] if ":" in x[:40] else x
        items = [k.strip(" .–—-") for k in re.split(r"[,;•]", body)]
        glued = any(re.fullmatch(r"[а-яё]{17,}", k) for k in items)  # PDF потерял пробелы в этом пункте
        for k in items:
            if k and len(k) <= 40 and not re.fullmatch(r"[а-яё]{17,}" if not glued else r"[а-яё]{10,}", k):
                skills.append(k)
    if skills:
        out["skills"] = list(dict.fromkeys(skills))
    return out


def _bullets(lines: list[str]) -> list[str]:
    """Собирает пункты списка: строка с «•» начинает пункт, остальные продолжают его."""
    items: list[str] = []
    for x in lines:
        if x.startswith(("•", "●", "▪", "-")) or not items:
            items.append(x.lstrip("•●▪- "))
        else:
            items[-1] = _unwrap([items[-1], x])
    return items
