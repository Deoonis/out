"""Импорт резюме: извлечение текста из PDF/DOCX/TXT и разбор формата hh.ru правилами."""
import io
import re

HEADERS = {
    "desired": ("Желаемая должность и зарплата", "Desired position and salary"),
    "experience": ("Опыт работы", "Work experience"),
    "education": ("Образование", "Education"),
    "courses": ("Повышение квалификации", "Professional development"),
    "skills": ("Навыки", "Skills"),
    "extra": ("Дополнительная информация", "Additional information"),
    "about": ("Обо мне", "About me"),
}
FORMAT_MAP = {"удалённо": "удалёнка", "удаленно": "удалёнка", "remote": "удалёнка", "гибрид": "гибрид",
              "hybrid": "гибрид", "на месте работодателя": "офис", "on-site": "офис"}
MONTHS = r"(Январь|Февраль|Март|Апрель|Май|Июнь|Июль|Август|Сентябрь|Октябрь|Ноябрь|Декабрь|January|February|March|April|May|June|July|August|September|October|November|December)"


def extract_text(filename: str, data: bytes) -> str:
    name = filename.lower()
    if name.endswith(".pdf"):
        from pypdf import PdfReader
        return "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(data)).pages)
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
    d = _index(lines, "desired")
    e = _index(lines, "experience")
    if d >= 0:
        block = lines[d + 1:e if e > d else len(lines)]
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
    city = next((x.split(":", 1)[1].strip() for x in lines if x.startswith(("Проживает:", "Location:"))), "")
    if city:
        out["city"] = city
    if e >= 0:
        m = re.search(r"[—–-]\s*(.+)$", lines[e])
        if m:
            out["experience_total"] = m.group(1).strip()
        out["jobs"] = _jobs(lines[e + 1:_end_of_experience(lines, e)])

    s = next((i for i in range(len(lines)) if re.match(r"^(Навыки|Skills)\s{2,}\S", lines[i])), -1)
    if s >= 0:
        chunk = [lines[s].split(None, 1)[1]]
        for x in lines[s + 1:]:
            if re.match(r"^(Опыт вождения|Права|Дополнительная|Обо мне|Driving|Additional|About)", x):
                break
            chunk.append(x)
        out["skills"] = [k.strip() for k in re.split(r"\s{2,}", "  ".join(c.strip() for c in chunk)) if k.strip()]
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
