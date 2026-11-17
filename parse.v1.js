/*!
 * parse.v1.js - a pasted table (TSV / CSV) -> characters (no UI)
 *
 * The first row is the header. Each column gets a kind from its header (KINDS), a prefix
 * ("ステータス:HP", "パラメータ:DEX", "差分:笑顔"), or, for headers we do not know, from its cells:
 * a column with "10/12" cells or a usual status name (HP, MP, SAN) is a status, the rest are
 * parameters. The caller can override the kind per header.
 *
 *   CbParse.parse(text, overrides) -> { columns, chars, warnings }
 *     columns: [{ index, header, label, kind, auto }]   (label: the header without its prefix)
 *     chars:   [{ line, name, memo, initiative, externalUrl, commands, imageName, color, size,
 *                 active, secret, invisible, hideStatus,      (null when the table does not say)
 *                 status: [{ label, value, max }], params: [{ label, value }],
 *                 faces: [{ label, imageName }] }]
 */
(function (root) {
  "use strict";

  // Words looked for in pasted text (stay Japanese in every language): words.v1.js.
  const W = root.CbWords;
  // Texts for the page are written in Japanese and go through I18n.t() when the page has it.
  const tr = (text, vars) => root.I18n ? root.I18n.t(text, vars)
    : text.replace(/\{(\w+)\}/g, (all, name) => (vars && name in vars ? String(vars[name]) : all));

  // Compare names loosely: full-width and half-width, upper and lower case, spaces.
  const key = s => String(s == null ? "" : s).normalize("NFKC").toLowerCase().replace(/\s+/g, "");

  const KINDS = [
    { id: "name", label: "名前", heads: W.heads.name || [] },
    { id: "memo", label: "メモ", heads: W.heads.memo || [] },
    { id: "initiative", label: "イニシアチブ", heads: W.heads.initiative || [] },
    { id: "status", label: "ステータス", heads: W.heads.status || [] },
    { id: "param", label: "パラメータ", heads: W.heads.param || [] },
    { id: "commands", label: "チャットパレット", heads: W.heads.commands || [] },
    { id: "image", label: "立ち絵（画像の名前）", heads: W.heads.image || [] },
    { id: "face", label: "差分（画像の名前）", heads: W.heads.face || [] },
    { id: "externalUrl", label: "参照 URL", heads: W.heads.externalUrl || [] },
    { id: "color", label: "色", heads: W.heads.color || [] },
    { id: "size", label: "駒サイズ", heads: W.heads.size || [] },
    { id: "active", label: "盤面に出す", heads: W.heads.active || [] },
    { id: "secret", label: "ステータスを非公開", heads: W.heads.secret || [] },
    { id: "invisible", label: "発言時に立ち絵を出さない", heads: W.heads.invisible || [] },
    { id: "hideStatus", label: "盤面の一覧に出さない", heads: W.heads.hideStatus || [] },
    { id: "ignore", label: "使わない", heads: W.heads.ignore || [] },
  ];
  const KIND_IDS = KINDS.map(k => k.id);
  const BY_HEAD = new Map();
  for (const k of KINDS) for (const h of k.heads) BY_HEAD.set(key(h), k.id);

  const PREFIX = [
    [/^(?:ステータス|status)\s*[:：]\s*/i, "status"],
    [/^(?:パラメータ|パラメーター|param|params)\s*[:：]\s*/i, "param"],
    [/^(?:差分|face)\s*[:：]\s*/i, "face"],
  ];
  const STATUS_HEADS = new Set(W.statusHeads.map(key));
  const FRACTION = /^\s*-?\d+(?:\.\d+)?\s*[\/／]\s*-?\d+(?:\.\d+)?\s*$/;
  const YES = new Set(W.yes.map(key));
  const NO = new Set(W.no.map(key));

  // Split delimited text into rows of cells. Cells may be quoted ("a ""b"" c", line breaks inside).
  function split(text, delimiter) {
    const s = String(text || "").replace(/\r\n?/g, "\n");
    const rows = [];
    let row = [], cell = "", i = 0, quoted = false, line = 0;
    // line: the row number as a spreadsheet counts it (a cell with line breaks is still one row)
    const endRow = () => { row.push(cell); rows.push({ line: ++line, cells: row }); row = []; cell = ""; };
    while (i < s.length) {
      const ch = s[i];
      if (quoted) {
        if (ch === '"') {
          if (s[i + 1] === '"') { cell += '"'; i += 2; continue; }
          quoted = false; i++; continue;
        }
        cell += ch; i++; continue;
      }
      if (ch === '"' && cell === "") { quoted = true; i++; continue; }
      if (ch === delimiter) { row.push(cell); cell = ""; i++; continue; }
      if (ch === "\n") { endRow(); i++; continue; }
      cell += ch; i++;
    }
    if (cell !== "" || row.length) endRow();
    return rows.filter(r => r.cells.some(c => c.trim() !== ""));
  }

  // Tabs when the header has one (pasted from a spreadsheet), commas otherwise.
  const delimiterOf = text => /\t/.test(String(text || "").split(/\r?\n/, 1)[0]) ? "\t" : ",";

  function number(v) {
    const n = parseFloat(String(v).normalize("NFKC").replace(/[,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function flag(v) {
    const k = key(v);
    if (YES.has(k)) return true;
    if (NO.has(k)) return false;
    return null;
  }

  function columnsOf(rows, overrides) {
    const head = rows[0].cells;
    const over = overrides || {};
    let named = false;
    const columns = head.map((raw, index) => {
      const header = raw.trim();
      let label = header, kind = null;
      for (const [re, id] of PREFIX) if (re.test(header)) { kind = id; label = header.replace(re, "").trim(); break; }
      if (!kind && !header) kind = "ignore";
      if (!kind) kind = BY_HEAD.get(key(header)) || null;
      if (!kind) {
        const fraction = rows.slice(1).some(r => FRACTION.test(r.cells[index] || ""));
        kind = fraction || STATUS_HEADS.has(key(header)) ? "status" : "param";
      }
      const auto = kind;
      if (header && KIND_IDS.includes(over[header])) kind = over[header];
      if (kind === "name") named = true;
      return { index, header, label, kind, auto };
    });
    return { columns, named };
  }

  function parse(text, overrides) {
    const warnings = [];
    const rows = split(text, delimiterOf(text));
    if (!rows.length) return { columns: [], chars: [], warnings };
    const { columns, named } = columnsOf(rows, overrides);
    if (!named && columns.length) {
      columns[0].kind = "name";
      warnings.push(tr("名前の列が見つからなかったので、1 列目を名前にしました（1 行目は見出しとして読んでいます）。"));
    }
    const firstName = columns.find(c => c.kind === "name");
    const chars = [];
    for (const row of rows.slice(1)) {
      const c = {
        line: row.line, name: "", memo: "", initiative: null, externalUrl: "", commands: "", imageName: "", color: "", size: null,
        active: null, secret: null, invisible: null, hideStatus: null, status: [], params: [], faces: [],
      };
      const join = (a, b) => a && b ? a + "\n" + b : a || b;
      for (const col of columns) {
        const cell = (row.cells[col.index] || "").trim();
        if (cell === "" || col.kind === "ignore") continue;
        const where = tr("{line} 行目「{header}」", { line: row.line, header: col.header });
        switch (col.kind) {
          case "name": if (col === firstName) c.name = cell.replace(/\s*\n\s*/g, " "); break;
          case "memo": c.memo = join(c.memo, cell); break;
          case "commands": c.commands = join(c.commands, cell); break;
          case "externalUrl": c.externalUrl = cell; break;
          case "image": c.imageName = cell; break;
          case "face": c.faces.push({ label: col.label, imageName: cell }); break;
          case "initiative": case "size": {
            const n = number(cell);
            if (n == null) warnings.push(tr("{where}の「{cell}」は数として読めませんでした。", { where, cell }));
            else c[col.kind] = n;
            break;
          }
          case "color": {
            const m = /^#?([0-9a-f]{6})$/i.exec(cell.normalize("NFKC"));
            if (m) c.color = "#" + m[1].toLowerCase();
            else warnings.push(tr("{where}の「{cell}」は色（#888888 の形）として読めませんでした。", { where, cell }));
            break;
          }
          case "active": case "secret": case "invisible": case "hideStatus": {
            const f = flag(cell);
            if (f == null) warnings.push(tr("{where}の「{cell}」は ○ / × として読めませんでした。", { where, cell }));
            else c[col.kind] = f;
            break;
          }
          case "status": {
            const parts = cell.normalize("NFKC").split("/");
            const value = number(parts[0]), max = parts.length > 1 ? number(parts[1]) : value;
            if (value == null || max == null || parts.length > 2) warnings.push(tr("{where}の「{cell}」は「10」か「10/12」の形で入れてください（0 にしました）。", { where, cell }));
            c.status.push({ label: col.label, value: value == null ? 0 : value, max: max == null ? 0 : max });
            break;
          }
          case "param": c.params.push({ label: col.label, value: cell }); break;
        }
      }
      chars.push(c);
    }
    return { columns, chars, warnings };
  }

  // ---------------------------------------------------------------- NPC text (memo mode)
  //
  //   黒い影 ×3                    <- the first line of a block is the name; ×N makes N of them
  //   HP 20  DEX 80  SAN 55/99     <- label + number: a status (HP, MP, SAN or n/m), a parameter
  //   かぎ爪 70 1d6+1d4 / 回避 40     (abilities) or a skill, which becomes a line of the palette
  //   メモ: 路地裏に出る             <- メモ / 立ち絵 / URL lines; a line that is already a command
  //                                   goes to the palette as it is
  // Blocks are separated by empty lines.
  //
  // The same reader takes NPC data copied from scenarios, where every writer has a style and PDF
  // copies add their own damage. Rather than rules per scenario, it absorbs what they share:
  // glued labels (STR12), brackets (〈回避〉 《》 【】 ＜＞ 〔〕), 成功値 / 成功率 / %, the other
  // edition's value in brackets (12(60), 60%(30/12)), paired labels (STR／DEX 60／50), damage
  // written after a skill in many ways, section headings (技能: 武器: 呪文: …), and from PDFs:
  // letters and digits split by spaces (D EX, 7 5), values or brackets carried to the next line.
  // Each character keeps `source`: its lines and what was read from each, so the page can show
  // what was missed. Explanations are not put in the memo unless asked (proseToMemo): CCFOLIA
  // shows a piece's memo to the other players.

  // Written as char codes: brackets and the full-width colon are data, not texts to translate.
  const LB = String.fromCharCode(0x3010), RB = String.fromCharCode(0x3011), FULL_COLON = String.fromCharCode(0xFF1A);
  const ROLLS = { auto: null, ccb: "CCB<=", cc: "CC<=", d100: "1d100<=", none: "" };
  const MAX_COPIES = 100;
  const ABILITIES = ["STR", "CON", "POW", "DEX", "APP", "SIZ", "INT", "EDU"];
  const JOINABLE = new Set(ABILITIES.concat(["SAN", "LUK", "MOV", "BLD"]));
  const CANON = new Map(); // key(label) -> { label, kind }
  const canon = (kind, label, ...aliases) => { for (const a of [label, ...aliases]) CANON.set(key(a), { label, kind }); };
  for (const a of ABILITIES) canon("param", a);
  for (const [kind, label, ...aliases] of W.canon) canon(kind, label, ...aliases);
  // Skill names of both editions, only to tell known labels from unknown ones on the page.
  const SKILLS = new Set(W.skills.map(key));
  const baseKey = label => key(String(label).replace(/[(（].*$/, ""));

  const SECTION_WORDS = [
    [/^(?:ステータス|能力値|能力値・?技能|能力値と技能|基本ステータス|データ)$/, "stats"],
    [/^(?:技能|主な技能|主要技能|戦闘技能|探索技能|その他の?技能|所持技能|戦闘|攻撃方法)$/, "stats"],
    [/^(?:武器|装備|所持品|武器・装備)$/, "weapons"],
    [/^(?:呪文|習得呪文|特殊能力|能力|特技|備考|特徴|補足|解説|注意|行動|設定)$/, "text"],
    [/^(?:メモ|memo|キャラクターメモ)$/i, "memo"],
    [/^(?:.*チャパレ|.*チャットパレット|コマンド|パレット)$/, "palette"],
  ];
  const sectionKind = word => { for (const [re, kind] of SECTION_WORDS) if (re.test(word)) return kind; return null; };
  const MARKS = /^[■□◆◇●○▼▽★☆◎§・\s]+/;

  // A section heading: 【ステータス】 / 技能: 〈回避〉40 / 武器: -> { kind, rest }
  function sectionOf(line) {
    const s = line.replace(MARKS, "");
    let m = /^[〈《<【〔[「『(]([^〉》>】〕\]」』)]{1,20})[〉》>】〕\]」』)]\s*(.*)$/.exec(s);
    if (m) { const kind = sectionKind(m[1].replace(/[:\s]+$/, "")); return kind ? { kind, rest: m[2] } : null; }
    m = /^([^\s:]{1,14}?)\s*(?::\s*|\s+|$)(.*)$/.exec(s);
    const kind = m && sectionKind(m[1]);
    if (!kind || /^[+\-]?\d/.test(m[2])) return null; // 戦闘 60 is a skill
    return { kind, rest: m[2] };
  }

  const KANA = /^[ぁ-ゟ゠-ヿ\s・=ー]+$/; // a reading, not part of the name

  // The first line of a block: ■名前(よみ)、肩書き / 【名前】 / 名前 ×3 / 肩書き─名前(よみ)
  function headingOf(line) {
    let s = line.replace(MARKS, "").trim()
      .replace(/^(?:名前|name|エネミーデータ|エネミー|敵データ|敵情報|NPCデータ|NPC|モブ)\s*:\s*/i, "");
    const extra = [];
    let m = /^[【《〈<[〔「『]([^】》〉>\]〕」』]+)[】》〉>\]〕」』]\s*(.*)$/.exec(s);
    if (m) { s = m[1].trim(); extra.push(m[2]); }
    let count = 1;
    m = /^(.*?)(?:\s*[×✕✖*]\s*|\s+[xX]\s*)(\d{1,3})\s*(?:体|人|匹)?\s*(.*)$/.exec(s);
    if (m && m[1].trim()) { s = m[1].trim(); count = parseInt(m[2], 10); extra.push(m[3]); }
    m = /^(.+?)\s*[─—―]+\s*(.+)$/.exec(s) || /^(.+?)\s+-\s+(.+)$/.exec(s);
    if (m) {
      const reading = /\(([^()]*)\)/.exec(m[2]);
      if (reading && KANA.test(reading[1])) { extra.push(m[1]); s = m[2]; } else { extra.push(m[2]); s = m[1]; }
    }
    m = /^([^、,]+?)\s*[、,]\s*(.+)$/.exec(s);
    if (m) { s = m[1]; extra.push(m[2]); }
    // (よみ) (34 歳) (139) and what follows them
    for (let i = 0; i < 3; i++) {
      m = /^(.+?)\s*\(([^()]*)\)\s*(.*)$/.exec(s);
      if (!m || !(KANA.test(m[2]) || /\d/.test(m[2]))) break;
      s = m[1];
      extra.push(`(${m[2]})`, m[3]);
    }
    return { name: s.trim(), count, extra: extra.map(t => t.trim()).filter(Boolean) };
  }

  // ---- reading the items of a line

  const PROT = 0xE100; // a protected piece of text becomes one private character
  const NUM = /^[+\-]?\d+(?:\.\d+)?(?:\/[+\-]?\d+(?:\.\d+)?)?$/;
  const DICE_START = /^[+\-]?\d*[dD]\d+/;
  const DICE = /^[+\-]?(?:\d*[dD]\d+|\d+)(?:[+\-*/](?:\d*[dD]\d+|\d+|DB|db|\{DB\}))*/;
  const DAMAGE_WORD = /^(?:の?ダメージ|威力|dmg|ダメ)$/i;

  // NFKC, then everything that differs between writers is made one shape. -> { text, prot }
  function prepare(line) {
    const prot = [];
    const keep = (text, paren) => String.fromCharCode(PROT + prot.push({ text, paren }) - 1);
    let s = line.normalize("NFKC").replace(/±/g, "+");
    // labels in brackets: 〈回避〉 《芸術:ギター》 【かみつく】 <キック> 〔呪文:深淵の息〕
    s = s.replace(/[〈《<【〔[「『]([^〈《<【〔[「『〉》>】〕\]」』]{1,40})[〉》>】〕\]」』]/g, (all, t) => ` ${keep(t.trim(), false)} `);
    // brackets that belong to a label: 芸術(魔術) 射撃(32口径拳銃) ; notes: (絶命時に発動する)
    s = s.replace(/\(([^()]*[^\d\s/()%.+\-][^()]*)\)/g, all => keep(all, true));
    s = s.replace(/※\s*\d+/g, " ");                                                        // 99%※2
    s = s.replace(/\b([A-Z])\s+([A-Z]{2})\b/g, (all, a, b) => JOINABLE.has(a + b) ? a + b : all); // D EX
    s = s.replace(/(^|[^\d])(\d(?: \d)+)(?!\d)/g, (all, pre, d) => pre + d.replace(/ /g, ""));      // 7 5
    s = s.replace(/\s*\(\s*[\d\s/]*\)?/g, " ");                     // 12(60) 60(30/12) (1 0 : the other edition
    // paired labels: STR/DEX 60/50 , STR / CON | 80 / 65
    s = s.replace(/((?:[A-Za-z]{2,4}|[^\s\d,/:=|]{1,6})(?:\s*\/\s*(?:[A-Za-z]{2,4}|[^\s\d,/:=|]{1,6}))+)\s*[:=|]?\s*([+\-]?\d+(?:\s*\/\s*[+\-]?\d+)+)/g,
      (all, labels, values) => {
        const ls = labels.split(/\s*\/\s*/), vs = values.split(/\s*\/\s*/);
        return ls.length === vs.length ? ls.map((l, i) => `${l} ${vs[i]}`).join(" , ") : all;
      });
    s = s.replace(/(成功率|成功値|技能値|確率)/g, " ").replace(/%/g, " ");
    for (let i = 0; i < 3; i++) s = s.replace(/(\d*[dD]\d+)\s*([+\-])\s*(?=\d|DB\b|db\b)/g, "$1$2");  // 1D10 + DB
    s = s.replace(/[、,|;]/g, " , ");
    s = s.replace(/\/(?!\s*[+\-]?\d)/g, " , ").replace(/([^\d\s])\s*\//g, "$1 , ");          // a slash between numbers is n/m
    s = s.replace(/([^\s\d:=])\s*[:=]\s*/g, "$1 ");                                           // HP:12
    s = s.replace(/([^\s\d.+\-*/(,dD])(?=\d)/g, "$1 ");                                         // STR12 (not 1d6)
    s = s.replace(/(\d)(?=[^\s\d.dD+\-*/),])/g, "$1 ");                                         // 99天文学
    return { text: s.replace(/\s+/g, " ").trim(), prot };
  }

  const restoreWith = prot => t => t.replace(/[-]/g, c => prot[c.charCodeAt(0) - PROT].text);

  function setDamage(item, token, restore) {
    const t = restore(token);
    const m = DICE.exec(t);
    item.damage = m[0];
    item.note = t.slice(m[0].length).replace(/^[+\s]+/, "").replace(/^の?ダメージ/, "").replace(/^[+\s]+/, "");
  }

  // -> { items: [{ label, value, max, raw, damage, note }], leftover: [text], stopped }
  function readItems(text, prot) {
    const restore = restoreWith(prot);
    const tokens = text.split(" ").filter(Boolean);
    const isNote = t => t.length === 1 && t.charCodeAt(0) >= PROT && prot[t.charCodeAt(0) - PROT] && prot[t.charCodeAt(0) - PROT].paren;
    const items = [], leftover = [];
    let label = [], last = null;
    const flush = () => { if (label.length) leftover.push(restore(label.join(" "))); label = []; };
    const after = (i, item) => { // damage right after a value: 1d6 / ダメージ 1d6 / 1d6のダメージ / (注)1d4ダメージ+拘束
      let k = i;
      if (tokens[k] && isNote(tokens[k])) k++;
      if (tokens[k] && DAMAGE_WORD.test(restore(tokens[k])) && tokens[k + 1] && DICE_START.test(tokens[k + 1])) k++;
      if (!tokens[k] || !DICE_START.test(tokens[k])) return i;
      setDamage(item, tokens[k], restore);
      k++;
      if (tokens[k] && /^の?ダメージ/.test(restore(tokens[k]))) {
        const rest = restore(tokens[k]).replace(/^の?ダメージ/, "").replace(/^[+\s]+/, "");
        if (rest) item.note = item.note ? item.note + " " + rest : rest;
        k++;
      }
      return k;
    };
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i], word = restore(t);
      if (t === "," || t === "/") { flush(); continue; }
      if (isNote(t) && !label.length) continue;
      if (/^呪文/.test(word) && !(tokens[i + 1] && NUM.test(tokens[i + 1]))) { // a spell and what it does
        flush();
        leftover.push(restore(tokens.slice(i).join(" ")));
        return { items, leftover, stopped: true };
      }
      if (word === W.none && label.length) { label = []; continue; }            // 装甲なし
      if (label.length && NUM.test(t)) {
        const [a, b] = t.split("/");
        const item = { label: restore(label.join(" ")).trim(), value: parseFloat(a), max: b == null ? null : parseFloat(b), raw: a, damage: "", note: "" };
        label = [];
        items.push(item);
        last = item;
        i = after(i + 1, item) - 1;
        continue;
      }
      if (DICE_START.test(t)) {
        const damageWord = label.length === 1 && DAMAGE_WORD.test(restore(label[0]));
        if (label.length && !damageWord) {                                       // DB 1d6
          items.push({ label: restore(label.join(" ")).trim(), value: null, max: null, raw: restore(t), damage: "", note: "" });
          label = [];
          continue;
        }
        if (last && !last.damage) { label = []; i = after(i, last) - 1; continue; } // ダメージ 1d6 / 1d6のダメージ
      }
      label.push(t);
    }
    flush();
    return { items, leftover, stopped: false };
  }

  // ---- lines of a block

  const COMMAND = /^(?:s?(?:CCB?|RESB?|CBRB?)\b|s?\d*[dD]\d+|choice|[:@])/i;
  const PROSE = /。|[ぁ-ゟ]{6,}/;
  const hasDigit = t => /\d/.test(t.normalize("NFKC"));
  const opens = t => (t.match(/[〈《<【〔[「『(（＜]/g) || []).length;
  const closes = t => (t.match(/[〉》>】〕\]」』)）＞]/g) || []).length;

  // PDF copies break lines inside an item. Join them back. -> [{ line, text, raw }]
  function joinLines(rows) {
    const out = [];
    for (const row of rows) {
      const prev = out[out.length - 1];
      const t = row.text.trim();
      if (prev) {
        const p = prev.text;
        const short = t.length <= 2 && /^[ぁ-ヿ]+$/.test(t) && /[ぁ-ヿ]$/.test(p);
        if (/^[、,，]/.test(t) || short || (opens(p) > closes(p) && closes(t) > opens(t))) {
          prev.text = p + t; prev.raw.push(row.text); continue;                    // 、肩書き / スタ+ン / 〈こぶし+〉80
        }
        if (/[^\d\s%。]$/.test(p) && !PROSE.test(p) && /^\d[\d ]*(?:[%％(（\s]|$)/.test(t) && !sectionOf(p.normalize("NFKC"))) {
          prev.text = p + " " + t; prev.raw.push(row.text); continue;              // 〈図書館〉 + 80
        }
      }
      out.push({ line: row.line, text: t, raw: [row.text] });
    }
    return out;
  }

  // 7th edition: values of the other edition in brackets (30/12), or abilities like 50, 65, 80.
  function editionOf(text, abilities, skills) {
    if (/%\s*[(（]\s*\d+\s*[/／]\s*\d+/.test(text.normalize("NFKC"))) return 7;
    if (abilities.length >= 3 && abilities.filter(v => v > 20).length >= abilities.length * 0.75 && abilities.every(v => v % 5 === 0)) return 7;
    if (skills.some(s => /^(?:近接戦闘|射撃|手さばき|魅惑|威圧)/.test(s.label))) return 7;
    return 6;
  }

  const normDb = v => { const t = String(v).trim(); return /^[+\-]/.test(t) ? t : t === "0" ? "+0" : "+" + t; };

  function readBlock(rows, o, labelsOut, hints) {
    const lines = joinLines(rows);
    const c = {
      line: rows[0].line, name: "", memo: "", initiative: null, externalUrl: "", commands: "", imageName: "", color: "", size: null,
      active: null, secret: null, invisible: null, hideStatus: null, status: [], params: [], faces: [], source: [],
    };
    const skills = [], explicit = [], memo = [], prose = [];
    const weaponDamage = new Map();
    let count = 1, section = "stats", weapon = "", lastSkill = null, strSeen = 0;
    const source = (l, state, read) => c.source.push({ line: l.line, text: l.raw.join("\n"), state, read: read || [] });

    lines.forEach((l, idx) => {
      const nfkc = l.text.normalize("NFKC");
      // name
      if (idx === 0) {
        const sec = sectionOf(nfkc);
        const first = prepare(nfkc).text.split(" ")[0] || "";
        const restore0 = prepare(nfkc);
        const firstWord = restoreWith(restore0.prot)(first);
        const statFirst = !/^(?:名前|name)\s*:/i.test(nfkc) && (CANON.has(key(firstWord)) || SKILLS.has(baseKey(firstWord)));
        if (!sec && !statFirst) {
          const h = headingOf(nfkc);
          c.name = h.name;
          count = h.count;
          if (o.proseToMemo) memo.push(...h.extra);
          source(l, "name", [tr("名前: {name}", { name: h.name }) + (h.count > 1 ? ` ×${h.count}` : "")]);
          return;
        }
        hints.push(tr("{line} 行目からの NPC に名前がありません。最初の行に名前を書いてください。", { line: l.line }));
      }
      // メモ: / 立ち絵: / URL: / パレット:
      const tagged = /^(メモ|memo|立ち絵|画像|url|参照url|パレット|チャットパレット|コマンド)\s*:\s*(.+)$/i.exec(nfkc);
      if (tagged) {
        const k = key(tagged[1]), v = tagged[2].trim();
        if (W.tags.memo.includes(k)) memo.push(v);
        else if (W.tags.image.includes(k)) c.imageName = v;
        else if (W.tags.url.includes(k)) c.externalUrl = v;
        else explicit.push(v);
        source(l, "read", [`${tagged[1]}: ${v}`]);
        return;
      }
      if (/^https?:\/\/\S+$/.test(nfkc)) { c.externalUrl = nfkc; source(l, "read", [tr("参照 URL")]); return; }
      let text = nfkc;
      const sec = sectionOf(nfkc);
      if (sec) {
        section = sec.kind;
        weapon = "";
        if (!sec.rest) { source(l, "section"); return; }
        text = sec.rest;
      }
      if (section === "memo") { memo.push(text); source(l, "read", [tr("メモ")]); return; }
      if (section === "text" || /^[#※]/.test(text)) { prose.push(text); source(l, "skip"); return; }
      // commands written in the scenario: CCB<=80 触肢 / sCCB<=60 【こぶし】 sCCB<=50 【回避】 1d3 【…】
      const damageLine = DICE_START.test(text) && /ダメージ|威力/.test(text) && lastSkill && !lastSkill.damage && !/【/.test(text);
      if (section === "palette" || (!damageLine && (COMMAND.test(text) || /<=/.test(text)))) {
        const cmds = text.split(/\s+(?=s?(?:CCB?|RESB?|CBRB?)\s*(?:<=|\()|s?\d*[dD]\d+\s*[【[(])/i)
          .map(t => t.trim()).filter(Boolean).map(t => /【/.test(t) ? t : t.replace(/^(\S+)\s+(.+)$/, `$1 ${LB}$2${RB}`));
        explicit.push(...cmds);
        source(l, "read", cmds.map(t => tr("パレット: {command}", { command: t })));
        return;
      }
      if (damageLine || /^(?:もしくは|または|or)\s*\d*[dD]\d+/i.test(text)) {   // 1d6のダメージ (on its own line)
        const alt = !damageLine;
        const p = prepare(text.replace(/^(?:もしくは|または|or)\s*/i, ""));
        const [tok, ...rest] = p.text.split(" ");
        const item = { damage: "", note: "" };
        setDamage(item, tok, restoreWith(p.prot));
        // もしくは1D6+DB（肉切りナイフ使用時）: the note in brackets says when
        const note = rest.find(t => t.length === 1 && p.prot[t.charCodeAt(0) - PROT] && p.prot[t.charCodeAt(0) - PROT].paren);
        if (note && !item.note) item.note = p.prot[note.charCodeAt(0) - PROT].text.replace(/^\(|\)$/g, "");
        if (alt) (lastSkill.alts = lastSkill.alts || []).push(item); else Object.assign(lastSkill, item);
        source(l, "read", [tr("{label}のダメージ {damage}", { label: lastSkill.label, damage: item.damage })]);
        return;
      }
      // (ダメージ1d10/ 装弾数8 /…) under a weapon skill
      if (/^\s*[(（][^)）]*[)）]\s*$/.test(text) && section !== "weapons") {
        const m = /ダメージ\s*[:：]?\s*([+\-]?\d*[dD]\d+(?:\s*[+\-]\s*(?:\d*[dD]\d+|\d+|DB))*)/i.exec(text);
        if (m && lastSkill && !lastSkill.damage) {
          lastSkill.damage = m[1].replace(/\s+/g, "");
          source(l, "read", [tr("{label}のダメージ {damage}", { label: lastSkill.label, damage: lastSkill.damage })]);
        } else source(l, "skip");
        return;
      }
      if (section === "weapons" && !/%|％/.test(l.text)) {                     // 日本刀 / ダメージ1D10 ＋ DB、射程…
        const m = /ダメージ\s*[:：]?\s*([+\-]?\d*[dD]\d+(?:\s*[+\-]\s*(?:\d*[dD]\d+|\d+|DB))*)/i.exec(text);
        if (m && weapon) { weaponDamage.set(baseKey(weapon), m[1].replace(/\s+/g, "")); source(l, "read", [tr("{label}のダメージ {damage}", { label: weapon, damage: m[1].replace(/\s+/g, "") })]); }
        else if (!m) { weapon = text.replace(/[〈《<【〔「『〉》>】〕」』]/g, "").replace(/\s+/g, "").trim(); source(l, "read", [tr("武器: {name}", { name: weapon })]); }
        else source(l, "skip");
        return;
      }
      const p = prepare(text);
      const firstWord = restoreWith(p.prot)(p.text.split(" ")[0] || "");
      if (PROSE.test(p.text.replace(/[-]/g, "")) && !CANON.has(key(firstWord))) { prose.push(text); source(l, "skip"); return; }
      const { items, leftover, stopped } = readItems(p.text, p.prot);
      // what follows a spell is its description, not data that was missed
      if (stopped) prose.push(leftover.pop());
      const read = [];
      for (const it of items) {
        const k = key(it.label), known = CANON.get(k);
        const auto = known ? known.kind : it.value == null ? "param" : it.max != null ? "status" : /[点値数]$/.test(it.label) ? "status" : "skill";
        const kind = (o.labels && o.labels[k]) || auto;
        const label = known ? known.label : it.label.replace(/:/g, FULL_COLON);
        // written: as the scenario wrote it (耐久力), label: what it becomes (HP)
        const entry = labelsOut.get(k) || { label, written: it.label, key: k, auto, kind, known: !!known || SKILLS.has(baseKey(it.label)), count: 0 };
        entry.count++;
        labelsOut.set(k, entry);
        if (kind === "ignore") { read.push(tr("（使わない）{label}", { label })); continue; }
        if (kind === "initiative") { c.initiative = it.value; read.push(tr("イニシアチブ {value}", { value: it.value })); continue; }
        if (label === "STR") strSeen++;
        if (kind === "status") {
          const s = { label, value: it.value == null ? 0 : it.value, max: it.max == null ? (it.value == null ? 0 : it.value) : it.max };
          const at = c.status.findIndex(x => x.label === label);
          if (at >= 0) c.status[at] = s; else c.status.push(s);
          read.push(`${label} ${s.value}${s.max !== s.value ? "/" + s.max : ""}`);
        } else if (kind === "param") {
          let value = it.value == null || /^[+\-]/.test(it.raw) ? it.raw : String(it.value);
          if (label === "DB") value = normDb(value);
          const at = c.params.findIndex(x => x.label === label);
          if (at >= 0) c.params[at].value = value; else c.params.push({ label, value });
          read.push(`${label} ${value}`);
        } else {
          const s = { label, value: it.value == null ? 0 : it.value, damage: it.damage, note: it.note };
          skills.push(s);
          lastSkill = s;
          read.push(`${label} ${s.value}` + (s.damage ? tr("（ダメージ {damage}）", { damage: s.damage }) : ""));
        }
      }
      const unread = leftover.filter(hasDigit);
      source(l, !items.length && !unread.length ? "skip" : unread.length ? (items.length ? "partial" : "unread") : "read", read.concat(unread.map(t => `⚠${t}`))); // ⚠ marks what was not read
      if (!items.length && !unread.length) prose.push(text);
    });

    // weapons listed apart: 日本刀 90% + 武器: 日本刀 / ダメージ1D10+DB
    for (const s of skills) if (!s.damage && weaponDamage.has(baseKey(s.label))) s.damage = weaponDamage.get(baseKey(s.label));
    if (c.initiative == null) {
      const dex = c.params.find(p => p.label === "DEX");
      if (dex && number(dex.value) != null) c.initiative = number(dex.value);
    }
    const abilities = c.params.filter(p => ABILITIES.includes(p.label)).map(p => number(p.value)).filter(v => v != null);
    c.edition = editionOf(rows.map(r => r.text).join("\n"), abilities, skills);
    let prefix = o.roll in ROLLS && o.roll !== "auto" ? ROLLS[o.roll] : c.edition === 7 ? ROLLS.cc : ROLLS.ccb;
    if (prefix && o.secretRoll) prefix = "s" + prefix;
    const hasDb = c.params.some(p => p.label === "DB");
    const dmg = d => hasDb ? d.replace(/\+\s*DB\b/gi, "{DB}") : d;
    // what the scenario already wrote as commands is not written twice
    const written = new Set();
    for (const t of explicit) { const m = /【([^】]+)】/.exec(t); if (m) written.add(key(m[1])); }
    // 【かぎ爪ダメージ】 / 【かぎ爪ダメージ（拘束）】, in the page's language
    const damageLabel = (label, note) => note ? tr("{label}ダメージ（{note}）", { label, note }) : tr("{label}ダメージ", { label });
    const palette = [];
    for (const s of skills) {
      if (written.has(key(s.label))) continue;
      if (prefix) palette.push(`${prefix}${s.value} ${LB}${s.label}${RB}`);
      else c.params.push({ label: s.label, value: String(s.value) });
      if (s.damage) palette.push(`${dmg(s.damage)} ${LB}${damageLabel(s.label, s.note)}${RB}`);
      for (const a of s.alts || []) palette.push(`${dmg(a.damage)} ${LB}${damageLabel(s.label, a.note)}${RB}`);
    }
    c.commands = palette.concat(explicit).join("\n");
    c.memo = memo.concat(o.proseToMemo ? prose : []).join("\n");
    c.count = count;

    const who = c.name || tr("{line} 行目からの NPC", { line: c.line });
    const missed = c.source.filter(s => s.state === "partial" || s.state === "unread").map(s => s.line);
    if (missed.length) hints.push(tr("{who}: {lines} 行目に読めなかった数字があります。「ラベル 数字」（例: 目星 60）の形にすると読めます。", { who, lines: missed.slice(0, 4).join(", ") }));
    if (strSeen > 1) hints.push(tr("{who}: 能力値が {n} 回出てきます。何体ぶんかがつながっているときは、NPC の間に空行を入れてください。", { who, n: strSeen }));
    if (!c.status.length && !c.params.length && !skills.length && !explicit.length && c.source.length > 1) hints.push(tr("{who}: 数値を読み取れませんでした。", { who }));
    return c;
  }

  const suffix = (i, n, style) => style === "number" || n > 26 ? String(i + 1) : String.fromCharCode(65 + i);

  /**
   * opts: { roll: "auto" | "ccb" | "cc" | "d100" | "none", secretRoll, suffix: "alpha" | "number",
   *         proseToMemo, labels: { <key(label)>: "skill" | "status" | "param" | "ignore" } }
   * -> { columns: [], chars, warnings, labels: [{ label, key, auto, kind, known, count }] }
   */
  function parseMemo(text, opts) {
    const o = Object.assign({ roll: "auto" }, opts || {});
    const warnings = [], chars = [], labels = new Map();
    const blocks = [];
    let rows = [];
    String(text || "").replace(/\r\n?/g, "\n").split("\n").forEach((raw, i) => {
      if (raw.trim()) rows.push({ line: i + 1, text: raw });
      else if (rows.length) { blocks.push(rows); rows = []; }
    });
    if (rows.length) blocks.push(rows);
    for (const b of blocks) {
      const c = readBlock(b, o, labels, warnings);
      let n = c.count;
      delete c.count;
      if (n > MAX_COPIES) { warnings.push(tr("{line} 行目「{name}」は {max} 体までにしました。", { line: c.line, name: c.name, max: MAX_COPIES })); n = MAX_COPIES; }
      if (n <= 1) { chars.push(c); continue; }
      // Copies share the images named after the original.
      for (let i = 0; i < n; i++) {
        const copy = JSON.parse(JSON.stringify(c));
        chars.push(Object.assign(copy, { name: c.name + (/[A-Za-z0-9]$/.test(c.name) ? " " : "") + suffix(i, n, o.suffix), imageName: c.imageName || c.name }));
      }
    }
    return { columns: [], chars, warnings, labels: [...labels.values()] };
  }


  // ---------------------------------------------------------------- pasted pieces
  //
  // What character sheet sites copy for CCFOLIA: {"kind":"character","data":{...}} (CCFOLIA's
  // Clipboard API). Also read: an array of them, several of them one after another, and the same
  // wrapped in a string. iconUrl is left out: CCFOLIA does not take images from other sites.
  function parsePieces(text) {
    const found = [];
    const take = v => {
      if (typeof v === "string") { try { take(JSON.parse(v)); } catch (err) { /* not JSON */ } return; }
      if (Array.isArray(v)) { v.forEach(take); return; }
      if (v && typeof v === "object" && v.kind === "character" && v.data && typeof v.data === "object") found.push(v.data);
    };
    const s = String(text || "").trim();
    try { take(JSON.parse(s)); } catch (err) {
      // several objects one after another: cut at the top-level braces
      let depth = 0, start = -1, inString = false;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inString) { if (ch === "\\") i++; else if (ch === '"') inString = false; continue; }
        if (ch === '"') inString = true;
        else if (ch === "{") { if (depth++ === 0) start = i; }
        else if (ch === "}" && depth > 0 && --depth === 0) { try { take(JSON.parse(s.slice(start, i + 1))); } catch (e) { /* skip */ } }
      }
    }
    const str = v => typeof v === "string" ? v : "";
    return found.map(d => ({
      line: "⧉", name: str(d.name), memo: str(d.memo), initiative: number(d.initiative), externalUrl: str(d.externalUrl), commands: str(d.commands),
      imageName: "", color: /^#[0-9a-f]{6}$/i.test(str(d.color)) ? d.color : "", size: typeof d.width === "number" ? d.width : null,
      active: null, secret: typeof d.secret === "boolean" ? d.secret : null, invisible: typeof d.invisible === "boolean" ? d.invisible : null,
      hideStatus: typeof d.hideStatus === "boolean" ? d.hideStatus : null,
      status: (Array.isArray(d.status) ? d.status : []).filter(x => x && typeof x === "object")
        .map(x => ({ label: String(x.label == null ? "" : x.label), value: number(x.value) || 0, max: number(x.max) || 0 })),
      params: (Array.isArray(d.params) ? d.params : []).filter(x => x && typeof x === "object")
        .map(x => ({ label: String(x.label == null ? "" : x.label), value: String(x.value == null ? "" : x.value) })),
      faces: [], hadIcon: !!d.iconUrl,
    }));
  }

  root.CbParse = { parse, parseMemo, parsePieces, split, delimiterOf, key, KINDS, number, ROLLS };
})(typeof window !== "undefined" ? window : globalThis);
