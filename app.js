// ── 設定 ───────────────────────────────────────────────────────
const WORKER_URL = 'https://prompt-builder.corgi-orchestra-account.workers.dev';

const GEMINI_MODELS = [
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', desc: '標準・無料枠' },
  { id: 'gemini-3.6-flash',      label: 'Gemini 3.6 Flash',      desc: '高品質・無料枠' },
];

// 旧テンプレートDBのカテゴリ値（character/outfit/scene/style/quality）を、
// 新しい5グループ（char/outfit/pose/scene/style）に振り分けるための対応表。
// quality（旧クオリティ）は新体系では「スタイル・品質」タブに統合されている。
// 画像モードのみで使用（新タグ体系は画像モードだけが対象のため）。
const LEGACY_CAT_MAP = { character: 'char', outfit: 'outfit', scene: 'scene', style: 'style', quality: 'style' };

// 人物ごとのフォームで使う配色（白背景でも読めるよう濃くしている）。
// renderPersonSect（描画時）とupdatePersonChipUI（チップ単体の更新時）の両方で
// 同じ配色を参照できるよう、モジュール直下の定数として共有する。
const PERSON_COLORS = ['#C23B72','#6D28D9','#047857','#B45309'];

// ── 状態管理 ────────────────────────────────────────────────────
const state = {
  mode:        'image',
  modelId:     'anima',
  people:      [],
  form:        {},
  activeCat:   null,
  idea:        '',
  aiModel:     'gemini-3.5-flash-lite',
  aiPrompt:    '',
  negPrompt:   '',  // AI生成されたネガティブプロンプト（常に英語、ポジティブと同時に生成）
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
  imageCats:   [],          // Notion Tags DBから読み込んだ画像モード用カテゴリ（動的）
  tagsReady:   false,
  presets:     [],          // フルプリセット一覧（アイデア＋タグ＋LoRAをまとめて保存したもの）
  aspectRatio: '',          // 画面比率の指定（例: "9:16"）。空文字は「指定なし」
};

function getModels()  { return state.mode === 'image' ? IMG_MODELS : VID_MODELS; }
function getModel()   {
  var m = Object.assign({}, getModels()[state.modelId] || Object.values(getModels())[0]);
  // 画像モデルは共通タブ・multiPerson有効。動画モデルは個別タブをそのまま使う
  if (state.mode === 'image') {
    m.cats = state.imageCats;
    m.multiPerson = true;
  }
  return m;
}

