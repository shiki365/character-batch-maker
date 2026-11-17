/*!
 * words.v1.js - i18n:off. Words the readers look for in what the user pastes (no UI)
 *
 * NPC data is copied from Japanese scenarios and sheets whatever language the page is in, so these
 * words stay Japanese in every language (English ones sit beside them). They are data, not texts of
 * the page: nothing here goes through I18n.t(). Used by parse.v1.js.
 */
(function (root) {
  "use strict";

  root.CbWords = {
    // Table headings for each kind of column (parse: KINDS)
    heads: {
      name: ["名前", "name", "キャラクター名", "キャラ名", "npc名", "駒名", "駒の名前"],
      memo: ["メモ", "memo", "キャラクターメモ", "説明", "備考"],
      initiative: ["イニシアチブ", "initiative", "イニシ", "行動値"],
      commands: ["チャットパレット", "チャパレ", "コマンド", "commands", "palette"],
      image: ["立ち絵", "画像", "image", "icon", "アイコン"],
      externalUrl: ["参照url", "url", "外部url", "キャラシ", "キャラクターシート"],
      color: ["色", "発言色", "color"],
      size: ["駒サイズ", "サイズ", "size"],
      active: ["盤面", "盤面に出す", "active"],
      secret: ["ステータスを非公開", "ステータス非公開", "非公開", "secret"],
      invisible: ["発言時に立ち絵を出さない", "立ち絵非表示", "invisible"],
      hideStatus: ["盤面の一覧に出さない", "一覧に非表示", "一覧非表示", "hidestatus"],
      ignore: ["使わない", "ignore", "-"],
    },
    // A table column with one of these headings is a status even without "10/12" cells
    statusHeads: ["hp", "mp", "san", "sp", "耐久力", "正気度", "マジックポイント"],
    yes: ["1", "true", "yes", "y", "on", "○", "〇", "◯", "o", "✓", "✔", "はい", "する", "出す", "有", "あり"],
    no: ["0", "false", "no", "n", "off", "×", "x", "✗", "いいえ", "しない", "出さない", "無", "なし"],
    // Memo: [kind, the label it becomes, ...ways scenarios write it]
    canon: [
      ["status", "HP", "耐久力", "耐久", "耐久度", "耐久値", "ヒットポイント", "体力"],
      ["status", "MP", "マジックポイント", "マジック・ポイント"],
      ["status", "SAN", "正気度", "SAN値", "正気度ポイント"],
      ["param", "LUK"],
      ["param", "DB", "ダメージボーナス", "ダメージ・ボーナス", "ダメボ"],
      ["param", "BLD", "ビルド"],
      ["param", "MOV", "移動", "移動率", "移動力", "移動距離"],
      ["param", "装甲"],
      ["param", "年齢"],
      ["initiative", "イニシアチブ", "initiative", "イニシ", "行動値"],
    ],
    // Skill names of both editions, only to tell known labels from unknown ones on the page
    skills: ("アイデア 幸運 知識 回避 キック 組み付き こぶし パンチ 頭突き 投擲 マーシャルアーツ 拳銃 サブマシンガン ショットガン " +
      "マシンガン ライフル 応急手当 鍵開け 隠す 隠れる 聞き耳 忍び歩き 写真術 精神分析 追跡 登攀 図書館 目星 運転 機械修理 重機械操作 乗馬 " +
      "水泳 製作 操縦 跳躍 電気修理 ナビゲート 変装 言いくるめ 信用 説得 値切り 母国語 医学 オカルト 化学 クトゥルフ神話 芸術 経理 考古学 " +
      "コンピューター 心理学 人類学 生物学 地質学 電子工学 天文学 博物学 物理学 法律 薬学 歴史 近接戦闘 射撃 手さばき 隠密 魅惑 威圧 鑑定 " +
      "自然 サバイバル 機械工学 言語 他の言語 読唇術 動物使い 潜水 爆破 催眠術 砲術 日本語 英語").split(" "),
    // メモ: / 立ち絵: / URL: lines of the memo
    tags: { memo: ["メモ", "memo"], image: ["立ち絵", "画像"], url: ["url", "参照url"] },
    none: "なし", // 装甲なし
  };
})(typeof window !== "undefined" ? window : globalThis);
