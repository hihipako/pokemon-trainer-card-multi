#!/usr/bin/env node
/**
 * 트레이너 카드 (1~4인) — 빌드
 *   node tools/build.js    src/template.html + data/payload.json → index.html
 *
 * 포켓몬 데이터와 스프라이트시트는 pokemon-trainer-card 저장소에서 만든 것을
 * 그대로 가져와 쓴다. 갱신이 필요하면 그쪽에서 만들어 복사해 온다.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const tpl = fs.readFileSync(path.join(ROOT, "src", "template.html"), "utf8");
const payload = fs.readFileSync(path.join(ROOT, "data", "payload.json"), "utf8");

if (!tpl.includes("/*__DATA__*/")) throw new Error("template.html 에 /*__DATA__*/ 자리가 없습니다");
if (payload.includes("</script")) throw new Error("payload 안에 </script 가 있어 인라인할 수 없습니다");

const out = path.join(ROOT, "index.html");
fs.writeFileSync(out, tpl.replace("/*__DATA__*/", payload));

const p = JSON.parse(payload);
console.log(`index.html  ${(fs.statSync(out).size / 1024).toFixed(0)}KB` +
            `  (포켓몬 ${p.mons.length}종 · 시트 ${p.cols}열×${Math.ceil(p.mons.length / p.cols)}행)`);
