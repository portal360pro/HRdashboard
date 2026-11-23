/**
 * HR 1:1 Records — Google Apps Script web app for HR 1:1 calls with leaders
 * ONE FILE PAIR: Code.gs (this file) + Index.html. Nothing else to set up.
 *
 * DEPLOY (one time)
 * 1. script.google.com → New project. Paste this as Code.gs, add an HTML file named "Index" and paste Index.html.
 * 2. Optional but recommended: Services (+) → "Google Calendar API" → Add.
 * 3. Deploy → New deployment → Web app.
 *      Execute as:      User accessing the web app
 *      Who has access:  Anyone with Google account
 * 4. Open the web app link yourself first and click "Allow". You become the admin.
 *    Then in the app: Settings → HR team → add your HR colleagues' emails. Only you + the HR team can open it.
 *
 * Everything is done inside the web app (leaders, schedule, notes, settings). The app keeps its data in its own
 * private storage file that it creates automatically — nobody needs to open or edit it.
 * Scheduling a 1:1 creates a Google Calendar event with a Google Meet link and invites the leader.
 * (Google blocks camera/microphone inside Apps Script pages, so the video itself runs in Google Meet.)
 * Recordings stay on the HR person's own PC. Translation uses Apps Script's built-in Google Translate (LanguageApp).
 * Optional: a free Gemini API key (Settings → AI) turns uploaded call audio into a transcript + English summary.
 * After changing code: Deploy → Manage deployments → Edit → Version: New version.
 */

const CONFIG = {
  // Website version (GitHub Pages): paste the OAuth Client ID from Google Cloud here (it ends with .apps.googleusercontent.com).
  WEB_CLIENT_ID: '',
  DATA_NAME: 'HR 1:1 Records — app data (managed by the app, do not edit)',
  DEFAULT_TARGET_MINS: 30,
  DEFAULT_GEMINI_MODEL: 'gemini-3.8-flash',
  MAX_CELL: 49000
};

// speech = browser live-caption language (Chrome has no Cebuano, so Bisaya uses Filipino captions + auto-detect translation)
const LANGUAGES = [
  { code: 'en',  name: 'English',          speech: 'en-US' },
  { code: 'tl',  name: 'Tagalog',          speech: 'fil-PH' },
  { code: 'ceb', name: 'Bisaya (Cebuano)', speech: 'fil-PH' },
  { code: 'vi',  name: 'Vietnamese',       speech: 'vi-VN' },
  { code: 'es',  name: 'Spanish (Peru)',   speech: 'es-PE' },
  { code: 'ru',  name: 'Russian',          speech: 'ru-RU' }
];
const GROUPS = ['Managers', 'Supervisors', 'Team Leaders', 'Mentors', 'Trainers', 'Assistants', 'HR'];
const CONCERN_CATEGORIES = ['Schedules & shifts', 'Career path & pay', 'Tools & software', 'Fairness & monitoring', 'Communication & feedback',
  'Knowledge Base & changes', 'Part-time & hours', 'Bonus & incentives', 'Workload', 'Management & leadership', 'Team & collaboration',
  'Recognition', 'Health & wellbeing', 'Other'];
// 'Open' until HR resolves it in one of the three ways.
const CONCERN_STATUSES = ['Open', 'Sent to Assigned Manager', 'Replied to Person', 'No action needed'];
const COUNTRIES = ['PH', 'VN', 'IN', 'PE', 'RU'];
// Sections of the HR Dashboard (left sidebar). Only "keyroles" is built so far; the others are placeholders.
const MODULES = [
  { id: 'keyroles', name: '1:1 Check-in' }, { id: 'newbieCheckin', name: 'Newbie Check-in' }, { id: 'newbieProgress', name: 'Newbie Progress' },
  { id: 'scheduleLapses', name: 'Schedule Lapses' }, { id: 'pausedContracts', name: 'Paused Contracts' }, { id: 'engagement', name: 'Engagement' },
  { id: 'onboarding', name: 'Onboarding' }, { id: 'verification', name: 'Verification' }, { id: 'terminations', name: 'Terminations' },
  { id: 'leaveRequests', name: 'Leave Requests' }, { id: 'recruitment', name: 'Recruitment' }
];
// Built-in pages of 1:1 Check-in (top bar). Devs can rename or hide them, not delete them.
const KEYROLES_TABS = [{ id: 'overview', name: 'All Calls' }, { id: 'people', name: 'People' }, { id: 'concerns', name: 'Open Concerns' }, { id: 'analysis', name: 'Summary' }, { id: 'questions', name: 'Questionnaire' }];
const LAYOUT_ID_RE = /^[A-Za-z0-9_]{1,40}$/;
const DIR_TABS = ['directory', 'dirAdmin', 'birthdays', 'dirOverview'];
const PIPE_TABS = ['pipeline'];
const COUNTRY_LANG = { PH: 'tl', VN: 'vi', IN: 'en', PE: 'es', RU: 'ru' };

const HEALTH = [
  { key: 'satisfaction',   label: 'Job satisfaction',   q: 'How satisfied are you with your current job and role responsibilities?' },
  { key: 'recognition',    label: 'Recognition',        q: 'Do you feel that your hard work and contribution as a leader are noticed and appreciated by the company?' },
  { key: 'growth',         label: 'Growth',             q: 'Do you see clear opportunities to learn, grow and advance in your current role?' },
  { key: 'managerSupport', label: 'Manager support',    q: 'How supported do you feel by your direct manager/senior leadership when facing team challenges or operational blockers?' },
  { key: 'workload',       label: 'Workload',           q: 'How would you rate your personal workload balance over the past month?', workload: true },
  { key: 'collaboration',  label: 'Collaboration',      q: 'How smoothly does collaboration happen between your team and other departments/teams you interact with?' },
  { key: 'tools',          label: 'Tools & resources',  q: 'Do you and your team have the necessary tools, software, and resources to execute your daily work efficiently?' },
  { key: 'morale',         label: 'Team morale',        q: 'How would you rate the overall morale and engagement of the team you lead/manage?' },
  { key: 'recommend',      label: 'Recommend company',  q: 'Would you recommend our company as a great place to work and grow?' }
];
const OPEN_QUESTIONS = [
  { key: 'helped',     q: 'What has helped you and your team work most effectively over the past month?' },
  { key: 'hindered',   q: 'What has hindered your team’s efficiency or caused the most frustration or unnecessary stress recently?' },
  { key: 'oneChange',  q: 'What is one change, tool, or support effort we should prioritize to make day-to-day work more convenient for you and your team?' },
  { key: 'doBetter',   q: 'What do you think we could be doing better as a company or team? Are there any current practices, processes, or approaches that you think need to be changed or improved?' },
  { key: 'priorities', q: 'What areas do you think we need to pay more attention to or prioritize moving forward?' },
  { key: 'together',   q: 'What do you think could be improved in how teams, departments, and leadership work together?' },
  { key: 'additional', q: 'Do you have any additional comments, suggestions or feedback?' }
];
const RETENTION_Q = 'Do you plan to stay with the company in your current role over the next 3–6 months?';
const RETENTION_FOLLOWUP = 'Is there a specific factor or comment you would like to share regarding your decision?';
const SCRIPT = {
  opening: [
    'Thank them for making time for the call.',
    'Explain the purpose: a regular check-in so HR hears how leaders and their teams are doing.',
    'Say that answers stay within HR and are used to improve how we work.',
    'It takes about 30 minutes. They can answer in the language they are most comfortable with.',
    'Ask if it is OK for you to take notes.'
  ],
  closing: [
    'Summarize the 2–3 key points you heard.',
    'Confirm any concerns and what HR will do next (and who follows up).',
    'Agree on the date of the next 1:1.',
    'Thank them again.'
  ]
};


const HEADERS = {
  Leaders: ['id', 'name', 'group', 'position', 'location', 'language', 'email', 'active', 'uid', 'manager'],
  Calls: ['id', 'round', 'leaderId', 'leaderName', 'group', 'status', 'schedDate', 'schedTime', 'plannedMins', 'conductedBy', 'language',
    'callDate', 'startTime', 'endTime', 'durationMins']
    .concat(HEALTH.map(function (h) { return 's_' + h.key; }))
    .concat(['retention', 'retentionReason', 'reasons', 'answers', 'positives', 'negatives', 'sentiment', 'summary',
      'nextDate', 'nextTime', 'transcriptOriginal', 'transcriptEnglish', 'meetUrl', 'eventId', 'createdAt', 'updatedAt', 'scores', 'audio']),
  Concerns: ['id', 'callId', 'leaderId', 'leaderName', 'round', 'category', 'description', 'response', 'owner', 'status', 'createdAt', 'updatedAt', 'resolvedAt', 'resolvedBy', 'qkey'],
  Settings: ['key', 'value'],
  Directory: ['id', 'uid', 'name', 'location', 'gender', 'birthday', 'gmail', 'corporateEmail', 'startDate', 'status', 'admin', 'notes', 'createdAt', 'updatedAt', 'updatedBy', 'phone'],
  Posts: ['id', 'topic', 'details', 'postDate', 'channel', 'owner', 'status', 'postedAt', 'postedBy', 'link', 'createdAt', 'updatedAt', 'updatedBy'],
  DrafterCalls: ['id', 'dirId', 'name', 'uid', 'email', 'location', 'reason', 'status', 'schedDate', 'schedTime', 'mins', 'meetUrl', 'eventId', 'conductedBy', 'notes', 'doneAt', 'createdAt', 'updatedAt', 'updatedBy'],
  Onboarding: ['id', 'data', 'createdAt', 'updatedAt', 'updatedBy'],
  Verification: ['id', 'data', 'createdAt', 'updatedAt', 'updatedBy'],
  TrLabCalls: ['id', 'data', 'createdAt', 'updatedAt', 'updatedBy'],
  LeaveRequests: ['id', 'data', 'createdAt', 'updatedAt', 'updatedBy'],
  Undertime: ['id', 'data', 'createdAt', 'updatedAt', 'updatedBy'],
  PausedContracts: ['id', 'data', 'createdAt', 'updatedAt', 'updatedBy'],
  Jobs: ['id', 'title', 'location', 'type', 'description', 'requirements', 'status', 'createdAt', 'updatedAt', 'updatedBy'],
  Candidates: ['id', 'firstName', 'lastName', 'gender', 'birthDate', 'email', 'phone', 'source', 'location', 'resumeUrl', 'resumeName', 'recruiter',
    'stage', 'status', 'appliedAt', 'stageAt', 'interviewDate', 'interviewTime', 'tasksDate', 'tasksTime', 'accountAt', 'accountBy', 'taskResult',
    'rejectReason', 'hiredAt', 'dirId', 'notes', 'createdAt', 'updatedAt', 'updatedBy', 'jobId', 'jobTitle', 'online']
};
const HEAVY_CALL_FIELDS = ['transcriptOriginal', 'transcriptEnglish', 'answers', 'reasons'];

/* ------------------------------------------------------------------ web app */

function doGet(e) {
  const prm = (e && e.parameter) || {};
  // The public job application page: links with ?job=… or ?apply, and anyone who is not signed in.
  if (prm.job || prm.apply != null || (prm.app == null && !currentEmail_() && applyMode_())) return applyPage_(prm.job || '');
  // The first screen's data is sent inside the page, so it shows instantly (no second trip to the server).
  const t = HtmlService.createTemplateFromFile('Index');
  let boot;
  try { boot = getBootstrap(); } catch (err) { boot = { error: friendlyError_(err) }; }
  t.boot = JSON.stringify(boot).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return t.evaluate().setTitle('HR Dashboard').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function friendlyError_(e) {
  const m = String((e && e.message) || e);
  if (/not have permission|Access denied|You do not have access|No item with the given ID/i.test(m)) {
    return 'You don\'t have access to HR Dashboard yet. Ask the HR admin to add your email in Settings → HR team.';
  }
  return m;
}

/**
 * Run this from the Apps Script editor (select "diagnose" → Run) if the app does not load.
 * It also asks for the permissions the app needs. Results appear in the Execution log.
 */
function diagnose() {
  const step = function (name, fn) {
    const t = Date.now();
    try { const r = fn(); console.log('OK   ' + name + ' (' + (Date.now() - t) + ' ms)' + (r ? ' — ' + r : '')); }
    catch (e) { console.log('FAIL ' + name + ' — ' + e.message); }
  };
  step('Your account', function () { return currentEmail_() || '(empty — check deployment "Execute as")'; });
  step('App storage', function () { return db_().getUrl(); });
  step('Settings', function () { return JSON.stringify(getSettingsMap_()).slice(0, 200); });
  step('Access check', function () { requireAccess_(); return 'allowed'; });
  step('Load data', function () { const b = getBootstrap(); return b.data.leaders.length + ' leaders, ' + b.data.calls.length + ' calls, page data ' + Math.round(JSON.stringify(b).length / 1024) + ' KB'; });
  step('Index file', function () { HtmlService.createTemplateFromFile('Index'); return 'found'; });
  step('Calendar', function () { return calendarPermission_(); });
  step('Translation', function () { return LanguageApp.translate('Masaya ako', 'tl', 'en'); });
  step('Web app link', function () { return ScriptApp.getService().getUrl() || '(not deployed yet)'; });
}

/* ------------------------------------------------------------------ storage (automatic) */

let DB_ = null;
/** Opens the app's own storage file, creating it on first use. Nobody needs to touch it. */
function db_() {
  if (DB_) return DB_;
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('DATA_ID');
  if (id) { DB_ = SpreadsheetApp.openById(id); ensureSchema_(DB_); return DB_; }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    id = props.getProperty('DATA_ID');
    if (id) { DB_ = SpreadsheetApp.openById(id); return DB_; }
    const ss = SpreadsheetApp.create(CONFIG.DATA_NAME);
    Object.keys(HEADERS).forEach(function (name, i) {
      const sh = i === 0 ? ss.getSheets()[0].setName(name) : ss.insertSheet(name);
      prepSheet_(sh, HEADERS[name]);
    });
    DB_ = ss;
    const me = currentEmail_();
    const yr = Utilities.formatDate(new Date(), tz_(), 'yyyy'), half = Number(Utilities.formatDate(new Date(), tz_(), 'M')) <= 6;
    const round = yr + ' · Round ' + (half ? 1 : 2);
    ss.getSheetByName('Settings').appendRow(['roundsMeta', JSON.stringify(makeMeta_({}, [round], round, half ? 'Jan–Jun' : 'Jul–Dec'))]);
    [['owner', me], ['hrEmails', ''], ['rounds', JSON.stringify([round])], ['currentRound', round],
     ['targetMins', String(CONFIG.DEFAULT_TARGET_MINS)]]
      .forEach(function (kv) { ss.getSheetByName('Settings').appendRow(kv); });
    props.setProperty('DATA_ID', ss.getId());
    return ss;
  } finally { lock.releaseLock(); }
}

function prepSheet_(sh, h) {
  if (sh.getMaxColumns() < h.length) sh.insertColumnsAfter(sh.getMaxColumns(), h.length - sh.getMaxColumns());
  sh.getRange(1, 1, sh.getMaxRows(), h.length).setNumberFormat('@');
  sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold');
  sh.setFrozenRows(1);
}

/** Adds columns/tabs added by newer versions of the app. Runs at most every 6 hours. */
function ensureSchema_(ss) {
  const cache = CacheService.getScriptCache();
  if (cache.get('schema_v17')) return;
  Object.keys(HEADERS).forEach(function (name) {
    const h = HEADERS[name];
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getMaxColumns() < h.length) sh.insertColumnsAfter(sh.getMaxColumns(), h.length - sh.getMaxColumns());
    const cur = sh.getRange(1, 1, 1, h.length).getValues()[0];
    if (cur.join('|') !== h.join('|')) prepSheet_(sh, h);
  });
  migrateGroups_(ss);
  fixSwappedLeaders_(ss);
  cache.put('schema_v17', '1', 21600);
}

/** Group names were renamed (TLs → Team Leaders, SUPs → Supervisors). Updates saved data once. */
function migrateGroups_(ss) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('groups_v2')) return;
  ['Leaders', 'Calls'].forEach(function (name) {
    const sh = ss.getSheetByName(name);
    const col = HEADERS[name].indexOf('group') + 1;
    if (!sh || col < 1) return;
    const last = sh.getLastRow();
    if (last < 2) return;
    const rng = sh.getRange(2, col, last - 1, 1);
    const vals = rng.getValues();
    let changed = false;
    const out = vals.map(function (r) { const g = normGroup_(r[0]); if (r[0] !== '' && g !== r[0]) changed = true; return [r[0] === '' ? '' : g]; });
    if (changed) rng.setValues(out);
  });
  props.setProperty('groups_v2', '1');
}

const UID_RE = /^\d{2}-\d{5,8}$/;
/** Leaders pasted as "UID, Name, …" got their name and UID swapped. Swaps them back (once, and on every new paste). */
function fixSwappedLeaders_(ss) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('swapfix_v1')) return;
  const sh = ss.getSheetByName('Leaders');
  const h = HEADERS.Leaders, ni = h.indexOf('name'), ui = h.indexOf('uid');
  const last = sh ? sh.getLastRow() : 0;
  if (last >= 2) {
    const rng = sh.getRange(2, 1, last - 1, h.length), vals = rng.getValues();
    let changed = false;
    vals.forEach(function (r) {
      const n = String(r[ni]).trim(), u = String(r[ui]).trim();
      if (UID_RE.test(n) && u && !UID_RE.test(u)) { r[ni] = u; r[ui] = n; changed = true; }
    });
    if (changed) rng.setValues(vals);
  }
  props.setProperty('swapfix_v1', '1');
}
function normGroup_(g) {
  const t = String(g || '').trim();
  if (GROUPS.indexOf(t) >= 0) return t;
  const x = t.toLowerCase();
  if (/^hr\b|human/.test(x)) return 'HR';
  if (/assist/.test(x)) return 'Assistants';
  if (/train/.test(x)) return 'Trainers';
  if (/mentor/.test(x)) return 'Mentors';
  if (/sup/.test(x)) return 'Supervisors';
  if (/man|mgr/.test(x)) return 'Managers';
  return 'Team Leaders';
}

/* ------------------------------------------------------------------ API: read */

function getBootstrap() {
  requireTeam_();
  try { moveNewbiePagesToRecruitment_(); } catch (e) {}
  const s = getSettingsMap_();
  const me = currentEmail_();
  const Q = questions_(s.currentRound || '');
  const qByRound = {};
  parseJson_(s.rounds, []).forEach(function (r) { qByRound[r] = { sets: roundSets_(r) }; });
  const key = getGeminiKey_();
  return {
    cfg: {
      languages: LANGUAGES, groups: GROUPS, concernCategories: CONCERN_CATEGORIES, concernStatuses: CONCERN_STATUSES, countries: COUNTRIES,
      health: Q.health, open: Q.open, retentionQ: Q.retentionQ, retentionFollowup: Q.retentionFollowup, script: Q.script,
      questionsCustom: !!s.questions || !!(parseJson_(s.questionsByRound, {}) || {})[s.currentRound || ''], qByRound: qByRound, qsets: qsets_(), canEditQ: isDev_(me, s),
      geminiModel: s.geminiModel || CONFIG.DEFAULT_GEMINI_MODEL, geminiKeySet: !!key, geminiKeyHint: key ? '••••' + key.slice(-4) : '',
      rounds: parseJson_(s.rounds, []), currentRound: s.currentRound || '',
      roundsMeta: makeMeta_(parseJson_(s.roundsMeta, {}), parseJson_(s.rounds, []), s.currentRound || ''),
      hrTeam: hrTeam_(s),
      targetMins: Number(s.targetMins) || CONFIG.DEFAULT_TARGET_MINS,
      hrEmails: s.hrEmails || '', owner: s.owner || '', isAdmin: !s.owner || me.toLowerCase() === String(s.owner).toLowerCase(),
      tz: tz_(), me: me, today: Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'),
      ui: parseJson_(s.ui, {}) || {}, modules: layout_(s), layoutVer: s.layoutVer || '', myModules: modulesFor_(me), callAccess: hasCallAccess_(me), isDev: isDev_(me, s), devs: splitEmails_(s.devs || ''),
      hrAccess: (!s.owner || me.toLowerCase() === String(s.owner).toLowerCase()) ? parseJson_(s.hrAccess, {}) : {}
    },
    data: hasCallAccess_(me) ? getAll() : { leaders: [], calls: [], concerns: [] },
    // The start page is People › Overview, so its data comes with the page (one less trip to the server).
    dir: (function () { try { return getDirectory(); } catch (e) { return null; } })()
  };
}

