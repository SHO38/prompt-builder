// ── 共通ヘルパー ─────────────────────────────────────────────────
// クオリティタグの日本語→英語変換（Notionの新タグ一覧にすでに英語版がある単語は
// ここに無くてもフォールバックでそのまま使われる）
const QEN = {
  "マスタピース":"masterpiece","最高品質":"best quality","ハイクオリティ":"high quality",
  "スコア9":"score_9","スコア8":"score_8","スコア7":"score_7",
  "スコア8up":"score_8_up","スコア7up":"score_7_up",
  "年2025":"year 2025","年2026":"year 2026","最新":"newest","とても美的":"very aesthetic",
  "高解像度":"highres","absurdres":"absurdres","公式アート":"official art",
  "風景":"scenery",
};
// 人物属性のうち「男性寄り」と判定するもの（1boy/1girlの人数タグ判定に使用）
const MALE_PERSON_TYPES = ["少年","成人男性","青年","おじいさん"];
// 人物属性のうち未成年を示すもの（肉付け生成時に肌質感・体つきなど性的に読める
// 身体描写を避けるための判定に使用。GPT Image 2等の安全フィルターが誤反応しやすいため）
const MINOR_PERSON_TYPES = ["少女","少年","子供","幼児","赤ちゃん","女子高生"];
const POS  = ["左の女の子","右の女の子","中央の女の子","4人目の女の子"];
const BPOS = ["左の男の子","右の男の子","中央の男の子","4人目の男の子"];

// 画面比率（アスペクト比）の選択肢。value="" は「指定なし」。
const ASPECT_RATIOS = [
  { value: "",     label: "指定なし" },
  { value: "1:1",  label: "1:1（正方形）" },
  { value: "4:3",  label: "4:3（横）" },
  { value: "3:4",  label: "3:4（縦）" },
  { value: "16:9", label: "16:9（横長）" },
  { value: "9:16", label: "9:16（縦長・スマホ）" },
  { value: "21:9", label: "21:9（シネマワイド）" },
];

function fGet(form, key) {
  const v = form[key] || {};
  return [...(v.chips || []), (v.text || '').trim()].filter(Boolean);
}

// 人物ごとのフィールド定義（imageCatsのisPersonカテゴリをまとめたもの）から
// 新規の人物オブジェクトを作る。単一選択は文字列、複数選択は配列で初期化する。
// どのフィールドも初期状態では何も選択しない（以前はpersonTypeだけ「少女」が
// 自動選択されていたが、ユーザーが意図せず選んだ状態になるため廃止）。
function mkPerson(imageCats) {
  const p = {};
  (imageCats || []).forEach(function(cat) {
    if (!cat.isPerson) return;
    cat.personFields.forEach(function(f) {
      p[f.key] = f.single ? '' : [];
    });
  });
  return p;
}

// isPersonカテゴリのフィールド定義を、カテゴリ順を保ったままフラットにする。
// 各フィールドは自身の元カテゴリ順（categoryOrder）をすでに持っている
// （複数の元カテゴリを1つのタブにまとめた後も、Animaの行分け等で元の分類を参照できるように）。
function personFieldDefs(imageCats) {
  const out = [];
  (imageCats || []).forEach(function(cat) {
    if (!cat.isPerson) return;
    cat.personFields.forEach(function(f) { out.push(f); });
  });
  return out;
}

// person-sub（折りたたみヘッダーの要約）用: personTypeを先頭に、他のフィールドから最大2つ。
// 何も選択されていなければ「未選択」と表示する（以前は「少女」がデフォルト表示されていた）。
function personSummaryText(p, imageCats) {
  const defs = personFieldDefs(imageCats);
  const personType = p.personType || '';
  const rest = [];
  defs.forEach(function(f) {
    if (f.key === 'personType') return;
    const v = p[f.key];
    if (Array.isArray(v)) rest.push.apply(rest, v);
    else if (v) rest.push(v);
  });
  const label = personType || '未選択';
  if (!rest.length) return label;
  return label + '・' + rest.slice(0, 2).join('・') + (rest.length > 2 ? ' 他' : '');
}

// Notion Tagsデータベースの行配列（Workerの /api/tags が返す形）を、
// アプリで使うタブ（5グループ）に組み立てる。
// 元の12カテゴリ（categoryOrder 1〜12）はタグの粒度としては維持しつつ、
// UI上は近い性質のもの同士を1つのタブにまとめて表示する:
//   キャラクター(1-3) / 衣装(4-7) / ポーズ・構図・視点(8) / シーン(9-10) / スタイル・品質(11-12)
// ※衣装・ファッション(旧4)を「衣装 ベース/ユニフォーム/オプション」(4-6)に分割した際、
//   アクセサリー・小物(旧5)以降のcategoryOrderが全て+2された。それに伴いこのマッピングも
//   ズレるため、Notion側でカテゴリ構成やCategoryOrderを変更した場合はここも要更新。
// 1〜8が「人物ごと」に選ぶグループ（isPerson: true）、9〜12が共通グループ。
const PERSON_CATEGORY_MAX_ORDER = 8;
const IMAGE_GROUPS = [
  { id: 'char',   label: 'キャラクター',      icon: '👤', orders: [1, 2, 3] },
  { id: 'outfit', label: '衣装',              icon: '👗', orders: [4, 5, 6, 7] },
  { id: 'pose',   label: 'ポーズ・構図・視点', icon: '🕺', orders: [8] },
  { id: 'scene',  label: 'シーン',            icon: '🏙️', orders: [9, 10] },
  { id: 'style',  label: 'スタイル・品質',     icon: '🎨', orders: [11, 12] },
];

// 1フィールドのチップ数が多くなってきた場合、Notion側のTagsテキストに
// 「■サブカテゴリ名■」という見出しトークンを挟んでおくと、チップ一覧の中に
// クリックできない小見出しとして表示され、視覚的にグルーピングできる。
// 例: "丸メガネ, スクエアメガネ, ■サングラス■, ティアドロップ, オーバル"
const CHIP_SUBHEAD_RE = /^■(.+)■$/;
function splitChipGroups(chips) {
  const groups = [];
  let current = { label: null, chips: [] };
  (chips || []).forEach(function(c) {
    const m = CHIP_SUBHEAD_RE.exec(c);
    if (m) {
      if (current.chips.length || current.label) groups.push(current);
      current = { label: m[1], chips: [] };
    } else {
      current.chips.push(c);
    }
  });
  if (current.chips.length || current.label) groups.push(current);
  return groups;
}

