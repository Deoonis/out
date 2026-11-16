"""ИИ-помощник через OpenAI-совместимый API (Gemini, OpenRouter, DeepSeek, OpenAI, локальная Ollama)."""
import json
import os
import re
import sys
from pathlib import Path

from .jobs import http_json

PROVIDERS = {
    # имя: (base_url, переменная окружения с ключом, модель по умолчанию)
    "gemini": ("https://generativelanguage.googleapis.com/v1beta/openai", "GEMINI_API_KEY", "gemini-2.5-flash"),
    "openai": ("https://api.openai.com/v1", "OPENAI_API_KEY", "gpt-4o-mini"),
    "openrouter": ("https://openrouter.ai/api/v1", "OPENROUTER_API_KEY", "google/gemini-2.5-flash"),
    "deepseek": ("https://api.deepseek.com/v1", "DEEPSEEK_API_KEY", "deepseek-chat"),
    "ollama": ("http://localhost:11434/v1", "", "llama3.1"),
}


def resolve_key(settings: dict) -> str:
    """Ключ: сначала переменная окружения провайдера, затем поле в Настройках."""
    env = PROVIDERS.get(settings.get("ai_provider") or "gemini", PROVIDERS["gemini"])[1]
    if not env:
        return "local"
    key = os.environ.get(env) or settings.get("ai_key") or ""
    if not key.strip():
        raise RuntimeError(f"Нет ключа ИИ: задайте переменную окружения {env} или ключ в Настройках.")
    return key.strip()


def chat(messages: list[dict], settings: dict) -> str:
    provider = settings.get("ai_provider") or "gemini"
    base, _, model = PROVIDERS.get(provider, PROVIDERS["gemini"])
    url = (settings.get("ai_base_url") or base).rstrip("/") + "/chat/completions"
    body = {"model": settings.get("ai_model") or model, "messages": messages,
            "temperature": float(settings.get("ai_temperature") or 0.6)}
    data = http_json(url, body, {"Authorization": f"Bearer {resolve_key(settings)}"}, timeout=180)
    try:
        return data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, AttributeError) as e:
        raise RuntimeError("Пустой ответ модели: " + json.dumps(data, ensure_ascii=False)[:300]) from e


def system_prompt(profile: dict) -> str:
    who = ", ".join(filter(None, [profile.get("title"), profile.get("sphere") and f"сфера: {profile['sphere']}"]))
    return (f"Ты карьерный консультант. Кандидат: {who or 'профиль не заполнен'}. Пиши на языке пользователя, "
            "прямо и без воды. Не выдумывай факты, которых нет в резюме; если данных не хватает, пиши [уточнить]. "
            "Достижения формулируй по формуле XYZ: сильный глагол (X) → что изменилось (Y) → измеримый результат (Z).")


TASKS = {
    "analyze": ("Разбери вакансию: 1) ключевые требования и навыки списком; 2) gap-анализ «требование → есть "
                "в резюме / частично / нет»; 3) соответствие 0–100 с обоснованием; 4) красные флаги; "
                "5) как закрыть пробелы на интервью."),
    "cv_adapt": ("Адаптируй резюме под вакансию для ATS: недостающие ключевые слова, блок «О себе» на 3–4 "
                 "предложения на языке вакансии, 5–7 пунктов опыта строго по формуле XYZ."),
    "cover_letter": ("Напиши сопроводительное письмо на 900–1300 знаков: зацепка под задачу работодателя, 2–3 "
                     "достижения с цифрами из резюме, польза в первые 90 дней, призыв к звонку."),
    "brief": ("Подготовь бриф к интервью: что известно о компании и что проверить самостоятельно; как адаптировать "
              "самопрезентацию; 8 вероятных вопросов (HR, профильные, руководитель) с тезисами по STAR; "
              "5 вопросов работодателю; черновик follow-up после встречи."),
    "ping_hr": ("Отклик завис без ответа. Напиши короткое вежливое напоминание рекрутеру (до 400 знаков) с учётом "
                "текущего этапа: интерес к роли, вопрос о следующих шагах и сроках."),
    "recruiter_reply": ("Напиши ответ рекрутеру в мессенджер, до 500 знаков: интерес, 1 релевантный факт, "
                        "вопрос о вилке и формате, предложение созвона."),
    "salary_answer": ("Рекрутер спросил о зарплатных ожиданиях. Напиши ответ до 500 знаков: диапазон на руки из "
                      "профиля, обоснование масштабом задач вакансии и опытом из резюме, встречный вопрос о бюджете "
                      "позиции и пакете. Без извинений и без одной жёсткой цифры."),
    "offer_negotiation": ("Получен оффер ниже ожиданий. Напиши письмо для торга до 900 знаков: благодарность и интерес, "
                          "желаемая сумма из профиля, 2–3 аргумента из резюме и требований вакансии, альтернативы "
                          "(бонус, пересмотр через 6 месяцев, ДМС, формат), вежливый вопрос о гибкости."),
    "feedback_request": ("Пришёл отказ. Напиши короткий ответ до 400 знаков: благодарность, принятие решения, "
                         "конкретный вопрос о том, что усилить, и предложение остаться на связи."),
    "decline": ("Нужно вежливо отказаться от продолжения процесса или оффера. Напиши ответ до 400 знаков: благодарность, "
                "решение без лишних подробностей, сохранение хороших отношений."),
    "funnel_audit": ("Проведи аудит воронки поиска работы по статистике: где теряются отклики, какие каналы "
                     "работают, 3–5 гипотез улучшения с ожидаемым эффектом и план на неделю."),
}

