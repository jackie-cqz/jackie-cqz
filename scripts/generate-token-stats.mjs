import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderProfileHeader, renderTokenStats } from "./render-profile.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const dataDirectory = resolve(repositoryRoot, "data");
const outputDirectory = resolve(repositoryRoot, "assets");

const baselinePath = resolve(dataDirectory, "token-activity-through-2026-08-29.csv");
const updatePath = resolve(dataDirectory, "token-activity-update-2026-09-22.csv");
const codexPath = resolve(dataDirectory, "codex-token-activity-2026-09-22.csv");
const latestUpdatePath = resolve(dataDirectory, "token-activity-update-2026-10-27.csv");
const latestCodexPath = resolve(dataDirectory, "codex-token-activity-2026-10-27.csv");
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
  const tokens = Math.round(Number(match[1]) * (multipliers[(match[2] || "").toUpperCase()] || 1));
  if (!Number.isSafeInteger(tokens)) throw new Error(`Unsafe token count: ${raw}`);
  return tokens;
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
const latestUpdateRows = parseCsv(await readFile(latestUpdatePath, "utf8"));
const latestCodexRows = parseCsv(await readFile(latestCodexPath, "utf8"));
const pricing = JSON.parse(await readFile(pricingPath, "utf8"));

// Each new export replaces its covered dates, rather than adding a second copy.
const replaceFrom = (previous, latest) => {
  if (latest.length === 0) throw new Error("The replacement export is empty");
  const seen = new Set();
  for (const row of latest) {
    const key = `${row.date}/${row.model}`;
    if (seen.has(key)) throw new Error(`Duplicate export record: ${key}`);
    seen.add(key);
  }
  const firstDate = latest.map((row) => row.date).sort()[0];
  return [...previous.filter((row) => row.date < firstDate), ...latest];
};
const mergedUpdateRows = replaceFrom(updateRows, latestUpdateRows);
const mergedCodexRows = replaceFrom(codexRows, latestCodexRows);

const activity = [];
for (const row of baselineRows) {
  for (const [model, rawTokens] of Object.entries(row)) {
    if (model === "date") continue;
    const tokens = Number(rawTokens || 0);
    if (tokens > 0) activity.push({ date: row.date, model: normalizeModel(model), tokens });
  }
}
for (const row of [...mergedUpdateRows, ...mergedCodexRows]) {
  activity.push({ date: row.date, model: normalizeModel(row.model), tokens: parseTokenCount(row.tokens) });
}

const addToMap = (map, key, value) => map.set(key, (map.get(key) || 0) + value);
const dailyTotals = new Map();
const modelTotals = new Map();
for (const row of activity) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || new Date(`${row.date}T00:00:00Z`).toISOString().slice(0, 10) !== row.date) {
    throw new Error(`Invalid activity date: ${row.date}`);
  }
  addToMap(dailyTotals, row.date, row.tokens);
  addToMap(modelTotals, row.model, row.tokens);
}

const activityDates = [...dailyTotals.keys()].sort();
const startDate = activityDates[0];
const endDate = activityDates.at(-1);
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
  if (!rate) throw new Error(`Missing official model price: ${model}`);
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

const summary = { startDate, endDate, dateRange, dailyTotals, totalTokens, totalCost, activeDays, longestStreak, peak, costs };
const renderSvg = (mode) => renderTokenStats(summary, mode);

const lightSvg = renderSvg("light");
const darkSvg = renderSvg("dark");
const lightHeader = renderProfileHeader("light");
const darkHeader = renderProfileHeader("dark");
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDirectory, "token-stats-light.svg"), lightSvg),
  writeFile(resolve(outputDirectory, "token-stats-dark.svg"), darkSvg),
  writeFile(resolve(outputDirectory, "profile-header-light.svg"), lightHeader),
  writeFile(resolve(outputDirectory, "profile-header-dark.svg"), darkHeader),
]);

const cacheKey = createHash("sha256").update(lightSvg).update(darkSvg).digest("hex").slice(0, 12);
const headerCacheKey = createHash("sha256").update(lightHeader).update(darkHeader).digest("hex").slice(0, 12);
const readmePath = resolve(repositoryRoot, "README.md");
const readme = await readFile(readmePath, "utf8");
const updatedReadme = readme
  .replace(/(assets\/token-stats-(?:dark|light)\.svg)\?v=[a-f0-9]+/g, `$1?v=${cacheKey}`)
  .replace(/(assets\/profile-header-(?:dark|light)\.svg)\?v=[a-f0-9]+/g, `$1?v=${headerCacheKey}`);
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