function getAll() {
  requireAccess_();
  // The lists don't need the big text columns (transcripts, answers) — skipping them keeps loading fast.
  const light = HEADERS.Calls.filter(function (h) { return HEAVY_CALL_FIELDS.indexOf(h) < 0; });
  return { leaders: readAll_('Leaders'), calls: readCols_('Calls', light), concerns: readAll_('Concerns') };
}

function getCall(id) {
  requireAccess_();
  const c = findById_('Calls', id);
  if (!c) throw new Error('Call not found');
  c.reasons = parseJson_(c.reasons, {});
  c.answers = parseJson_(c.answers, {});
  c.scoreMap = scoreMap_(c);
  c.concerns = readAll_('Concerns').filter(function (k) { return k.callId === id; });
  return c;
}

/** Every call of a round with all its answers (for the "All answers" table on the round summary). */
function getRoundAnswers(round) {
  requireAccess_();
  const cols = HEADERS.Calls.filter(function (h) { return h !== 'transcriptOriginal' && h !== 'transcriptEnglish'; });
  const ks = readAll_('Concerns').filter(function (k) { return k.round === round; });
  return readCols_('Calls', cols).filter(function (c) { return c.round === round && c.status !== 'Cancelled' && c.status !== 'Assigned'; })
    .map(function (c) {
      return { id: c.id, leaderId: c.leaderId, leaderName: c.leaderName, group: c.group, status: c.status, callDate: c.callDate, schedDate: c.schedDate,
        conductedBy: c.conductedBy, retention: c.retention, retentionReason: c.retentionReason, positives: c.positives, negatives: c.negatives,
        summary: c.summary, scores: scoreMap_(c), reasons: parseJson_(c.reasons, {}), answers: parseJson_(c.answers, {}),
        concerns: ks.filter(function (k) { return k.callId === c.id; }).map(function (k) { return { category: k.category, description: k.description, status: k.status }; }) };
    });
}

/** Puts a table (first row = headers) into a new Google Sheet in your Drive and returns its link. */
function exportRoundToSheet(title, rows) {
  requireAccess_();
  if (!rows || !rows.length || !rows[0].length) throw new Error('Nothing to export');
  if (rows.length > 5000 || rows[0].length > 200) throw new Error('Too much data to export at once');
  const width = rows[0].length;
  const safe = rows.map(function (r) {
    const row = [];
    for (let i = 0; i < width; i++) {
      let v = r[i] == null ? '' : r[i];
      if (typeof v === 'string') { v = v.slice(0, 45000); if (/^[=+\-@]/.test(v)) v = "'" + v; }
      row.push(v);
    }
    return row;
  });
  const ss = SpreadsheetApp.create(String(title || 'HR 1:1 answers').slice(0, 100));
  const sh = ss.getSheets()[0].setName('Answers');
  if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
  if (sh.getMaxRows() < safe.length) sh.insertRowsAfter(sh.getMaxRows(), safe.length - sh.getMaxRows());
  sh.getRange(1, 1, safe.length, width).setValues(safe);
  sh.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#ffe11b').setVerticalAlignment('middle');
  sh.getRange(1, 1, safe.length, width).setWrap(true).setVerticalAlignment('top');
  sh.setFrozenRows(1); sh.setFrozenColumns(1);
  sh.setColumnWidths(1, width, 200);
  return ss.getUrl();
}

/** The call to open for a leader in a round (an open one first), or null for a new one. */
function openCallForLeader(leaderId, round) {
  requireAccess_();
  const cs = readCols_('Calls', ['id', 'leaderId', 'round', 'status', 'updatedAt'])
    .filter(function (c) { return c.leaderId === leaderId && c.round === round && c.status !== 'Cancelled'; });
  if (!cs.length) return null;
  cs.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
  const open = cs.filter(function (c) { return c.status !== 'Completed'; })[0];
  return getCall((open || cs[0]).id);
}

/* ------------------------------------------------------------------ API: leaders */

function saveLeader(p) {
  requireAccess_();
  if (!String(p.name || '').trim()) throw new Error('Name is required');
  withLock_(function () {
    upsert_('Leaders', {
      id: p.id || newId_('L'), name: p.name.trim(), group: normGroup_(p.group), position: p.position || '', location: p.location || '',
      language: p.language || COUNTRY_LANG[p.location] || 'en', email: (p.email || '').trim(), active: p.active || 'Yes',
      uid: String(p.uid || '').trim(), manager: String(p.manager || '').trim()
    });
  });
  return getAll();
}

/** Bulk add: [{name, group, position, location, language, email}]. Skips names that already exist. */
function importLeaders(rows) {
  requireAccess_();
  let added = 0, skipped = 0;
  withLock_(function () {
    const have = {};
    readAll_('Leaders').forEach(function (l) { have[l.name.trim().toLowerCase()] = true; });
    const sh = sheet_('Leaders');
    const out = [];
    (rows || []).forEach(function (r) {
      if (UID_RE.test(String(r.name || '').trim()) && r.uid && !UID_RE.test(String(r.uid).trim())) { const t = r.name; r.name = r.uid; r.uid = t; }
      const name = String(r.name || '').trim();
      if (!name || have[name.toLowerCase()]) { skipped++; return; }
      have[name.toLowerCase()] = true;
      const o = { id: newId_('L'), name: name, group: normGroup_(r.group), position: r.position || '', location: r.location || '',
        language: r.language || COUNTRY_LANG[r.location] || 'en', email: String(r.email || '').trim(), active: 'Yes',
        uid: String(r.uid || '').trim(), manager: String(r.manager || '').trim() };
      out.push(HEADERS.Leaders.map(function (k) { return o[k]; }));
      added++;
    });
    if (out.length) sh.getRange(sh.getLastRow() + 1, 1, out.length, HEADERS.Leaders.length).setNumberFormat('@').setValues(out);
  });
  return { added: added, skipped: skipped, data: getAll() };
}

/* ------------------------------------------------------------------ API: scheduling + Google Meet */

/**
 * Schedules (or reschedules) a 1:1. Always creates a Google Calendar event with a Google Meet link
 * on the HR person's calendar, and invites the leader by email if one is saved.
 */
function scheduleCall(p) {
  requireAccess_();
  const leader = findById_('Leaders', p.leaderId);
  if (!leader) throw new Error('Leader not found');
  if (!p.date || !p.time) throw new Error('Pick a date and time');
  const mins = Number(p.mins) || Number(getSettingsMap_().targetMins) || CONFIG.DEFAULT_TARGET_MINS;
  const start = Utilities.parseDate(p.date + ' ' + p.time, tz_(), 'yyyy-MM-dd HH:mm');
  const end = new Date(start.getTime() + mins * 60000);
  const existing = p.callId ? findById_('Calls', p.callId) : null;

  let meet = { eventId: existing ? existing.eventId : '', meetUrl: existing ? existing.meetUrl : '' }, meetError = '';
  try {
    meet = existing && existing.eventId ? meetMove_(existing.eventId, start, end, leader) : meetCreate_(leader, p.round, start, end);
  } catch (e) { meetError = e.message; }

  const now = nowIso_();
  const c = {
    id: existing ? existing.id : newId_('C'), round: p.round, leaderId: leader.id, leaderName: leader.name, group: leader.group,
    status: 'Scheduled', schedDate: p.date, schedTime: p.time, plannedMins: String(mins),
    conductedBy: p.hr || currentEmail_(), language: (existing && existing.language) || leader.language || 'en',
    meetUrl: meet.meetUrl || (existing && existing.meetUrl) || '', eventId: meet.eventId || '', updatedAt: now
  };
  if (!existing) c.createdAt = now;
  withLock_(function () { upsert_('Calls', c); });
  return { callId: c.id, meetUrl: c.meetUrl, meetError: meetError, invited: leader.email || '', data: getAll() };
}

/** Cancels a scheduled 1:1 and removes the calendar event (the leader gets a cancellation email). */
function cancelCall(callId) {
  requireAccess_();
  const c = findById_('Calls', callId);
  if (!c) throw new Error('Call not found');
  if (c.eventId) { try { meetDelete_(c.eventId); } catch (e) { /* event may be gone already */ } }
  withLock_(function () { upsert_('Calls', { id: c.id, status: 'Cancelled', updatedAt: nowIso_() }); });
  return getAll();
}

/** Deletes a call for good: its answers, its concerns and its Google Calendar event (the leader is told it is cancelled). */
function deleteCall(callId) {
  requireAccess_();
  const c = findById_('Calls', callId);
  if (!c) throw new Error('Call not found');
  let calNote = '';
  if (c.eventId && c.status !== 'Completed' && c.status !== 'Notes pending') {
    try { meetDelete_(c.eventId); } catch (e) { calNote = ' (the Google Calendar event could not be removed — delete it in Calendar)'; }
  }
  withLock_(function () {
    deleteWhere_('Concerns', function (k) { return k.callId === callId; });
    deleteById_('Calls', callId);
  });
  return { data: getAll(), note: calNote };
}

/** Deletes a leader. With everything=true their calls, answers and concerns are deleted too. */
function deleteLeader(leaderId, everything) {
  requireAccess_();
  const l = findById_('Leaders', leaderId);
  if (!l) throw new Error('Leader not found');
  const calls = readCols_('Calls', ['id', 'leaderId', 'status', 'eventId']).filter(function (c) { return c.leaderId === leaderId; });
  const history = calls.filter(function (c) { return c.status !== 'Cancelled' && c.status !== 'Assigned'; }).length;
  if (history && !everything) throw new Error(l.name + ' has ' + history + ' call(s). Choose "Delete with all calls", or mark them Inactive to keep the history.');
  let calNote = '';
  calls.forEach(function (c) {
    if (c.eventId && c.status === 'Scheduled') { try { meetDelete_(c.eventId); } catch (e) { calNote = ' Some Google Calendar events could not be removed — delete them in Calendar.'; } }
  });
  withLock_(function () {
    deleteWhere_('Concerns', function (k) { return k.leaderId === leaderId; });
    deleteWhere_('Calls', function (c) { return c.leaderId === leaderId; });
    deleteById_('Leaders', leaderId);
  });
  return { data: getAll(), removedCalls: calls.length, note: calNote };
}

/** Deletes every row of a tab that matches (bottom-up, so row numbers stay valid). */
function deleteWhere_(name, match) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const h = HEADERS[name];
  const rows = sh.getRange(2, 1, last - 1, h.length).getValues();
  let n = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const o = {}; h.forEach(function (k, j) { o[k] = norm_(rows[i][j]); });
    if (o.id && match(o)) { sh.deleteRow(i + 2); n++; }
  }
  return n;
}

/** Creates a Google Meet for a call right now (for an unscheduled 1:1). */
function createMeetNow(callId) {
  requireAccess_();
  const c = findById_('Calls', callId);
  if (!c) throw new Error('Save the call first');
  if (c.meetUrl) return { meetUrl: c.meetUrl };
  const leader = findById_('Leaders', c.leaderId) || { name: c.leaderName, email: '' };
  const mins = Number(getSettingsMap_().targetMins) || CONFIG.DEFAULT_TARGET_MINS;
  const start = new Date();
  const ev = meetCreate_(leader, c.round, start, new Date(start.getTime() + mins * 60000));
  withLock_(function () { upsert_('Calls', { id: c.id, meetUrl: ev.meetUrl, eventId: ev.eventId, updatedAt: nowIso_() }); });
  return { meetUrl: ev.meetUrl, invited: leader.email || '' };
}

/** Use your own meeting link instead (Meet, Zoom, …). */
/**
 * Finds the Google Calendar event that has this Meet link (in your calendar, from 30 days ago to 6 months ahead)
 * and returns its date, time and length so the 1:1 can be scheduled in the app.
 */
function findMeetEvent(meetUrl) {
  requireAccess_();
  const m = String(meetUrl || '').toLowerCase().match(/([a-z]{3}-[a-z]{4}-[a-z]{3})/);
  if (!m) throw new Error('That does not look like a Google Meet link (it should look like meet.google.com/abc-defg-hij).');
  const code = m[1], link = 'https://meet.google.com/' + code;
  const tz = tz_();
  const tMin = new Date(Date.now() - 30 * 864e5).toISOString(), tMax = new Date(Date.now() + 183 * 864e5).toISOString();
  let token = '', found = null, pages = 0;
  do {
    const q = { timeMin: tMin, timeMax: tMax, singleEvents: true, orderBy: 'startTime', maxResults: 2500 };
    if (token) q.pageToken = token;
    let res;
    if (typeof Calendar !== 'undefined' && Calendar.Events && Calendar.Events.list) res = Calendar.Events.list(myCal_(), q);
    else {
      const qs = Object.keys(q).map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&');
      const r = UrlFetchApp.fetch('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(myCal_()) + '/events?' + qs,
        { muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } });
      res = parseJson_(r.getContentText(), {});
      if (r.getResponseCode() >= 300) throw new Error('Could not read your Google Calendar: ' + ((res.error && res.error.message) || r.getResponseCode()));
    }
    found = (res.items || []).filter(function (ev) {
      if (ev.status === 'cancelled') return false;
      const eps = ((ev.conferenceData || {}).entryPoints || []).map(function (p) { return String(p.uri || '').toLowerCase(); });
      return String(ev.hangoutLink || '').toLowerCase().indexOf(code) >= 0 || eps.some(function (u) { return u.indexOf(code) >= 0; }) ||
        String(ev.location || '').toLowerCase().indexOf(code) >= 0 || String(ev.description || '').toLowerCase().indexOf(code) >= 0;
    })[0] || null;
    token = res.nextPageToken || '';
  } while (!found && token && ++pages < 4);
  if (!found || !found.start || !found.start.dateTime) return { found: false, meetUrl: link };
  const st = new Date(found.start.dateTime), en = new Date(found.end.dateTime);
  return {
    found: true, meetUrl: link, eventId: found.id, title: found.summary || '',
    date: Utilities.formatDate(st, tz, 'yyyy-MM-dd'), time: Utilities.formatDate(st, tz, 'HH:mm'),
    mins: Math.max(5, Math.round((en - st) / 60000)),
    guests: (found.attendees || []).filter(function (a) { return !a.self; }).map(function (a) { return a.email; })
  };
}

/** Schedules a 1:1 in the app from a Meet link + date/time (the event itself was made in Google Calendar). */
function setCallSchedule(p) {
  requireAccess_();
  const leader = findById_('Leaders', p.leaderId);
  if (!leader) throw new Error('Leader not found');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '') || !/^\d{2}:\d{2}/.test(p.time || '')) throw new Error('Pick the date and time');
  let url = String(p.meetUrl || '').trim();
  if (url && !/^https:\/\//.test(url)) url = 'https://' + url.replace(/^\/+/, '');
  let id = '';
  withLock_(function () {
    const now = nowIso_();
    const cs = readCols_('Calls', ['id', 'leaderId', 'round', 'status', 'updatedAt'])
      .filter(function (c) { return c.leaderId === p.leaderId && c.round === p.round && c.status !== 'Cancelled' && c.status !== 'Completed' && c.status !== 'Notes pending'; })
      .sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
    id = p.callId || (cs[0] && cs[0].id) || newId_('C');
    const o = { id: id, status: 'Scheduled', schedDate: p.date, schedTime: String(p.time).slice(0, 5), plannedMins: String(Number(p.mins) || CONFIG.DEFAULT_TARGET_MINS || 30),
      meetUrl: url, updatedAt: now };
    if (p.eventId) o.eventId = p.eventId;
    if (p.hr !== undefined) o.conductedBy = p.hr;
    if (!p.callId && !cs[0]) Object.assign(o, { round: p.round, leaderId: leader.id, leaderName: leader.name, group: leader.group,
      language: leader.language || 'en', scores: '{}', createdAt: now, conductedBy: p.hr || currentEmail_() });
    upsert_('Calls', o);
  });
  return { callId: id, data: getAll() };
}

function setMeetUrl(callId, url) {
  requireAccess_();
  url = String(url || '').trim();
  if (url && !/^https:\/\//.test(url)) url = 'https://' + url.replace(/^\/+/, '');
  withLock_(function () { upsert_('Calls', { id: callId, meetUrl: url, updatedAt: nowIso_() }); });
  return { meetUrl: url };
}

// Google Calendar: uses the "Google Calendar API" service if added, otherwise the same API directly.
function calendar_(method, path, body, query) {
  if (API_USER && method === 'insert' && body) {
    body.attendees = body.attendees || [];
    if (!body.attendees.some(function (a) { return String(a.email).toLowerCase() === API_USER; })) body.attendees.push({ email: API_USER, responseStatus: 'accepted' });
  }
  if (typeof Calendar !== 'undefined') {
    const q = query || {};
    if (method === 'insert') return Calendar.Events.insert(body, 'primary', q);
    if (method === 'patch') return Calendar.Events.patch(body, 'primary', path, q);
    if (method === 'remove') return Calendar.Events.remove('primary', path, q);
  }
  const qs = Object.keys(query || {}).map(function (k) { return k + '=' + encodeURIComponent(query[k]); }).join('&');
  const url = 'https://www.googleapis.com/calendar/v3/calendars/primary/events' +
    (method === 'insert' ? '' : '/' + encodeURIComponent(path)) + (qs ? '?' + qs : '');
  const opts = { method: { insert: 'post', patch: 'patch', remove: 'delete' }[method], muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } };
  if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  const res = UrlFetchApp.fetch(url, opts);
  return calendarResult_(res);
}
function calendarResult_(res) {
  const j = parseJson_(res.getContentText(), {});
  if (res.getResponseCode() >= 300) {
    const msg = (j.error && j.error.message) || ('Calendar error ' + res.getResponseCode());
    if (/has not been used|is disabled/i.test(msg)) throw new Error('Google Meet links need the Calendar service: Apps Script editor → Services (+) → Google Calendar API → Add, then deploy a new version.');
    throw new Error(msg);
  }
  return j;
}
function meetCreate_(leader, round, start, end) {
  const ev = calendar_('insert', '', {
    summary: 'HR 1:1 — ' + leader.name,
    description: 'HR 1:1 check-in (' + round + ').\nJoin with the Google Meet link. You can speak in the language you are most comfortable with.',
    start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() },
    attendees: leader.email ? [{ email: leader.email }] : [],
    conferenceData: { createRequest: { requestId: Utilities.getUuid(), conferenceSolutionKey: { type: 'hangoutsMeet' } } }
  }, { conferenceDataVersion: 1, sendUpdates: leader.email ? 'all' : 'none' });
  return { eventId: ev.id, meetUrl: ev.hangoutLink || '' };
}
function meetMove_(eventId, start, end, leader) {
  const ev = calendar_('patch', eventId, { start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } },
    { sendUpdates: leader.email ? 'all' : 'none' });
  return { eventId: ev.id, meetUrl: ev.hangoutLink || '' };
}
function meetDelete_(eventId) { calendar_('remove', eventId, null, { sendUpdates: 'all' }); }
/**
 * Google Calendar events for the calendar page.
 * Your own calendar: real event titles + Meet links. Teammates: titles if they share event details with you,
 * otherwise free/busy only ("Busy"). Returns {email: {busy: [{s, e, title, meet, link, allDay}], mode: 'details'|'busy', error}}.
 */
