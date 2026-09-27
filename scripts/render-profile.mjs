// Shared visual language from jackie-cqz.github.io: paper, ink, and terracotta.
const palettes = {
  light: {
    background: '#f8f7f3', paper: '#fdfcf9', ink: '#292c26', muted: '#696d63',
    line: '#dcddd3', surface: '#eeeee5', accent: '#b74122', orange: '#e76a42',
    heat: ['#eeeee5', '#eddbcd', '#dcaf92', '#cd7955', '#b74122'],
  },
  dark: {
    background: '#1b1e1b', paper: '#22261f', ink: '#eeeee4', muted: '#afb2a5',
    line: '#3b4136', surface: '#272d23', accent: '#fa9975', orange: '#e77a50',
    heat: ['#272d23', '#564338', '#8d5a43', '#c47a55', '#fa9975'],
  },
};

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const mono = 'Consolas, &quot;Liberation Mono&quot;, monospace';
const sans = '&quot;Segoe UI&quot;, Arial, sans-serif';
const serif = 'Georgia, &quot;Times New Roman&quot;, serif';
const dateObject = value => new Date(`${value}T00:00:00Z`);
const dateLabel = value => dateObject(value).toLocaleDateString('en-US', {day:'numeric', month:'short', timeZone:'UTC'});
const fullDateLabel = value => dateObject(value).toLocaleDateString('en-US', {day:'numeric', month:'short', year:'numeric', timeZone:'UTC'});
const tokensLabel = value => {
  if (value >= 1e9) return `${(value / 1e9).toFixed(value >= 1e10 ? 1 : 2).replace(/\.0$/, '')}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return value.toLocaleString('en-US');
};
const moneyLabel = value => value >= 1000 ? `$${(value / 1000).toFixed(1).replace(/\.0$/, '')}K` : `$${Math.round(value).toLocaleString('en-US')}`;
const names = {
  'glm-5.3': 'GLM 5.3',
  'claude-opus-5-5': 'Claude Opus 5.5',
  'gpt-5.6-sol': 'GPT-5.6 Sol',
  'gpt-6-astra': 'GPT-6 Astra',
  'claude-fable-5-1': 'Claude Fable 5.1',
};

function star(cx, cy, radius, color) {
  return `<g stroke="${color}" stroke-width="1.6">${Array.from({length:4}, (_,i) => {
    const angle = Math.PI * i / 4;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    return `<line x1="${cx-x}" y1="${cy-y}" x2="${cx+x}" y2="${cy+y}"/>`;
  }).join('')}</g>`;
}

export function renderProfileHeader(mode) {
  const p = palettes[mode];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="980" height="256" viewBox="0 0 980 256" role="img" aria-labelledby="title description">
  <title id="title">Hello, I'm jackie-cqz.</title>
  <desc id="description">AI systems, autonomous agents, and privacy-preserving machine learning. Building things. Taking notes. Following the interesting questions.</desc>
  <rect width="980" height="256" rx="3" fill="${p.background}"/>
  <text x="35" y="55" font-family="${serif}" font-size="53" font-style="italic" fill="${p.ink}">j<tspan fill="${p.accent}">.</tspan></text>
  <text x="88" y="33" font-family="${mono}" font-size="14" font-weight="600" fill="${p.ink}">jackie-cqz</text>
  <text x="88" y="52" font-family="${mono}" font-size="8.5" letter-spacing="1.5" fill="${p.muted}">FIELD NOTES ON SOFTWARE &amp; AI</text>
  <text x="944" y="39" font-family="${mono}" font-size="10" text-anchor="end" fill="${p.muted}">jackie-cqz.github.io ↗</text>
  <line x1="36" y1="77" x2="944" y2="77" stroke="${p.line}"/>
  <circle cx="40" cy="113" r="3" fill="${p.orange}"/>
  <text x="54" y="116" font-family="${mono}" font-size="9" letter-spacing="1.4" fill="${p.muted}">AI SYSTEMS / AUTONOMOUS AGENTS</text>
  <text x="36" y="180" font-family="${serif}" font-size="58" letter-spacing="-2" fill="${p.ink}">Hello, I'm jackie-cqz<tspan fill="${p.accent}">.</tspan></text>
  <text x="38" y="215" font-family="${sans}" font-size="15" fill="${p.muted}">Building things. Taking notes. Following the interesting questions.</text>
  ${star(890, 166, 32, p.accent)}
</svg>`.replace(/[ \t]+$/gm, '');
}

