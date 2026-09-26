import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const dataDirectory = resolve(repositoryRoot, "data");
const outputDirectory = resolve(repositoryRoot, "assets");

const baselinePath = resolve(dataDirectory, "token-activity-through-2026-08-29.csv");
const updatePath = resolve(dataDirectory, "token-activity-update-2026-09-22.csv");
const codexPath = resolve(dataDirectory, "codex-token-activity-2026-09-22.csv");
const pricingPath = resolve(dataDirectory, "token-pricing.json");

const parseCsv = (text) => {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",");
  return lines.filter(Boolean).map((line) => {
    const values = line.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
};

const parseTokenCount = (raw) => {
  const match = String(raw).trim().match(/^([0-9]+(?:\.[0-9]+)?)([KMB])?$/i);
  if (!match) throw new Error(`Invalid token count: ${raw}`);
  const multipliers = { K: 1e3, M: 1e6, B: 1e9 };
  return Number(match[1]) * (multipliers[(match[2] || "").toUpperCase()] || 1);
};

const normalizeModel = (model) => {
  if (model.startsWith("claude-")) return model.replace(/-cc$/, "");
  if (model.startsWith("gpt-")) return model.replace(/-(?:vibe|flex)$/, "");
  if (model.startsWith("glm-")) return model.replace(/-highspeed$/, "");
  return model;
};

const baselineRows = parseCsv(await readFile(baselinePath, "utf8"));
const updateRows = parseCsv(await readFile(updatePath, "utf8"));
const codexRows = parseCsv(await readFile(codexPath, "utf8"));
const pricing = JSON.parse(await readFile(pricingPath, "utf8"));

const activity = [];
for (const row of baselineRows) {
  for (const [model, rawTokens] of Object.entries(row)) {
    if (model === "date") continue;
    const tokens = Number(rawTokens || 0);
    if (tokens > 0) activity.push({ date: row.date, model: normalizeModel(model), tokens });
  }
}
for (const row of [...updateRows, ...codexRows]) {
  activity.push({ date: row.date, model: normalizeModel(row.model), tokens: parseTokenCount(row.tokens) });
}

const addToMap = (map, key, value) => map.set(key, (map.get(key) || 0) + value);
const dailyTotals = new Map();
const modelTotals = new Map();
for (const row of activity) {
  addToMap(dailyTotals, row.date, row.tokens);
  addToMap(modelTotals, row.model, row.tokens);
}

const startDate = "2026-02-28";
const endDate = "2026-09-22";
const dateRange = [];
for (let cursor = new Date(`${startDate}T00:00:00Z`); cursor <= new Date(`${endDate}T00:00:00Z`); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
  dateRange.push(cursor.toISOString().slice(0, 10));
}

const outputShare = pricing.assumptions.outputShare;
const inputShare = 1 - outputShare;
const cachedInputShare = inputShare * pricing.assumptions.inputCacheHitRate;
const freshInputShare = inputShare - cachedInputShare;
const costs = [];
let pricedTokens = 0;
let totalCost = 0;
for (const [model, tokens] of modelTotals) {
  const rate = pricing.pricesPerMillionUsd[model];
  if (!rate) continue;
  const cost = (tokens / 1e6) * (
    freshInputShare * rate.input
    + cachedInputShare * rate.cached
    + outputShare * rate.output
  );
  costs.push({ model, tokens, cost });
  pricedTokens += tokens;
  totalCost += cost;
}
costs.sort((a, b) => b.cost - a.cost);

const totalTokens = [...dailyTotals.values()].reduce((sum, value) => sum + value, 0);
const activeDays = dateRange.filter((date) => (dailyTotals.get(date) || 0) > 0).length;
let longestStreak = 0;
let currentStreak = 0;
for (const date of dateRange) {
  if ((dailyTotals.get(date) || 0) > 0) {
    currentStreak += 1;
    longestStreak = Math.max(longestStreak, currentStreak);
  } else {
    currentStreak = 0;
  }
}
const peak = dateRange
  .map((date) => ({ date, tokens: dailyTotals.get(date) || 0 }))
  .sort((a, b) => b.tokens - a.tokens)[0];

const formatTokens = (value) => {
  if (value >= 1e9) return `${(value / 1e9).toFixed(value >= 1e10 ? 1 : 2).replace(/\.0$/, "")}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(value >= 1e8 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return Math.round(value).toLocaleString("en-US");
};
const formatMoney = (value) => value >= 1000
  ? `$${(value / 1000).toFixed(1).replace(/\.0$/, "")}K`
  : `$${Math.round(value).toLocaleString("en-US")}`;
const formatShortDate = (date) => {
  const parsed = new Date(`${date}T00:00:00Z`);
  return `${parsed.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${parsed.getUTCDate()}`;
};

const maxDaily = Math.max(...dateRange.map((date) => dailyTotals.get(date) || 0));
const cubeMarkup = (theme) => {
  const cubes = [];
  for (let index = 0; index < dateRange.length; index += 1) {
    const week = Math.floor(index / 7);
    const day = index % 7;
    const tokens = dailyTotals.get(dateRange[index]) || 0;
    const x = 244 + week * 18 - day * 10;
    const baseY = 274 + week * 7 + day * 7;
    if (tokens <= 0) {
      cubes.push({ baseY, markup: `<polygon points="${x},${baseY - 5} ${x + 9},${baseY} ${x},${baseY + 5} ${x - 9},${baseY}" fill="${theme.empty}" stroke="${theme.border}" stroke-width="0.5"/>` });
      continue;
    }
    const intensity = Math.sqrt(tokens / maxDaily);
    const height = 8 + intensity * 50;
    const opacity = (0.72 + intensity * 0.28).toFixed(2);
    cubes.push({ baseY, markup: `<g opacity="${opacity}">
      <polygon points="${x - 9},${baseY - height} ${x},${baseY - height + 5} ${x},${baseY + 5} ${x - 9},${baseY}" fill="${theme.left}"/>
      <polygon points="${x},${baseY - height + 5} ${x + 9},${baseY - height} ${x + 9},${baseY} ${x},${baseY + 5}" fill="${theme.right}"/>
      <polygon points="${x},${baseY - height - 5} ${x + 9},${baseY - height} ${x},${baseY - height + 5} ${x - 9},${baseY - height}" fill="${theme.top}"/>
    </g>` });
  }
  return cubes.sort((a, b) => a.baseY - b.baseY).map((cube) => cube.markup).join("");
};

const monthLabels = [];
for (let index = 0; index < dateRange.length; index += 1) {
  const date = dateRange[index];
  const previous = dateRange[index - 1];
  if (index === 0 || date.slice(0, 7) !== previous.slice(0, 7)) {
    const week = Math.floor(index / 7);
    const day = index % 7;
    const x = 244 + week * 18 - day * 10 - 8;
    const y = 302 + week * 7 + day * 7;
    monthLabels.push(`<text x="${x}" y="${y}" class="tiny">${new Date(`${date}T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" })}</text>`);
  }
}

const renderBadge = (x, y, label, direction = "right") => {
  const width = Math.max(84, label.length * 7.2 + 34);
  const boxX = direction === "right" ? x + 14 : x - width - 14;
  const lineEnd = direction === "right" ? boxX : boxX + width;
  return `<g><path d="M ${x} ${y + 12} L ${x} ${y + 4} L ${lineEnd} ${y + 4}" fill="none" stroke="var(--border)"/><rect x="${boxX}" y="${y - 8}" width="${width}" height="24" rx="12" fill="var(--badge)" stroke="var(--border)"/><circle cx="${boxX + 12}" cy="${y + 4}" r="4" fill="#2563eb"/><text x="${boxX + 22}" y="${y + 8}" class="badgeText">${label}</text></g>`;
};

const renderRows = (topFive) => {
  const maxCost = topFive[0]?.cost || 1;
  return topFive.map((row, index) => {
    const y = 574 + index * 37;
    const width = Math.max(10, 358 * row.cost / maxCost);
    return `<g>
      <text x="54" y="${y}" class="modelName">${index + 1}</text>
      <circle cx="78" cy="${y - 5}" r="5" fill="${index === 0 ? "#2563eb" : "#60a5fa"}" opacity="${1 - index * 0.1}"/>
      <text x="92" y="${y}" class="modelName">${row.model}</text>
      <text x="370" y="${y}" class="rowValue">${formatTokens(row.tokens)}</text>
      <rect x="480" y="${y - 13}" width="358" height="9" rx="4.5" fill="var(--empty)"/>
      <rect x="480" y="${y - 13}" width="${width.toFixed(1)}" height="9" rx="4.5" fill="url(#barGradient)"/>
      <text x="926" y="${y}" text-anchor="end" class="costValue">${formatMoney(row.cost)}</text>
    </g>`;
  }).join("");
};

const renderSvg = (mode) => {
  const dark = mode === "dark";
  const theme = dark
    ? { background: "#0b1220", card: "#111c2f", text: "#e5edf8", muted: "#91a4bd", border: "#293a52", empty: "#18263a", badge: "#101a2b", left: "#2056cc", right: "#103da2", top: "#487ef2" }
    : { background: "#ffffff", card: "#fbfdff", text: "#162033", muted: "#64748b", border: "#dce5f2", empty: "#edf2f8", badge: "#ffffff", left: "#2056cc", right: "#103da2", top: "#487ef2" };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="980" height="790" viewBox="0 0 980 790" role="img" aria-labelledby="title description" style="--border:${theme.border};--badge:${theme.badge};--empty:${theme.empty}">
  <title id="title">Jackie's AI token activity</title>
  <desc id="description">${formatTokens(totalTokens)} tokens from February 28 to September 22, with a top-five model cost ranking.</desc>
  <defs>
    <linearGradient id="barGradient" x1="0" x2="1"><stop stop-color="#60a5fa"/><stop offset="1" stop-color="#0b3b91"/></linearGradient>
    <linearGradient id="headlineGradient" x1="0" x2="1"><stop stop-color="#60a5fa"/><stop offset="1" stop-color="#2563eb"/></linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="5" stdDeviation="8" flood-color="#0f172a" flood-opacity="${dark ? 0.35 : 0.1}"/></filter>
    <style>
      text { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; fill: ${theme.text}; }
      .eyebrow { font-size: 22px; font-weight: 800; letter-spacing: 4px; }
      .sub { font-size: 11px; fill: ${theme.muted}; letter-spacing: 1.2px; }
      .big { font-size: 51px; font-weight: 800; letter-spacing: -2px; }
      .cardValue { font-size: 26px; font-weight: 800; }
      .cardLabel { font-size: 11px; fill: ${theme.muted}; }
      .tiny { font-size: 10px; fill: ${theme.muted}; }
      .badgeText { font-size: 10px; font-weight: 700; }
      .section { font-size: 14px; font-weight: 800; letter-spacing: 2px; }
      .header { font-size: 10px; fill: ${theme.muted}; letter-spacing: 1px; }
      .modelName { font-size: 13px; font-weight: 700; }
      .rowValue { font-size: 12px; fill: ${theme.muted}; }
      .costValue { font-size: 14px; font-weight: 800; }
    </style>
  </defs>
  <rect width="980" height="790" rx="24" fill="${theme.background}"/>
  <text x="34" y="52" class="eyebrow">VIBE CODING STATS</text>
  <text x="34" y="76" class="sub">CODEX + MODEL ACTIVITY · FEB—SEP 2026 · @JACKIE-CQZ</text>
  <text x="946" y="62" text-anchor="end" class="big" fill="url(#headlineGradient)">${formatTokens(totalTokens)} TOKENS</text>
  <text x="946" y="84" text-anchor="end" class="sub">CUMULATIVE MODEL ACTIVITY</text>

  <g filter="url(#shadow)">
    <rect x="34" y="118" width="205" height="112" rx="16" fill="${theme.card}" stroke="${theme.border}"/>
    <text x="54" y="158" class="cardValue">${activeDays}d</text><text x="54" y="179" class="cardLabel">ACTIVE DAYS</text>
    <text x="152" y="158" class="cardValue">${longestStreak}d</text><text x="152" y="179" class="cardLabel">LONGEST STREAK</text>
    <path d="M54 199 H219" stroke="${theme.border}"/>
    <text x="54" y="216" class="tiny">Feb 28 — Sep 22</text>
  </g>

  <g filter="url(#shadow)">
    <rect x="710" y="116" width="236" height="118" rx="16" fill="${theme.card}" stroke="${theme.border}"/>
    <text x="732" y="158" class="cardValue">${formatMoney(totalCost)}</text>
    <text x="732" y="179" class="cardLabel">TOTAL · ${(pricedTokens / totalTokens * 100).toFixed(0)}% PRICED</text>
    <path d="M732 192 H924" stroke="${theme.border}"/>
    <text x="732" y="215" class="tiny">PEAK ${formatTokens(peak.tokens)} · ${formatShortDate(peak.date)}</text>
  </g>

  <g>${cubeMarkup(theme)}</g>
  ${monthLabels.join("")}
  ${renderBadge(694, 344, "gpt-6-astra", "left")}
  ${renderBadge(752, 383, "glm-5.3", "right")}
  ${renderBadge(582, 325, "claude-fable-5.1", "left")}
  <g transform="translate(760 482)"><text x="0" y="4" class="tiny">LOW</text><rect x="34" y="-5" width="132" height="9" rx="4.5" fill="url(#barGradient)"/><text x="174" y="4" class="tiny">HIGH</text></g>

  <g filter="url(#shadow)">
    <rect x="34" y="520" width="912" height="238" rx="16" fill="${theme.card}" stroke="${theme.border}"/>
    <text x="54" y="550" class="section">TOP 5 MODEL COST</text>
    <text x="370" y="550" class="header">TOKENS</text>
    <text x="480" y="550" class="header">COST WEIGHT</text>
    <text x="926" y="550" text-anchor="end" class="header">TOTAL</text>
    ${renderRows(costs.slice(0, 5))}
  </g>
</svg>`;
};

const lightSvg = renderSvg("light");
const darkSvg = renderSvg("dark");
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDirectory, "token-stats-light.svg"), lightSvg),
  writeFile(resolve(outputDirectory, "token-stats-dark.svg"), darkSvg),
]);

const cacheKey = createHash("sha256").update(lightSvg).update(darkSvg).digest("hex").slice(0, 12);
const readmePath = resolve(repositoryRoot, "README.md");
const readme = await readFile(readmePath, "utf8");
const updatedReadme = readme.replace(/(assets\/token-stats-(?:dark|light)\.svg)\?v=[a-f0-9]+/g, `$1?v=${cacheKey}`);
await writeFile(readmePath, updatedReadme);

console.log(JSON.stringify({
  period: { start: startDate, end: endDate },
  totalTokens,
  activeDays,
  longestStreak,
  peak,
  totalCost: Number(totalCost.toFixed(2)),
  coveragePercent: Number((pricedTokens / totalTokens * 100).toFixed(4)),
  topFive: costs.slice(0, 5).map((row) => ({ ...row, cost: Number(row.cost.toFixed(2)) })),
  cacheKey,
}, null, 2));