function getBusy(fromDate, toDate, emails) {
  requireAccess_();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(toDate || '')) throw new Error('Bad dates');
  const me = currentEmail_().toLowerCase();
  const list = (emails || []).map(function (e) { return String(e).toLowerCase().trim(); }).filter(function (e) { return /@/.test(e); }).slice(0, 20);
  if (!list.length) return {};
  const cacheKey = 'gcal2_' + fromDate + '_' + toDate + '_' + Utilities.base64Encode(list.join(',')).slice(0, 170);
  const cache = CacheService.getUserCache();
  const hit = cache.get(cacheKey);
  if (hit) return JSON.parse(hit);
  const tz = tz_();
  const tMin = Utilities.parseDate(fromDate + ' 00:00', tz, 'yyyy-MM-dd HH:mm').toISOString();
  const tMax = Utilities.parseDate(toDate + ' 23:59', tz, 'yyyy-MM-dd HH:mm').toISOString();
  const fmt = function (iso) { return Utilities.formatDate(new Date(iso), tz, "yyyy-MM-dd'T'HH:mm"); };
  const out = {};
  const needBusy = [];
  list.forEach(function (em) {
    try {
      const items = listEvents_(em === me && !API_USER ? 'primary' : em, tMin, tMax);
      out[em] = { mode: 'details', error: '', busy: items.filter(function (ev) {
        if (ev.status === 'cancelled' || ev.transparency === 'transparent' || ev.eventType === 'workingLocation') return false;
        const self = (ev.attendees || []).filter(function (a) { return a.self; })[0];
        return !(self && self.responseStatus === 'declined');
      }).map(function (ev) {
        const allDay = !!(ev.start && ev.start.date);
        return {
          s: allDay ? ev.start.date + 'T00:00' : fmt(ev.start.dateTime), e: allDay ? ev.end.date + 'T00:00' : fmt(ev.end.dateTime),
          title: ev.summary || (ev.visibility === 'private' ? 'Private event' : 'Busy'), meet: ev.hangoutLink || '', link: ev.htmlLink || '', allDay: allDay
        };
      }) };
    } catch (e) { needBusy.push(em); }
  });
  if (needBusy.length) {
    const body = { timeMin: tMin, timeMax: tMax, timeZone: tz, items: needBusy.map(function (e) { return { id: e === me && !API_USER ? 'primary' : e }; }) };
    let res = null, err = '';
    try {
      if (typeof Calendar !== 'undefined' && Calendar.Freebusy) res = Calendar.Freebusy.query(body);
      else {
        const r = UrlFetchApp.fetch('https://www.googleapis.com/calendar/v3/freeBusy', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
          payload: JSON.stringify(body), headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } });
        res = parseJson_(r.getContentText(), {});
        if (r.getResponseCode() >= 300) throw new Error((res.error && res.error.message) || ('Calendar error ' + r.getResponseCode()));
      }
    } catch (e) { err = String(e.message || e); }
    needBusy.forEach(function (em) {
      const c = ((res || {}).calendars || {})[em === me && !API_USER ? 'primary' : em] || {};
      const ce = (c.errors || [])[0];
      out[em] = { mode: 'busy', busy: (c.busy || []).map(function (b) { return { s: fmt(b.start), e: fmt(b.end), title: '' }; }),
        error: err || (ce ? (ce.reason === 'notFound' ? 'Calendar not shared with you' : ce.reason || 'Not available') : '') };
    });
  }
  try { cache.put(cacheKey, JSON.stringify(out), 120); } catch (e) {}
  return out;
}
function listEvents_(calId, tMin, tMax) {
  const q = { timeMin: tMin, timeMax: tMax, singleEvents: true, orderBy: 'startTime', maxResults: 250 };
  if (typeof Calendar !== 'undefined' && Calendar.Events && Calendar.Events.list) return Calendar.Events.list(calId, q).items || [];
  const qs = Object.keys(q).map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&');
  const r = UrlFetchApp.fetch('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calId) + '/events?' + qs,
    { muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } });
  const j = parseJson_(r.getContentText(), {});
  if (r.getResponseCode() >= 300) throw new Error((j.error && j.error.message) || ('Calendar error ' + r.getResponseCode()));
  return j.items || [];
}

// Mentions CalendarApp so Google asks for Calendar permission when the app is authorized.
function calendarPermission_() { return CalendarApp.getDefaultCalendar().getId(); }

/* ------------------------------------------------------------------ API: calls */

function saveCall(p) {
  requireAccess_();
  const leader = findById_('Leaders', p.leaderId);
  if (!leader) throw new Error('Leader not found');
  let id;
  withLock_(function () {
    const now = nowIso_();
    const existing = p.id ? findById_('Calls', p.id) : null;
    const c = {
      id: existing ? existing.id : newId_('C'), round: p.round, leaderId: leader.id, leaderName: leader.name, group: leader.group,
      conductedBy: p.conductedBy || currentEmail_(), language: p.language || leader.language || 'en',
      callDate: p.callDate || '', startTime: p.startTime || '', endTime: p.endTime || '', durationMins: p.durationMins || '',
      retention: p.retention || '', retentionReason: p.retentionReason || '',
      reasons: JSON.stringify(p.reasons || {}), answers: JSON.stringify(p.answers || {}),
      positives: listText_(p.positives), negatives: listText_(p.negatives), summary: p.summary || '',
      nextDate: p.nextDate || '', nextTime: p.nextTime || '', audio: p.audio || undefined,
      transcriptOriginal: clip_(p.transcriptOriginal), transcriptEnglish: clip_(p.transcriptEnglish), updatedAt: now
    };
    const sc = {};
    Object.keys(p.scores || {}).forEach(function (k) { const n = Number(p.scores[k]); if (n >= 1 && n <= 10) sc[k] = n; });
    c.scores = JSON.stringify(sc);
    HEALTH.forEach(function (h) { c['s_' + h.key] = sc[h.key] ? String(sc[h.key]) : ''; });
    if (p.status === 'Cancelled') c.status = 'Cancelled';
    else if (p.status === 'Done') c.status = 'Completed';
    else {
      c.status = (existing && existing.schedDate) || p.callDate ? 'Scheduled' : 'Assigned';
      if (!(existing && existing.schedDate) && p.callDate) c.schedDate = p.callDate;
    }
    c.sentiment = sentimentFromScores_(c);
    if (!existing) c.createdAt = now;
    upsert_('Calls', c);
    id = c.id;

    (p.concerns || []).forEach(function (k) {
      if (!String(k.description || '').trim()) return;
      upsert_('Concerns', {
        id: k.id || newId_('K'), callId: c.id, leaderId: c.leaderId, leaderName: c.leaderName, round: c.round,
        category: k.category || 'Other', description: k.description, response: k.response || '', owner: k.owner || '',
        status: k.status || 'Open', createdAt: k.id ? undefined : now, updatedAt: now, qkey: k.qkey || undefined,
        resolvedAt: (k.status || 'Open') === 'Open' ? '' : (k.resolvedAt || now)
      });
    });
    (p.removedConcernIds || []).forEach(function (cid) { deleteById_('Concerns', cid); });
  });
  return { call: getCall(id), data: getAll() };
}

function updateConcern(p) {
  requireAccess_();
  const now = nowIso_();
  const open = !p.status || p.status === 'Open';
  withLock_(function () {
    upsert_('Concerns', { id: p.id, response: p.response, owner: p.owner, status: p.status || 'Open', updatedAt: now,
      resolvedAt: open ? '' : now, resolvedBy: open ? '' : currentEmail_() });
  });
  return getAll();
}

/* ------------------------------------------------------------------ API: assigning + rounds */

/** Assigns an HR person to a leader for a round (before a date is set). */
function assignCall(leaderId, round, hrEmail) {
  requireAccess_();
  const leader = findById_('Leaders', leaderId);
  if (!leader) throw new Error('Leader not found');
  withLock_(function () {
    const cs = readCols_('Calls', ['id', 'leaderId', 'round', 'status', 'updatedAt'])
      .filter(function (c) { return c.leaderId === leaderId && c.round === round && c.status !== 'Cancelled'; })
      .sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
    const now = nowIso_();
    const pick = cs.filter(function (c) { return c.status !== 'Completed'; })[0] || cs[0];
    if (pick) upsert_('Calls', { id: pick.id, conductedBy: hrEmail || '', updatedAt: now });
    else upsert_('Calls', { id: newId_('C'), round: round, leaderId: leader.id, leaderName: leader.name, group: leader.group,
      status: 'Assigned', conductedBy: hrEmail || '', language: leader.language || 'en', scores: '{}', createdAt: now, updatedAt: now });
  });
  return getAll();
}

/** Adds a round: {year: '2027', label: 'Round 1', period: 'Jan–Jun', makeCurrent: true}. */
function addRound(p) {
  requireAccess_();
  const year = String(p.year || '').trim(), label = String(p.label || '').trim();
  if (!/^\d{4}$/.test(year) || !label) throw new Error('Pick a year and a round name');
  const name = year + ' · ' + label;
  withLock_(function () {
    const s = getSettingsMap_();
    const rounds = parseJson_(s.rounds, []);
    if (rounds.indexOf(name) >= 0) throw new Error(name + ' already exists');
    const prev = rounds.length ? rounds[rounds.length - 1] : '';
    if (p.questionsBySet || Array.isArray(p.questionIds)) setRoundSets_(name, pickSets_('', p.questionsBySet || p.questionIds));
    else setRoundSets_(name, roundSets_(prev));
    rounds.push(name);
    const meta = parseJson_(s.roundsMeta, {});
    meta[name] = { year: year, label: label, period: String(p.period || '').trim(), presentations: [] };
    setSetting_('rounds', JSON.stringify(rounds));
    setSetting_('roundsMeta', JSON.stringify(meta));
    if (p.makeCurrent) setSetting_('currentRound', name);
  });
  return getBootstrap();
}

/** Presentation links of a round: [{title, url, addedAt}]. */
function saveRoundLinks(round, links) {
  requireAccess_();
  withLock_(function () {
    const s = getSettingsMap_();
    const meta = makeMeta_(parseJson_(s.roundsMeta, {}), parseJson_(s.rounds, []), s.currentRound || '');
    if (!meta[round]) throw new Error('Round not found');
    meta[round].presentations = (links || []).filter(function (l) { return l && /^https?:/.test(String(l.url || '')); }).slice(0, 20)
      .map(function (l) { return { title: String(l.title || 'Presentation').slice(0, 120), url: String(l.url).slice(0, 1000), addedAt: l.addedAt || nowIso_().slice(0, 10) }; });
    setSetting_('roundsMeta', JSON.stringify(meta));
  });
  return getBootstrap();
}

/** Year, short name and period for every round (older rounds get them worked out from their name). */
function makeMeta_(meta, rounds, current, period) {
  const out = {};
  const yNow = Utilities.formatDate(new Date(), tz_(), 'yyyy');
  (rounds || []).forEach(function (r) {
    const m = meta[r] || {};
    const y = (String(r).match(/(20\d\d)/) || [])[1] || yNow;
    const label = m.label || String(r).replace(/^20\d\d\s*·\s*/, '').replace(/\s*·\s*[A-Za-z]{3,9}\s+20\d\d$/, '').trim() || r;
    out[r] = { year: m.year || y, label: label, period: m.period !== undefined ? m.period : (period || ''), presentations: m.presentations || [] };
  });
  return out;
}

/** The HR team with display names: [{email, name}] (admin first). */
function hrTeam_(s) {
  const names = parseJson_(s.hrNames, {});
  const list = [String(s.owner || '').toLowerCase()].concat(splitEmails_(s.hrEmails)).filter(function (e, i, a) { return e && a.indexOf(e) === i; });
  return list.map(function (e) { return { email: e, name: names[e] || nameFromEmail_(e) }; });
}
function nameFromEmail_(e) { const n = String(e).split('@')[0].split(/[._-]/)[0]; return n.charAt(0).toUpperCase() + n.slice(1); }

/* ------------------------------------------------------------------ API: settings */

function saveSettings(p) {
  requireTeam_();
  const s = getSettingsMap_();
  const me = currentEmail_().toLowerCase();
  const isAdmin = !s.owner || me === String(s.owner).toLowerCase();
  let shareNote = '';
  withLock_(function () {
    if (p.rounds) setSetting_('rounds', JSON.stringify(p.rounds));
    if (p.currentRound !== undefined) setSetting_('currentRound', p.currentRound);
    if (p.targetMins) setSetting_('targetMins', String(p.targetMins));
    if (p.geminiModel) setSetting_('geminiModel', p.geminiModel.trim());
    if (p.hrNames && typeof p.hrNames === 'object') {
      const cur = parseJson_(s.hrNames, {});
      Object.keys(p.hrNames).forEach(function (e) { const n = String(p.hrNames[e] || '').trim(); if (n) cur[e.toLowerCase()] = n.slice(0, 40); });
      setSetting_('hrNames', JSON.stringify(cur));
    }
    if (p.hrAccess && typeof p.hrAccess === 'object' && isAdmin) {
      const ids = layout_(s).map(function (m) { return m.id; });
      const acc = {};
      Object.keys(p.hrAccess).forEach(function (e) {
        if (!Array.isArray(p.hrAccess[e])) return;
        acc[String(e).toLowerCase()] = p.hrAccess[e].filter(function (id) { return ids.indexOf(id) >= 0; });
      });
      setSetting_('hrAccess', JSON.stringify(acc));
    }
    if (Array.isArray(p.devs) && isAdmin) setSetting_('devs', p.devs.map(function (e) { return String(e).trim().toLowerCase(); }).filter(function (e) { return /@/.test(e); }).join(', '));
    if (p.hrEmails !== undefined && isAdmin) {
      const before = splitEmails_(s.hrEmails);
      const after = splitEmails_(p.hrEmails).filter(function (e) { return e !== String(s.owner).toLowerCase(); });
      setSetting_('hrEmails', after.join(', '));
      // Give the HR team access to the app's storage (and remove people taken off the list).
      const ss = db_();
      after.filter(function (e) { return before.indexOf(e) < 0; }).forEach(function (e) {
        try { ss.addEditor(e); } catch (err) { shareNote += ' Could not add ' + e + ' (' + err.message + ').'; }
      });
      before.filter(function (e) { return after.indexOf(e) < 0; }).forEach(function (e) { try { ss.removeEditor(e); } catch (err) {} });
    }
  });
  if (p.geminiKey) PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', p.geminiKey.trim());
  if (p.clearGeminiKey) PropertiesService.getScriptProperties().deleteProperty('GEMINI_API_KEY');
  const b = getBootstrap();
  b.shareNote = shareNote;
  return b;
}

/* ------------------------------------------------------------------ translation */

/** Translate any text to English. source = language code or '' for auto-detect. */
function translateText(text, source) {
  requireAccess_();
  return toEnglish_(text, source);
}

/** Translate several fields at once: {key: text} → {key: english}. */
function translateMany(map, source) {
  requireAccess_();
  const out = {};
  Object.keys(map || {}).forEach(function (k) { out[k] = toEnglish_(map[k], source); });
  return out;
}

/** The question script in the leader's language, so HR can read it out. Cached for 6 hours. */
function translateQuestions(lang, round, group) {
  requireAccess_();
  if (!lang || lang === 'en') return {};
  const cache = CacheService.getScriptCache();
  const key = 'qtr_' + (getSettingsMap_().questionsVer || '0') + '_' + lang + '_' + Utilities.base64EncodeWebSafe(String(round || '') + '|' + String(group || '')).slice(0, 60);
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const items = [];
  roundItems_(round, group).forEach(function (it) { if (it.type !== 'section') items.push(['q_' + it.id, it.text]); });
  const out = {};
  items.forEach(function (it) {
    try { out[it[0]] = LanguageApp.translate(it[1], 'en', lang); } catch (e) { out[it[0]] = ''; }
  });
  cache.put(key, JSON.stringify(out), 21600);
  return out;
}

function toEnglish_(text, source) {
  text = String(text || '').trim();
  if (!text) return '';
  const key = getGeminiKey_();
  if (key) {
    try { return chunk_(text, 15000).map(function (part) { return geminiTranslate_(part, source, key); }).join('\n'); } catch (e) { /* busy or offline: fall back to Google Translate below */ }
  }
  const src = source && source !== 'auto' && source !== 'en' ? source : '';
  if (source === 'en') return text;
  return chunk_(text, 4000).map(function (part) {
    try { return LanguageApp.translate(part, src, 'en'); }
    catch (e) { return LanguageApp.translate(part, '', 'en'); } // fall back to auto-detect
  }).join('\n');
}

/* ------------------------------------------------------------------ transcript analysis */

/**
 * Reads typed or pasted notes in any language (Apps Script only, no AI):
 * translates to English, sorts sentences into positive / negative feedback, spots concerns by topic,
 * and drafts a short summary for HR to edit.
 */
function analyzeTranscript(p) {
  requireAccess_();
  const text = String(p.text || '').trim();
  if (!text) throw new Error('Paste or type the notes first');
  const key = getGeminiKey_();
  if (key) {
    try { const g = geminiAnalyze_(text, p.language, p.leaderName, key); g.engine = 'gemini'; return g; }
    catch (e) { const b = basicAnalyze_(text, p.language); b.engine = 'basic'; b.warning = 'AI not available (' + e.message + '). Used basic translation.'; return b; }
  }
  const r = basicAnalyze_(text, p.language);
  r.engine = 'basic';
  return r;
}

function basicAnalyze_(text, lang) {
  const english = toEnglish_(text, lang);
  const POS = ['good', 'great', 'happy', 'like', 'love', 'enjoy', 'helpful', 'helped', 'supportive', 'supported', 'appreciate',
    'clear', 'smooth', 'improved', 'better', 'thank', 'satisfied', 'easy', 'proud', 'motivated', 'fair', 'excellent', 'nice', 'well', 'fine', 'okay'];
  const NEG = ['not ', "n't", 'no ', 'never', 'problem', 'issue', 'hard', 'difficult', 'stress', 'tired', 'late', 'delay', 'slow',
    'lack', 'limited', 'missing', 'confus', 'frustrat', 'overtime', 'unfair', 'without notice', 'burnout', 'burn out', 'complain',
    'bad', 'worse', 'poor', 'low', 'angry', 'leave', 'quit', 'resign', 'underpaid', 'too much', 'too many', 'pressure', 'sad', 'worried'];
  const TOPICS = [
    ['Schedules & shifts', ['schedule', 'shift', 'roster', 'without notice', 'day off', 'night']],
    ['Workload', ['workload', 'overtime', 'too much', 'too many', 'busy', 'burnout', 'burn out', 'tired', 'pressure', 'quota']],
    ['Pay & benefits', ['salary', 'pay', 'paid', 'bonus', 'benefit', 'incentive', 'allowance', 'money', 'rate']],
    ['Tools & systems', ['tool', 'system', 'software', 'computer', 'laptop', 'internet', 'app ', 'bug', 'slow']],
    ['Management & leadership', ['manager', 'management', 'leader', 'boss', 'supervisor']],
    ['Team & collaboration', ['team', 'colleague', 'communication', 'department', 'conflict']],
    ['Career growth', ['career', 'promotion', 'growth', 'training', 'learn']],
    ['Recognition', ['recogni', 'appreciat', 'credit', 'feedback']],
    ['Health & wellbeing', ['sick', 'health', 'stress', 'mental', 'rest']]
  ];
  const positives = [], negatives = [], concerns = [];
  const seenCat = {};
  english.split(/(?<=[.!?])\s+|\n+/).forEach(function (s) {
    s = s.replace(/^(hr|leader)\s*:\s*/i, '').trim();
    if (s.split(/\s+/).length < 3) return;
    const low = ' ' + s.toLowerCase() + ' ';
    const pos = POS.filter(function (w) { return low.indexOf(w) >= 0; }).length;
    const neg = NEG.filter(function (w) { return low.indexOf(w) >= 0; }).length;
    if (neg > pos) {
      negatives.push(s);
      const t = TOPICS.filter(function (tp) { return tp[1].some(function (w) { return low.indexOf(w) >= 0; }); })[0];
      const cat = t ? t[0] : 'Other';
      if (!seenCat[cat] && concerns.length < 4) { seenCat[cat] = true; concerns.push({ category: cat, description: s }); }
    } else if (pos > neg) positives.push(s);
  });
  let summary = '';
  if (positives.length || negatives.length) {
    summary = (positives.length ? 'Positive: ' + positives.slice(0, 2).join(' ') + ' ' : '') +
      (negatives.length ? 'Concerns: ' + negatives.slice(0, 2).join(' ') : 'No major concerns raised.');
    summary = summary.trim();
  }
  return { english: english, scores: {}, reasons: {}, answers: {}, positives: positives.slice(0, 8), negatives: negatives.slice(0, 8),
    concerns: concerns, summary: summary };
}

