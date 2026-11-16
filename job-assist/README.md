# Job Assist

**RU** · [EN](#english)

Персональный помощник в поиске работы: CRM откликов, воронка с аналитикой, подготовка к интервью и ИИ-ассистент. Локальное десктоп-приложение на Python, данные хранятся только на вашем компьютере.

`помощник в поиске работы` · `job assist` · `job search` · `career CRM` · `трекер откликов` · `hh.ru` · `подготовка к собеседованию`

## С чего начать

1. Скачайте своё резюме с hh.ru («Скачать» → PDF) или возьмите DOCX / TXT.
2. «Профиль» → «Импорт резюме»: приложение выделит должность, роли, зарплату, формат и навыки. Перед применением показывает, что найдено. По желанию можно уточнить разбор через ИИ.
3. «Подготовка» → «Прожарка резюме»: разбор глазами нанимающего менеджера.
4. Соберите 20+ вакансий и откройте «Вакансии» → «Ядро рынка»: какие требования встречаются чаще всего и каких нет в резюме.

Полный порядок шагов есть в чек-листе «Задачи и рутины».

## Возможности

- **Вакансии.** Поиск на hh.ru по сохранённым запросам, ручное добавление из любого канала (LinkedIn, Telegram, сайты компаний).
- **Скоринг 0–100.** Балл соответствия по вашему профилю: целевые роли, ключевые навыки, зарплата, формат работы, стоп-слова.
- **Канбан из 7 этапов:** отклик → скрининг → HR → тестовое → профильное интервью → финал → оффер. Статусы этапа, SLA: карточка без движения дольше N дней помечается «Нужен пинг».
- **Чек-лист этапа** в каждой карточке, профайл компании, версии резюме (A/B), контакты.
- **Дашборд:** цель по откликам в неделю, конверсии, медиана жизни отклика, матрица каналов, причины отказов, радар навыков.
- **Матрица навыков** с нуля: свои блоки и навыки, шкала 0–10, «как докажу на интервью».
- **Подготовка:** вопросы с тренажёром и таймером, самопрезентация, шаблоны сообщений, вопросы работодателю.
- **ИИ-помощник** (Gemini, OpenAI, OpenRouter, DeepSeek или локальная Ollama): gap-анализ вакансии, адаптация резюме по формуле XYZ, сопроводительное письмо, бриф к интервью, пинг HR, ответ рекрутеру, mock-интервью с оценкой ответов, аудит воронки.
- **Импорт резюме** из PDF hh.ru, DOCX или TXT с проверкой найденного перед применением.
- **Прожарка резюме** по методике [grill-my-resume-as-manager](https://github.com/letya999/grill-my-resume-as-manager) (MIT): без контекста, с контекстом поиска или против пула из 5–20 вакансий канбана.
- **Ядро рынка:** ИИ выделяет требования из каждой вакансии один раз, частотность и покрытие резюме считаются локально.
- **Справка** внутри приложения: порядок работы, что за что отвечает, кнопка «?» в каждом разделе, лучшие практики по каждому этапу воронки (и подсказка в карточке вакансии).
- **Шаблоны сообщений** по сценариям (отклик, нетворкинг, рекрутер, статус, отказ, оффер), банк из 30 вопросов к интервью, ИИ-ответы про зарплату, торг по офферу, запрос фидбэка, вежливый отказ.
- **Экспорт** в Excel и бэкап JSON.

## Запуск

```bash
pip install -r requirements.txt
python main.py            # окно приложения (pywebview)
python main.py --browser  # в браузере
```

Сборка `JobAssist.exe` под Windows: `build.bat` (Python 3.10+, PyInstaller). Окно использует WebView2, он есть в Windows 10/11.

## ИИ-ключ

Перед первой отправкой текста резюме ИИ-провайдеру приложение спрашивает согласие. Задайте переменную окружения провайдера: `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` или `DEEPSEEK_API_KEY`. Можно ввести ключ в «Настройках», но тогда он хранится в локальной базе в открытом виде. В бэкап JSON ключ не попадает. Для Ollama ключ не нужен.

## Данные и приватность

База SQLite лежит в `%APPDATA%\JobAssist` (Windows) или `~/.local/share/JobAssist`. Сервер слушает только `127.0.0.1`. Наружу уходят только запросы к API hh.ru и выбранному ИИ-провайдеру.

## Структура

```
main.py               запуск окна / браузера
jobassist/store.py    хранилище SQLite
jobassist/jobs.py     hh.ru, скоринг, экспорт Excel
jobassist/ai.py       ИИ-провайдеры и сценарии
jobassist/resume.py   чтение PDF / DOCX / TXT, разбор резюме hh.ru
jobassist/prompts/    методика прожарки (MIT, см. THIRD_PARTY_NOTICES.md)
jobassist/server.py   локальный HTTP API
jobassist/web/        интерфейс (HTML + JS без сборки)
tests/                юнит-тесты
```

---

## English

A personal job search assistant: application CRM, funnel analytics, interview prep and an AI copilot. A local Python desktop app; all data stays on your machine.

`job search assistant` · `job assist` · `career CRM` · `application tracker` · `hh.ru` · `interview preparation`

### Getting started

1. Download your CV from hh.ru (PDF) or use DOCX / TXT.
2. Profile → Import CV: the app extracts title, roles, salary, work format and skills and shows them for review first. AI refinement is optional.
3. Prep → CV grill: a hiring manager style review.
4. Collect 20+ vacancies and open Vacancies → Market core to see the most frequent requirements and gaps in your CV.

### Features

- **Vacancies.** hh.ru search with saved queries; manual import from any channel (LinkedIn, Telegram, company sites).
- **0–100 match score** based on your profile: target roles, key skills, salary, work format, stop words.
- **7-stage kanban:** applied → CV screening → HR → test task → hiring manager → final → offer. Stage statuses and an SLA flag for cards idle longer than N days.
- **Per-stage checklist** on each card, company profile, CV versions (A/B), contacts.
- **Dashboard:** weekly application goal, conversions, median application lifetime, channel matrix, rejection reasons, skills radar.
- **Skills matrix** built from scratch: your own blocks and skills, 0–10 scale, "how I'll prove it".
- **Prep:** question bank with a timed trainer, self-presentation builder, message templates, questions for the employer.
- **AI copilot** (Gemini, OpenAI, OpenRouter, DeepSeek or local Ollama): vacancy gap analysis, XYZ-style CV tailoring, cover letter, interview brief, HR follow-up, recruiter reply, mock interview with feedback, funnel audit.
- **CV import** from hh.ru PDF, DOCX or TXT, with a review step before applying.
- **CV grill** based on [grill-my-resume-as-manager](https://github.com/letya999/grill-my-resume-as-manager) (MIT): solo, with search context, or against a pool of 5–20 kanban vacancies.
- **Market core:** AI extracts requirements from each vacancy once; frequency and CV coverage are computed locally.
- **Built-in help:** getting started, what each section does, a «?» button in every section, best practices for each funnel stage (also shown on the vacancy card).
- **Message templates** by scenario (application, networking, recruiter, status, rejection, offer), 30 interview questions, AI replies for salary questions, offer negotiation, feedback requests and polite declines.
- **Export** to Excel and JSON backup.

### Run

```bash
pip install -r requirements.txt
python main.py            # desktop window (pywebview)
python main.py --browser  # in a browser
```

Windows build: run `build.bat` (Python 3.10+, PyInstaller) to get `dist\JobAssist.exe`.

### AI key

The app asks for consent before CV text is first sent to an AI provider. Set the provider's environment variable: `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` or `DEEPSEEK_API_KEY`. You can also paste a key in Settings; it is then stored in the local database in plain text and is never included in JSON backups. Ollama needs no key.

### Data and privacy

SQLite database in `%APPDATA%\JobAssist` (Windows) or `~/.local/share/JobAssist`. The server listens on `127.0.0.1` only. Outbound traffic goes only to the hh.ru API and the AI provider you choose.

The UI is in Russian.
