// ── 共通ヘルパー ─────────────────────────────────────────────────
const QEN = {
  "マスタピース":"masterpiece","最高品質":"best quality","ハイクオリティ":"high quality",
  "スコア9":"score_9","スコア8":"score_8","スコア7":"score_7",
  "スコア8up":"score_8_up","スコア7up":"score_7_up",
  "年2025":"year 2025","最新":"newest","とても美的":"very aesthetic",
  "高解像度":"highres","absurdres":"absurdres","公式アート":"official art",
  "風景":"scenery",
};
const REN  = { "安全":"safe","軽い色気":"sensitive" };
const GMAP = { "少女":"girl","少年":"boy","子供":"child","成人女性":"woman","成人男性":"man" };
const POS  = ["左の女の子","右の女の子","中央の女の子","4人目の女の子"];
const BPOS = ["左の男の子","右の男の子","中央の男の子","4人目の男の子"];

function fGet(form, key) {
  const v = form[key] || {};
  return [...(v.chips || []), (v.text || '').trim()].filter(Boolean);
}
function mkPerson() {
  return { gender:"少女", expression:[], hair:[], eyes:[], outfit:[], accessory:[] };
}

const CHAR_CHIPS = {
  gender:     { label:"タイプ", chips:["少女","少年","子供","成人女性","成人男性"], single:true },
  expression: { label:"表情",   chips:["笑顔","喜び","クール","照れ顔","驚き","悲しそう","怒り","恥ずかしそう","無表情","眠そう","得意げ","泣きそう","にっこり","困惑","含み笑い","キリっとした"] },
  hair:       { label:"髪色・髪型", chips:["黒髪","金髪","茶髪","白髪","赤髪","青髪","ピンク髪","紫髪","銀髪","橙髪","グラデーション髪","ロングヘア","ショートヘア","ミディアムヘア","セミロング","ツインテール","ポニーテール","ツーサイドアップ","お下げ","ウェーブヘア","ボブカット","サイドテール","アシメ"] },
  eyes:       { label:"目",     chips:["青い瞳","緑の瞳","赤い瞳","茶色の瞳","金の瞳","紫の瞳","オッドアイ","ヘーゼルの瞳","橙の瞳","銀の瞳","澄んだ瞳","潤んだ瞳","大きな瞳","細い目","垂れ目","つり目"] },
};
const OUTFIT_CHIPS = {
  outfit:    { label:"服装",         chips:["セーラー服","制服","カジュアル","ワンピース","着物","浴衣","スーツ","パーカー","ニット","カーディガン","Yシャツ","ブレザー","コート","水着","ゴスロリ","メイド服","チャイナドレス","ジャージ","ファンタジーアーマー","魔法少女","ドレス"] },
  accessory: { label:"アクセサリー", chips:["ネックレス","チョーカー","イヤリング","ヘアピン","リボン","ヘアバンド","ベレー帽","帽子","眼鏡","サングラス","手袋","マント","指輪","腕輪","ブーツ","マフラー","スカーフ","ヘッドフォン","ヘッドドレス"] },
};

function animaBuild(form) {
  const people = (form.people && form.people.length > 0) ? form.people : [mkPerson()];
  const count  = people.length;
  const Q = fGet(form,"quality").map(function(q){ return QEN[q]||q; });
  const R = REN[(form.rating && form.rating.chips && form.rating.chips[0])] ||
            (form.rating && form.rating.chips && form.rating.chips[0]) || "";
  const boyCount  = people.filter(function(p){ var g=GMAP[p.gender||"少女"]; return g==="boy"||g==="man"; }).length;
  const girlCount = count - boyCount;
  var countTag = "";
  if (count === 1) {
    var isBoy = GMAP[people[0].gender||"少女"]==="boy"||GMAP[people[0].gender||"少女"]==="man";
    countTag = (isBoy?"1boy":"1girl")+", solo";
  } else {
    var cParts=[];
    if (girlCount>0) cParts.push(girlCount===1?"1girl":girlCount+"girls");
    if (boyCount>0)  cParts.push(boyCount===1?"1boy":boyCount+"boys");
    countTag = cParts.join(", ")+", duo";
  }
  var allSame = boyCount===0||girlCount===0;
  var charLines=[], outfitLines=[];
  if (count===1) {
    var p=people[0];
    charLines  = [].concat(p.expression||[]).concat(p.hair||[]).concat(p.eyes||[]);
    outfitLines= [].concat(p.outfit||[]).concat(p.accessory||[]);
  } else {
    charLines = people.map(function(p,i){
      var f=[].concat(p.expression||[]).concat(p.hair||[]).concat(p.eyes||[]);
      if(!f.length) return null;
      var isBoy=GMAP[p.gender||"少女"]==="boy"||GMAP[p.gender||"少女"]==="man";
      var label=allSame?(isBoy?BPOS:POS)[i]||((i+1)+"人目"):(isBoy?"男の子":"女の子");
      return label+"は"+f.join("、")+".";
    }).filter(Boolean);
    outfitLines = people.map(function(p,i){
      var f=[].concat(p.outfit||[]).concat(p.accessory||[]);
      if(!f.length) return null;
      var isBoy=GMAP[p.gender||"少女"]==="boy"||GMAP[p.gender||"少女"]==="man";
      var label=allSame?(isBoy?BPOS:POS)[i]||((i+1)+"人目"):(isBoy?"男の子":"女の子");
      return label+"の服装: "+f.join("、")+".";
    }).filter(Boolean);
  }
  var pose=fGet(form,"pose");
  var Sc=["scene","background","lighting","atmosphere"].reduce(function(a,k){ return a.concat(fGet(form,k)); },[]);
  var St=["artStyle","colorPalette"].reduce(function(a,k){ return a.concat(fGet(form,k)); },[]);
  var rows=[];
  if(Q.length||R) rows.push([].concat(Q).concat(R?[R]:[]).join(", "));
  if(countTag) rows.push(countTag);
  if(count===1){
    if(charLines.length)   rows.push(charLines.join(", "));
    if(outfitLines.length) rows.push(outfitLines.join(", "));
    if(pose.length)        rows.push(pose.join(", "));
  } else {
    charLines.forEach(function(l){ rows.push(l); });
    outfitLines.forEach(function(l){ rows.push(l); });
    if(pose.length)        rows.push(pose.join(", "));
  }
  if(St.length) rows.push(St.join(", "));
  if(Sc.length) rows.push(Sc.join(", "));
  return rows.filter(function(r){ return r&&r.trim(); }).join("\n");
}

