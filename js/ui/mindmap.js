// js/ui/mindmap.js
// Lightweight custom canvas-based force-directed graph — no D3 dependency.
// Chosen over D3 because the whole point of this app is a small, dependency-
// light static bundle; a basic spring/repulsion simulation is ~80 lines and
// is plenty for the "tens to low hundreds of notes" scale this needs to
// handle (see brief Goal 4). Nodes are notes, edges are similarity links
// from engine.buildMindMapEdges().

const PALETTE = [
  '#4f7fef', '#e0865a', '#5fb894', '#b473e0', '#e0567a',
  '#4fb0d6', '#c9a23e', '#7a8cd6', '#5ec2a0', '#d67a9a',
];

export function categoryColor(category) {
  const key = (category || 'uncategorized').toLowerCase();
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export class MindMap {
  constructor(canvas, { onNodeClick } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onNodeClick = onNodeClick;
    this.nodes = [];
    this.edges = [];
    this.running = false;
    this.hoverId = null;
    this.dpr = Math.max(1, window.devicePixelRatio || 1);

    this._onClick = this._handleClick.bind(this);
    this._onMove = this._handleMove.bind(this);
    canvas.addEventListener('click', this._onClick);
    canvas.addEventListener('mousemove', this._onMove);
    canvas.addEventListener('mouseleave', () => { this.hoverId = null; });
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = rect.width * this.dpr;
    this.canvas.height = rect.height * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /**
   * @param {Array<{id:string, content:string, category:string}>} notes
   * @param {Array<{a:string, b:string, score:number}>} edges
   */
  setData(notes, edges) {
    this.resize();
    const existing = new Map(this.nodes.map((n) => [n.id, n]));
    this.nodes = notes.map((note, i) => {
      const prev = existing.get(note.id);
      const angle = (i / Math.max(notes.length, 1)) * Math.PI * 2;
      const r = Math.min(this.width, this.height) * 0.28;
      return {
        id: note.id,
        label: note.content.slice(0, 60),
        category: note.category,
        x: prev ? prev.x : this.width / 2 + Math.cos(angle) * r + (Math.random() - 0.5) * 20,
        y: prev ? prev.y : this.height / 2 + Math.sin(angle) * r + (Math.random() - 0.5) * 20,
        vx: 0, vy: 0,
      };
    });
    this.edges = edges.filter((e) => existing.has(e.a) || true); // keep all; missing nodes filtered at render
    this._settleFrames = 260;
    this.start();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._loop();
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  destroy() {
    this.stop();
    this.canvas.removeEventListener('click', this._onClick);
    this.canvas.removeEventListener('mousemove', this._onMove);
  }

  _loop() {
    if (!this.running) return;
    if (this._settleFrames > 0) {
      this._tick();
      this._settleFrames--;
    }
    this._render();
    this._raf = requestAnimationFrame(() => this._loop());
  }

  _tick() {
    const nodes = this.nodes;
    const n = nodes.length;
    if (n === 0) return;
    const cx = this.width / 2, cy = this.height / 2;
    const REPEL = 2600;
    const SPRING = 0.02;
    const SPRING_LEN = Math.min(this.width, this.height) * 0.22;
    const CENTER = 0.0025;
    const DAMPING = 0.82;

    // repulsion (O(n^2) — fine for tens to low hundreds of notes)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let distSq = dx * dx + dy * dy || 0.01;
        const dist = Math.sqrt(distSq);
        const force = REPEL / distSq;
        const fx = (dx / dist) * force, fy = (dy / dist) * force;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
    }

    // spring attraction along edges
    const byId = new Map(nodes.map((nd) => [nd.id, nd]));
    for (const e of this.edges) {
      const a = byId.get(e.a), b = byId.get(e.b);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const stretch = dist - SPRING_LEN;
      const force = SPRING * stretch * (0.5 + e.score);
      const fx = (dx / dist) * force, fy = (dy / dist) * force;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }

    // gravity toward center + integrate + damping
    for (const node of nodes) {
      node.vx += (cx - node.x) * CENTER;
      node.vy += (cy - node.y) * CENTER;
      node.vx *= DAMPING;
      node.vy *= DAMPING;
      node.x += node.vx;
      node.y += node.vy;
      const pad = 24;
      node.x = Math.min(this.width - pad, Math.max(pad, node.x));
      node.y = Math.min(this.height - pad, Math.max(pad, node.y));
    }
  }

  _render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    if (this.nodes.length === 0) return;

    const byId = new Map(this.nodes.map((n) => [n.id, n]));
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
      (!document.documentElement.hasAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    const edgeColor = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(20,22,28,0.14)';
    const labelColor = isDark ? 'rgba(238,240,243,0.85)' : 'rgba(28,29,31,0.85)';

    ctx.lineWidth = 1;
    ctx.strokeStyle = edgeColor;
    for (const e of this.edges) {
      const a = byId.get(e.a), b = byId.get(e.b);
      if (!a || !b) continue;
      ctx.globalAlpha = Math.min(1, 0.25 + e.score);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const node of this.nodes) {
      const radius = node.id === this.hoverId ? 9 : 7;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = categoryColor(node.category);
      ctx.fill();
      if (node.id === this.hoverId) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = labelColor;
        ctx.stroke();
      }
    }

    if (this.hoverId) {
      const node = byId.get(this.hoverId);
      if (node) {
        ctx.font = '11px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = labelColor;
        ctx.fillText(node.label, node.x + 12, node.y - 12);
      }
    }
  }

  _nodeAt(px, py) {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      const dx = n.x - px, dy = n.y - py;
      if (dx * dx + dy * dy <= 12 * 12) return n;
    }
    return null;
  }

  _eventPos(evt) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  _handleClick(evt) {
    const { x, y } = this._eventPos(evt);
    const node = this._nodeAt(x, y);
    if (node && this.onNodeClick) this.onNodeClick(node.id);
  }

  _handleMove(evt) {
    const { x, y } = this._eventPos(evt);
    const node = this._nodeAt(x, y);
    const newHover = node ? node.id : null;
    if (newHover !== this.hoverId) {
      this.hoverId = newHover;
      this.canvas.style.cursor = node ? 'pointer' : 'grab';
    }
  }
}
