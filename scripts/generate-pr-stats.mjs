import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const configPath = resolve(repositoryRoot, "pr-stats.config.json");
const readmePath = resolve(repositoryRoot, "README.md");
const outputDirectory = resolve(repositoryRoot, "assets");
const config = JSON.parse(await readFile(configPath, "utf8"));

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "jackie-cqz-profile-pr-stats",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function truncate(value, length) {
  const text = String(value);
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

function repositoryName(repositoryUrl) {
  return repositoryUrl.split("/repos/").at(-1);
}

function pullRequestState(item) {
  if (item.pull_request?.merged_at) return "merged";
  return item.state === "open" ? "open" : "closed";
}

async function fetchPullRequests(username) {
  const pullRequests = [];
  const query = `is:pr author:${username}`;

  for (let page = 1; page <= 10; page += 1) {
    const url = new URL("https://api.github.com/search/issues");
    url.searchParams.set("q", query);
    url.searchParams.set("sort", "created");
    url.searchParams.set("order", "desc");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`GitHub API request failed (${response.status}): ${await response.text()}`);
    }

    const payload = await response.json();
    pullRequests.push(...payload.items);
    if (pullRequests.length >= payload.total_count || payload.items.length < 100) break;
  }

  return pullRequests.map((item) => ({
    number: item.number,
    title: item.title,
    url: item.html_url,
    repository: repositoryName(item.repository_url),
    state: pullRequestState(item),
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  }));
}

function filterPullRequests(pullRequests) {
  const states = new Set(config.states.map((state) => state.toLowerCase()));
  const included = new Set(config.includeRepositories.map((name) => name.toLowerCase()));
  const excluded = new Set(config.excludeRepositories.map((name) => name.toLowerCase()));
  const selected = new Set(config.selectedPullRequests.map((value) => value.toLowerCase()));

  return pullRequests.filter((pullRequest) => {
    const repository = pullRequest.repository.toLowerCase();
    const key = `${repository}#${pullRequest.number}`;
    const url = pullRequest.url.toLowerCase();

    if (!states.has(pullRequest.state)) return false;
    if (included.size > 0 && !included.has(repository)) return false;
    if (excluded.has(repository)) return false;
    if (selected.size > 0 && !selected.has(key) && !selected.has(url)) return false;
    return true;
  });
}

function monthBuckets(pullRequests, monthCount) {
  const now = new Date();
  const buckets = [];

  for (let offset = monthCount - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    buckets.push({
      key: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
      label: date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
      year: date.getUTCFullYear(),
      count: 0,
    });
  }

  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const pullRequest of pullRequests) {
    const date = new Date(pullRequest.createdAt);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    if (byKey.has(key)) byKey.get(key).count += 1;
  }

  return buckets;
}