/* ------------------------------------------------------------------ AI transcript from call audio (Gemini, optional) */
// The audio goes from HR's PC to Gemini for the transcript and is not saved anywhere
// (large files use Gemini's temporary file storage and are deleted right after).

function transcribeRecording(p) {
  requireAccess_();
  const key = getGeminiKey_();
  if (!key) throw new Error('Add a Gemini API key in Settings first');
  if (!p.data) throw new Error('Empty file');
  const mime = String(p.mime || 'audio/webm').split(';')[0];
  const bytes = Utilities.base64Decode(p.data);
  let fileName = '';
  let audio;
  if (bytes.length <= 18 * 1024 * 1024) audio = { mimeType: mime, data: p.data };
  else { const up = geminiUpload_(Utilities.newBlob(bytes, mime, 'recording'), key); audio = { mimeType: mime, fileUri: up.uri }; fileName = up.name; }
  try {
    const r = geminiAnalyze_(p.notes || '', p.language, p.leaderName, key, audio);
    r.engine = 'gemini';
    return r;
  } finally {
    // remove the temporary copy from Gemini right away
    if (fileName) { try { UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/' + fileName, { method: 'delete', headers: { 'x-goog-api-key': key }, muteHttpExceptions: true }); } catch (e) {} }
  }
}
function geminiUpload_(blob, key) {
  const base = 'https://generativelanguage.googleapis.com';
  const start = UrlFetchApp.fetch(base + '/upload/v1beta/files', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-goog-api-key': key, 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(blob.getBytes().length), 'X-Goog-Upload-Header-Content-Type': blob.getContentType() },
    payload: JSON.stringify({ file: { display_name: 'hr-1on1-recording' } })
  });
  const h = start.getAllHeaders();
  const url = h['x-goog-upload-url'] || h['X-Goog-Upload-URL'];
  if (!url) throw new Error('AI upload failed: ' + start.getContentText().slice(0, 200));
  const up = UrlFetchApp.fetch(url, {
    method: 'post', muteHttpExceptions: true, payload: blob.getBytes(), contentType: blob.getContentType(),
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' }
  });
  let f = (parseJson_(up.getContentText(), {}) || {}).file;
  if (!f || !f.uri) throw new Error('AI upload failed: ' + up.getContentText().slice(0, 200));
  for (let i = 0; i < 20 && f.state === 'PROCESSING'; i++) {
    Utilities.sleep(3000);
    f = parseJson_(UrlFetchApp.fetch(base + '/v1beta/' + f.name, { headers: { 'x-goog-api-key': key }, muteHttpExceptions: true }).getContentText(), f);
  }
  if (f.state === 'FAILED') throw new Error('The AI could not read this recording');
  return { uri: f.uri, name: f.name };
}

function geminiAnalyze_(text, lang, leaderName, key, audio, formOnly) {
  const saved = getSettingsMap_().geminiModel;
  const model = saved && saved !== 'gemini-2.5-flash' ? saved : CONFIG.DEFAULT_GEMINI_MODEL;
  const Q = questions_();
  const langName = (LANGUAGES.filter(function (l) { return l.code === lang; })[0] || { name: 'unknown (auto-detect)' }).name;
  const prompt = [
    'You are helping an HR officer document a 1:1 check-in call with a team leader' + (leaderName ? ' named ' + leaderName : '') + '.',
    audio ? 'The attached file is the recorded call. The HR officer speaks English; the leader may speak ' + langName +
      ' or mix languages. First transcribe it with speaker labels ("HR:" and "Leader:"), one turn per line.' +
      ' Notes or live captions below (if any) are only a rough helper.' : '',
    'The transcript or notes below may be in ' + langName + ' or mixed with English (Tagalog, Bisaya/Cebuano, Vietnamese, Peruvian Spanish, Russian are common).',
    'Translate everything to clear, natural English and fill the HR form. Write all output values in English.',
    'Only fill a field when the leader clearly said it. Use null (scores) or "" (text) when the transcript does not cover it. Never invent answers.',
    '',
    'Health check questions (score 1-5, 1 = strongly disagree/very dissatisfied, 5 = strongly agree/very satisfied):',
    Q.health.map(function (h) { return '- ' + h.key + ': ' + h.q + (h.workload ? ' (special scale: 1 = too low, 3 = balanced, 5 = risk of burnout)' : ''); }).join('\n'),
    '',
    'Retention: ' + Q.retentionQ + ' → "Yes", "Unsure", "No" or "".',
    'Open questions:',
    Q.open.map(function (o) { return '- ' + o.key + ': ' + o.q; }).join('\n'),
    '',
    'Concern categories: ' + CONCERN_CATEGORIES.join(', '),
    '',
    'Return JSON only, exactly this shape:',
    formOnly ? '{' : '{"english": "full English translation of the transcript' + (audio ? ', with HR:/Leader: labels' : '') + '",',
    audio ? ' "original": "transcript in the original spoken language(s), with HR:/Leader: labels",' : '',
    ' "scores": {' + Q.health.map(function (h) { return '"' + h.key + '": number|null'; }).join(', ') + '},',
    ' "reasons": {' + Q.health.map(function (h) { return '"' + h.key + '": "short reason or empty"'; }).join(', ') + '},',
    ' "retention": "Yes|Unsure|No|", "retentionReason": "",',
    ' "answers": {' + Q.open.map(function (o) { return '"' + o.key + '": ""'; }).join(', ') + '},',
    ' "positives": ["short positive feedback points"], "negatives": ["short negative feedback / pain points"],',
    ' "concerns": [{"category": "one of the categories", "description": "concern that needs HR follow-up"}],',
    ' "summary": "2-4 sentence HR summary of the call"}',
    '',
    formOnly ? 'TRANSCRIPT (already in English; do not repeat it in your answer):' : audio ? 'NOTES / LIVE CAPTIONS:' : 'TRANSCRIPT:',
    String(text || '').slice(0, 60000)
  ].join('\n');
  const parts = [{ text: prompt }];
  if (audio && audio.fileUri) parts.push({ file_data: { mime_type: audio.mimeType, file_uri: audio.fileUri } });
  else if (audio) parts.push({ inline_data: { mime_type: audio.mimeType, data: audio.data } });

  const call = function (m) {
    const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(m) + ':generateContent', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-goog-api-key': key },
      payload: JSON.stringify({
        contents: [{ role: 'user', parts: parts }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
      })
    });
    return { code: res.getResponseCode(), body: parseJson_(res.getContentText(), {}) };
  };
  let resp = call(model);
  if (resp.code !== 200) {
    // Google retires older models. If the error names a newer model, switch to it and remember it.
    const msg = (resp.body.error && resp.body.error.message) || '';
    const next = (msg.match(/models\/(gemini-[\w.\-]+)/g) || []).map(function (x) { return x.replace('models/', ''); })
      .filter(function (x) { return x !== model; })[0];
    if (next && /no longer available|deprecated|not found|retired|not supported/i.test(msg)) {
      resp = call(next);
      if (resp.code === 200) setSetting_('geminiModel', next);
    }
  }
  const code = resp.code;
  const body = resp.body;
  if (code !== 200) throw new Error((body.error && body.error.message) || ('HTTP ' + code));
  const out = (((body.candidates || [])[0] || {}).content || {}).parts;
  const raw = out && out[0] && out[0].text;
  const r = parseJson_(String(raw || '').replace(/^```json\s*|```$/g, ''), null);
  if (!r) throw new Error('Could not read the AI response');
  r.scores = r.scores || {}; r.reasons = r.reasons || {}; r.answers = r.answers || {};
  r.positives = r.positives || []; r.negatives = r.negatives || []; r.concerns = r.concerns || [];
  Object.keys(r.scores).forEach(function (k) {
    const n = Number(r.scores[k]);
    r.scores[k] = n >= 1 && n <= 5 ? Math.round(n) : null;
  });
  return r;
}

/* Long calls: the audio is uploaded in 8 MB parts to Gemini's temporary file storage, then transcribed
   5 minutes at a time (each request must finish within Apps Script's ~60 s limit), then the form is filled
   from the full English transcript, and the temporary file is deleted. */

function aiUploadStart(p) {
  requireAccess_();
  const key = getGeminiKey_();
  if (!key) throw new Error('Add the Gemini API key in Settings first');
  const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/upload/v1beta/files', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-goog-api-key': key, 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(p.size), 'X-Goog-Upload-Header-Content-Type': p.mime },
    payload: JSON.stringify({ file: { display_name: 'hr-1on1-call-audio' } })
  });
  const h = res.getAllHeaders();
  const url = h['x-goog-upload-url'] || h['X-Goog-Upload-URL'];
  if (!url) throw new Error('Could not start the upload: ' + res.getContentText().slice(0, 200));
  const token = Utilities.getUuid();
  CacheService.getUserCache().put('up_' + token, url, 21600);
  return token;
}

function aiUploadChunk(token, b64, offset, last) {
  requireAccess_();
  const url = CacheService.getUserCache().get('up_' + token);
  if (!url) throw new Error('Upload expired — please upload the file again');
  const bytes = Utilities.base64Decode(b64);
  const res = UrlFetchApp.fetch(url, {
    method: 'post', muteHttpExceptions: true, payload: bytes, contentType: 'application/octet-stream',
    headers: { 'X-Goog-Upload-Offset': String(offset), 'X-Goog-Upload-Command': last ? 'upload, finalize' : 'upload' }
  });
  if (res.getResponseCode() >= 300) throw new Error('Upload failed (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 200));
  if (!last) return { ok: true };
  let f = (parseJson_(res.getContentText(), {}) || {}).file;
  if (!f || !f.uri) throw new Error('Upload failed: ' + res.getContentText().slice(0, 200));
  const key = getGeminiKey_();
  for (let i = 0; i < 15 && f.state === 'PROCESSING'; i++) {
    Utilities.sleep(3000);
    f = parseJson_(UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/' + f.name, { headers: { 'x-goog-api-key': key }, muteHttpExceptions: true }).getContentText(), f);
  }
  if (f.state === 'FAILED') throw new Error('The AI could not read this audio file');
  return { name: f.name, uri: f.uri, mime: f.mimeType, ready: f.state !== 'PROCESSING' };
}

/** Transcribes one part (from/to in seconds) of an uploaded audio file. */
function aiTranscribePart(p) {
  requireAccess_();
  const key = getGeminiKey_();
  const ts = function (sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2); };
  const langName = (LANGUAGES.filter(function (l) { return l.code === p.language; })[0] || { name: 'the leader\'s language' }).name;
  const prompt = [
    'This audio is an HR 1:1 call. The HR officer speaks English; the leader may speak ' + langName + ' or mix languages.',
    'Transcribe ONLY the part of the audio from ' + ts(p.from) + ' to ' + ts(p.to) + ' (minutes:seconds). Ignore everything before and after.',
    'Label each turn "HR:" or "Leader:", one turn per line. Do not summarise; write what was said.',
    'Return JSON only: {"original": "transcript in the spoken language(s)", "english": "the same transcript translated to English", "ended": true if the audio ends before ' + ts(p.to) + ' otherwise false}.',
    'If nobody speaks in this part, return empty strings.'
  ].join('\n');
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }, { file_data: { mime_type: p.mime, file_uri: p.uri } }] }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json', maxOutputTokens: 16384 }
  });
  const call = function (m) {
    const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(m) + ':generateContent',
      { method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': key }, payload: body });
    return { code: res.getResponseCode(), body: parseJson_(res.getContentText(), {}) };
  };
  const model = geminiModel_();
  let r = call(model);
  if (r.code !== 200) {
    const msg = (r.body.error && r.body.error.message) || '';
    const next = (msg.match(/models\/(gemini-[\w.\-]+)/g) || []).map(function (x) { return x.replace('models/', ''); }).filter(function (x) { return x !== model; })[0];
    if (next && /no longer available|deprecated|not found|retired|not supported/i.test(msg)) { r = call(next); if (r.code === 200) setSetting_('geminiModel', next); }
  }
  if (r.code === 429) throw new Error('BUSY');
  if (r.code !== 200) throw new Error((r.body.error && r.body.error.message) || ('HTTP ' + r.code));
  const parts = (((r.body.candidates || [])[0] || {}).content || {}).parts;
  const out = parseJson_(String((parts && parts[0] && parts[0].text) || '').replace(/^```json\s*|```$/g, ''), null);
  if (!out) throw new Error('Could not read the AI answer for this part');
  return { original: String(out.original || '').trim(), english: String(out.english || '').trim(), ended: !!out.ended };
}

/** Fills the form from the full English transcript (no audio needed). */
function aiFillForm(p) {
  requireAccess_();
  const key = getGeminiKey_();
  if (!key) throw new Error('Add the Gemini API key in Settings first');
  const r = geminiAnalyze_(String(p.english || '').slice(0, 200000), p.language, p.leaderName, key, null, true);
  r.engine = 'gemini';
  delete r.english;
  return r;
}

function aiDeleteFile(name) {
  requireAccess_();
  if (!/^files\/[\w-]+$/.test(String(name))) return false;
  UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/' + name, { method: 'delete', headers: { 'x-goog-api-key': getGeminiKey_() }, muteHttpExceptions: true });
  return true;
}

/**
 * Context-aware translation with Gemini: understands Bisaya/Cebuano, Tagalog, Taglish, Vietnamese, Spanish, Russian,
 * slang and short spellings ("mn", "jud", "oi"). Cached for 6 hours so the same text isn't sent twice.
 */
function geminiTranslate_(text, source, key) {
  const cache = CacheService.getScriptCache();
  const ck = 'gtr_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8));
  const hit = cache.get(ck);
  if (hit !== null) return hit;
  const hint = source && source !== 'auto' && source !== 'en' ? (LANGUAGES.filter(function (l) { return l.code === source; })[0] || {}).name : '';
  const prompt = [
    'You translate notes from HR 1:1 check-in calls with team leaders (mostly in the Philippines and Vietnam, also Peru and Russia).',
    'The text can be Bisaya/Cebuano, Tagalog, Taglish, Vietnamese, Peruvian Spanish, Russian, or mixed with English.',
    'It is often casual chat: slang, short spellings (e.g. "mn" = man, "jud"/"gyud", "lng" = lang, "ko"/"nako"), missing accents, typos and jokes.',
    hint ? 'The leader usually speaks ' + hint + ', but detect the real language from the text.' : 'Detect the language from the text.',
    'Translate it into natural, clear English that keeps the exact meaning and tone (frustration, sarcasm, joking, politeness).',
    'Do not explain, add notes, or put quotes around it. Keep line breaks and any "HR:" / "Leader:" labels.',
    'If the text is already English, return it unchanged. Reply with the English translation only.',
    '',
    'TEXT:',
    text.slice(0, 20000)
  ].join('\n');
  const call = function (m) {
    const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(m) + ':generateContent', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': key },
      payload: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1 } })
    });
    return { code: res.getResponseCode(), body: parseJson_(res.getContentText(), {}) };
  };
  const model = geminiModel_();
  let r = call(model);
  if (r.code !== 200) {
    const msg = (r.body.error && r.body.error.message) || '';
    const next = (msg.match(/models\/(gemini-[\w.\-]+)/g) || []).map(function (x) { return x.replace('models/', ''); }).filter(function (x) { return x !== model; })[0];
    if (next && /no longer available|deprecated|not found|retired|not supported/i.test(msg)) { r = call(next); if (r.code === 200) setSetting_('geminiModel', next); }
  }
  if (r.code !== 200) throw new Error((r.body.error && r.body.error.message) || ('HTTP ' + r.code));
  const parts = (((r.body.candidates || [])[0] || {}).content || {}).parts || [];
  const out = parts.map(function (p) { return p.text || ''; }).join('').trim().replace(/^"(.*)"$/s, '$1');
  if (!out) throw new Error('Empty translation');
  try { if (out.length < 90000) cache.put(ck, out, 21600); } catch (e) {}
  return out;
}

function geminiModel_() {
  const saved = getSettingsMap_().geminiModel;
  return saved && saved !== 'gemini-2.5-flash' ? saved : CONFIG.DEFAULT_GEMINI_MODEL;
}

function getGeminiKey_() { return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || ''; }

/* ------------------------------------------------------------------ questions (HR can edit them in the app) */

/** The current question set: saved in Settings by HR, or the defaults. */
/* ------------------------------------------------------------------ questions: bank + rounds */
// Question types: rating (1–5 or 1–10), single (pick one), multi (pick all that apply), open (free text), section (a title only).
const Q_TYPES = ['rating', 'single', 'multi', 'open', 'section'];

/** Old question sets (health / retention / open) turned into the item list. Keys stay the same so old answers still match. */
function convertOldQ_(saved) {
  const d = { health: HEALTH, open: OPEN_QUESTIONS, retentionQ: RETENTION_Q, retentionFollowup: RETENTION_FOLLOWUP };
  saved = saved || d;
  const items = [{ id: 'sec_health', type: 'section', text: 'Health check' }];
  (saved.health || d.health).forEach(function (h) {
    if (h && h.key && h.q) items.push({ id: h.key, type: 'rating', label: h.label, text: h.q, scale: 5, balanced: !!h.workload, why: true, category: h.label,
      lowLabel: h.workload ? 'Too low' : '', highLabel: h.workload ? 'Risk of burnout' : '' });
  });
  items.push({ id: 'sec_open', type: 'section', text: 'Open questions' });
  items.push({ id: 'retention', type: 'single', label: 'Plan to stay', text: saved.retentionQ || d.retentionQ, options: ['Yes', 'Unsure', 'No'], category: 'Career path & pay' });
  items.push({ id: 'retentionFollowup', type: 'open', label: 'Plan to stay – why', text: saved.retentionFollowup || d.retentionFollowup, note: 'Ask this if the answer was No or Unsure.', allowFlag: true });
  (saved.open || d.open).forEach(function (o) { if (o && o.key && o.q) items.push({ id: o.key, type: 'open', text: o.q, allowFlag: true }); });
  return items.map(normItem_);
}
function normItem_(it) {
  const t = Q_TYPES.indexOf(it.type) >= 0 ? it.type : 'open';
  const clean = function (v, max) { return String(v == null ? '' : v).trim().slice(0, max || 500); };
  const id = String(it.id || '').replace(/[^\w]/g, '').slice(0, 40) || ('q' + Math.random().toString(36).slice(2, 9));
  const out = { id: id, type: t, text: clean(it.text, 600), label: clean(it.label, 80), note: clean(it.note, 400), category: clean(it.category, 60) };
  if (t !== 'section') out.required = !!it.required;
  if (t === 'rating') {
    out.scale = Number(it.scale) === 10 ? 10 : 5;
    out.lowLabel = clean(it.lowLabel, 40); out.highLabel = clean(it.highLabel, 40);
    out.balanced = !!it.balanced; out.why = it.why !== false;
    out.flagLow = Math.max(0, Math.min(out.scale - 1, Number(it.flagLow) || 0));
  }
  if (t === 'single' || t === 'multi') {
    out.options = (Array.isArray(it.options) ? it.options : String(it.options || '').split('\n')).map(function (o) { return clean(o, 120); }).filter(String).slice(0, 20);
    out.flagOptions = (it.flagOptions || []).map(String).filter(function (o) { return out.options.indexOf(o) >= 0; });
  }
  if (t === 'open') out.allowFlag = it.allowFlag !== false;
  return out;
}
function cleanItems_(list) {
  const seen = {};
  return (list || []).map(normItem_).filter(function (it) {
    if (seen[it.id] || !it.text) return false;
    if ((it.type === 'single' || it.type === 'multi') && it.options.length < 2) return false;
    seen[it.id] = true; return true;
  }).slice(0, 120);
}
/* Question sets: one card per role on the Questionnaire tab. Each set lists its questions and the groups that use it.
   A round keeps a snapshot of the picked questions per set: questionsByRound[round] = { sets: { setId: { name, groups, items } } }. */
