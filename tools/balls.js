#!/usr/bin/env node
/**
 * 몬스터볼 데이터 만들기
 *   node tools/balls.js   →  data/balls.json  (이름 + 30px 아이콘 시트 data URI)
 * PokeAPI 의 아이템 CSV 로 볼 목록과 한국어 이름을 얻고, 아이콘을 한 줄짜리 시트로 붙인다.
 */
"use strict";
const fs = require("fs"), path = require("path");
const { PNG } = require("pngjs");
const sharp = require("sharp");

const CSV = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv";
const ICON = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items";
const BALL_CATS = new Set(["33", "34", "39"]);   // special / standard / apricorn
const KO = "3", EN = "9";
const CELL = 30;

function csv(t) {
  const rows = []; let f = "", row = [], q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const get = async u => { const r = await fetch(u); if (!r.ok) throw new Error(r.status + " " + u); return r; };
const text = async u => (await get(u)).text();

(async () => {
  const items = csv(await text(CSV + "/items.csv")).slice(1);
  const names = csv(await text(CSV + "/item_names.csv")).slice(1);

  const koName = new Map(), enName = new Map();
  for (const r of names) {
    if (r[1] === KO) koName.set(r[0], r[2]);
    else if (r[1] === EN) enName.set(r[0], r[2]);
  }

  // 순서: 몬스터볼 → 슈퍼볼 → 하이퍼볼 → 마스터볼 먼저, 나머지는 도감 순
  const HEAD = ["poke-ball", "great-ball", "ultra-ball", "master-ball"];
  const list = items
    .filter(r => BALL_CATS.has(r[2]) && !/^(park|strange|beast-ball-unused)/.test(r[1]))
    .map(r => ({ id: r[0], slug: r[1], ko: koName.get(r[0]) || enName.get(r[0]) || r[1], en: enName.get(r[0]) || r[1] }))
    .filter(b => b.ko);
  list.sort((a, b) => {
    const ia = HEAD.indexOf(a.slug), ib = HEAD.indexOf(b.slug);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return +a.id - +b.id;
  });

  // 히스이 지방의 볼은 이름이 겹치므로 구분해 준다
  const seen = new Set();
  for (const b of list) { if (seen.has(b.ko)) b.ko += " (히스이)"; seen.add(b.ko); }

  const cells = [];
  const kept = [];
  for (const b of list) {
    let buf;
    try { buf = Buffer.from(await (await get(`${ICON}/${b.slug}.png`)).arrayBuffer()); }
    catch { console.log("  아이콘 없음 — 건너뜀:", b.slug); continue; }
    cells.push(PNG.sync.read(buf));
    kept.push(b);
  }

  const sheet = new PNG({ width: CELL * kept.length, height: CELL, fill: true });
  cells.forEach((png, i) => {
    const w = Math.min(png.width, CELL), h = Math.min(png.height, CELL);
    const sx = Math.floor((png.width - w) / 2), sy = Math.floor((png.height - h) / 2);
    const dx = i * CELL + Math.floor((CELL - w) / 2), dy = Math.floor((CELL - h) / 2);
    PNG.bitblt(png, sheet, sx, sy, w, h, dx, dy);
  });

  const webp = await sharp(PNG.sync.write(sheet)).webp({ lossless: true }).toBuffer();
  const out = {
    cell: CELL,
    sheet: "data:image/webp;base64," + webp.toString("base64"),
    list: kept.map(b => ({ k: b.ko, e: b.en })),
  };
  fs.writeFileSync(path.join(__dirname, "..", "data", "balls.json"), JSON.stringify(out));
  console.log(`볼 ${kept.length}종 · 시트 ${(webp.length / 1024).toFixed(0)}KB`);
  console.log(kept.map(b => b.ko).join(", "));
})();