function buildImageCatsFromTags(tagRows) {
  const byOrder = {};
  (tagRows || []).forEach(function(row) {
    const co = row.categoryOrder;
    if (!byOrder[co]) byOrder[co] = { majorCategory: row.majorCategory, rows: [] };
    byOrder[co].rows.push(row);
  });

  return IMAGE_GROUPS.map(function(group) {
    const isPerson = group.orders[0] <= PERSON_CATEGORY_MAX_ORDER;
    const fieldDefs = [];
    group.orders.forEach(function(co) {
      const bucket = byOrder[co];
      if (!bucket) return;
      const rows = bucket.rows.slice().sort(function(a, b){ return a.fieldOrder - b.fieldOrder; });
      rows.forEach(function(r) {
        // チップに「■見出し■」トークンが混じっていれば、選択可能なチップ本体（chips）と
        // 表示用のグルーピング情報（chipGroups）に分離する。トークン自体は選択肢に残さない。
        const chipGroups = splitChipGroups(r.chips);
        const cleanChips = chipGroups.reduce(function(a, g){ return a.concat(g.chips); }, []);
        // groupLabelは元カテゴリ名（タブ内の小見出しに使う）、categoryOrderはAnimaの行分け等に使う
        fieldDefs.push({
          key: r.fieldKey, label: r.label, chips: cleanChips, chipGroups: chipGroups, single: !!r.single,
          categoryOrder: co, groupLabel: bucket.majorCategory,
        });
      });
    });
    return {
      id: group.id,
      label: group.label,
      icon: group.icon,
      isPerson: isPerson,
      fields: isPerson ? [] : fieldDefs,
      personFields: isPerson ? fieldDefs : [],
    };
  }).filter(function(g){ return g.fields.length > 0 || g.personFields.length > 0; });
}

// ── Animaプロンプト組み立て ─────────────────────────────────────
// カテゴリ1〜3（キャラクター基本／顔・目・表情／髪型・髪色）を「外見」、
// 4〜5（衣装・ファッション／アクセサリー・小物）を「服装」、
// 6（ポーズ・構図・視点）を「ポーズ」として、それぞれ別の行にする。
// カテゴリ10（品質・質感・レンダリング）のうち quality フィールドは英語に変換して先頭へ、
// それ以外（リアル質感向上タグ等）は末尾に回す。
function animaBuild(form) {
  const cats = form.imageCats || [];
  const personDefs = personFieldDefs(cats);
  const appearanceKeys = personDefs.filter(function(d){ return d.categoryOrder <= 3 && d.key !== 'personType'; }).map(function(d){ return d.key; });
  const outfitKeys     = personDefs.filter(function(d){ return d.categoryOrder >= 4 && d.categoryOrder <= 7; }).map(function(d){ return d.key; });
  // ポーズ・構図・視点（カテゴリ8）は服装とは別行にし、人物ごとに指定できるようにする
  const poseKeys        = personDefs.filter(function(d){ return d.categoryOrder === 8; }).map(function(d){ return d.key; });

  const people = (form.people && form.people.length > 0) ? form.people : [mkPerson(cats)];
  const count  = people.length;

  function isBoyPerson(p) { return MALE_PERSON_TYPES.indexOf(p.personType) >= 0; }
  function collect(p, keys) {
    return keys.reduce(function(a, k) {
      const v = p[k];
      return a.concat(Array.isArray(v) ? v : (v ? [v] : []));
    }, []);
  }

  const Q = fGet(form, "quality").map(function(q){ return QEN[q] || q; });

  const boyCount  = people.filter(isBoyPerson).length;
  const girlCount = count - boyCount;
  var countTag = "";
  if (count === 1) {
    countTag = (isBoyPerson(people[0]) ? "1boy" : "1girl") + ", solo";
  } else {
    var cParts = [];
    if (girlCount > 0) cParts.push(girlCount === 1 ? "1girl" : girlCount + "girls");
    if (boyCount  > 0) cParts.push(boyCount  === 1 ? "1boy"  : boyCount  + "boys");
    countTag = cParts.join(", ") + ", duo";
  }
  var allSame = boyCount === 0 || girlCount === 0;

  var charLines = [], outfitLines = [], poseLines = [];
  if (count === 1) {
    charLines   = collect(people[0], appearanceKeys);
    outfitLines = collect(people[0], outfitKeys);
    poseLines   = collect(people[0], poseKeys);
  } else {
    charLines = people.map(function(p, i) {
      var f = collect(p, appearanceKeys);
      if (!f.length) return null;
      var isBoy = isBoyPerson(p);
      var label = allSame ? ((isBoy ? BPOS : POS)[i] || ((i + 1) + "人目")) : (isBoy ? "男の子" : "女の子");
      return label + "は" + f.join("、") + ".";
    }).filter(Boolean);
    outfitLines = people.map(function(p, i) {
      var f = collect(p, outfitKeys);
      if (!f.length) return null;
      var isBoy = isBoyPerson(p);
      var label = allSame ? ((isBoy ? BPOS : POS)[i] || ((i + 1) + "人目")) : (isBoy ? "男の子" : "女の子");
      return label + "の服装: " + f.join("、") + ".";
    }).filter(Boolean);
    poseLines = people.map(function(p, i) {
      var f = collect(p, poseKeys);
      if (!f.length) return null;
      var isBoy = isBoyPerson(p);
      var label = allSame ? ((isBoy ? BPOS : POS)[i] || ((i + 1) + "人目")) : (isBoy ? "男の子" : "女の子");
      return label + "のポーズ・構図: " + f.join("、") + ".";
    }).filter(Boolean);
  }

  // 人物以外の各グループ（シーン／スタイル・品質など）をグループ順のまま1行ずつ出力。
  // ただし quality フィールド（先頭のQで処理済み）と、元カテゴリ12（品質・質感・レンダリング）の
  // quality以外のフィールド（リアル質感向上タグ等）はここでは除外し、末尾にまとめる。
  // 「スタイル・品質」タブは元カテゴリ11と12がまとまっているため、フィールド単位で振り分ける。
  var globalLines = [];
  var qualityExtra = [];
  cats.filter(function(c){ return !c.isPerson; }).forEach(function(c) {
    var vals = [];
    c.fields.forEach(function(f) {
      if (f.key === 'quality') return;
      if (f.categoryOrder === 12) { qualityExtra = qualityExtra.concat(fGet(form, f.key)); return; }
      vals = vals.concat(fGet(form, f.key));
    });
    if (vals.length) globalLines.push(vals.join(", "));
  });

  var rows = [];
  if (Q.length) rows.push(Q.join(", "));
  if (countTag) rows.push(countTag);
  if (count === 1) {
    if (charLines.length)   rows.push(charLines.join(", "));
    if (outfitLines.length) rows.push(outfitLines.join(", "));
    if (poseLines.length)   rows.push(poseLines.join(", "));
  } else {
    charLines.forEach(function(l){ rows.push(l); });
    outfitLines.forEach(function(l){ rows.push(l); });
    poseLines.forEach(function(l){ rows.push(l); });
  }
  globalLines.forEach(function(l){ rows.push(l); });
  if (qualityExtra.length) rows.push(qualityExtra.join(", "));

  return rows.filter(function(r){ return r && r.trim(); }).join("\n");
}

