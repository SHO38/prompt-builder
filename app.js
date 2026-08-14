// ── 設定 ───────────────────────────────────────────────────────
const WORKER_URL = 'https://prompt-builder.corgi-orchestra-account.workers.dev';

const GEMINI_MODELS = [
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', desc: '標準・無料枠' },
  { id: 'gemini-3.6-flash',      label: 'Gemini 3.6 Flash',      desc: '高品質・無料枠' },
];

// ── 状態管理 ────────────────────────────────────────────────────
const state = {
  mode:        'image',
  modelId:     'anima',
  people:      [mkPerson()],
  form:        {},
  activeCat:   'character',
  idea:        '',
  aiModel:     'gemini-3.5-flash-lite',
  aiPrompt:    '',
  eng:         '',
  showEng:     false,
  editEng:     false,
  variations:  [],
  activeVar:   0,
  loading:     false,
  history:     [],
  templates:   {},
  activeTpl:   {},
  loras:       [],          // 利用可能なLoRAリスト
  selectedLoras: [],        // 選択中のLoRA IDリスト
};

function getModels()  { return state.mode === 'image' ? IMG_MODELS : VID_MODELS; }
function getModel()   {
  var m = Object.assign({}, getModels()[state.modelId] || Object.values(getModels())[0]);
  // 画像モデルは共通タブ・multiPerson有効。動画モデルは個別タブをそのまま使う
  if (state.mode === 'image') {
    m.cats = ANIMA_SCENE_CATS;
    m.multiPerson = true;
  }
  return m;
}

// ── 派生値 ─────────────────────────────────────────────────────
// 選択中LoRAのトリガーワードを取得
function getLoraText() {
  if (!state.selectedLoras.length) return '';
  return state.selectedLoras.map(function(id) {
    var lora = state.loras.find(function(l){ return l.id === id; });
    return lora ? lora.triggerWords : '';
  }).filter(Boolean).join(', ');
}

function getJaPrompt() {
  if (state.aiPrompt) return state.aiPrompt;
  if (state.variations.length) return state.variations[state.activeVar] || '';
  var rawModel = getModels()[state.modelId] || Object.values(getModels())[0];
  var base;
  if (state.modelId === 'anima') {
    base = rawModel.build({ ...state.form, people: state.people });
  } else {
    // 非Animaモデルは共通フォームから統一ビルド
    base = commonBuild(state.form);
  }
  var lora = getLoraText();
  return lora ? base + '\n' + lora : base;
}

function getPromptText() {
  const src = state.showEng ? state.eng : getJaPrompt();
  return src.split('\n').filter(function(l){ return l.trim(); }).join('\n');
}

function getNeg() {
  const neg = state.form.negative;
  return (neg && neg.text ? neg.text : '').trim();
}

function hasInput() {
  if (state.idea.trim()) return true;
  const model = getModel();
  if (model.multiPerson && state.people.some(function(p){
    return Object.entries(p).some(function(kv){ return kv[0] !== 'gender' && Array.isArray(kv[1]) && kv[1].length > 0; });
  })) return true;
  return Object.values(state.form).some(function(v){
    return (v.chips && v.chips.length > 0) || (v.text && v.text.trim());
  });
}

// ── API 呼び出し ─────────────────────────────────────────────────
async function apiCall(path, method, body) {
  method = method || 'GET';
  const opts = { method: method, headers: {} };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(WORKER_URL + path, opts);
  if (!res.ok) throw new Error('API error: ' + res.status);
  return res.json();
}

async function loadTemplates() {
  try {
    const data = await apiCall('/api/templates?model=' + getModel().id);
    const grouped = {};
    (data.templates || []).forEach(function(t) {
      if (!grouped[t.category]) grouped[t.category] = [];
      grouped[t.category].push(t);
    });
    state.templates = grouped;
    renderTemplateBar();
  } catch(e) {
    console.warn('テンプレート読み込み失敗:', e.message);
  }
}

async function loadHistory() {
  try {
    const data = await apiCall('/api/history');
    state.history = data.history || [];
    renderHistory();
  } catch(e) {
    console.warn('履歴読み込み失敗:', e.message);
  }
}

async function loadLoras() {
  try {
    const data = await apiCall('/api/loras?model=' + state.modelId);
    state.loras = data.loras || [];
    state.selectedLoras = [];
    renderLoraPanel();
  } catch(e) {
    state.loras = [];
    renderLoraPanel();
  }
}

async function saveHistory(prompt, negative, lang) {
  try {
    await apiCall('/api/history', 'POST', {
      prompt: prompt, negative: negative, model: state.modelId, lang: lang
    });
  } catch(e) { console.warn('履歴保存失敗:', e.message); }
}

// ── 生成・変換 ───────────────────────────────────────────────────
function getFS() {
  const parts = [];
  const model = getModel();
  if (model.multiPerson) {
    state.people.forEach(function(p, i) {
      const label = ['1人目','2人目','3人目','4人目'][i];
      const feats = [p.gender].concat(p.expression||[]).concat(p.hair||[]).concat(p.eyes||[]).filter(Boolean);
      if (feats.length) parts.push(label + 'キャラ: ' + feats.join('、'));
      const outfit = [].concat(p.outfit||[]).concat(p.accessory||[]);
      if (outfit.length) parts.push(label + '服装: ' + outfit.join('、'));
    });
  }
  model.cats.forEach(function(cat) {
    cat.fields.forEach(function(f) {
      const v = state.form[f.key];
      const chips = (v && v.chips) || [];
      const text  = (v && v.text && v.text.trim()) ? v.text.trim() : '';
      const vals  = chips.concat(text ? [text] : []);
      if (vals.length) parts.push(f.label + ': ' + vals.join('、'));
    });
  });
  return parts.join('\n');
}

