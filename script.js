// ═══════════════════════════════════════════════════════
// RICART-AGRAWALA VISUALIZER — SCRIPT
// ═══════════════════════════════════════════════════════

// ── STATE ──────────────────────────────────────────────
let nodeCount = 4;
let nodes     = [];   // { id, x, y, ts, state, repliesGot, deferred[], pulsePhase }
let running   = false;
let speed     = 3;
let particles = [];
let totalMsgs = 0, totalReq = 0, totalRep = 0, totalDef = 0;
let csOrder   = [];
let replyMat  = [];   // replyMat[i][j] = 'wait' | 'got' | 'self' | 'idle'

const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');

// ── CANVAS STATE COLOURS ───────────────────────────────
const STATE_COLORS = {
  idle:    '#b8a98a',   // muted border tan
  wanting: '#8b2500',   // burnt rust
  waiting: '#1a5c4a',   // forest teal
  cs:      '#7a5c00',   // antique gold
  done:    '#1a3a5c',   // deep navy
};

// ═══════════════════════════════════════════════════════
// INIT / SETUP
// ═══════════════════════════════════════════════════════
window.onload = () => {
  resizeCanvas();
  window.addEventListener('resize', () => {
    resizeCanvas();
    buildNodes();
    renderNodeCards();
    renderMatrix();
    draw();
  });
  document.getElementById('speedSlider').oninput = e => speed = parseInt(e.target.value);
  reset();
  requestAnimationFrame(loop);
};

function resizeCanvas() {
  const area = document.querySelector('.center');
  canvas.width  = area.clientWidth;
  canvas.height = area.clientHeight;
}

function buildNodes() {
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;
  const r  = Math.min(W, H) * 0.33;

  // Preserve existing ts values when resizing; assign new unique ones only for new slots
  const existingTs = nodes.map(n => n.ts);
  const usedTs     = new Set(existingTs);

  let nextTs = 1;
  const freshTs = [];
  while (freshTs.length < nodeCount) {
    if (!usedTs.has(nextTs)) freshTs.push(nextTs);
    nextTs++;
  }

  nodes = Array.from({ length: nodeCount }, (_, i) => {
    const angle = (2 * Math.PI * i / nodeCount) - Math.PI / 2;
    const ts    = (i < existingTs.length)
      ? existingTs[i]
      : (freshTs[i - existingTs.length] ?? (i + 1));
    return {
      id: i + 1,
      ts,
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      state:      'idle',
      repliesGot: 0,
      deferred:   [],
      pulsePhase: Math.random() * Math.PI * 2,
    };
  });

  replyMat = Array.from({ length: nodeCount }, (_, i) =>
    Array.from({ length: nodeCount }, (_, j) => i === j ? 'self' : 'idle')
  );
}

function changeCount(d) {
  nodeCount = Math.max(2, Math.min(6, nodeCount + d));
  document.getElementById('countVal').textContent = nodeCount;
  reset();
}

function reset() {
  running   = false;
  particles = [];
  totalMsgs = totalReq = totalRep = totalDef = 0;
  csOrder   = [];

  // Preserve ts values the user may have edited — only reset sim state
  const savedTs = nodes.map(n => n.ts);
  buildNodes();
  nodes.forEach((n, i) => { if (savedTs[i] !== undefined) n.ts = savedTs[i]; });

  renderNodeCards();
  renderMatrix();
  clearLog();
  updateStats();
  updatePhase(-1);
  document.getElementById('runBtn').disabled = false;
  document.getElementById('csOrderDisplay').innerHTML =
    '<span class="cs-order-placeholder">CS order will appear here</span>';
  draw();
}