function repositoryCounts(pullRequests) {
  const counts = new Map();
  for (const pullRequest of pullRequests) {
    counts.set(pullRequest.repository, (counts.get(pullRequest.repository) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

function cube(x, baseline, level, colors) {
  const size = 10;
  const height = 10;
  const y = baseline - level * height;
  return `
    <polygon points="${x},${y} ${x + size},${y - 5} ${x + size * 2},${y} ${x + size},${y + 5}" fill="${colors.cubeTop}"/>
    <polygon points="${x},${y} ${x + size},${y + 5} ${x + size},${y + height + 5} ${x},${y + height}" fill="${colors.cubeLeft}"/>
    <polygon points="${x + size},${y + 5} ${x + size * 2},${y} ${x + size * 2},${y + height} ${x + size},${y + height + 5}" fill="${colors.cubeRight}"/>`;
}

function renderSvg(pullRequests, theme) {
  const colors = theme === "dark"
    ? {
        background: "#0d1117", surface: "#161b22", surfaceMuted: "#11161d",
        border: "#30363d", text: "#f0f6fc", muted: "#8b949e", faint: "#484f58",
        accent: "#a371f7", accentSoft: "#6e40c9", open: "#3fb950", closed: "#8b949e",
        cubeTop: "#c29bff", cubeLeft: "#8250df", cubeRight: "#6e40c9",
      }
    : {
        background: "#ffffff", surface: "#ffffff", surfaceMuted: "#f6f8fa",
        border: "#d0d7de", text: "#1f2328", muted: "#656d76", faint: "#afb8c1",
        accent: "#8250df", accentSoft: "#a475f9", open: "#1a7f37", closed: "#8c959f",
        cubeTop: "#c7a7ff", cubeLeft: "#8957e5", cubeRight: "#6e40c9",
      };

  const total = pullRequests.length;
  const merged = pullRequests.filter((pullRequest) => pullRequest.state === "merged").length;
  const open = pullRequests.filter((pullRequest) => pullRequest.state === "open").length;
  const closed = total - merged - open;
  const repositories = repositoryCounts(pullRequests);
  const mergeRate = total === 0 ? 0 : Math.round((merged / total) * 100);
  const months = monthBuckets(pullRequests, config.months);
  const recent = [...pullRequests]
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
    .slice(0, config.maxItems);

  const rowHeight = 38;
  const listHeight = 72 + Math.max(recent.length, 1) * rowHeight;
  const height = 602 + listHeight;
  const statusColors = { merged: colors.accent, open: colors.open, closed: colors.closed };
  const monthWidth = 746 / Math.max(months.length, 1);
  const maxCount = Math.max(1, ...months.map((month) => month.count));

  const cubes = months.map((month, index) => {
    const levels = month.count === 0 ? 0 : Math.max(1, Math.round((month.count / maxCount) * 7));
    const x = 82 + index * monthWidth + monthWidth / 2 - 10;
    const blocks = Array.from({ length: levels }, (_, level) => cube(x, 382, level, colors)).join("");
    const year = index === 0 || month.year !== months[index - 1].year
      ? `<text x="${x + 10}" y="436" class="micro" text-anchor="middle">${month.year}</text>`
      : "";
    return `${blocks}
      <text x="${x + 10}" y="411" class="micro" text-anchor="middle">${month.label}</text>
      ${month.count > 0 ? `<text x="${x + 10}" y="${Math.max(285, 373 - levels * 10)}" class="count" text-anchor="middle">${month.count}</text>` : ""}
      ${year}`;
  }).join("");

  const topRepositories = repositories.slice(0, 4);
  const repositoryBadges = topRepositories.map((repository, index) => {
    const x = 42 + index * 202;
    return `<g transform="translate(${x},466)">
      <rect width="186" height="38" rx="9" fill="${colors.surfaceMuted}" stroke="${colors.border}"/>
      <circle cx="15" cy="19" r="4" fill="${colors.accent}"/>
      <text x="26" y="16" class="repo">${escapeXml(truncate(repository.name, 21))}</text>
      <text x="26" y="29" class="micro">${repository.count} pull request${repository.count === 1 ? "" : "s"}</text>
    </g>`;
  }).join("");

  const rows = recent.length > 0
    ? recent.map((pullRequest, index) => {
        const y = 594 + index * rowHeight;
        const stateLabel = pullRequest.state === "merged" ? "MERGED" : pullRequest.state.toUpperCase();
        const date = new Date(pullRequest.createdAt).toISOString().slice(0, 10);
        return `<g transform="translate(42,${y})">
          ${index > 0 ? `<line x1="0" y1="0" x2="816" y2="0" stroke="${colors.border}"/>` : ""}
          <circle cx="8" cy="19" r="4" fill="${statusColors[pullRequest.state]}"/>
          <text x="21" y="16" class="repo">${escapeXml(truncate(pullRequest.repository, 24))}</text>
          <text x="21" y="29" class="micro">#${pullRequest.number}</text>
          <text x="248" y="23" class="body">${escapeXml(truncate(pullRequest.title, 48))}</text>
          <text x="720" y="16" class="state" fill="${statusColors[pullRequest.state]}">${stateLabel}</text>
          <text x="720" y="29" class="micro">${date}</text>
        </g>`;
      }).join("")
    : `<text x="450" y="620" class="body" text-anchor="middle">No pull requests match the current selection.</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${height}" viewBox="0 0 900 ${height}" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(config.title)} for ${escapeXml(config.username)}</title>
  <desc id="description">A visual summary of ${total} GitHub pull requests across ${repositories.length} repositories.</desc>
  <style>
    text { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
    .eyebrow { font-size: 12px; font-weight: 700; letter-spacing: 2.2px; fill: ${colors.text}; }
    .title { font-size: 27px; font-weight: 750; fill: ${colors.accent}; }
    .subtitle { font-size: 11px; fill: ${colors.muted}; }
    .metric { font-size: 25px; font-weight: 750; fill: ${colors.text}; }
    .metric-label { font-size: 10px; fill: ${colors.muted}; }
    .section { font-size: 11px; font-weight: 700; letter-spacing: 1.4px; fill: ${colors.text}; }
    .body { font-size: 11px; fill: ${colors.text}; }
    .repo { font-size: 10px; font-weight: 650; fill: ${colors.text}; }
    .micro { font-size: 8px; fill: ${colors.muted}; }
    .count { font-size: 9px; font-weight: 700; fill: ${colors.accent}; }
    .state { font-size: 8px; font-weight: 700; letter-spacing: .7px; }
  </style>
  <rect width="900" height="${height}" rx="18" fill="${colors.background}"/>

  <text x="42" y="48" class="eyebrow">OPEN SOURCE · PULL REQUESTS</text>
  <text x="42" y="70" class="subtitle">${escapeXml(config.subtitle)} · @${escapeXml(config.username)}</text>
  <text x="858" y="52" class="title" text-anchor="end">${total} PR${total === 1 ? "" : "s"}</text>
  <text x="858" y="70" class="subtitle" text-anchor="end">${merged} merged · ${open} open · ${closed} closed</text>

  <g transform="translate(42,96)">
    <rect width="816" height="112" rx="12" fill="${colors.surface}" stroke="${colors.border}"/>
    <line x1="204" y1="20" x2="204" y2="92" stroke="${colors.border}"/>
    <line x1="408" y1="20" x2="408" y2="92" stroke="${colors.border}"/>
    <line x1="612" y1="20" x2="612" y2="92" stroke="${colors.border}"/>
    <text x="28" y="53" class="metric">${total}</text><text x="28" y="73" class="metric-label">SELECTED PRS</text>
    <text x="232" y="53" class="metric">${merged}</text><text x="232" y="73" class="metric-label">MERGED</text>
    <text x="436" y="53" class="metric">${repositories.length}</text><text x="436" y="73" class="metric-label">REPOSITORIES</text>
    <text x="640" y="53" class="metric">${mergeRate}%</text><text x="640" y="73" class="metric-label">MERGE RATE</text>
  </g>

  <text x="42" y="250" class="section">ACTIVITY · LAST ${config.months} MONTHS</text>
  <text x="858" y="250" class="subtitle" text-anchor="end">Each column is scaled to the busiest month</text>
  <g>
    <line x1="60" y1="397" x2="840" y2="397" stroke="${colors.border}"/>
    ${cubes}
  </g>
  ${repositoryBadges}

  <text x="42" y="552" class="section">SELECTED PULL REQUESTS</text>
  <text x="858" y="552" class="subtitle" text-anchor="end">Configure selection in pr-stats.config.json</text>
  <g>
    <rect x="24" y="566" width="852" height="${listHeight}" rx="12" fill="${colors.surface}" stroke="${colors.border}"/>
    ${rows}
  </g>
  <text x="858" y="${height - 18}" class="micro" text-anchor="end">Updated ${new Date().toISOString().slice(0, 10)} · GitHub public data</text>
</svg>`.replace(/[ \t]+$/gm, "");
}

const allPullRequests = await fetchPullRequests(config.username);
const pullRequests = filterPullRequests(allPullRequests);
const lightSvg = renderSvg(pullRequests, "light");
const darkSvg = renderSvg(pullRequests, "dark");
const cacheKey = createHash("sha256")
  .update(lightSvg)
  .update(darkSvg)
  .digest("hex")
  .slice(0, 12);
const readme = await readFile(readmePath, "utf8");
const updatedReadme = readme.replace(
  /(\.\/assets\/pr-stats-(?:light|dark)\.svg)(?:\?v=[^"'\s<>]+)?/g,
  `$1?v=${cacheKey}`,
);

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDirectory, "pr-stats-light.svg"), lightSvg),
  writeFile(resolve(outputDirectory, "pr-stats-dark.svg"), darkSvg),
  writeFile(readmePath, updatedReadme),
]);

console.log(`Generated PR statistics for ${pullRequests.length} pull requests.`);