// ── タグ読み込み（Notion Tags DB） ───────────────────────────────
// 画像モードのみ対象。動画モードは従来どおりdata.js内の固定タグを使う。
async function loadTags() {
  try {
    const data = await apiCall('/api/tags?mode=' + encodeURIComponent('画像'));
    const cats = buildImageCatsFromTags(data.tags || []);
    // ネガティブプロンプトは手動入力欄をやめ、「AIでプロンプト生成」時にポジティブと
    // 同時にAI生成する方式に統一したため、タグ欄への手動フィールド追加は行わない。
    state.imageCats = cats;
    state.tagsReady = true;
  } catch(e) {
    console.warn('タグ読み込み失敗:', e.message);
    state.imageCats = [];
    state.tagsReady = true;
    showToast('タグの読み込みに失敗しました: ' + e.message, 'error');
  }
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

// プロンプト本体（LoRAトリガーワードは含まない）。
// AIへの生成・翻訳リクエストにはこの本体だけを渡し、LoRAトリガーワードが
// AIによって書き換えられたり消えたりしないようにする。
function getJaPrompt() {
  if (state.aiPrompt) return state.aiPrompt;
  if (state.variations.length) return state.variations[state.activeVar] || '';
  var rawModel = getModels()[state.modelId] || Object.values(getModels())[0];
  if (state.mode === 'image') {
    return rawModel.build({ ...state.form, people: state.people, imageCats: state.imageCats });
  }
  return rawModel.build(state.form);
}

// 画面表示・コピー用の最終テキスト。LoRAトリガーワードと画面比率はAIを介さず、
// ここで末尾へ追加する（JA/EN どちらの表示でも、タグ生成・AI生成どちらでも常に付与）。
function getPromptText() {
  const src = state.showEng ? state.eng : getJaPrompt();
  let text = src.split('\n').filter(function(l){ return l.trim(); }).join('\n');
  const lora = getLoraText();
  if (lora) text = text ? text + '\n' + lora : lora;
  if (state.aspectRatio) text = text ? text + '\naspect ratio ' + state.aspectRatio : 'aspect ratio ' + state.aspectRatio;
  return text;
}

function getNeg() {
  return (state.negPrompt || '').trim();
}

function hasInput() {
  if (state.idea.trim()) return true;
  const model = getModel();
  if (model.multiPerson && state.people.some(function(p){
    return Object.entries(p).some(function(kv){ return Array.isArray(kv[1]) && kv[1].length > 0; });
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
  // レスポンス本文には失敗理由（Gemini安全フィルター等）が入っていることが多いので、
  // ステータスコードだけでなく本文のエラーメッセージも読み取ってユーザーに伝える
  let data = null;
  try { data = await res.json(); } catch(e) { /* 本文が無い/JSONでない場合は無視 */ }
  if (!res.ok) {
    const errMsg = data && data.error && (typeof data.error === 'string' ? data.error : data.error.message);
    throw new Error(errMsg || ('API error: ' + res.status));
  }
  return data || {};
}

async function loadTemplates() {
  try {
    // 特定モデル専用ではなく「同じモード内の全モデルで共有」にするため、
    // モード内の全モデル分のテンプレートをまとめて取得してマージする
    // （画像モデルはカテゴリ構成が共通なので、どのモデルで登録したテンプレートも
    //   他の画像モデルでそのまま使える）
    const modelIds = Object.keys(getModels());
    const results = await Promise.all(modelIds.map(function(id) {
      return apiCall('/api/templates?model=' + id).catch(function(){ return { templates: [] }; });
    }));
    const seen = {};
    const grouped = {};
    results.forEach(function(data) {
      (data.templates || []).forEach(function(t) {
        if (seen[t.id]) return;
        seen[t.id] = true;
        // 旧カテゴリ体系（character/outfit/scene/style/quality）で登録された
        // テンプレートは、対応する新カテゴリのタブに振り分けて引き続き表示する
        var cat = (state.mode === 'image' && LEGACY_CAT_MAP[t.category]) ? LEGACY_CAT_MAP[t.category] : t.category;
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(t);
      });
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

// フルプリセット（アイデア＋タグ選択＋LoRAを丸ごと保存したもの）はモード（画像/動画）ごとに
// 保存形式（people/form）が異なるので、モードで絞り込んで取得する。
async function loadPresets() {
  try {
    const data = await apiCall('/api/presets?mode=' + encodeURIComponent(state.mode === 'image' ? '画像' : '動画'));
    state.presets = data.presets || [];
    renderPresetBar();
  } catch(e) {
    console.warn('プリセット読み込み失敗:', e.message);
  }
}

async function saveHistory(prompt, negative, lang) {
  try {
    const data = await apiCall('/api/history', 'POST', {
      prompt: prompt, negative: negative, model: state.modelId, lang: lang
    });
    return (data && data.id) || null;
  } catch(e) { console.warn('履歴保存失敗:', e.message); return null; }
}

// ── 生成・変換 ───────────────────────────────────────────────────
// 選択中のタグ・人物情報を、AIに渡す「要約テキスト」に変換する
function getFS() {
  const parts = [];
  const model = getModel();
  if (model.multiPerson) {
    state.people.forEach(function(p, i) {
      const label = ['1人目','2人目','3人目','4人目'][i] || ((i + 1) + '人目');
      model.cats.filter(function(c){ return c.isPerson; }).forEach(function(cat) {
        const feats = [];
        cat.personFields.forEach(function(f) {
          const v = p[f.key];
          if (Array.isArray(v)) feats.push.apply(feats, v);
          else if (v) feats.push(v);
        });
        if (feats.length) parts.push(label + cat.label + ': ' + feats.join('、'));
      });
    });
  }
  model.cats.filter(function(c){ return !c.isPerson; }).forEach(function(cat) {
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
  state.negPrompt = '';
  resetLang();
  renderOutputPanel();
  setBtnLoading('btn-generate', true);
  try {
    const model = getModel();
    const idea  = state.idea.trim();
    const fs    = getFS();
    const posPrompt = mkGenPrompt(model, idea, fs, state.people, state.aspectRatio);
    const negPrompt = mkNegPrompt(model, idea, fs);

    // ポジティブ・ネガティブを同時に1回ずつ生成する。タグ抜けチェック→自動再生成は
    // Worker側の内部リトライと掛け算的に重なって生成時間が非常に長くなっていたため廃止し、
    // プロンプト側の指示強化（厳守事項・専門家チーム設定）で要素の網羅性を担保する方針にした。
    const [posResult, negResult] = await Promise.all([
      apiCall('/api/generate', 'POST', { prompt: posPrompt, model: state.aiModel }),
      apiCall('/api/generate', 'POST', { prompt: negPrompt, model: state.aiModel })
        .catch(function(e){ showToast('ネガティブプロンプトの生成に失敗しました: ' + e.message, 'error'); return { text: '' }; }),
    ]);

    state.aiPrompt  = posResult.text || '';
    state.negPrompt = (negResult.text || '').split('\n').filter(function(l){ return l.trim(); }).join(', ').trim();

    const savedId = await saveHistory(state.aiPrompt, getNeg(), 'JA');
    state.history.unshift({ id: savedId, prompt: state.aiPrompt, negative: getNeg(), model: state.modelId, lang: 'JA', date: new Date().toISOString(), favorite: false });
    state.history = state.history.slice(0, 50);
  } catch(e) { showToast('生成に失敗しました: ' + e.message, 'error'); }
  finally {
    state.loading = false;
    setBtnLoading('btn-generate', false);
    renderOutputPanel();
    renderHistory();
  }
}

// AIの応答からJSONを取り出す。```json ... ``` のようなコードフェンスや、
// 前後の説明文が付いて返ってくることがあるため、それらを取り除いてから解析する。
function extractJson(raw) {
  let text = (raw || '').trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) text = fenceMatch[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) text = text.slice(first, last + 1);
  return JSON.parse(text);
}

// 「バリエーション」ボタン: 今表示中のポジティブプロンプトを土台に、
// スタイル・ムード・シーンだけを変えた別案を3つAIに作らせて、下のタブで切り替えられるようにする機能。
// LoRAトリガーワードはAIに渡さず、表示時にgetPromptText()側で常に付け直す。
async function generateVariations() {
  if (!getJaPrompt().trim() || state.loading) return;
  state.loading = true;
  setBtnLoading('btn-variation', true);
  const prompt = '以下のプロンプトをベースに、スタイル・ムード・シーンを変えた別バリエーションを3つ作成してください（改行構造を保持）。\n\nベース:\n' +
    getJaPrompt() + '\n\n以下のJSON形式のみを、コードフェンスや説明文を付けずに返してください:\n{"variations":["バリエーション1","バリエーション2","バリエーション3"]}';
  try {
    const data = await apiCall('/api/generate', 'POST', { prompt: prompt, model: state.aiModel });
    let j;
    try { j = extractJson(data.text); }
    catch(parseErr) { throw new Error('AIの応答をバリエーションとして読み取れませんでした（想定外の形式で返ってきました）'); }
    if (j.variations && j.variations.length) {
      state.variations = j.variations; state.activeVar = 0; state.aiPrompt = ''; resetLang();
    } else {
      throw new Error('AIの応答にバリエーションが含まれていませんでした');
    }
  } catch(e) { showToast('バリエーション生成に失敗しました: ' + e.message, 'error'); }
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
    const savedId = await saveHistory(state.eng, getNeg(), 'EN');
    state.history.unshift({ id: savedId, prompt: state.eng, negative: getNeg(), model: state.modelId, lang: 'EN', date: new Date().toISOString(), favorite: false });
    state.history = state.history.slice(0, 50);
  } catch(e) { showToast('翻訳に失敗しました: ' + e.message, 'error'); }
  finally {
    state.loading = false;
    setBtnLoading('btn-translate', false);
    renderOutputPanel();
    renderHistory();
  }
}

// ── 画像から生成（アップロードした画像を解析して再現プロンプトを作る） ──
let img2promptData = null; // { base64, mimeType }

async function generateFromImage() {
  if (!img2promptData || state.loading) return;
  state.loading = true;
  resetAll();
  renderOutputPanel();
  const btn = document.getElementById('btn-img2prompt-generate');
  const btnText = document.getElementById('img2prompt-btn-text');
  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = '解析中…';
  try {
    const model = getModel();
    const analysisPrompt = mkImageAnalysisPrompt(model);
    const negPrompt = mkNegPrompt(model, '', '');

    // ポジティブ（画像解析）とネガティブを同時に生成する
    const [posResult, negResult] = await Promise.all([
      apiCall('/api/analyze-image', 'POST', {
        image: img2promptData.base64, mimeType: img2promptData.mimeType,
        prompt: analysisPrompt, model: state.aiModel,
      }),
      apiCall('/api/generate', 'POST', { prompt: negPrompt, model: state.aiModel })
        .catch(function(e){ showToast('ネガティブプロンプトの生成に失敗しました: ' + e.message, 'error'); return { text: '' }; }),
    ]);

    state.aiPrompt  = posResult.text || '';
    state.negPrompt = (negResult.text || '').split('\n').filter(function(l){ return l.trim(); }).join(', ').trim();

    const savedId = await saveHistory(state.aiPrompt, getNeg(), 'JA');
    state.history.unshift({ id: savedId, prompt: state.aiPrompt, negative: getNeg(), model: state.modelId, lang: 'JA', date: new Date().toISOString(), favorite: false });
    state.history = state.history.slice(0, 50);
    showToast('画像からプロンプトを生成しました', 'info');
  } catch(e) { showToast('画像の解析に失敗しました: ' + e.message, 'error'); }
  finally {
    state.loading = false;
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'この画像を解析してプロンプト生成';
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

// ── トースト通知（alert()の代替。画面をブロックしない非破壊的な通知） ──
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function showToast(message, type) {
  type = type || 'error';
  const container = document.getElementById('toast-container');
  if (!container) { console.warn(message); return; }
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  const icon = type === 'error' ? 'ti-alert-circle' : 'ti-info-circle';
  el.innerHTML = '<i class="ti ' + icon + '"></i><span>' + escapeHtml(message) + '</span><button class="toast-close" aria-label="閉じる">✕</button>';
  container.appendChild(el);
  const remove = function(){ if (el.parentNode) el.remove(); };
  el.querySelector('.toast-close').addEventListener('click', remove);
  setTimeout(remove, 5000);
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
function resetAll()  { state.aiPrompt = ''; state.negPrompt = ''; state.variations = []; state.activeVar = 0; resetLang(); }

function switchMode(newMode) {
  state.mode      = newMode;
  state.modelId   = Object.keys(newMode === 'image' ? IMG_MODELS : VID_MODELS)[0];
  state.people    = newMode === 'image' ? [mkPerson(state.imageCats)] : [];
  state.form      = {};
  state.idea      = '';
  state.activeTpl = {};
  personCollapsed = {};
  var cats = getModel().cats;
  state.activeCat = cats[0] ? cats[0].id : null;
  resetAll();
  document.getElementById('idea-input').value = '';
  renderAll();
  loadTemplates();
  loadPresets();
}

function switchModel(modelId) {
  state.modelId = modelId;
  // アイデア入力・タグ選択（people/form）・テンプレート選択・折りたたみ状態はモデルを
  // 切り替えても保持する。画像モデルは共通のカテゴリ構成なのでそのまま使い回せる。
  const cats = getModel().cats;
  if (!cats.some(function(c){ return c.id === state.activeCat; })) {
    state.activeCat = cats[0] ? cats[0].id : null;
  }
  // LoRAはモデルごとに用意されているセットが異なるため、切り替え時にクリアする
  state.selectedLoras = [];
  resetAll();
  renderAll();
  loadTemplates();
  loadLoras();
}

function clearAll() {
  state.people    = state.mode === 'image' ? [mkPerson(state.imageCats)] : [];
  state.form      = {};
  state.idea      = '';
  state.activeTpl = {};
  personCollapsed = {};
  resetAll();
  document.getElementById('idea-input').value = '';
  renderAll();
}

// 配列からランダムにn個（重複なし）を選ぶ
function pickRandom(arr, n) {
  const pool = (arr || []).slice();
  const picked = [];
  for (let i = 0; i < n && pool.length; i++) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return picked;
}

// 配列をランダムな順序に並べ替えたコピーを返す
function shuffle(arr) {
  return (arr || []).slice().sort(function(){ return Math.random() - 0.5; });
}

// 1カテゴリにつき、ランダムに埋めるフィールド数の上限。
// 各カテゴリの全フィールドを埋めると「瞳の色が3種類」「髪型が4種類」のような
// 矛盾だらけの結果になるため、代表的な数個だけに絞って現実的な組み合わせにする。
const RANDOM_FIELDS_PER_CATEGORY = 3;

// 「ランダム生成」ボタン: 現在表示中のモデルの各カテゴリから、代表的なフィールドを
// 数個だけ選んでランダムにタグを埋める。アイデアに詰まったときの呼び水として使う。
// 選択済みのタグは一度全てクリアしてから埋め直す（既存の選択と混ざって収拾が
// つかなくなるのを防ぐため）。
function randomizeTags() {
  const model = getModel();
  if (!model.cats || !model.cats.length) return;

  if (model.multiPerson) {
    state.people.forEach(function(p) {
      model.cats.filter(function(c){ return c.isPerson; }).forEach(function(cat) {
        // まずこのカテゴリの全フィールドを空にする
        cat.personFields.forEach(function(f) { p[f.key] = f.single ? '' : []; });

        // personType（人物属性）は人物の軸になるので必ず1つ選ぶ
        const personTypeField = cat.personFields.find(function(f){ return f.key === 'personType'; });
        if (personTypeField && personTypeField.chips.length) {
          p[personTypeField.key] = pickRandom(personTypeField.chips, 1)[0] || '';
        }
        // それ以外は数個のフィールドだけランダムに選んで埋める（矛盾を避けるため）
        const otherFields = cat.personFields.filter(function(f){ return f.key !== 'personType'; });
        shuffle(otherFields).slice(0, RANDOM_FIELDS_PER_CATEGORY).forEach(function(f) {
          if (!f.chips.length) return;
          const picked = pickRandom(f.chips, 1);
          p[f.key] = f.single ? (picked[0] || '') : picked;
        });
      });
    });
  }
  model.cats.filter(function(c){ return !c.isPerson; }).forEach(function(cat) {
    cat.fields.forEach(function(f) { state.form[f.key] = { chips: [], text: '' }; });
    shuffle(cat.fields).slice(0, RANDOM_FIELDS_PER_CATEGORY).forEach(function(f) {
      if (!f.chips.length) return;
      const picked = pickRandom(f.chips, 1);
      state.form[f.key] = { chips: f.single ? picked.slice(0, 1) : picked, text: '' };
    });
  });

  personCollapsed = {};
  state.activeTpl = {};
  resetAll();
  renderAll();
  showToast('タグをランダムに選び直しました', 'info');
}

function renderAll() {
  renderModeAndModelTabs();
  updateHintBar();
  renderCatTabs();
  renderCatContent();
  renderTemplateBar();
  renderPresetBar();
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

// 人物ごとのチップ切り替え。単一選択フィールド（personTypeなど）は文字列として保持し、
// 複数選択は配列として保持する。
function togglePersonChip(personIdx, key, chip, single) {
  const p = state.people[personIdx];
  const cur = single ? (p[key] ? [p[key]] : []) : (Array.isArray(p[key]) ? p[key] : []);
  const next = single ? (cur.indexOf(chip)>=0?[]:[chip]) : (cur.indexOf(chip)>=0?cur.filter(function(c){return c!==chip;}):[...cur,chip]);
  if (single) {
    state.people[personIdx] = Object.assign({}, p, {[key]: next[0] || (key === 'personType' ? '少女' : '')});
    renderPersonSection(personIdx);
    renderOutputPanel();
    return;
  }
  state.people[personIdx] = Object.assign({}, p, {[key]: next});
  resetAll();
  updatePersonChipUI(personIdx, key);
  updatePersonSummary(personIdx);
  renderOutputPanel();
}

// 折りたたみ状態を保ったまま、ヘッダーの要約テキストだけを更新する
function updatePersonSummary(idx) {
  const el = document.querySelector('#person-sect-'+idx+' .person-sub');
  if (el) el.textContent = personSummaryText(state.people[idx], getModel().cats);
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
  const color = PERSON_COLORS[personIdx % 4];
  document.querySelectorAll('[data-p="'+personIdx+'"][data-chip-key="'+key+'"]').forEach(function(btn) {
    const on = chips.indexOf(btn.dataset.chipVal) >= 0;
    btn.classList.toggle('chip-on', on);
    // renderPersonSect側は選択中のチップに人物色のinlineスタイルを付けているため、
    // classだけ外してもスタイルが残って「解除したのに色が付いたまま」に見えるバグがあった。
    // ここでもinlineスタイルを同期して即座に見た目へ反映する。
    btn.style.cssText = on ? ('border-color:'+color+';color:'+color+';background:'+color+'18;') : '';
  });
}

// ── テンプレート適用 ─────────────────────────────────────────────
function applyTemplate(tpl) {
  const cat = tpl.category;

  // 選択中のテンプレートをもう一度クリックしたら選択解除する（クリア）
  if (state.activeTpl[cat] === tpl.id) {
    clearTemplateSelection(tpl);
    resetAll();
    renderTemplateBar();
    renderOutputPanel();
    return;
  }

  state.activeTpl = Object.assign({}, state.activeTpl, {[cat]: tpl.id});

  if (tpl.promptText && tpl.promptText.trim()) {
    // 自由記述テンプレート: アイデア欄に文章を追記
    const cur = state.idea.trim();
    state.idea = cur ? cur + '\n' + tpl.promptText.trim() : tpl.promptText.trim();
    const ideaInput = document.getElementById('idea-input');
    if (ideaInput) ideaInput.value = state.idea;
    const cnt = document.getElementById('char-count');
    if (cnt) { cnt.textContent = state.idea.length>0?state.idea.length+'文字':''; cnt.style.color = state.idea.length>300?'#DC2626':state.idea.length>150?'#B45309':''; }
  } else {
    // 旧チップ式テンプレート（character/outfit向け。新カテゴリ用のチップ式テンプレートは
    // 現状サポートしておらず、promptTextなしで新カテゴリに登録されたテンプレートは何もしない）
    const pre = tpl.pre || {};
    if ((cat === 'character' || cat === 'outfit') && getModel().multiPerson) {
      const p = Object.assign({}, mkPerson(getModel().cats), state.people[0]);
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

// 選択解除: テンプレートが加えた内容を取り除き、activeTplから外す
function clearTemplateSelection(tpl) {
  const cat = tpl.category;
  state.activeTpl = Object.assign({}, state.activeTpl);
  delete state.activeTpl[cat];

  if (tpl.promptText && tpl.promptText.trim()) {
    // アイデア欄の末尾に残っていれば、追記したテキストだけを取り除く
    // （手動で文章を書き足した場合はテキスト全体はそのまま残す）
    const added = tpl.promptText.trim();
    let idea = state.idea;
    if (idea === added) {
      idea = '';
    } else if (idea.endsWith('\n' + added)) {
      idea = idea.slice(0, idea.length - added.length - 1);
    } else if (idea.endsWith(added)) {
      idea = idea.slice(0, idea.length - added.length);
    }
    state.idea = idea;
    const ideaInput = document.getElementById('idea-input');
    if (ideaInput) ideaInput.value = idea;
    const cnt = document.getElementById('char-count');
    if (cnt) { cnt.textContent = idea.length>0?idea.length+'文字':''; cnt.style.color = idea.length>300?'#DC2626':idea.length>150?'#B45309':''; }
  } else {
    // 旧チップ式テンプレート: テンプレートが設定したキーだけを空に戻す
    const pre = tpl.pre || {};
    const keys = Object.keys(pre).filter(function(k){ return k !== '_p'; });
    const fresh = mkPerson(getModel().cats);
    if ((cat === 'character' || cat === 'outfit') && getModel().multiPerson) {
      const p = Object.assign({}, state.people[0]);
      keys.forEach(function(k){ p[k] = fresh[k]; });
      state.people[0] = p;
      renderPersonSection(0);
    } else {
      keys.forEach(function(k){
        state.form[k] = Object.assign({}, state.form[k]||{text:''}, {chips: []});
      });
      renderCatContent();
    }
  }
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
  const model = getModel();
  const catDef = model.cats.find(function(c){ return c.id === cat; });
  const catLabel = catDef ? catDef.label : (cat || '');
  if (titleEl) titleEl.textContent = catLabel + 'のクイックテンプレート';
  if (note) {
    const showNote = !!(catDef && catDef.isPerson && model.multiPerson && state.people.length > 1);
    note.textContent = showNote ? '（1人目に適用）' : '';
    note.style.display = showNote ? '' : 'none';
  }
  if (bar) bar.classList.remove('hidden');
  if (!list) return;
  list.innerHTML = notionTpls.map(function(t) {
    const isActive = state.activeTpl[cat] === t.id;
    const hasImg   = !!t.image;
    const isFree   = !!(t.promptText && t.promptText.trim());
    // 選択中のものはクリックで解除できることをタイトルで示す
    const titleAttr = isActive ? ' title="クリックして選択解除"' : (isFree ? ' title="自由記述テンプレート"' : '');
    return '<div class="tpl-btn-wrap">' +
      '<button class="tpl-btn'+(isActive?' tpl-on':'')+'" data-tpl-id="'+t.id+'"'+titleAttr+'>' +
      (hasImg ? '<img class="tpl-img" src="'+t.image+'" alt="'+t.label+'" data-lbl="'+t.label+'" onclick="event.stopPropagation();showImgModal(this.src,this.dataset.lbl)" />' : '') +
      (isActive ? '<i class="ti ti-x"></i>' : '')+t.label +
      (isFree ? '<span class="tpl-free-badge">文</span>' : '') +
      '</button>' +
      '<button class="tpl-edit-btn" data-tpl-edit-id="'+t.id+'" title="編集（削除もここから）"><i class="ti ti-pencil"></i></button>' +
      '</div>';
  }).join('') +
  '<button class="tpl-btn tpl-add-btn" id="btn-tpl-register"><i class="ti ti-plus"></i>登録</button>';
  list.querySelectorAll('.tpl-btn:not(.tpl-add-btn)').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const tpl = notionTpls.find(function(t){ return t.id===btn.dataset.tplId; });
      if (tpl) applyTemplate(tpl);
    });
  });
  list.querySelectorAll('[data-tpl-edit-id]').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const tpl = notionTpls.find(function(t){ return t.id === btn.dataset.tplEditId; });
      if (tpl) openTplRegisterModal(tpl);
    });
  });
  const regBtn = document.getElementById('btn-tpl-register');
  if (regBtn) regBtn.addEventListener('click', function(){ openTplRegisterModal(); });
}

// テンプレート削除（編集モーダル内の削除ボタンから呼ばれる）。
// Notion側では完全削除ではなくアーカイブ扱いになる（ゴミ箱から復元可能）。
async function deleteTemplate(tpl) {
  if (!confirm('テンプレート「'+tpl.label+'」を削除しますか？')) return;
  try {
    await apiCall('/api/templates?id=' + encodeURIComponent(tpl.id), 'DELETE');
    // 削除したテンプレートが選択中だった場合は選択状態も解除しておく
    if (state.activeTpl[tpl.category] === tpl.id) {
      state.activeTpl = Object.assign({}, state.activeTpl);
      delete state.activeTpl[tpl.category];
    }
    showToast('テンプレートを削除しました', 'info');
    closeTplRegisterModal();
    await loadTemplates();
    renderOutputPanel();
  } catch(e) {
    showToast('削除に失敗しました: ' + e.message, 'error');
  }
}

// ── フルプリセット ───────────────────────────────────────────────
// テンプレート（カテゴリ単位の自由記述）とは別に、アイデア文＋全カテゴリのタグ選択＋
// LoRAを丸ごと1クリックで呼び出せる「プリセット」。モードごとに一覧を持つ。
function renderPresetBar() {
  const list = document.getElementById('preset-list');
  if (!list) return;
  const presets = state.presets || [];
  list.innerHTML = presets.map(function(p) {
    return '<div class="tpl-btn-wrap">' +
      '<button class="tpl-btn" data-preset-id="'+p.id+'" title="クリックして適用（アイデア・タグ・LoRAをまとめて復元します）">' +
        '<i class="ti ti-bookmark"></i>'+p.label+
      '</button>' +
      '<button class="chip-del-btn" data-preset-del-id="'+p.id+'" title="このプリセットを削除"><i class="ti ti-trash"></i></button>' +
      '</div>';
  }).join('') +
  '<button class="tpl-btn tpl-add-btn" id="btn-preset-register"><i class="ti ti-plus"></i>保存</button>';

  list.querySelectorAll('[data-preset-id]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const p = presets.find(function(x){ return x.id === btn.dataset.presetId; });
      if (p) applyPreset(p);
    });
  });
  list.querySelectorAll('[data-preset-del-id]').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const p = presets.find(function(x){ return x.id === btn.dataset.presetDelId; });
      if (p) deletePreset(p);
    });
  });
  const regBtn = document.getElementById('btn-preset-register');
  if (regBtn) regBtn.addEventListener('click', openPresetSaveModal);
}

