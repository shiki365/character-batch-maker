/*!
 * app.v1.js - キャラクター一括メーカー (UI)
 *
 * state = { images, mode, memo, table, columns, labels, kept, pasted, opts, edited }
 *   images:  the image shelf (置き場): [{ id, kind: "file", name, type, size, hash }]
 *            Only what an image is lives in state; its bytes are a Blob in IndexedDB
 *            (localStorage holds a few MB at most). Project files carry them as data URLs.
 *   mode:    "memo" (NPC notes, see parse.v1.js) or "table". memo / table: the text of each.
 *   columns: { <header>: kind } where the user changed what a column of the table is.
 *   labels:  { <key(label)>: "skill" | "status" | "param" | "ignore" } where the user changed what a
 *            label of the memo is (警戒値 -> param). Kept by "最初に戻す", like the shelf: it is
 *            how this person's scenarios write things.
 *   kept:    characters the user confirmed ("確定"): the list as it was then, hand edits included.
 *            They come first and no longer follow the input, which is emptied for the next NPC.
 *   pasted:  characters taken from what character sheet sites copy for CCFOLIA; they follow the
 *            ones read from the text until confirmed.
 *   opts:    { active, size, commonCommands, secret, hideStatus, roll, secretRoll, suffix, proseToMemo }
 *            defaults for every character, and how the memo is read
 *   edited:  null while the list simply follows the input. The first hand edit freezes a copy of
 *            the list here; from then on the input no longer rebuilds it (the boxes are read-only)
 *            until the user confirms (edits are kept) or chooses "入力から作り直す" (they are not).
 * A character: { line, name, memo, initiative, externalUrl, commands, imageName, color, size,
 *                active, secret, invisible, hideStatus, status, params,
 *                image: "auto" | "none" | <image id>, autoFaces, faces: [{ label, imageId, imageName }] }
 *   size / active / secret / hideStatus are null to follow opts.
 *   image "auto": the shelf image named like the character (or like its 立ち絵 column).
 *   autoFaces: shelf images named <name>_<label> (also - @ space or brackets) become faces.
 * Images are looked up by name at render time, so images dropped in later still reach the list.
 * Undo keeps copies of the state without the shelf (max 150 steps).
 */
