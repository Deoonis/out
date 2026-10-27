// Job Assist: интерфейс. Состояние хранится в локальной SQLite через API сервера.
let S = {};
let INFO = {};
let tab = 'dash';
const sub = { vac: 'board', profile: 'about', prep: 'grill' };
let found = [];
let showRejected = false;
let auditText = '';
const sim = { i: 0, t: 0, timer: null };
const mock = { vac: '', role: 'HR', history: [] };

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const today = () => new Date().toISOString().slice(0, 10);
const money = (v) => (v ? Number(v).toLocaleString('ru-RU') : '');
const daysSince = (d) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 864e5) : 0);
const stageName = (id) => STAGES.find((s) => s.id === String(id))?.name || id;
const scoreBadge = (s, small) => `<span class="score auto" style="background:${s == null ? '#94a3b8' : s >= 70 ? 'var(--ok)' : s >= 45 ? 'var(--warn)' : 'var(--bad)'}${small ? ';font-size:11px' : ''}">${s ?? '–'}</span>`;
const byId = (list, id) => S[list].find((x) => x.id === id);

async function api(path, body) {
  const r = await fetch('/api/' + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

function toast(msg) {
  document.querySelector('.toast')?.remove();
  const d = document.createElement('div');
  d.className = 'toast'; d.textContent = msg; document.body.append(d);
  setTimeout(() => d.remove(), 3500);
}
// Перед первой отправкой текста резюме или вакансий ИИ-провайдеру спрашиваем согласие.
function aiConsent() {
  if (S.settings.ai_consent) return true;
  if (!confirm(`Текст резюме и вакансий будет отправлен ИИ-провайдеру (${S.settings.ai_provider}). Продолжить? Вопрос больше не появится.`)) return false;
  S.settings.ai_consent = true; save(); return true;
}

const fileToBase64 = (file) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result.split(',')[1]); r.onerror = fail; r.readAsDataURL(file); });

function copy(text) { navigator.clipboard.writeText(text); toast('Скопировано'); }

// ---------- состояние ----------
function initState(s) {
  s.profile = { name: '', city: '', experience: '', about: '', jobs: '', title: '', sphere: '', roles: '', keywords: '', stopwords: '', salary: '', formats: [], goal: '', strategy: '', ...s.profile };
  s.settings = { ai_provider: 'gemini', ai_model: '', ai_base_url: '', ai_key: '', ai_temperature: 0.6, weekly_goal: 15, sla_days: 3, ...s.settings };
  s.resumes ??= [{ id: uid(), name: 'Основное резюме', url: '', text: '' }];
  s.vacancies ??= [];
  s.searches ??= [];
  s.skills ??= [];
  s.channels ??= CHANNELS.map((c) => ({ id: uid(), ...c }));
  s.tiers ??= TIERS.map((t) => ({ ...t }));
  s.questions ??= QUESTIONS.map((q) => ({ ...q }));
  s.empQuestions ??= EMPLOYER_QUESTIONS.map((q) => ({ ...q }));
  s.selfPresentation ??= SELF_PRESENTATION.map((x) => ({ ...x, text: '' }));
  s.messages ??= MESSAGES.map((m) => ({ id: uid(), ...m }));
  s.companies ??= [];
  s.contacts ??= [];
  s.rejections ??= [];
  s.tasks ??= [];
  s.routines ??= {};
  for (const v of s.vacancies) { v.checks ??= {}; v.ai ??= {}; v.status ??= 'start'; }
  return s;
}

let saveT;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(async () => {
    try { $('#saved').textContent = 'Сохранено ' + (await api('state', S)).saved; }
    catch (e) { $('#saved').textContent = 'Ошибка сохранения: ' + e.message; }
  }, 400);
}

// Активная карточка без движения дольше SLA получает статус «Нужен пинг».
function statusOf(v) {
  if (v.status === 'reject') return 'reject';
  if (v.stage !== '7' && daysSince(v.updated) > Number(S.settings.sla_days || 3)) return 'remind';
  return v.status;
}

const TABS = [['dash', 'Дашборд'], ['vac', 'Вакансии'], ['profile', 'Профиль'], ['prep', 'Подготовка'], ['network', 'Компании и контакты'], ['tasks', 'Задачи и рутины'], ['settings', 'Настройки']];

function go(t) { tab = t; render(); }
function subTabs(key, items) { return `<div class="tabs">${items.map(([id, n]) => `<button class="${sub[key] === id ? 'on' : ''}" onclick="sub.${key}='${id}';render()">${n}</button>`).join('')}</div>`; }

function render() {
  $('#nav').innerHTML = TABS.map(([id, n]) => `<button class="nav ${id === tab ? 'on' : ''}" onclick="go('${id}')">${n}</button>`).join('');
  $('#view').innerHTML = VIEWS[tab]();
  if (tab === 'prep') tickSim();
}

const VIEWS = {};

// ---------- Дашборд ----------
VIEWS.dash = () => {
  const v = S.vacancies, n = v.length, goal = Number(S.settings.weekly_goal || 15);
  const week = v.filter((x) => daysSince(x.created) < 7).length;
  const remind = v.filter((x) => statusOf(x) === 'remind');
  const active = v.filter((x) => statusOf(x) !== 'reject').length;
  const conv = (k) => (n ? Math.round((v.filter((x) => Number(x.stage) >= k).length / n) * 100) : 0);
  const life = v.map((x) => daysSince(x.created) - daysSince(x.updated)).sort((a, b) => a - b);
  const median = life.length ? life[Math.floor(life.length / 2)] : 0;
  const byStage = STAGES.map((st) => ({ st, c: Object.keys(STATUSES).map((k) => v.filter((x) => x.stage === st.id && statusOf(x) === k).length) }));
  const max = Math.max(1, ...byStage.map((x) => x.c.reduce((a, b) => a + b, 0)));
  const reasons = REJECT_REASONS.map((r) => [r, S.rejections.filter((x) => x.reason === r).length]).filter((x) => x[1]);
  const onboarding = !S.profile.title && !S.profile.roles ? `<div class="card" style="margin-bottom:14px;border-color:var(--acc)"><h3>Начните с импорта резюме</h3>
    <div class="mute">Загрузите резюме, скачанное с hh.ru (PDF, DOCX или TXT): приложение заполнит должность, навыки, ожидания и формат работы. Дальше по шагам алгоритма во вкладке «Задачи и рутины».</div>
    <div style="margin-top:10px">${uploadBox()}</div></div>` : '';
  return `<h2>Дашборд</h2>${onboarding}
  <div class="grid g5">${[[`${week} / ${goal}`, 'Откликов за 7 дней / цель'], [n, 'Всего откликов'], [active, 'В работе'], [remind.length, 'Нужен пинг HR'],
    [conv(3) + '%', 'Дошли до HR'], [conv(5) + '%', 'Дошли до профильного'], [conv(7) + '%', 'Офферы'], [median + ' дн.', 'Медиана жизни отклика']]
    .map(([c, t]) => `<div class="card stat"><b>${c}</b><span>${t}</span></div>`).join('')}</div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h3>Воронка по этапам</h3>${byStage.map(({ st, c }) => `<div class="mute">${st.id}. ${st.name}: ${c.reduce((a, b) => a + b, 0)}</div><div class="stack">${c.map((x, k) => (x ? `<i style="width:${(x / max) * 100}%;background:${Object.values(STATUS_COLORS)[k]}" title="${Object.values(STATUSES)[k]}: ${x}"></i>` : '')).join('')}</div>`).join('')}
      <div class="row mute">${Object.entries(STATUSES).map(([k, t]) => `<span class="auto"><i class="dot" style="background:${STATUS_COLORS[k]}"></i>${t}</span>`).join('')}</div></div>
    <div class="card"><h3>Нужен пинг HR <span class="pill">без движения > ${S.settings.sla_days} дн.</span></h3>
      ${remind.map((x) => `<div class="vac"><span class="pill">${daysSince(x.updated)} дн.</span><div style="flex:1"><b>${esc(x.company)}</b><div class="mute">${esc(x.title)} · ${stageName(x.stage)}</div></div><button class="b s" onclick="openCard('${x.id}');runAi('${x.id}','ping_hr')">Написать пинг</button></div>`).join('') || '<div class="empty">Зависших откликов нет.</div>'}</div>
    <div class="card"><h3>Каналы</h3><table><tr><th>Приор.</th><th>Канал</th><th>Откликов</th><th>До HR+</th><th>Конв.</th></tr>
      ${S.channels.slice().sort((a, b) => a.priority - b.priority).map((c) => { const m = v.filter((x) => x.channel === c.name), hr = m.filter((x) => Number(x.stage) >= 3).length; return `<tr><td>${c.priority}</td><td>${esc(c.name)}</td><td>${m.length}</td><td>${hr}</td><td>${m.length ? Math.round((hr / m.length) * 100) + '%' : '—'}</td></tr>`; }).join('')}</table></div>
    <div class="card"><h3>Причины отказов</h3>${reasons.map(([r, c]) => `<div class="mute">${r}: ${c}</div><div class="bar" style="margin:3px 0 8px"><i style="width:${(c / S.rejections.length) * 100}%"></i></div>`).join('') || '<div class="empty">Отказов пока нет.</div>'}</div>
    <div class="card"><h3>Навыки по блокам</h3>${radarSvg(300, blockScores())}</div>
    <div class="card"><h3>ИИ-аналитик воронки</h3><div class="mute">В модель уходит только агрегированная статистика, без названий компаний.</div>
      <button class="b" style="margin-top:10px" onclick="funnelAudit()">Провести аудит</button>${auditText ? `<div class="ai-out">${esc(auditText)}</div>` : ''}</div>
  </div>`;
};