function applyPreset(preset) {
  try {
    const data = JSON.parse(preset.stateJson || '{}');
    if (state.mode === 'image') {
      state.people = (Array.isArray(data.people) && data.people.length) ? data.people : [mkPerson(state.imageCats)];
    }
    state.form = data.form || {};
    state.idea = preset.idea || '';
    const ideaInput = document.getElementById('idea-input');
    if (ideaInput) ideaInput.value = state.idea;
    const cnt = document.getElementById('char-count');
    if (cnt) { cnt.textContent = state.idea.length>0?state.idea.length+'文字':''; cnt.style.color = state.idea.length>300?'#DC2626':state.idea.length>150?'#B45309':''; }

    // LoRAはIDで、無ければ名前でフォールバックして探す（LoRA一覧が入れ替わっていても極力復元する）
    const loraIds = [];
    (data.loras || []).forEach(function(l) {
      const found = state.loras.find(function(x){ return x.id === l.id; }) || state.loras.find(function(x){ return x.name === l.name; });
      if (found) loraIds.push(found.id);
    });
    state.selectedLoras = loraIds;
    state.aspectRatio = data.aspectRatio || '';
    const aspectSelectEl = document.getElementById('aspect-select');
    if (aspectSelectEl) aspectSelectEl.value = state.aspectRatio;

    personCollapsed = {};
    state.activeTpl = {};
    resetAll();
    renderAll();
    showToast('プリセット「'+preset.label+'」を適用しました', 'info');
  } catch(e) {
    showToast('プリセットの適用に失敗しました: ' + e.message, 'error');
  }
}