// ═══════════════════════════════════════════════════════
// LEFT PANEL RENDERING
// ═══════════════════════════════════════════════════════
function renderNodeCards() {
  const stateClass = {
    idle:    'nc-state-idle',
    wanting: 'nc-state-wanting',
    waiting: 'nc-state-waiting',
    cs:      'nc-state-cs',
    done:    'nc-state-done',
  };
  const badgeClass = {
    idle:    'badge-idle',
    wanting: 'badge-wanting',
    waiting: 'badge-waiting',
    cs:      'badge-cs',
    done:    'badge-done',
  };
  const badgeText = {
    idle:    'IDLE',
    wanting: 'WANTING',
    waiting: 'WAITING',
    cs:      'IN CS',
    done:    'DONE',
  };

  document.getElementById('nodeCards').innerHTML = nodes.map(n => `
    <div class="node-card ${stateClass[n.state] || 'nc-state-idle'}" id="nc-${n.id}">
      <span class="nc-id">P${n.id}</span>
      <div class="ts-input-wrap">
        <span class="ts-label">ts=</span>
        <input
          class="ts-input"
          id="ts-input-${n.id}"
          type="number"
          min="1" max="99"
          value="${n.ts}"
          ${running ? 'disabled' : ''}
          onchange="updateNodeTs(${n.id}, this.value)"
          oninput="updateNodeTs(${n.id}, this.value)"
          title="Edit timestamp for P${n.id}"
        />
      </div>
      <span class="nc-badge ${badgeClass[n.state] || 'badge-idle'}">${badgeText[n.state] || 'IDLE'}</span>
    </div>
  `).join('');

  checkDuplicateTs();
}

function updateNodeTs(nodeId, rawVal) {
  const val = parseInt(rawVal);
  if (isNaN(val) || val < 1) return;
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return;
  node.ts = Math.min(99, val);
  const inp = document.getElementById(`ts-input-${nodeId}`);
  if (inp) inp.value = node.ts;
  checkDuplicateTs();
  draw();
}

function checkDuplicateTs() {
  const tsVals  = nodes.map(n => n.ts);
  const hasDupe = tsVals.length !== new Set(tsVals).size;
  const dupEl   = document.getElementById('dupMsg');
  if (dupEl) dupEl.className = 'ts-dupe-msg' + (hasDupe ? ' show' : '');
  nodes.forEach(n => {
    const inp    = document.getElementById(`ts-input-${n.id}`);
    if (!inp) return;
    const isDupe = tsVals.filter(v => v === n.ts).length > 1;
    inp.className = 'ts-input' + (isDupe ? ' ts-warn' : '');
  });
}

function renderMatrix() {
  let html = '<tr><th></th>' + nodes.map(n => `<th>P${n.id}</th>`).join('') + '</tr>';
  nodes.forEach((row, i) => {
    html += `<tr><th>P${row.id}</th>`;
    nodes.forEach((col, j) => {
      const v   = replyMat[i][j];
      const cls = v === 'got'  ? 'got'  :
                  v === 'wait' ? 'wait' :
                  v === 'self' ? 'self' : '';
      const sym = v === 'got'  ? '●' :
                  v === 'wait' ? '◌' :
                  v === 'self' ? '—' : '·';
      html += `<td class="${cls}">${sym}</td>`;
    });
    html += '</tr>';
  });
  document.getElementById('replyMatrix').innerHTML = html;
}

// ═══════════════════════════════════════════════════════
// CANVAS DRAW
// ═══════════════════════════════════════════════════════
function loop() {
  draw();
  requestAnimationFrame(loop);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawEdges();
  drawNodes();
  drawParticles();
}