MOCK_ROLES = {
    "HR": "рекрутер на первичном скрининге: мотивация, ожидания, опыт в целом",
    "Тех": "нанимающий менеджер: профессиональные навыки, кейсы, глубина экспертизы",
    "ЛПР": "руководитель / ЛПР на финальном интервью: бизнес-результат, ответственность, мотивация",
}


def run_task(task: str, vacancy: str, resume: str, profile: dict, settings: dict, extra: str = "") -> str:
    if task not in TASKS:
        raise ValueError(f"Неизвестная задача: {task}")
    prompt = (f"{TASKS[task]}\n\n{extra}\n\n=== ВАКАНСИЯ ===\n{vacancy[:15000] or '-'}"
              f"\n\n=== РЕЗЮМЕ ===\n{resume[:15000] or '[резюме не заполнено]'}")
    return chat([{"role": "system", "content": system_prompt(profile)}, {"role": "user", "content": prompt}], settings)


def mock_interview(role: str, vacancy: str, resume: str, history: list[dict], profile: dict, settings: dict) -> str:
    """Ход тренажёра: оценить последний ответ (если есть) и задать следующий вопрос."""
    system = (f"{system_prompt(profile)}\nТы играешь роль: {MOCK_ROLES.get(role, role)}. Задавай по одному вопросу. "
              "После ответа кандидата дай короткую оценку по STAR/XYZ (балл 1–10, что сильное, чего не хватило, "
              f"как усилить) и задай следующий вопрос.\n\n=== ВАКАНСИЯ ===\n{vacancy[:8000] or '-'}"
              f"\n\n=== РЕЗЮМЕ ===\n{resume[:8000] or '-'}")
    msgs = [{"role": "system", "content": system}]
    msgs += [{"role": m["role"], "content": m["content"]} for m in history if m.get("role") in ("user", "assistant")]
    if len(msgs) == 1:
        msgs.append({"role": "user", "content": "Начинай интервью."})
    return chat(msgs, settings)


# ---------- импорт резюме, прожарка, ядро рынка ----------

def _prompt_file(name: str) -> str:
    base = Path(getattr(sys, "_MEIPASS", "")) / "jobassist" if hasattr(sys, "_MEIPASS") else Path(__file__).parent
    return (base / "prompts" / name).read_text(encoding="utf-8")


def parse_json(text: str):
    """Достаёт JSON из ответа модели, даже если он обёрнут в ```json ... ```."""
    m = re.search(r"```(?:json)?\s*(.+?)```", text, re.S)
    raw = m.group(1) if m else text[text.find("{") if "{" in text else 0:]
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError("Модель вернула не JSON: " + text[:200]) from e


def extract_resume(resume: str, settings: dict) -> dict:
    prompt = ("Извлеки из резюме данные и верни только JSON без пояснений: {\"title\": желаемая должность, "
              "\"roles\": [2–5 названий целевых ролей, как их пишут в вакансиях], \"sphere\": отрасль/домен, "
              "\"salary\": число или null, \"formats\": подмножество [\"удалёнка\",\"гибрид\",\"офис\"], "
              "\"skills\": [{\"block\": группа навыков, \"name\": навык}] (10–40 штук, группы 4–8), "
              "\"keywords\": [10–20 ключевых слов для поиска вакансий]}. Не выдумывай то, чего нет в тексте."
              f"\n\n=== РЕЗЮМЕ ===\n{resume[:15000]}")
    return parse_json(chat([{"role": "user", "content": prompt}], {**settings, "ai_temperature": 0.1}))


def grill(resume: str, context: str, vacancies: list[str], settings: dict) -> str:
    """Прожарка по методологии grill-my-resume-as-manager (MIT, см. THIRD_PARTY_NOTICES.md)."""
    parts = [f"(1) РЕЗЮМЕ\n{resume[:20000]}"]
    if context.strip():
        parts.append(f"(2) CONTEXT\n{context[:3000]}")
    if vacancies:
        parts.append("(3) ВАКАНСИИ\n" + "\n\n".join(f"--- Вакансия {i + 1} ---\n{v[:4000]}" for i, v in enumerate(vacancies[:20])))
    return chat([{"role": "system", "content": _prompt_file("grill.md")},
                 {"role": "user", "content": "\n\n".join(parts)}], settings)


def vacancy_requirements(vacancy: str, settings: dict) -> list[str]:
    """Требования вакансии короткими нормализованными фразами для подсчёта частотности."""
    prompt = ("Выдели из вакансии ключевые требования: навыки, инструменты, методологии, домен, опыт. "
              "Каждое 1–4 слова в нормализованной форме (например «Agile», «управление бюджетом», «MS Project», "
              "«опыт от 3 лет»). Верни только JSON: {\"requirements\": [...]}, 5–25 пунктов."
              f"\n\n=== ВАКАНСИЯ ===\n{vacancy[:10000]}")
    data = parse_json(chat([{"role": "user", "content": prompt}], {**settings, "ai_temperature": 0.1}))
    return [str(x).strip() for x in data.get("requirements", []) if str(x).strip()]
