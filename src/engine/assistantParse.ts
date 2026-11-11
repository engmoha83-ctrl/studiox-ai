// AI editing assistant – the operation vocabulary, the built-in (offline) Arabic/English command
// parser and the validator for operations proposed by a local LLM (Ollama).
// Pure module: no stores, no I/O – unit tested.
import type { TransitionType } from "../types/project";

export type AssistantOp =
  | { op: "removeSilence" }
  | { op: "splitScenes" }
  | { op: "speed"; speed: number }
  | { op: "transitions"; type: TransitionType }
  | { op: "color"; preset: string }
  | { op: "reframe"; aspect: "9:16" | "1:1" | "4:5" | "16:9" }
  | { op: "subtitles"; language: string; translate: boolean }
  | { op: "title"; text: string }
  | { op: "export" };

/** Execution order: cut first, then look, then format, then words, then export. */
export const OP_ORDER: AssistantOp["op"][] = ["removeSilence", "splitScenes", "speed", "transitions", "color", "reframe", "subtitles", "title", "export"];

export const COLOR_IDS = ["cinematic", "warm", "cool", "vintage", "bw", "sepia", "vivid", "faded", "night"];
const TRANSITIONS: TransitionType[] = ["fade", "dissolve", "slide-left", "slide-right", "slide-up", "slide-down"];
const ASPECTS = ["9:16", "1:1", "4:5", "16:9"] as const;
const LANGS = ["auto", "ar", "en", "fr", "es", "de", "tr", "ur", "fa", "hi"];

/** Normalise Arabic spelling variants + case so simple patterns match. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "") // tashkeel + tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/٫/g, ".")
    .replace(/\s+/g, " ");
}

const has = (s: string, re: RegExp) => re.test(s);

/** Built-in offline parser. Returns operations in execution order (deduplicated). */
export function parseCommand(input: string): AssistantOp[] {
  const s = normalize(input);
  const ops: AssistantOp[] = [];
  const add = (o: AssistantOp) => {
    if (!ops.some((x) => x.op === o.op)) ops.push(o);
  };

  const pro = has(s, /professional|polish|احترافي|احترافيه|بروفيشنال|شكل محترف/);

  if (pro || has(s, /silen|pause|dead air|صمت|سكوت|سكته|سكتات|وقفات|الفراغات/)) add({ op: "removeSilence" });

  if (has(s, /scene|shot change|مشاهد|المشهد|لقطات/) && has(s, /split|cut|detect|قسم|قطع|افصل|اكتشف|حدد/)) add({ op: "splitScenes" });

  const sp = s.match(/(\d+(?:\.\d+)?)\s*(?:x|×|اضعاف|ضعف|مرات|مره)(?![a-z])/) ?? s.match(/(?:speed|سرعه)\s*(\d+(?:\.\d+)?)/);
  if (sp) add({ op: "speed", speed: Math.min(16, Math.max(0.1, parseFloat(sp[1]))) });
  else if (has(s, /slow ?mo|slow down|بطيء|بطئ|سلو موشن|بالتصوير البطيء|هدي السرعه/)) add({ op: "speed", speed: 0.5 });
  else if (has(s, /speed up|faster|اسرع|سرع|زود السرعه/)) add({ op: "speed", speed: 1.5 });

  if (pro || has(s, /transition|ترانزيشن|انتقال/)) {
    const type: TransitionType = has(s, /slide|انزلاق|سلايد|زحلقه/) ? "slide-left" : has(s, /fade|black|تلاشي|اسود|فيد/) ? "fade" : "dissolve";
    add({ op: "transitions", type });
  }

  const colour: [RegExp, string][] = [
    [/black (and|&) white|b ?& ?w|grayscale|greyscale|ابيض واسود|ابيض و اسود|رمادي/, "bw"],
    [/sepia|سيبيا|بني قديم/, "sepia"],
    [/vintage|retro|old film|كلاسيك|(^|\s)(و|ب)?(ال)?قديم|ريترو|فينتدج/, "vintage"],
    [/cinematic|film look|movie look|سينمائي|سينما/, "cinematic"],
    [/\bwarm|دافئ|دافي/, "warm"],
    [/\bcool\b|\bcold\b|بارد/, "cool"],
    [/vivid|vibrant|saturated|زاهي|زاهيه|حيويه|الوان قويه/, "vivid"],
    [/faded|باهت/, "faded"],
    [/\bnight|(^|\s)(و|ب)?(ال)?ليلي?(\s|$)/, "night"],
  ];
  const c = colour.find(([re]) => has(s, re));
  if (c) add({ op: "color", preset: c[1] });
  else if (pro) add({ op: "color", preset: "cinematic" });

  if (has(s, /tik ?tok|reels?\b|shorts|vertical|portrait mode|9[:/]16|story|stories|تيك ?توك|تيكتوك|ريلز|شورتس|عمودي|طولي|ستوري|استوري/)) add({ op: "reframe", aspect: "9:16" });
  else if (has(s, /4[:/]5|instagram (feed|post)|بوست انستجرام|انستجرام بوست/)) add({ op: "reframe", aspect: "4:5" });
  else if (has(s, /square|1[:/]1|مربع/)) add({ op: "reframe", aspect: "1:1" });
  else if (has(s, /youtube|landscape|horizontal|16[:/]9|يوتيوب|افقي|عرضي/)) add({ op: "reframe", aspect: "16:9" });

  if (has(s, /subtitle|caption|transcri|ترجمه|ترجم|كابشن|كابشنز|سب ?تايتل|تفريغ|نص الكلام/)) {
    const translate = has(s, /translat.*english|to english|ترجم.*(انجليزي|انكليزي|الانجليزيه)|بالانجليزي.*ترجم/);
    const language = has(s, /arabic|عربي|بالعربي/) && !translate ? "ar" : has(s, /english|انجليزي|انكليزي/) && !translate ? "en" : "auto";
    add({ op: "subtitles", language, translate });
  }

  const ti = input.match(/(?:title|عنوان|العنوان)\s*[:：]?\s*["“«'‘]([^"”»'’]{1,120})["”»'’]/i) ?? input.match(/(?:title|عنوان|العنوان)\s*[:：]\s*([^\n,،.]{1,120})/i);
  if (ti) add({ op: "title", text: ti[1].trim() });
  else if (has(s, /add (a )?title|ضيف عنوان|اضف عنوان|حط عنوان/)) add({ op: "title", text: "" });

  if (has(s, /export|\brender|(^|\s)(و)?صدر|تصدير|اطلع الفيديو|طلع الفيديو/)) add({ op: "export" });

  return sortOps(ops);
}