async function deletePreset(preset) {
  if (!confirm('プリセット「'+preset.label+'」を削除しますか？')) return;
  try {
    await apiCall('/api/presets?id=' + encodeURIComponent(preset.id), 'DELETE');
    showToast('プリセットを削除しました', 'info');
    await loadPresets();
  } catch(e) {
    showToast('削除に失敗しました: ' + e.message, 'error');
  }
}

function openPresetSaveModal() {
  const nameInput = document.getElementById('preset-name');
  const status = document.getElementById('preset-save-status');
  if (!nameInput) return;
  nameInput.value = '';
  if (status) { status.textContent = ''; status.style.color = ''; }
  document.getElementById('preset-modal-overlay').classList.remove('hidden');
  nameInput.focus();
}

function closePresetSaveModal() {
  const overlay = document.getElementById('preset-modal-overlay');
  if (overlay) overlay.classList.add('hidden');
}

async function savePresetNow() {
  const nameInput = document.getElementById('preset-name');
  const status = document.getElementById('preset-save-status');
  const saveBtn = document.getElementById('btn-preset-save');
  if (!nameInput) return;
  const name = nameInput.value.trim();
  if (!name) {
    if (status) { status.style.color = '#DC2626'; status.textContent = '名前を入力してください'; }
    return;
  }
  if (saveBtn) saveBtn.disabled = true;
  if (status) { status.style.color = ''; status.textContent = '保存中…'; }
  try {
    const snapshot = {
      people: state.mode === 'image' ? state.people : undefined,
      form: state.form,
      loras: state.selectedLoras.map(function(id) {
        const l = state.loras.find(function(x){ return x.id === id; });
        return l ? { id: l.id, name: l.name } : null;
      }).filter(Boolean),
      aspectRatio: state.aspectRatio,
    };
    const result = await apiCall('/api/presets', 'POST', {
      label: name,
      mode: state.mode === 'image' ? '画像' : '動画',
      model: state.modelId,
      idea: state.idea,
      stateJson: JSON.stringify(snapshot),
    });
    if (result.error) throw new Error(typeof result.error === 'string' ? result.error : '保存に失敗しました');
    if (status) { status.style.color = '#16A34A'; status.textContent = '保存しました ✓'; }
    await loadPresets();
    setTimeout(closePresetSaveModal, 800);
  } catch(e) {
    if (status) { status.style.color = '#DC2626'; status.textContent = '保存に失敗しました: ' + e.message; }
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

function renderCatTabs() {
  const model = getModel();
  const catTabsEl = document.getElementById('cat-tabs');
  if (!catTabsEl) return;

  if (!model.cats.length) {
    catTabsEl.innerHTML = '<span class="cat-tabs-loading">タグを読み込み中…</span>';
    return;
  }

  catTabsEl.innerHTML = model.cats.map(function(cat) {
    const isActive = state.activeCat === cat.id;
    let count = 0;
    if (cat.isPerson && model.multiPerson) {
      count = state.people.filter(function(p){
        return cat.personFields.some(function(f){
          const v = p[f.key];
          return Array.isArray(v) && v.length > 0;
        });
      }).length;
    } else {
      count = cat.fields.filter(function(f){
        const v = state.form[f.key]||{};
        return (v.chips&&v.chips.length)||(v.text&&v.text.trim());
      }).length;
    }
    return '<button class="cat-tab'+(isActive?' active':'')+'" data-cat="'+cat.id+'">' +
      cat.icon+' '+cat.label+
      (count>0 ? '<span class="cat-badge">'+count+'</span>' : '') +
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
  var model = getModel();
  var catDef = model.cats.find(function(c){ return c.id === cat; });
  if (!catDef) { content.innerHTML = ''; return; }

  // 画像モード: 人物ごとのカテゴリ（cat1〜cat5）はmultiPersonフォームを使う
  if (state.mode === 'image' && catDef.isPerson) {
    renderPeopleForm(content, catDef);
    return;
  }

  // 動画モード: キャラクター・服装はシンプルフォーム
  if (state.mode === 'video' && (cat === 'character' || cat === 'outfit')) {
    renderSimplePersonForm(content, cat);
    return;
  }

  content.innerHTML = renderFieldsWithHeadings(catDef.fields, renderFieldHTML);

  content.querySelectorAll('[data-chip-key]').forEach(function(btn) {
    btn.addEventListener('click', function(){
      toggleChip(btn.dataset.chipKey, btn.dataset.chipVal, btn.dataset.single === '1');
    });
  });
}

function renderFieldHTML(f) {
  const chips = (state.form[f.key] && state.form[f.key].chips) || [];
  const groups = (f.chipGroups && f.chipGroups.length) ? f.chipGroups : [{ label: null, chips: f.chips||[] }];
  const chipsHTML = groups.map(function(g) {
    const headHTML = g.label ? '<div class="chip-subhead">'+g.label+'</div>' : '';
    const btnsHTML = g.chips.map(function(c) {
      return '<button class="chip'+(chips.indexOf(c)>=0?' chip-on':'')+'" data-chip-key="'+f.key+'" data-chip-val="'+c+'" data-single="'+(f.single?'1':'0')+'">'+c+'</button>';
    }).join('');
    return headHTML+'<div class="chip-wrap">'+btnsHTML+'</div>';
  }).join('');
  const textHTML = f.ph !== undefined ?
    '<textarea class="neg-input" data-field-key="'+f.key+'" placeholder="'+f.ph+'" rows="2"></textarea>' : '';
  return '<div class="field"><div class="field-label">'+f.label+'</div>'+chipsHTML+textHTML+'</div>';
}

// 複数の元カテゴリを1つのタブにまとめているグループ（例: キャラクター＝基本+顔目表情+髪型髪色）では、
// フィールドの並びの中で元カテゴリ（groupLabel）が変わった位置に小見出しを挟んで迷子にならないようにする。
// 元カテゴリが1種類しかない場合（例: ポーズ・構図・視点）は見出しを出さない。
function renderFieldsWithHeadings(fields, fieldToHtml) {
  const labels = fields.map(function(f){ return f.groupLabel; }).filter(Boolean);
  const distinct = labels.filter(function(l, i){ return labels.indexOf(l) === i; });
  const showHeadings = distinct.length > 1;
  let lastLabel = null;
  let html = '';
  fields.forEach(function(f) {
    if (showHeadings && f.groupLabel && f.groupLabel !== lastLabel) {
      html += '<div class="subcat-heading">'+f.groupLabel+'</div>';
      lastLabel = f.groupLabel;
    }
    html += fieldToHtml(f);
  });
  return html;
}

// ── 複数人フォーム ───────────────────────────────────────────────
// 折りたたみ状態はDOM再生成をまたいで保持するため、state本体とは別に管理
let personCollapsed = {};

function renderPeopleForm(container, catDef) {
  container.innerHTML = state.people.map(function(_,i){ return '<div id="person-sect-'+i+'"></div>'; }).join('') +
    (state.people.length < 4 ?
      '<button class="btn-add-person" id="btn-add-person"><i class="ti ti-plus"></i>' +
        ['','2人目','3人目','4人目'][state.people.length]+'を追加</button>' : '');
  state.people.forEach(function(_,i){ renderPersonSect(i, catDef); });
  const addBtn = document.getElementById('btn-add-person');
  if (addBtn) {
    addBtn.addEventListener('click', function() {
      state.people.push(mkPerson(getModel().cats));
      // 2人目以降は追加した瞬間は折りたたんでおき、画面が縦に伸びすぎないようにする
      personCollapsed[state.people.length - 1] = true;
      resetAll();
      renderPeopleForm(container, catDef);
      renderCatTabs();
      renderOutputPanel();
    });
  }
}

function renderPersonSect(idx, catDef) {
  const container = document.getElementById('person-sect-'+idx);
  if (!container || !catDef) return;
  const p = state.people[idx];
  const color  = PERSON_COLORS[idx % 4];
  const labels = ['1人目','2人目','3人目','4人目'];
  const fields = catDef.personFields;

  const fieldsHTML = renderFieldsWithHeadings(fields, function(cfg) {
    const key = cfg.key;
    const cur = cfg.single ? (p[key] ? [p[key]] : []) : (Array.isArray(p[key]) ? p[key] : []);
    const groups = (cfg.chipGroups && cfg.chipGroups.length) ? cfg.chipGroups : [{ label: null, chips: cfg.chips||[] }];
    const chipsHTML = groups.map(function(g) {
      const headHTML = g.label ? '<div class="chip-subhead">'+g.label+'</div>' : '';
      const btnsHTML = g.chips.map(function(c) {
        const on = cur.indexOf(c)>=0;
        return '<button class="chip'+(on?' chip-on':'')+'" data-p="'+idx+'" data-chip-key="'+key+'" data-chip-val="'+c+'" data-single="'+(cfg.single?'1':'0')+'" style="'+(on?'border-color:'+color+';color:'+color+';background:'+color+'18;':'')+'">' + c + '</button>';
      }).join('');
      return headHTML+'<div class="chip-wrap">'+btnsHTML+'</div>';
    }).join('');
    return '<div class="field"><div class="field-label">'+cfg.label+'</div>'+chipsHTML+'</div>';
  });

  const collapsed = !!personCollapsed[idx];
  const removeBtn = idx>0 ? '<button class="btn-remove-person" data-idx="'+idx+'"><i class="ti ti-trash"></i> 削除</button>' : '';
  container.innerHTML = '<div class="person-section">' +
    '<div class="person-header" style="background:'+color+'15;cursor:pointer" data-toggle="'+idx+'">' +
      '<div class="person-header-left">' +
        '<span class="person-label" style="background:'+color+'25;color:'+color+'">'+labels[idx]+'</span>' +
        '<span class="person-sub" style="color:'+color+'">'+personSummaryText(p, getModel().cats)+'</span>' +
      '</div>' +
      '<div style="display:flex;gap:8px;align-items:center">' + removeBtn +
        '<i class="ti '+(collapsed?'ti-chevron-up':'ti-chevron-down')+'" id="person-icon-'+idx+'"></i>' +
      '</div>' +
    '</div>' +
    '<div class="person-body'+(collapsed?' hidden':'')+'" id="person-body-'+idx+'">'+fieldsHTML+'</div>' +
    '</div>';

  container.querySelector('[data-toggle="'+idx+'"]').addEventListener('click', function(e) {
    if (e.target.closest('.btn-remove-person')) return;
    const body = document.getElementById('person-body-'+idx);
    const icon = document.getElementById('person-icon-'+idx);
    const nowCollapsed = !body.classList.contains('hidden');
    body.classList.toggle('hidden');
    icon.classList.toggle('ti-chevron-down');
    icon.classList.toggle('ti-chevron-up');
    personCollapsed[idx] = nowCollapsed;
  });
  const removeEl = container.querySelector('.btn-remove-person');
  if (removeEl) {
    removeEl.addEventListener('click', function() {
      state.people.splice(idx, 1);
      personCollapsed = {}; // インデックスがずれるため折りたたみ状態は一旦リセット
      resetAll();
      const content = document.getElementById('cat-content');
      renderPeopleForm(content, catDef);
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

// 非Animaモデル用のシンプルなキャラクター・服装チップ表示（動画モードのみ。変更対象外）
function renderSimplePersonForm(container, mode) {
  var model = getModel();
  var catDef = model.cats.find(function(c){ return c.id === mode; });
  if (!catDef) { container.innerHTML = ''; return; }
  var ac = model.color;
  var fieldsHtml = catDef.fields.map(function(cfg) {
    var key = cfg.key;
    var cur = (state.form[key] && state.form[key].chips) || [];
    return '<div class="field">' +
      '<div class="field-label">'+cfg.label+'</div>' +
      '<div class="chip-wrap">' +
      cfg.chips.map(function(c) {
        var on = cur.indexOf(c) >= 0;
        return '<button class="chip'+(on?' chip-on':'')+'" data-chip-key="'+key+'" data-chip-val="'+c+'" data-single="'+(cfg.single?'1':'0')+'" style="'+(on?'border-color:'+ac+';color:'+ac+';background:'+ac+'18;':'')+'">' + c + '</button>';
      }).join('') +
      '</div></div>';
  }).join('');
  container.innerHTML = fieldsHtml;
  container.querySelectorAll('[data-chip-key]').forEach(function(btn) {
    btn.addEventListener('click', function(){
      toggleChip(btn.dataset.chipKey, btn.dataset.chipVal, btn.dataset.single === '1');
    });
  });
}

// 旧名前との互換性（テンプレート適用時などに使用）
function renderPersonSection(idx) {
  var model = getModel();
  var catDef = model.cats.find(function(c){ return c.id === state.activeCat; }) ||
               model.cats.find(function(c){ return c.isPerson; });
  renderPersonSect(idx, catDef);
}

// LoRAパネルはアイデア入力のすぐ下にあり縦に長くなりがちなので、デフォルトは折りたたんでおく
let loraCollapsed = true;

function renderLoraPanel() {
  var panel = document.getElementById('lora-panel');
  if (!panel) return;
  var loras = state.loras;
  var ac = getModel().color;
  var collapsed = loraCollapsed;
  var selCount = state.selectedLoras.length;
  var chevron = '<i class="ti '+(collapsed?'ti-chevron-down':'ti-chevron-up')+'" style="margin-left:auto"></i>';

  function bindHeaderToggle() {
    var header = document.getElementById('lora-header');
    if (header) header.addEventListener('click', function() {
      loraCollapsed = !loraCollapsed;
      renderLoraPanel();
    });
  }

  if (!loras.length) {
    // 未設定の場合でもパネルを表示（設定を促すメッセージ）
    panel.classList.remove('hidden');
    panel.innerHTML =
      '<div class="lora-header" id="lora-header"><i class="ti ti-adjustments"></i> LoRA ' +
      '<span class="lora-note">— Notion LoRA DBを設定するとここに表示されます</span>' + chevron + '</div>' +
      (collapsed ? '' : '<div class="lora-empty">Worker に <code>NOTION_LORA_DB</code> を設定してください</div>');
    bindHeaderToggle();
    return;
  }

  panel.classList.remove('hidden');
  panel.innerHTML =
    '<div class="lora-header" id="lora-header"><i class="ti ti-adjustments"></i> LoRA' +
    '<span class="lora-note"> — '+(selCount>0 ? selCount+'件選択中' : '選択するとトリガーワードが自動追加されます')+'</span>' + chevron + '</div>' +
    (collapsed ? '' :
    '<div class="lora-list">' +
    loras.map(function(l) {
      var sel = state.selectedLoras.indexOf(l.id) >= 0;
      return '<button class="lora-btn'+(sel?' lora-on':'')+'" data-lora-id="'+l.id+'"' +
        (sel?(' style="border-color:'+ac+';color:'+ac+';background:'+ac+'18;"'):'') +
        ' title="'+(l.description||l.triggerWords)+'">' +
        (l.previewImage
          ? '<img class="lora-img" src="'+l.previewImage+'" alt="'+l.name+'" loading="lazy" />'
          // 画像未設定時も同じ幅を確保するプレースホルダー（読み込み中の画像でレイアウトが動くのを防ぐ）
          : '<span class="lora-img lora-img-fallback" style="color:'+ac+'"><i class="ti ti-adjustments"></i></span>') +
        '<span class="lora-info">' +
          '<span class="lora-name">'+l.name+'</span>' +
          (l.triggerWords ? '<span class="lora-trigger">'+l.triggerWords+'</span>' : '') +
        '</span>' +
        '</button>';
    }).join('') +
    '</div>');

  bindHeaderToggle();
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

  renderOutputInputsSummary();
}

// 入力内容の要約（アイデア文章／選んだタグ／LoRA）をポジティブプロンプトの上部に表示する
function renderOutputInputsSummary() {
  const wrap = document.getElementById('output-inputs');
  if (!wrap) return;

  const idea     = state.idea.trim();
  const tagsText = getFS(); // 各カテゴリの選択内容（AIに渡しているものと同じ要約テキスト）
  const loraNames = state.selectedLoras.map(function(id) {
    const l = state.loras.find(function(x){ return x.id === id; });
    return l ? l.name : null;
  }).filter(Boolean);
  const aspectLabel = (ASPECT_RATIOS.find(function(a){ return a.value === state.aspectRatio; }) || {}).label;

  const hasAny = !!(idea || tagsText || loraNames.length || state.aspectRatio);
  wrap.classList.toggle('hidden', !hasAny);
  if (!hasAny) return;

  const rowIdea = document.getElementById('oi-row-idea');
  const rowTags = document.getElementById('oi-row-tags');
  const rowLora = document.getElementById('oi-row-lora');
  const rowAspect = document.getElementById('oi-row-aspect');
  const valIdea = document.getElementById('oi-idea-val');
  const valTags = document.getElementById('oi-tags-val');
  const valLora = document.getElementById('oi-lora-val');
  const valAspect = document.getElementById('oi-aspect-val');

  if (rowIdea) rowIdea.classList.toggle('hidden', !idea);
  if (valIdea) valIdea.textContent = idea;

  if (rowTags) rowTags.classList.toggle('hidden', !tagsText);
  if (valTags) valTags.textContent = tagsText.replace(/\n/g, ' ・ ');

  if (rowLora) rowLora.classList.toggle('hidden', !loraNames.length);
  if (valLora) valLora.textContent = loraNames.join('、');

  if (rowAspect) rowAspect.classList.toggle('hidden', !state.aspectRatio);
  if (valAspect) valAspect.textContent = aspectLabel || state.aspectRatio;
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

let historyExpanded = false; // 「もっと見る」で5件超を表示するか

// 履歴1件分のHTML。テキスト部分（data-hi）はクリックで復元、★とゴミ箱は別ボタンとして
// 独立させている（.history-itemがbuttonではなくdivなので、ネストせず並列に置ける）。
function historyItemHTML(h, i) {
  const m = getModels()[h.model] || getModel();
  const d = h.date ? new Date(h.date) : null;
  const today = new Date().toDateString();
  const dateLabel = !d ? '' : (d.toDateString()===today
    ? d.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})
    : d.toLocaleDateString('ja-JP',{month:'2-digit',day:'2-digit'})+' '+d.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}));
  const favIcon = h.favorite ? 'ti-star-filled' : 'ti-star';
  return '<div class="history-item">' +
    '<span class="hist-lang" style="color:'+(h.lang==='EN'?'#2563EB':m.color||'#C23B72')+'">'+h.lang+'</span>' +
    '<span class="hist-text" data-hi="'+i+'" title="'+escapeHtml(h.prompt||'')+'">'+(h.prompt||'').slice(0,60)+((h.prompt||'').length>60?'…':'')+'</span>' +
    '<span class="hist-date">'+dateLabel+'</span>' +
    '<button class="hist-star'+(h.favorite?' hist-star-on':'')+'" data-hi-fav="'+i+'" title="'+(h.favorite?'お気に入り解除':'お気に入りに追加')+'"><i class="ti '+favIcon+'"></i></button>' +
    '<button class="hist-del" data-hi-del="'+i+'" title="削除"><i class="ti ti-trash"></i></button>' +
    '</div>';
}

function renderHistory() {
  const section  = document.getElementById('history-section');
  const favWrap  = document.getElementById('history-fav-section');
  const favList  = document.getElementById('history-fav-list');
  const list     = document.getElementById('history-list');
  const moreWrap = document.getElementById('history-more-wrap');
  const moreBtn  = document.getElementById('btn-history-more');
  if (!section||!list) return;
  if (!state.history.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');

  // お気に入りは件数上限に関わらず常に全件表示、それ以外は従来どおり5件→もっと見る
  const indexed = state.history.map(function(h,i){ return {h:h, i:i}; });
  const favs    = indexed.filter(function(x){ return x.h.favorite; });
  const others  = indexed.filter(function(x){ return !x.h.favorite; });

  if (favWrap) favWrap.classList.toggle('hidden', !favs.length);
  if (favList) favList.innerHTML = favs.map(function(x){ return historyItemHTML(x.h, x.i); }).join('');

  const visibleCount = historyExpanded ? Math.min(others.length, 20) : 5;
  list.innerHTML = others.slice(0, visibleCount).map(function(x){ return historyItemHTML(x.h, x.i); }).join('');

  [favList, list].forEach(function(container) {
    if (!container) return;
    container.querySelectorAll('[data-hi]').forEach(function(el) {
      el.addEventListener('click', function() {
        const h = state.history[parseInt(el.dataset.hi)];
        if (!h) return;
        if (h.lang==='EN') { state.eng=h.prompt; state.showEng=true; state.editEng=false; }
        else               { state.aiPrompt=h.prompt; resetLang(); }
        if (h.negative) state.negPrompt = h.negative;
        renderOutputPanel();
      });
    });
    container.querySelectorAll('[data-hi-fav]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleHistoryFavorite(parseInt(btn.dataset.hiFav));
      });
    });
    container.querySelectorAll('[data-hi-del]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        deleteHistoryItem(parseInt(btn.dataset.hiDel));
      });
    });
  });

  if (moreWrap) moreWrap.classList.toggle('hidden', others.length <= 5);
  if (moreBtn)  moreBtn.textContent = historyExpanded ? '閉じる' : 'もっと見る（他'+(others.length-5)+'件）';
}