function legacyRoundItems_(round) {
  const sm = getSettingsMap_();
  const byRound = parseJson_(sm.questionsByRound, {}) || {};
  const saved = (round && byRound[round]) || parseJson_(sm.questions, null);
  if (saved && Array.isArray(saved.items)) return saved.items.map(normItem_);
  return convertOldQ_(saved);
}
/** The sets of a round. Rounds saved before question sets had one list for everyone. */
function roundSets_(round) {
  const sm = getSettingsMap_();
  if (round === undefined) round = sm.currentRound || '';
  const saved = (parseJson_(sm.questionsByRound, {}) || {})[round];
  if (saved && saved.sets) {
    const out = {};
    Object.keys(saved.sets).forEach(function (k) { const v = saved.sets[k]; out[k] = { name: v.name || k, groups: v.groups || [], items: (v.items || []).map(normItem_) }; });
    return out;
  }
  return { all: { name: 'All roles', groups: [], items: legacyRoundItems_(round) } };
}
/** Which set of a round a group uses: the set listing that group, else a set for everyone, else the first set. */
function setForGroup_(sets, group) {
  const ids = Object.keys(sets);
  return ids.filter(function (k) { return (sets[k].groups || []).indexOf(group) >= 0; })[0] ||
    ids.filter(function (k) { return !(sets[k].groups || []).length; })[0] || ids[0];
}
/** Questions of a round. With a group: that group's set. Without: every set's questions together (for reports). */
function roundItems_(round, group) {
  const sets = roundSets_(round);
  if (group) { const k = setForGroup_(sets, group); return k ? sets[k].items : []; }
  const out = [], seen = {};
  Object.keys(sets).forEach(function (k) { sets[k].items.forEach(function (it) { if (!seen[it.id]) { seen[it.id] = true; out.push(it); } }); });
  return out;
}
/** The question sets on the Questionnaire tab. The first time, the questions already in use are copied into a set per role. */
function qsets_() {
  const sm = getSettingsMap_();
  const saved = parseJson_(sm.qsets, null);
  if (Array.isArray(saved) && saved.length) return saved.map(normSet_);
  let base = parseJson_(sm.qbank, null);
  if (!Array.isArray(base)) {
    base = []; const seen = {};
    const add = function (list) { list.forEach(function (it) { if (!seen[it.id]) { seen[it.id] = true; base.push(it); } }); };
    add(legacyRoundItems_(sm.currentRound || ''));
    parseJson_(sm.rounds, []).slice().reverse().forEach(function (r) { add(legacyRoundItems_(r)); });
  }
  base = base.map(normItem_);
  const named = ['Managers', 'Supervisors', 'Team Leaders', 'Assistants'];
  const sets = named.map(function (g) { return { id: 'set_' + g.toLowerCase().replace(/[^a-z]/g, ''), name: g, groups: [g], items: base }; });
  const rest = GROUPS.filter(function (g) { return named.indexOf(g) < 0; });
  if (rest.length) sets.push({ id: 'set_other', name: 'Other roles', groups: rest, items: base });
  return sets.map(normSet_);
}
function normSet_(st) {
  return { id: String(st.id || '').replace(/[^\w]/g, '').slice(0, 40) || ('set' + Math.random().toString(36).slice(2, 8)),
    name: String(st.name || '').trim().slice(0, 60) || 'Question set', groups: (st.groups || []).map(String).filter(String).slice(0, 30), items: cleanItems_(st.items || []) };
}
/** Old-style view of a round (used by scoring and older screens): the 1–5 ratings, the open questions and the retention question. */
function questions_(round, group) {
  const items = roundItems_(round, group);
  const ret = items.filter(function (i) { return i.id === 'retention'; })[0];
  const fu = items.filter(function (i) { return i.id === 'retentionFollowup'; })[0];
  return {
    items: items,
    health: items.filter(function (i) { return i.type === 'rating' && i.scale === 5; }).map(function (i) { return { key: i.id, label: i.label || i.text.slice(0, 40), q: i.text, workload: i.balanced }; }),
    open: items.filter(function (i) { return i.type === 'open' && i.id !== 'retentionFollowup'; }).map(function (i) { return { key: i.id, q: i.text }; }),
    retentionQ: ret ? ret.text : RETENTION_Q, retentionFollowup: fu ? fu.text : RETENTION_FOLLOWUP, script: SCRIPT
  };
}
function setRoundSets_(round, sets) {
  const byRound = parseJson_(getSettingsMap_().questionsByRound, {}) || {};
  byRound[round] = { sets: sets };
  setSetting_('questionsByRound', JSON.stringify(byRound));
  setSetting_('questionsVer', String(Date.now()));
}
/** One list for every set (used by the older "saveQuestions"). */
function setRoundItems_(round, items) {
  const sets = {};
  const cur = roundSets_(round);
  const ids = Object.keys(cur).filter(function (k) { return k !== 'all'; });
  if (ids.length) ids.forEach(function (k) { sets[k] = { name: cur[k].name, groups: cur[k].groups, items: items }; });
  else sets.all = { name: 'All roles', groups: [], items: items };
  setRoundSets_(round, sets);
}
function setRoundQuestions_(round, q) {
  setRoundItems_(round, q && Array.isArray(q.items) ? cleanItems_(q.items) : convertOldQ_(q));
}
function requireQEditor_() {
  requireAccess_();
  if (!isDev_(currentEmail_())) throw new Error('Only the HR admin or a Dev can change the questions.');
}
/** Saves all question sets (Questionnaire tab). Admin and Devs only. */
function saveSets(sets) {
  requireQEditor_();
  if (!Array.isArray(sets) || !sets.length) throw new Error('Keep at least one question set');
  const seen = {};
  const clean = sets.map(normSet_).filter(function (st) { if (seen[st.id]) return false; seen[st.id] = true; return true; }).slice(0, 20);
  withLock_(function () { setSetting_('qsets', JSON.stringify(clean)); setSetting_('questionsVer', String(Date.now())); });
  return getBootstrap();
}
/** Picks a round's questions per set: bySet = { setId: [question ids] } (kept in the set's order). */
function setRoundQuestionIds(round, bySet) {
  requireQEditor_();
  const rounds = parseJson_(getSettingsMap_().rounds, []);
  if (rounds.indexOf(round) < 0) throw new Error('Round not found');
  withLock_(function () { setRoundSets_(round, pickSets_(round, bySet)); });
  return getBootstrap();
}
function pickSets_(round, bySet) {
  if (Array.isArray(bySet)) { const all = {}; qsets_().forEach(function (st) { all[st.id] = bySet; }); bySet = all; }
  const cur = round ? roundSets_(round) : {};
  const out = {};
  qsets_().forEach(function (st) {
    const ids = ((bySet || {})[st.id] || []).map(String);
    const items = st.items.filter(function (b) { return ids.indexOf(b.id) >= 0; });
    const old = cur[st.id] ? cur[st.id].items : [];
    old.forEach(function (c) { if (ids.indexOf(c.id) >= 0 && !items.some(function (o) { return o.id === c.id; })) items.push(c); });
    if (items.some(function (i) { return i.type !== 'section'; })) out[st.id] = { name: st.name, groups: st.groups, items: items };
  });
  if (!Object.keys(out).length) throw new Error('Pick at least one question for the round');
  return out;
}

/** Saves the questions of one round (q.round). Pass {reset:true} to go back to the defaults. Admin and Devs only. */
function saveQuestions(q) {
  requireAccess_();
  if (!isDev_(currentEmail_())) throw new Error('Only the HR admin or a Dev can change the questions.');
  q = q || {};
  const round = String(q.round || getSettingsMap_().currentRound || '');
  if (!round) throw new Error('Pick a round first');
  withLock_(function () {
    if (q.reset) setRoundItems_(round, convertOldQ_(null));
    else {
      const clean = function (s, max) { return String(s || '').trim().slice(0, max || 500); };
      const key = function (k, p) { k = String(k || '').replace(/[^\w]/g, ''); return k || (p + Math.random().toString(36).slice(2, 8)); };
      const out = {
        health: (q.health || []).filter(function (h) { return clean(h.q); }).slice(0, 25).map(function (h) {
          return { key: key(h.key, 'h'), label: clean(h.label, 80) || clean(h.q, 40), q: clean(h.q), workload: !!h.workload };
        }),
        open: (q.open || []).filter(function (o) { return clean(o.q); }).slice(0, 25).map(function (o) { return { key: key(o.key, 'o'), q: clean(o.q) }; }),
        retentionQ: clean(q.retentionQ), retentionFollowup: clean(q.retentionFollowup),
        script: {
          opening: (q.script && q.script.opening || []).map(function (x) { return clean(x, 300); }).filter(String).slice(0, 15),
          closing: (q.script && q.script.closing || []).map(function (x) { return clean(x, 300); }).filter(String).slice(0, 15)
        }
      };
      if (!out.health.length && !out.open.length) throw new Error('Add at least one question');
      setRoundQuestions_(round, out);
    }
  });
  return getBootstrap();
}

/** Scores of a call as {questionKey: 1-5} (works for old and new calls). */
function scoreMap_(c) {
  const m = typeof c.scores === 'object' && c.scores ? c.scores : parseJson_(c.scores, {}) || {};
  HEALTH.forEach(function (h) { if (!m[h.key] && Number(c['s_' + h.key])) m[h.key] = Number(c['s_' + h.key]); });
  return m;
}

/* ------------------------------------------------------------------ scoring */

function sentimentFromScores_(c) {
  const sc = scoreMap_(c);
  const vals = questions_(c.round, c.group).health.map(function (h) {
    const v = Number(sc[h.key]);
    if (!v) return null;
    return h.workload ? 5 - 2 * Math.abs(v - 3) : v; // workload: 3 is best, 1 and 5 are bad
  }).filter(function (v) { return v !== null; });
  if (!vals.length) return '';
  const avg = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
  let s = avg >= 3.8 ? 'Positive' : avg <= 2.6 ? 'Negative' : 'Mixed';
  if (c.retention === 'No' && s === 'Positive') s = 'Mixed';
  return s;
}

/* ------------------------------------------------------------------ helpers */

function sheet_(name) {
  const sh = db_().getSheetByName(name);
  if (!sh) throw new Error('Storage is missing the "' + name + '" tab');
  return sh;
}
function tz_() { return Session.getScriptTimeZone() || 'Asia/Manila'; }
function nowIso_() { return Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd'T'HH:mm:ss"); }
function newId_(p) { return p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
// When the website calls the app, this holds the signed-in person's email (checked from their Google sign-in token).
let API_USER = '';
function currentEmail_() { if (API_USER) return API_USER; try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; } }

/* ------------------------------------------------------------------ Website API (GitHub Pages) */
// The website sends {fn, args, token} here. Deploy as Web app → Execute as: Me · Who has access: Anyone.
const API_PUBLIC = ['getPublicJobs', 'submitApplication'];
const API_BLOCKED = ['doGet', 'doPost'];
function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const fn = String(req.fn || ''), args = Array.isArray(req.args) ? req.args : [];
    const f = globalThis[fn];
    if (!/^[a-zA-Z]\w*$/.test(fn) || /_$/.test(fn) || API_BLOCKED.indexOf(fn) >= 0 || typeof f !== 'function') throw new Error('Unknown function: ' + fn);
    if (API_PUBLIC.indexOf(fn) < 0) API_USER = verifyIdToken_(req.token);
    out = { ok: true, v: f.apply(null, args) };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err), signin: !!(err && err.signin) };
  }
  API_USER = '';
  return ContentService.createTextOutput(JSON.stringify(out === undefined ? null : out)).setMimeType(ContentService.MimeType.JSON);
}
/** Checks a Google sign-in token from the website and returns the person's email. Checked tokens are remembered until they expire. */
function verifyIdToken_(token) {
  const fail = function (m) { const e = new Error(m); e.signin = true; return e; };
  if (!token) throw fail('Please sign in with Google.');
  if (!CONFIG.WEB_CLIENT_ID) throw new Error('The website is not set up yet: paste the OAuth Client ID into CONFIG.WEB_CLIENT_ID at the top of Code.gs.');
  const cache = CacheService.getScriptCache();
  const key = 'idt_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  const hit = cache.get(key);
  if (hit) return hit;
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  const j = parseJson_(res.getContentText(), {}) || {};
  if (res.getResponseCode() !== 200 || !j.email) throw fail('Your sign-in has expired. Please sign in again.');
  if (j.aud !== CONFIG.WEB_CLIENT_ID) throw fail('This sign-in is for another app. Please sign in again.');
  if (String(j.email_verified) !== 'true') throw fail('Your Google email is not verified.');
  const left = Number(j.exp) - Math.floor(Date.now() / 1000);
  if (!(left > 0)) throw fail('Your sign-in has expired. Please sign in again.');
  const email = String(j.email).toLowerCase();
  try { cache.put(key, email, Math.min(left, 21600)); } catch (e) {}
  return email;
}
/** The careers page (apply.html) on the website loads the open jobs from here. */
function getPublicJobs() {
  return { jobs: openJobs_(), sources: APPLY_SOURCES, locations: PIPE_LOCATIONS };
}
/** Calendar to read for the person using the app: their own when the app runs as them, otherwise their email. */
function myCal_() { return API_USER || 'primary'; }

function readAll_(name) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  const h = HEADERS[name];
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, h.length).getValues()
    .filter(function (r) { return r[0] !== ''; })
    .map(function (r) { const o = {}; h.forEach(function (k, i) { o[k] = norm_(r[i]); }); return o; });
}

/** Reads only some columns (in as few reads as possible). */
function readCols_(name, fields) {
  const sh = sheet_(name);
  const h = HEADERS[name];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const idx = fields.map(function (f) { return h.indexOf(f); }).filter(function (i) { return i >= 0; }).sort(function (a, b) { return a - b; });
  const runs = [];
  idx.forEach(function (i) { const r = runs[runs.length - 1]; if (r && r[1] === i - 1) r[1] = i; else runs.push([i, i]); });
  const rows = [];
  runs.forEach(function (r) {
    sh.getRange(2, r[0] + 1, last - 1, r[1] - r[0] + 1).getValues().forEach(function (row, n) {
      const o = rows[n] || (rows[n] = {});
      row.forEach(function (v, j) { o[h[r[0] + j]] = norm_(v); });
    });
  });
  return rows.filter(function (o) { return o.id; });
}

function norm_(x) {
  if (x instanceof Date) return Utilities.formatDate(x, tz_(), 'yyyy-MM-dd');
  return x === null || x === undefined ? '' : String(x);
}

function findById_(name, id) {
  if (!id) return null;
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return null;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); });
  const i = ids.indexOf(String(id));
  if (i < 0) return null;
  const h = HEADERS[name];
  const row = sh.getRange(i + 2, 1, 1, h.length).getValues()[0];
  const o = {};
  h.forEach(function (k, j) { o[k] = norm_(row[j]); });
  return o;
}

/** Insert or update by id. Fields left undefined keep their current value. */
function upsert_(name, obj) {
  const sh = sheet_(name);
  const h = HEADERS[name];
  const last = sh.getLastRow();
  const ids = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  const idx = ids.indexOf(String(obj.id));
  const rowNum = idx >= 0 ? idx + 2 : last + 1;
  const cur = idx >= 0 ? sh.getRange(rowNum, 1, 1, h.length).getValues()[0] : null;
  const row = h.map(function (k, i) {
    const v = obj[k];
    if (v === undefined) return cur ? cur[i] : '';
    if (v === null) return '';
    return typeof v === 'object' ? JSON.stringify(v) : v;
  });
  sh.getRange(rowNum, 1, 1, h.length).setNumberFormat('@').setValues([row]);
}

function deleteById_(name, id) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); });
  const idx = ids.indexOf(String(id));
  if (idx >= 0) sh.deleteRow(idx + 2);
}

// Settings are cached for speed. Every save changes the stamp, so an older cached copy is never used again.
function settingsStamp_() { return PropertiesService.getScriptProperties().getProperty('SETTINGS_STAMP') || '0'; }
function getSettingsMap_() {
  const cache = CacheService.getScriptCache();
  const key = 'settings_v6_' + settingsStamp_();
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const m = {};
  readAll_('Settings').forEach(function (r) { m[r.key] = r.value; });
  try { cache.put(key, JSON.stringify(m), 120); } catch (e) {}
  return m;
}
function freshSettings_() {
  const m = {};
  readAll_('Settings').forEach(function (r) { m[r.key] = r.value; });
  return m;
}
function setSetting_(key, value) {
  upsert_('Settings', { id: key, key: key, value: value });
  PropertiesService.getScriptProperties().setProperty('SETTINGS_STAMP', String(Date.now()) + Math.random().toString(36).slice(2, 6));
}

/** Only the admin (who opened the app first) and the HR team in Settings can use the app. */
/** Key Roles 1:1 requests: you must be on the HR team AND have the Key Roles 1:1 section switched on. */
function requireAccess_() {
  requireTeam_();
  const me = currentEmail_().toLowerCase();
  if (!hasCallAccess_(me)) throw new Error('You don\'t have access to the 1:1 call pages. Ask the HR admin to switch it on for you in Settings.');
}

/** Sections an HR person can open. The admin always has all of them; others get what the admin ticked (all, if never set). */
function modulesFor_(email) {
  const s = getSettingsMap_();
  const all = layout_(s).map(function (m) { return m.id; });
  const e = String(email || '').toLowerCase();
  if (!s.owner || e === String(s.owner).toLowerCase() || isDev_(e, s)) return all;
  const acc = parseJson_(s.hrAccess, {});
  return Array.isArray(acc[e]) ? acc[e].filter(function (id) { return all.indexOf(id) >= 0; }) : all;
}

/* ------------------------------------------------------------------ Dev role: sections and tabs */