async function generate() {
  if (!hasInput() || state.loading) return;
  state.loading = true;
  state.variations = [];
  resetLang();
  renderOutputPanel();
  setBtnLoading('btn-generate', true);
  try {
    const model = getModel();
    const prompt = mkGenPrompt(model, state.idea.trim(), getFS(), state.people);
    const data = await apiCall('/api/generate', 'POST', { prompt: prompt, model: state.aiModel });
    state.aiPrompt = data.text || '';
    await saveHistory(state.aiPrompt, getNeg(), 'JA');
    state.history.unshift({ prompt: state.aiPrompt, model: state.modelId, lang: 'JA', date: new Date().toISOString() });
    state.history = state.history.slice(0, 10);
  } catch(e) { alert('生成に失敗しました: ' + e.message); }
  finally {
    state.loading = false;
    setBtnLoading('btn-generate', false);
    renderOutputPanel();
    renderHistory();
  }
}

async function generateVariations() {
  if (!getJaPrompt().trim() || state.loading) return;
  state.loading = true;
  setBtnLoading('btn-variation', true);
  const prompt = '以下のプロンプトをベースに、スタイル・ムード・シーンを変えた別バリエーションを3つ作成してください（改行構造を保持）。\n\nベース:\n' +
    getJaPrompt() + '\n\n以下のJSON形式のみ返してください:\n{"variations":["バリエーション1","バリエーション2","バリエーション3"]}';
  try {
    const data = await apiCall('/api/generate', 'POST', { prompt: prompt, model: state.aiModel });
    const j = JSON.parse(data.text || '{}');
    if (j.variations) { state.variations = j.variations; state.activeVar = 0; state.aiPrompt = ''; resetLang(); }
  } catch(e) { alert('バリエーション生成に失敗しました: ' + e.message); }
  finally {
    state.loading = false;
    setBtnLoading('btn-variation', false);
    renderOutputPanel();
    renderVariationTabs();
  }
}

async function translate() {
  const ja = getJaPrompt();
  if (!ja.trim() || state.loading) return;
  state.loading = true;
  state.editEng = false;
  setBtnLoading('btn-translate', true);
  try {
    const model = getModel();
    const prompt = mkTranslatePrompt(model, ja);
    const data = await apiCall('/api/translate', 'POST', { prompt: prompt, model: state.aiModel });
    state.eng     = data.text || '';
    state.showEng = true;
    await saveHistory(state.eng, getNeg(), 'EN');
    state.history.unshift({ prompt: state.eng, model: state.modelId, lang: 'EN', date: new Date().toISOString() });
    state.history = state.history.slice(0, 10);
  } catch(e) { alert('翻訳に失敗しました: ' + e.message); }
  finally {
    state.loading = false;
    setBtnLoading('btn-translate', false);
    renderOutputPanel();
    renderHistory();
  }
}

function copyPrompt() {
  const text = getPromptText();
  if (!text) return;
  navigator.clipboard.writeText(text).then(function(){ flashBtn('btn-copy', 'コピー済み ✓'); });
}

function copyNeg() {
  const text = getNeg();
  if (!text) return;
  navigator.clipboard.writeText(text).then(function(){ flashBtn('btn-copy-neg', 'コピー済み ✓'); });
}

function flashBtn(id, label) {
  const btn = document.getElementById(id);
  if (!btn) return;
  const orig = btn.innerHTML;
  btn.innerHTML = label;
  btn.classList.add('copied');
  setTimeout(function(){ btn.innerHTML = orig; btn.classList.remove('copied'); }, 2000);
}

function setBtnLoading(id, loading) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = loading;
  if (id === 'btn-generate')  btn.innerHTML = loading ? '<i class="ti ti-refresh spin"></i> 生成中…'  : '<i class="ti ti-sparkles"></i> AIでプロンプト生成';
  if (id === 'btn-variation') btn.innerHTML = loading ? '<i class="ti ti-refresh spin"></i> 生成中…'  : '<i class="ti ti-copy-check"></i> バリエーション';
  if (id === 'btn-translate') btn.innerHTML = loading ? '<i class="ti ti-refresh spin"></i> 変換中…'  : '<i class="ti ti-language"></i> 英語に変換';
}

function resetLang() { state.eng = ''; state.showEng = false; state.editEng = false; }
function resetAll()  { state.aiPrompt = ''; state.variations = []; state.activeVar = 0; resetLang(); }

function switchMode(newMode) {
  state.mode      = newMode;
  state.modelId   = Object.keys(newMode === 'image' ? IMG_MODELS : VID_MODELS)[0];
  state.people    = [mkPerson()];
  state.form      = {};
  state.idea      = '';
  state.activeTpl = {};
  state.activeCat = getModel().cats[0] ? getModel().cats[0].id : 'character';
  resetAll();
  document.getElementById('idea-input').value = '';
  renderAll();
  loadTemplates();
}