// Anima以外の画像モデル（Krea 2 / GPT Image 2 / Nano Banana 2）共通のビルダー。
// タグ構成が画像モデル間で共通化されたため、人物・服装・共通カテゴリを
// カテゴリ順にカンマ区切りでまとめるシンプルな形式にしている。
function commonImageBuild(form) {
  const cats = form.imageCats || [];
  const people = (form.people && form.people.length > 0) ? form.people : [mkPerson(cats)];
  const groups = [];

  cats.forEach(function(cat) {
    if (cat.isPerson) {
      const vals = [];
      people.forEach(function(p) {
        cat.personFields.forEach(function(f) {
          const v = p[f.key];
          if (Array.isArray(v)) vals.push.apply(vals, v);
          else if (v) vals.push(v);
        });
      });
      if (vals.length) groups.push(vals);
    } else {
      const vals = [];
      cat.fields.forEach(function(f){ vals.push.apply(vals, fGet(form, f.key)); });
      if (vals.length) groups.push(vals);
    }
  });
  return groups.map(function(g){ return g.join(", "); }).join("\n");
}

// モデルごとのプロンプト作成ガイド。mkGenPrompt（アイデアから生成）と
// mkImageAnalysisPrompt（画像から再現）の両方から共通で参照する。
// 各モデルのガイドには「短いアイデア→肉付けされた出力」の具体例を必ず含めている。
// 抽象的な指示（「肉付けしてください」）だけでは弱いモデルでも従いやすいよう、
// 実際の変換例を見せることで期待する変化の大きさを直接示す狙い。
const MODEL_GUIDES = {
    anima: "あなたはAnima向けの高品質画像生成プロンプト専門家です。\n\n" +
      "【Animaプロンプトの絶対ルール】\n" +
      "・クオリティ/スコアタグは英語で出力（それ以外は日本語）\n" +
      "・タグは小文字・スペース区切り（score_Nのみアンダーバー）\n" +
      "・構成順: [quality英語] → [人数タグ] → [外見日本語] → [服装日本語] → [シーン日本語]\n" +
      "・beautiful detailed face, detailed eyes を必ず含める\n" +
      "・rim light on hair, subsurface scattering on skin でライティング品質UP\n" +
      "・英語のみで完結させることは絶対禁止。クオリティ/スコアタグ以外の外見・服装・シーンは必ず日本語のタグ・描写で構成すること（English Danbooruタグの羅列だけで終わらせないこと）\n" +
      "・ネガティブプロンプトは絶対に含めない\n\n" +
      "【品質を上げるAnima専用テクニック】\n" +
      "・year 2025, newest で最新の画風に\n" +
      "・(重要な特徴:1.2) で重み付け\n" +
      "・scenery タグで背景の精細さUP\n" +
      "・入力のタグ数が少ない（4〜5個程度）場合でも、出力は最低20〜30個のタグ相当まで肉付けする\n\n" +
      "【肉付けの実例】\n" +
      "入力アイデア「海辺に佇む黒髪の少女」→ 出力:\n" +
      "masterpiece, best quality, score_9, score_8_up, newest, 1girl, solo,\n" +
      "艶のある黒髪ロング、風になびく後れ毛、憂いを帯びた黒い瞳、長い睫毛、儚げな微笑み、\n" +
      "潮風になびく白いワンピース、裸足で波打ち際に立つ、\n" +
      "夕暮れの砂浜、水平線に沈む夕日、オレンジと紫のグラデーション、波の反射光、遠くに見えるカモメ, rim light on hair, subsurface scattering on skin, beautiful detailed face, detailed eyes\n" +
      "（3語の断片から髪質・表情・服装・光・背景の奥行きまで肉付けしている点に注目。英語タグはクオリティ関連のみで、外見・服装・シーンは全て日本語）",

    krea2: "あなたはKrea 2向けの高品質画像生成プロンプト専門家です。\n\n" +
      "【Krea 2プロンプトの絶対ルール】\n" +
      "・自然な日本語の文章で、キーワードの羅列ではなく「短いカメラ指示書（ショットブリーフ）」のように書く\n" +
      "・必ず名前を挙げる要素: 被写体、場所、カメラ（レンズ・角度）、光、スタイル、構図\n" +
      "・構成順: 被写体→スタイル→シーン→ライティング→ムード→品質\n" +
      "・ネガティブプロンプトは絶対に含めない\n\n" +
      "【Krea 2で品質を上げるテクニック】\n" +
      "・ライティングの描写が最重要（ゴールデンアワー、明暗のコントラスト、スタジオ照明など）光の方向・色温度まで具体的に\n" +
      "・レンズ感（85mmポートレートレンズ、被写界深度が浅い等）でプロの写真らしさを出す\n" +
      "・文末は「非常に精細で、受賞歴のある写真のような品質」のような品質表現で締める\n\n" +
      "【肉付けの実例（構成順どおりに改行していることにも注目）】\n" +
      "入力アイデア「海辺に佇む黒髪の少女」→ 出力:\n" +
      "潮風になびく艶やかな黒髪の若い女性が、夕暮れの海辺に静かに佇んでいる、フォトリアルでシネマティックなポートレートスタイル\n" +
      "波打ち際に柔らかな反射光が広がり、遠くに水平線が霞む\n" +
      "85mmポートレートレンズで撮影したような浅い被写界深度、ゴールデンアワーの温かい逆光が輪郭を縁取る\n" +
      "もの悲しくも美しい、静謐な雰囲気\n" +
      "非常に精細で受賞歴のある写真のような品質、シネマティックなカラーグレーディング\n" +
      "（3語の断片からレンズ・光・雰囲気まで具体的に描写を追加し、構成順の区分ごとに改行している点に注目）",

    gptImage2: "あなたはGPT Image 2向けの高品質画像生成プロンプト専門家です。\n\n" +
      "【GPT Image 2プロンプトの絶対ルール】\n" +
      "・詳細な日本語の文章形式で記述する（タグ並列NG）。プロのアートディレクターが撮影クルーに指示を出すように、具体的で意図が伝わる書き方をする\n" +
      "・最初の1〜2文で被写体・構図・スタイルの核を明確にする（重要な情報を後半に埋もれさせない）\n" +
      "・被写体の配置・視線・仕草は「全身が見える」「両手をそっと組んでいる」のように具体的に描写する\n" +
      "・「〜を舞台にする。」のように場所を1文で指定\n" +
      "・「雰囲気は〜。」のようにムードを1文で指定\n" +
      "・「〜のスタイルで描写する。」のようにスタイルを最後に1文で指定\n" +
      "・この型を守ることより、指定された被写体の外見・衣装・小物を全て文章に含めることを優先する。型に収まりきらない場合は、被写体を描写する文を複数文に分けてでも全要素を書き切ること（衣装や装飾品を省略しないこと）\n" +
      "・被写体の文／舞台の文／光と情景の文／雰囲気の文／スタイルの文は、それぞれ改行して別の行にする\n" +
      "・ネガティブプロンプトは絶対に含めない\n\n" +
      "【肉付けの実例（文の種類ごとに改行していることにも注目）】\n" +
      "入力アイデア「海辺に佇む黒髪の少女」→ 出力:\n" +
      "長く艶やかな黒髪を潮風になびかせながら、波打ち際に裸足で静かに立つ若い女性。伏し目がちに水平線を見つめ、両手をそっと胸の前で組んでいる。\n" +
      "夕暮れの砂浜を舞台にする。\n" +
      "水平線に沈む夕日が空をオレンジと紫に染め、逆光が彼女のシルエットを縁取る。\n" +
      "雰囲気はもの悲しくも美しく、静謐。\n" +
      "フォトリアルなシネマティックスタイルで描写する。最高品質。\n" +
      "（3語の断片から視線・手の仕草・光の当たり方まで具体的に描写を追加し、文の種類ごとに改行している点に注目）",

    nanoBanana2: "あなたはNano Banana 2向けの高品質画像生成プロンプト専門家です。\n\n" +
      "【Nano Banana 2プロンプトの絶対ルール】\n" +
      "・「簡潔」とは1つ1つのキーワードが短いという意味であり、入力にない新しいキーワードを創作しないという意味ではない。指定された要素（3〜4割）に加えて、光・雰囲気・スタイル・クオリティなど自分で考案した新しいキーワード（6〜7割）を必ず加えること\n" +
      "・シンプルで強力な日本語のキーワード・短いフレーズを厳選する（8〜20個が目安。ただし指定された要素を全て含めることを優先し、必要なら数を増やしてよい）\n" +
      "・曖昧な言葉（「良い」「綺麗」等）は避け、具体的で計測可能な表現にする\n" +
      "・構成順: 被写体→動作→シーン→ムード→スタイル→クオリティ\n" +
      "・ネガティブプロンプトは絶対に含めない\n\n" +
      "【品質を上げるテクニック】\n" +
      "・「壮大」「シネマティック」「ドラマチック」でスケール感UP\n" +
      "・「ボリューメトリックライト」「HDR」「ボケ味」で視覚クオリティUP\n\n" +
      "・構成順の区分（被写体/動作、シーン、ムード/スタイル、クオリティ）ごとに改行し、区分内はカンマ区切りにする\n\n" +
      "【肉付けの実例（区分ごとに改行していることにも注目）】\n" +
      "入力アイデア「海辺に佇む黒髪の少女」→ 出力:\n" +
      "黒髪の若い女性, 波打ち際に静かに佇む, 潮風になびく髪\n" +
      "夕暮れの砂浜, オレンジと紫のグラデーション空, 逆光のシルエット\n" +
      "もの悲しく美しいムード, シネマティック, ボリューメトリックライト\n" +
      "高精細, 8K\n" +
      "（3語の断片から動作・光・ムードまで具体的なキーワードに分解し、区分ごとに改行している点に注目）",

    wan: "あなたはWAN向けの高品質AI動画生成プロンプト専門家です。\n\n" +
      "【WANプロンプトの絶対ルール】\n" +
      "・品質タグを必ず先頭に配置\n" +
      "・「動き」の描写が最も重要（何がどう動くか具体的に）\n" +
      "・カメラワークは「カメラ: [移動方法]」で指定\n" +
      "・ネガティブプロンプトは絶対に含めない\n\n" +
      "【肉付けの実例】\n" +
      "入力アイデア「海辺を歩く少女」→ 出力:\n" +
      "高品質, 映画品質, 4K, 滑らかな動き\n黒髪の若い女性, 白いワンピース\n波打ち際をゆっくりと歩く, 髪と裾が潮風になびいている, 時折足元の波を見つめる\n夕日が水平線に沈み、空がオレンジ色に染まる, もの悲しくも美しい雰囲気\nカメラ: サイドからのトラッキングショット, 映画的スタイル\n" +
      "（短いアイデアから動きの機微・光・カメラワークまで肉付けしている点に注目）",

    veo: "あなたはGoogle Veo向けの高品質AI動画生成プロンプト専門家です。\n\n" +
      "【Google Veoプロンプトの絶対ルール】\n" +
      "・カメラムーブメントとアングルの指定が最重要\n" +
      "・シネマティックな映像語を使用\n" +
      "・構成順: 被写体・動き→カメラワーク→光・情景→雰囲気・映像美→クオリティ。区分ごとに改行する\n" +
      "・ネガティブプロンプトは絶対に含めない\n\n" +
      "【肉付けの実例（区分ごとに改行していることにも注目）】\n" +
      "入力アイデア「海辺を歩く少女」→ 出力:\n" +
      "夕暮れの海岸線をゆっくりと歩く黒髪の若い女性\n" +
      "ローアングルからのゆったりとしたトラッキングショット\n" +
      "波打ち際に反射する夕日、ゴールデンアワーの逆光\n" +
      "もの悲しくも美しいシネマティックな雰囲気、ハリウッド大作のような映像美\n" +
      "4K, フォトリアル\n" +
      "（短いアイデアからカメラワーク・光・映像美まで肉付けし、区分ごとに改行している点に注目）",

    ltx: "あなたはLTX-2.3向けの高品質AI動画生成プロンプト専門家です。\n\n" +
      "【LTX-2.3プロンプトの絶対ルール】\n" +
      "・品質タグを必ず最初に配置（このモデルの最重要ルール）\n" +
      "・ショットサイズとカメラモーションを明確に\n" +
      "・ネガティブプロンプトは絶対に含めない\n\n" +
      "【肉付けの実例】\n" +
      "入力アイデア「海辺を歩く少女」→ 出力:\n" +
      "最高品質, 4K, sharp\n黒髪の若い女性, 白いワンピース\n夕暮れの砂浜の中で\nミディアムショット, サイドトラッキング\nもの悲しくも美しいシネマティックな美学\n" +
      "（短いアイデアからショットサイズ・カメラモーション・美学まで肉付けしている点に注目）",

    minimax: "あなたはMiniMax向けの高品質AI動画生成プロンプト専門家です。\n\n" +
      "【MiniMaxプロンプトの絶対ルール】\n" +
      "・感情・トーンの指定が映像全体の雰囲気を決定する（最重要）\n" +
      "・被写体→動き→感情→場所→カメラ→スタイルの順\n" +
      "・ネガティブプロンプトは絶対に含めない\n\n" +
      "【肉付けの実例】\n" +
      "入力アイデア「海辺を歩く少女」→ 出力:\n" +
      "黒髪の若い女性, 波打ち際をゆっくりと歩く, もの悲しくも穏やか\n潮風になびく白いワンピース\n夕暮れの海岸, サイドからのトラッキングショット\nシネマティックスタイル\n滑らかな動き, オレンジ色の夕焼け, 4K\n" +
      "（短いアイデアから感情・動き・光まで肉付けしている点に注目）",
};