/** Devs (the admin, plus anyone the admin ticks as Dev in Settings) can add, rename, reorder and delete sections and tabs. */
function isDev_(email, s) {
  s = s || getSettingsMap_();
  const e = String(email || '').toLowerCase();
  if (!s.owner || e === String(s.owner).toLowerCase()) return true;
  return splitEmails_(s.devs || '').indexOf(e) >= 0;
}
function requireDev_() {
  requireTeam_();
  if (!isDev_(currentEmail_())) throw new Error('Only a Dev can change sections and tabs. Ask the HR admin to tick "Dev" for you in Settings.');
}
function defaultLayout_() {
  return MODULES.map(function (m) {
    return { id: m.id, name: m.name, builtin: m.id === 'keyroles',
      tabs: m.id === 'keyroles' ? KEYROLES_TABS.map(function (t) { return { id: t.id, name: t.name, builtin: true }; }) : [{ id: 'main', name: 'Overview' }] };
  });
}
/** The sidebar sections and their top-bar tabs, as saved by a Dev (or the defaults). 1:1 Check-in and its 4 pages always exist. */
function layout_(s) {
  s = s || getSettingsMap_();
  const saved = parseJson_(s.layout, null);
  return cleanLayout_(Array.isArray(saved) ? saved : defaultLayout_());
}
function cleanLayout_(list) {
  // A tab you named "Questionnaire" (or similar) becomes the built-in question editor, the first time.
  list = JSON.parse(JSON.stringify(list || []));
  // A tab named "Directory" becomes the built-in directory, and an "Admin" tab next to it the admin list.
  const hasTab = function (id) { return list.some(function (m) { return m && (m.tabs || []).some(function (t) { return t && t.id === id; }); }); };
  if (!hasTab('directory')) list.some(function (m) { return m && (m.tabs || []).some(function (t) { if (t && /^\s*directory\s*$/i.test(String(t.name || ''))) { t.id = 'directory'; return true; } return false; }); });
  if (!hasTab('dirOverview')) list.forEach(function (m) {
    if (!m || !(m.tabs || []).some(function (t) { return t && t.id === 'directory'; })) return;
    (m.tabs || []).some(function (t) { if (t && /^\s*overview\s*$/i.test(String(t.name || ''))) { t.id = 'dirOverview'; return true; } return false; });
  });
  if (!hasTab('dirAdmin')) list.forEach(function (m) {
    if (!m || !(m.tabs || []).some(function (t) { return t && t.id === 'directory'; })) return;
    (m.tabs || []).some(function (t) { if (t && /^\s*admins?\s*$/i.test(String(t.name || ''))) { t.id = 'dirAdmin'; return true; } return false; });
  });
  // The first tab of a section named "Pipeline" becomes the built-in hiring pipeline.
  if (!hasTab('pipeline')) list.some(function (m) { if (m && /pipeline/i.test(String(m.name || '')) && (m.tabs || []).length && m.tabs[0]) { m.tabs[0].id = 'pipeline'; return true; } return false; });
  // The first tab of a section named "Birthdays" becomes the built-in birthday page.
  if (!hasTab('birthdays')) list.some(function (m) { if (m && /birthday/i.test(String(m.name || '')) && (m.tabs || []).length && m.tabs[0]) { m.tabs[0].id = 'birthdays'; return true; } return false; });
  const hasQ = list.some(function (m) { return m && (m.tabs || []).some(function (t) { return t && t.id === 'questions'; }); });
  if (!hasQ) list.some(function (m) { return m && (m.tabs || []).some(function (t) { if (t && /question/i.test(String(t.name || ''))) { t.id = 'questions'; return true; } return false; }); });
  const seen = {};
  const bseen = {};
  const KR_IDS = KEYROLES_TABS.map(function (k) { return k.id; });
  const out = [];
  (list || []).forEach(function (m) {
    if (!m || !LAYOUT_ID_RE.test(String(m.id)) || seen[m.id]) return;
    seen[m.id] = true;
    const tseen = {};
    const tabs = [];
    (Array.isArray(m.tabs) ? m.tabs : []).forEach(function (t) {
      if (!t || !LAYOUT_ID_RE.test(String(t.id)) || tseen[t.id]) return;
      // The 4 call pages (All Calls, People, Open Concerns, Summary) can sit in any section, but only once each.
      const builtin = KR_IDS.indexOf(String(t.id)) >= 0 || DIR_TABS.indexOf(String(t.id)) >= 0 || PIPE_TABS.indexOf(String(t.id)) >= 0;
      if (builtin && bseen[t.id]) return;
      tseen[t.id] = true; if (builtin) bseen[t.id] = true;
      tabs.push({ id: String(t.id), name: String(t.name || '').trim().slice(0, 40) || 'Untitled', builtin: builtin, hidden: !!t.hidden && builtin });
    });
    out.push({ id: String(m.id), name: String(m.name || '').trim().slice(0, 40) || 'Untitled', builtin: m.id === 'keyroles', tabs: tabs, parent: m.id === 'keyroles' ? '' : String(m.parent || '') });
  });
  // One level of sub-sections: a parent must exist, be top-level, and not be the section itself. 1:1 Check-in stays top-level.
  const top = {};
  out.forEach(function (m) { if (!m.parent) top[m.id] = true; });
  out.forEach(function (m) { if (!m.parent || m.id === 'keyroles' || m.parent === m.id || !top[m.parent]) m.parent = ''; });
  if (!seen.keyroles) out.unshift({ id: 'keyroles', name: '1:1 Check-in', builtin: true, tabs: [], parent: '' });
  const kr = out.find(function (m) { return m.id === 'keyroles'; });
  const home = out.find(function (m) { return m.tabs.some(function (t) { return t.id === 'overview'; }); }) || kr;
  KEYROLES_TABS.forEach(function (k) { if (!bseen[k.id]) (k.id === 'overview' ? kr : home).tabs.push({ id: k.id, name: k.name, builtin: true, hidden: false }); });
  return out.slice(0, 40);
}
/** True when one of your sections holds a call page (All Calls, People, Open Concerns or Summary). */
function hasCallAccess_(email) {
  const mine = modulesFor_(email);
  return layout_().some(function (m) { return mine.indexOf(m.id) >= 0 && m.tabs.some(function (t) { return KEYROLES_TABS.some(function (k) { return k.id === t.id; }); }); });
}
/** Save the whole sidebar/tab layout (Dev only). */
/** Saves the sidebar/tab layout (Dev only). baseVer is the version the change was made on: if someone saved
    a newer menu since (another window or another Dev), nothing is overwritten and the latest menu is sent back. */
function saveLayout(list, baseVer, note) {
  requireDev_();
  if (!Array.isArray(list)) throw new Error('Nothing to save.');
  const me = currentEmail_();
  let stale = false;
  withLock_(function () {
    const fresh = freshSettings_();
    if (baseVer && fresh.layoutVer && String(baseVer) !== String(fresh.layoutVer)) { stale = true; return; }
    const clean = cleanLayout_(list);
    // Keep the last 40 menus so any of them can be restored.
    const hist = parseJson_(fresh.layoutHistory, []) || [];
    const prev = parseJson_(fresh.layout, null);
    if (Array.isArray(prev)) hist.unshift({ at: fresh.layoutAt || '', by: fresh.layoutBy || '', note: fresh.layoutNote || '', layout: prev });
    setSetting_('layoutHistory', JSON.stringify(hist.slice(0, 40)));
    setSetting_('layout', JSON.stringify(clean));
    setSetting_('layoutVer', String(Date.now()));
    setSetting_('layoutAt', nowIso_());
    setSetting_('layoutBy', me);
    setSetting_('layoutNote', String(note || '').slice(0, 120));
  });
  const out = getLayout();
  out.stale = stale;
  return out;
}
/** Page look settings for everyone (Dev only), e.g. the Directory table width and which buttons are hidden. */
function saveUi(patch) {
  requireDev_();
  let ui = {};
  withLock_(function () {
    ui = parseJson_(freshSettings_().ui, {}) || {};
    Object.keys(patch || {}).forEach(function (k) { if (/^[\w]{1,40}$/.test(k)) ui[k] = patch[k]; });
    setSetting_('ui', JSON.stringify(ui).slice(0, 20000));
  });
  return ui;
}
/** The current menu (sections and tabs) with its version. */
function getLayout() {
  requireTeam_();
  const me = currentEmail_();
  const s = freshSettings_();
  return { modules: layout_(s), myModules: modulesFor_(me), callAccess: hasCallAccess_(me), layoutVer: s.layoutVer || '' };
}
/** Earlier menus, newest first (Dev only): [{at, by, note, layout}]. The first entry is the current menu. */
function getLayoutHistory() {
  requireDev_();
  const s = freshSettings_();
  const hist = parseJson_(s.layoutHistory, []) || [];
  const cur = { at: s.layoutAt || '', by: s.layoutBy || '', note: s.layoutNote || '', layout: layout_(s), current: true };
  return [cur].concat(hist.map(function (h) { return { at: h.at, by: h.by, note: h.note, layout: cleanLayout_(h.layout) }; }));
}

/** Only checks that you are on the HR team (used by Settings and the start-up screen). */
function requireTeam_() {
  const me = currentEmail_().toLowerCase();
  const s = getSettingsMap_();
  const owner = String(s.owner || '').toLowerCase();
  if (!owner) return; // brand-new app
  if (!me) throw new Error('Please sign in with your Google account to use HR Dashboard.');
  if (me !== owner && splitEmails_(s.hrEmails).indexOf(me) < 0) {
    throw new Error('Hi ' + me + ' — you don\'t have access to HR Dashboard yet. Ask the HR admin to add your email in Settings → HR team.');
  }
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function splitEmails_(s) {
  return String(s || '').split(/[\s,;]+/).map(function (e) { return e.trim().toLowerCase(); }).filter(function (e) { return e.indexOf('@') > 0; });
}
function listText_(v) { return Array.isArray(v) ? v.filter(String).join('\n') : String(v || ''); }
function clip_(s) { s = String(s || ''); return s.length > CONFIG.MAX_CELL ? s.slice(0, CONFIG.MAX_CELL) : s; }
function parseJson_(s, fallback) { try { return s ? JSON.parse(s) : fallback; } catch (e) { return fallback; } }

function chunk_(text, size) {
  if (text.length <= size) return [text];
  const out = [];
  let buf = '';
  text.split(/(\n+)/).forEach(function (part) {
    if ((buf + part).length > size && buf) { out.push(buf); buf = ''; }
    while (part.length > size) { out.push(part.slice(0, size)); part = part.slice(size); }
    buf += part;
  });
  if (buf.trim()) out.push(buf);
  return out;
}


/* ------------------------------------------------------------------ Directory (People section) */
// Columns as they appear in the Google Sheet. "Admin" holds the person's role (e.g. Managers, Supervisors, Team Leaders).
const DIR_COLS = [['uid', 'UID'], ['name', 'Name'], ['location', 'Location'], ['gender', 'Gender'], ['birthday', 'Birthday'], ['gmail', 'Gmail'],
  ['corporateEmail', 'Corporate Email'], ['startDate', 'Start Date'], ['status', 'Status'], ['admin', 'Admin'], ['notes', 'Notes'], ['phone', 'Phone Number']];
const DIR_SHEET_DEFAULT = '147W9CYr0T9HZxQc1LLlXhpzcKSVjoD23BFYaBBpANGY';
const DIR_SHEET_OLD = ['1zvZaBzqgUUtlzCkiompEPLLbvSmK93-k9Hjew36M2Og'];

/** You can use the directory if one of your sections holds the Directory or Admin tab. */
function requireDir_() {
  requireTeam_();
  const me = currentEmail_();
  const mine = modulesFor_(me);
  const ok = layout_().some(function (m) { return mine.indexOf(m.id) >= 0 && (/birthday/i.test(m.name) || m.tabs.some(function (t) { return DIR_TABS.indexOf(t.id) >= 0; })); });
  if (!ok) throw new Error('You don\'t have access to the Directory. Ask the HR admin to switch on its section for you in Settings.');
}
function dirSheetId_() {
  const v = String(getSettingsMap_().dirSheet || DIR_SHEET_DEFAULT);
  const m = v.match(/\/d\/([\w-]{20,})/);
  const id = m ? m[1] : v.trim();
  return DIR_SHEET_OLD.indexOf(id) >= 0 ? DIR_SHEET_DEFAULT : id;
}
function dirSyncInfo_() {
  const s = getSettingsMap_();
  const id = dirSheetId_();
  return { sheetId: id, sheetUrl: 'https://docs.google.com/spreadsheets/d/' + id + '/edit', auto: false,
    lastSync: s.dirLastSync || '', lastSyncBy: s.dirLastSyncBy || '', lastError: s.dirSyncError || '' };
}
function getDirectory() {
  requireDir_();
  const rows = readAll_('Directory').sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  return { rows: rows, sync: dirSyncInfo_() };
}
function dirDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  v = String(v || '').trim();
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = new Date(v);
  return isNaN(d) ? v : Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
}
function cleanDir_(p) {
  const t = function (v, n) { return String(v == null ? '' : v).trim().slice(0, n || 200); };
  return { uid: t(p.uid, 40), name: t(p.name, 120), location: t(p.location, 40), gender: t(p.gender, 40), birthday: dirDate_(p.birthday),
    gmail: t(p.gmail, 120).toLowerCase(), corporateEmail: t(p.corporateEmail, 120).toLowerCase(), startDate: dirDate_(p.startDate),
    phone: t(p.phone, 40), status: t(p.status, 40), admin: joinRoles_(splitRoles_(p.admin)), notes: t(p.notes, 2000) };
}
/** Adds or updates one person. Sends the directory to the Google Sheet afterwards when auto-sync is on. */
function saveDirPerson(p) {
  requireDir_();
  const c = cleanDir_(p || {});
  if (!c.name) throw new Error('Type the name');
  const now = nowIso_(), me = currentEmail_();
  withLock_(function () {
    const all = readAll_('Directory');
    if (c.uid && all.some(function (r) { return r.uid === c.uid && r.id !== p.id; })) throw new Error('UID ' + c.uid + ' is already in the directory');
    const ex = p.id ? all.filter(function (r) { return r.id === p.id; })[0] : null;
    c.id = ex ? ex.id : newId_('D'); c.updatedAt = now; c.updatedBy = me;
    if (!ex) c.createdAt = now;
    upsert_('Directory', c);
  });
  return dirAfterChange_();
}
/** The Admin column can hold several roles, e.g. "Supervisors, Team Leaders". */
function splitRoles_(v) {
  const out = [];
  String(v || '').split(/\s*[,;|]\s*/).forEach(function (x) {
    x = x.trim(); if (!x) return;
    const k = x.toLowerCase().replace(/s$/, '');
    const g = GROUPS.filter(function (y) { return y.toLowerCase().replace(/s$/, '') === k; })[0] || x;
    if (out.indexOf(g) < 0) out.push(g);
  });
  return out;
}
function joinRoles_(list) { return list.join(', ').slice(0, 200); }
/** Adds many people at once (pasted from a Google Sheet). People with the same UID (or the same name when there is no UID)
    are updated with the pasted values when update is true, otherwise left as they are. Written in one go. */
function bulkSaveDir(list, update, replace) {
  requireDir_();
  if (!Array.isArray(list) || !list.length) throw new Error('Nothing to add');
  if (list.length > 3000) throw new Error('Too many rows at once (max 3000)');
  const now = nowIso_(), me = currentEmail_();
  let added = 0, updated = 0, skipped = 0;
  withLock_(function () {
    const sh = sheet_('Directory'), h = HEADERS.Directory, last = sh.getLastRow();
    // Replace: start from an empty Directory, so only the pasted rows remain.
    const data = !replace && last >= 2 ? sh.getRange(2, 1, last - 1, h.length).getValues().filter(function (r) { return r[0] !== ''; }).map(function (r) { return r.map(norm_); }) : [];
    if (replace && last >= 2) sh.getRange(2, 1, last - 1, h.length).clearContent();
    const col = {}; h.forEach(function (k, i) { col[k] = i; });
    const byUid = {}, byName = {};
    data.forEach(function (r, i) { if (r[col.uid]) byUid[r[col.uid]] = i; byName[String(r[col.name]).toLowerCase()] = i; });
    list.forEach(function (p) {
      const c = cleanDir_(p || {});
      if (!c.name) { skipped++; return; }
      const i = c.uid ? byUid[c.uid] : byName[c.name.toLowerCase()];
      if (i !== undefined) {
        if (!update && !replace) { skipped++; return; }
        const r = data[i];
        DIR_COLS.forEach(function (k) { if (c[k[0]]) r[col[k[0]]] = c[k[0]]; });
        r[col.updatedAt] = now; r[col.updatedBy] = me;
        updated++;
      } else {
        const r = h.map(function () { return ''; });
        DIR_COLS.forEach(function (k) { r[col[k[0]]] = c[k[0]]; });
        r[col.id] = newId_('D'); r[col.createdAt] = now; r[col.updatedAt] = now; r[col.updatedBy] = me;
        data.push(r);
        if (c.uid) byUid[c.uid] = data.length - 1; byName[c.name.toLowerCase()] = data.length - 1;
        added++;
      }
    });
    if (data.length) {
      if (sh.getMaxRows() < data.length + 1) sh.insertRowsAfter(sh.getMaxRows(), data.length + 1 - sh.getMaxRows());
      sh.getRange(2, 1, data.length, h.length).setNumberFormat('@').setValues(data);
    }
  });
  const out = getDirectory(); out.added = added; out.updated = updated; out.skipped = skipped;
  return out;
}
/** Adds a role to (or, with mode 'remove', takes it from) everyone whose UID is in the list. Other roles they have stay.
    clearOthers (add mode) takes the role away from people who are not in the list. */