function switchModel(modelId) {
  state.modelId   = modelId;
  state.people    = [mkPerson()];
  state.form      = {};
  state.idea      = '';
  state.activeTpl = {};
  state.activeCat = getModel().cats[0] ? getModel().cats[0].id : 'character';
  state.selectedLoras = [];
  resetAll();
  document.getElementById('idea-input').value = '';
  renderAll();
  loadTemplates();
  loadLoras();
}

function clearAll() {
  state.people    = [mkPerson()];
  state.form      = {};
  state.idea      = '';
  state.activeTpl = {};
  resetAll();
  document.getElementById('idea-input').value = '';
  renderAll();
}

function renderAll() {
  renderModeAndModelTabs();
  updateHintBar();
  renderCatTabs();
  renderCatContent();
  renderTemplateBar();
  renderLoraPanel();
  renderOutputPanel();
  renderVariationTabs();
  renderHistory();
}

// ── チップ操作 ───────────────────────────────────────────────────
function toggleChip(key, chip, single) {
  const cur = (state.form[key] && state.form[key].chips) || [];
  const next = single ? (cur.indexOf(chip)>=0?[]:[chip]) : (cur.indexOf(chip)>=0?cur.filter(function(c){return c!==chip;}):[...cur,chip]);
  state.form[key] = Object.assign({}, state.form[key]||{text:''}, {chips:next});
  resetAll();
  updateChipUI(key);
  renderOutputPanel();
}

function setNegText(text) {
  state.form.negative = { chips: [], text: text };
  renderOutputPanel();
}

function togglePersonChip(personIdx, key, chip, single) {
  const p = state.people[personIdx];
  const cur = (Array.isArray(p[key]) ? p[key] : []);
  const next = single ? (cur.indexOf(chip)>=0?[]:[chip]) : (cur.indexOf(chip)>=0?cur.filter(function(c){return c!==chip;}):[...cur,chip]);
  if (key === 'gender') {
    state.people[personIdx] = Object.assign({}, p, {gender: next[0]||'少女'});
    renderPersonSection(personIdx);
    renderOutputPanel();
    return;
  }
  state.people[personIdx] = Object.assign({}, p, {[key]: next});
  resetAll();
  updatePersonChipUI(personIdx, key);
  renderOutputPanel();
}

function updateChipUI(key) {
  const chips = (state.form[key] && state.form[key].chips) || [];
  document.querySelectorAll('[data-chip-key="'+key+'"]').forEach(function(btn) {
    btn.classList.toggle('chip-on', chips.indexOf(btn.dataset.chipVal) >= 0);
  });
}

function updatePersonChipUI(personIdx, key) {
  const p = state.people[personIdx];
  const chips = Array.isArray(p[key]) ? p[key] : (p[key] ? [p[key]] : []);
  document.querySelectorAll('[data-p="'+personIdx+'"][data-chip-key="'+key+'"]').forEach(function(btn) {
    btn.classList.toggle('chip-on', chips.indexOf(btn.dataset.chipVal) >= 0);
  });
}

// ── テンプレート適用 ─────────────────────────────────────────────
function applyTemplate(tpl) {
  const cat = tpl.category;
  state.activeTpl = Object.assign({}, state.activeTpl, {[cat]: tpl.id});

  if (tpl.promptText && tpl.promptText.trim()) {
    // 自由記述テンプレート: アイデア欄に文章を追記
    const cur = state.idea.trim();
    state.idea = cur ? cur + '\n' + tpl.promptText.trim() : tpl.promptText.trim();
    const ideaInput = document.getElementById('idea-input');
    if (ideaInput) ideaInput.value = state.idea;
    const cnt = document.getElementById('char-count');
    if (cnt) { cnt.textContent = state.idea.length>0?state.idea.length+'文字':''; cnt.style.color = state.idea.length>300?'#EF4444':state.idea.length>150?'#F59E0B':''; }
  } else {
    // 旧チップ式テンプレート
    const pre = tpl.pre || {};
    if ((cat === 'character' || cat === 'outfit') && getModel().multiPerson) {
      const p = Object.assign({}, mkPerson(), state.people[0]);
      const upd = Object.assign({}, pre);
      delete upd._p;
      Object.keys(upd).forEach(function(k){ p[k] = upd[k]; });
      state.people[0] = p;
      renderPersonSection(0);
    } else {
      Object.entries(pre).forEach(function(kv) {
        if (kv[0] === '_p') return;
        state.form[kv[0]] = Object.assign({}, state.form[kv[0]]||{text:''}, {chips: Array.isArray(kv[1]) ? kv[1] : [kv[1]]});
      });
      renderCatContent();
    }
  }
  resetAll();
  renderTemplateBar();
  renderOutputPanel();
}

// ── レンダリング ─────────────────────────────────────────────────

