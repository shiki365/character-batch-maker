/*!
 * roomdata.v1.js - characters -> CCFOLIA room data zip (no UI)
 *
 * Format read from CCFOLIA 1.37.4 (main.09686af1.js, 2026-10-02). Tried on a real room the same day:
 * portraits and faces given as files in the zip are imported.
 *   __data.json  {"meta":{"version":"1.1.0"},"entities":{...},"resources":{<file>:{"type":<mime>}}}
 *                entities.characters = { <id>: { name, memo, initiative, externalUrl,
 *                  status: [{label, value, max}], params: [{label, value}], iconUrl,
 *                  faces: [{label, iconUrl}], x, y, z, angle, width, height, active, secret,
 *                  invisible, hideStatus, color, commands, order } }
 *   <file>       an image at the zip root, named <sha-256 hex of its bytes>.<extension of its mime>
 *                (CCFOLIA ignores a file whose name does not match its content). On import it is
 *                uploaded to shared storage and every iconUrl holding its name, however deeply
 *                nested (faces too), is replaced with its URL.
 *   .token       "0." + sha-256 of __data.json. Ours never matches on purpose: CCFOLIA then asks
 *                "外部ツールで作成および編集されたデータです…" before importing, so the user knows
 *                the data came from an outside tool.
 * Import writes each character by id in one batch (so at most MAX of them), with the importing
 * user as owner. New ids only add characters. An iconUrl that is not a file in the zip must be a
 * URL on CCFOLIA's own storage, or it is dropped; this tool only writes files.
 * The other kinds are empty and leave the room as it is; room {} only touches its updatedAt.
 */
(function (root) {
  "use strict";

  // CCFOLIA names files with mime's getExtension, which returns the first extension listed.
  const EXT = { "image/png": "png", "image/jpeg": "jpeg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif" };
  const TOKEN = "0.not-signed-made-by-an-outside-tool";
  const KINDS = ["room", "items", "decks", "notes", "characters", "effects", "scenes", "savedatas", "snapshots"];
  const MAX = 500;  // one Firestore batch
  const CELL = 24;  // pixels per board cell (roomScreenCellSize)
  const PER_ROW = 8;

  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");

  function dataUrlBytes(dataUrl) {
    const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl || "");
    if (!m) throw new Error("bad data url");
    const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return { type: m[1], bytes };
  }

  function newId(random) {
    const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const r = random(20);
    let s = "";
    for (let i = 0; i < 20; i++) s += abc[r[i] % abc.length];
    return s;
  }

  const num = (v, d) => typeof v === "number" && Number.isFinite(v) ? v : d;

  /**
   * input: { characters: [{ name, memo, initiative, externalUrl, status, params, commands, color,
   *                         size, active, secret, invisible, hideStatus,
   *                         image, faces: [{ label, image }] }] }
   *        image: null | { type, bytes (Uint8Array), key }  (key marks images that are the same,
   *               so they are hashed once)
   * deps:  { JSZip, subtle, random(n) -> Uint8Array, now }
   * -> { zip (JSZip), data, files }  (call zip.generateAsync yourself)
   */
  async function build(input, deps) {
    const { JSZip, subtle, random } = deps;
    const now = deps.now || Date.now();
    const list = input.characters || [];
    if (list.length > MAX) throw new Error(`too many characters (${list.length} > ${MAX})`);
    const zip = new JSZip();
    const resources = {};
    const refOf = new Map(); // image key -> file name, so an image used many times is stored once

    async function fileRef(img) {
      if (!img || !img.bytes) return null;
      const k = img.key || img.bytes;
      if (refOf.has(k)) return refOf.get(k);
      const ext = EXT[img.type];
      if (!ext) throw new Error("unsupported image type: " + img.type);
      const name = hex(await subtle.digest("SHA-256", img.bytes)) + "." + ext;
      if (!resources[name]) { resources[name] = { type: img.type }; zip.file(name, img.bytes); }
      refOf.set(k, name);
      return name;
    }

    // Seconds since 1970 as the base keeps each import after the ones before it in the list.
    const base = Math.floor(now / 1000);
    const characters = {};
    let inRow = 0, rowX = 0, rowY = 0, rowHeight = 0; // in cells
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const size = Math.min(Math.max(num(c.size, 4), 1), 100);
      // Characters put on the board stand side by side instead of in one pile.
      let x = 0, y = 0;
      if (c.active) {
        if (inRow === PER_ROW) { rowY += rowHeight; rowX = 0; rowHeight = 0; inRow = 0; }
        x = rowX * CELL;
        y = rowY * CELL;
        rowX += size;
        rowHeight = Math.max(rowHeight, size);
        inRow++;
      }
      const faces = [];
      for (const f of c.faces || []) {
        const iconUrl = await fileRef(f.image);
        if (iconUrl) faces.push({ label: String(f.label || ""), iconUrl });
      }
      characters[newId(random)] = {
        name: String(c.name || ""), memo: String(c.memo || ""), initiative: num(c.initiative, 0),
        externalUrl: String(c.externalUrl || ""),
        status: (c.status || []).map(s => ({ label: String(s.label || ""), value: num(s.value, 0), max: num(s.max, 0) })),
        params: (c.params || []).map(p => ({ label: String(p.label || ""), value: String(p.value == null ? "" : p.value) })),
        iconUrl: await fileRef(c.image), faces,
        x, y, z: 0, angle: 0, width: size, height: size,
        active: !!c.active, secret: !!c.secret, invisible: !!c.invisible, hideStatus: !!c.hideStatus,
        color: /^#[0-9a-f]{6}$/i.test(c.color || "") ? c.color : "#888888",
        commands: String(c.commands || ""), order: base + i,
      };
    }

    const entities = {};
    for (const k of KINDS) entities[k] = k === "characters" ? characters : {};
    const data = { meta: { version: "1.1.0" }, entities, resources };
    zip.file("__data.json", JSON.stringify(data));
    zip.file(".token", TOKEN);
    return { zip, data, files: Object.keys(resources) };
  }

  root.CbRoomData = { build, EXT, TOKEN, MAX, dataUrlBytes, hex };
})(typeof window !== "undefined" ? window : globalThis);
