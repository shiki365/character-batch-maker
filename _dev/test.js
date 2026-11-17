// node _dev/test.js  - checks parse.v1.js and roomdata.v1.js without a browser.
// Needs _dev/jszip.min.js (JSZip 3.10.1 from cdnjs; not committed).
"use strict";
const assert = require("assert");
const path = require("path");
const crypto = require("crypto");
require("../words.v1.js");
require("../parse.v1.js");
require("../roomdata.v1.js");
const JSZip = require(path.join(__dirname, "jszip.min.js"));
const P = globalThis.CbParse, R = globalThis.CbRoomData;

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok  " + name); };

(async () => {
  await test("tsv with quoted multi-line cells", () => {
    const text = '名前\tHP\tMP\tDEX\tチャットパレット\tメモ\nアリス\t10/12\t５\t60\t"CCB<=60 【回避】\n1d3 ""こぶし"""\t学生\n\nボブ\t14\t\t45\t\t\n';
    const { columns, chars, warnings } = P.parse(text);
    assert.deepStrictEqual(columns.map(c => c.kind), ["name", "status", "status", "param", "commands", "memo"]);
    assert.strictEqual(chars.length, 2);
    assert.deepStrictEqual(chars[0].status, [{ label: "HP", value: 10, max: 12 }, { label: "MP", value: 5, max: 5 }]);
    assert.deepStrictEqual(chars[0].params, [{ label: "DEX", value: "60" }]);
    assert.strictEqual(chars[0].commands, 'CCB<=60 【回避】\n1d3 "こぶし"');
    assert.deepStrictEqual(chars[1].status, [{ label: "HP", value: 14, max: 14 }]);
    assert.strictEqual(chars[1].line, 4);
    assert.strictEqual(warnings.length, 0);
  });

  await test("csv, prefixes, flags, colour, overrides", () => {
    const text = "name,ステータス:気力,パラメータ:HP,差分:笑顔,盤面,色,サイズ,装甲\nA,3/5,99,A笑顔,○,#FF0000,6,2\nB,x,1,,×,red,big,";
    const r = P.parse(text, { "装甲": "status" });
    assert.deepStrictEqual(r.columns.map(c => c.kind), ["name", "status", "param", "face", "active", "color", "size", "status"]);
    const [a, b] = r.chars;
    assert.deepStrictEqual(a.status, [{ label: "気力", value: 3, max: 5 }, { label: "装甲", value: 2, max: 2 }]);
    assert.deepStrictEqual(a.params, [{ label: "HP", value: "99" }]);
    assert.deepStrictEqual(a.faces, [{ label: "笑顔", imageName: "A笑顔" }]);
    assert.strictEqual(a.active, true);
    assert.strictEqual(a.color, "#ff0000");
    assert.strictEqual(a.size, 6);
    assert.strictEqual(b.active, false);
    assert.strictEqual(b.color, "");
    assert.strictEqual(b.size, null);
    assert.strictEqual(r.warnings.length, 3); // x, red, big
  });

  await test("no name column: the first column is the name", () => {
    const r = P.parse("キャラ\tHP\nA\t1");
    assert.strictEqual(r.columns[0].kind, "name");
    assert.strictEqual(r.chars[0].name, "A");
    assert.strictEqual(r.warnings.length, 1);
  });

  await test("empty input", () => {
    assert.deepStrictEqual(P.parse("").chars, []);
    assert.deepStrictEqual(P.parse("名前\tHP\n").chars, []);
  });

  await test("memo: statuses, params, skills, copies", () => {
    const text = [
      "アリス", "HP 12  MP 10  SAN 55/99", "STR 50 DEX 60　DB +1d4", "回避 30 / こぶし 50 1d3+DB／図書館：65％、目星=70", "メモ: 大学生", "好奇心が強い。", "立ち絵: alice_base",
      "1d100 【幸運】", "https://example.com/sheet", "", "",
      "黒い影 ×3", "HP 20, DEX 80, 装甲 2", "かぎ爪 70 1d6+1d4", "イニシアチブ 99", "",
      "名前: Alex2", "HP 5",
    ].join("\n");
    const { chars, warnings } = P.parseMemo(text, { roll: "ccb" });
    assert.strictEqual(warnings.length, 0);
    assert.deepStrictEqual(chars.map(c => c.name), ["アリス", "黒い影A", "黒い影B", "黒い影C", "Alex2"]);
    const a = chars[0];
    assert.deepStrictEqual(a.status, [{ label: "HP", value: 12, max: 12 }, { label: "MP", value: 10, max: 10 }, { label: "SAN", value: 55, max: 99 }]);
    assert.deepStrictEqual(a.params, [{ label: "STR", value: "50" }, { label: "DEX", value: "60" }, { label: "DB", value: "+1d4" }]);
    // +DB refers to the DB parameter, so CCFOLIA fills it in ({DB} keeps its sign: 1d3+1d4)
    assert.strictEqual(a.commands, "CCB<=30 【回避】\nCCB<=50 【こぶし】\n1d3{DB} 【こぶしダメージ】\nCCB<=65 【図書館】\nCCB<=70 【目星】\n1d100 【幸運】");
    // explanations stay out of the memo (other players can see it) unless asked
    assert.strictEqual(a.memo, "大学生");
    assert.strictEqual(P.parseMemo(text, { roll: "ccb", proseToMemo: true }).chars[0].memo, "大学生\n好奇心が強い。");
    assert.deepStrictEqual([a.imageName, a.externalUrl, a.initiative, a.line], ["alice_base", "https://example.com/sheet", 60, 1]);
    const b = chars[2];
    assert.deepStrictEqual([b.imageName, b.initiative, b.line], ["黒い影", 99, 12]);
    assert.deepStrictEqual(b.params, [{ label: "DEX", value: "80" }, { label: "装甲", value: "2" }]);
    assert.strictEqual(b.commands, "CCB<=70 【かぎ爪】\n1d6+1d4 【かぎ爪ダメージ】");
  });

  await test("memo: other rolls, numbered copies", () => {
    assert.strictEqual(P.parseMemo("A\n回避 40", { roll: "cc" }).chars[0].commands, "CC<=40 【回避】");
    const none = P.parseMemo("A\n回避 40 1d3", { roll: "none" }).chars[0];
    assert.deepStrictEqual([none.params, none.commands, none.initiative], [[{ label: "回避", value: "40" }], "1d3 【回避ダメージ】", null]);
    assert.deepStrictEqual(P.parseMemo("ゾンビ x2", { suffix: "number" }).chars.map(c => c.name), ["ゾンビ1", "ゾンビ2"]);
    assert.strictEqual(P.parseMemo("群れ ×999").chars.length, 100);
    const db = P.parseMemo("A\nSTR 50  DEX 60  DB +0\nMOV ８").chars[0];
    assert.deepStrictEqual([db.params.map(p => p.label + "=" + p.value).join(), db.initiative, db.memo], ["STR=50,DEX=60,DB=+0,MOV=8", 60, ""]);
  });

  // Ways scenario writers put NPC data, written fresh here (the real samples are in _dev/samples).
  await test("memo: notations that differ between writers", () => {
    const one = (t, o) => P.parseMemo("X\n" + t, Object.assign({ roll: "ccb" }, o)).chars[0];
    const sum = c => [c.status.map(s => `${s.label} ${s.value}/${s.max}`).join(), c.params.map(p => `${p.label} ${p.value}`).join(), c.commands];
    // glued, own gauge
    assert.deepStrictEqual(sum(one("STR50、CON45、HP11、宿り点12")), ["HP 11/11,宿り点 12/12", "STR 50,CON 45", ""]);
    // brackets, full-width %, 成功値
    assert.strictEqual(one("〈回避〉60％、《鍵開け》55% ＜キック＞成功値70").commands, "CCB<=60 【回避】\nCCB<=55 【鍵開け】\nCCB<=70 【キック】");
    // paired labels
    assert.deepStrictEqual(sum(one("HP11、STR／DEX 60／50、回避25%")).slice(0, 2), ["HP 11/11", "STR 60,DEX 50"]);
    assert.deepStrictEqual(sum(one("STR / CON | 80 / 65")).slice(1, 2), ["STR 80,CON 65"]);
    // damage: in brackets, after, on the next line, 7th's (half/fifth), a number inside the name
    assert.strictEqual(one("〈噛みつく〉60％（ダメージ1D6、対象はランダム）").commands, "CCB<=60 【噛みつく】");
    assert.strictEqual(one("〈噛みつく〉成功値60　1d6のダメージ").commands, "CCB<=60 【噛みつく】\n1d6 【噛みつくダメージ】");
    assert.strictEqual(one("〈ハサミ〉成功値70\n1d6のダメージおよび〈組みつき〉").commands, "CCB<=70 【ハサミ】\n1d6 【ハサミダメージ】");
    assert.strictEqual(one("DB +1d4\n近接戦闘(格闘) 50%(25/10)、ダメージ 1D3+DB\n回避 35%(17/7)", { roll: "auto" }).commands,
      "CC<=50 【近接戦闘(格闘)】\n1D3{DB} 【近接戦闘(格闘)ダメージ】\nCC<=35 【回避】");
    assert.strictEqual(one("射撃(32口径拳銃) 50%、ダメージ 1D8\nもしくは1D3+1（銃床で殴る）").commands,
      "CCB<=50 【射撃(32口径拳銃)】\n1D8 【射撃(32口径拳銃)ダメージ】\n1D3+1 【射撃(32口径拳銃)ダメージ（銃床で殴る）】");
    // PDF: split letters and digits, a value on the next line, a bracket broken over lines
    assert.deepStrictEqual(sum(one("S TR:8 5(17) D EX: 6 5\n耐久力\n1 4 MP:06")).slice(0, 2), ["HP 14/14,MP 6/6", "STR 85,DEX 65"]);
    assert.strictEqual(one("〈製作（木材製品）〉\n7 5\n（〈こぶし\n〉 80 〈頭突き〉 5 0").commands, "CCB<=75 【製作(木材製品)】\nCCB<=80 【こぶし】\nCCB<=50 【頭突き】");
    // weapons listed apart, and lines that are not data
    const w = one("日本刀 90%\n武器:\n日本刀\nダメージ1D10 + DB、耐久力20\n呪文:\n旧き印(基本P.280)\n年齢は30代。好物は甘いもの。");
    assert.deepStrictEqual([w.commands, w.status.length], ["CCB<=90 【日本刀】\n1D10+DB 【日本刀ダメージ】", 0]);
    // a ready-made palette is kept, and its skills are not written twice
    assert.strictEqual(one("こぶし 60 回避 50\n【ココフォリア用チャパレ】\nsCCB<=60 【こぶし】 sCCB<=50 【回避】 1d3 【こぶし】").commands, "sCCB<=60 【こぶし】\nsCCB<=50 【回避】\n1d3 【こぶし】");
    assert.strictEqual(one("CCB<=80 触肢\n2d3 触肢威力").commands, "CCB<=80 【触肢】\n2d3 【触肢威力】");
  });

  await test("memo: names, editions, secret rolls, label choices, hints", () => {
    const names = t => P.parseMemo(t + "\nHP 1").chars.map(c => c.name);
    assert.deepStrictEqual(names("【山田 太郎(やまだ たろう)】170cm 誕生日:4/1"), ["山田 太郎"]);
    assert.deepStrictEqual(names("▼怪しい店主─佐藤はな(さとうはな)"), ["佐藤はな"]);
    assert.deepStrictEqual(names("鈴木 一郎(40 歳)、市役所 職員"), ["鈴木 一郎"]);
    assert.deepStrictEqual(names("《陳 明(チェン・ミン)》"), ["陳 明"]);
    assert.deepStrictEqual(names("◆エネミーデータ：兵隊"), ["兵隊"]);
    assert.deepStrictEqual(names("屍食鬼*2（PL人数に合わせて調整）"), ["屍食鬼A", "屍食鬼B"]);
    assert.deepStrictEqual(names("高橋みお\n、旧家の跡取り"), ["高橋みお"]);
    // 7th: abilities on the x5 scale
    const seven = P.parseMemo("A\nSTR 55 CON 55 SIZ 50 DEX 55\n回避 30").chars[0];
    assert.deepStrictEqual([seven.edition, seven.commands], [7, "CC<=30 【回避】"]);
    assert.strictEqual(P.parseMemo("A\n回避 30", { roll: "auto", secretRoll: true }).chars[0].commands, "sCCB<=30 【回避】");
    // choosing what a label is
    const k = P.key("警戒値");
    const r = P.parseMemo("A\n警戒値 6 回避 30", { roll: "ccb", labels: { [k]: "param", [P.key("回避")]: "ignore" } });
    assert.deepStrictEqual([r.chars[0].params, r.chars[0].commands, r.labels.find(l => l.key === k).auto], [[{ label: "警戒値", value: "6" }], "", "status"]);
    // hints that tell how to fix the text
    const h = P.parseMemo("A\nSTR 10\nB\nSTR 12\n\nHP 3\n\nC\n回避 ?40").warnings;
    assert.ok(h.some(w => /2 回出てきます/.test(w)), "two NPCs joined");
    assert.ok(h.some(w => /名前がありません/.test(w)), "no name");
  });

  await test("pasted pieces from character sheet sites", () => {
    const one = { kind: "character", data: { name: "探索者", initiative: 12, externalUrl: "https://iachara.com/view/1", iconUrl: "https://example.com/a.png",
      commands: "CCB<=50 【目星】", status: [{ label: "HP", value: 11, max: 11 }], params: [{ label: "STR", value: "10" }], color: "#ff0000", width: 6, secret: true } };
    const [c] = P.parsePieces(JSON.stringify(one));
    assert.deepStrictEqual([c.name, c.initiative, c.color, c.size, c.secret, c.hadIcon, c.commands], ["探索者", 12, "#ff0000", 6, true, true, "CCB<=50 【目星】"]);
    assert.deepStrictEqual(c.status, [{ label: "HP", value: 11, max: 11 }]);
    assert.strictEqual(P.parsePieces(JSON.stringify([one, one])).length, 2);
    assert.strictEqual(P.parsePieces(JSON.stringify(one) + "\n" + JSON.stringify(one)).length, 2);
    assert.strictEqual(P.parsePieces(JSON.stringify(JSON.stringify(one))).length, 1);
    assert.strictEqual(P.parsePieces("名前\tHP").length, 0);
    assert.strictEqual(P.parsePieces('{"kind":"other","data":{}}').length, 0);
  });

  await test("zip: names match hashes, shared images stored once, record shape", async () => {
    const img = (n, type) => ({ type: type || "image/png", bytes: new Uint8Array([137, 80, 78, 71, n]), key: "k" + n });
    const input = { characters: [
      { name: "A", memo: "m", initiative: 3, status: [{ label: "HP", value: 1, max: 2 }], params: [{ label: "DEX", value: 60 }],
        commands: "x", color: "#123456", size: 6, active: true, image: img(1), faces: [{ label: "笑顔", image: img(2) }, { label: "なし", image: null }] },
      { name: "B", active: true, image: img(2), faces: [{ label: "j", image: img(3, "image/jpeg") }] },
      { name: "C", active: false, image: null, faces: [], size: 500, color: "red" },
    ] };
    const { zip, files } = await R.build(input, { JSZip, subtle: crypto.webcrypto.subtle, random: n => crypto.randomBytes(n), now: 1700000000000 });
    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const back = await JSZip.loadAsync(buf);
    assert.strictEqual(await back.file(".token").async("string"), "0.not-signed-made-by-an-outside-tool");
    const data = JSON.parse(await back.file("__data.json").async("string"));
    assert.deepStrictEqual(data.meta, { version: "1.1.0" });
    assert.deepStrictEqual(Object.keys(data.entities).sort(), ["characters", "decks", "effects", "items", "notes", "room", "savedatas", "scenes", "snapshots"]);
    for (const k of Object.keys(data.entities)) if (k !== "characters") assert.deepStrictEqual(data.entities[k], {});
    assert.strictEqual(files.length, 3);
    assert.deepStrictEqual(Object.keys(data.resources).sort(), files.slice().sort());
    for (const name of files) {
      const bytes = await back.file(name).async("nodebuffer");
      const ext = { "image/png": "png", "image/jpeg": "jpeg" }[data.resources[name].type];
      assert.strictEqual(name, crypto.createHash("sha256").update(bytes).digest("hex") + "." + ext);
    }
    assert.strictEqual(Object.keys(back.files).length, files.length + 2);
    const ids = Object.keys(data.entities.characters);
    assert.strictEqual(ids.length, 3);
    for (const id of ids) assert.match(id, /^[A-Za-z0-9]{20}$/);
    const [a, b, c] = ids.map(id => data.entities.characters[id]);
    assert.deepStrictEqual(Object.keys(a).sort(), ["active", "angle", "color", "commands", "externalUrl", "faces", "height", "hideStatus", "iconUrl", "initiative",
      "invisible", "memo", "name", "order", "params", "secret", "status", "width", "x", "y", "z"]);
    assert.ok(files.includes(a.iconUrl));
    assert.deepStrictEqual(a.faces.map(f => f.label), ["笑顔"]); // the face without an image is left out
    assert.strictEqual(a.faces[0].iconUrl, b.iconUrl);           // the same image, one file
    assert.match(b.faces[0].iconUrl, /\.jpeg$/);
    assert.deepStrictEqual(a.params, [{ label: "DEX", value: "60" }]);
    assert.strictEqual(typeof a.status[0].value, "number");
    assert.deepStrictEqual([a.x, a.y, a.width, b.x, b.y], [0, 0, 6, 144, 0]);
    assert.deepStrictEqual([c.iconUrl, c.width, c.color, c.active, c.order - a.order], [null, 100, "#888888", false, 2]);
  });

  await test("board rows wrap after 8 pieces; more than 500 is refused", async () => {
    const deps = { JSZip, subtle: crypto.webcrypto.subtle, random: n => crypto.randomBytes(n) };
    const { data } = await R.build({ characters: Array.from({ length: 10 }, (_, i) => ({ name: "n" + i, active: true, size: 2 })) }, deps);
    const list = Object.values(data.entities.characters);
    assert.deepStrictEqual([list[7].x, list[7].y, list[8].x, list[8].y, list[9].x], [336, 0, 0, 48, 48]);
    await assert.rejects(R.build({ characters: Array.from({ length: 501 }, () => ({ name: "x" })) }, deps));
  });

  console.log(`${passed} tests passed`);
})().catch(err => { console.error(err); process.exit(1); });