function mkGenPrompt(model, idea, fs, people, aspectRatio) {
  var isVid = ["wan","veo","ltx","minimax"].indexOf(model.id) >= 0;
  var multiChar = people && people.length > 1;
  var hasMinor = (people || []).some(function(p){ return MINOR_PERSON_TYPES.indexOf(p.personType) >= 0; });

  var guide = MODEL_GUIDES[model.id] || ("あなたは"+model.name+"向けのAI"+(isVid?"動画":"画像")+"生成プロンプト専門家です。");
  var parts = [];
  if (idea) parts.push("【アイデア（このイメージを核に、具体的な描写へ大きく膨らませる出発点）】\n"+idea);
  if (fs)   parts.push("【必ず反映する要素（単語をそのまま並べるのではなく、描写に発展させること）】\n"+fs);
  if (multiChar) parts.push("【複数人物の指定】\n複数キャラクターが登場します。同性同士は左/右などの位置で、異性同士は男の子/女の子で識別して描写してください。");
  if (aspectRatio) {
    var isTall = ["3:4","9:16"].indexOf(aspectRatio) >= 0;
    var isWide = ["4:3","16:9","21:9"].indexOf(aspectRatio) >= 0;
    var arHint = isTall ? "縦長の構図（全身や近距離のポートレート、上下方向に広がる情景など）が映えるように意識すること"
      : isWide ? "横長の構図（環境の広がりや複数人物、パノラマ的な情景など）が映えるように意識すること"
      : "正方形の画面に収まるバランスの良い構図を意識すること";
    parts.push("【画面比率】\n出力のアスペクト比は "+aspectRatio+" です。"+arHint+"。");
  }

  // 「言い換え」ではなく「創作」であることを最優先で伝える（末尾に置くより先頭に置いた方が
  // 効きやすいモデルがあるため、ガイド本文より前に配置している）。
  // 複数分野の専門家チームという設定にすることで、外見・衣装・光・構図それぞれの
  // 肉付けをバランスよく行わせる（特に衣装が省略されがちな問題への対策としてファッション
  // デザイナー視点を明示している）。
  return "【あなたのチーム: 複数分野の専門家として取り組むこと】\n" +
    "あなたは以下の専門家たちが1つのチームを組んで共同作業しているつもりで取り組んでください。\n" +
    "・プロの" + (isVid?"映像ディレクター":"イラストレーター／フォトグラファー") + ": 構図・画角・光・全体の画づくりを担当\n" +
    "・プロのファッションデザイナー: 衣装やアクセサリーのディテール（素材感・シルエット・着こなし）を一切省略せず具体化する担当\n" +
    "・" + model.name + "向けのプロンプトエンジニア: 上記の内容をモデル別ルールに沿った書き方に最終調整する担当\n\n" +
    "【最優先の心構え: これは要約・言い換えのタスクではなく、創作のタスクです】\n" +
    "これから渡すアイデアやタグは、5〜20文字程度の短い断片に過ぎません。あなたの仕事は、そこから" + model.name + "が最高品質の" + (isVid?"映像":"絵") + "を作れるだけの情報量を持つ具体的なプロンプトを『創作』することです。\n" +
    "入力の単語をほぼそのまま並べ替えただけの出力、あるいは単語を右から左に受け流しただけの出力は失敗と見なします。\n\n" +
    guide + "\n\n" + parts.join("\n\n") +
    "\n\n【肉付けの観点（入力に無くても必ず具体的な描写を追加すること）】\n" +
    "・外見: 表情の機微、視線、仕草、体のひねりや動き\n" +
    "・衣装: 素材感、色の組み合わせ、着こなし方、アクセサリーとの調和（ファッションデザイナーの視点で）\n" +
    "・光: 光源の方向、色温度、硬さ/柔らかさ、時間帯\n" +
    "・構図: カメラの位置・角度・ショットサイズ\n" +
    "・雰囲気: そのシーンならではの空気感、感情の機微\n" +
    "・背景・舞台設定: 何が写り込んでいるか、奥行き、その場所らしいディテール\n\n" +
    "【長さの目安】\n" +
    "全体で日本語300〜500文字程度を目安にすること。これより短いと肉付け不足、長すぎると冗長で生成に時間がかかるだけでなく要点がぼやける。全項目を薄く網羅するより、印象的な要素を選んで密度高く描写すること。\n\n" +
    (hasMinor ?
      "【年齢表現への配慮（重要・最優先）】\n登場人物に未成年を示す人物属性が含まれています。体つきの起伏や肌の露出・質感を強調するような、性的・扇情的に読める身体描写は避けてください（肌の色味に軽く触れる程度の、年齢相応の健全な描写は問題ありません）。表情・仕草・服装・雰囲気・背景の具体化を中心に高品質さを表現すること。\n\n"
      : "") +
    "【厳守事項（最優先・他のどの指示より優先する）】\n" +
    "・アイデア、および「必ず反映する要素」に列挙されたタグは、1つの例外もなく最終的な出力の中に明示的な形で含めること。特に衣装・アクセサリーは省略されがちなので、ファッションデザイナー担当として絶対に見落とさないこと。これはモデル別ルールの文字数・キーワード数の目安よりも優先する（目安を超えても構わないので、指定要素を絶対に削らないこと）。\n" +
    "・出力を確定する前に、アイデアと『必ず反映する要素』の一覧を1項目ずつ見直し、それぞれが文章中に反映されているか自己チェックすること。抜けている項目が1つでもあれば、必ず追加してから出力すること。\n" +
    "・そのうえで、指定されていない部分にも積極的にディテールを創作して補うこと。\n" +
    "・「かわいい」「美しい」のような抽象語だけで終わらせず、なぜそう感じるかが伝わる具体的な表現を選ぶこと。\n\n" +
    "【出力フォーマット厳守（改行ルール）】\n" +
    "・ポジティブプロンプトのみ出力。ネガティブは絶対含めない。\n" +
    "・読みやすさのため、モデル別ルールの「構成順」（例: 被写体→スタイル→シーン→ライティング→ムード→品質）に示された区分ごとに必ず改行し、1つの行に複数の区分の内容を混在させないこと。区分内の要素は同じ行にまとめる。\n" +
    "・空白行（連続する改行）は禁止。各行は必ず内容のある1文またはカンマ区切りの語群にすること。\n" +
    "・前置き・説明文なし。プロンプト本文のみ。\n" +
    "・上記モデル別ルールで英語指定された部分（品質・スコアタグ等）を除き、必ず日本語で記述すること。英語への変換はこの後の別ステップ（「英語に変換」ボタン）で行うため、ここでは勝手に英語化しないこと。";
}