function bulkSetAdmin(uids, role, clearOthers, mode) {
  requireDir_();
  role = splitRoles_(role)[0] || '';
  if (!role) throw new Error('Pick a role');
  const remove = mode === 'remove';
  const want = {};
  (uids || []).forEach(function (u) { u = String(u || '').trim(); if (u) want[u] = true; });
  if (!Object.keys(want).length) throw new Error('Paste at least one UID');
  const now = nowIso_(), me = currentEmail_();
  let changed = 0, same = 0, cleared = 0;
  const found = {};
  withLock_(function () {
    const sh = sheet_('Directory'), h = HEADERS.Directory, last = sh.getLastRow();
    if (last < 2) return;
    const data = sh.getRange(2, 1, last - 1, h.length).getValues().map(function (r) { return r.map(norm_); });
    const ci = h.indexOf('uid'), ca = h.indexOf('admin'), cu = h.indexOf('updatedAt'), cb = h.indexOf('updatedBy');
    const touch = function (r, roles) { r[ca] = joinRoles_(roles); r[cu] = now; r[cb] = me; };
    data.forEach(function (r) {
      if (r[0] === '') return;
      const roles = splitRoles_(r[ca]), has = roles.indexOf(role) >= 0;
      if (want[r[ci]]) {
        found[r[ci]] = true;
        if (remove ? !has : has) { same++; return; }
        touch(r, remove ? roles.filter(function (x) { return x !== role; }) : roles.concat([role]));
        changed++;
      } else if (!remove && clearOthers && has) { touch(r, roles.filter(function (x) { return x !== role; })); cleared++; }
    });
    sh.getRange(2, 1, data.length, h.length).setNumberFormat('@').setValues(data);
  });
  const out = getDirectory();
  out.changed = changed; out.same = same; out.cleared = cleared;
  out.notFound = Object.keys(want).filter(function (u) { return !found[u]; });
  return out;
}
function deleteDirPerson(id) {
  requireDir_();
  withLock_(function () { deleteById_('Directory', id); });
  return dirAfterChange_();
}
/** Changes are only saved in the app; the Google Sheet is updated when someone clicks "Sync to Google Sheet". */
function dirAfterChange_() {
  return getDirectory();
}
function saveDirSync(p) {
  requireDir_();
  withLock_(function () {
    if (p.sheet !== undefined) setSetting_('dirSheet', String(p.sheet || '').trim() || DIR_SHEET_DEFAULT);
  });
  return getDirectory();
}
function openDirSheet_() {
  let ss;
  try { ss = SpreadsheetApp.openById(dirSheetId_()); }
  catch (e) { throw new Error('Could not open the Google Sheet. Check the link and that you can edit it (' + e.message + ')'); }
  const sh = ss.getSheets()[0];
  // Header row: keep the sheet's own column order; add any missing column at the end.
  const lastCol = Math.max(sh.getLastColumn(), 1);
  let head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  if (!head.some(String)) head = [];
  DIR_COLS.forEach(function (c) { if (!head.some(function (h) { return h.toLowerCase() === c[1].toLowerCase(); })) head.push(c[1]); });
  if (sh.getMaxColumns() < head.length) sh.insertColumnsAfter(sh.getMaxColumns(), head.length - sh.getMaxColumns());
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  sh.setFrozenRows(1);
  return { sh: sh, head: head };
}
function colOf_(head, label) { const l = label.toLowerCase(); for (let i = 0; i < head.length; i++) if (String(head[i]).toLowerCase() === l) return i; return -1; }
/** Writes the whole directory to the Google Sheet (first tab, below the header). */
function syncDirectory_() {
  const o = openDirSheet_(), sh = o.sh, head = o.head;
  const rows = readAll_('Directory').sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  const last = sh.getLastRow();
  // Clear only the directory columns, so any extra columns HR added in the sheet stay.
  DIR_COLS.forEach(function (c) { const i = colOf_(head, c[1]); if (i >= 0 && last > 1) sh.getRange(2, i + 1, last - 1, 1).clearContent(); });
  if (rows.length) {
    if (sh.getMaxRows() < rows.length + 1) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows());
    DIR_COLS.forEach(function (c) {
      const i = colOf_(head, c[1]); if (i < 0) return;
      const txt = c[0] === 'uid' || c[0] === 'notes';
      sh.getRange(2, i + 1, rows.length, 1).setValues(rows.map(function (r) {
        const v = r[c[0]] || '';
        return [txt && /^[=+\-@]/.test(v) ? "'" + v : v];
      }));
      if (c[0] === 'uid') sh.getRange(2, i + 1, rows.length, 1).setNumberFormat('@');
    });
  }
  setSetting_('dirLastSync', nowIso_()); setSetting_('dirLastSyncBy', currentEmail_()); setSetting_('dirSyncError', '');
  return rows.length;
}
/** Sends the directory to the Google Sheet now, plus every other page's data, each to its own tab. */
function syncDirectoryToSheet() {
  requireDir_();
  let n = 0, tabs = [], skipped = [];
  try {
    n = syncDirectory_();
    const r = syncOtherTabs_();
    tabs = r.tabs; skipped = r.skipped;
  }
  catch (e) { setSetting_('dirSyncError', e.message); throw e; }
  const out = getDirectory(); out.synced = n; out.tabs = tabs; out.skipped = skipped;
  return out;
}
// The tabs written next to People. [tab name, page check, rows, columns [field, header]].
function exportTabs_() {
  const rec = function (key) { return function () { return readAll_(REC_SHEETS[key]).map(function (r) { const o = parseJson_(r.data, {}) || {}; o.updatedAt = r.updatedAt; return o; }); }; };
  const page = function (key) { return function () { requirePage_(key); }; };
  const byDate = function (k, desc) { return function (a, b) { const x = String(a[k] || ''), y = String(b[k] || ''); return desc ? y.localeCompare(x) : x.localeCompare(y); }; };
  const stageName = { applied: 'Applied', screening: 'Screening', interview: 'Interview', tasks: 'Candidate Tasks', offer: 'Offer', hired: 'Hired' };
  return [
    ['Pipeline', requirePipe_, function () { return readAll_('Candidates').map(function (c) { c.stageName = stageName[c.stage] || c.stage; c.recruiterName = c.recruiter ? (hrNameOf_(c.recruiter) || c.recruiter) : (c.online === 'Yes' ? 'Applied online' : ''); return c; }).sort(byDate('appliedAt', true)); },
      [['firstName', 'First Name'], ['lastName', 'Last Name'], ['gender', 'Gender'], ['birthDate', 'Birth Date'], ['email', 'Email'], ['phone', 'Phone'], ['source', 'Source'], ['location', 'Location'],
       ['jobTitle', 'Applying for'], ['stageName', 'Stage'], ['status', 'Status'], ['rejectReason', 'Reject Reason'], ['recruiterName', 'Added by'], ['appliedAt', 'Applied'], ['interviewDate', 'Interview Date'], ['interviewTime', 'Interview Time'],
       ['tasksDate', 'Candidate Tasks Date'], ['accountAt', 'Account Created'], ['taskResult', 'Tasks Result'], ['hiredAt', 'Hired'], ['resumeUrl', 'Resume'], ['notes', 'Notes']]],
    ['Job Posts', requirePipe_, function () { return readAll_('Jobs'); },
      [['title', 'Job Title'], ['location', 'Location'], ['type', 'Type'], ['status', 'Status'], ['description', 'About the job'], ['requirements', 'What we are looking for'], ['createdAt', 'Created']]],
    ['Onboarding', page('onboarding'), function () { return rec('onboarding')().sort(byDate('startDate', true)); },
      [['name', 'Name'], ['uid', 'UID'], ['gender', 'M/F'], ['email', 'Email'], ['office', 'Office'], ['startDate', 'Start Date / Candidate Tasks'], ['status', 'Onboarding Status'],
       ['personalFolder', 'Personal Folder (ID, CV, Speed Test)'], ['contracts', 'Contracts & Documents Tracker'], ['trialContract', 'Signed Trial Contract'], ['bankInfo', 'Bank Info'], ['fpTeam', 'FP Team Data'],
       ['survey', 'Confidential Information Survey'], ['verificationCall', 'Verification Call']]],
    ['Verification', page('verification'), function () { return rec('verification')().sort(byDate('dateAdded', true)); },
      [['name', 'Name'], ['uid', 'UID'], ['trLab', 'Tr Lab'], ['dateAdded', 'Date Added'], ['status', 'Status'], ['callDate', 'Verification Call Date'], ['recording', 'Recording Link'],
       ['id1Type', 'ID 1 Type'], ['id1Result', 'ID 1 Result'], ['id2Type', 'ID 2 Type'], ['id2Result', 'ID 2 Result'], ['hireStatus', 'Hire Status'], ['hireSource', 'Hire Source']]],
    ['Tr Lab Check In', page('trlab'), function () { return rec('trlab')().sort(byDate('callDate', true)); },
      [['groupId', 'Group ID'], ['name', 'Name'], ['uid', 'UID'], ['callDate', 'Call Date'], ['duration', 'Duration (mins)'], ['comments', 'Comments']]],
    ['Leave Requests', page('leave'), function () { return rec('leave')().sort(byDate('start', true)); },
      [['type', 'Type'], ['name', 'Requested by'], ['uid', 'UID'], ['location', 'Location'], ['start', 'Start'], ['return', 'Return'], ['reason', 'Reason'], ['processedBy', 'Processed by'],
       ['status', 'Status'], ['postLink', 'Post Link #leave-form-request'], ['accessLink', 'Access Deactivation Link #contract-e'], ['notes', 'Notes'], ['tracking', 'STATUS (update to stop reminder)']]],
    ['Undertime', page('undertime'), function () { const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return rec('undertime')().sort(function (a, b) { return String(b.month || '').localeCompare(String(a.month || '')) || (Number(a.hours) || 0) - (Number(b.hours) || 0); })
        .map(function (r) { if (/^\d{4}-\d{2}$/.test(r.month || '')) r.month = M[Number(r.month.slice(5)) - 1] + ' ' + r.month.slice(0, 4); return r; }); },
      [['month', 'Month Year'], ['cutoff', 'Cutoff Period'], ['name', 'Name'], ['uid', 'UID'], ['location', 'Location'], ['team', 'Team'], ['hours', 'Tracked Hours (0.00 h)'], ['caseCount', 'Case Count'],
       ['elena', 'Elena'], ['status', 'Status'], ['reason', 'Reason'], ['hr', 'HR'], ['hrNotes', 'HR Notes'], ['workflow', 'Workflow Notes']]],
    ['Paused Contracts', page('paused'), function () { return rec('paused')().sort(byDate('resume')); },
      [['name', 'Name'], ['uid', 'UID'], ['country', 'Country'], ['contractType', 'Contract Type'], ['level', 'Level'], ['leaveStart', 'Leave Start Date'], ['resume', 'Work Resume Date'],
       ['reason', 'Reason'], ['status', 'Status'], ['comments', 'Comments'], ['followUp', 'For follow up (MR)']]],
    ['Community Posts', page('posts'), function () { return readAll_('Posts').map(function (p) { p.ownerName = p.owner ? (hrNameOf_(p.owner) || p.owner) : ''; return p; }).sort(byDate('postDate', true)); },
      [['postDate', 'Post Date'], ['topic', 'Topic'], ['channel', 'Channel'], ['ownerName', 'Who posts'], ['status', 'Status'], ['postedAt', 'Posted at'], ['link', 'Slack link'], ['details', 'Message']]],
    ['Drafter Check-in', page('drafter'), function () { return readAll_('DrafterCalls').map(function (c) { c.hrName = c.conductedBy ? (hrNameOf_(c.conductedBy) || c.conductedBy) : ''; return c; }).sort(byDate('createdAt', true)); },
      [['name', 'Name'], ['uid', 'UID'], ['location', 'Location'], ['email', 'Email'], ['reason', 'Reason'], ['status', 'Status'], ['schedDate', 'Call Date'], ['schedTime', 'Time'], ['mins', 'Minutes'],
       ['hrName', 'HR'], ['meetUrl', 'Meet link'], ['notes', 'Call notes'], ['doneAt', 'Done at'], ['createdAt', 'Added']]],
    ['1on1 Calls', requireAccess_, function () { return readCols_('Calls', ['round', 'leaderName', 'group', 'status', 'schedDate', 'schedTime', 'conductedBy', 'callDate', 'durationMins', 'language'])
        .map(function (c) { c.hrName = c.conductedBy ? (hrNameOf_(c.conductedBy) || c.conductedBy) : ''; return c; }).sort(byDate('schedDate', true)); },
      [['round', 'Round'], ['leaderName', 'Name'], ['group', 'Group'], ['status', 'Status'], ['schedDate', 'Scheduled Date'], ['schedTime', 'Scheduled Time'], ['hrName', 'HR'], ['callDate', 'Call Date'], ['durationMins', 'Duration (mins)'], ['language', 'Language']]]
  ];
}
function hrNameOf_(email) {
  const e = String(email || '').toLowerCase();
  const h = hrTeam_(getSettingsMap_()).filter(function (x) { return x.email === e; })[0];
  return h ? h.name : '';
}
/** Writes each page's data to its own tab of the People sheet. These tabs are rewritten on every sync. */
function syncOtherTabs_() {
  const ss = SpreadsheetApp.openById(dirSheetId_());
  const tabs = [], skipped = [];
  exportTabs_().forEach(function (t) {
    try { t[1](); } catch (e) { skipped.push(t[0]); return; }
    const rows = t[2](), cols = t[3];
    const sh = ss.getSheetByName(t[0]) || ss.insertSheet(t[0]);
    const values = [cols.map(function (c) { return c[1]; })].concat(rows.map(function (r) {
      return cols.map(function (c) {
        let v = r[c[0]];
        if (v === true) v = 'TRUE'; else if (v === false) v = 'FALSE';
        v = String(v == null ? '' : v).slice(0, 45000);
        return /^[=+\-@]/.test(v) ? "'" + v : v;
      });
    }));
    sh.clearContents();
    if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
    if (sh.getMaxRows() < values.length) sh.insertRowsAfter(sh.getMaxRows(), values.length - sh.getMaxRows());
    sh.getRange(1, 1, values.length, cols.length).setNumberFormat('@').setValues(values);
    sh.getRange(1, 1, 1, cols.length).setFontWeight('bold');
    sh.setFrozenRows(1);
    tabs.push({ name: t[0], n: rows.length });
  });
  return { tabs: tabs, skipped: skipped };
}
/** Reads rows from the Google Sheet into the directory: rows with a known UID update that person, new ones are added. */
function pullDirectoryFromSheet() {
  requireDir_();
  const o = openDirSheet_(), sh = o.sh, head = o.head;
  const last = sh.getLastRow();
  let added = 0, updated = 0;
  if (last > 1) {
    const vals = sh.getRange(2, 1, last - 1, head.length).getValues();
    const now = nowIso_(), me = currentEmail_();
    withLock_(function () {
      const all = readAll_('Directory');
      const byUid = {}, byName = {};
      all.forEach(function (r) { if (r.uid) byUid[r.uid] = r; byName[String(r.name).toLowerCase()] = r; });
      vals.forEach(function (row) {
        const p = {};
        DIR_COLS.forEach(function (c) { const i = colOf_(head, c[1]); p[c[0]] = i >= 0 ? row[i] : ''; });
        const c = cleanDir_(p);
        if (!c.name) return;
        const ex = (c.uid && byUid[c.uid]) || (!c.uid && byName[c.name.toLowerCase()]);
        c.id = ex ? ex.id : newId_('D'); c.updatedAt = now; c.updatedBy = me;
        if (ex) { if (DIR_COLS.every(function (k) { return String(ex[k[0]] || '') === String(c[k[0]] || ''); })) return; updated++; }
        else { c.createdAt = now; added++; }
        upsert_('Directory', c);
        if (c.uid) byUid[c.uid] = c; byName[c.name.toLowerCase()] = c;
      });
    });
  }
  const out = getDirectory(); out.added = added; out.updated = updated;
  return out;
}


/* ------------------------------------------------------------------ Recruitment › Pipeline (candidates) */
// Stages, in order. A rejected candidate keeps its stage and gets status "Rejected".
const PIPE_STAGES = ['applied', 'screening', 'interview', 'tasks', 'offer', 'hired'];

/** You can use the pipeline if one of your sections holds the Pipeline page. */
function requirePipe_() {
  requireTeam_();
  const mine = modulesFor_(currentEmail_());
  const ok = layout_().some(function (m) { return mine.indexOf(m.id) >= 0 && (/pipeline/i.test(m.name) || m.tabs.some(function (t) { return PIPE_TABS.indexOf(t.id) >= 0; })); });
  if (!ok) throw new Error('You don\'t have access to the hiring pipeline. Ask the HR admin to switch on Recruitment › Pipeline for you in Settings.');
}
function getCandidates() {
  requirePipe_();
  const s = getSettingsMap_(), me = currentEmail_();
  const hidden = hiddenStagesFor_(me, s);
  const out = { rows: readAll_('Candidates').filter(function (c) { return hidden.indexOf(c.stage) < 0; }), me: me, stages: PIPE_STAGES, hidden: hidden,
    jobs: readAll_('Jobs'), applyUrl: s.applyUrl || '', canManage: isDev_(me, s) };
  if (out.canManage) out.pipeHidden = parseJson_(s.pipeHidden, {}) || {};
  return out;
}
/** Kanban columns hidden from one HR person. The admin always sees every column. */
function hiddenStagesFor_(email, s) {
  s = s || getSettingsMap_();
  const e = String(email || '').toLowerCase();
  if (!s.owner || e === String(s.owner).toLowerCase()) return [];
  const m = parseJson_(s.pipeHidden, {}) || {};
  return (m[e] || []).filter(function (k) { return PIPE_STAGES.indexOf(k) >= 0; });
}
/** Stops someone from changing a candidate in a column they can't see. */
function requireStage_(stage) {
  if (hiddenStagesFor_(currentEmail_()).indexOf(stage) >= 0) throw new Error('You don\'t have access to that column of the pipeline.');
}
/** Admin and Devs: which columns each HR person can't see. map = { email: ['applied', …] } */
function savePipeAccess(map) {
  requireDev_();
  const team = hrTeam_(getSettingsMap_()).map(function (h) { return h.email; });
  const clean = {};
  Object.keys(map || {}).forEach(function (e) {
    const k = String(e).toLowerCase();
    const v = (map[e] || []).filter(function (x) { return PIPE_STAGES.indexOf(x) >= 0; });
    if (team.indexOf(k) >= 0 && v.length) clean[k] = v;
  });
  setSetting_('pipeHidden', JSON.stringify(clean));
  return getCandidates();
}
function cleanCand_(p) {
  const t = function (v, n) { return String(v == null ? '' : v).trim().slice(0, n || 200); };
  return { firstName: t(p.firstName, 60), lastName: t(p.lastName, 60), gender: t(p.gender, 30), birthDate: dirDate_(p.birthDate),
    email: t(p.email, 120).toLowerCase(), phone: t(p.phone, 40), source: t(p.source, 60), location: t(p.location, 60),
    resumeUrl: t(p.resumeUrl, 500), resumeName: t(p.resumeName, 200), notes: t(p.notes, 3000), jobId: t(p.jobId, 40), jobTitle: t(p.jobTitle, 120) };
}
/** Adds a candidate (stage Applied) or saves the details of one. */
function saveCandidate(p) {
  requirePipe_();
  p = p || {};
  const c = cleanCand_(p);
  c.jobTitle = jobTitleOf_(c.jobId);
  if (!c.firstName || !c.lastName) throw new Error('Type the first and last name');
  if (c.email && !/^[^@\s]+@gmail\.com$/.test(c.email)) throw new Error('Use a Gmail address (name@gmail.com)');
  const now = nowIso_(), me = currentEmail_();
  withLock_(function () {
    const all = readAll_('Candidates');
    if (c.email && all.some(function (r) { return r.email === c.email && r.id !== p.id && r.status !== 'Removed'; })) throw new Error(c.email + ' is already in the pipeline');
    const ex = p.id ? all.filter(function (r) { return r.id === p.id; })[0] : null;
    if (ex) { requireStage_(ex.stage); Object.keys(c).forEach(function (k) { ex[k] = c[k]; }); ex.updatedAt = now; ex.updatedBy = me; upsert_('Candidates', ex); }
    else {
      requireStage_('applied');
      c.id = newId_('C'); c.stage = 'applied'; c.status = 'Active'; c.recruiter = me;
      c.appliedAt = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); c.stageAt = now; c.createdAt = now; c.updatedAt = now; c.updatedBy = me;
      upsert_('Candidates', c);
    }
  });
  return getCandidates();
}
/** One action on a candidate: move {stage}, schedule {interviewDate, interviewTime}, tasks {tasksDate, tasksTime, move},
    account, pass, fail, reject {reason}, restore, hire. */