function renderModeAndModelTabs() {
  // モード切替ボタン
  ['btn-mode-image','btn-mode-video'].forEach(function(id) {
    const btn = document.getElementById(id);
    if (!btn) return;
    const m = id.includes('image') ? 'image' : 'video';
    btn.classList.toggle('mode-on', state.mode === m);
  });

  // モデルタブ
  const tabsEl = document.getElementById('model-tabs');
  if (!tabsEl) return;
  const models = Object.values(getModels());
  tabsEl.innerHTML = models.map(function(m) {
    const sel = state.modelId === m.id;
    return '<button class="model-tab'+(sel?' model-tab-on':'')+'" data-model="'+m.id+'" style="'+(sel?'border-color:'+m.color+';color:'+m.color+';background:'+m.color+'12;':'')+'">' +
      '<span class="model-icon">'+m.icon+'</span>' +
      '<span class="model-name">'+m.name+'</span>' +
      '<span class="model-label">'+m.label+'</span>' +
      '</button>';
  }).join('');
  tabsEl.querySelectorAll('.model-tab').forEach(function(btn) {
    btn.addEventListener('click', function(){ switchModel(btn.dataset.model); });
  });

  // ヒントバー
  updateHintBar();
}

function updateHintBar() {
  const hint = document.getElementById('hint-text');
  if (hint) hint.textContent = getModel().tip || '';
}

function renderTemplateBar() {
  const cat = state.activeCat;
  const notionTpls = state.templates[cat] || [];
  const bar  = document.getElementById('template-bar');
  const list = document.getElementById('template-list');
  const note = document.getElementById('template-note');
  const titleEl = document.getElementById('template-bar-title');
  const catLabel = {character:'キャラクター',outfit:'服装',scene:'シーン',style:'スタイル',quality:'クオリティ'};
  if (titleEl) titleEl.textContent = (catLabel[cat]||cat)+'のクイックテンプレート';
  if (note) {
    const showNote = (cat==='character'||cat==='outfit') && getModel().multiPerson && state.people.length>1;
    note.textContent = showNote ? '（1人目に適用）' : '';
    note.style.display = showNote ? '' : 'none';
  }
  if (bar) bar.classList.remove('hidden');
  if (!list) return;
  list.innerHTML = notionTpls.map(function(t) {
    const isActive = state.activeTpl[cat] === t.id;
    const hasImg   = !!t.image;
    const isFree   = !!(t.promptText && t.promptText.trim());
    return '<button class="tpl-btn'+(isActive?' tpl-on':'')+'" data-tpl-id="'+t.id+'"'+(isFree?' title="自由記述テンプレート"':'')+'>' +
      (hasImg ? '<img class="tpl-img" src="'+t.image+'" alt="'+t.label+'" data-lbl="'+t.label+'" onclick="event.stopPropagation();showImgModal(this.src,this.dataset.lbl)" />' : '') +
      (isActive ? '<i class="ti ti-check"></i>' : '')+t.label +
      (isFree ? '<span class="tpl-free-badge">文</span>' : '') +
      '</button>';
  }).join('') +
  '<button class="tpl-btn tpl-add-btn" id="btn-tpl-register"><i class="ti ti-plus"></i>登録</button>';
  list.querySelectorAll('.tpl-btn:not(.tpl-add-btn)').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const tpl = notionTpls.find(function(t){ return t.id===btn.dataset.tplId; });
      if (tpl) applyTemplate(tpl);
    });
  });
  const regBtn = document.getElementById('btn-tpl-register');
  if (regBtn) regBtn.addEventListener('click', openTplRegisterModal);
}

function renderCatTabs() {
  const model = getModel();
  document.querySelectorAll('.cat-tab').forEach(function(tab) {
    tab.classList.toggle('active', tab.dataset.cat === state.activeCat);
    const cat = tab.dataset.cat;
    let count = 0;
    if ((cat==='character'||cat==='outfit') && model.multiPerson) {
      count = state.people.filter(function(p){
        return Object.entries(p).some(function(kv){ return kv[0]!=='gender'&&Array.isArray(kv[1])&&kv[1].length>0; });
      }).length;
    } else {
      const catDef = model.cats.find(function(c){ return c.id===cat; });
      if (catDef) {
        count = catDef.fields.filter(function(f){
          const v = state.form[f.key]||{};
          return (v.chips&&v.chips.length)||(v.text&&v.text.trim());
        }).length;
      }
    }
    let badge = tab.querySelector('.cat-badge');
    if (count>0) {
      if (!badge) { badge=document.createElement('span'); badge.className='cat-badge'; tab.appendChild(badge); }
      badge.textContent = count;
    } else if (badge) badge.remove();
  });

  // カテゴリタブを現在のモデルに合わせて再生成
  const catTabsEl = document.getElementById('cat-tabs');
  if (!catTabsEl) return;
  catTabsEl.innerHTML = model.cats.map(function(cat) {
    const isActive = state.activeCat === cat.id;
    return '<button class="cat-tab'+(isActive?' active':'')+'" data-cat="'+cat.id+'">' +
      cat.icon+' '+cat.label+
      '</button>';
  }).join('');
  catTabsEl.querySelectorAll('.cat-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      state.activeCat = tab.dataset.cat;
      renderCatTabs();
      renderCatContent();
      renderTemplateBar();
    });
  });
}