function activityForest(summary, p) {
  const first = dateObject(summary.startDate);
  const offset = (first.getUTCDay() + 6) % 7;
  const firstMonday = new Date(first.getTime() - offset * 86400000);
  const columns = Math.ceil((summary.dateRange.length + offset) / 7);
  const stepX = Math.min(18, 650 / Math.max(1, columns - 1));
  const stepY = Math.min(6, 210 / Math.max(1, columns - 1));
  const maximum = Math.max(...summary.dailyTotals.values());
  const shapes = [];
  const labels = [];
  const darken = (hex, amount) => {
    const color = hex.slice(1).match(/../g).map(value => parseInt(value,16));
    const shadow = [27,30,27];
    return '#' + color.map((value,index) => Math.round(value*(1-amount)+shadow[index]*amount).toString(16).padStart(2,'0')).join('');
  };
  let previousMonth = '';
  for (let week=0; week<columns; week++) {
    const monday = new Date(firstMonday.getTime() + week*7*86400000);
    const month = monday.toLocaleDateString('en-US', {month:'short', timeZone:'UTC'});
    if (month !== previousMonth) {
      if (week > 0 || first.getUTCDate() <= 15) {
        labels.push(`<text x="${176+week*stepX}" y="${348+week*stepY}" class="meta">${month}</text>`);
      }
      previousMonth = month;
    }
    for (let day=0; day<7; day++) {
      const date = new Date(monday.getTime()+day*86400000).toISOString().slice(0,10);
      if (date < summary.startDate || date > summary.endDate) continue;
      const value = summary.dailyTotals.get(date) || 0;
      const x = 244+week*stepX-day*10;
      const y = 284+week*stepY+day*7;
      const title = `<title>${date}: ${value.toLocaleString('en-US')} tokens</title>`;
      if (value === 0) {
        shapes.push({y,x,markup:`<g class="activity-day" data-date="${date}">${title}<polygon points="${x},${y-5} ${x+9},${y} ${x},${y+5} ${x-9},${y}" fill="${p.surface}" stroke="${p.line}" stroke-width=".5"/></g>`});
        continue;
      }
      const intensity = Math.sqrt(value/maximum);
      const height = 8+intensity*76;
      const level = Math.min(4,1+Math.floor(intensity*3.999));
      const top = p.heat[level];
      shapes.push({y,x,markup:`<g class="activity-day" data-date="${date}">${title}
        <polygon points="${x-9},${y-height} ${x},${y-height+5} ${x},${y+5} ${x-9},${y}" fill="${darken(top,.16)}"/>
        <polygon points="${x},${y-height+5} ${x+9},${y-height} ${x+9},${y} ${x},${y+5}" fill="${darken(top,.34)}"/>
        <polygon points="${x},${y-height-5} ${x+9},${y-height} ${x},${y-height+5} ${x-9},${y-height}" fill="${top}"/>
      </g>`});
    }
  }
  shapes.sort((left,right)=>left.y-right.y || left.x-right.x);
  return shapes.map(shape=>shape.markup).join('')+labels.join('');
}

