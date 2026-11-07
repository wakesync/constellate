'use strict';
const promptField = document.querySelector('#setup-prompt');
if (promptField) {
  const setupURL = new URL('setup.html', window.location.href).href;
  promptField.value = `Review the Membrane setup notes at ${setupURL}. Check whether my agent can use the local MCP adapter. Explain what it can access and what my model will see. Do not install anything, change configuration, connect, request credentials, or send personal data without my explicit approval. Require a user-scoped revocable credential. Scoped personal onboarding is not available yet; stop if this requirement cannot be met. Use only synthetic data for a developer preview.`;
  document.querySelectorAll('#copy-setup, #copy-hero').forEach(button => {
    button.addEventListener('click', async () => {
      const statuses = document.querySelectorAll('#copy-status, #hero-status');
      try {
        await navigator.clipboard.writeText(promptField.value);
        statuses.forEach(status => status.textContent = 'Copied. Paste into your agent to review setup. Nothing is connected.');
        button.firstChild.textContent = 'Instructions copied ';
      } catch {
        const details = promptField.closest('details');
        if (details) details.open = true;
        promptField.focus();
        promptField.select();
        statuses.forEach(status => status.textContent = 'Clipboard unavailable. The brief is selected; copy it manually.');
      }
    });
  });
}

// Geometry adapted from React Bits Pro Wireframe Ball's dodecahedron seedPoints.
// Licensed local asset provenance is recorded in reports/MINIMAL-REDESIGN.md.
// Canvas renderer and selective-sharing diagram are specific to Membrane.
const canvas = document.querySelector('#swarm');
if (canvas) {
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const toggle = document.querySelector('#motion-toggle');
  let paused = reduced.matches, frame, elapsed = 0, previous = 0;
  const gold = (1 + Math.sqrt(5)) / 2, vertices = [];
  for (let x = -1; x <= 1; x += 2)
    for (let y = -1; y <= 1; y += 2)
      for (let z = -1; z <= 1; z += 2) vertices.push([x, y, z]);
  for (let a = -1; a <= 1; a += 2)
    for (let b = -1; b <= 1; b += 2) {
      vertices.push([0, a / gold, b * gold]);
      vertices.push([a / gold, b * gold, 0]);
      vertices.push([a * gold, 0, b / gold]);
    }
  const edges = [];
  vertices.forEach((a, i) => vertices.forEach((b, j) => {
    if (j > i && Math.hypot(...a.map((v, k) => v - b[k])) < 1.3) edges.push([i, j]);
  }));
  function draw(time) {
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const nodes = [[w * .28, h * .5, w * .16], [w * .77, h * .38, w * .105], [w * .7, h * .76, w * .07]];
    const line = (x, y, xx, yy, color) => {ctx.strokeStyle = color; ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(xx,yy);ctx.stroke();};
    const bead = (x,y,r,color) => {ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();};
    // Only the permitted bridge carries signals; internal nodes remain inside their scope.
    [[1, .27],[2, .69]].forEach(([index, offset]) => {
      const a = nodes[0], b = nodes[index], dx=b[0]-a[0], dy=b[1]-a[1], dist=Math.hypot(dx,dy);
      const start=[a[0]+dx/dist*a[2]*1.5,a[1]+dy/dist*a[2]*1.5];
      const end=[b[0]-dx/dist*b[2]*1.5,b[1]-dy/dist*b[2]*1.5];
      line(...start,...end,'#52695b');
      const t=(time*.00009+offset)%1;
      bead(start[0]+(end[0]-start[0])*t,start[1]+(end[1]-start[1])*t,2,'#cee6d7');
      const mx=(start[0]+end[0])/2,my=(start[1]+end[1])/2;
      ctx.strokeStyle='#bddbc8';ctx.strokeRect(mx-3,my-3,6,6);
    });
    nodes.forEach(([cx,cy,r], index) => {
      const angle=time*.00007+index*1.8, c=Math.cos(angle), s=Math.sin(angle);
      const pts=vertices.map(([x,y,z]) => {const rx=x*c-z*s, rz=x*s+z*c;return [cx+rx*r*.71,cy+(y*.91-rz*.4)*r*.71,rz];});
      ctx.setLineDash([2,5]);ctx.strokeStyle='#435449';ctx.beginPath();ctx.arc(cx,cy,r*1.5,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
      edges.forEach(([a,b]) => line(pts[a][0],pts[a][1],pts[b][0],pts[b][1],`rgba(168,202,180,${.19+(pts[a][2]+2)*.07})`));
      pts.forEach(([x,y,z])=>bead(x,y,z>0?1.8:1.1,z>0?'#bddbc8':'#586e60'));
      bead(cx,cy,3,'#d1e4d8');
      for(let i=0;i<9;i++){
        const theta=i*2.4+angle*.45, radius=r*(.18+(i%3)*.14);
        bead(cx+Math.cos(theta)*radius,cy+Math.sin(theta)*radius,.8,'#779282');
      }
    });
  }
  function animate(timestamp) {
    if (previous) elapsed += Math.min(timestamp - previous, 50);
    previous=timestamp;draw(elapsed);
    if (!paused && !document.hidden) frame=requestAnimationFrame(animate);
  }
  function sync() {
    cancelAnimationFrame(frame);previous=0;
    toggle.textContent=paused?'Play motion':'Pause motion';toggle.setAttribute('aria-pressed',String(paused));
    draw(elapsed);if(!paused&&!document.hidden)frame=requestAnimationFrame(animate);
  }
  toggle.addEventListener('click',()=>{paused=!paused;sync();});
  reduced.addEventListener('change',()=>{paused=reduced.matches;sync();});
  document.addEventListener('visibilitychange',sync);
  new ResizeObserver(()=>draw(elapsed)).observe(canvas);
  sync();
}