async function toggleHistoryFavorite(idx) {
  const h = state.history[idx];
  if (!h) return;
  if (!h.id) { showToast('この履歴はお気に入り登録できません', 'error'); return; }
  const next = !h.favorite;
  h.favorite = next; // 楽観的に即反映
  renderHistory();
  try {
    await apiCall('/api/history?id=' + encodeURIComponent(h.id), 'PATCH', { favorite: next });
  } catch(e) {
    h.favorite = !next; // 失敗したら元に戻す
    renderHistory();
    showToast('お気に入りの更新に失敗しました: ' + e.message, 'error');
  }
}

async function deleteHistoryItem(idx) {
  const h = state.history[idx];
  if (!h) return;
  if (!h.id) { showToast('この履歴は削除できません', 'error'); return; }
  if (!confirm('この履歴を削除しますか？')) return;
  try {
    await apiCall('/api/history?id=' + encodeURIComponent(h.id), 'DELETE');
    state.history.splice(idx, 1);
    renderHistory();
    showToast('履歴を削除しました', 'info');
  } catch(e) {
    showToast('削除に失敗しました: ' + e.message, 'error');
  }
}

// ── テンプレート登録 ─────────────────────────────────────────────
let tplImageFile = null;
let editingTpl = null; // 編集中のテンプレート（nullなら新規登録モード）