function candidateAction(id, action, d) {
  requirePipe_();
  d = d || {};
  const now = nowIso_(), me = currentEmail_(), today = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  withLock_(function () {
    const c = readAll_('Candidates').filter(function (r) { return r.id === id; })[0];
    if (!c) throw new Error('Candidate not found — refresh the page');
    requireStage_(c.stage);
    const go = function (stage) { if (PIPE_STAGES.indexOf(stage) < 0) throw new Error('Unknown stage'); c.stage = stage; c.stageAt = now; };
    if (action === 'move') go(String(d.stage));
    else if (action === 'schedule') { c.interviewDate = dirDate_(d.interviewDate); c.interviewTime = String(d.interviewTime || '').slice(0, 5); if (c.stage === 'applied' || c.stage === 'screening') go('interview'); }
    else if (action === 'tasks') { c.tasksDate = dirDate_(d.tasksDate); c.tasksTime = String(d.tasksTime || '').slice(0, 5); if (d.move) go('tasks'); }
    else if (action === 'account') { c.accountAt = now; c.accountBy = me; }
    else if (action === 'pass') { c.taskResult = 'Pass'; go('offer'); }
    else if (action === 'fail') { c.taskResult = 'Fail'; c.status = 'Rejected'; c.rejectReason = 'Failed the candidate tasks'; }
    else if (action === 'reject') { c.status = 'Rejected'; c.rejectReason = String(d.reason || '').slice(0, 300); }
    else if (action === 'restore') { c.status = 'Active'; c.rejectReason = ''; if (c.taskResult === 'Fail') c.taskResult = ''; }
    else if (action === 'hire') { go('hired'); c.hiredAt = today; }
    else throw new Error('Unknown action');
    c.updatedAt = now; c.updatedBy = me;
    upsert_('Candidates', c);
  });
  return getCandidates();
}
function deleteCandidate(id) {
  requirePipe_();
  withLock_(function () {
    const c = readAll_('Candidates').filter(function (r) { return r.id === id; })[0];
    if (c) requireStage_(c.stage);
    deleteById_('Candidates', id);
  });
  return getCandidates();
}
/** Saves a resume file to Drive (next to the app's data spreadsheet when possible) and shares it with the HR team. */
function uploadResume(name, mime, b64) {
  requirePipe_();
  return saveResume_(name, mime, b64);
}
function saveResume_(name, mime, b64) {
  const bytes = Utilities.base64Decode(String(b64 || ''));
  if (!bytes.length) throw new Error('The file is empty');
  if (bytes.length > 10 * 1024 * 1024) throw new Error('The file is bigger than 10 MB');
  const blob = Utilities.newBlob(bytes, mime || 'application/octet-stream', String(name || 'resume').slice(0, 150));
  let folder = null;
  try {
    const parents = DriveApp.getFileById(db_().getId()).getParents();
    const parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
    const it = parent.getFoldersByName('HR Dashboard · Resumes');
    folder = it.hasNext() ? it.next() : parent.createFolder('HR Dashboard · Resumes');
  } catch (e) { folder = DriveApp.getRootFolder(); }
  const file = folder.createFile(blob);
  try { file.addViewers(hrTeam_(getSettingsMap_()).map(function (h) { return h.email; }).filter(function (e) { return e && e !== currentEmail_(); })); } catch (e) {}
  return { url: file.getUrl(), name: file.getName() };
}
/* ---------------- Job posts and the public application page */
const PIPE_LOCATIONS = ['India, Bengaluru', 'Peru, Lima', 'Vietnam, Hanoi', 'Vietnam, Ho Chi Minh', 'Georgia, Batumi'];
const APPLY_SOURCES = ['Social Media', 'Job Portal / Career Website', 'Friend / Colleague Referral', 'Recruiter Direct Email'];
function jobTitleOf_(id) { const j = id ? readAll_('Jobs').filter(function (r) { return r.id === id; })[0] : null; return j ? j.title : ''; }
/** Adds or edits a job post. */
function saveJob(p) {
  requirePipe_();
  p = p || {};
  const t = function (v, n) { return String(v == null ? '' : v).trim().slice(0, n); };
  const j = { title: t(p.title, 120), location: t(p.location, 80), type: t(p.type, 40), description: t(p.description, 8000), requirements: t(p.requirements, 8000), status: p.status === 'Closed' ? 'Closed' : 'Open' };
  if (!j.title) throw new Error('Type the job title');
  const now = nowIso_(), me = currentEmail_();
  withLock_(function () {
    const ex = p.id ? readAll_('Jobs').filter(function (r) { return r.id === p.id; })[0] : null;
    if (ex) { Object.keys(j).forEach(function (k) { ex[k] = j[k]; }); ex.updatedAt = now; ex.updatedBy = me; upsert_('Jobs', ex); }
    else { j.id = newId_('J'); j.createdAt = now; j.updatedAt = now; j.updatedBy = me; upsert_('Jobs', j); }
  });
  return getCandidates();
}
function deleteJob(id) {
  requirePipe_();
  withLock_(function () { deleteById_('Jobs', id); });
  return getCandidates();
}
/** The address of the public application page (the second deployment: Execute as Me · Anyone). */
function saveApplyUrl(url) {
  requirePipe_();
  url = String(url || '').trim().split('?')[0].split('#')[0];
  if (url && !/^https:\/\/script\.google\.com\/.+\/exec$/.test(url) && !/^https:\/\/[^\s]+\.html$/.test(url)) throw new Error('Paste the Web app URL that ends with /exec, or the link to apply.html on your website');
  setSetting_('applyUrl', url);
  return getCandidates();
}
/** True when this copy of the app runs as its owner (the public deployment). Then visitors who are not signed in see the job page. */
function applyMode_() {
  try { return Session.getEffectiveUser().getEmail() !== Session.getActiveUser().getEmail(); } catch (e) { return false; }
}
function openJobs_() {
  return readAll_('Jobs').filter(function (j) { return j.status !== 'Closed'; })
    .map(function (j) { return { id: j.id, title: j.title, location: j.location, type: j.type, description: j.description, requirements: j.requirements }; });
}
function applyPage_(jobId) {
  const t = HtmlService.createTemplateFromFile('Apply');
  let boot;
  try { boot = { jobs: openJobs_(), job: String(jobId || ''), sources: APPLY_SOURCES, locations: PIPE_LOCATIONS }; }
  catch (err) { boot = { error: 'The job page is not available right now. Please try again later.' }; }
  t.boot = JSON.stringify(boot).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return t.evaluate().setTitle('Apply · DocuSketch Careers').addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
/** Called by the public application page. It runs as the app's owner, so applicants need no access to anything. */
function submitApplication(p) {
  p = p || {};
  if (p.website) return { ok: true }; // a hidden field that only bots fill in
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('apply_count') || 0);
  if (n > 300) throw new Error('Too many applications right now. Please try again in an hour.');
  const jobs = openJobs_();
  const job = jobs.filter(function (j) { return j.id === p.jobId; })[0];
  if (!job) throw new Error('This job is no longer open. Please refresh the page.');
  const c = cleanCand_(p);
  if (!c.firstName || !c.lastName) throw new Error('Please type your first and last name.');
  if (!/^[^@\s]+@gmail\.com$/.test(c.email)) throw new Error('Please use a Gmail address (name@gmail.com).');
  if (!c.phone) throw new Error('Please type your phone number.');
  if (PIPE_LOCATIONS.indexOf(c.location) < 0) throw new Error('Please select your location.');
  if (APPLY_SOURCES.indexOf(c.source) < 0) throw new Error('Please tell us how you heard about us.');
  if (!p.resumeB64) throw new Error('Please attach your resume.');
  withLock_(function () {
    if (readAll_('Candidates').some(function (r) { return r.email === c.email && r.jobId === job.id; })) throw new Error('You have already applied for this job with ' + c.email + '.');
  });
  const f = saveResume_(String(c.firstName + ' ' + c.lastName + ' - ' + (p.resumeName || 'resume')).slice(0, 150), p.resumeMime, p.resumeB64);
  const now = nowIso_();
  withLock_(function () {
    c.id = newId_('C'); c.stage = 'applied'; c.status = 'Active'; c.recruiter = '';
    c.resumeUrl = f.url; c.resumeName = f.name; c.jobId = job.id; c.jobTitle = job.title; c.online = 'Yes';
    c.appliedAt = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); c.stageAt = now; c.createdAt = now; c.updatedAt = now; c.updatedBy = 'Application form';
    upsert_('Candidates', c);
  });
  try { cache.put('apply_count', String(n + 1), 3600); } catch (e) {}
  return { ok: true, job: job.title };
}

/** Adds a hired candidate to People › Directory (status Active, start date = hired date). */
function addCandidateToDirectory(id) {
  requirePipe_();
  const now = nowIso_(), me = currentEmail_();
  let dirId = '';
  withLock_(function () {
    const c = readAll_('Candidates').filter(function (r) { return r.id === id; })[0];
    if (!c) throw new Error('Candidate not found');
    const name = (c.firstName + ' ' + c.lastName).trim();
    const ex = readAll_('Directory').filter(function (r) { return (c.email && r.gmail === c.email) || String(r.name).toLowerCase() === name.toLowerCase(); })[0];
    if (ex) dirId = ex.id;
    else {
      const d = cleanDir_({ name: name, gender: c.gender, birthday: c.birthDate, gmail: c.email, phone: c.phone, location: c.location, startDate: c.hiredAt, status: 'Active', notes: 'From the hiring pipeline' + (c.source ? ' · source: ' + c.source : '') });
      d.id = newId_('D'); d.createdAt = now; d.updatedAt = now; d.updatedBy = me;
      upsert_('Directory', d); dirId = d.id;
    }
    c.dirId = dirId; c.updatedAt = now; c.updatedBy = me;
    upsert_('Candidates', c);
  });
  const out = getCandidates(); out.dirId = dirId;
  return out;
}


/* ------------------------------------------------------------------ pages found by their section name */
// A section (or one of its tabs) with one of these names gets the matching page.
const PAGE_KEYS = [
  ['posts', /community\s*post/i], ['drafter', /drafter/i],
  ['onboarding', /^\s*onboarding/i], ['verification', /verification/i], ['trlab', /tr\.?\s*lab/i],
  ['leave', /leave/i], ['undertime', /undertime/i], ['paused', /pause/i]
];
function requirePage_(key) {
  requireTeam_();
  const re = PAGE_KEYS.filter(function (k) { return k[0] === key; })[0];
  if (!re) throw new Error('Unknown page');
  const mine = modulesFor_(currentEmail_());
  const ok = layout_().some(function (m) { return mine.indexOf(m.id) >= 0 && (re[1].test(m.name) || m.tabs.some(function (t) { return re[1].test(t.name); })); });
  if (!ok) throw new Error('You don\'t have access to this page. Ask the HR admin to switch it on for you in Settings.');
}
/** One time: Onboarding, Verification and Tr Lab Check-in move from Newbies to Recruitment. */
function moveNewbiePagesToRecruitment_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('move_newbies_v1')) return;
  const me = currentEmail_();
  if (!isDev_(me)) return;
  withLock_(function () {
    const fresh = freshSettings_();
    const list = parseJson_(fresh.layout, null);
    if (!Array.isArray(list)) { props.setProperty('move_newbies_v1', '1'); return; }
    const rec = list.filter(function (m) { return m && !m.parent && /recruit/i.test(String(m.name)); })[0];
    const newb = list.filter(function (m) { return m && !m.parent && /newbie/i.test(String(m.name)); })[0];
    if (!rec || !newb) { props.setProperty('move_newbies_v1', '1'); return; }
    let moved = 0;
    list.forEach(function (m) { if (m && m.parent === newb.id && /^\s*(onboarding|verification|tr\.?\s*lab)/i.test(String(m.name))) { m.parent = rec.id; moved++; } });
    if (moved) {
      const hist = parseJson_(fresh.layoutHistory, []) || [];
      hist.unshift({ at: fresh.layoutAt || '', by: fresh.layoutBy || '', note: fresh.layoutNote || '', layout: parseJson_(fresh.layout, []) });
      setSetting_('layoutHistory', JSON.stringify(hist.slice(0, 40)));
      setSetting_('layout', JSON.stringify(cleanLayout_(list)));
      setSetting_('layoutVer', String(Date.now()));
      setSetting_('layoutAt', nowIso_()); setSetting_('layoutBy', me); setSetting_('layoutNote', 'Moved Onboarding, Verification and Tr Lab Check-in to Recruitment');
    }
    props.setProperty('move_newbies_v1', '1');
  });
}

/* ---------------- Team Care › Community Posts (the weekly #random post) */
function getPosts() {
  requirePage_('posts');
  return { rows: readAll_('Posts'), me: currentEmail_() };
}
function savePost(p) {
  requirePage_('posts');
  p = p || {};
  const t = function (v, n) { return String(v == null ? '' : v).trim().slice(0, n); };
  const x = { topic: t(p.topic, 200), details: t(p.details, 8000), postDate: dirDate_(p.postDate), channel: t(p.channel, 60) || '#random', owner: t(p.owner, 120).toLowerCase() };
  if (!x.topic) throw new Error('Type the topic');
  if (!x.postDate) throw new Error('Pick the date it should be posted');
  const now = nowIso_(), me = currentEmail_();
  withLock_(function () {
    const ex = p.id ? readAll_('Posts').filter(function (r) { return r.id === p.id; })[0] : null;
    if (ex) { Object.keys(x).forEach(function (k) { ex[k] = x[k]; }); ex.updatedAt = now; ex.updatedBy = me; upsert_('Posts', ex); }
    else { x.id = newId_('P'); x.status = 'Planned'; x.createdAt = now; x.updatedAt = now; x.updatedBy = me; upsert_('Posts', x); }
  });
  return getPosts();
}
/** action: posted {link} | unpost */
function postAction(id, action, d) {
  requirePage_('posts');
  d = d || {};
  const now = nowIso_(), me = currentEmail_();
  withLock_(function () {
    const x = readAll_('Posts').filter(function (r) { return r.id === id; })[0];
    if (!x) throw new Error('Post not found — refresh the page');
    if (action === 'posted') { x.status = 'Posted'; x.postedAt = now; x.postedBy = me; x.link = String(d.link || '').trim().slice(0, 500); }
    else if (action === 'unpost') { x.status = 'Planned'; x.postedAt = ''; x.postedBy = ''; }
    else throw new Error('Unknown action');
    x.updatedAt = now; x.updatedBy = me;
    upsert_('Posts', x);
  });
  return getPosts();
}
function deletePost(id) {
  requirePage_('posts');
  withLock_(function () { deleteById_('Posts', id); });
  return getPosts();
}

/* ---------------- Team Care › Drafter Check-in (random 1:1 calls) */
function getDrafterCalls() {
  requirePage_('drafter');
  const people = readCols_('Directory', ['id', 'uid', 'name', 'location', 'gmail', 'corporateEmail', 'status'])
    .filter(function (r) { return r.name && !/resign|terminat|left/i.test(r.status || ''); })
    .map(function (r) { return { id: r.id, uid: r.uid, name: r.name, location: r.location, email: r.gmail || r.corporateEmail || '', status: r.status }; })
    .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  return { rows: readAll_('DrafterCalls'), people: people, me: currentEmail_(), targetMins: Number(getSettingsMap_().targetMins) || CONFIG.DEFAULT_TARGET_MINS };
}
/** Adds a person to the list with the reason for the call. */
function addDrafterCall(p) {
  requirePage_('drafter');
  p = p || {};
  const person = readAll_('Directory').filter(function (r) { return r.id === p.dirId; })[0];
  if (!person) throw new Error('Pick a person from People');
  const reason = String(p.reason || '').trim().slice(0, 2000);
  if (!reason) throw new Error('Type the reason for the 1:1 call');
  const now = nowIso_(), me = currentEmail_();
  let id = '';
  withLock_(function () {
    const c = { id: newId_('DC'), dirId: person.id, name: person.name, uid: person.uid, email: person.gmail || person.corporateEmail || '', location: person.location,
      reason: reason, status: 'To schedule', conductedBy: String(p.hr || me).toLowerCase(), createdAt: now, updatedAt: now, updatedBy: me };
    upsert_('DrafterCalls', c); id = c.id;
  });
  const out = getDrafterCalls(); out.newId = id;
  return out;
}
function editDrafterCall(id, p) {
  requirePage_('drafter');
  p = p || {};
  withLock_(function () {
    const c = readAll_('DrafterCalls').filter(function (r) { return r.id === id; })[0];
    if (!c) throw new Error('Not found — refresh the page');
    if (p.reason != null) c.reason = String(p.reason).trim().slice(0, 2000);
    if (p.notes != null) c.notes = String(p.notes).trim().slice(0, 8000);
    if (p.hr) c.conductedBy = String(p.hr).toLowerCase();
    c.updatedAt = nowIso_(); c.updatedBy = currentEmail_();
    upsert_('DrafterCalls', c);
  });
  return getDrafterCalls();
}
/** Schedules (or moves) the call: a Google Calendar event with a Meet link, and the person is invited. */
function scheduleDrafterCall(id, p) {
  requirePage_('drafter');
  p = p || {};
  if (!p.date || !p.time) throw new Error('Pick a date and time');
  const c = readAll_('DrafterCalls').filter(function (r) { return r.id === id; })[0];
  if (!c) throw new Error('Not found — refresh the page');
  const mins = Number(p.mins) || Number(c.mins) || Number(getSettingsMap_().targetMins) || CONFIG.DEFAULT_TARGET_MINS;
  const start = Utilities.parseDate(p.date + ' ' + p.time, tz_(), 'yyyy-MM-dd HH:mm');
  const end = new Date(start.getTime() + mins * 60000);
  let meetError = '', ev = null;
  try {
    if (c.eventId) ev = calendar_('patch', c.eventId, { start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } }, { sendUpdates: c.email ? 'all' : 'none' });
    else ev = calendar_('insert', '', {
      summary: 'HR 1:1 — ' + c.name,
      description: 'HR 1:1 check-in.\nJoin with the Google Meet link. You can speak in the language you are most comfortable with.',
      start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() },
      attendees: c.email ? [{ email: c.email }] : [],
      conferenceData: { createRequest: { requestId: Utilities.getUuid(), conferenceSolutionKey: { type: 'hangoutsMeet' } } }
    }, { conferenceDataVersion: 1, sendUpdates: c.email ? 'all' : 'none' });
  } catch (e) { meetError = e.message; }
  withLock_(function () {
    const x = readAll_('DrafterCalls').filter(function (r) { return r.id === id; })[0];
    x.status = 'Scheduled'; x.schedDate = p.date; x.schedTime = p.time; x.mins = String(mins);
    if (ev) { x.eventId = ev.id || x.eventId; x.meetUrl = ev.hangoutLink || x.meetUrl; }
    if (p.hr) x.conductedBy = String(p.hr).toLowerCase();
    x.updatedAt = nowIso_(); x.updatedBy = currentEmail_();
    upsert_('DrafterCalls', x);
  });
  const out = getDrafterCalls(); out.meetError = meetError;
  return out;
}
/** action: done {notes} | cancel | reopen */
function drafterCallAction(id, action, d) {
  requirePage_('drafter');
  d = d || {};
  let calNote = '';
  withLock_(function () {
    const c = readAll_('DrafterCalls').filter(function (r) { return r.id === id; })[0];
    if (!c) throw new Error('Not found — refresh the page');
    if (action === 'done') { c.status = 'Done'; c.doneAt = nowIso_(); if (d.notes != null) c.notes = String(d.notes).trim().slice(0, 8000); if (d.reason != null) c.reason = String(d.reason).trim().slice(0, 2000); }
    else if (action === 'cancel') {
      if (c.eventId) { try { meetDelete_(c.eventId); } catch (e) { calNote = 'The Calendar event could not be removed — delete it in Google Calendar.'; } }
      c.status = 'To schedule'; c.eventId = ''; c.meetUrl = ''; c.schedDate = ''; c.schedTime = '';
    }
    else if (action === 'reopen') { c.status = c.schedDate ? 'Scheduled' : 'To schedule'; c.doneAt = ''; }
    else throw new Error('Unknown action');
    c.updatedAt = nowIso_(); c.updatedBy = currentEmail_();
    upsert_('DrafterCalls', c);
  });
  const out = getDrafterCalls(); out.note = calNote;
  return out;
}
function deleteDrafterCall(id) {
  requirePage_('drafter');
  let calNote = '';
  withLock_(function () {
    const c = readAll_('DrafterCalls').filter(function (r) { return r.id === id; })[0];
    if (c && c.eventId && c.status !== 'Done') { try { meetDelete_(c.eventId); } catch (e) { calNote = 'The Calendar event could not be removed — delete it in Google Calendar.'; } }
    deleteById_('DrafterCalls', id);
  });
  const out = getDrafterCalls(); out.note = calNote;
  return out;
}

/* ---------------- Table pages stored in the app (Onboarding, Verification, Tr Lab, Leave, Undertime, Paused) */
// Each page keeps its rows in its own tab of the app's storage; a row's fields are saved as JSON in "data".
const REC_SHEETS = { onboarding: 'Onboarding', verification: 'Verification', trlab: 'TrLabCalls', leave: 'LeaveRequests', undertime: 'Undertime', paused: 'PausedContracts' };
function recSheet_(key) { const n = REC_SHEETS[key]; if (!n) throw new Error('Unknown page'); return n; }
function cleanRec_(d) {
  const out = {};
  Object.keys(d || {}).slice(0, 60).forEach(function (k) {
    if (!/^[a-zA-Z0-9_]{1,40}$/.test(k) || k === 'id') return;
    const v = d[k];
    out[k] = typeof v === 'boolean' ? v : String(v == null ? '' : v).slice(0, 5000);
  });
  return out;
}
function getRecords(key) {
  requirePage_(key);
  const rows = readAll_(recSheet_(key)).map(function (r) {
    const o = parseJson_(r.data, {}) || {};
    o.id = r.id; o.createdAt = r.createdAt; o.updatedAt = r.updatedAt; o.updatedBy = r.updatedBy;
    return o;
  });
  return { key: key, rows: rows };
}
function saveRecord(key, rec) {
  requirePage_(key);
  rec = rec || {};
  const name = recSheet_(key), now = nowIso_(), me = currentEmail_();
  const data = JSON.stringify(cleanRec_(rec));
  let id = rec.id;
  withLock_(function () {
    const ex = id ? readCols_(name, ['id']).some(function (r) { return r.id === id; }) : false;
    if (ex) upsert_(name, { id: id, data: data, updatedAt: now, updatedBy: me });
    else { id = newId_('R'); upsert_(name, { id: id, data: data, createdAt: now, updatedAt: now, updatedBy: me }); }
  });
  const out = getRecords(key); out.savedId = id;
  return out;
}
function deleteRecord(key, id) {
  requirePage_(key);
  withLock_(function () { deleteById_(recSheet_(key), id); });
  return getRecords(key);
}
/** Adds many rows at once (from "Paste rows"). */
function importRecords(key, list) {
  requirePage_(key);
  if (!Array.isArray(list) || !list.length) throw new Error('Nothing to add');
  if (list.length > 5000) throw new Error('Paste at most 5,000 rows at a time');
  const name = recSheet_(key), now = nowIso_(), me = currentEmail_(), h = HEADERS[name];
  withLock_(function () {
    const sh = sheet_(name), start = sh.getLastRow() + 1;
    const rows = list.map(function (d) { const o = { id: newId_('R'), data: JSON.stringify(cleanRec_(d)), createdAt: now, updatedAt: now, updatedBy: me }; return h.map(function (k) { return o[k] || ''; }); });
    if (sh.getMaxRows() < start + rows.length) sh.insertRowsAfter(sh.getMaxRows(), start + rows.length - sh.getMaxRows());
    sh.getRange(start, 1, rows.length, h.length).setNumberFormat('@').setValues(rows);
  });
  const out = getRecords(key); out.added = list.length;
  return out;
}