function genericBuild(model, form) {
  var groups = model.cats.map(function(cat){
    return cat.fields.reduce(function(a,f){ return a.concat(fGet(form,f.key)); },[]);
  }).filter(function(g){ return g.length>0; });
  return groups.map(function(g){ return g.join(", "); }).join("\n");
}

function mkGenPrompt(model, idea, fs, people) {
  var isVid = ["wan","veo","ltx","minimax"].indexOf(model.id) >= 0;
  var multiChar = people && people.length > 1;

  var modelGuides = {
    anima: "あなたはAnima向けの高品質画像生成プロンプト専門家です。\n\n" +
      "【Animaプロンプトの絶対ルール】\n" +
      "・クオリティ/スコアタグは英語で出力（それ以外は日本語）\n" +
      "・タグは小文字・スペース区切り（score_Nのみアンダーバー）\n" +
      "・構成順: [quality英語] → [人数タグ] → [外見日本語] → [服装日本語] → [シーン日本語]\n" +
      "・beautiful detailed face, detailed eyes を必ず含める\n" +
      "・rim light on hair, subsurface scattering on skin でライティング品質UP\n" +
      (multiChar ? "・複数キャラ: 同性は左/右の位置で識別、異性は男の子/女の子で識別\n" : "") +
      "・ネガティブプロンプトは絶対に含めない\n\n" +
      "【品質を上げるAnima専用テクニック】\n" +
      "・year 2025, newest で最新の画風に\n" +
      "・(重要な特徴:1.2) で重み付け\n" +
      "・scenery タグで背景の精細さUP",

    krea2: "あなたはKrea 2向けの高品質画像生成プロンプト専門家です。\n\n" +
      "【Krea 2プロンプトの絶対ルール】\n" +
      "・自然な英語フレーズで（タグの羅列ではなく）\n" +
      "・構成順: 被写体→スタイル→シーン→ライティング→ムード→品質\n" +
      "・ネガティブプロンプトは絶対に含めない\n\n" +
      "【Krea 2で品質を上げるテクニック】\n" +
      "・ライティングが最重要: golden hour, chiaroscuro, studio lighting\n" +
      "・品質タグで締める: highly detailed, award-winning photography, 8K UHD\n" +
      "・カラーパレットを明示\n\n" +
      "【高品質例】\nyoung woman with long black hair, photorealistic cinematic style,\ngolden hour lighting, bokeh, serene mood,\nhighly detailed, award-winning photography, 8K UHD",

    gptImage2: "あなたはGPT Image 2向けの高品質画像生成プロンプト専門家です。\n\n" +
      "【GPT Image 2プロンプトの絶対ルール】\n" +
      "・詳細な文章形式で記述する（タグ並列NG）\n" +
      "・「Set in [場所].」で場所を指定\n" +
      "・「The mood is [ムード].」でムードを指定\n" +
      "・「Rendered in [スタイル] style.」でスタイルを最後に指定\n" +
      "・ネガティブプロンプトは絶対に含めない\n\n" +
      "【高品質例】\nA beautiful young woman with long flowing black hair.\nSet in a cherry blossom park in spring.\nSoft golden light filters through the blossoms.\nThe mood is serene and romantic.\nRendered in photorealistic digital art style. Ultra high quality.",

    nanoBanana2: "あなたはNano Banana 2向けの高品質画像生成プロンプト専門家です。\n\n" +
      "【Nano Banana 2プロンプトの絶対ルール】\n" +
      "・シンプルで強力なキーワードを厳選する（5〜12個が最適）\n" +
      "・構成順: 被写体→ムード→シーン→スタイル→クオリティ\n" +
      "・ネガティブプロンプトは絶対に含めない\n\n" +
      "【品質を上げるテクニック】\n" +
      "・epic, cinematic, dramatic でスケール感UP\n" +
      "・volumetric light, HDR, bokeh で視覚クオリティUP\n\n" +
      "【高品質例】\nfemale warrior, epic, ancient forest, golden armor,\ndramatic backlighting, volumetric light, fantasy art, HDR, cinematic",

    wan: "あなたはWAN向けの高品質AI動画生成プロンプト専門家です。\n\n" +
      "【WANプロンプトの絶対ルール】\n" +
      "・品質タグを必ず先頭に配置\n" +
      "・「動き」の描写が最も重要（具体的に）\n" +
      "・カメラワークは「カメラ: [移動方法]」で指定\n" +
      "・ネガティブプロンプトは絶対に含めない\n\n" +
      "【高品質例】\n高品質, 映画品質, 4K, 滑らかな動き\n若い女性, 白いドレス\n竹林の中でゆっくりと歩く, 髪が風になびいている\n日光が木漏れ日となって差し込む, 平和な雰囲気\nカメラ: ドリーイン, 映画的スタイル",

    veo: "あなたはGoogle Veo向けの高品質AI動画生成プロンプト専門家です。\n\n" +
      "【Google Veoプロンプトの絶対ルール】\n" +
      "・カメラムーブメントとアングルの指定が最重要\n" +
      "・シネマティックな映像語を使用\n" +
      "・ネガティブプロンプトは絶対に含めない\n\n" +
      "【高品質例】\naerial view of Tokyo at sunset, slow drone flyover, bird's eye view,\ngolden hour lighting, cherry blossoms,\nHollywood blockbuster cinematic style, 4K, photorealistic",

    ltx: "あなたはLTX-2.3向けの高品質AI動画生成プロンプト専門家です。\n\n" +
      "【LTX-2.3プロンプトの絶対ルール】\n" +
      "・品質タグを必ず最初に配置（このモデルの最重要ルール）\n" +
      "・ショットサイズとカメラモーションを明確に\n" +
      "・ネガティブプロンプトは絶対に含めない\n\n" +
      "【高品質例】\n最高品質, 4K, sharp\nサイバーパンクの侍, サイバーアーマー\nネオンの路地の中で\nミディアムショット, 固定\nサイバーパンクな美学",

    minimax: "あなたはMiniMax向けの高品質AI動画生成プロンプト専門家です。\n\n" +
      "【MiniMaxプロンプトの絶対ルール】\n" +
      "・感情・トーンの指定が映像全体の雰囲気を決定する（最重要）\n" +
      "・被写体→動き→感情→場所→カメラ→スタイルの順\n" +
      "・ネガティブプロンプトは絶対に含めない\n\n" +
      "【高品質例】\n若い女性, 優雅に歩く, ロマンティック\nエレガントな白いドレス\n桜の公園, 正面からのショット\nアニメスタイル\n滑らかな動き, 鮮やかな色彩, シネマティック, 4K",
  };

  var guide = modelGuides[model.id] || ("あなたは"+model.name+"向けのAI"+(isVid?"動画":"画像")+"生成プロンプト専門家です。");
  var parts = [];
  if (idea) parts.push("【アイデア】\n"+idea);
  if (fs)   parts.push("【選択条件】\n"+fs);

  return guide + "\n\n" + parts.join("\n\n") +
    "\n\n【出力フォーマット厳守】\n" +
    "・ポジティブプロンプトのみ出力。ネガティブは絶対含めない。\n" +
    "・空白行なし（カテゴリは改行1つで区切る）。\n" +
    "・前置き・説明文なし。プロンプト本文のみ。";
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
const IMG_MODELS = {
  anima: {
    id:"anima", name:"Anima", icon:"✨", color:"#E879A0",
    label:"Danbooru+自然言語", note:"Qwen LLM",
    tip:"タグは小文字・スペース区切り（score_Nのみアンダーバー）/ @アーティスト名",
    multiPerson: true,
    catTpl: {
      character: [
        {id:"bright",  label:"明るい少女",   pre:{_p:true,gender:"少女",expression:["笑顔"],hair:["ロングヘア","黒髪"],eyes:["青い瞳"]}},
        {id:"cool",    label:"クールな少年",  pre:{_p:true,gender:"少年",expression:["クール"],hair:["黒髪","ショートヘア"]}},
        {id:"mystic",  label:"神秘的な女性",  pre:{_p:true,gender:"少女",expression:["悲しそう"],hair:["白髪","ロングヘア"],eyes:["紫の瞳"]}},
        {id:"cheer",   label:"元気な子",      pre:{_p:true,gender:"少女",expression:["喜び"],hair:["茶髪","ツインテール"]}},
        {id:"mature",  label:"大人の女性",    pre:{_p:true,gender:"少女",expression:["クール"],hair:["黒髪","ロングヘア"],eyes:["赤い瞳"]}},
      ],
      outfit: [
        {id:"school",  label:"制服",          pre:{_p:true,outfit:["セーラー服"]}},
        {id:"casual",  label:"カジュアル",    pre:{_p:true,outfit:["カジュアル"]}},
        {id:"kimono",  label:"和装",          pre:{_p:true,outfit:["着物"]}},
        {id:"gothic",  label:"ゴスロリ",      pre:{_p:true,outfit:["ゴスロリ"]}},
        {id:"fantasy", label:"ファンタジー",  pre:{_p:true,outfit:["ファンタジーアーマー"]}},
        {id:"swim",    label:"水着",          pre:{_p:true,outfit:["水着"]}},
      ],
      scene: [
        {id:"spring",label:"春の公園",   pre:{scene:["公園","屋外"],background:["桜"],lighting:["ソフトライト","日光"],atmosphere:["穏やか"],pose:["立ち姿","正面を向いて"]}},
        {id:"night", label:"夜の都市",   pre:{scene:["都市","屋外"],background:["夜景"],lighting:["ネオンライト"],atmosphere:["神秘的"]}},
        {id:"forest",label:"幻想の森",   pre:{scene:["森","屋外"],lighting:["ソフトライト","木漏れ日"],atmosphere:["幻想的","神秘的"]}},
        {id:"beach", label:"夕暮れの海", pre:{scene:["海辺","屋外"],background:["夕焼け"],lighting:["逆光","リムライト"],atmosphere:["もの悲しい"]}},
        {id:"cafe",  label:"カフェ",     pre:{scene:["カフェ","屋内"],lighting:["ソフトライト","日光"],atmosphere:["穏やか"],pose:["座っている"]}},
        {id:"starry",label:"星空の夜",   pre:{scene:["屋外"],background:["星空"],lighting:["月光"],atmosphere:["幻想的","ロマンティック"]}},
      ],
      style: [
        {id:"soft_anime",label:"ソフトアニメ",      pre:{artStyle:["アニメ"],colorPalette:["パステル"]}},
        {id:"real",      label:"写実的",            pre:{artStyle:["フォトリアル"],colorPalette:["暖色系"]}},
        {id:"water",     label:"水彩画風",           pre:{artStyle:["水彩"],colorPalette:["パステル"]}},
        {id:"dark",      label:"ダークファンタジー", pre:{artStyle:["デジタルアート"],colorPalette:["寒色系"]}},
        {id:"cyber",     label:"サイバーパンク",     pre:{artStyle:["デジタルアート"],colorPalette:["ネオン"]}},
        {id:"retro",     label:"レトロアニメ",       pre:{artStyle:["アニメ"],colorPalette:["アースカラー"]}},
      ],
      quality: [
        {id:"min",  label:"最小構成", pre:{quality:["マスタピース","最高品質","スコア7","高解像度"],rating:["安全"]}},
        {id:"std",  label:"標準品質", pre:{quality:["マスタピース","最高品質","スコア9","スコア8","スコア7","年2025","最新","高解像度"],rating:["安全"]}},
        {id:"best", label:"最高品質", pre:{quality:["マスタピース","最高品質","スコア9","スコア8","スコア7","年2025","最新","とても美的","高解像度","absurdres","公式アート","風景"],rating:["安全"]}},
      ],
    },
    cats: [
      {id:"character",label:"キャラクター",icon:"👤",fields:[]},
      {id:"outfit",   label:"服装",        icon:"👗",fields:[]},
      {id:"scene",label:"シーン",icon:"🏙️",fields:[
        {key:"scene",      label:"シーン・場所", chips:["屋内","屋外","学校","教室","カフェ","公園","海辺","森","都市","和室","図書館","宇宙","廃墟","電車の中","神社","花畑","屋上","橋の上","水辺","夜の路地","城","温泉","雨の街","空港","遊園地","水族館"]},
        {key:"background", label:"背景",         chips:["シンプルな背景","桜","夜景","夕焼け","星空","草原","紅葉","雪景色","窓","雨","花火","蛍","朝霧","虹","満月","紫陽花","コスモス","積雪","夜桜","夕立","水面の反射","ひまわり畑"]},
        {key:"lighting",   label:"ライティング", chips:["ソフトライト","ドラマチックライト","逆光","リムライト","日光","月光","ネオンライト","蛍の光","木漏れ日","ゴールデンアワー","ブルーアワー","室内灯","キャンドルライト","夕焼けの光","スポットライト","朝の光","薄明かり"]},
        {key:"atmosphere", label:"雰囲気",       chips:["穏やか","神秘的","幻想的","ドラマチック","もの悲しい","エネルギッシュ","ロマンティック","温かい","緊張感","懐かしい","夢見がち","寂しい","楽しそう","静寂","爽やか","切ない","孤独","希望","青春"]},
        {key:"pose",       label:"ポーズ・視線", chips:["立ち姿","座っている","正面を向いて","横向き","振り返り","俯き","寝ている","手を広げて","指差し","両手を上げている","ウインク","頬に手を当てて","本を読んでいる","走っている","飛んでいる","音楽を聴いている","手を振っている","膝を抱えている","寄りかかっている"]},
      ]},
      {id:"style",label:"スタイル",icon:"🎨",fields:[
        {key:"artStyle",     label:"アートスタイル", chips:["アニメ","フォトリアル","水彩","油絵","デジタルアート","スケッチ","3Dレンダー","浮世絵風","ペン画","厚塗り","ゲームCG","コミック","ラノベイラスト"]},
        {key:"colorPalette", label:"カラーパレット", chips:["暖色系","寒色系","モノクロ","パステル","ネオン","アースカラー","鮮やか","くすんだ色","セピア","モノトーン","ビビッド","マカロンカラー"]},
      ]},
      {id:"quality",label:"クオリティ",icon:"⭐",fields:[
        {key:"quality", label:"クオリティタグ（英語で出力）",chips:["マスタピース","最高品質","ハイクオリティ","スコア9","スコア8","スコア7","年2025","最新","とても美的","高解像度","absurdres","公式アート","風景"]},
        {key:"rating",  label:"レーティング", chips:["安全","軽い色気"],single:true},
        {key:"negative",label:"ネガティブ（最小限に）",chips:[],ph:"worst quality, low quality, early, old, score_1, score_2, score_3, bad anatomy, bad hands\n※入れすぎ注意"},
      ]},
    ],
    build: animaBuild,
  },

  krea2: {
    id:"krea2", name:"Krea 2", icon:"🪄", color:"#9D7FEA", label:"自然言語・スタイル重視",
    tip:"被写体→スタイル→ライティング→ムード→品質の順で指定",
    catTpl: {
      character: [{id:"w",label:"女性",pre:{character:["女性"]}},{id:"m",label:"男性",pre:{character:["男性"]}},{id:"n",label:"風景のみ",pre:{character:["人物なし"]}}],
      outfit:    [{id:"e",label:"エレガント",pre:{clothingStyle:["エレガントなドレス"]}},{id:"c",label:"カジュアル",pre:{clothingStyle:["カジュアルな服装"]}}],
      scene:     [{id:"g",label:"ゴールデンアワー",pre:{scene:["屋外"],lighting:["ゴールデンアワー"],mood:["穏やか"]}},{id:"n",label:"夜の都市",pre:{scene:["都市夜景"],lighting:["ネオン照明"],mood:["神秘的"]}}],
      style:     [{id:"p",label:"フォトリアル",pre:{style:["フォトリアル"],colorPalette:["自然な色彩"]}},{id:"d",label:"デジタルアート",pre:{style:["デジタルアート"],colorPalette:["鮮やか"]}}],
      quality:   [{id:"s",label:"標準",pre:{quality:["highly detailed","sharp focus"]}},{id:"a",label:"受賞クオリティ",pre:{quality:["highly detailed","award-winning","8K UHD"]}}],
    },
    cats: [
      {id:"character",label:"キャラクター",icon:"👤",fields:[
        {key:"character",    label:"被写体の種類", chips:["女性","男性","子供","動物","建物","風景","人物なし"]},
        {key:"subjectDetail",label:"被写体の詳細", chips:["長い黒髪","青い目","自信に満ちた表情","優しい微笑み","鍛えた体格","華奢な体型"]},
      ]},
      {id:"outfit",label:"服装",icon:"👗",fields:[
        {key:"clothingStyle",label:"服装スタイル",chips:["エレガントなドレス","カジュアルな服装","フォーマルスーツ","ボヘミアンスタイル","スポーツウェア","ファンタジー衣装","和服"]},
      ]},
      {id:"scene",label:"シーン",icon:"🏙️",fields:[
        {key:"scene",   label:"シーン",     chips:["室内","屋外","都市夜景","自然","海","スタジオ","カフェ","廃墟","宇宙"]},
        {key:"lighting",label:"ライティング",chips:["ゴールデンアワー","ブルーアワー","スタジオ照明","自然光","キアロスクーロ","柔らかい拡散光","ネオン照明","逆光"]},
        {key:"mood",    label:"ムード",     chips:["穏やか","神秘的","幻想的","ドラマチック","もの悲しい","エネルギッシュ","映画的"]},
        {key:"camera",  label:"カメラ",     chips:["顔のクローズアップ","広角","バストショット","俯瞰","ローアングル","マクロ"]},
        {key:"pose",    label:"ポーズ",     chips:["立ち姿","座っている","歩いている","正面向き","横向き","振り返り"]},
      ]},
      {id:"style",label:"スタイル",icon:"🎨",fields:[
        {key:"style",       label:"スタイル",       chips:["フォトリアル","超リアル","デジタルアート","油絵","水彩","3Dレンダー","コンセプトアート","ファッション写真"]},
        {key:"colorPalette",label:"カラーパレット", chips:["アースカラー","宝石のような色","パステル","モノクロ","ネオン","暖色系","寒色系"]},
      ]},
      {id:"quality",label:"クオリティ",icon:"⭐",fields:[
        {key:"quality",label:"クオリティタグ",chips:["超高精細","精巧なディテール","受賞作品","8K UHD","sharp focus","award-winning","highly detailed"]},
      ]},
    ],
    build: function(form){ return genericBuild(this,form); },
  },

  gptImage2: {
    id:"gptImage2", name:"GPT Image 2", icon:"🖌️", color:"#2EBF8A", label:"自然言語・説明的",
    tip:"文章形式で詳しく描写。スタイルを最後に「Rendered in X style.」で指定",
    catTpl: {
      character: [{id:"w",label:"女性",pre:{subject:["美しい若い女性"]}},{id:"n",label:"自然風景",pre:{subject:["壮大な自然風景"]}}],
      outfit:    [{id:"e",label:"エレガント",pre:{clothing:["エレガントなドレスを着ている"]}},{id:"t",label:"伝統衣装",pre:{clothing:["美しい伝統的な衣装をまとっている"]}}],
      scene:     [{id:"g",label:"日本庭園",pre:{setting:["日本庭園"],lighting:["柔らかな朝の光"],mood:["穏やか"]}},{id:"n",label:"夜の都市",pre:{setting:["夜の都市"],lighting:["ネオンライト"],mood:["神秘的"]}}],
      style:     [{id:"p",label:"写真",pre:{style:["フォトリアル写真"]}},{id:"a",label:"アニメ",pre:{style:["アニメイラスト"]}}],
      quality:   [{id:"h",label:"高品質",pre:{quality:["高品質","超高精細","プロ品質"]}},{id:"m",label:"映画的",pre:{quality:["映画的","シネマティック","プロ品質"]}}],
    },
    cats: [
      {id:"character",label:"キャラクター",icon:"👤",fields:[{key:"subject",label:"メイン被写体",chips:["美しい若い女性","凛々しい男性","可愛い子供","壮大な自然風景","歴史的な建物","抽象的なイメージ"]}]},
      {id:"outfit",label:"服装",icon:"👗",fields:[{key:"clothing",label:"服装・衣装",chips:["エレガントなドレスを着ている","美しい伝統的な衣装","スタイリッシュなモダンファッション","輝く鎧と武器を持った","白いサマードレス"]}]},
      {id:"scene",label:"シーン",icon:"🏙️",fields:[
        {key:"setting", label:"シーン",     chips:["日本庭園","夜の都市","神秘的な森","海辺","砂漠","宇宙","室内","カフェ","廃墟"]},
        {key:"lighting",label:"ライティング",chips:["柔らかな朝の光","ゴールデンアワー","月光","スタジオ照明","ネオンライト","焚き火","曇り空","星明かり"]},
        {key:"mood",    label:"ムード",     chips:["穏やか","神秘的","ドラマチック","もの悲しい","幻想的","緊張感","ロマンティック"]},
        {key:"pose",    label:"ポーズ",     chips:["立っている","座っている","歩いている","振り返っている","カメラを見ている"]},
      ]},
      {id:"style",label:"スタイル",icon:"🎨",fields:[
        {key:"style",  label:"アートスタイル",chips:["フォトリアル写真","デジタルイラスト","油絵","水彩画","鉛筆スケッチ","3Dレンダー","アニメイラスト"]},
        {key:"details",label:"追加詳細",    chips:["フィルムグレイン","ボケ味","筆のタッチ","レンズフレア"]},
      ]},
      {id:"quality",label:"クオリティ",icon:"⭐",fields:[{key:"quality",label:"品質タグ",chips:["高品質","超高精細","プロ品質","映画的","傑作","シネマティック"]}]},
    ],
    build: function(form){
      var p=[];
      var sub=fGet(form,"subject");if(sub.length)p.push(sub.join("、"));
      var cl=fGet(form,"clothing");if(cl.length)p.push(cl.join("、")+"。");
      var se=fGet(form,"setting");if(se.length)p.push("場所: "+se.join("、")+"。");
      var li=fGet(form,"lighting");if(li.length)p.push(li.join("、")+"。");
      var mo=fGet(form,"mood");if(mo.length)p.push("ムードは"+mo.join("、")+"。");
      var po=fGet(form,"pose");if(po.length)p.push(po.join("、")+"。");
      var de=fGet(form,"details");if(de.length)p.push(de.join("、")+"。");
      var st=fGet(form,"style");if(st.length)p.push(st.join("、")+"スタイルでレンダリング。");
      var q=fGet(form,"quality");if(q.length)p.push(q.join("、")+"。");
      return p.filter(Boolean).join("\n");
    },
  },

  nanoBanana2: {
    id:"nanoBanana2", name:"Nano Banana 2", icon:"⚡", color:"#F0A317", label:"シンプル・高速",
    tip:"3〜12個の強力なキーワードが最効果。epic, cinematic, volumetric light で品質UP",
    catTpl: {
      character: [{id:"w",label:"女性",pre:{subject:["女性"]}},{id:"d",label:"ドラゴン",pre:{subject:["ドラゴン"]}},{id:"l",label:"風景",pre:{subject:["壮大な風景"]}}],
      outfit:    [{id:"a",label:"鎧",pre:{outfit:["重厚な鎧"]}},{id:"r",label:"魔法使いの衣",pre:{outfit:["魔法使いのローブ"]}}],
      scene:     [{id:"f",label:"古代の森",pre:{scene:["古代の森"],mood:["神秘的"]}},{id:"c",label:"未来都市",pre:{scene:["未来都市"],mood:["SF"]}}],
      style:     [{id:"a",label:"アニメ",pre:{artStyle:["アニメ"]}},{id:"r",label:"リアル",pre:{artStyle:["リアル"]}},{id:"f",label:"ファンタジー",pre:{artStyle:["ファンタジーアート"]}}],
      quality:   [{id:"c",label:"映画的",pre:{extra:["映画的","シネマティック"]}},{id:"v",label:"ボリュームライト",pre:{extra:["ボリュームライト","HDR"]}}],
    },
    cats: [
      {id:"character",label:"キャラクター",icon:"👤",fields:[
        {key:"subject",label:"被写体", chips:["女性","男性","動物","ドラゴン","ロボット","魔法使い","戦士","壮大な風景"]},
        {key:"mood",   label:"ムード", chips:["壮大","明るい","ダーク","夢幻的","神秘的","平和","鮮やか","不気味"]},
      ]},
      {id:"outfit",label:"服装",icon:"👗",fields:[{key:"outfit",label:"服装・装備",chips:["重厚な鎧","魔法使いのローブ","カジュアルな服","エルフの衣","サイバースーツ","ドレス","和服"]}]},
      {id:"scene",label:"シーン",icon:"🏙️",fields:[
        {key:"scene",       label:"シーン",chips:["古代の森","未来都市","海","空","砂漠","水中","宇宙","山","廃墟"]},
        {key:"environment", label:"環境",  chips:["霧","嵐","夕暮れ","朝霧","満月","オーロラ","雪"]},
        {key:"pose",        label:"ポーズ",chips:["立っている","攻撃中","走っている","飛んでいる","座っている"]},
      ]},
      {id:"style",label:"スタイル",icon:"🎨",fields:[
        {key:"artStyle",  label:"アートスタイル",chips:["リアル","アニメ","カートゥーン","絵画風","ファンタジーアート","SF","ミニマル"]},
        {key:"colorTheme",label:"カラーテーマ",  chips:["暖色系","寒色系","モノクロ","パステル","ネオン","アースカラー","鮮やか"]},
      ]},
      {id:"quality",label:"クオリティ",icon:"⭐",fields:[{key:"extra",label:"追加キーワード",chips:["映画的","ボリュームライト","ボケ味","HDR","シネマティック","高精細"]}]},
    ],
    build: function(form){
      var groups=[[].concat(fGet(form,"subject")).concat(fGet(form,"mood")),fGet(form,"outfit"),["scene","environment","pose"].reduce(function(a,k){return a.concat(fGet(form,k));},[]),[].concat(fGet(form,"artStyle")).concat(fGet(form,"colorTheme")),fGet(form,"extra")].filter(function(g){return g.length>0;});
      return groups.map(function(g){return g.join(", ");}).join("\n");
    },
  },
};

// ═══════════════════════════════════════════
// 動画モデル設定
// ═══════════════════════════════════════════
const VID_MODELS = {
  wan: {
    id:"wan", name:"WAN", icon:"🌊", color:"#22D3EE", label:"モーション重視",
    tip:"品質タグ先頭 / 「動き」を具体的に / カメラ: ドリーイン などで指定",
    catTpl: {
      character: [{id:"w",label:"女性",pre:{subject:["若い女性"]}},{id:"n",label:"自然",pre:{subject:["壮大な自然"]}}],
      outfit:    [{id:"d",label:"ドレス",pre:{clothing:["白いドレス"]}},{id:"c",label:"カジュアル",pre:{clothing:["カジュアルな服装"]}}],
      scene:     [{id:"b",label:"竹林",pre:{scene:["竹林"],atmosphere:["平和"]}},{id:"n",label:"夜の都市",pre:{scene:["都市"],atmosphere:["神秘的"]}}],
      style:     [{id:"c",label:"映画的",pre:{style:["映画的"]}},{id:"a",label:"アニメ",pre:{style:["アニメ"]}}],
      quality:   [{id:"h",label:"高品質",pre:{quality:["高品質","映画品質","滑らかな動き","4K"]}}],
    },
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
    id:"veo", name:"Google Veo", icon:"🎬", color:"#5B99F5", label:"シネマティック",
    tip:"カメラムーブメントとアングルが最重要 / dolly in, drone flyover, golden hour",
    catTpl: {
      character: [{id:"p",label:"人物",pre:{subject:["人物"]}},{id:"l",label:"風景",pre:{subject:["壮大な風景"]}}],
      outfit:    [{id:"c",label:"普段着",pre:{clothing:["普段着"]}},{id:"f",label:"正装",pre:{clothing:["正装"]}}],
      scene:     [{id:"g",label:"ゴールデンアワー",pre:{lighting:["ゴールデンアワー"],cinematicStyle:["ハリウッド大作"]}},{id:"n",label:"ノワール",pre:{cinematicStyle:["フィルムノワール"],lighting:["ドラマチックスタジオ"]}}],
      style:     [{id:"h",label:"ハリウッド",pre:{cinematicStyle:["ハリウッド大作"]}},{id:"d",label:"ドキュメンタリー",pre:{cinematicStyle:["ドキュメンタリー"]}}],
      quality:   [{id:"c",label:"映画的",pre:{quality:["4K","映画的","フォトリアル","プロ品質"]}}],
    },
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
    id:"ltx", name:"LTX-2.3", icon:"▶️", color:"#A78BFA", label:"高速・リアルタイム",
    tip:"品質タグを必ず最初に配置（このモデルの最重要ルール）",
    catTpl: {
      character: [{id:"s",label:"サムライ",pre:{subject:["侍"]}},{id:"m",label:"メカ",pre:{subject:["巨大メカ"]}},{id:"w",label:"女性",pre:{subject:["女性"]}}],
      outfit:    [{id:"a",label:"サイバーアーマー",pre:{clothing:["サイバーアーマー"]}},{id:"c",label:"普段着",pre:{clothing:["普段着"]}}],
      scene:     [{id:"n",label:"ネオンの路地",pre:{setting:["ネオンの路地"],camera:["ミディアムショット"],aesthetic:["サイバーパンク"]}},{id:"t",label:"古代神殿",pre:{setting:["古代神殿の廃墟"],camera:["広角ショット"],aesthetic:["ファンタジー"]}}],
      style:     [{id:"c",label:"サイバーパンク",pre:{aesthetic:["サイバーパンク"]}},{id:"f",label:"ファンタジー",pre:{aesthetic:["ファンタジー"]}},{id:"m",label:"映画的",pre:{aesthetic:["映画的"]}}],
      quality:   [{id:"b",label:"最高品質",pre:{quality:["最高品質","高解像度","シャープ","4K"]}},{id:"g",label:"フィルムグレイン",pre:{quality:["最高品質","フィルムグレイン","4K"]}}],
    },
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
    id:"minimax", name:"MiniMax", icon:"🌟", color:"#F06BA8", label:"多様スタイル対応",
    tip:"感情・トーンの指定が映像の雰囲気を決定する（最重要）",
    catTpl: {
      character: [{id:"w",label:"若い女性",pre:{subject:["若い女性"]}},{id:"r",label:"ロボット",pre:{subject:["未来的なロボット"]}},{id:"d",label:"ドラゴン",pre:{subject:["ドラゴン"]}}],
      outfit:    [{id:"d",label:"ドレス",pre:{clothing:["エレガントなドレス"]}},{id:"c",label:"カジュアル",pre:{clothing:["カジュアルな服装"]}}],
      scene:     [{id:"c",label:"桜の公園",pre:{scene:["桜の公園"],emotion:["ロマンティック"]}},{id:"cy",label:"サイバー都市",pre:{scene:["サイバーパンクの都市"],emotion:["神秘的"]}},{id:"m",label:"霧の山",pre:{scene:["霧の山々"],emotion:["壮大"]}}],
      style:     [{id:"a",label:"アニメ",pre:{style:["アニメ"]}},{id:"r",label:"リアル",pre:{style:["リアル"]}},{id:"3",label:"3Dアニメ",pre:{style:["3Dアニメ"]}},{id:"c",label:"映画的",pre:{style:["映画的"]}}],
      quality:   [{id:"s",label:"滑らかな動き",pre:{extra:["滑らかな動き","鮮やかな色彩","シネマティック"]}},{id:"d",label:"精緻",pre:{extra:["精緻なテクスチャ","4K","シネマティック"]}}],
    },
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

const ANIMA_SCENE_CATS = IMG_MODELS.anima.cats.filter(function(c){ return c.id!=="character"&&c.id!=="outfit"; });
