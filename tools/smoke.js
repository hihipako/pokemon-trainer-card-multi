#!/usr/bin/env node
/**
 * index.html 을 가상 브라우저에 띄워 실제로 눌러보는 점검.
 *   node tools/smoke.js
 * 브라우저가 없어도 되는 부분(레이아웃 픽셀, 캔버스)은 흉내만 낸다.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", e => errors.push("jsdomError: " + (e.stack || e.message)));
vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: "https://example.test/",
  beforeParse(win) {
    win.matchMedia = q => ({
      matches: false, media: q,
      addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){},
    });
    if (!win.TextEncoder) win.TextEncoder = global.TextEncoder;
    if (!win.TextDecoder) win.TextDecoder = global.TextDecoder;
    win.HTMLCanvasElement.prototype.getContext = () => ({
      drawImage(){}, fillRect(){}, set imageSmoothingQuality(v){},
    });
    win.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,AA==";
    // 이미지는 실제로 불러올 수 없으니 800×1200 으로 즉시 불러와진 척한다
    Object.defineProperty(win.HTMLImageElement.prototype, "src", {
      configurable: true,
      get() { return this.getAttribute("src") || ""; },
      set(v) {
        this.setAttribute("src", v);
        Object.defineProperty(this, "naturalWidth",  { value: 800,  configurable: true });
        Object.defineProperty(this, "naturalHeight", { value: 1200, configurable: true });
        win.setTimeout(() => this.dispatchEvent(new win.Event("load")), 0);
      },
    });
    // 레이아웃이 없으므로 카드·사진 칸 크기를 실제 값처럼 돌려준다
    win.Element.prototype.getBoundingClientRect = function () {
      const id = this.id, cls = String(this.className || "");
      if (id === "card")  return rect(0, 0, 1120, 700);
      if (id === "stage") return rect(560, 18, 534, 664);
      if (cls.includes("cropbox")) return rect(0, 0, 300, 373);
      if (cls.includes("party") || cls.includes("layer")) return rect(100, 100, 183, 304);
      return rect(0, 0, 300, 300);
    };
    function rect(x, y, w, h) {
      return { x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON(){} };
    }
  },
});

const win = dom.window, doc = win.document;
const $ = id => doc.getElementById(id);
const qs = s => doc.querySelector(s);
const qsa = s => [...doc.querySelectorAll(s)];
const results = [];
const check = (name, fn) => {
  try {
    const msg = fn();
    const ok = msg === true || msg === undefined;
    results.push([ok ? "OK" : "FAIL", name, typeof msg === "string" ? msg : ""]);
  } catch (e) {
    results.push(["FAIL", name, e.message]);
  }
};
const pointer = (el, type, x = 10, y = 10) => {
  const ev = new win.Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, { clientX: x, clientY: y, pointerId: 1 });
  el.dispatchEvent(ev);
};
const click = el => el.dispatchEvent(new win.Event("click", { bubbles: true, cancelable: true }));
const input = (el, v) => { el.value = v; el.dispatchEvent(new win.Event("input", { bubbles: true })); };
const change = (el, v) => { if (v !== undefined) el.value = v; el.dispatchEvent(new win.Event("change", { bubbles: true })); };
const tick = ms => new Promise(r => win.setTimeout(r, ms || 30));
const pickFile = (inputEl, name) => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const file = new win.File([png], name, { type: "image/png" });
  Object.defineProperty(inputEl, "files", { value: [file], configurable: true });
  change(inputEl);
};
const setMode = n => click(qsa("#modeSeg button").find(b => b.dataset.v === String(n)));

win.addEventListener("load", run);
setTimeout(run, 2500);
let ran = false;

async function run() {
  if (ran) return;
  ran = true;

  /* ── 1. 첫 화면 — 1인용 ─────────────────────── */
  check("스크립트가 오류 없이 실행됨", () => errors.length === 0 || errors.join(" | "));
  check("처음엔 1인용", () => $("card").classList.contains("m1"));
  check("사람 칸 1개", () => qsa(".person").length === 1 || "개수 " + qsa(".person").length);
  check("막대 6개", () => qsa(".person .bar").length === 6 || "개수 " + qsa(".person .bar").length);
  check("도트 덩어리 1개 · 칸 6개", () => {
    const g=qsa("#stage .party").length, e=qsa("#stage .ent").length;
    return (g===1 && e===6) || "덩어리 "+g+" · 칸 "+e;
  });
  check("1인용엔 단독샷이 없다", () => qsa(".solo").length === 0 || "개수 " + qsa(".solo").length);
  check("처음엔 전부 빈 자리", () => qsa(".bar.empty").length === 6);
  check("텍스트 칸이 비어 있음", () => qsa(".person .fld").every(e => e.value === ""));
  check("공유 코드가 만들어짐", () => /^M1\./.test($("outCode").value) || $("outCode").value.slice(0, 20));

  /* ── 2. 인원 바꾸기 ─────────────────────────── */
  check("2인용 — 사람 2 · 도트 덩어리 2 · 단독샷 2", () => {
    setMode(2);
    const p = qsa(".person").length, d = qsa("#stage .party").length, s = qsa(".solo").length;
    return (p === 2 && d === 2 && s === 2) || `사람 ${p} · 덩어리 ${d} · 단독샷 ${s}`;
  });
  check("3인용 — 왼쪽 2 · 오른쪽 1", () => {
    setMode(3);
    const l = qsa("#colL .person").length, r = qsa("#colR .person").length;
    return (l === 2 && r === 1) || `왼쪽 ${l} · 오른쪽 ${r}`;
  });
  check("3인용 오른쪽은 절반 높이로 둔다", () => {
    setMode(3);
    const p = qs("#colR .person");
    const st = p.getAttribute("style") || "";
    const flex = win.getComputedStyle(p).flex || "";
    return /0 0/.test(flex) || flex || "flex 값을 못 읽음";
  });
  check("4인용 — 왼쪽 2 · 오른쪽 2 · 덩어리 4", () => {
    setMode(4);
    const l = qsa("#colL .person").length, r = qsa("#colR .person").length, d = qsa("#stage .party").length;
    return (l === 2 && r === 2 && d === 4) || `왼쪽 ${l} · 오른쪽 ${r} · 덩어리 ${d}`;
  });
  check("인원에 따라 카드 크기가 바뀐다", () => {
    const get = () => win.getComputedStyle(doc.documentElement).getPropertyValue("--cw").trim();
    setMode(1); const a = get();
    setMode(4); const b = get();
    return (a === "1120px" && b === "1320px") || `1인 ${a} · 4인 ${b}`;
  });
  check("사람 칸에 A~D 이름표", () => {
    const labs = qsa(".person .lab").map(e => e.textContent).filter(t => /Trainer/.test(t));
    return labs.join(",") === "Trainer A,Trainer B,Trainer C,Trainer D" || labs.join(",");
  });

  /* ── 3. 포켓몬 넣기 ─────────────────────────── */
  check("C의 3번 막대를 누르면 편집창이 열림", () => {
    const person = qsa(".person")[2];
    click(person.querySelectorAll(".bar")[2]);
    return $("modal").hidden === false && $("mNo").textContent.trim() === "C 03" || $("mNo").textContent;
  });
  check("초성 검색 ㄴㅍㅇ → 님피아", () => {
    input($("q"), "ㄴㅍㅇ");
    const first = qs("#res .rit .rn");
    return (first && first.textContent === "님피아") || (first ? first.textContent : "결과 없음");
  });
  check("타입 칩 19개", () => {
    const n = qsa("#typebar .tchip").length;
    return n === 19 || "개수 " + n;
  });
  check("고르면 C의 3번에만 들어감", () => {
    input($("q"), "님피아");
    click(qs("#res .rit"));
    const people = qsa(".person");
    const cBar = people[2].querySelectorAll(".bar")[2];
    const aBar = people[0].querySelectorAll(".bar")[2];
    return (/님피아/.test(cBar.textContent) && aBar.classList.contains("empty"))
      || "C: " + cBar.textContent.slice(0, 20);
  });
  check("사이즈 XXXL 반영", () => {
    click(qsa("#e_size button").find(b => b.dataset.v === "XXXL"));
    return /XXXL/.test(qsa(".person")[2].querySelectorAll(".bar")[2].textContent);
  });
  check("도트에도 반영", () => {
    const filled = qsa("#stage .ent").filter(e => !e.classList.contains("empty"));
    return filled.length === 1 || "채워진 도트 " + filled.length;
  });
  check("편집창 닫기", () => { click($("mClose")); return $("modal").hidden === true; });

  /* ── 4. 도트 덩어리 이동 ────────────────────── */
  check("덩어리를 끌면 여섯 개가 같이 움직인다", () => {
    const gs = qsa("#stage .party");
    const before = gs.map(g => g.style.left);
    pointer(gs[0], "pointerdown", 600, 400);
    pointer(gs[0], "pointermove", 900, 550);
    pointer(gs[0], "pointerup", 900, 550);
    const after = qsa("#stage .party").map(g => g.style.left);
    const movedCount = after.filter((v, i) => v !== before[i]).length;
    const kids = qsa("#stage .party")[0].querySelectorAll(".ent").length;
    return (movedCount === 1 && kids === 6) || "움직인 덩어리 " + movedCount + " · 칸 " + kids;
  });
  check("2인용은 좌·우로 갈라져 시작한다", () => {
    setMode(2); click($("dotsReset"));
    const xs = qsa("#stage .party").map(g => parseFloat(g.style.left));
    setMode(4);
    return (xs.length === 2 && xs[0] < 20 && xs[1] > 45) || "x: " + xs.join(", ");
  });
  check("도트 제자리로", () => {
    const g = qsa("#stage .party")[0];
    g.style.left = "77%";
    click($("dotsReset"));
    return qsa("#stage .party")[0].style.left !== "77%";
  });

  /* ── 5. 표시 항목 · 배경 ────────────────────── */
  check("설명을 끄면 모든 사람에게서 사라짐", () => {
    $("t_desc").checked = false; change($("t_desc"));
    const shown = qsa(".person .blk.grow").filter(e => !e.hidden).length;
    $("t_desc").checked = true; change($("t_desc"));
    return shown === 0 || "남은 설명칸 " + shown;
  });
  check("단독샷을 끄면 칸이 사라짐", () => {
    $("t_solo").checked = false; change($("t_solo"));
    const n = qsa(".solo").length;
    $("t_solo").checked = true; change($("t_solo"));
    return n === 0 || "남은 단독샷 " + n;
  });
  check("배경 검정 → 글자색 반전", () => {
    click($("sw_k"));
    const fg = $("card").style.getPropertyValue("--cfg");
    click($("sw_w"));
    return fg === "#f6f2fa" || fg;
  });

  /* ── 6. 트레이너 칭호 ───────────────────────── */
  check("칭호 목록 215종", () => {
    const n = $("roleSel").querySelectorAll("option").length;
    return n === 216 || "개수 " + n;
  });
  check("B를 골라 칭호를 넣으면 B의 신분 칸에 들어감", () => {
    click(qsa("#roleWho button")[1]);
    change($("roleSel"), "고스트 트레이너");
    const b = qsa(".person")[1].querySelector(".f-role").value;
    const a = qsa(".person")[0].querySelector(".f-role").value;
    return (b === "고스트 트레이너" && a === "") || `B:${b} A:${a}`;
  });

  /* ── 7. 공유 코드 ───────────────────────────── */
  let code;
  check("코드에 내용이 담김", () => { code = $("outCode").value; return code.length > 60 || "길이 " + code.length; });
  check("코드를 불러오면 인원·엔트리·칭호가 복원", () => {
    setMode(1);
    $("inCode").value = code; click($("loadBtn"));
    const mode = $("card").classList.contains("m4");
    const cBar = qsa(".person")[2] && qsa(".person")[2].querySelectorAll(".bar")[2];
    const bRole = qsa(".person")[1] && qsa(".person")[1].querySelector(".f-role").value;
    return (mode && cBar && /님피아/.test(cBar.textContent) && bRole === "고스트 트레이너")
      || `4인:${mode} C:${cBar ? cBar.textContent.slice(0,14) : "-"} B:${bRole}`;
  });

  /* ── 8. 사진 ────────────────────────────────── */
  await (async () => {
    pickFile($("fileBase"), "group.png");
    await tick(80);
    check("사진을 고르면 자르기 화면이 열림", () => $("cropModal").hidden === false);
    check("4인용에선 제목이 단체샷", () => /단체샷/.test($("cropHead").textContent) || $("cropHead").textContent);
    click($("cropApply"));
    await tick(80);
    check("카드에 단체샷이 들어감", () => $("baseImg").hidden === false && !!$("baseImg").getAttribute("src"));
    check("사진 안내가 사라짐", () => $("stageHint").hidden === true);
  })();

  await (async () => {
    check("단독샷 칸을 누르면 파일 고르기로 간다", () => {
      const solo = qsa(".solo")[1];
      click(solo);
      return $("fileBase").dataset.kind === "solo";
    });
    pickFile($("fileBase"), "solo.png");
    await tick(80);
    check("단독샷 자르기 제목에 사람이 나온다", () => /단독샷/.test($("cropHead").textContent) || $("cropHead").textContent);
    click($("cropApply"));
    await tick(120);
    check("단독샷이 칸에 들어감", () => {
      const im = qsa(".solo img");
      return im.length >= 1 || "이미지 " + im.length;
    });
  })();

  check("단독샷은 원본이 아니라 잘라낸 것을 쓴다", () => {
    const im = qs(".solo img");
    if (!im) return "단독샷 이미지가 없음";
    const src = im.getAttribute("src") || "";
    return src.startsWith("data:image/png;base64,AA==") || "src: " + src.slice(0, 40);
  });
  /* ── 9. 리셋 ────────────────────────────────── */
  check("리셋은 두 번 눌러야 지워짐", () => {
    click($("resetBtn"));
    if (qsa(".bar.empty").length === qsa(".bar").length && $("card").classList.contains("m1")) return "한 번에 지워짐";
    click($("resetBtn"));
    return ($("card").classList.contains("m1") && qsa(".person").length === 1) || "지워지지 않음";
  });

  check("끝까지 오류 없음", () => errors.length === 0 || errors.join(" | ").slice(0, 300));

  const fail = results.filter(r => r[0] === "FAIL");
  for (const [st, name, msg] of results) console.log(`  ${st === "OK" ? " OK " : "FAIL"}  ${name}${msg ? "  — " + msg : ""}`);
  console.log(`\n${results.length}개 중 ${results.length - fail.length}개 통과, ${fail.length}개 실패`);
  process.exit(fail.length ? 1 : 0);
}