// ネガティブプロンプト生成。ポジティブ側と同時にAIで作成し、常に英語のカンマ区切り
// キーワードで出力する（ポジティブと違い、JA/EN切り替えは行わない）。
function mkNegPrompt(model, idea, fs) {
  var isVid = ["wan","veo","ltx","minimax"].indexOf(model.id) >= 0;
  var parts = [];
  if (idea) parts.push("【アイデア】\n" + idea);
  if (fs)   parts.push("【タグ】\n" + fs);

  return "あなたはAI" + (isVid ? "動画" : "画像") + "生成のネガティブプロンプト専門家です。\n\n" +
    "以下のポジティブ側の内容をもとに、" + model.name + "向けのネガティブプロンプトを作成してください。\n\n" +
    parts.join("\n\n") + "\n\n" +
    "【ルール】\n" +
    "・必ず英語のカンマ区切りキーワードのみで出力する（文章にしない）\n" +
    "・低品質・崩れた解剖学的構造・手や指の破綻・ぼやけ・余計なテキストや透かしなど、一般的に避けたい要素を厳選する（最小限に。8〜15個程度が目安）\n" +
    "・ポジティブ側で意図的に指定されている特徴（傷跡、獣耳、特定の表情など）を打ち消すようなキーワードは含めない\n" +
    "・説明文や前置きは一切書かず、キーワードのみをカンマ区切りで1行で出力する";
}