function renderCatContent() {
  var cat = state.activeCat;
  var content = document.getElementById('cat-content');
  if (!content) return;

  // 画像モード: キャラクター・服装は全モデル共通でmultiPersonフォームを使う
  if (state.mode === 'image' && (cat === 'character' || cat === 'outfit')) {
    renderPeopleForm(content, cat);
    return;
  }

  // 動画モード: キャラクター・服装はシンプルフォーム
  if (state.mode === 'video' && (cat === 'character' || cat === 'outfit')) {
    renderSimplePersonForm(content, cat);
    return;
  }

  // シーン・スタイル・クオリティ: COMMON_CATS（画像）または個別（動画）
  var model = getModel();
  var catDef = model.cats.find(function(c){ return c.id === cat; });
  if (!catDef) { content.innerHTML = ''; return; }

  content.innerHTML = catDef.fields.map(function(f){ return renderFieldHTML(f); }).join('');

  if (cat === 'quality') {
    var ta = content.querySelector('textarea[data-field-key="negative"]');
    if (ta) {
      ta.value = (state.form.negative && state.form.negative.text) || '';
      ta.addEventListener('input', function(e){ setNegText(e.target.value); });
    }
  }
  content.querySelectorAll('[data-chip-key]').forEach(function(btn) {
    btn.addEventListener('click', function(){
      toggleChip(btn.dataset.chipKey, btn.dataset.chipVal, btn.dataset.single === '1');
    });
  });
}

function renderFieldHTML(f) {
  const chips = (state.form[f.key] && state.form[f.key].chips) || [];
  const chipsHTML = (f.chips||[]).map(function(c) {
    return '<button class="chip'+(chips.indexOf(c)>=0?' chip-on':'')+'" data-chip-key="'+f.key+'" data-chip-val="'+c+'" data-single="'+(f.single?'1':'0')+'">'+c+'</button>';
  }).join('');
  const textHTML = f.ph !== undefined ?
    '<textarea class="neg-input" data-field-key="'+f.key+'" placeholder="'+f.ph+'" rows="2"></textarea>' : '';
  return '<div class="field"><div class="field-label">'+f.label+'</div><div class="chip-wrap">'+chipsHTML+'</div>'+textHTML+'</div>';
}

// ── 複数人フォーム ───────────────────────────────────────────────
function renderPeopleForm(container, mode) {
  container.innerHTML = state.people.map(function(_,i){ return '<div id="person-sect-'+i+'"></div>'; }).join('') +
    (state.people.length < 4 ?
      '<button class="btn-add-person" id="btn-add-person"><i class="ti ti-plus"></i>' +
        ['','2人目','3人目','4人目'][state.people.length]+'を追加</button>' : '');
  state.people.forEach(function(_,i){ renderPersonSect(i, mode); });
  const addBtn = document.getElementById('btn-add-person');
  if (addBtn) {
    addBtn.addEventListener('click', function() {
      state.people.push(mkPerson());
      resetAll();
      renderPeopleForm(container, mode);
      renderCatTabs();
      renderOutputPanel();
    });
  }
}

function renderPersonSect(idx, mode) {
  const container = document.getElementById('person-sect-'+idx);
  if (!container) return;
  const p = state.people[idx];
  const colors = ['#E879A0','#9D7FEA','#2EBF8A','#F0A317'];
  const color  = colors[idx%4];
  const labels = ['1人目','2人目','3人目','4人目'];
  const chips = mode==='outfit' ? OUTFIT_CHIPS : CHAR_CHIPS;

  const fieldsHTML = Object.entries(chips).map(function(kv) {
    const key = kv[0]; const cfg = kv[1];
    const cur = key==='gender' ? (p.gender?[p.gender]:[]) : (Array.isArray(p[key])?p[key]:[]);
    return '<div class="field"><div class="field-label">'+cfg.label+'</div><div class="chip-wrap">' +
      cfg.chips.map(function(c) {
        const on = cur.indexOf(c)>=0;
        return '<button class="chip'+(on?' chip-on':'')+'" data-p="'+idx+'" data-chip-key="'+key+'" data-chip-val="'+c+'" data-single="'+(cfg.single?'1':'0')+'" style="'+(on?'border-color:'+color+';color:'+color+';background:'+color+'18;':'')+'">' + c + '</button>';
      }).join('') +
      '</div></div>';
  }).join('');

  const removeBtn = idx>0 ? '<button class="btn-remove-person" data-idx="'+idx+'"><i class="ti ti-trash"></i> 削除</button>' : '';
  container.innerHTML = '<div class="person-section">' +
    '<div class="person-header" style="background:'+color+'15;cursor:pointer" data-toggle="'+idx+'">' +
      '<div class="person-header-left">' +
        '<span class="person-label" style="background:'+color+'25;color:'+color+'">'+labels[idx]+'</span>' +
        '<span class="person-sub" style="color:'+color+'90">'+(mode==='outfit'?'服装':(p.gender||'少女'))+'</span>' +
      '</div>' +
      '<div style="display:flex;gap:8px;align-items:center">' + removeBtn +
        '<i class="ti ti-chevron-down" id="person-icon-'+idx+'"></i>' +
      '</div>' +
    '</div>' +
    '<div class="person-body" id="person-body-'+idx+'">'+fieldsHTML+'</div>' +
    '</div>';

  container.querySelector('[data-toggle="'+idx+'"]').addEventListener('click', function(e) {
    if (e.target.closest('.btn-remove-person')) return;
    const body = document.getElementById('person-body-'+idx);
    const icon = document.getElementById('person-icon-'+idx);
    body.classList.toggle('hidden');
    icon.classList.toggle('ti-chevron-down');
    icon.classList.toggle('ti-chevron-up');
  });
  const removeEl = container.querySelector('.btn-remove-person');
  if (removeEl) {
    removeEl.addEventListener('click', function() {
      state.people.splice(idx, 1);
      resetAll();
      const content = document.getElementById('cat-content');
      renderPeopleForm(content, mode);
      renderCatTabs();
      renderOutputPanel();
    });
  }
  container.querySelectorAll('[data-p]').forEach(function(btn) {
    btn.addEventListener('click', function(){
      togglePersonChip(idx, btn.dataset.chipKey, btn.dataset.chipVal, btn.dataset.single==='1');
    });
  });
}