(function () {
  "use strict";

  // Texts are written in Japanese and go through t() (i18n.v1.js); the Japanese text is the key.
  const t = (text, vars) => (window.I18n ? window.I18n.t(text, vars)
    : vars ? text.replace(/\{(\w+)\}/g, (all, name) => (name in vars ? String(vars[name]) : all)) : text);
  const LANG = window.I18n ? window.I18n.lang : "ja";

  const P = window.CbParse, R = window.CbRoomData;
  const $ = sel => document.querySelector(sel);

  const APP = "ccf-character-batch-maker";
  const SAVE_KEY = APP + ".state";
  const MAX_IMAGE = 5 * 1024 * 1024; // CCFOLIA's upload limit for images
  const MAX_UNDO = 150;
  // "例を入れる": examples written for the page's language (samples.v1.js)
  const SAMPLES = window.CbSamples[LANG] || window.CbSamples.ja;

  const LABEL_KINDS = [["skill", t("技能（判定にする）")], ["status", t("ステータス")], ["param", t("パラメータ")], ["ignore", t("使わない")]];
  const SOURCE_STATE = { name: t("名前"), section: t("見出し"), skip: t("使わない"), read: "", partial: "", unread: "" };

  const uid = p => p + Math.random().toString(36).slice(2, 10);
  const defaultOpts = () => ({ active: false, size: 4, commonCommands: "", secret: false, hideStatus: false, roll: "auto", secretRoll: false, suffix: "alpha", proseToMemo: false });
  const defaultState = () => ({ images: [], mode: "memo", memo: "", table: "", columns: {}, labels: {}, kept: [], pasted: [], opts: defaultOpts(), edited: null });

  let state = defaultState();
  let parsed = { columns: [], chars: [], warnings: [] };
  let chars = [];
  let selected = -1;
  let auto = new Map();   // character -> { byImageName, byName, faces: [{ label, img }] } from shelf names
  let pendingPick = null; // called with the ids of the files chosen through #imageFile

  function status(message, isError) {
    const el = $("#status");
    el.textContent = message;
    el.classList.toggle("error", !!isError);
  }

  // ---------------------------------------------------------------- state

  const str = v => String(v == null ? "" : v);
  const numOr = (v, d) => typeof v === "number" && Number.isFinite(v) ? v : d;
  const boolOrNull = v => typeof v === "boolean" ? v : null;
  const clampSize = n => Math.min(Math.max(Math.round(n), 1), 100);

  const cleanChar = c => ({
    line: c.line || "", name: str(c.name), memo: str(c.memo), initiative: numOr(c.initiative, 0),
    externalUrl: str(c.externalUrl), commands: str(c.commands), imageName: str(c.imageName),
    color: /^#[0-9a-f]{6}$/i.test(c.color || "") ? c.color : "#888888",
    size: typeof c.size === "number" && Number.isFinite(c.size) ? clampSize(c.size) : null,
    active: boolOrNull(c.active), secret: boolOrNull(c.secret), invisible: !!c.invisible, hideStatus: boolOrNull(c.hideStatus),
    status: (Array.isArray(c.status) ? c.status : []).filter(s => s && typeof s === "object")
      .map(s => ({ label: str(s.label), value: numOr(s.value, 0), max: numOr(s.max, 0) })),
    params: (Array.isArray(c.params) ? c.params : []).filter(p => p && typeof p === "object")
      .map(p => ({ label: str(p.label), value: str(p.value) })),
    image: c.image ? str(c.image) : "auto", autoFaces: c.autoFaces !== false,
    faces: (Array.isArray(c.faces) ? c.faces : []).filter(f => f && typeof f === "object")
      .map(f => ({ label: str(f.label), imageId: f.imageId ? str(f.imageId) : null, imageName: str(f.imageName) })),
  });
  const cleanImage = im => ({ id: str(im.id), kind: "file", name: str(im.name), type: str(im.type), size: Number(im.size) || 0, hash: str(im.hash) });

  function normalize(s) {
    const d = defaultState();
    if (!s || typeof s !== "object") return d;
    const opts = Object.assign(defaultOpts(), s.opts && typeof s.opts === "object" ? s.opts : {});
    const columns = {};
    const kinds = P.KINDS.map(k => k.id);
    if (s.columns && typeof s.columns === "object") for (const h of Object.keys(s.columns)) if (kinds.includes(s.columns[h])) columns[h] = s.columns[h];
    const labels = {};
    if (s.labels && typeof s.labels === "object") for (const k of Object.keys(s.labels)) if (LABEL_KINDS.some(([id]) => id === s.labels[k])) labels[k] = s.labels[k];
    return {
      images: Array.isArray(s.images) ? s.images.filter(im => im && im.id && im.kind === "file").map(cleanImage) : [],
      // saves from before the memo had only a table
      mode: s.mode === "table" || (s.mode !== "memo" && str(s.table).trim()) ? "table" : "memo",
      memo: str(s.memo), table: str(s.table), columns, labels,
      kept: Array.isArray(s.kept) ? s.kept.filter(c => c && typeof c === "object").map(cleanChar) : [],
      pasted: Array.isArray(s.pasted) ? s.pasted.filter(c => c && typeof c === "object").map(cleanChar) : [],
      opts: { active: !!opts.active, size: clampSize(numOr(Number(opts.size), 4)), commonCommands: str(opts.commonCommands),
        secret: !!opts.secret, hideStatus: !!opts.hideStatus,
        roll: Object.prototype.hasOwnProperty.call(P.ROLLS, opts.roll) ? opts.roll : "auto", secretRoll: !!opts.secretRoll,
        suffix: opts.suffix === "number" ? "number" : "alpha", proseToMemo: !!opts.proseToMemo,
      },
      edited: Array.isArray(s.edited) ? s.edited.filter(c => c && typeof c === "object").map(cleanChar) : null,
    };
  }

  let saveTimer = 0, saving = true;
  function saveNow() {
    clearTimeout(saveTimer);
    if (!saving) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    } catch (err) {
      status(t("ブラウザに自動保存できませんでした。「プロジェクトを保存」でファイルに残してください。"), true);
    }
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }

  function loadSaved() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) state = normalize(JSON.parse(raw));
    } catch (err) { /* private mode or broken data: start fresh */ }
  }

  // ---------------------------------------------------------------- undo

  const snapshot = () => JSON.stringify({ mode: state.mode, memo: state.memo, table: state.table, columns: state.columns, labels: state.labels, kept: state.kept, pasted: state.pasted, opts: state.opts, edited: state.edited });
  let history = [], historyAt = -1, commitTimer = 0;

  function commit() {
    clearTimeout(commitTimer);
    const snap = snapshot();
    if (history[historyAt] === snap) return;
    history = history.slice(0, historyAt + 1);
    history.push(snap);
    if (history.length > MAX_UNDO + 1) history.shift();
    historyAt = history.length - 1;
    syncUndo();
  }
  // Typing becomes one step once it pauses (or on change, when the field is left).
  function scheduleCommit() {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commit, 700);
  }
  function syncUndo() {
    $("#undo").disabled = historyAt <= 0;
    $("#redo").disabled = historyAt >= history.length - 1;
  }
  function travel(d) {
    commit();
    const at = historyAt + d;
    if (at < 0 || at >= history.length) return;
    historyAt = at;
    const s = normalize(Object.assign(JSON.parse(history[at]), { images: state.images }));
    state = s;
    syncInputs();
    update({ noCommit: true });
    syncUndo();
    status(d < 0 ? t("元に戻しました。") : t("やり直しました。"));
  }

  // ---------------------------------------------------------------- images

  const DB_STORE = "images";
  const blobs = new Map(); // image id -> Blob (the bytes of the shelf's files while the page is open)
  const srcs = new Map();  // image id -> object URL
  let db = null;           // null when IndexedDB is unavailable: images then live only in memory

  // -> the database, null when unavailable, or "timeout" when it never answers (file:// in some
  // browsers). After a timeout nothing is saved, so data we could not read is not overwritten.
  function openDb() {
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve("timeout"), 1500);
      const done = v => { clearTimeout(timer); resolve(v); };
      try {
        const req = indexedDB.open(APP, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
        req.onsuccess = () => done(req.result);
        req.onerror = req.onblocked = () => done(null);
      } catch (err) { done(null); }
    });
  }

  function dbRun(mode, fn) {
    return new Promise((resolve, reject) => {
      if (!db) { reject(new Error("no IndexedDB")); return; }
      const tx = db.transaction(DB_STORE, mode);
      const req = fn(tx.objectStore(DB_STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error("IndexedDB"));
    });
  }

  const warnNotStored = () => status(t("画像をブラウザに保存できませんでした。このページを閉じると消えるので、「プロジェクトを保存」でファイルに残してください。"), true);
  function storeBlob(id, blob) { return dbRun("readwrite", s => s.put(blob, id)).catch(warnNotStored); }

  function holdBlob(id, blob) {
    if (srcs.has(id)) URL.revokeObjectURL(srcs.get(id));
    blobs.set(id, blob);
    srcs.set(id, URL.createObjectURL(blob));
  }

  function dropBlob(id) {
    if (srcs.has(id)) URL.revokeObjectURL(srcs.get(id));
    srcs.delete(id);
    blobs.delete(id);
    if (db) dbRun("readwrite", s => s.delete(id)).catch(() => {});
  }

  async function loadBlobs() {
    for (const im of state.images) {
      if (blobs.has(im.id)) continue;
      try {
        const blob = await dbRun("readonly", s => s.get(im.id));
        if (blob) holdBlob(im.id, blob);
      } catch (err) { /* shown as missing on the shelf */ }
    }
  }

  async function hashOf(blob) {
    try { return R.hex(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())); } catch (err) { return ""; }
  }

  const baseName = n => String(n || "").replace(/\.[^.]+$/, "") || t("画像");
  const blobToDataUrl = blob => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

  // Put files on the shelf. -> their ids, in order (a file already there gives the existing id).
  async function addFiles(files) {
    const ids = [];
    let bad = 0, big = 0, same = 0;
    for (const file of Array.from(files || [])) {
      if (!R.EXT[file.type]) { bad++; continue; }
      const hash = await hashOf(file);
      const had = hash && state.images.find(im => im.hash === hash && blobs.has(im.id));
      if (had) { ids.push(had.id); same++; continue; }
      const im = { id: uid("i"), kind: "file", name: baseName(file.name), type: file.type, size: file.size, hash };
      holdBlob(im.id, file);
      state.images.push(im);
      ids.push(im.id);
      if (file.size > MAX_IMAGE) big++;
      if (db) await storeBlob(im.id, file);
    }
    if (ids.length) saveNow();
    const added = ids.length - same;
    const parts = [];
    if (added) parts.push(t("画像を {n} 枚、置き場に入れました。", { n: added }));
    if (added && !db) parts.push(t("ただし、このブラウザでは画像を保存できないので、閉じる前に「プロジェクトを保存」でファイルに残してください。"));
    if (same) parts.push(t("{n} 枚は置き場にある画像と同じなので、それを使います。", { n: same }));
    if (bad) parts.push(t("{n} 個は使えない形式でした（PNG・JPEG・GIF・WebP が使えます）。", { n: bad }));
    if (big) parts.push(t("{n} 枚は 5 MB を超えています。ココフォリアで読み込めないことがあるので、小さくしてから使ってください。", { n: big }));
    if (parts.length) status(parts.join(""), !!(bad || big || (added && !db)));
    return ids;
  }

  const imageById = id => id ? state.images.find(im => im.id === id) || null : null;
  const imageSrc = img => img ? srcs.get(img.id) || "" : "";
  const sizeText = n => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
  const tooBig = img => !!(img && img.size > MAX_IMAGE);
  const missing = img => !!(img && !blobs.has(img.id));

  // Names are matched after NFKC (full-width brackets and underscores become half-width).
  const norm = s => String(s || "").normalize("NFKC").trim();
  const byName = name => { const k = P.key(name); return k ? state.images.find(im => P.key(im.name) === k) || null : null; };
  const SEP = /^[\s_\-@(\[]/;

  // Give each shelf image to the characters whose name (or 立ち絵 column) it starts with; the
  // longest name wins, so アリス_幼少_笑顔 goes to アリス_幼少 rather than アリス.
  function matchImages() {
    auto = new Map();
    const bases = [];
    for (const c of chars) {
      auto.set(c, { byImageName: null, byName: null, faces: [] });
      if (norm(c.imageName)) bases.push({ k: norm(c.imageName).toLowerCase(), c, from: "byImageName" });
      if (norm(c.name)) bases.push({ k: norm(c.name).toLowerCase(), c, from: "byName" });
    }
    for (const im of state.images) {
      const n = norm(im.name), low = n.toLowerCase();
      let best = 0, hits = [];
      for (const b of bases) {
        if (low !== b.k && !(low.startsWith(b.k) && SEP.test(low.slice(b.k.length)))) continue;
        if (b.k.length > best) { best = b.k.length; hits = [b]; } else if (b.k.length === best) hits.push(b);
      }
      for (const b of hits) {
        const a = auto.get(b.c);
        const label = n.slice(b.k.length).replace(/^[\s_\-@(\[]+/, "").replace(/[)\]]\s*$/, "").trim();
        if (low === b.k) { if (!a[b.from]) a[b.from] = im; }
        else if (label && !a.faces.some(f => f.img === im)) a.faces.push({ label, img: im });
      }
    }
  }

  function portraitOf(c) {
    if (c.image === "none") return null;
    if (c.image !== "auto") return imageById(c.image);
    const a = auto.get(c);
    return a ? a.byImageName || a.byName : null;
  }

  // -> [{ label, img, auto, face }]: the faces set by hand or in the table, then those found by name.
  function facesOf(c) {
    const list = c.faces.map(f => ({ label: f.label, img: imageById(f.imageId) || byName(f.imageName), auto: false, face: f }));
    const a = auto.get(c);
    if (c.autoFaces && a) {
      const used = new Set(list.map(f => P.key(f.label)));
      for (const f of a.faces) if (!used.has(P.key(f.label))) { used.add(P.key(f.label)); list.push({ label: f.label, img: f.img, auto: true, face: null }); }
    }
    return list;
  }

  const sizeOf = c => c.size == null ? state.opts.size : c.size;
  const activeOf = c => c.active == null ? state.opts.active : c.active;
  const secretOf = c => c.secret == null ? state.opts.secret : c.secret;
  const hideOf = c => c.hideStatus == null ? state.opts.hideStatus : c.hideStatus;
  const commandsOf = c => [c.commands, state.opts.commonCommands].filter(s => s.trim()).join("\n");

  // Everything that points at an image by id, so deleting it can say what changes.
  function usesOf(id) {
    const names = [];
    for (const c of state.edited || []) {
      if (c.image === id) names.push(c.name || t("名前なし"));
      for (const f of c.faces) if (f.imageId === id) names.push(t("{name}（{face}）", { name: c.name || t("名前なし"), face: f.label || t("差分") }));
    }
    return names;
  }

  function removeImage(im) {
    const names = usesOf(im.id);
    const msg = names.length
      ? t("「{name}」は次の所で選んでいます。\n{uses}\n\n削除すると、これらは「画像なし」になります。削除しますか？", { name: im.name, uses: names.join(t("、")) })
      : t("「{name}」を置き場から削除しますか？", { name: im.name });
    if (!confirm(msg)) return;
    for (const c of state.edited || []) {
      if (c.image === im.id) c.image = "none";
      for (const f of c.faces) if (f.imageId === im.id) f.imageId = null;
    }
    state.images = state.images.filter(x => x !== im);
    dropBlob(im.id);
    update();
    saveNow();
    status(names.length ? t("削除しました。選んでいた所は「画像なし」になりました。") : t("削除しました。"));
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function button(label, extra) {
    const b = el("button", "small" + (extra && extra.danger ? " danger" : ""), label);
    b.type = "button";
    if (extra && extra.disabled) b.disabled = true;
    if (extra && extra.aria) b.setAttribute("aria-label", extra.aria);
    return b;
  }

  function thumb(img, alt) {
    const box = el("div", "thumb");
    const src = imageSrc(img);
    if (src) { const i = el("img"); i.src = src; i.alt = alt; box.append(i); }
    else box.textContent = t("画像なし");
    return box;
  }

  // Choose one file and put it on the shelf; assign gets its id.
  function pickFile(assign) {
    pendingPick = assign;
    $("#imageFile").click();
  }

  const hasFiles = ev => !!(ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes("Files"));

  // Dropping image files on target puts them on the shelf, then hands the ids to take.
  function dropTarget(target, take) {
    target.addEventListener("dragover", ev => { if (!hasFiles(ev)) return; ev.preventDefault(); target.classList.add("over"); });
    target.addEventListener("dragleave", () => target.classList.remove("over"));
    target.addEventListener("drop", ev => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      target.classList.remove("over");
      addFiles(ev.dataTransfer.files).then(ids => take(ids));
    });
  }

  // ---------------------------------------------------------------- image shelf

  function renderGallery() {
    const box = $("#gallery");
    box.textContent = "";
    $("#imageCount").textContent = state.images.length;
    if (!state.images.length) { box.append(el("p", "desc", t("まだ画像がありません。"))); return; }
    const owner = new Map(); // image -> what it is used as, by name
    for (const c of chars) {
      const p = portraitOf(c);
      const who = c.imageName || c.name || t("名前なし"); // copies (黒い影A, B…) share the images of 黒い影
      if (p && !owner.has(p)) owner.set(p, t("{name}の立ち絵", { name: who }));
      for (const f of facesOf(c)) if (f.img && !owner.has(f.img)) owner.set(f.img, t("{name}の差分「{face}」", { name: who, face: f.label }));
    }
    for (const im of state.images) {
      const cell = el("div", "imgcell");
      const src = imageSrc(im);
      if (src) { const img = el("img"); img.src = src; img.alt = ""; img.loading = "lazy"; cell.append(img); }
      else cell.append(el("div", "noimg", t("中身なし")));
      const name = el("input");
      name.type = "text";
      name.value = im.name;
      name.setAttribute("aria-label", t("画像の名前"));
      name.addEventListener("input", () => { im.name = name.value; update({ keepGallery: true }); });
      name.addEventListener("change", () => update());
      const warn = tooBig(im) || missing(im);
      const info = el("span", "info" + (warn ? " warn" : ""), missing(im) ? t("中身が見つかりません") : sizeText(im.size) + (tooBig(im) ? t("（5 MB 超）") : ""));
      const use = el("span", "info use", owner.get(im) || t("まだ使っていません"));
      use.title = use.textContent;
      if (!owner.has(im)) use.classList.add("unused");
      const del = button(t("削除"), { danger: true, aria: t("画像「{name}」を削除", { name: im.name }) });
      del.addEventListener("click", () => removeImage(im));
      cell.append(name, use, info, del);
      box.append(cell);
    }
  }

  // ---------------------------------------------------------------- columns and warnings

  function renderColumns() {
    const box = $("#columns");
    box.textContent = "";
    $("#columnsRow").hidden = !parsed.columns.length;
    for (const col of parsed.columns) {
      if (!col.header) continue;
      const item = el("label", "col" + (col.kind === "ignore" ? " off" : ""));
      item.append(el("span", "", col.header));
      const sel = el("select");
      for (const k of P.KINDS) sel.append(new Option(t(k.label), k.id));
      sel.value = col.kind;
      sel.setAttribute("aria-label", t("列「{name}」の使い方", { name: col.header }));
      sel.addEventListener("change", () => {
        if (sel.value === col.auto) delete state.columns[col.header]; else state.columns[col.header] = sel.value;
        update();
      });
      item.append(sel);
      box.append(item);
    }
  }

  // What each label of the memo was read as. Unknown labels (警戒値, IDA) and changed ones first.
  function renderLabels() {
    const list = state.mode === "memo" && !state.edited ? (parsed.labels || []).filter(l => l.auto !== "initiative") : [];
    $("#labelsRow").hidden = !list.length;
    $("#labelsCount").textContent = list.length;
    const box = $("#labels");
    box.textContent = "";
    const rank = l => (l.kind !== l.auto ? 0 : l.known ? 2 : 1);
    for (const l of list.slice().sort((a, b) => rank(a) - rank(b))) {
      const item = el("label", "col" + (l.kind === "ignore" ? " off" : "") + (l.known ? "" : " unknown"));
      const name = el("span", "", P.key(l.written) === P.key(l.label) ? l.label : t("{written}（{label}）", { written: l.written, label: l.label }));
      if (!l.known) name.title = t("よく使う技能・能力値の一覧にない名前です。合っているか確かめてください");
      item.append(name);
      const sel = el("select");
      for (const [id, text] of LABEL_KINDS) sel.append(new Option(text, id));
      sel.value = l.kind;
      sel.setAttribute("aria-label", t("「{name}」の使い方", { name: l.label }));
      sel.addEventListener("change", () => {
        if (sel.value === l.auto) delete state.labels[l.key]; else state.labels[l.key] = sel.value;
        update();
      });
      item.append(sel);
      box.append(item);
    }
  }

  function renderWarnings() {
    const box = $("#warnings");
    const list = state.edited ? [] : parsed.warnings.slice(0, 8);
    if (!state.edited && parsed.warnings.length > 8) list.push(t("ほかに {n} 件あります。", { n: parsed.warnings.length - 8 }));
    const lost = [];
    for (const c of chars) {
      // copies (黒い影A, B…) look for 黒い影 by themselves; only a name the user wrote is reported
      const copy = c.name.startsWith(c.imageName) && /^ ?[A-Z0-9]+$/.test(c.name.slice(c.imageName.length));
      if (c.image === "auto" && c.imageName && !copy && !byName(c.imageName)) lost.push(t("{name}の立ち絵「{image}」", { name: c.name || t("名前なし"), image: c.imageName }));
      for (const f of c.faces) if (!f.imageId && f.imageName && !byName(f.imageName)) lost.push(t("{name}の差分「{face}」の「{image}」", { name: c.name || t("名前なし"), face: f.label, image: f.imageName }));
    }
    if (lost.length) list.push(t("置き場に同じ名前の画像がありません: {list}", { list: lost.slice(0, 6).join(t("、")) + (lost.length > 6 ? t(" ほか {n} 件", { n: lost.length - 6 }) : "") }));
    const names = new Map();
    for (const c of chars) if (c.name) names.set(c.name, (names.get(c.name) || 0) + 1);
    const dup = [...names].filter(([, n]) => n > 1).map(([name]) => name);
    if (dup.length) list.push(t("同じ名前の駒があります（そのまま作れますが、ココフォリアで見分けにくくなります）: {list}", { list: dup.slice(0, 6).join(t("、")) }));
    box.hidden = !list.length;
    box.textContent = "";
    for (const w of list) box.append(el("div", "", w));
  }

  // ---------------------------------------------------------------- list and preview

  function renderList() {
    const body = $("#chars");
    body.textContent = "";
    if (!chars.length) {
      const tr = el("tr");
      const td = el("td", "empty-list", "");
      td.colSpan = 5;
      td.textContent = state.mode === "table" ? t("上に表を貼ると、ここに 1 体ずつ並びます") : t("上に NPC を書くと、ここに 1 体ずつ並びます");
      tr.append(td);
      body.append(tr);
    }
    chars.forEach((c, i) => {
      const tr = el("tr");
      tr.setAttribute("aria-selected", String(i === selected));
      tr.tabIndex = 0;
      const num = el("td", "num", c.line || "+");
      const pic = el("td", "pic");
      const src = imageSrc(portraitOf(c));
      if (src) { const img = el("img"); img.src = src; img.alt = ""; pic.append(img); }
      const title = el("td", "title", c.name || t("（名前なし）"));
      const badge = (cls, text) => title.append(el("span", "badge " + cls, text));
      if (!c.name) badge("unknown-b", t("名前なし"));
      const faces = facesOf(c).filter(f => f.img).length;
      if (faces) badge("face", t("差分 {n}", { n: faces }));
      if (activeOf(c)) badge("narr", t("盤面"));
      const stat = el("td", "stat", c.status.map(s => `${s.label} ${s.value}${s.max ? "/" + s.max : ""}`).join("　"));
      const lines = commandsOf(c).split("\n").filter(s => s.trim()).length;
      const pal = el("td", "num", lines ? t("{n} 行", { n: lines }) : "—");
      tr.append(num, pic, title, stat, pal);
      const pick = () => { selected = i; renderList(); renderPreview(); renderEditor(); };
      tr.addEventListener("click", pick);
      tr.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); pick(); } });
      body.append(tr);
    });
    $("#count").textContent = chars.length;
    const withImage = chars.filter(c => portraitOf(c)).length;
    const confirmed = state.edited ? 0 : state.kept.length;
    $("#summary").innerHTML = !chars.length ? ""
      : (confirmed ? t("確定 <b>{kept}</b> 体＋入力中 <b>{live}</b> 体 ／ ", { kept: confirmed, live: chars.length - confirmed }) : "")
        + t("立ち絵あり <b>{with}</b> 体・なし <b>{without}</b> 体", { with: withImage, without: chars.length - withImage });
    $("#editedNote").hidden = !state.edited;
    // While the list is frozen by a hand edit, typing in the box would change nothing on the list.
    for (const box of [$("#memo"), $("#table")]) box.readOnly = !!state.edited;
    $("#inputLocked").hidden = !state.edited;
    $("#confirmChars").disabled = !(state.edited || parsed.chars.length || state.pasted.length);
    const board = chars.filter(activeOf).length;
    $("#exportSummary").innerHTML = chars.length
      ? t("駒 <b>{n}</b> 体を ZIP に書き出します（盤面に出す <b>{board}</b> 体・一覧だけ <b>{list}</b> 体）。", { n: chars.length, board, list: chars.length - board })
      : t("書き出す駒がまだありません。");
    $("#exportZip").disabled = chars.length === 0;
    $("#exportAssets").disabled = state.images.length === 0;
    $("#pasteInfo").textContent = state.pasted.length ? t("取り込んだ駒 {n} 体", { n: state.pasted.length }) : "";
    // While the list is frozen, pasted characters are removed one by one in the editor.
    $("#pasteClear").hidden = !state.pasted.length || !!state.edited;
  }

  // An approximation of CCFOLIA's board: the status list at the top left and the piece on the grid.
  // The selected character's lines in the memo and what was read from each.
  function renderSource() {
    const c = state.mode === "memo" && !state.edited ? parsed.chars[selected - state.kept.length] : null;
    $("#sourceRow").hidden = !c;
    const box = $("#sourceRows");
    box.textContent = "";
    if (!c) return;
    for (const src of c.source) {
      const row = el("div", "src " + src.state);
      row.append(el("span", "ln", String(src.line)), el("span", "tx", src.text));
      const read = el("span", "rd");
      for (const r of src.read) read.append(el("span", r.startsWith("⚠") ? "chip miss" : "chip", r.replace(/^⚠/, t("読めず: "))));
      if (!src.read.length) read.append(el("span", "chip none", SOURCE_STATE[src.state] || t("使わない")));
      row.append(read);
      box.append(row);
    }
  }

  function renderPreview() {
    renderSource();
    const c = chars[selected];
    $("#mock").hidden = !c;
    $("#mockEmpty").hidden = !!c;
    if (!c) return;
    const src = imageSrc(portraitOf(c));
    const icon = $("#mockIcon");
    icon.textContent = "";
    if (src) { const i = el("img"); i.src = src; i.alt = ""; icon.append(i); }
    $("#mockInit").textContent = c.initiative;
    const bars = $("#mockBars");
    bars.textContent = "";
    for (const s of c.status) {
      const bar = el("div", "ccf-bar");
      const fill = el("div", "ccf-fill");
      fill.style.width = `${100 * Math.max(Math.min(s.max ? s.value / s.max : 0, 1), 0)}%`;
      const text = el("div", "ccf-text");
      text.append(el("span", "", s.label), el("span", "", s.max ? `${s.value}/${s.max}` : String(s.value)));
      bar.append(el("div", "ccf-back"), fill, text);
      bars.append(bar);
    }
    $("#mockItem").classList.toggle("off", hideOf(c) || !activeOf(c));
    const notes = [];
    if (!activeOf(c)) notes.push(t("盤面には出しません（キャラクター一覧から出せます）"));
    else if (hideOf(c)) notes.push(t("盤面の一覧には出しません"));
    if (secretOf(c)) notes.push(t("ステータスはほかの人に見えません"));
    if (c.invisible) notes.push(t("発言しても立ち絵は出ません"));
    $("#mockNote").textContent = notes.join(t("・"));
    const piece = $("#mockPiece");
    const px = Math.min(sizeOf(c), 12) * 24 * 0.75;
    piece.style.width = piece.style.height = px + "px";
    piece.textContent = "";
    if (src) { const i = el("img"); i.src = src; i.alt = t("{name}の駒", { name: c.name }); piece.append(i); }
    else piece.append(el("span", "", t("画像なし")));
    piece.classList.toggle("off", !activeOf(c));
    $("#mockSize").textContent = t("駒サイズ {n}", { n: sizeOf(c) });
    const strip = $("#mockFaces");
    strip.textContent = "";
    for (const f of facesOf(c)) {
      const cell = el("div", "facecell" + (f.img ? "" : " none"));
      const s = imageSrc(f.img);
      if (s) { const i = el("img"); i.src = s; i.alt = ""; cell.append(i); }
      else cell.append(el("div", "noimg", t("画像なし")));
      cell.append(el("span", "", f.label || t("（名前なし）")));
      strip.append(cell);
    }
    $("#mockFacesRow").hidden = !strip.children.length;
    const pal = commandsOf(c);
    $("#mockPalette").textContent = pal;
    $("#mockPaletteRow").hidden = !pal;
    $("#mockParams").textContent = c.params.filter(p => p.label).map(p => `${p.label} ${p.value}`).join("　");
    $("#mockParamsRow").hidden = !c.params.some(p => p.label);
  }

  // ---------------------------------------------------------------- hand edits

  // Freeze the list the first time something is edited by hand.
  function ensureEdited() {
    if (!state.edited) state.edited = chars.map(cleanChar);
    chars = state.edited;
  }

  // typing: keep the editor as it is, so the caret stays where the user is typing.
  function editChar(fn, typing) {
    ensureEdited();
    fn(state.edited[selected], state.edited);
    update({ keepEditor: !!typing, typing: !!typing });
  }

  function field(labelText, input) {
    const l = el("label", "", labelText);
    l.append(input);
    return l;
  }

  function textInput(value, onInput, opts) {
    const i = el(opts && opts.area ? "textarea" : "input");
    if (!(opts && opts.area)) i.type = opts && opts.type || "text";
    i.value = value;
    if (opts && opts.placeholder) i.placeholder = opts.placeholder;
    if (opts && opts.aria) i.setAttribute("aria-label", opts.aria);
    if (opts && opts.step) i.step = opts.step;
    // Number fields change on commit, so a half-typed "1" of "12" does not move things around.
    i.addEventListener(opts && opts.type === "number" ? "change" : "input", () => onInput(i.value));
    return i;
  }

  function imageSelect(current, firsts, assign, label) {
    const row = el("div", "img-row");
    const sel = el("select");
    sel.setAttribute("aria-label", label);
    for (const [text, value] of firsts) sel.append(new Option(text, value));
    for (const im of state.images) sel.append(new Option(im.name || t("（名前なし）"), im.id));
    sel.value = firsts.some(f => f[1] === current) || imageById(current) ? current : firsts[firsts.length - 1][1];
    sel.addEventListener("change", () => assign(sel.value));
    const add = button(t("＋ 画像"), { aria: t("{name}にファイルから画像を追加", { name: label }) });
    add.addEventListener("click", () => { const at = selected; pickFile(ids => { if (ids[0] && chars[at]) { selected = at; assign(ids[0]); } }); });
    row.append(sel, add);
    return row;
  }

  function renderEditor() {
    const box = $("#editor");
    const c = chars[selected];
    box.hidden = !c;
    const body = $("#editorBody");
    body.textContent = "";
    if (!c) return;
    const num = v => { const n = P.number(v); return n == null ? 0 : n; };
    // Renaming a character here keeps the images it got through its old name.
    const found = auto.get(c);
    const imagesUnder = found && (found.byName || found.faces.length) ? c.name : "";

    const grid = el("div", "grid");
    grid.append(
      field(t("名前"), textInput(c.name, v => editChar(x => { if (!x.imageName) x.imageName = imagesUnder; x.name = v; }, true))),
      field(t("イニシアチブ"), textInput(c.initiative, v => editChar(x => { x.initiative = num(v); }), { type: "number", step: "any" })),
      field(t("駒サイズ（空なら全体の設定）"), textInput(c.size == null ? "" : c.size, v => editChar(x => { x.size = v.trim() === "" ? null : clampSize(num(v)); }), { type: "number", placeholder: String(state.opts.size) })),
    );
    const boardSel = el("select");
    for (const [text, value] of [[t("全体の設定（{value}）", { value: state.opts.active ? t("盤面に出す") : t("一覧だけ") }), ""], [t("盤面に出す"), "1"], [t("一覧だけ（盤面に出さない）"), "0"]]) boardSel.append(new Option(text, value));
    boardSel.value = c.active == null ? "" : c.active ? "1" : "0";
    boardSel.addEventListener("change", () => editChar(x => { x.active = boardSel.value === "" ? null : boardSel.value === "1"; }));
    const color = textInput(c.color, v => editChar(x => { x.color = v; }, true), { type: "color" });
    grid.append(field(t("盤面"), boardSel), field(t("発言の色"), color),
      field(t("参照 URL"), textInput(c.externalUrl, v => editChar(x => { x.externalUrl = v; }, true), { placeholder: t("キャラクターシートなど") })));
    body.append(grid);

    const pic = el("div", "ed-block");
    pic.append(el("h4", "", t("立ち絵")));
    const p = portraitOf(c);
    const picRow = el("div", "pic-row");
    picRow.append(thumb(p, t("{name}の立ち絵", { name: c.name })));
    const picSide = el("div", "side");
    picSide.append(imageSelect(c.image, [[t("自動（駒と同じ名前の画像）"), "auto"], [t("画像なし"), "none"]], v => editChar(x => { x.image = v; }), t("立ち絵")));
    if (c.image === "auto") picSide.append(el("div", "img-note", p ? t("置き場の「{name}」を使っています", { name: p.name }) : t("置き場に「{name}」という名前の画像を入れると、立ち絵になります", { name: c.imageName || c.name || t("駒の名前") })));
    if (tooBig(p)) picSide.append(el("div", "img-note warn", t("「{name}」は {size}。5 MB を超えると、ココフォリアで読み込めないことがあります", { name: p.name, size: sizeText(p.size) })));
    if (missing(p)) picSide.append(el("div", "img-note warn", t("「{name}」の中身が見つかりません。置き場で入れ直してください", { name: p.name })));
    picRow.append(picSide);
    pic.append(picRow);
    body.append(pic);

    // Faces
    const fc = el("div", "ed-block");
    fc.append(el("h4", "", t("差分（表情）")));
    const autoCheck = el("label", "check");
    const autoBox = el("input");
    autoBox.type = "checkbox";
    autoBox.checked = c.autoFaces;
    autoBox.addEventListener("change", () => editChar(x => { x.autoFaces = autoBox.checked; }));
    autoCheck.append(autoBox, " " + t("置き場の「{name}_笑顔」のような名前の画像を、差分にする", { name: c.name || t("駒の名前") }));
    fc.append(autoCheck);
    for (const f of facesOf(c)) {
      const row = el("div", "face-row");
      row.append(thumb(f.img, t("差分「{face}」", { face: f.label })));
      if (f.auto) {
        row.append(el("div", "auto-face", t("{face}（置き場の「{image}」から自動）", { face: f.label, image: f.img.name })));
      } else {
        const fi = c.faces.indexOf(f.face);
        const inner = el("div", "side");
        const lab = textInput(f.face.label, v => editChar(x => { x.faces[fi].label = v; }, true), { placeholder: t("差分の名前（例: 笑顔）"), aria: t("差分の名前") });
        const cur = f.face.imageId || (f.img ? f.img.id : "");
        const sel = imageSelect(cur, [[t("画像なし"), ""]], v => editChar(x => { x.faces[fi].imageId = v || null; x.faces[fi].imageName = ""; }), t("差分「{face}」の画像", { face: f.label }));
        const rm = button(t("削除"), { danger: true, aria: t("差分「{face}」を削除", { face: f.label }) });
        rm.addEventListener("click", () => editChar(x => { x.faces.splice(fi, 1); }));
        sel.append(rm);
        inner.append(lab, sel);
        if (!f.img) inner.append(el("div", "img-note warn", t("画像の無い差分は書き出されません")));
        row.append(inner);
      }
      fc.append(row);
    }
    const addFace = button(t("＋ 差分を追加"));
    addFace.addEventListener("click", () => editChar(x => { x.faces.push({ label: "", imageId: null, imageName: "" }); }));
    fc.append(addFace);
    body.append(fc);

    // Status and params
    // The handlers reach the rows through the frozen copy (x), which the first edit creates.
    const rows = (title, key, cols, make, addLabel) => {
      const block = el("div", "ed-block");
      block.append(el("h4", "", title));
      c[key].forEach((item, i) => {
        const row = el("div", "kv " + cols);
        row.append(...make(item, i));
        const up = button("↑", { disabled: i === 0, aria: t("{title}の {n} 行目を上へ", { title, n: i + 1 }) });
        up.addEventListener("click", () => editChar(x => { [x[key][i - 1], x[key][i]] = [x[key][i], x[key][i - 1]]; }));
        const rm = button(t("削除"), { danger: true, aria: t("{title}の {n} 行目を削除", { title, n: i + 1 }) });
        rm.addEventListener("click", () => editChar(x => { x[key].splice(i, 1); }));
        row.append(up, rm);
        block.append(row);
      });
      const add = button(addLabel);
      block.append(add);
      return { block, add };
    };
    const st = rows(t("ステータス"), "status", "three", (s, i) => [
      textInput(s.label, v => editChar(x => { x.status[i].label = v; }, true), { placeholder: t("ラベル（HP）"), aria: t("ステータスのラベル") }),
      textInput(s.value, v => editChar(x => { x.status[i].value = num(v); }), { type: "number", step: "any", aria: t("{label}の値", { label: s.label }) }),
      textInput(s.max, v => editChar(x => { x.status[i].max = num(v); }), { type: "number", step: "any", aria: t("{label}の最大値", { label: s.label }) }),
    ], t("＋ ステータスを追加"));
    st.add.addEventListener("click", () => editChar(x => { x.status.push({ label: "", value: 0, max: 0 }); }));
    const pr = rows(t("パラメータ"), "params", "two", (q, i) => [
      textInput(q.label, v => editChar(x => { x.params[i].label = v; }, true), { placeholder: t("ラベル（DEX）"), aria: t("パラメータのラベル") }),
      textInput(q.value, v => editChar(x => { x.params[i].value = v; }, true), { placeholder: t("値"), aria: t("{label}の値", { label: q.label }) }),
    ], t("＋ パラメータを追加"));
    pr.add.addEventListener("click", () => editChar(x => { x.params.push({ label: "", value: "" }); }));
    const two = el("div", "two-col");
    two.append(st.block, pr.block);
    body.append(two);

    const texts = el("div", "two-col");
    texts.append(
      field(t("チャットパレット（1 行に 1 つ）"), textInput(c.commands, v => editChar(x => { x.commands = v; }, true), { area: true })),
      field(t("キャラクターメモ"), textInput(c.memo, v => editChar(x => { x.memo = v; }, true), { area: true })),
    );
    body.append(texts);

    const flags = el("div", "flags");
    for (const [k, text] of [["secret", t("ステータスを非公開にする")], ["invisible", t("発言時に立ち絵を表示しない")], ["hideStatus", t("盤面のキャラクター一覧に表示しない")]]) {
      const l = el("label", "check");
      const b = el("input");
      b.type = "checkbox";
      b.checked = k === "secret" ? secretOf(c) : k === "hideStatus" ? hideOf(c) : c[k];
      b.addEventListener("change", () => editChar(x => { x[k] = b.checked; }));
      l.append(b, " " + text);
      flags.append(l);
    }
    body.append(flags);

    $("#edUp").disabled = selected <= 0;
    $("#edDown").disabled = selected >= chars.length - 1;
  }

  function wireEditor() {
    dropTarget($("#editor"), ids => { if (ids[0] && chars[selected]) editChar(x => { x.image = ids[0]; }); });
    const move = d => editChar((x, list) => {
      const j = selected + d;
      if (j < 0 || j >= list.length) return;
      [list[selected], list[j]] = [list[j], list[selected]];
      selected = j;
    });
    $("#edUp").addEventListener("click", () => move(-1));
    $("#edDown").addEventListener("click", () => move(1));
    $("#edCopy").addEventListener("click", () => editChar((x, list) => {
      list.splice(selected + 1, 0, cleanChar(Object.assign(JSON.parse(JSON.stringify(x)), { line: "" })));
      selected += 1;
    }));
    $("#edDelete").addEventListener("click", () => editChar((x, list) => {
      list.splice(selected, 1);
      if (selected >= list.length) selected = list.length - 1;
    }));
    $("#addChar").addEventListener("click", () => {
      ensureEdited();
      state.edited.push(cleanChar({ name: t("新しい駒"), status: [{ label: "HP", value: 0, max: 0 }] }));
      selected = state.edited.length - 1;
      update();
      $("#editor").scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    $("#rebuild").addEventListener("click", () => {
      if (!confirm(state.kept.length
        ? t("最後に確定したあとの手直しを捨てて、入力から一覧を作り直しますか？（確定した駒はそのままです）")
        : t("手直しした内容を捨てて、入力から一覧を作り直しますか？"))) return;
      state.edited = null;
      selected = -1;
      update();
      status(t("入力から作り直しました。"));
    });
  }

  // 確定: what the list shows now (hand edits too) is kept, and the input box is emptied for the
  // next NPC. Undo brings the text back.
  function confirmCurrent() {
    if (!chars.length) return;
    const before = state.kept.length;
    state.kept = chars.map(c => cleanChar(Object.assign({}, c, { line: "✓" })));
    state.edited = null;
    state.pasted = [];
    if (state.mode === "table") state.table = ""; else state.memo = "";
    syncInputs();
    update();
    const added = state.kept.length - before;
    status(added > 0 ? t("確定しました（{n} 体を足して、確定 {total} 体）。入力欄を空にしたので、次の NPC を入れられます。", { n: added, total: state.kept.length })
      : t("確定しました（確定 {total} 体）。入力欄を空にしたので、次の NPC を入れられます。", { total: state.kept.length }));
    const box = $(state.mode === "table" ? "#table" : "#memo");
    box.scrollIntoView({ block: "center", behavior: "smooth" });
    box.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- update loop

  function syncInputs() {
    $("#table").value = state.table;
    $("#memo").value = state.memo;
    for (const r of document.querySelectorAll('input[name="mode"]')) r.checked = r.value === state.mode;
    for (const e of document.querySelectorAll("[data-mode]")) e.hidden = e.dataset.mode !== state.mode;
    $("#optRoll").value = state.opts.roll;
    $("#optSuffix").value = state.opts.suffix;
    $("#optSecretRoll").checked = state.opts.secretRoll;
    $("#optProse").checked = state.opts.proseToMemo;
    $("#optSecret").checked = state.opts.secret;
    $("#optHide").checked = state.opts.hideStatus;
    $("#optActive").value = state.opts.active ? "1" : "0";
    $("#optSize").value = state.opts.size;
    $("#optCommon").value = state.opts.commonCommands;
  }

  function update(o) {
    parsed = state.mode === "table" ? P.parse(state.table, state.columns) : P.parseMemo(state.memo, Object.assign({}, state.opts, { labels: state.labels }));
    chars = state.edited || state.kept.concat(parsed.chars, state.pasted).map(cleanChar);
    if (selected >= chars.length) selected = chars.length - 1;
    matchImages();
    if (!(o && o.keepGallery)) renderGallery();
    renderColumns();
    renderLabels();
    renderWarnings();
    renderList();
    renderPreview();
    if (!(o && o.keepEditor)) renderEditor();
    scheduleSave();
    if (o && o.noCommit) return;
    if (o && (o.typing || o.keepGallery)) scheduleCommit(); else commit();
  }

  // ---------------------------------------------------------------- export

  function exportStatus(message, isError) {
    const box = $("#exportStatus");
    box.textContent = message;
    box.classList.toggle("error", !!isError);
  }

  const safeName = s => String(s || "").replace(/[\\/:*?"<>|]/g, "_");
  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  function stamp() {
    const d = new Date(), p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  async function exportZip() {
    if (!chars.length) return;
    if (!window.JSZip) { exportStatus(t("ZIP を作る部品を読み込めませんでした。ネットにつながった状態で開き直してください。"), true); return; }
    if (!(window.crypto && crypto.subtle)) { exportStatus(t("このブラウザでは ZIP を作れません（https のページか、新しい Chrome・Edge で開いてください）。"), true); return; }
    if (chars.length > R.MAX) { exportStatus(t("1 つの ZIP に入れられる駒は {max} 体までです（今は {n} 体）。表を分けて書き出してください。", { max: R.MAX, n: chars.length }), true); return; }
    const btn = $("#exportZip");
    btn.disabled = true;
    exportStatus(t("ZIP を作っています…"));
    try {
      const bytes = new Map(); // image id -> Uint8Array, read once however many characters use it
      const big = new Set();
      const exportImage = async im => {
        if (!im) return null;
        const blob = blobs.get(im.id);
        if (!blob) throw new Error(t("画像「{name}」の中身が見つかりません。置き場で入れ直すか、使っている所の画像を変えてください。", { name: im.name }));
        if (!bytes.has(im.id)) bytes.set(im.id, new Uint8Array(await blob.arrayBuffer()));
        if (tooBig(im)) big.add(im.id);
        return { type: im.type || blob.type, bytes: bytes.get(im.id), key: im.id };
      };
      const list = [];
      let noName = 0, faceCount = 0;
      for (const c of chars) {
        if (!c.name.trim()) noName++;
        const faces = [];
        for (const f of facesOf(c)) if (f.img) faces.push({ label: f.label, image: await exportImage(f.img) });
        faceCount += faces.length;
        list.push({
          name: c.name, memo: c.memo, initiative: c.initiative, externalUrl: c.externalUrl, status: c.status,
          params: c.params.filter(p => p.label || p.value), commands: commandsOf(c), color: c.color, size: sizeOf(c), active: activeOf(c),
          secret: secretOf(c), invisible: c.invisible, hideStatus: hideOf(c), image: await exportImage(portraitOf(c)), faces,
        });
      }
      const { zip, files } = await R.build({ characters: list }, {
        JSZip: window.JSZip, subtle: crypto.subtle, random: n => crypto.getRandomValues(new Uint8Array(n)),
      });
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      download(blob, safeName(`characters-${stamp()}.zip`));
      const notes = [];
      if (big.size) notes.push(t("5 MB を超える画像が {n} 枚あり、ココフォリアで読み込めないことがあります。", { n: big.size }));
      if (noName) notes.push(t("名前の無い駒が {n} 体あります。", { n: noName }));
      exportStatus(t("書き出しました（駒 {n} 体・差分 {faces} 個・画像 {images} 枚）。ココフォリアのルーム設定からインポートしてください。", { n: list.length, faces: faceCount, images: files.length }) + notes.join(""), notes.length > 0);
    } catch (err) {
      console.error(err);
      exportStatus(t("ZIP を作れませんでした: ") + err.message, true);
    } finally {
      btn.disabled = chars.length === 0;
    }
  }

  // The shelf as files with readable names. A zip import does not put images in CCFOLIA's own
  // image list; dropping these on its image picker does.
  async function exportAssets() {
    if (!window.JSZip) { exportStatus(t("ZIP を作る部品を読み込めませんでした。ネットにつながった状態で開き直してください。"), true); return; }
    const zip = new window.JSZip();
    const used = new Set(), names = new Set();
    const ext = im => im.type === "image/jpeg" ? "jpg" : R.EXT[im.type] || "png";
    const put = (dir, base, im) => {
      const blob = blobs.get(im.id);
      if (!blob || used.has(im.id)) return;
      used.add(im.id);
      const stem = `${dir}/${safeName(base).trim() || t("画像")}`;
      let name = `${stem}.${ext(im)}`;
      for (let i = 2; names.has(name.toLowerCase()); i++) name = `${stem}_${i}.${ext(im)}`;
      names.add(name.toLowerCase());
      zip.file(name, blob);
    };
    for (const c of chars) {
      const base = c.imageName || c.name || t("名前なし");
      const p = portraitOf(c);
      if (p) put(t("立ち絵"), base, p);
      for (const f of facesOf(c)) if (f.img) put(t("差分"), `${base}_${f.label || t("差分")}`, f.img);
    }
    for (const im of state.images) put(t("そのほか"), im.name, im);
    if (!used.size) { exportStatus(t("書き出せる画像がありません。"), true); return; }
    const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
    download(blob, `characters-assets-${stamp()}.zip`);
    exportStatus(t("素材を書き出しました（画像 {n} 枚。{folders} のフォルダに、駒の名前で入っています）。展開して、ココフォリアの画像を選ぶ画面にドロップすると、自分の画像の一覧に入ります。", { n: used.size, folders: [t("立ち絵"), t("差分"), t("そのほか")].join(" / ") }));
  }

  // ---------------------------------------------------------------- pasted pieces

  function pasteStatus(message, isError) {
    const box = $("#pasteStatus");
    box.textContent = message;
    box.classList.toggle("error", !!isError);
  }

  function addPasted() {
    const box = $("#pasteJson");
    const list = P.parsePieces(box.value);
    if (!list.length) {
      pasteStatus(box.value.trim() ? t("駒のデータが見つかりませんでした。キャラクター作成サイトの「ココフォリア出力（コマ出力）」でコピーしたものを、そのまま貼ってください。") : t("コピーしたものを上の欄に貼ってください。"), true);
      return;
    }
    const add = list.map(cleanChar);
    state.pasted.push(...add);
    if (state.edited) state.edited.push(...add.map(cleanChar));
    box.value = "";
    update();
    selected = chars.length - 1;
    renderList();
    renderPreview();
    renderEditor();
    const icons = list.filter(c => c.hadIcon).length;
    pasteStatus(t("{n} 体を取り込みました。", { n: list.length }) + (icons ? t("立ち絵は取り込めません（ココフォリアの駒は、外のサイトの画像を受け付けないため）。画像を置き場に入れると、駒と同じ名前なら自動で付きます。") : t("立ち絵は、置き場に駒と同じ名前の画像を入れると付きます。")));
  }

  // ---------------------------------------------------------------- project files

  async function projectData() {
    const images = [];
    for (const im of state.images) {
      const blob = blobs.get(im.id);
      if (blob) images.push(Object.assign({}, im, { dataUrl: await blobToDataUrl(blob) }));
    }
    return { app: APP, version: 1, state: Object.assign({}, state, { images }) };
  }

  // Project files carry the shelf with data URLs. Put those bytes in blobs and leave the rest.
  async function openProject(text) {
    const data = JSON.parse(text);
    if (!data || data.app !== APP) throw Object.assign(new Error(t("このツールのプロジェクトファイルではありません。")), { notOurs: true });
    const s = data.state || {};
    const lifted = [];
    for (const im of Array.isArray(s.images) ? s.images : []) {
      if (!im || !im.id || !im.dataUrl) continue;
      try {
        const { type, bytes } = R.dataUrlBytes(im.dataUrl);
        holdBlob(String(im.id), new Blob([bytes], { type }));
        lifted.push(String(im.id));
      } catch (err) { /* a broken image is left out */ }
    }
    const next = normalize(s);
    next.images = next.images.filter(im => blobs.has(im.id));
    // The shelf keeps the images already there; the project's own come first.
    const ids = new Set(next.images.map(im => im.id));
    next.images = next.images.concat(state.images.filter(im => !ids.has(im.id)));
    state = next;
    for (const id of lifted) {
      const im = imageById(id);
      if (im && !im.hash) im.hash = await hashOf(blobs.get(id));
      if (db) await storeBlob(id, blobs.get(id));
    }
    return lifted.length;
  }

  // ---------------------------------------------------------------- wiring

  async function init() {
    loadSaved();
    const opened = await openDb();
    if (opened === "timeout") saving = false; else db = opened;
    await loadBlobs();
    if (!saving) status(t("このブラウザでは保存領域を開けませんでした。自動保存を止めています。「プロジェクトを保存」でファイルに残してください。"), true);
    else if (!db) status(t("このブラウザでは画像を保存できません。画像を使うときは「プロジェクトを保存」でファイルに残してください。"), true);
    // Examples in the boxes (they have line breaks and tabs, which an attribute cannot carry to i18n.v1.js)
    $("#memo").placeholder = t("黒い影 ×3\nHP 20  DEX 80  装甲 2\nかぎ爪 70 1d6+1d4 / 回避 40\nメモ: 路地裏に出る\n\n（空行で区切って、次の NPC）");
    $("#table").placeholder = t("名前\tHP\tMP\tDEX\tチャットパレット\nアリス\t12/12\t10\t60\tCCB<=60 【回避】\nボブ\t14\t8\t45\tCCB<=50 【こぶし】");
    $("#optCommon").placeholder = t("CCB<={回避} 【回避】\n1d100 【ダイス】");
    syncInputs();

    // The shelf
    const drop = $("#drop");
    drop.addEventListener("click", () => $("#imageFiles").click());
    drop.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); $("#imageFiles").click(); } });
    dropTarget(drop, ids => { if (ids.length) update(); });
    $("#imageFiles").addEventListener("change", ev => {
      const files = Array.from(ev.target.files);
      ev.target.value = "";
      addFiles(files).then(ids => { if (ids.length) update(); });
    });
    $("#imageFile").addEventListener("change", ev => {
      const files = Array.from(ev.target.files), take = pendingPick;
      ev.target.value = "";
      pendingPick = null;
      addFiles(files).then(ids => { if (take) take(ids); if (ids.length) update(); });
    });
    // A file dropped outside a drop area would make the browser leave the page to show it.
    window.addEventListener("dragover", ev => { if (hasFiles(ev)) ev.preventDefault(); });
    window.addEventListener("drop", ev => { if (hasFiles(ev) && !ev.defaultPrevented) { ev.preventDefault(); status(t("画像は「画像の置き場」の枠か、手直しの欄にドロップしてください。"), true); } });

    $("#table").addEventListener("input", ev => { state.table = ev.target.value; update({ typing: true }); });
    // A tab typed in the box moves to the next cell instead of leaving the box.
    $("#table").addEventListener("keydown", ev => {
      if (ev.key !== "Tab" || ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey || ev.isComposing) return;
      ev.preventDefault();
      const t = ev.target;
      t.setRangeText("\t", t.selectionStart, t.selectionEnd, "end");
      state.table = t.value;
      update({ typing: true });
    });
    $("#optActive").addEventListener("change", ev => { state.opts.active = ev.target.value === "1"; update(); });
    $("#optSize").addEventListener("change", ev => {
      const n = P.number(ev.target.value);
      state.opts.size = clampSize(n == null ? 4 : n);
      ev.target.value = state.opts.size;
      update();
    });
    $("#optCommon").addEventListener("input", ev => { state.opts.commonCommands = ev.target.value; update({ typing: true, keepEditor: true }); });
    $("#memo").addEventListener("input", ev => { state.memo = ev.target.value; update({ typing: true }); });
    for (const r of document.querySelectorAll('input[name="mode"]')) {
      r.addEventListener("change", () => {
        if (!r.checked) return;
        if (state.edited && !confirm(t("手直しした内容を捨てて、入力から一覧を作り直します。よろしいですか？"))) { syncInputs(); return; }
        state.mode = r.value;
        state.edited = null;
        selected = -1;
        syncInputs();
        update();
      });
    }
    $("#optRoll").addEventListener("change", ev => { state.opts.roll = ev.target.value; update(); });
    $("#optSuffix").addEventListener("change", ev => { state.opts.suffix = ev.target.value; update(); });
    $("#optSecret").addEventListener("change", ev => { state.opts.secret = ev.target.checked; update(); });
    $("#optHide").addEventListener("change", ev => { state.opts.hideStatus = ev.target.checked; update(); });
    $("#optSecretRoll").addEventListener("change", ev => { state.opts.secretRoll = ev.target.checked; update(); });
    $("#optProse").addEventListener("change", ev => { state.opts.proseToMemo = ev.target.checked; update(); });
    $("#pasteAdd").addEventListener("click", addPasted);
    $("#pasteClear").addEventListener("click", () => {
      if (!confirm(t("取り込んだ駒 {n} 体を一覧から消しますか？", { n: state.pasted.length }))) return;
      state.pasted = [];
      update();
      pasteStatus(t("取り込んだ駒を消しました。"));
    });
    $("#exportAssets").addEventListener("click", exportAssets);
    $("#confirmChars").addEventListener("click", confirmCurrent);
    // The help under the input box can be closed, so the list comes nearer; remembered per browser.
    const HELP_KEY = APP + ".help";
    let helpOpen = true;
    try { helpOpen = localStorage.getItem(HELP_KEY) !== "closed"; } catch (err) { /* keep it open */ }
    for (const d of document.querySelectorAll("details.help")) {
      d.open = helpOpen;
      d.addEventListener("toggle", () => {
        for (const other of document.querySelectorAll("details.help")) if (other.open !== d.open) other.open = d.open;
        try { localStorage.setItem(HELP_KEY, d.open ? "open" : "closed"); } catch (err) { /* not remembered */ }
      });
    }
    $("#fillSample").addEventListener("click", () => {
      const table = state.mode === "table";
      if ((table ? state.table : state.memo).trim() && !confirm(t("今の入力を例で置き換えますか？"))) return;
      if (state.edited && !confirm(t("手直しした内容も捨てて、例から作り直します。よろしいですか？"))) return;
      if (table) { state.table = SAMPLES.table; state.columns = {}; } else state.memo = SAMPLES.memo;
      state.edited = null;
      selected = 0;
      syncInputs();
      update();
    });
    $("#exportZip").addEventListener("click", exportZip);
    wireEditor();

    $("#undo").addEventListener("click", () => travel(-1));
    $("#redo").addEventListener("click", () => travel(1));
    // Leaving a field makes what was typed one step.
    document.addEventListener("change", () => commit());
    document.addEventListener("keydown", ev => {
      if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
      const k = ev.key.toLowerCase();
      if (k !== "z" && k !== "y") return;
      // Text and number fields keep the browser's own undo.
      const t = ev.target;
      if (t && (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && !/^(checkbox|radio|color|button|file)$/.test(t.type)))) return;
      ev.preventDefault();
      travel(k === "y" || ev.shiftKey ? 1 : -1);
    });

    $("#saveProject").addEventListener("click", async () => {
      try {
        download(new Blob([JSON.stringify(await projectData(), null, 1)], { type: "application/json" }), `characters-${stamp()}.characters.json`);
        status(t("プロジェクトを保存しました（置き場の画像も入っています）。"));
      } catch (err) {
        status(t("プロジェクトを保存できませんでした: ") + err.message, true);
      }
    });
    $("#loadProject").addEventListener("click", () => $("#projectFile").click());
    $("#projectFile").addEventListener("change", ev => {
      const file = ev.target.files[0];
      ev.target.value = "";
      if (!file) return;
      file.text().then(openProject).then(n => {
        selected = -1;
        syncInputs();
        update();
        saveNow();
        status(t("プロジェクトを開きました。") + (n ? t("画像 {n} 枚を置き場に入れました。", { n }) : ""));
      }).catch(err => status(err.notOurs ? err.message : t("プロジェクトファイルを読めませんでした。"), true));
    });
    $("#resetAll").addEventListener("click", () => {
      if (!confirm(t("いまの作業内容を消して、最初の状態に戻します。よろしいですか？（画像の置き場は残ります）"))) return;
      state = Object.assign(defaultState(), { images: state.images, labels: state.labels });
      selected = -1;
      syncInputs();
      update();
      status(t("最初の状態に戻しました。"));
    });

    update({ noCommit: true });
    commit();
  }

  init();
})();