// 画像から再現プロンプトを生成する（画像から生成モード）。
// アイデア・タグの代わりに、アップロードされた画像そのものを観察対象として
// 同じモデル別ルール（MODEL_GUIDES）に沿ったプロンプトを組み立てさせる。
// 各モデルの実際の高再現プロンプト作成手法（Danbooruタグ系モデルは構造化タグの精度重視、
// 自然言語系モデルはカメラ・レンズ用語を含む具体的な写真描写重視）を踏まえて調整している。
function mkImageAnalysisPrompt(model) {
  var isVid = ["wan","veo","ltx","minimax"].indexOf(model.id) >= 0;
  var isTagBased = model.id === 'anima'; // Danbooruタグ系（構造化タグの精度が再現度を左右する）
  var guide = MODEL_GUIDES[model.id] || ("あなたは"+model.name+"向けのAI"+(isVid?"動画":"画像")+"生成プロンプト専門家です。");

  var methodNote = isTagBased
    ? "・" + model.name + "はDanbooruタグベースのモデルです。曖昧な文章表現ではなく、Danbooruで一般的に使われる粒度のタグ的な言葉（例:「後ろで一つに結んだ長い黒髪」のような具体タグ相当の表現）に分解することが再現度を最も左右します。マイナーすぎる独自表現より、よく使われる一般的な言い回しを優先してください。\n"
    : "・" + model.name + "は自然言語ベースのモデルです。「被写体→動作→設定→スタイル」の順で重要な情報を先に書き、具体的で計測可能な表現（色名、光の方向、構図）を使ってください。写真的な画像であれば、レンズ・被写界深度・アングルなど撮影条件も言葉にすると再現度が上がります。\n";

  return guide + "\n\n" +
    "【最重要ミッション】\n" +
    "あなたの唯一の目的は、添付された画像を画像生成AIでできる限り同一に再現できるプロンプトを作ることです。\n" +
    "アイデア文からの創作ではなく、目の前の画像を精密に「読み取る」作業だと考えてください。\n\n" +
    "【再現度を上げるための方針】\n" +
    methodNote +
    "・重要度の高い要素（主役の被写体・最も目を引く特徴）を先に、細部の装飾は後に書くこと。\n" +
    "・「かわいい」「綺麗」のような主観的・曖昧な形容詞だけで済ませず、色・形・角度・素材など客観的に判別できる具体的な特徴に置き換えること。\n\n" +
    "【観察手順】\n" +
    "1. まず画像全体を隅々まで観察する。人物・物・背景・光・色・質感のすべてに注目する。\n" +
    "2. 以下の項目を1つずつ具体的に言語化する（画像に存在しない項目は省略してよいが、存在する項目は絶対に見落とさないこと）。\n" +
    "   ・人物属性（年齢層・性別・種族・体型スタイル）\n" +
    "   ・顔・目・表情（目の形・色、眉、口元、表情の種類、頬の赤み等）\n" +
    "   ・髪型・髪色（色の階調、長さ、質感、分け目、後れ毛の有無）\n" +
    "   ・衣装・ファッション（アイテムの種類、色、柄、素材感、着崩し方）\n" +
    "   ・アクセサリー・小物（種類、位置、色）\n" +
    "   ・ポーズ・構図・視点（体の向き、手足の位置、カメラアングル、ショットサイズ）\n" +
    "   ・シーン・ロケーション（場所、時間帯）\n" +
    "   ・環境・ライティング・天候（光源の方向・色温度、影の付き方、天候）\n" +
    "   ・アートスタイル・写真表現（実写かイラストか、画風、レンズ感・被写界深度、色調・トーン）\n" +
    "   ・品質・質感（解像感、ディテールの密度）\n" +
    "3. 固有のキャラクターや既存作品に似ている場合、一般に知られた特徴の呼び方があればそれを使い、断定できない場合は見たままの視覚的特徴で描写する（不確かな固有名詞を無理に当てはめないこと）。\n" +
    "4. 上記をすべて統合し、" + model.name + "向けの1つのプロンプトにまとめる。\n\n" +
    "【厳守事項】\n" +
    "・画像に無い要素を勝手に創作しないこと（画像内の情報から自然に推測できる範囲は許容する）。\n" +
    "・人物が複数写っている場合は、同性同士は左/右などの位置で、異性同士は男の子/女の子で識別して描写すること。\n\n" +
    "【出力フォーマット厳守】\n" +
    "・" + model.name + "向けのポジティブプロンプトのみ出力。ネガティブは絶対含めない。\n" +
    "・空白行なし（カテゴリは改行1つで区切る）。\n" +
    "・手順の説明や前置きは一切書かず、完成したプロンプト本文のみを出力すること。\n" +
    "・上記モデル別ルールで英語指定された部分（品質・スコアタグ等）を除き、必ず日本語で記述すること。英語への変換は別ステップ（「英語に変換」ボタン）で行うため、ここでは勝手に英語化しないこと。";
}