async function funnelAudit() {
  const v = S.vacancies;
  const stats = {
    всего: v.length, цель_в_неделю: S.settings.weekly_goal, за_7_дней: v.filter((x) => daysSince(x.created) < 7).length,
    этапы: Object.fromEntries(STAGES.map((s) => [s.name, Object.fromEntries(Object.entries(STATUSES).map(([k, t]) => [t, v.filter((x) => x.stage === s.id && statusOf(x) === k).length]))])),
    каналы: Object.fromEntries(S.channels.map((c) => [c.name, { откликов: v.filter((x) => x.channel === c.name).length, до_HR: v.filter((x) => x.channel === c.name && Number(x.stage) >= 3).length }])),
    причины_отказов: Object.fromEntries(REJECT_REASONS.map((r) => [r, S.rejections.filter((x) => x.reason === r).length])),
  };
  auditText = 'Модель анализирует воронку…'; render();
  try { auditText = (await api('ai', { task: 'funnel_audit', extra: 'Статистика:\n' + JSON.stringify(stats, null, 1) })).text; }
  catch (e) { auditText = 'Ошибка: ' + e.message; }
  render();
}

// ---------- Вакансии ----------
VIEWS.vac = () => `<h2>Вакансии</h2>${subTabs('vac', [['board', 'Канбан откликов'], ['search', 'Поиск на hh.ru'], ['manual', 'Добавить вручную'], ['core', 'Ядро рынка']])}${VAC[sub.vac]()}`;
const VAC = {};

VAC.search = () => `<div class="card"><h3>Сохранённые запросы</h3>
    ${S.searches.map((q) => `<div class="vac"><div style="flex:1"><div class="t">${esc(q.name)}</div><div class="mute">${esc(q.text)} · ${AREAS[q.area] ?? q.area}${q.salary ? ' · от ' + money(q.salary) : ''}${q.remote ? ' · удалёнка' : ''}</div></div>
      <button class="b s" onclick="runSearch('${q.id}')">Искать</button><button class="b g s" onclick="editSearch('${q.id}')">✎</button><button class="b g s" onclick="delItem('searches','${q.id}')">✕</button></div>`).join('') || '<div class="empty">Запросов пока нет. Создайте первый: например, название должности и ключевые навыки через AND / OR.</div>'}
    <button class="b g" style="margin-top:10px" onclick="editSearch()">+ Новый запрос</button></div>
  <div class="card" style="margin-top:14px"><h3>Результаты ${found.length ? `<span class="pill">${found.length}</span>` : ''}</h3>
    ${found.map(vacRow).join('') || '<div class="empty">Запустите запрос. Результаты сортируются по баллу соответствия профилю.</div>'}</div>`;

function vacRow(x) {
  const inBoard = S.vacancies.some((v) => v.id === x.id);
  const sal = x.salary_from || x.salary_to ? `${money(x.salary_from)}–${money(x.salary_to)} ${x.currency || ''}` : 'ЗП не указана';
  return `<div class="vac">${scoreBadge(x.score)}<div style="flex:1"><div class="t">${esc(x.title)}</div><div class="mute">${esc(x.company)} · ${esc(x.city)} · ${sal} · ${esc(x.schedule)} · ${esc(x.published)}</div>
    <div class="mute" style="margin-top:4px">${esc((x.reasons || []).join(' · '))}</div></div>
    <a class="b g s" href="${esc(x.url)}" target="_blank">Открыть</a>${inBoard ? '<span class="pill">в канбане</span>' : `<button class="b s" onclick="toBoard('${x.id}')">В канбан</button>`}</div>`;
}

async function runSearch(id) {
  toast('Ищу на hh.ru…');
  try { found = await api('hh/search', byId('searches', id)); render(); } catch (e) { toast('Ошибка hh.ru: ' + e.message); }
}

