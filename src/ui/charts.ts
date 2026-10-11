export interface Series {
  values: number[];
  color: string;
  label: string;
  fill?: boolean;
}

/** Minimal crisp line chart drawn on a canvas (HiDPI aware). */
export function drawChart(canvas: HTMLCanvasElement, series: Series[], opts: { min?: number; max?: number; format?: (v: number) => string } = {}): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 300;
  const hgt = canvas.clientHeight || 120;
  if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
  if (canvas.height !== Math.round(hgt * dpr)) canvas.height = Math.round(hgt * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hgt);
  let lo = opts.min ?? Infinity;
  let hi = opts.max ?? -Infinity;
  for (const s of series) {
    for (const v of s.values) {
      if (opts.min === undefined) lo = Math.min(lo, v);
      if (opts.max === undefined) hi = Math.max(hi, v);
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0;
    hi = 1;
  }
  if (hi - lo < 1e-6) hi = lo + 1;
  const pad = { l: 4, r: 4, t: 8, b: 16 };
  const gw = w - pad.l - pad.r;
  const gh = hgt - pad.t - pad.b;
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  for (let k = 0; k <= 3; k++) {
    const y = pad.t + (gh * k) / 3 + 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(200,210,220,0.55)';
  ctx.font = '10px system-ui, sans-serif';
  const fmt = opts.format ?? ((v: number) => String(Math.round(v)));
  ctx.textAlign = 'right';
  ctx.fillText(fmt(hi), w - pad.r, pad.t + 9);
  ctx.fillText(fmt(lo), w - pad.r, hgt - 3);
  for (const s of series) {
    const n = s.values.length;
    if (n < 2) continue;
    const X = (i: number) => pad.l + (gw * i) / (n - 1);
    const Y = (v: number) => pad.t + gh - ((v - lo) / (hi - lo)) * gh;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = X(i), y = Y(s.values[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    if (s.fill) {
      ctx.lineTo(X(n - 1), pad.t + gh);
      ctx.lineTo(X(0), pad.t + gh);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + gh);
      grad.addColorStop(0, s.color.replace(')', ',0.28)').replace('rgb(', 'rgba('));
      grad.addColorStop(1, s.color.replace(')', ',0)').replace('rgb(', 'rgba('));
      ctx.fillStyle = grad;
      ctx.fill();
    }
  }
}