function mkTranslatePrompt(model, jaPrompt) {
  var guides = {
    anima: "Animaハイブリッドプロンプト変換専門家。タグは小文字・スペース区切り。score タグのみアンダーバー。\n" +
      "左の女の子は→The girl on the left has / 右の女の子は→The girl on the right has\n" +
      "男の子は→The boy has / 女の子は→The girl has / の服装:→'s outfit:\n" +
      "各文末にピリオド。改行構造を保持。(tag:1.2) はそのまま保持。",
    krea2: "Krea 2向けプロンプト変換専門家。日本語を自然な英語フレーズに変換。改行構造を保持。",
    gptImage2: "GPT Image 2向けプロンプト変換専門家。場所:→Set in、ムードは→The mood is。スタイルはRendered in [style] style.で文末に。改行構造を保持。",
    nanoBanana2: "Nano Banana 2向けプロンプト変換専門家。壮大→epic, 神秘的→mysterious, アニメ→anime。改行構造を保持。",
    wan: "WAN向け動画プロンプト変換専門家。固定ショット→static shot, ドリーイン→dolly in。カメラ:→Camera:。改行構造を保持。",
    veo: "Google Veo向け動画プロンプト変換専門家。映画制作専門用語を使用。ドリーイン→dolly in, ドローン→drone flyover。改行構造を保持。",
    ltx: "LTX-2.3向け動画プロンプト変換専門家。品質タグ先頭固定。超広角→extreme wide shot, ミディアム→medium shot, 美学→aesthetic。改行構造を保持。",
    minimax: "MiniMax向け動画プロンプト変換専門家。喜び→joyful, 壮大→epic, もの悲しい→melancholic, 穏やか→serene。改行構造を保持。",
  };
  var guide = guides[model.id] || (model.name+"向けプロンプト変換専門家。日本語を英語に変換。改行構造を保持。");
  return guide + "\n\n日本語プロンプト:\n" + jaPrompt + "\n\n英語のみ（改行構造保持）。";
}

// ═══════════════════════════════════════════
// 画像モデル設定
// ═══════════════════════════════════════════
// cats はタグの読み込み完了後に app.js から差し込まれる（全モデル共通・動的）。
const IMG_MODELS = {
  anima: {
    id:"anima", name:"Anima", icon:"✨", color:"#C23B72", // 白背景でのコントラストを確保するため元の#E879A0より濃くしたピンク
    label:"Danbooru+自然言語", note:"Qwen LLM",
    tip:"タグは小文字・スペース区切り（score_Nのみアンダーバー）/ @アーティスト名",
    multiPerson: true,
    cats: [],
    build: animaBuild,
  },
  krea2: {
    id:"krea2", name:"Krea 2", icon:"🪄", color:"#6D28D9", label:"自然言語・スタイル重視", // 元の#9D7FEAを白背景用に濃く調整
    tip:"被写体→スタイル→ライティング→ムード→品質の順で指定",
    multiPerson: true,
    cats: [],
    build: commonImageBuild,
  },
  gptImage2: {
    id:"gptImage2", name:"GPT Image 2", icon:"🖌️", color:"#047857", label:"自然言語・説明的", // 元の#2EBF8Aを白背景用に濃く調整
    tip:"文章形式で詳しく描写。スタイルを最後に「Rendered in X style.」で指定",
    multiPerson: true,
    cats: [],
    build: commonImageBuild,
  },
  nanoBanana2: {
    id:"nanoBanana2", name:"Nano Banana 2", icon:"⚡", color:"#B45309", label:"シンプル・高速", // 元の#F0A317を白背景用に濃く調整
    tip:"3〜12個の強力なキーワードが最効果。epic, cinematic, volumetric light で品質UP",
    multiPerson: true,
    cats: [],
    build: commonImageBuild,
  },
};