function editSearch(id) {
  const q = (id && byId('searches', id)) || { name: '', text: '', area: '113', salary: '', remote: false };
  modal(`<h3>${id ? 'Запрос' : 'Новый запрос'}</h3><label>Название</label><input id="q_name" value="${esc(q.name)}">
    <label>Поисковая строка hh.ru (AND / OR / "фраза")</label><textarea id="q_text">${esc(q.text)}</textarea>
    <div class="row"><div><label>Регион</label><select id="q_area">${Object.entries(AREAS).map(([k, n]) => `<option value="${k}" ${k === q.area ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div><label>Зарплата от</label><input id="q_salary" value="${esc(q.salary)}"></div>
      <label class="chk auto" style="margin-top:22px"><input type="checkbox" id="q_remote" ${q.remote ? 'checked' : ''}> только удалёнка</label></div>
    <div class="row" style="margin-top:12px"><button class="b auto" onclick="saveSearch('${id || ''}')">Сохранить</button></div>`);
}
function saveSearch(id) {
  const q = { name: $('#q_name').value, text: $('#q_text').value, area: $('#q_area').value, salary: $('#q_salary').value, remote: $('#q_remote').checked };
  if (id) Object.assign(byId('searches', id), q); else S.searches.push({ id: uid(), ...q });
  closeModal(); save(); render();
}

let coreRows = [];
const normReq = (x) => x.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

VAC.core = () => {
  const withText = S.vacancies.filter((v) => (v.text || '').length > 100);
  const done = withText.filter((v) => v.reqs);
  const counts = {};
  for (const v of done) for (const r of new Set(v.reqs.map(normReq))) counts[r] = (counts[r] || 0) + 1;
  const resume = normReq(S.resumes.map((r) => r.text).join(' '));
  const kw = (S.profile.keywords || '').toLowerCase();
  const rows = (coreRows = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 60));
  return `<div class="card"><h3>Ядро рынка</h3><div class="mute">ИИ выделяет требования из каждой вакансии канбана один раз, частотность считается здесь. Чем больше вакансий (лучше 20+), тем точнее картина: что рынок ждёт от роли и чего не хватает в резюме.</div>
    <div class="row" style="margin-top:10px"><span class="auto">Вакансий с текстом: <b>${withText.length}</b>, разобрано: <b>${done.length}</b></span>
      <button class="b auto" ${withText.length > done.length ? '' : 'disabled'} onclick="analyzeMarket()">Разобрать ${withText.length - done.length} новых</button><span id="core_status" class="mute"></span></div></div>
  <div class="card" style="margin-top:14px"><table><tr><th>Требование</th><th>Вакансий</th><th>Доля</th><th>В резюме</th><th></th></tr>
    ${rows.map(([r, c], i) => `<tr><td>${esc(r)}</td><td>${c}</td><td><div class="bar" style="width:120px"><i style="width:${(c / done.length) * 100}%"></i></div></td><td>${resume.includes(r) ? '✅' : '<span style="color:var(--bad)">нет</span>'}</td>
      <td class="row" style="flex-wrap:nowrap">${kw.includes(r) ? '<span class="pill auto">в скоринге</span>' : `<button class="b g s auto" onclick="addKeyword(coreRows[${i}][0])">+ в скоринг</button>`}${S.skills.some((s) => normReq(s.name) === r) ? '' : `<button class="b g s auto" onclick="S.skills.push({id:uid(),block:'Требования рынка',name:coreRows[${i}][0],level:0,proof:''});save();render()">+ в навыки</button>`}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Добавьте вакансии с полным текстом в канбан и нажмите «Разобрать».</td></tr>'}</table></div>`;
};

function addKeyword(r) { S.profile.keywords = [S.profile.keywords, r].filter(Boolean).join(', '); save(); render(); }

async function analyzeMarket() {
  if (!aiConsent()) return;
  const todo = S.vacancies.filter((v) => (v.text || '').length > 100 && !v.reqs);
  for (const [i, v] of todo.entries()) {
    $('#core_status') && ($('#core_status').textContent = `Разбираю ${i + 1} из ${todo.length}…`);
    try { v.reqs = (await api('ai/requirements', { vacancy: `${v.title}\n${v.text}` })).requirements; save(); }
    catch (e) { toast('Ошибка: ' + e.message); break; }
  }
  render();
}

VAC.manual = () => `<div class="card"><h3>Вакансия из любого канала</h3>
  <div class="row"><div><label>Должность</label><input id="m_title"></div><div><label>Компания</label><input id="m_company"></div></div>
  <div class="row"><div><label>Канал</label><select id="m_channel">${channelOptions('')}</select></div><div><label>Зарплата до</label><input id="m_salary"></div><div><label>Ссылка</label><input id="m_url"></div></div>
  <label>Текст вакансии</label><textarea id="m_text" style="min-height:160px"></textarea>
  <div class="row" style="margin-top:10px"><button class="b auto" onclick="addManual()">Оценить и добавить в канбан</button></div></div>`;

function channelOptions(sel) { return S.channels.slice().sort((a, b) => a.priority - b.priority).map((c) => `<option ${c.name === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join(''); }

function newCard(x) {
  const tier = S.companies.find((c) => c.name.toLowerCase() === (x.company || '').toLowerCase())?.tier || '';
  return { ...x, stage: '1', status: 'start', channel: x.channel || SOURCE_CHANNEL[x.source] || '', tier, notes: '', profile: '', contact: '', created: today(), updated: today(), resumeId: S.resumes[0]?.id, checks: {}, ai: {} };
}
function toBoard(id) { S.vacancies.push(newCard(found.find((v) => v.id === id))); save(); render(); toast('Добавлено на этап «Отклик»'); }

async function addManual() {
  const v = { id: 'm-' + uid(), source: 'manual', channel: $('#m_channel').value, title: $('#m_title').value, company: $('#m_company').value, url: $('#m_url').value, salary_to: Number($('#m_salary').value.replace(/\D/g, '')) || null, currency: 'RUR', text: $('#m_text').value };
  if (!v.title && !v.text) return toast('Заполните должность или текст вакансии');
  const [scored] = await api('score', { items: [v] });
  S.vacancies.push(newCard(scored)); save(); sub.vac = 'board'; render(); toast('Добавлено в канбан');
}

VAC.board = () => {
  const list = S.vacancies.filter((x) => showRejected || x.status !== 'reject');
  return `<label class="chk"><input type="checkbox" ${showRejected ? 'checked' : ''} onchange="showRejected=this.checked;render()"> показывать отказы</label>
  <div class="kanban">${STAGES.map((st, i) => {
    const items = list.filter((x) => x.stage === st.id).sort((a, b) => (b.score || 0) - (a.score || 0));
    return `<div class="col" ondragover="event.preventDefault();this.classList.add('over')" ondragleave="this.classList.remove('over')" ondrop="setStage(event.dataTransfer.getData('text'),'${st.id}')">
      <h4>${st.id}. ${st.name}<span class="pill">${items.length}</span></h4>
      ${items.map((x) => { const s = statusOf(x); return `<div class="kc" style="border-left:4px solid ${STATUS_COLORS[s]}" draggable="true" ondragstart="event.dataTransfer.setData('text','${x.id}')" onclick="openCard('${x.id}')">
        <div class="row"><b>${esc(x.company || '—')}</b>${scoreBadge(x.score, true)}</div><div>${esc(x.title)}</div>
        <div class="mute">${esc(x.channel)} · ${STATUSES[s]}${s === 'remind' ? ` (${daysSince(x.updated)} дн.)` : ''}${x.interviewAt ? ' · 📅 ' + x.interviewAt : ''}</div>
        <div class="row" style="margin-top:6px"><button class="b g s auto" onclick="event.stopPropagation();setStage('${x.id}','${i}')" ${i ? '' : 'disabled'}>←</button><span></span><button class="b g s auto" onclick="event.stopPropagation();setStage('${x.id}','${i + 2}')" ${i < 6 ? '' : 'disabled'}>→</button></div></div>`; }).join('') || '<div class="mute" style="padding:8px">Перетащите сюда карточку</div>'}</div>`;
  }).join('')}</div>`;
};

function setStage(id, stage) {
  const v = byId('vacancies', id);
  if (!v || v.stage === stage) return;
  v.stage = stage; v.status = v.status === 'reject' ? 'reject' : 'start'; v.updated = today(); save(); render();
}

const AI_TASKS = { analyze: 'Gap-анализ', cv_adapt: 'Резюме под вакансию', cover_letter: 'Сопроводительное', brief: 'Бриф к интервью', ping_hr: 'Пинг HR', recruiter_reply: 'Ответ рекрутеру' };

function openCard(id) {
  const v = byId('vacancies', id);
  const field = (k, n) => `<div><label>${n}</label><input value="${esc(v[k])}" onchange="upd('${id}','${k}',this.value)"></div>`;
  modal(`<div class="row"><h3 style="margin:0">${esc(v.company)}: ${esc(v.title)}</h3>${scoreBadge(v.score)}</div>
    <div class="mute">${esc((v.reasons || []).join(' · '))}</div>
    <div class="row"><div><label>Этап</label><select onchange="setStage('${id}',this.value);openCard('${id}')">${STAGES.map((s) => `<option value="${s.id}" ${s.id === v.stage ? 'selected' : ''}>${s.id}. ${s.name}</option>`).join('')}</select></div>
      <div><label>Статус</label><select onchange="upd('${id}','status',this.value)">${['start', 'mid'].map((k) => `<option value="${k}" ${k === v.status ? 'selected' : ''}>${STATUSES[k]}</option>`).join('')}</select></div>
      <div><label>Дата интервью</label><input type="date" value="${v.interviewAt || ''}" onchange="upd('${id}','interviewAt',this.value)"></div></div>
    <div class="row"><div><label>Канал</label><select onchange="upd('${id}','channel',this.value)">${channelOptions(v.channel)}</select></div>
      <div><label>Тир компании</label><select onchange="upd('${id}','tier',this.value)"><option value="">—</option>${S.tiers.map((t, i) => `<option value="${i + 1}" ${String(v.tier) === String(i + 1) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
      <div><label>Версия резюме</label><select onchange="upd('${id}','resumeId',this.value)">${S.resumes.map((r) => `<option value="${r.id}" ${r.id === v.resumeId ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div></div>
    <div class="row">${field('url', 'Ссылка')}${field('contact', 'Контакт HR / нанимающего')}</div>
    <div class="grid g2"><div><label>Заметки</label><textarea onchange="upd('${id}','notes',this.value)">${esc(v.notes)}</textarea></div>
      <div><label>Профайл компании</label><textarea onchange="upd('${id}','profile',this.value)">${esc(v.profile)}</textarea></div></div>
    <label>Текст вакансии ${v.source === 'hh' ? `<a href="#" onclick="loadFull('${id}');return false">(загрузить полный с hh.ru)</a>` : ''}</label><textarea id="vtext" style="min-height:90px" onchange="upd('${id}','text',this.value)">${esc(v.text)}</textarea>
    <h3 style="margin-top:14px">Чек-лист этапа «${stageName(v.stage)}»</h3>${(ROUTINES[v.stage] || []).map((t, i) => `<label class="chk"><input type="checkbox" ${v.checks[v.stage + '.' + i] ? 'checked' : ''} onchange="byId('vacancies','${id}').checks['${v.stage}.${i}']=this.checked;save()"> ${esc(t)}</label>`).join('')}
    <h3 style="margin-top:14px">ИИ-помощник</h3><div class="row">${Object.entries(AI_TASKS).map(([k, n]) => `<button class="b g s auto" onclick="runAi('${id}','${k}')">${n}</button>`).join('')}</div>
    <div id="aiout">${Object.entries(v.ai).map(([k, t]) => aiBlock(k, t)).join('')}</div>
    <div class="row" style="margin-top:14px">${v.status === 'reject' ? `<button class="b g auto" onclick="upd('${id}','status','mid');closeModal();render()">Вернуть в работу</button>` : `<button class="b r auto" onclick="rejectCard('${id}')">Отказ</button>`}
      <button class="b g auto" onclick="if(confirm('Удалить карточку?')){delItem('vacancies','${id}');closeModal()}">Удалить</button><span></span><button class="b auto" onclick="closeModal();render()">Готово</button></div>`);
}

function aiBlock(k, t) { return `<div class="ai-out"><b>${AI_TASKS[k] || k}</b> <a href="#" onclick="copy(this.parentNode.querySelector('pre').textContent);return false">копировать</a><pre style="white-space:pre-wrap;font:inherit;margin:6px 0 0">${esc(t)}</pre></div>`; }
function upd(id, k, val) { const v = byId('vacancies', id); v[k] = val; v.updated = today(); save(); }

async function loadFull(id) {
  try { const r = await api('hh/full', { id }); upd(id, 'text', r.text); $('#vtext').value = r.text; toast('Полный текст загружен'); } catch (e) { toast('Ошибка: ' + e.message); }
}

function resumeOf(v) { return (S.resumes.find((r) => r.id === v?.resumeId) || S.resumes[0])?.text || ''; }
function candidateLine() { const p = S.profile; return `Кандидат: ${p.title || '[роль]'}; сфера: ${p.sphere || '-'}; ожидания: ${p.salary || '-'}; цель: ${p.goal || '-'}.`; }

async function runAi(id, task) {
  const v = byId('vacancies', id);
  const extra = `${candidateLine()}\nЭтап: ${stageName(v.stage)}, без движения ${daysSince(v.updated)} дн. Профайл компании: ${v.profile || '-'}. Заметки: ${v.notes || '-'}.`;
  $('#aiout')?.insertAdjacentHTML('afterbegin', `<div class="ai-out" id="ai_wait">Модель готовит «${AI_TASKS[task]}»…</div>`);
  try {
    const r = await api('ai', { task, vacancy: `${v.title}\n${v.company}\n${v.text}`, resume: resumeOf(v), extra });
    v.ai[task] = r.text; save();
    $('#ai_wait').outerHTML = aiBlock(task, r.text);
  } catch (e) { $('#ai_wait').textContent = 'Ошибка: ' + e.message; }
}

function rejectCard(id) {
  modal(`<h3>Отказ</h3><label>Причина</label><select id="rj_r">${REJECT_REASONS.map((r) => `<option>${r}</option>`).join('')}</select>
    <label>Выводы для себя</label><textarea id="rj_n"></textarea>
    <div class="mute" style="margin-top:8px">Чтобы узнать настоящую причину: попросите обратную связь у рекрутера после этапа, спросите знакомых в компании, сходите на разбор резюме или mock-интервью.</div>
    <div class="row" style="margin-top:10px"><button class="b r auto" onclick="saveReject('${id}')">Зафиксировать</button></div>`);
}
function saveReject(id) {
  const v = byId('vacancies', id);
  v.status = 'reject'; v.rejectReason = $('#rj_r').value; v.updated = today();
  S.rejections.push({ id: uid(), date: today(), company: v.company, title: v.title, stage: stageName(v.stage), reason: v.rejectReason, note: $('#rj_n').value });
  closeModal(); save(); render();
}

function delItem(list, id) { S[list] = S[list].filter((x) => x.id !== id); save(); render(); }

// ---------- Профиль ----------
VIEWS.profile = () => `<h2>Профиль</h2>${subTabs('profile', [['about', 'О себе и цели'], ['resumes', 'Версии резюме'], ['skills', 'Навыки'], ['channels', 'Каналы и пирамида']])}${PROFILE[sub.profile]()}`;
const PROFILE = {};

PROFILE.about = () => {
  const p = S.profile;
  const f = (k, n, ph = '') => `<div><label>${n}</label><input value="${esc(p[k])}" placeholder="${ph}" onchange="S.profile['${k}']=this.value;save()"></div>`;
  const t = (k, n, ph) => `<div><label>${n}</label><textarea placeholder="${ph}" onchange="S.profile['${k}']=this.value;save()">${esc(p[k])}</textarea></div>`;
  return `<div class="card"><h3>Импорт резюме</h3><div class="mute" style="margin-bottom:10px">Приложение выделит должность, роли, зарплату, формат работы и навыки. Перед применением покажет, что найдено.</div>${uploadBox()}</div>
  <div class="card" style="margin-top:14px"><div class="row">${f('name', 'Имя')}${f('title', 'Желаемая должность')}${f('sphere', 'Сфера / отрасль')}${f('salary', 'Ожидания по зарплате', 'число')}</div>
    <div class="row">${f('city', 'Город')}${f('experience', 'Общий опыт')}${f('goal', 'Цель поиска')}</div>
    <label>Формат работы</label><div class="row">${['удалёнка', 'гибрид', 'офис'].map((x) => `<label class="chk auto"><input type="checkbox" ${p.formats.includes(x) ? 'checked' : ''} onchange="toggleFormat('${x}',this.checked)"> ${x}</label>`).join('')}</div>
    ${t('strategy', 'Стратегия поиска', 'Какие компании, каналы и темп откликов')}
    <div class="grid g2">${t('jobs', 'Места работы', 'Период: должность, компания')}${t('about', 'О себе', 'Кратко о себе')}</div></div>
  <div class="card" style="margin-top:14px"><h3>Скоринг вакансий</h3><div class="mute">Балл 0–100 считается по этим словам: роль в названии вакансии, навыки в тексте, зарплата, формат, стоп-слова. Можно писать часть слова.</div>
    <div class="grid g2">${t('roles', 'Целевые роли (через запятую)', 'например: менеджер проектов, project manager')}${t('keywords', 'Ключевые навыки и домен (через запятую)', 'например: agile, бюджет, b2b')}${t('stopwords', 'Стоп-слова (через запятую)', 'например: стажёр, холодные звонки')}</div></div>`;
};
let imported = null;

function uploadBox(hint) {
  return `<div class="drop" ondragover="event.preventDefault();this.classList.add('over')" ondragleave="this.classList.remove('over')"
    ondrop="event.preventDefault();this.classList.remove('over');importResume(event.dataTransfer.files[0])">
    <label class="b big">📄 Загрузить резюме<input type="file" accept=".pdf,.docx,.txt,.md" hidden onchange="importResume(this.files[0]);this.value=''"></label>
    <div class="mute">${hint || 'PDF, скачанный с hh.ru («Скачать» → PDF), DOCX или TXT. Можно перетащить файл сюда.'}</div></div>`;
}

async function importResume(file) {
  if (!file) return;
  toast('Читаю резюме…');
  try {
    const r = await api('resume/parse', { filename: file.name, data: await fileToBase64(file) });
    const f = r.fields;
    imported = { text: r.text, filename: file.name, ai: false, name: f.name || '', city: f.city || '', experience: f.experience_total || '',
      title: f.title || '', roles: [...new Set([f.title, ...(f.specializations || [])].filter(Boolean).map(s => s.trim()))].join(', '), sphere: '',
      salary: f.salary || '', formats: f.formats || [], keywords: (f.skills || []).join(', '),
      skills: (f.skills || []).map((name) => ({ block: 'Навыки из резюме', name })), about: f.about || '', jobs: f.jobs || [], jobsText: (f.jobs || []).map((j) => `${j.period}: ${j.title}, ${j.company}`).join('\n'), is_hh: f.is_hh };
    reviewImport();
  } catch (e) { toast('Ошибка импорта: ' + e.message); }
}

async function aiImport() {
  if (!aiConsent()) return;
  $('#imp_ai').textContent = 'ИИ разбирает резюме…';
  try {
    const d = await api('ai/resume', { resume: imported.text });
    Object.assign(imported, { ai: true, title: d.title || imported.title, roles: (d.roles || []).join(', ') || imported.roles, sphere: d.sphere || '',
      salary: d.salary || imported.salary, formats: d.formats?.length ? d.formats : imported.formats,
      keywords: (d.keywords || []).join(', ') || imported.keywords, skills: d.skills?.length ? d.skills : imported.skills });
    reviewImport();
  } catch (e) { $('#imp_ai').textContent = 'Ошибка: ' + e.message; }
}

function reviewImport() {
  const m = imported;
  const row = (k, n, v) => `<label class="chk" style="align-items:flex-start"><input type="checkbox" data-k="${k}" ${v ? 'checked' : 'disabled'}><span><b>${n}:</b> ${esc(v) || '<span class="mute">не найдено</span>'}</span></label>`;
  const blocks = [...new Set(m.skills.map((x) => x.block))];
  const weak = !m.ai && (!m.title || !m.skills.length);
  modal(`<h3>Что найдено в «${esc(m.filename)}»</h3>
    ${weak ? `<div class="warn">Правилами найдено мало: ${m.is_hh ? 'вёрстка PDF отличается от ожидаемой' : 'формат hh.ru не распознан'}. Нажмите «Разобрать через ИИ»: ИИ заполнит должность, роли, навыки и зарплату (нужен ключ ИИ в Настройках).</div>` : ''}
    <div class="mute">${m.is_hh && !weak ? 'Распознан формат hh.ru.' : ''} ${m.ai ? 'Поля уточнены ИИ.' : ''} Отметьте, что применить. Пустые поля профиля заполнятся, заполненные будут заменены.</div>
    <div style="margin-top:10px">${row('name', 'Имя', m.name)}${row('city', 'Город', m.city)}${row('experience', 'Общий опыт', m.experience)}${row('title', 'Желаемая должность', m.title)}${row('roles', 'Целевые роли (для скоринга)', m.roles)}${row('sphere', 'Сфера', m.sphere)}
    ${row('salary', 'Ожидания по зарплате', m.salary && money(m.salary))}${row('formats', 'Формат работы', m.formats.join(', '))}${row('keywords', 'Ключевые слова (для скоринга)', m.keywords)}
    ${row('skills', `Навыки в матрицу (${m.skills.length}, оценка 0)`, blocks.map((b) => `${b}: ${m.skills.filter((x) => x.block === b).map((x) => x.name).join(', ')}`).join(' · '))}
    ${row('jobs', `Места работы (${m.jobs.length})`, m.jobs.map((j) => `${j.title} — ${j.company}`).join('; '))}${row('about', 'О себе', m.about && m.about.slice(0, 160) + (m.about.length > 160 ? '…' : ''))}
    ${row('resume', 'Текст резюме → новая версия резюме', m.text && `${m.text.length} символов`)}</div>
    <div class="row" style="margin-top:12px">${weak ? `<button class="b auto" id="imp_ai" onclick="aiImport()">Разобрать через ИИ</button><button class="b g auto" onclick="applyImport()">Применить найденное</button>`
      : `<button class="b auto" onclick="applyImport()">Применить</button><button class="b g auto" id="imp_ai" onclick="aiImport()">${m.ai ? 'Разобрать через ИИ ещё раз' : 'Уточнить через ИИ'}</button>`}</div>`);
}

function applyImport() {
  const m = imported, on = (k) => document.querySelector(`.modal [data-k="${k}"]`)?.checked;
  for (const k of ['name', 'city', 'experience', 'title', 'roles', 'sphere', 'salary', 'keywords', 'about']) if (on(k)) S.profile[k] = String(m[k]);
  if (on('jobs')) S.profile.jobs = m.jobsText;
  if (on('formats')) S.profile.formats = m.formats;
  if (on('skills')) for (const x of m.skills) if (!S.skills.some((s) => s.name.toLowerCase() === x.name.toLowerCase())) S.skills.push({ id: uid(), block: x.block, name: x.name, level: 0, proof: '' });
  if (on('resume')) {
    const empty = S.resumes.find((r) => !r.text);
    if (empty) Object.assign(empty, { name: m.filename, text: m.text }); else S.resumes.push({ id: uid(), name: m.filename, url: '', text: m.text });
  }
  imported = null; closeModal(); save(); render(); toast('Профиль обновлён из резюме');
}

function toggleFormat(x, on) { const f = S.profile.formats; S.profile.formats = on ? [...new Set([...f, x])] : f.filter((y) => y !== x); save(); }

PROFILE.resumes = () => `<div class="card" style="margin-bottom:14px"><h3>Загрузить резюме из файла</h3>${uploadBox('Файл станет новой версией резюме, данные профиля можно обновить в окне проверки.')}</div><div class="grid g2">${S.resumes.map((r) => `<div class="card">
    <div class="row"><input value="${esc(r.name)}" onchange="byId('resumes','${r.id}').name=this.value;save()"><button class="b g s auto" onclick="if(S.resumes.length>1&&confirm('Удалить версию?'))delItem('resumes','${r.id}')">✕</button></div>
    <label>Ссылка</label><input value="${esc(r.url)}" onchange="byId('resumes','${r.id}').url=this.value;save()">
    <label>Текст резюме (используется ИИ)</label><textarea style="min-height:200px" onchange="byId('resumes','${r.id}').text=this.value;save()">${esc(r.text)}</textarea>
    <div class="mute">Откликов: ${S.vacancies.filter((v) => v.resumeId === r.id).length}, дошли до HR+: ${S.vacancies.filter((v) => v.resumeId === r.id && Number(v.stage) >= 3).length}</div></div>`).join('')}</div>
  <button class="b g" style="margin-top:10px" onclick="S.resumes.push({id:uid(),name:'Новая версия',url:'',text:''});save();render()">+ Версия резюме (A/B)</button>`;

function blockScores() {
  return [...new Set(S.skills.map((s) => s.block))].map((b) => { const xs = S.skills.filter((s) => s.block === b); return { name: b, level: xs.reduce((a, s) => a + Number(s.level || 0), 0) / xs.length }; });
}

function radarSvg(size, items) {
  const n = items.length, c = size / 2, R = c - 40;
  if (n < 3) return '<div class="empty">Радар появится, когда в матрице будет минимум 3 блока навыков.</div>';
  const pt = (i, r) => [c + r * Math.sin((2 * Math.PI * i) / n), c - r * Math.cos((2 * Math.PI * i) / n)];
  const ring = (k) => items.map((_, i) => pt(i, (R * k) / 10).join(',')).join(' ');
  const labels = items.map((s, i) => { const [x, y] = pt(i, R + 12); return `<text x="${x}" y="${y}" font-size="10" text-anchor="${x < c - 5 ? 'end' : x > c + 5 ? 'start' : 'middle'}" fill="#64748b">${esc(s.name.slice(0, 28))} · ${s.level.toFixed(1)}</text>`; }).join('');
  return `<svg viewBox="-110 0 ${size + 220} ${size}" style="width:100%;max-height:${size}px">${[2, 4, 6, 8, 10].map((k) => `<polygon points="${ring(k)}" fill="none" stroke="#e2e8f0"/>`).join('')}
    <polygon points="${items.map((s, i) => pt(i, (R * s.level) / 10).join(',')).join(' ')}" fill="#4f46e533" stroke="#4f46e5" stroke-width="2"/>${labels}</svg>`;
}

PROFILE.skills = () => {
  const blocks = [...new Set(S.skills.map((s) => s.block))];
  return `<div class="grid g2"><div class="card"><h3>Радар по блокам</h3>${radarSvg(420, blockScores())}</div>
    <div class="card"><h3>Шкала 0–10</h3>${SKILL_SCALE.map((x) => `<div class="mute">${x}</div>`).join('')}
      <h3 style="margin-top:14px">Добавить навык</h3><div class="row"><input id="sk_b" placeholder="Блок (например, Планирование)" list="sk_blocks"><input id="sk_n" placeholder="Навык"></div>
      <datalist id="sk_blocks">${blocks.map((b) => `<option>${esc(b)}</option>`).join('')}</datalist>
      <button class="b" style="margin-top:8px" onclick="addSkill()">Добавить</button>
      <div class="mute" style="margin-top:8px">Подсказка: соберите блоки и навыки из 20+ интересных вакансий, это и есть требования рынка к вашей роли.</div></div></div>
  ${blocks.map((b) => { const xs = S.skills.filter((s) => s.block === b); return `<details class="card" style="margin-top:10px" open><summary class="row"><b>${esc(b)}</b><span class="auto">${(xs.reduce((a, s) => a + Number(s.level), 0) / xs.length).toFixed(1)}</span></summary>
    <table style="margin-top:8px">${xs.map((s) => `<tr><td style="width:32%">${esc(s.name)}</td><td style="width:170px"><input type="range" min="0" max="10" value="${s.level}" oninput="this.nextElementSibling.textContent=this.value" onchange="byId('skills','${s.id}').level=+this.value;save()"><b>${s.level}</b></td>
      <td><input placeholder="Как докажу на интервью" value="${esc(s.proof)}" onchange="byId('skills','${s.id}').proof=this.value;save()"></td><td><button class="b g s" onclick="delItem('skills','${s.id}')">✕</button></td></tr>`).join('')}</table></details>`; }).join('') || '<div class="card empty" style="margin-top:10px">Матрица пуста. Добавьте блоки и навыки своей профессии.</div>'}`;
};
function addSkill() {
  const block = $('#sk_b').value.trim(), name = $('#sk_n').value.trim();
  if (!block || !name) return toast('Укажите блок и навык');
  S.skills.push({ id: uid(), block, name, level: 0, proof: '' }); save(); render();
}

PROFILE.channels = () => `<div class="grid g2"><div class="card"><h3>Каналы поиска</h3><table><tr><th style="width:70px">Приор.</th><th>Канал</th><th>Методика</th><th></th></tr>
    ${S.channels.slice().sort((a, b) => a.priority - b.priority).map((c) => `<tr><td><input type="number" value="${c.priority}" onchange="byId('channels','${c.id}').priority=+this.value;save()"></td><td><input value="${esc(c.name)}" onchange="byId('channels','${c.id}').name=this.value;save()"></td><td><input value="${esc(c.method)}" onchange="byId('channels','${c.id}').method=this.value;save()"></td><td><button class="b g s" onclick="delItem('channels','${c.id}')">✕</button></td></tr>`).join('')}</table>
    <button class="b g" style="margin-top:8px" onclick="S.channels.push({id:uid(),priority:S.channels.length+1,name:'Новый канал',method:''});save();render()">+ Канал</button></div>
  <div class="card"><h3>Пирамида компаний</h3>${S.tiers.map((t, i) => `<input value="${esc(t.name)}" onchange="S.tiers[${i}].name=this.value;save()" style="margin-top:8px;font-weight:600"><textarea style="min-height:60px;margin-top:4px" onchange="S.tiers[${i}].method=this.value;save()">${esc(t.method)}</textarea>`).join('')}</div></div>`;

// ---------- Подготовка ----------
VIEWS.prep = () => `<h2>Подготовка</h2>${subTabs('prep', [['grill', 'Прожарка резюме'], ['questions', 'Вопросы и тренажёр'], ['mock', 'Mock-интервью с ИИ'], ['self', 'Самопрезентация'], ['messages', 'Шаблоны сообщений'], ['mine', 'Мои вопросы работодателю']])}${PREP[sub.prep]()}`;
const PREP = {};

let grillText = '';
const grillCfg = { resumeId: '', context: '', pool: false };
PREP.grill = () => {
  const pool = S.vacancies.filter((v) => v.status !== 'reject' && (v.text || '').length > 200);
  return `<div class="card"><h3>Прожарка резюме</h3><div class="mute">Жёсткий разбор по методологии <a href="https://github.com/letya999/grill-my-resume-as-manager" target="_blank">grill-my-resume-as-manager</a> (MIT): доказательность достижений (XYZ), анти-паттерны, роль и грейд, что видно за 10 секунд, общий балл. Даёт направления правок, а не готовый текст. Методология откалибрована на менеджерские роли (Project / Delivery / Product).</div>
    <div class="row"><div><label>Версия резюме</label><select onchange="grillCfg.resumeId=this.value">${S.resumes.map((r) => `<option value="${r.id}" ${r.id === grillCfg.resumeId ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div></div>
    <label>Контекст: куда иду (необязательно)</label><textarea onchange="grillCfg.context=this.value" placeholder="Например: целюсь в Delivery Manager в B2B SaaS">${esc(grillCfg.context || [S.profile.title, S.profile.sphere, S.profile.goal].filter(Boolean).join('; '))}</textarea>
    <label class="chk"><input type="checkbox" ${grillCfg.pool ? 'checked' : ''} ${pool.length < 5 ? 'disabled' : ''} onchange="grillCfg.pool=this.checked"> Сравнить с пулом вакансий из канбана (${pool.length} с полным текстом; нужно 5–20)</label>
    <button class="b" style="margin-top:10px" onclick="runGrill()">Прожарить</button>
    ${grillText ? `<div class="ai-out" style="max-height:none">${esc(grillText)}</div><a href="#" onclick="copy(grillText);return false">копировать</a>` : ''}</div>`;
};

async function runGrill() {
  const r = S.resumes.find((x) => x.id === grillCfg.resumeId) || S.resumes[0];
  if (!r?.text) return toast('В выбранной версии резюме нет текста. Импортируйте резюме в профиле.');
  if (!aiConsent()) return;
  const pool = grillCfg.pool ? S.vacancies.filter((v) => v.status !== 'reject' && (v.text || '').length > 200).slice(0, 20).map((v) => `${v.title}\n${v.company}\n${v.text}`) : [];
  grillText = 'Модель прожаривает резюме, это займёт до минуты…'; render();
  try { grillText = (await api('ai/grill', { resume: r.text, context: grillCfg.context || [S.profile.title, S.profile.sphere, S.profile.goal].filter(Boolean).join('; '), vacancies: pool })).text; }
  catch (e) { grillText = 'Ошибка: ' + e.message; }
  render();
}

PREP.questions = () => {
  if (!S.questions.length) return '<div class="empty">Добавьте вопросы.</div>' + addQuestionRow();
  const i = sim.i % S.questions.length, q = S.questions[i];
  return `<div class="grid g2"><div class="card"><h3>Тренажёр <span class="pill">${i + 1} / ${S.questions.length}</span> <span class="pill">${esc(q.cat)}</span></h3>
    <div style="font-size:17px;font-weight:600;margin:8px 0">${esc(q.q)}</div>
    <label>Мой ответ (STAR / XYZ)</label><textarea style="min-height:130px" onchange="S.questions[${i}].answer=this.value;save()">${esc(q.answer)}</textarea>
    <div class="row" style="margin-top:10px"><span class="timer auto" id="timer">0:00</span><span class="mute">цель 1,5–2 мин</span>
      <button class="b g auto" onclick="simTimer()">${sim.timer ? 'Стоп' : 'Старт'}</button><button class="b g auto" onclick="simNav(-1)">←</button><button class="b auto" onclick="simNav(1)">→</button></div></div>
  <div class="card"><h3>Все вопросы</h3><table>${S.questions.map((x, k) => `<tr><td><span class="pill">${esc(x.cat)}</span></td><td><a href="#" onclick="sim.i=${k};render();return false">${esc(x.q)}</a></td><td>${x.answer ? '✅' : '—'}</td><td><button class="b g s" onclick="delItem('questions','${x.id}')">✕</button></td></tr>`).join('')}</table>${addQuestionRow()}</div></div>`;
};
function addQuestionRow() { return `<div class="row" style="margin-top:10px"><select id="nq_c" class="auto" style="width:110px"><option>HR</option><option>Профиль</option><option>ЛПР</option></select><input id="nq_q" placeholder="Новый вопрос"><button class="b auto" onclick="S.questions.push({id:uid(),cat:$('#nq_c').value,q:$('#nq_q').value,answer:''});save();render()">+</button></div>`; }
function simNav(d) { sim.i = (sim.i + d + S.questions.length) % S.questions.length; sim.t = 0; render(); }
function simTimer() {
  if (sim.timer) { clearInterval(sim.timer); sim.timer = null; } else { sim.t = 0; sim.timer = setInterval(() => { sim.t++; tickSim(); }, 1000); }
  render();
}
function tickSim() { const el = $('#timer'); if (el) { el.textContent = `${Math.floor(sim.t / 60)}:${String(sim.t % 60).padStart(2, '0')}`; el.style.color = sim.t > 120 ? 'var(--bad)' : ''; } }

PREP.mock = () => `<div class="card"><div class="row">
    <div><label>Вакансия</label><select onchange="mock.vac=this.value"><option value="">Без вакансии (по профилю)</option>${S.vacancies.filter((v) => v.status !== 'reject').map((v) => `<option value="${v.id}" ${v.id === mock.vac ? 'selected' : ''}>${esc(v.company)}: ${esc(v.title)}</option>`).join('')}</select></div>
    <div class="auto" style="width:150px"><label>Интервьюер</label><select onchange="mock.role=this.value">${[['HR', 'Рекрутер'], ['Тех', 'Нанимающий'], ['ЛПР', 'ЛПР']].map(([k, n]) => `<option value="${k}" ${k === mock.role ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
  <div class="chat" id="chat">${mock.history.map((m) => `<div class="msg ${m.role}">${esc(m.content)}</div>`).join('') || '<div class="mute">ИИ задаёт вопросы по одному и оценивает каждый ответ по STAR/XYZ.</div>'}</div>
  <textarea id="mock_in" style="min-height:70px" placeholder="Ваш ответ"></textarea>
  <div class="row" style="margin-top:6px"><button class="b auto" onclick="mockSend()">${mock.history.length ? 'Ответить' : 'Начать интервью'}</button><button class="b g auto" onclick="mock.history=[];render()">Сбросить</button></div></div>`;

async function mockSend() {
  const text = $('#mock_in').value.trim();
  if (mock.history.length && !text) return;
  if (text) mock.history.push({ role: 'user', content: text });
  const v = byId('vacancies', mock.vac);
  render(); $('#chat').insertAdjacentHTML('beforeend', '<div class="msg assistant">…</div>');
  try {
    const r = await api('ai/mock', { role: mock.role, vacancy: v ? `${v.title}\n${v.company}\n${v.text}` : candidateLine(), resume: resumeOf(v), history: mock.history });
    mock.history.push({ role: 'assistant', content: r.text });
  } catch (e) { toast('Ошибка: ' + e.message); if (text) mock.history.pop(); }
  render(); const c = $('#chat'); if (c) c.scrollTop = c.scrollHeight;
}

PREP.self = () => `<div class="grid g2">${S.selfPresentation.map((x, i) => `<div class="card"><b>${esc(x.title)}</b><div class="mute" style="margin:4px 0">${esc(x.hint)}</div>
    <textarea onchange="S.selfPresentation[${i}].text=this.value;save()">${esc(x.text)}</textarea></div>`).join('')}</div>
  <div class="card" style="margin-top:10px"><b>Целиком</b> <a href="#" onclick="copy(S.selfPresentation.map(x=>x.text).filter(Boolean).join('\\n\\n'));return false">копировать</a>
    <div class="ai-out">${esc(S.selfPresentation.map((x) => x.text).filter(Boolean).join('\n\n') || 'Заполните блоки выше.')}</div></div>`;

PREP.messages = () => `<div class="grid g2">${S.messages.map((m) => `<div class="card"><div class="row"><input value="${esc(m.title)}" onchange="byId('messages','${m.id}').title=this.value;save()"><button class="b g s auto" onclick="copy(byId('messages','${m.id}').text)">Копировать</button><button class="b g s auto" onclick="delItem('messages','${m.id}')">✕</button></div>
    <textarea style="min-height:130px;margin-top:6px" onchange="byId('messages','${m.id}').text=this.value;save()">${esc(m.text)}</textarea></div>`).join('')}</div>
  <button class="b g" style="margin-top:8px" onclick="S.messages.push({id:uid(),title:'Новый шаблон',text:''});save();render()">+ Шаблон</button>`;

PREP.mine = () => `<div class="card"><table><tr><th>Кому</th><th>Вопрос</th><th>Что ожидаю услышать / red flags</th><th></th></tr>
  ${S.empQuestions.map((e) => `<tr><td><span class="pill">${esc(e.group)}</span></td><td><input value="${esc(e.text)}" onchange="byId('empQuestions','${e.id}').text=this.value;save()"></td><td><input value="${esc(e.expect)}" onchange="byId('empQuestions','${e.id}').expect=this.value;save()"></td><td><button class="b g s" onclick="delItem('empQuestions','${e.id}')">✕</button></td></tr>`).join('')}</table>
  <button class="b g" style="margin-top:8px" onclick="S.empQuestions.push({id:uid(),group:'ЛПР',text:'',expect:''});save();render()">+ Вопрос</button></div>`;

// ---------- Компании и контакты ----------
VIEWS.network = () => `<h2>Компании и контакты</h2><div class="grid g2">
  ${S.tiers.map((t, ti) => `<div class="card"><h3>${esc(t.name)}</h3>${S.companies.filter((c) => c.tier === ti + 1).map((c) => `<div class="vac"><div style="flex:1"><b>${esc(c.name)}</b><div class="mute">${esc(c.note)}</div></div>
    <select class="auto" style="width:64px" onchange="byId('companies','${c.id}').tier=+this.value;save();render()">${[1, 2, 3].map((k) => `<option ${k === ti + 1 ? 'selected' : ''}>${k}</option>`).join('')}</select><button class="b g s auto" onclick="delItem('companies','${c.id}')">✕</button></div>`).join('') || '<div class="mute">Пусто</div>'}</div>`).join('')}
  <div class="card"><h3>Добавить компанию</h3><label>Название</label><input id="c_n"><label>Заметка</label><input id="c_note">
    <label>Тир</label><select id="c_t">${S.tiers.map((t, i) => `<option value="${i + 1}">${esc(t.name)}</option>`).join('')}</select>
    <button class="b" style="margin-top:10px" onclick="S.companies.push({id:uid(),name:$('#c_n').value,note:$('#c_note').value,tier:+$('#c_t').value});save();render()">Добавить</button></div></div>
  <div class="card" style="margin-top:14px"><h3>Контакты</h3><table><tr><th>Имя</th><th>Роль</th><th>Компания</th><th>Ссылка</th><th>Последний контакт</th><th></th></tr>
  ${S.contacts.map((c) => `<tr>${['name', 'role', 'company', 'link', 'last'].map((k) => `<td><input value="${esc(c[k])}" ${k === 'last' ? 'type="date"' : ''} onchange="byId('contacts','${c.id}')['${k}']=this.value;save()"></td>`).join('')}<td><button class="b g s" onclick="delItem('contacts','${c.id}')">✕</button></td></tr>`).join('')}</table>
  <button class="b g" style="margin-top:8px" onclick="S.contacts.push({id:uid(),name:'',role:'',company:'',link:'',last:today()});save();render()">+ Контакт</button></div>
  <div class="card" style="margin-top:14px"><h3>История отказов</h3>${S.rejections.slice().reverse().map((x) => `<div class="vac"><span class="pill">${x.date}</span><div style="flex:1"><b>${esc(x.company)}</b> · ${esc(x.title)} <span class="mute">(${esc(x.stage)})</span><div>${esc(x.reason)}</div><div class="mute">${esc(x.note)}</div></div></div>`).join('') || '<div class="mute">—</div>'}</div>`;

// ---------- Задачи и рутины ----------
VIEWS.tasks = () => `<h2>Задачи и рутины</h2>
  <div class="card"><h3>Алгоритм поиска <span class="pill">${ALGORITHM.filter((_, i) => S.routines['alg' + i]).length} / ${ALGORITHM.length}</span></h3>
    <div class="bar" style="margin-bottom:8px"><i style="width:${(ALGORITHM.filter((_, i) => S.routines['alg' + i]).length / ALGORITHM.length) * 100}%"></i></div>
    ${ALGORITHM.map(([t, d], i) => `<label class="chk" style="align-items:flex-start"><input type="checkbox" ${S.routines['alg' + i] ? 'checked' : ''} onchange="S.routines['alg${i}']=this.checked;save();render()"><span><b>${i + 1}. ${t}.</b> <span class="mute">${d}</span></span></label>`).join('')}</div>
  <div class="card" style="margin-top:14px"><h3>План</h3><table>${S.tasks.slice().sort((a, b) => a.done - b.done || (a.due || '9').localeCompare(b.due || '9')).map((t) => `<tr style="${t.done ? 'opacity:.5' : t.due && t.due < today() ? 'color:var(--bad)' : ''}">
      <td style="width:30px"><input type="checkbox" ${t.done ? 'checked' : ''} onchange="byId('tasks','${t.id}').done=this.checked;save();render()"></td>
      <td><input value="${esc(t.title)}" onchange="byId('tasks','${t.id}').title=this.value;save()"></td><td style="width:160px"><input type="date" value="${t.due || ''}" onchange="byId('tasks','${t.id}').due=this.value;save();render()"></td>
      <td><button class="b g s" onclick="delItem('tasks','${t.id}')">✕</button></td></tr>`).join('')}</table>
    <button class="b g" style="margin-top:8px" onclick="S.tasks.push({id:uid(),title:'',due:'',done:false});save();render()">+ Задача</button></div>
  <h3 style="margin:18px 0 10px">Рутины по этапам</h3><div class="grid g2">${STAGES.map((st) => { const items = ROUTINES[st.id] || []; const done = items.filter((_, i) => S.routines[st.id + '.' + i]).length; return `<div class="card"><h3>${st.id}. ${st.name}</h3><div class="bar" style="margin-bottom:8px"><i style="width:${(done / (items.length || 1)) * 100}%"></i></div>
    ${items.map((t, i) => `<label class="chk"><input type="checkbox" ${S.routines[st.id + '.' + i] ? 'checked' : ''} onchange="S.routines['${st.id}.${i}']=this.checked;save();render()"> ${esc(t)}</label>`).join('')}</div>`; }).join('')}</div>
  <button class="b g" style="margin-top:12px" onclick="for(const k in S.routines)if(!k.startsWith('alg'))delete S.routines[k];save();render()">Сбросить рутины</button>`;

// ---------- Настройки ----------
VIEWS.settings = () => {
  const s = S.settings, prov = s.ai_provider;
  const inp = (k, n, type = 'text', ph = '') => `<label>${n}</label><input type="${type}" value="${esc(s[k])}" placeholder="${ph}" onchange="S.settings['${k}']=this.value;save()">`;
  return `<h2>Настройки</h2><div class="grid g2">
  <div class="card"><h3>ИИ-помощник</h3><label>Провайдер</label><select onchange="S.settings.ai_provider=this.value;S.settings.ai_model='';save();render()">${Object.keys(INFO.providers || {}).map((p) => `<option ${p === prov ? 'selected' : ''}>${p}</option>`).join('')}</select>
    ${inp('ai_model', 'Модель', 'text', INFO.providers?.[prov] || '')}${inp('ai_base_url', 'Base URL (если нужен свой)', 'text', 'по умолчанию для провайдера')}
    ${INFO.env_keys?.[prov] ? '<div class="mute" style="margin-top:8px">Ключ найден в переменной окружения.</div>' : `${inp('ai_key', 'API-ключ', 'password')}<div class="warn">Ключ из этого поля хранится в локальной базе приложения в открытом виде. Надёжнее задать переменную окружения (GEMINI_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, DEEPSEEK_API_KEY): тогда поле не нужно.</div>`}
    ${inp('ai_temperature', 'Температура', 'number')}</div>
  <div class="card"><h3>Цели</h3>${inp('weekly_goal', 'Откликов за 7 дней', 'number')}${inp('sla_days', 'Дней без движения до «Нужен пинг»', 'number')}
    <h3 style="margin-top:16px">Данные</h3><div class="mute">База: ${esc(INFO.data_file || '')}</div>
    <div class="row" style="margin-top:10px"><a class="b auto" href="/api/export/xlsx" download onclick="flushSave()">Экспорт в Excel</a><a class="b g auto" href="/api/export/json" download onclick="flushSave()">Бэкап JSON</a>
      <label class="b g auto">Импорт JSON<input type="file" accept=".json" hidden onchange="importData(this.files[0])"></label></div>
    <div class="mute" style="margin-top:6px">API-ключ в бэкап не попадает.</div></div></div>`;
};

function flushSave() { clearTimeout(saveT); fetch('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(S), keepalive: true }); }

async function importData(file) {
  try {
    const d = JSON.parse(await file.text());
    if (typeof d !== 'object' || !Array.isArray(d.vacancies)) throw new Error('это не файл Job Assist');
    if (!confirm('Заменить текущие данные импортированными?')) return;
    const key = S.settings.ai_key;
    S = initState(d); S.settings.ai_key ||= key; save(); render(); toast('Импортировано');
  } catch (e) { toast('Ошибка импорта: ' + e.message); }
}

// ---------- Модалка ----------
function modal(html) { closeModal(); document.body.insertAdjacentHTML('beforeend', `<div class="modal" onclick="if(event.target===this){closeModal();render()}"><div class="card">${html}</div></div>`); }
function closeModal() { document.querySelector('.modal')?.remove(); }

(async () => {
  try {
    const [st, info] = await Promise.all([api('state'), api('info')]);
    S = initState(st); INFO = info; save();
  } catch (e) { S = initState({}); toast('Сервер недоступен: ' + e.message); }
  render();
})();