// tplを渡すと編集モード（既存の内容をフォームに読み込み、削除ボタンも表示する）、
// 渡さなければ新規登録モードで開く。
function openTplRegisterModal(tpl) {
  const nameInput = document.getElementById('tpl-name');
  const catSelect = document.getElementById('tpl-category');
  const modelSelect = document.getElementById('tpl-model');
  const promptTextarea = document.getElementById('tpl-prompt-text');
  const fileInput = document.getElementById('tpl-image-file');
  const preview = document.getElementById('tpl-image-preview');
  const currentNote = document.getElementById('tpl-image-current-note');
  const status = document.getElementById('tpl-save-status');
  const titleText = document.getElementById('tpl-modal-title-text');
  const saveBtnText = document.getElementById('tpl-save-btn-text');
  const deleteBtn = document.getElementById('btn-tpl-delete');
  if (!nameInput || !catSelect || !modelSelect || !promptTextarea || !fileInput) return;

  editingTpl = tpl || null;

  // カテゴリ・モデルの一覧はモデル・モードによって変わる動的な値なので、開くたびに作り直す
  const cats = getModel().cats;
  catSelect.innerHTML = cats.map(function(c) {
    return '<option value="'+c.id+'">'+c.label+'</option>';
  }).join('');

  const models = getModels();
  modelSelect.innerHTML = Object.values(models).map(function(m) {
    return '<option value="'+m.id+'">'+m.name+'</option>';
  }).join('');

  fileInput.value = '';
  tplImageFile = null;
  if (status) { status.textContent = ''; status.style.color = ''; }

  if (editingTpl) {
    if (titleText) titleText.textContent = 'テンプレート編集';
    if (saveBtnText) saveBtnText.textContent = '更新';
    nameInput.value = editingTpl.label || '';
    // 旧カテゴリ体系（character/outfit等）で登録されたテンプレートは新カテゴリIDに読み替える
    catSelect.value = LEGACY_CAT_MAP[editingTpl.category] || editingTpl.category;
    if (catSelect.selectedIndex < 0) catSelect.selectedIndex = 0;
    modelSelect.value = editingTpl.model || state.modelId;
    if (modelSelect.selectedIndex < 0) modelSelect.selectedIndex = 0;
    promptTextarea.value = editingTpl.promptText || '';
    if (editingTpl.image) {
      if (preview) { preview.src = editingTpl.image; preview.classList.remove('hidden'); }
      if (currentNote) currentNote.classList.remove('hidden');
    } else {
      if (preview) preview.classList.add('hidden');
      if (currentNote) currentNote.classList.add('hidden');
    }
    if (deleteBtn) deleteBtn.classList.remove('hidden');
  } else {
    if (titleText) titleText.textContent = 'テンプレート登録';
    if (saveBtnText) saveBtnText.textContent = '保存';
    nameInput.value = '';
    catSelect.value = state.activeCat;
    promptTextarea.value = '';
    if (preview) preview.classList.add('hidden');
    if (currentNote) currentNote.classList.add('hidden');
    if (deleteBtn) deleteBtn.classList.add('hidden');
  }

  document.getElementById('tpl-modal-overlay').classList.remove('hidden');
  nameInput.focus();
}