// ═══════════════════════════════════════════
// 動画モデル設定（今回のタグDB移行の対象外。従来どおり固定タグ）
// ═══════════════════════════════════════════
const VID_MODELS = {
  wan: {
    id:"wan", name:"WAN", icon:"🌊", color:"#0E7490", label:"モーション重視", // 元の#22D3EEを白背景用に濃く調整
    tip:"品質タグ先頭 / 「動き」を具体的に / カメラ: ドリーイン などで指定",
    cats: [
      {id:"character",label:"被写体",icon:"👤",fields:[{key:"subject",label:"被写体",chips:["若い女性","男性","子供","動物","群衆","壮大な自然","都市の光景"]}]},
      {id:"outfit",label:"服装",icon:"👗",fields:[{key:"clothing",label:"服装",chips:["白いドレス","カジュアルな服装","スーツ","和服","戦闘服"]}]},
      {id:"scene",label:"シーン",icon:"🏙️",fields:[
        {key:"scene",      label:"シーン",      chips:["竹林","都市","海","山","森","砂漠","草原","スタジオ","室内"]},
        {key:"motion",     label:"動き",        chips:["静止","ゆっくり歩く","走る","回転","風に揺れる","飛ぶ","踊る","振り返る"]},
        {key:"lighting",   label:"ライティング",chips:["日光","月光","ネオンライト","逆光","ソフトライト","ゴールデンアワー"]},
        {key:"atmosphere", label:"雰囲気",      chips:["平和","幻想的","緊張感","ドラマチック","神秘的","エネルギッシュ"]},
        {key:"pose",       label:"ポーズ",      chips:["立ち姿","歩いている","振り返り","カメラを見ている","座っている"]},
      ]},
      {id:"style",label:"スタイル",icon:"🎬",fields:[
        {key:"camera",label:"カメラワーク",  chips:["固定ショット","スローパン左","スローパン右","ドリーイン","ドリーアウト","手持ち","クレーンショット"]},
        {key:"style", label:"映像スタイル", chips:["映画的","ドキュメンタリー","アニメ","フォトリアル","フィルムノワール","ヴィンテージ"]},
      ]},
      {id:"quality",label:"クオリティ",icon:"⭐",fields:[{key:"quality",label:"品質タグ",chips:["高品質","映画品質","精緻","滑らかな動き","4K"]}]},
    ],
    build: function(form){
      var camSty=[].concat(fGet(form,"camera").map(function(c){return "カメラ: "+c;})).concat(fGet(form,"style").map(function(s){return s+"スタイル";}));
      var groups=[fGet(form,"quality"),[].concat(fGet(form,"subject")).concat(fGet(form,"clothing")),["scene","motion","lighting","atmosphere","pose"].reduce(function(a,k){return a.concat(fGet(form,k));},[]),camSty].filter(function(g){return g.length>0;});
      return groups.map(function(g){return g.join(", ");}).join("\n");
    },
  },

  veo: {
    id:"veo", name:"Google Veo", icon:"🎬", color:"#2563EB", label:"シネマティック", // 元の#5B99F5を白背景用に濃く調整
    tip:"カメラムーブメントとアングルが最重要 / dolly in, drone flyover, golden hour",
    cats: [
      {id:"character",label:"被写体",icon:"👤",fields:[
        {key:"subject",label:"被写体",chips:["人物","壮大な風景","東京の風景","都市","自然","宇宙","水中"]},
        {key:"motion", label:"動作",  chips:["歩く","走る","飛ぶ","群衆","落下","揺れる","回転"]},
      ]},
      {id:"outfit",label:"服装",icon:"👗",fields:[{key:"clothing",label:"服装",chips:["普段着","正装","戦闘服","伝統衣装","スポーツウェア"]}]},
      {id:"scene",label:"シーン",icon:"🏙️",fields:[
        {key:"cameraAngle",   label:"カメラアングル",    chips:["アイレベル","鳥瞰","ローアングル","真上から","ダッチアングル","肩越し"],single:true},
        {key:"cameraMovement",label:"カメラムーブメント",chips:["固定","スローパン","ドリーイン","ドリーアウト","チルトアップ","トラッキング","ドローン","ウィップパン"],single:true},
        {key:"lighting",      label:"ライティング",      chips:["ゴールデンアワー","ブルーアワー","強い昼光","曇り空","ドラマチックスタジオ","ネオン市街","月光","自然光"]},
        {key:"pose",          label:"被写体の動き",       chips:["歩いている","振り返る","立ち尽くしている","走っている","踊っている"]},
      ]},
      {id:"style",label:"スタイル",icon:"🎬",fields:[{key:"cinematicStyle",label:"シネマスタイル",chips:["ハリウッド大作","インディーズ映画","ドキュメンタリー","MVスタイル","自然ドキュメンタリー","CM","フィルムノワール"]}]},
      {id:"quality",label:"クオリティ",icon:"⭐",fields:[{key:"quality",label:"品質タグ",chips:["4K","映画的","フォトリアル","高フレームレート","プロ品質"]}]},
    ],
    build: function(form){
      var cam=[].concat(fGet(form,"cameraMovement")).concat(fGet(form,"cameraAngle"));
      var groups=[[].concat(fGet(form,"subject")).concat(fGet(form,"motion")).concat(fGet(form,"pose")),cam,fGet(form,"clothing"),[].concat(fGet(form,"lighting").map(function(l){return l+"の照明";})).concat(fGet(form,"cinematicStyle").map(function(s){return s+"スタイル";})),fGet(form,"quality")].filter(function(g){return g.length>0;});
      return groups.map(function(g){return g.join(", ");}).join("\n");
    },
  },

  ltx: {
    id:"ltx", name:"LTX-2.3", icon:"▶️", color:"#7C3AED", label:"高速・リアルタイム", // 元の#A78BFAを白背景用に濃く調整
    tip:"品質タグを必ず最初に配置（このモデルの最重要ルール）",
    cats: [
      {id:"character",label:"被写体",icon:"👤",fields:[{key:"subject",label:"被写体",chips:["侍","巨大メカ","女性","モンスター","メカ","風景","都市","自然"]}]},
      {id:"outfit",label:"服装",icon:"👗",fields:[{key:"clothing",label:"服装・装備",chips:["サイバーアーマー","普段着","和服","SF戦闘服","ファンタジー衣装","魔法使いのローブ"]}]},
      {id:"scene",label:"シーン",icon:"🏙️",fields:[
        {key:"setting",label:"舞台",       chips:["都市","森","廃墟","宇宙","海底","砂漠","雪山","工場","ネオンの路地","古代神殿の廃墟"]},
        {key:"camera", label:"ショット",   chips:["超広角ショット","広角ショット","ミディアムショット","クローズアップ","超クローズアップ"],single:true},
        {key:"motion", label:"カメラモーション",chips:["固定","スローパン左","スローパン右","ズームイン","ズームアウト","前方トラッキング"],single:true},
        {key:"pose",   label:"ポーズ",     chips:["立っている","飛んでいる","戦っている","走っている","倒れている"]},
      ]},
      {id:"style",label:"スタイル",icon:"🎨",fields:[{key:"aesthetic",label:"ビジュアルスタイル",chips:["映画的","アニメ","リアル","絵画風","サイバーパンク","ファンタジー","レトロ映画","ドキュメンタリー"]}]},
      {id:"quality",label:"クオリティ",icon:"⭐",fields:[{key:"quality",label:"品質タグ（先頭必須）",chips:["最高品質","高解像度","シャープ","精緻","4K","フィルムグレイン"]}]},
    ],
    build: function(form){
      var groups=[fGet(form,"quality"),[].concat(fGet(form,"subject")).concat(fGet(form,"clothing")),fGet(form,"setting").map(function(s){return s+"の中で";}),[].concat(fGet(form,"camera")).concat(fGet(form,"motion")).concat(fGet(form,"pose")),fGet(form,"aesthetic").map(function(a){return a+"な美学";})].filter(function(g){return g.length>0;});
      return groups.map(function(g){return g.join(", ");}).join("\n");
    },
  },

  minimax: {
    id:"minimax", name:"MiniMax", icon:"🌟", color:"#BE185D", label:"多様スタイル対応", // 元の#F06BA8を白背景用に濃く調整
    tip:"感情・トーンの指定が映像の雰囲気を決定する（最重要）",
    cats: [
      {id:"character",label:"被写体",icon:"👤",fields:[
        {key:"subject", label:"被写体",      chips:["若い女性","男性","動物","ロボット","ドラゴン","カップル","建物","自然"]},
        {key:"action",  label:"アクション",  chips:["歩く","走る","回転","ジャンプ","踊る","飛ぶ","静止"]},
        {key:"emotion", label:"感情・トーン", chips:["喜び","神秘的","ロマンティック","壮大","もの悲しい","緊張感","遊び心","穏やか"]},
      ]},
      {id:"outfit",label:"服装",icon:"👗",fields:[{key:"clothing",label:"服装",chips:["エレガントなドレス","カジュアルな服装","戦闘服","伝統衣装","宇宙服","スポーツウェア"]}]},
      {id:"scene",label:"シーン",icon:"🏙️",fields:[
        {key:"scene", label:"シーン",         chips:["桜の公園","サイバーパンクの都市","霧の山々","海","宇宙","廃墟","城","砂漠"]},
        {key:"camera",label:"カメラアングル", chips:["正面","サイドビュー","真上から","クローズアップ","広角","トラッキング","空撮"],single:true},
        {key:"pose",  label:"ポーズ",         chips:["立っている","歩いている","踊っている","飛んでいる","座っている"]},
      ]},
      {id:"style",label:"スタイル",icon:"🎨",fields:[{key:"style",label:"スタイル",chips:["リアル","アニメ","3Dアニメ","カートゥーン","映画的","アーティスティック","ヴィンテージ"]}]},
      {id:"quality",label:"クオリティ",icon:"⭐",fields:[{key:"extra",label:"追加詳細",chips:["滑らかな動き","鮮やかな色彩","精緻なテクスチャ","シネマティック","4K"]}]},
    ],
    build: function(form){
      var groups=[["subject","action","emotion"].reduce(function(a,k){return a.concat(fGet(form,k));},[]),fGet(form,"clothing"),["scene","camera","pose"].reduce(function(a,k){return a.concat(fGet(form,k));},[]),fGet(form,"style"),fGet(form,"extra")].filter(function(g){return g.length>0;});
      return groups.map(function(g){return g.join(", ");}).join("\n");
    },
  },
};