export function sortOps(ops: AssistantOp[]): AssistantOp[] {
  return [...ops].sort((a, b) => OP_ORDER.indexOf(a.op) - OP_ORDER.indexOf(b.op));
}

/** Validate operations proposed by an LLM. Anything unknown or malformed is dropped. */
export function validateOps(raw: unknown): AssistantOp[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { operations?: unknown }).operations) ? (raw as { operations: unknown[] }).operations : [];
  const out: AssistantOp[] = [];
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    switch (o.op) {
      case "removeSilence":
      case "splitScenes":
      case "export":
        out.push({ op: o.op });
        break;
      case "speed": {
        const v = Number(o.speed);
        if (Number.isFinite(v) && v > 0) out.push({ op: "speed", speed: Math.min(16, Math.max(0.1, v)) });
        break;
      }
      case "transitions":
        out.push({ op: "transitions", type: TRANSITIONS.includes(o.type as TransitionType) ? (o.type as TransitionType) : "dissolve" });
        break;
      case "color":
        if (COLOR_IDS.includes(String(o.preset))) out.push({ op: "color", preset: String(o.preset) });
        break;
      case "reframe":
        if ((ASPECTS as readonly string[]).includes(String(o.aspect))) out.push({ op: "reframe", aspect: o.aspect as (typeof ASPECTS)[number] });
        break;
      case "subtitles":
        out.push({ op: "subtitles", language: LANGS.includes(String(o.language)) ? String(o.language) : "auto", translate: o.translate === true });
        break;
      case "title":
        out.push({ op: "title", text: typeof o.text === "string" ? o.text.slice(0, 120) : "" });
        break;
    }
  }
  const seen = new Set<string>();
  return sortOps(out.filter((o) => !seen.has(o.op) && seen.add(o.op)));
}

/** System prompt for the optional local LLM. It may only choose from this vocabulary. */
export const LLM_SYSTEM_PROMPT = `You are the editing assistant of a video editor. Turn the user's request (Arabic or English) into a JSON object {"operations":[...]} using ONLY these operations:
{"op":"removeSilence"} – cut silent pauses
{"op":"splitScenes"} – split clips at scene changes
{"op":"speed","speed":number} – change speed of the selected clips (0.1-16)
{"op":"transitions","type":"fade"|"dissolve"|"slide-left"|"slide-right"|"slide-up"|"slide-down"} – add transitions between clips
{"op":"color","preset":"cinematic"|"warm"|"cool"|"vintage"|"bw"|"sepia"|"vivid"|"faded"|"night"} – colour look for all video clips
{"op":"reframe","aspect":"9:16"|"1:1"|"4:5"|"16:9"} – change the frame size and keep the subject in view (TikTok/Reels/Shorts = 9:16)
{"op":"subtitles","language":"auto"|"ar"|"en"|"fr"|"es"|"de"|"tr"|"ur"|"fa"|"hi","translate":boolean} – automatic subtitles (translate=true gives English)
{"op":"title","text":string} – add a title at the start
{"op":"export"} – open the export dialog
Use only operations the user asked for or clearly implied. If nothing matches, return {"operations":[]}. Reply with JSON only.`;