function closeTplRegisterModal() {
  const overlay = document.getElementById('tpl-modal-overlay');
  if (overlay) overlay.classList.add('hidden');
  editingTpl = null;
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
  const isEdit = !!editingTpl;

  if (!name || !promptText) {
    if (status) { status.style.color = '#DC2626'; status.textContent = '名前とプロンプト文章は必須です'; }
    return;
  }

  if (saveBtn) saveBtn.disabled = true;
  if (status) { status.style.color = ''; status.textContent = (isEdit?'更新中…':'保存中…'); }

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

    if (isEdit) {
      if (status) status.textContent = 'テンプレートを更新中…';
      const result = await apiCall('/api/templates?id=' + encodeURIComponent(editingTpl.id), 'PATCH', {
        label: name, category: category, model: model,
        promptText: promptText, fileUploadId: fileUploadId, fileName: fileName,
      });
      if (result.error) throw new Error(typeof result.error === 'string' ? result.error : 'Notionの更新に失敗しました');
      if (status) { status.style.color = '#16A34A'; status.textContent = '更新しました ✓'; }
    } else {
      if (status) status.textContent = 'テンプレートを保存中…';
      const result = await apiCall('/api/templates', 'POST', {
        label: name, category: category, model: model,
        promptText: promptText, fileUploadId: fileUploadId, fileName: fileName,
      });
      if (result.error) throw new Error(typeof result.error === 'string' ? result.error : 'Notionへの保存に失敗しました');
      if (status) { status.style.color = '#16A34A'; status.textContent = '保存しました ✓'; }
    }

    await loadTemplates();
    renderOutputPanel();
    setTimeout(closeTplRegisterModal, 800);
  } catch(e) {
    if (status) { status.style.color = '#DC2626'; status.textContent = (isEdit?'更新':'保存')+'に失敗しました: ' + e.message; }
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
document.addEventListener('DOMContentLoaded', async function() {

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

  // 画面比率（アスペクト比）選択
  const aspectSelect = document.getElementById('aspect-select');
  if (aspectSelect) {
    aspectSelect.innerHTML = ASPECT_RATIOS.map(function(a) {
      return '<option value="'+a.value+'">'+a.label+'</option>';
    }).join('');
    aspectSelect.value = state.aspectRatio;
    aspectSelect.addEventListener('change', function() {
      state.aspectRatio = aspectSelect.value;
      renderOutputPanel();
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
    if(cnt) { cnt.textContent = state.idea.length>0?state.idea.length+'文字':''; cnt.style.color = state.idea.length>300?'#DC2626':state.idea.length>150?'#B45309':''; }
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

  // ランダム生成ボタン
  const btnRandom = document.getElementById('btn-random');
  if (btnRandom) btnRandom.addEventListener('click', randomizeTags);

  const btnHistMore = document.getElementById('btn-history-more');
  if (btnHistMore) btnHistMore.addEventListener('click', function() {
    historyExpanded = !historyExpanded;
    renderHistory();
  });

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
  const btnTplDelete = document.getElementById('btn-tpl-delete');
  if (btnTplDelete) btnTplDelete.addEventListener('click', function() {
    if (editingTpl) deleteTemplate(editingTpl);
  });
  const tplImageInput = document.getElementById('tpl-image-file');
  if (tplImageInput) tplImageInput.addEventListener('change', function(e) {
    const f = e.target.files[0];
    tplImageFile = f || null;
    const preview = document.getElementById('tpl-image-preview');
    const currentNote = document.getElementById('tpl-image-current-note');
    if (!preview) return;
    if (f) {
      // 新しい画像を選んだら「現在の画像です」の注記は消す（プレビューは新しい画像に置き換わるため）
      if (currentNote) currentNote.classList.add('hidden');
      const reader = new FileReader();
      reader.onload = function(ev) { preview.src = ev.target.result; preview.classList.remove('hidden'); };
      reader.readAsDataURL(f);
    } else {
      preview.classList.add('hidden');
      if (currentNote && editingTpl && editingTpl.image) currentNote.classList.remove('hidden');
    }
  });

  // プリセット保存モーダル
  const presetModalClose = document.getElementById('preset-modal-close');
  if (presetModalClose) presetModalClose.addEventListener('click', closePresetSaveModal);
  const presetModalOverlay = document.getElementById('preset-modal-overlay');
  if (presetModalOverlay) presetModalOverlay.addEventListener('click', function(e) {
    if (e.target === e.currentTarget) closePresetSaveModal();
  });
  const btnPresetSave = document.getElementById('btn-preset-save');
  if (btnPresetSave) btnPresetSave.addEventListener('click', savePresetNow);

  // 画像から生成（アップロード画像を解析して再現プロンプトを作る）
  const img2promptHeader = document.getElementById('img2prompt-header');
  if (img2promptHeader) img2promptHeader.addEventListener('click', function() {
    const body = document.getElementById('img2prompt-body');
    const chevron = document.getElementById('img2prompt-chevron');
    if (body) body.classList.toggle('hidden');
    if (chevron) { chevron.classList.toggle('ti-chevron-down'); chevron.classList.toggle('ti-chevron-up'); }
  });
  const img2promptInput = document.getElementById('img2prompt-file');
  if (img2promptInput) img2promptInput.addEventListener('change', function(e) {
    const f = e.target.files[0];
    const preview = document.getElementById('img2prompt-preview');
    const genBtn = document.getElementById('btn-img2prompt-generate');
    if (!f) {
      img2promptData = null;
      if (genBtn) genBtn.disabled = true;
      if (preview) preview.classList.add('hidden');
      return;
    }
    if (f.size > 8 * 1024 * 1024) {
      showToast('画像サイズは8MB以下にしてください', 'error');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = function(ev) {
      const dataUrl = ev.target.result; // "data:image/png;base64,XXXX"
      const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
      img2promptData = { base64: m ? m[2] : '', mimeType: m ? m[1] : (f.type || 'image/jpeg') };
      if (preview) { preview.src = dataUrl; preview.classList.remove('hidden'); }
      if (genBtn) genBtn.disabled = false;
    };
    reader.readAsDataURL(f);
  });
  const btnImg2PromptGen = document.getElementById('btn-img2prompt-generate');
  if (btnImg2PromptGen) btnImg2PromptGen.addEventListener('click', generateFromImage);

  // 初期描画: 画像モードのタグ（Notion Tags DB）を読み込んでから、
  // 人物オブジェクトの初期化・カテゴリタブ描画を行う
  renderCatTabs(); // 「タグを読み込み中…」を即座に表示
  await loadTags();
  state.people = [mkPerson(state.imageCats)];
  const initCats = getModel().cats;
  state.activeCat = initCats[0] ? initCats[0].id : null;

  renderAll();
  loadTemplates();
  loadPresets();
  loadHistory();
  loadLoras();
});