// 非Animaモデル用のシンプルなキャラクター・服装チップ表示
function renderSimplePersonForm(container, mode) {
  var chips = mode === 'outfit' ? OUTFIT_CHIPS : CHAR_CHIPS;
  var ac = getModel().color;
  var fieldsHtml = Object.entries(chips).map(function(kv) {
    var key = kv[0]; var cfg = kv[1];
    if (key === 'gender') return ''; // 非AnimaはタイプなしでOK
    var cur = (state.form[key] && state.form[key].chips) || [];
    return '<div class="field">' +
      '<div class="field-label">'+cfg.label+'</div>' +
      '<div class="chip-wrap">' +
      cfg.chips.map(function(c) {
        var on = cur.indexOf(c) >= 0;
        return '<button class="chip'+(on?' chip-on':'')+'" data-chip-key="'+key+'" data-chip-val="'+c+'" data-single="0" style="'+(on?'border-color:'+ac+';color:'+ac+';background:'+ac+'18;':'')+'">' + c + '</button>';
      }).join('') +
      '</div></div>';
  }).join('');
  container.innerHTML = fieldsHtml;
  container.querySelectorAll('[data-chip-key]').forEach(function(btn) {
    btn.addEventListener('click', function(){
      toggleChip(btn.dataset.chipKey, btn.dataset.chipVal, false);
    });
  });
}

// 旧名前との互換性
function renderPersonSection(idx) {
  const mode = state.activeCat === 'outfit' ? 'outfit' : 'character';
  renderPersonSect(idx, mode);
}

function renderLoraPanel() {
  var panel = document.getElementById('lora-panel');
  if (!panel) return;
  var loras = state.loras;
  var ac = getModel().color;

  if (!loras.length) {
    // 未設定の場合でもパネルを表示（設定を促すメッセージ）
    panel.classList.remove('hidden');
    panel.innerHTML =
      '<div class="lora-header"><i class="ti ti-adjustments"></i> LoRA ' +
      '<span class="lora-note">— Notion LoRA DBを設定するとここに表示されます</span></div>' +
      '<div class="lora-empty">Worker に <code>NOTION_LORA_DB</code> を設定してください</div>';
    return;
  }

  panel.classList.remove('hidden');
  panel.innerHTML =
    '<div class="lora-header"><i class="ti ti-adjustments"></i> LoRA' +
    '<span class="lora-note"> — 選択するとトリガーワードが自動追加されます</span></div>' +
    '<div class="lora-list">' +
    loras.map(function(l) {
      var sel = state.selectedLoras.indexOf(l.id) >= 0;
      return '<button class="lora-btn'+(sel?' lora-on':'')+'" data-lora-id="'+l.id+'"' +
        (sel?(' style="border-color:'+ac+';color:'+ac+';background:'+ac+'18;"'):'') +
        ' title="'+(l.description||l.triggerWords)+'">' +
        (l.previewImage ? '<img class="lora-img" src="'+l.previewImage+'" alt="'+l.name+'" />' : '') +
        '<span class="lora-name">'+l.name+'</span>' +
        (l.triggerWords ? '<span class="lora-trigger">'+l.triggerWords+'</span>' : '') +
        '</button>';
    }).join('') +
    '</div>';

  panel.querySelectorAll('.lora-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var id = btn.dataset.loraId;
      var idx = state.selectedLoras.indexOf(id);
      if (idx >= 0) { state.selectedLoras.splice(idx, 1); }
      else          { state.selectedLoras.push(id); }
      resetAll();
      renderLoraPanel();
      renderOutputPanel();
    });
  });
}