export function renderTokenStats(summary, mode) {
  const p = palettes[mode];
  const top = summary.costs.slice(0,5);
  const maximum = top[0]?.cost || 1;
  const rows = top.map((row,index) => {
    const y = 708+index*36;
    return `<g>
      <text x="36" y="${y}" class="rank">${String(index+1).padStart(2,'0')}</text>
      <text x="78" y="${y}" class="model">${escape(names[row.model] || row.model)}</text>
      <text x="492" y="${y}" text-anchor="end" class="number">${tokensLabel(row.tokens)}</text>
      <rect x="544" y="${y-8}" width="250" height="4" fill="${p.surface}"/>
      <rect x="544" y="${y-8}" width="${(250*row.cost/maximum).toFixed(2)}" height="4" fill="${p.accent}" opacity="${1-index*.13}"/>
      <text x="944" y="${y}" text-anchor="end" class="cost">${moneyLabel(row.cost)}</text>
      ${index<4 ? `<line x1="36" y1="${y+15}" x2="944" y2="${y+15}" stroke="${p.line}"/>` : ''}
    </g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="980" height="930" viewBox="0 0 980 930" font-family="${sans}" role="img" aria-labelledby="title description">
  <title id="title">Vibe Coding Stats — jackie-cqz</title>
  <desc id="description">${tokensLabel(summary.totalTokens)} tokens from ${summary.startDate} to ${summary.endDate}. Daily usage is shown as an isometric forest of columns, with taller columns for higher usage. Total cost ${moneyLabel(summary.totalCost)}. ${summary.activeDays} active days, longest streak ${summary.longestStreak} days. Top five models ranked by cost.</desc>
  <style>
    text {fill:${p.ink};}
    .meta {font-family:${mono};font-size:10px;fill:${p.muted};}
    .eyebrow {font-family:${mono};font-size:10px;letter-spacing:1.3px;fill:${p.muted};}
    .label {font-family:${mono};font-size:9px;letter-spacing:1.1px;fill:${p.muted};}
    .metric {font-family:${serif};font-size:47px;letter-spacing:-1.7px;}
    .day {font-family:${mono};font-size:8px;fill:${p.muted};}
    .rank {font-family:${mono};font-size:10px;fill:${p.accent};}
    .model {font-size:14px;font-weight:500;}
    .number {font-family:${mono};font-size:12px;fill:${p.muted};}
    .cost {font-family:${mono};font-size:13px;font-weight:600;}
  </style>
  <rect width="980" height="930" rx="3" fill="${p.background}"/>
  <circle cx="40" cy="37" r="3" fill="${p.orange}"/>
  <text x="54" y="40" class="eyebrow">01 / ACTIVITY LOG</text>
  <text x="944" y="40" text-anchor="end" class="meta">${fullDateLabel(summary.endDate).toUpperCase()}</text>
  <text x="36" y="94" font-family="${serif}" font-size="40" letter-spacing="-1">Vibe Coding Stats<tspan fill="${p.accent}">.</tspan></text>
  <text x="944" y="91" text-anchor="end" class="meta">CODEX + MODEL ACTIVITY</text>
  <line x1="36" y1="115" x2="944" y2="115" stroke="${p.line}"/>

  <text x="36" y="144" class="label">CUMULATIVE TOKENS</text>
  <text x="34" y="200" font-family="${serif}" font-size="66" letter-spacing="-2.5">${tokensLabel(summary.totalTokens)}</text>
  <line x1="316" y1="136" x2="316" y2="211" stroke="${p.line}"/>
  <text x="348" y="144" class="label">TOTAL COST</text>
  <text x="346" y="196" class="metric">${moneyLabel(summary.totalCost)}</text>
  <line x1="618" y1="136" x2="618" y2="211" stroke="${p.line}"/>
  <text x="644" y="144" class="label">ACTIVE DAYS</text>
  <text x="642" y="196" class="metric">${summary.activeDays}</text>
  <line x1="790" y1="136" x2="790" y2="211" stroke="${p.line}"/>
  <text x="820" y="144" class="label">LONGEST STREAK</text>
  <text x="818" y="196" class="metric">${summary.longestStreak}d</text>
  <line x1="36" y1="229" x2="944" y2="229" stroke="${p.line}"/>

  <text x="36" y="251" class="label">DAILY TOKEN ACTIVITY</text>
  <text x="944" y="251" text-anchor="end" class="meta">PEAK ${tokensLabel(summary.peak.tokens)} · ${dateLabel(summary.peak.date).toUpperCase()}</text>
  ${activityForest(summary,p)}
  <text x="70" y="569" class="meta">${dateLabel(summary.startDate)} — ${fullDateLabel(summary.endDate)}</text>
  <text x="753" y="569" class="meta">LOW</text>
  ${p.heat.map((color,i)=>`<rect x="${787+i*23}" y="559" width="17" height="11" rx="1" fill="${color}"/>`).join('')}
  <text x="944" y="569" text-anchor="end" class="meta">HIGH</text>
  <line x1="36" y1="590" x2="944" y2="590" stroke="${p.line}"/>

  <text x="36" y="618" class="eyebrow">MODEL LEDGER</text>
  <text x="36" y="651" font-family="${serif}" font-size="29" letter-spacing="-.4">Where the tokens went<tspan fill="${p.accent}">.</tspan></text>
  <text x="944" y="648" text-anchor="end" class="meta">TOP 5 / RANKED BY COST</text>
  <text x="78" y="679" class="label">MODEL</text>
  <text x="492" y="679" text-anchor="end" class="label">TOKENS</text>
  <text x="544" y="679" class="label">RELATIVE COST</text>
  <text x="944" y="679" text-anchor="end" class="label">TOTAL</text>
  ${rows}
  <line x1="36" y1="885" x2="944" y2="885" stroke="${p.line}"/>
  <text x="36" y="912" class="meta">jackie-cqz<tspan fill="${p.accent}">.</tspan></text>
  <text x="944" y="912" text-anchor="end" class="meta">An engineering notebook, in numbers.</text>
</svg>`.replace(/[ \t]+$/gm, '');
}