function drawEdges() {
  ctx.save();
  ctx.strokeStyle = 'rgba(180,160,130,0.4)';
  ctx.lineWidth   = 1;
  ctx.setLineDash([3, 8]);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      ctx.beginPath();
      ctx.moveTo(nodes[i].x, nodes[i].y);
      ctx.lineTo(nodes[j].x, nodes[j].y);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function drawNodes() {
  const t = Date.now() / 1000;
  nodes.forEach(n => {
    const col   = STATE_COLORS[n.state] || '#b8a98a';
    const pulse = Math.sin(t * 2 + n.pulsePhase) * 0.5 + 0.5;

    // Soft shadow halo for active states
    if (n.state !== 'idle') {
      const g = ctx.createRadialGradient(n.x, n.y, 18, n.x, n.y, 58);
      g.addColorStop(0, col + '28');
      g.addColorStop(1, 'rgba(245,240,232,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 58, 0, Math.PI * 2);
      ctx.fill();
    }

    // Pulsing ring when in CS
    if (n.state === 'cs') {
      ctx.strokeStyle = `rgba(200,150,10,${0.2 + pulse * 0.35})`;
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 40 + pulse * 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Rotating dashed ring when wanting / waiting
    if (n.state === 'wanting' || n.state === 'waiting') {
      ctx.save();
      ctx.translate(n.x, n.y);
      ctx.rotate(t * (n.state === 'wanting' ? 1.5 : 0.8));
      ctx.strokeStyle = col + '55';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, 36, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Node circle border
    ctx.strokeStyle = col;
    ctx.lineWidth   = n.state === 'cs' ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.arc(n.x, n.y, 28, 0, Math.PI * 2);
    ctx.stroke();

    // Node fill — warm white radial gradient
    const fill = ctx.createRadialGradient(n.x - 5, n.y - 6, 2, n.x, n.y, 28);
    fill.addColorStop(0, '#ffffff');
    fill.addColorStop(1, col + '18');
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(n.x, n.y, 28, 0, Math.PI * 2);
    ctx.fill();

    // Label: P{id}
    ctx.fillStyle    = col;
    ctx.font         = 'bold 13px "DM Mono"';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`P${n.id}`, n.x, n.y - 4);

    // Timestamp label below node id
    ctx.font      = '400 9px "DM Mono"';
    ctx.fillStyle = col + 'cc';
    ctx.fillText(`ts=${n.ts}`, n.x, n.y + 8);

    // State label below circle
    const stateStr = {
      idle:    '',
      wanting: '◉ WANT',
      waiting: '⏳ WAIT',
      cs:      '🔒 IN CS',
      done:    '✓ DONE',
    }[n.state] || '';
    if (stateStr) {
      ctx.font      = '500 9px "DM Mono"';
      ctx.fillStyle = col;
      ctx.fillText(stateStr, n.x, n.y + 44);
    }

    // Reply progress badge (waiting state only)
    if (n.state === 'waiting') {
      const total = nodeCount - 1;
      const bx = n.x + 22, by = n.y - 22;
      ctx.fillStyle   = '#fff';
      ctx.strokeStyle = '#1a5c4a88';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.roundRect(bx - 14, by - 8, 28, 16, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1a5c4a';
      ctx.font      = 'bold 9px "DM Mono"';
      ctx.textAlign = 'center';
      ctx.fillText(`${n.repliesGot}/${total}`, bx, by + 1);
    }
  });
}

function drawParticles() {
  const now = Date.now();
  particles = particles.filter(p => {
    const t2   = Math.min(1, (now - p.start) / p.dur);
    const ease = t2 < 0.5 ? 2 * t2 * t2 : -1 + (4 - 2 * t2) * t2;
    const x    = p.x + (p.tx - p.x) * ease;
    const y    = p.y + (p.ty - p.y) * ease;

    ctx.shadowBlur  = 6;
    ctx.shadowColor = 'rgba(0,0,0,0.18)';
    ctx.fillStyle   = p.color;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle    = p.color;
    ctx.font         = 'bold 8px "DM Mono"';
    ctx.textAlign    = 'center';
    ctx.fillText(p.label, x, y - 12);

    return t2 < 1;
  });
}

function spawnParticle(from, to, label, color) {
  const dur = Math.max(200, 800 / speed);
  particles.push({
    x: from.x, y: from.y,
    tx: to.x,  ty: to.y,
    label, color,
    start: Date.now(), dur,
  });
}

// ═══════════════════════════════════════════════════════
// LOG HELPERS
// ═══════════════════════════════════════════════════════
const logBody = document.getElementById('logBody');
function clearLog()  { logBody.innerHTML = ''; }
function scrollLog() { logBody.scrollTop = logBody.scrollHeight; }

function logPhase(label, type) {
  const el = document.createElement('div');
  el.className = `log-phase ph-${type}`;
  el.innerHTML = `
    <div class="log-phase-badge">PHASE — ${label}</div>
    <div class="log-phase-line"></div>`;
  logBody.appendChild(el);
  scrollLog();
}

function logRow(type, html) {
  const tags = {
    request:  'REQUEST',
    reply:    'REPLY',
    defer:    'DEFER',
    cs:       'CRITICAL SEC',
    release:  'RELEASE',
  };
  const el = document.createElement('div');
  el.className = `log-row row-${type}`;
  el.innerHTML = `
    <div class="log-tag">${tags[type] || type}</div>
    <div class="log-content">${html}</div>`;
  logBody.appendChild(el);
  scrollLog();
}

function logCSBanner(nodeId, repliesGot) {
  const el = document.createElement('div');
  el.className = 'cs-enter-banner';
  el.innerHTML = `
    <div class="cs-icon">🔒</div>
    <div class="cs-text">
      <strong>P${nodeId} ENTERS CRITICAL SECTION</strong><br>
      <span style="font-size:10px">Received all ${repliesGot} replies — no conflicts</span>
    </div>`;
  logBody.appendChild(el);
  scrollLog();
}

// Inline HTML helpers
function nd(id)  { return `<span class="nd">P${id}</span>`; }
function ndc(id) { return `<span class="nd-cyan">P${id}</span>`; }
function tsBadge(val, who, whoTs) {
  if (who === undefined) return `<span class="ts-badge">${val}</span>`;
  const cls = val < whoTs ? 'low' : val > whoTs ? 'high' : '';
  return `<span class="ts-badge ${cls}">ts=${val}</span>`;
}

// ── STATS / PHASE / CS ORDER ───────────────────────────
function updateStats() {
  document.getElementById('hMsgs').textContent    = totalMsgs;
  document.getElementById('hReplies').textContent = totalRep;
  document.getElementById('hDefers').textContent  = totalDef;
  document.getElementById('sumMsgs').textContent  = totalMsgs;
  document.getElementById('sumReq').textContent   = totalReq;
  document.getElementById('sumRep').textContent   = totalRep;
  document.getElementById('sumDef').textContent   = totalDef;
}

function updatePhase(active) {
  ['ph1', 'ph2', 'ph3', 'ph4'].forEach((id, i) => {
    const el = document.getElementById(id);
    el.className = 'phase-chip' +
      (i < active ? ' done' : i === active ? ' active' : '');
  });
}

function updateCSOrder() {
  if (csOrder.length === 0) return;
  const parts = csOrder.map(id => `<span class="cs-order-node">P${id}</span>`);
  document.getElementById('csOrderDisplay').innerHTML =
    '<span style="color:var(--ink-dim);font-size:9px">CS ORDER:</span> ' +
    parts.join('<span class="cs-arrow-small"> → </span>');
}

// ═══════════════════════════════════════════════════════
// ALGORITHM
// ═══════════════════════════════════════════════════════
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function delay()   { return sleep(Math.max(120, 900 / speed)); }
function short()   { return sleep(Math.max(60,  380 / speed)); }

async function run() {
  if (running) return;
  running = true;
  totalMsgs = totalReq = totalRep = totalDef = 0;
  csOrder = [];
  clearLog();
  updateStats();

  document.getElementById('runBtn').disabled = true;
  document.getElementById('csOrderDisplay').innerHTML =
    '<span class="cs-order-placeholder">Computing…</span>';

  // Disable ts inputs during simulation
  nodes.forEach(n => {
    const inp = document.getElementById(`ts-input-${n.id}`);
    if (inp) inp.disabled = true;
  });

  nodes.forEach(n => { n.state = 'idle'; n.repliesGot = 0; n.deferred = []; });
  replyMat = Array.from({ length: nodeCount }, (_, i) =>
    Array.from({ length: nodeCount }, (_, j) => i === j ? 'self' : 'idle')
  );
  renderNodeCards();
  renderMatrix();

  // ── PHASE 1: All nodes broadcast REQUEST ──────────────
  updatePhase(0);
  logPhase('All nodes broadcast REQUEST', 'request');
  await short();

  nodes.forEach(n => { n.state = 'wanting'; });
  renderNodeCards();
  draw();

  for (const sender of nodes) {
    for (const receiver of nodes) {
      if (receiver.id === sender.id) continue;
      spawnParticle(sender, receiver, `REQ(${sender.ts})`, '#8b2500');
      replyMat[sender.id - 1][receiver.id - 1] = 'wait';
      logRow('request',
        `${nd(sender.id)} ${tsBadge(sender.ts)} <span class="arrow-sym">──▶</span> ${ndc(receiver.id)}&nbsp;
         <span class="reason-chip">REQUEST to enter CS</span>`
      );
      totalMsgs++; totalReq++;
      updateStats();
      await short();
    }
  }

  renderMatrix();
  await delay();

  // ── PHASE 2: Each node replies or defers ──────────────
  updatePhase(1);
  logPhase('Nodes respond: REPLY or DEFER based on priority', 'reply');
  await short();

  // Sort by (ts, id) — lowest = highest priority = enters CS first
  const sortedByPriority = [...nodes].sort((a, b) =>
    a.ts !== b.ts ? a.ts - b.ts : a.id - b.id
  );

  for (const sender of nodes) { sender.state = 'waiting'; }
  renderNodeCards();
  draw();

  for (const receiver of nodes) {
    for (const sender  of nodes) {
      if (receiver.id === sender.id) continue;

      const receiverHasPriority =
        receiver.ts < sender.ts ||
        (receiver.ts === sender.ts && receiver.id < sender.id);

      if (receiverHasPriority) {
        receiver.deferred.push(sender.id);
        logRow('defer',
          `${nd(receiver.id)} ${tsBadge(receiver.ts, receiver, sender.ts)} DEFERS reply to ${ndc(sender.id)} ${tsBadge(sender.ts, sender, receiver.ts)}
           <span class="reason-chip">${receiver.ts} &lt; ${sender.ts} → P${receiver.id} has priority</span>`
        );
        replyMat[sender.id - 1][receiver.id - 1] = 'wait';
        totalDef++;
        updateStats();
        await short();
      } else {
        spawnParticle(receiver, sender, 'REPLY', '#1a5c4a');
        logRow('reply',
          `${ndc(receiver.id)} ${tsBadge(receiver.ts, receiver, sender.ts)} <span class="arrow-sym">──▶</span> ${nd(sender.id)} ${tsBadge(sender.ts, sender, receiver.ts)}
           <span class="reason-chip">not competing / lower priority</span>`
        );
        replyMat[sender.id - 1][receiver.id - 1] = 'got';
        sender.repliesGot++;
        totalMsgs++; totalRep++;
        updateStats();
        renderMatrix();
        renderNodeCards();
        await short();
      }
    }
  }

  renderMatrix();
  renderNodeCards();
  draw();
  await delay();

  // ── PHASE 3 & 4: Enter CS in priority order then release
  updatePhase(2);

  for (const winner of sortedByPriority) {
    const needed = nodeCount - 1;
    logPhase(`P${winner.id} enters CS (ts=${winner.ts})`, 'cs');
    winner.state = 'cs';
    renderNodeCards();
    draw();
    logCSBanner(winner.id, needed);
    csOrder.push(winner.id);
    updateCSOrder();
    await delay();

    updatePhase(3);
    winner.state = 'done';
    renderNodeCards();
    draw();
    logPhase(`P${winner.id} exits CS → sends deferred replies`, 'release');

    if (winner.deferred.length > 0) {
      for (const deferredId of winner.deferred) {
        const deferredNode = nodes.find(n => n.id === deferredId);
        spawnParticle(winner, deferredNode, 'REPLY', '#1a3a5c');
        replyMat[deferredId - 1][winner.id - 1] = 'got';
        deferredNode.repliesGot++;
        logRow('release',
          `${nd(winner.id)} <span class="arrow-sym">──▶</span> ${ndc(deferredId)}&nbsp;
           <span style="color:var(--accent)">DEFERRED REPLY</span>
           <span class="reason-chip">P${winner.id} done with CS</span>`
        );
        totalMsgs++; totalRep++;
        updateStats();
        renderMatrix();
        renderNodeCards();
        await short();
      }
    } else {
      logRow('release', `${nd(winner.id)} had no deferred replies to send`);
    }

    await delay();
  }

  // ── DONE ──────────────────────────────────────────────
  ['ph1', 'ph2', 'ph3', 'ph4'].forEach(id => {
    document.getElementById(id).className = 'phase-chip done';
  });

  const orderEl = document.createElement('div');
  orderEl.className = 'cs-order-banner';
  orderEl.innerHTML =
    `<span>★</span> CS Execution Order: ` +
    sortedByPriority
      .map(n => `<span class="cs-order-node">P${n.id}(ts=${n.ts})</span>`)
      .join('<span style="color:var(--ink-faint)"> → </span>');
  logBody.appendChild(orderEl);
  scrollLog();

  logRow('cs',
    `<span style="color:var(--teal)">✓ Mutual exclusion guaranteed — </span>
     no two nodes in CS simultaneously · ${totalMsgs} total messages · 2(n−1) = ${2 * (nodeCount - 1)} per entry`
  );

  // Re-enable inputs
  document.getElementById('runBtn').disabled = false;
  nodes.forEach(n => {
    const inp = document.getElementById(`ts-input-${n.id}`);
    if (inp) inp.disabled = false;
  });
  running = false;
}