function renderOutputPanel() {
  const promptText = getPromptText();
  const negText    = getNeg();
  const isEng  = state.showEng;
  const isEdit = state.editEng;

  const body = document.getElementById('output-body');
  const edit = document.getElementById('output-edit');
  if (isEng && isEdit) {
    if(body) body.classList.add('hidden');
    if(edit) { edit.classList.remove('hidden'); edit.value = state.eng; }
  } else {
    if(body) { body.classList.remove('hidden'); body.textContent = promptText || '← アイデアを入力するか、カテゴリのタグを選択するとプロンプトが生成されます'; body.style.color = promptText ? '' : 'var(--text-muted)'; }
    if(edit) edit.classList.add('hidden');
  }

  const len = document.getElementById('prompt-len');
  if(len) len.textContent = promptText ? promptText.length+'文字' : '';

  const langBadge = document.getElementById('lang-badge');
  if(langBadge) { langBadge.textContent = isEng?'EN 🇺🇸':'JA 🇯🇵'; langBadge.className='lang-badge'+(isEng?' lang-en':''); }

  const aiBadge = document.getElementById('ai-badge');
  if(aiBadge) aiBadge.classList.toggle('hidden', !state.aiPrompt||isEng);

  const btnTrans  = document.getElementById('btn-translate');
  const btnBackJa = document.getElementById('btn-back-ja');
  const btnEdit   = document.getElementById('btn-edit');
  if(btnTrans)  btnTrans.classList.toggle('hidden', isEng);
  if(btnBackJa) btnBackJa.classList.toggle('hidden', !isEng);
  if(btnEdit)   { btnEdit.classList.toggle('hidden', !isEng); btnEdit.innerHTML = isEdit ? '<i class="ti ti-check"></i> 編集完了' : '<i class="ti ti-pencil"></i> 編集'; }

  const btnCopy = document.getElementById('btn-copy');
  if(btnCopy) btnCopy.disabled = !promptText;

  const enReady = document.getElementById('en-ready');
  if(enReady) enReady.classList.toggle('hidden', !state.eng||isEng);

  const btnVar = document.getElementById('btn-variation');
  if(btnVar) btnVar.disabled = !getJaPrompt().trim();

  const negPanel = document.getElementById('output-neg');
  if(negPanel) {
    if (negText) {
      negPanel.classList.remove('hidden');
      const negBody = document.getElementById('neg-body');
      const negLen  = document.getElementById('neg-len');
      if(negBody) negBody.textContent = negText;
      if(negLen)  negLen.textContent  = negText.length+'文字';
    } else negPanel.classList.add('hidden');
  }

  // モデルカラーを出力パネルに反映
  const m = getModel();
  const dot = document.getElementById('output-dot');
  const posPanel = document.getElementById('output-pos');
  if(dot) dot.style.background = m.color;
  if(posPanel) { posPanel.style.borderColor = m.color+'40'; }
}

function renderVariationTabs() {
  const wrap = document.getElementById('variation-tabs');
  if (!wrap) return;
  if (!state.variations.length) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  wrap.innerHTML = state.variations.map(function(_,i) {
    return '<button class="var-tab'+(state.activeVar===i?' var-tab-on':'')+'" data-var="'+i+'">バリエーション'+(i+1)+'</button>';
  }).join('');
  wrap.querySelectorAll('.var-tab').forEach(function(btn) {
    btn.addEventListener('click', function() {
      state.activeVar = parseInt(btn.dataset.var);
      resetLang();
      renderVariationTabs();
      renderOutputPanel();
    });
  });
}

function renderHistory() {
  const section = document.getElementById('history-section');
  const list    = document.getElementById('history-list');
  if (!section||!list) return;
  if (!state.history.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  list.innerHTML = state.history.slice(0, 5).map(function(h,i) {
    const m = getModels()[h.model] || getModel();
    return '<button class="history-item" data-hi="'+i+'">' +
      '<span class="hist-lang" style="color:'+(h.lang==='EN'?'#3B82F6':m.color||'#E879A0')+'">'+h.lang+'</span>' +
      '<span class="hist-text">'+(h.prompt||'').slice(0,60)+((h.prompt||'').length>60?'…':'')+'</span>' +
      '<span class="hist-date">'+(h.date?new Date(h.date).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}):'')+'</span>' +
      '</button>';
  }).join('');
  list.querySelectorAll('.history-item').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const h = state.history[parseInt(btn.dataset.hi)];
      if (h.lang==='EN') { state.eng=h.prompt; state.showEng=true; state.editEng=false; }
      else               { state.aiPrompt=h.prompt; resetLang(); }
      renderOutputPanel();
    });
  });
}

// ── テンプレート登録 ─────────────────────────────────────────────
let tplImageFile = null;

function openTplRegisterModal() {
  const nameInput = document.getElementById('tpl-name');
  const catSelect = document.getElementById('tpl-category');
  const modelSelect = document.getElementById('tpl-model');
  const promptTextarea = document.getElementById('tpl-prompt-text');
  const fileInput = document.getElementById('tpl-image-file');
  const preview = document.getElementById('tpl-image-preview');
  const status = document.getElementById('tpl-save-status');
  if (!nameInput || !catSelect || !modelSelect || !promptTextarea || !fileInput) return;

  catSelect.value = state.activeCat;
  const models = getModels();
  modelSelect.innerHTML = Object.values(models).map(function(m) {
    return '<option value="'+m.id+'"'+(m.id===state.modelId?' selected':'')+'>'+m.name+'</option>';
  }).join('');

  nameInput.value = '';
  promptTextarea.value = '';
  fileInput.value = '';
  if (preview) preview.classList.add('hidden');
  if (status) { status.textContent = ''; status.style.color = ''; }
  tplImageFile = null;

  document.getElementById('tpl-modal-overlay').classList.remove('hidden');
  nameInput.focus();
}

function closeTplRegisterModal() {
  const overlay = document.getElementById('tpl-modal-overlay');
  if (overlay) overlay.classList.add('hidden');
}

async function saveNewTemplate() {
  const nameInput = document.getElementById('tpl-name');
  const catSelect = document.getElementById('tpl-category');
  const modelSelect = document.getElementById('tpl-model');
  const promptTextarea = document.getElementById('tpl-prompt-text');
  const status = document.getElementById('tpl-save-status');
  const saveBtn = document.getElementById('btn-tpl-save');
  if (!nameInput || !catSelect || !modelSelect || !promptTextarea) return;

  const name = nameInput.value.trim();
  const category = catSelect.value;
  const model = modelSelect.value;
  const promptText = promptTextarea.value.trim();

  if (!name || !promptText) {
    if (status) { status.style.color = '#EF4444'; status.textContent = '名前とプロンプト文章は必須です'; }
    return;
  }

  if (saveBtn) saveBtn.disabled = true;
  if (status) { status.style.color = ''; status.textContent = '保存中…'; }

  try {
    let fileUploadId = null, fileName = null;
    if (tplImageFile) {
      if (status) status.textContent = '画像をアップロード中…';
      const fd = new FormData();
      fd.append('file', tplImageFile, tplImageFile.name);
      const res = await fetch(WORKER_URL + '/api/upload-image', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error('画像アップロードに失敗しました');
      fileUploadId = data.fileUploadId;
      fileName = data.filename;
    }

    if (status) status.textContent = 'テンプレートを保存中…';
    const result = await apiCall('/api/templates', 'POST', {
      label: name, category: category, model: model,
      promptText: promptText, fileUploadId: fileUploadId, fileName: fileName,
    });
    if (result.error) throw new Error(typeof result.error === 'string' ? result.error : 'Notionへの保存に失敗しました');

    if (status) { status.style.color = '#22C55E'; status.textContent = '保存しました ✓'; }
    await loadTemplates();
    setTimeout(closeTplRegisterModal, 800);
  } catch(e) {
    if (status) { status.style.color = '#EF4444'; status.textContent = '保存に失敗しました: ' + e.message; }
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

function showImgModal(src, label) {
  document.getElementById('modal-img').src   = src;
  document.getElementById('modal-label').textContent = label;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

// ── イベント設定 ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {

  // モード切替
  document.getElementById('btn-mode-image').addEventListener('click', function(){ if(state.mode!=='image') switchMode('image'); });
  document.getElementById('btn-mode-video').addEventListener('click', function(){ if(state.mode!=='video') switchMode('video'); });

  // AIモデル選択
  const modelSelect = document.getElementById('ai-model-select');
  if (modelSelect) {
    modelSelect.value = state.aiModel;
    modelSelect.addEventListener('change', function() {
      state.aiModel = modelSelect.value;
    });
  }

  // ルールボタン
  document.getElementById('btn-rules').addEventListener('click', function() {
    const panel = document.getElementById('rules-panel');
    panel.classList.toggle('hidden');
    this.innerHTML = panel.classList.contains('hidden') ? '<i class="ti ti-book"></i> ルールを見る' : '✕ ルールを閉じる';
  });

  // アイデア入力
  const ideaInput = document.getElementById('idea-input');
  ideaInput.addEventListener('input', function() {
    state.idea = ideaInput.value;
    const cnt = document.getElementById('char-count');
    if(cnt) { cnt.textContent = state.idea.length>0?state.idea.length+'文字':''; cnt.style.color = state.idea.length>300?'#EF4444':state.idea.length>150?'#F59E0B':''; }
    resetAll();
    renderOutputPanel();
  });

  document.getElementById('btn-generate').addEventListener('click', generate);
  document.getElementById('btn-variation').addEventListener('click', generateVariations);
  document.getElementById('btn-translate').addEventListener('click', translate);

  document.getElementById('btn-back-ja').addEventListener('click', function() {
    state.showEng=false; state.editEng=false; renderOutputPanel();
  });
  document.getElementById('btn-edit').addEventListener('click', function() {
    state.editEng=!state.editEng; renderOutputPanel();
  });
  document.getElementById('output-edit').addEventListener('input', function(e) {
    state.eng = e.target.value;
  });

  document.getElementById('btn-copy').addEventListener('click', copyPrompt);
  document.getElementById('btn-copy-neg').addEventListener('click', copyNeg);
  document.getElementById('btn-clear').addEventListener('click', clearAll);

  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('modal-overlay').classList.add('hidden');
  });
  document.getElementById('modal-overlay').addEventListener('click', function(e) {
    if (e.target===e.currentTarget) document.getElementById('modal-overlay').classList.add('hidden');
  });

  // テンプレート登録モーダル
  const tplModalClose = document.getElementById('tpl-modal-close');
  if (tplModalClose) tplModalClose.addEventListener('click', closeTplRegisterModal);
  const tplModalOverlay = document.getElementById('tpl-modal-overlay');
  if (tplModalOverlay) tplModalOverlay.addEventListener('click', function(e) {
    if (e.target === e.currentTarget) closeTplRegisterModal();
  });
  const btnTplSave = document.getElementById('btn-tpl-save');
  if (btnTplSave) btnTplSave.addEventListener('click', saveNewTemplate);
  const tplImageInput = document.getElementById('tpl-image-file');
  if (tplImageInput) tplImageInput.addEventListener('change', function(e) {
    const f = e.target.files[0];
    tplImageFile = f || null;
    const preview = document.getElementById('tpl-image-preview');
    if (!preview) return;
    if (f) {
      const reader = new FileReader();
      reader.onload = function(ev) { preview.src = ev.target.result; preview.classList.remove('hidden'); };
      reader.readAsDataURL(f);
    } else {
      preview.classList.add('hidden');
    }
  });

  // 初期描画
  renderAll();
  loadTemplates();
  loadHistory();
  loadLoras();
});
