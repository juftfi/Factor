import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let CSS2DRenderer = null;
let CSS2DObject = null;
try {
  const r = await import('three/addons/renderers/CSS2DRenderer.js');
  CSS2DRenderer = r.CSS2DRenderer;
  CSS2DObject = r.CSS2DObject;
} catch (_) {}

let robotGltfData = null;
let skeletonClone = null;
try {
  const [{ GLTFLoader }, skUtils] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/utils/SkeletonUtils.js'),
  ]);
  skeletonClone = skUtils.clone;
  const loader = new GLTFLoader();
  const localRobot = 'models/RobotExpressive.glb';
  const remoteRobot =
    'https://threejs.org/examples/models/gltf/RobotExpressive/RobotExpressive.glb';
  const loadUrl = (url) =>
    new Promise((resolve, reject) => loader.load(url, resolve, null, reject));
  try {
    robotGltfData = await loadUrl(localRobot);
  } catch (e1) {
    console.warn('[factorAI] Local models/RobotExpressive.glb failed, trying CDN:', e1);
    try {
      robotGltfData = await loadUrl(remoteRobot);
    } catch (e2) {
      console.warn('[factorAI] RobotExpressive GLTF could not be loaded:', e2);
    }
  }
} catch (e) {
  console.warn('[factorAI] RobotExpressive GLTF could not be loaded:', e);
}

let abbKinematics = null;
let abbJointTime = 0;
try {
  const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js');
  const colladaLoader = new ColladaLoader();
  const collada = await new Promise((resolve, reject) =>
    colladaLoader.load(
      'https://threejs.org/examples/models/collada/abb_irb52_7_120.dae',
      resolve, null, reject
    )
  );
  const abbArm = collada.scene;
  abbKinematics = collada.kinematics;
  abbArm.scale.setScalar(1.4);
  abbArm.position.set(17.5, 0, -9);
  abbArm.rotation.set(-Math.PI / 2, 0, 0);
  abbArm.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      child.material = child.material.clone();
      child.material.color.set(0xc8cdd2);
      child.material.roughness = 0.45;
      child.material.metalness = 0.35;
    }
  });
  // abbArm se añade a la escena después de que scene esté definida
  abbArm.userData._pendingAdd = true;
  window._abbArm = abbArm;
} catch (e) {
  console.warn('[factorAI] ABB Collada could not be loaded:', e);
}

// --- Escena base ---
const GRASS_GREEN = 0x4f7a3a;
const scene = new THREE.Scene();
scene.background = new THREE.Color(GRASS_GREEN);
if (window._abbArm) { scene.add(window._abbArm); delete window._abbArm; }
const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;

let labelRenderer = null;
if (CSS2DRenderer) {
  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.left = '0';
  labelRenderer.domElement.style.width = '100%';
  labelRenderer.domElement.style.height = '100%';
  labelRenderer.domElement.style.pointerEvents = 'none';
  labelRenderer.domElement.style.background = 'transparent';
  labelRenderer.domElement.style.zIndex = '1';
  canvas.style.position = 'relative';
  canvas.style.zIndex = '0';
  document.body.appendChild(labelRenderer.domElement);
}

const NOAH_RSS_ENDPOINTS = [
  'https://api.rss2json.com/v1/api.json?rss_url=https://cointelegraph.com/rss',
  'https://api.rss2json.com/v1/api.json?rss_url=https://www.coindesk.com/arc/outboundfeeds/rss/',
  'https://api.rss2json.com/v1/api.json?rss_url=https://decrypt.co/feed',
];
let noahReportPanel = null;
let ethanSummaryPanel = null;
let researcherPanel = null;
let ethanLiveRefs = null;
let noahReportStylesInjected = false;
let meetingSummaryContainer = null;
const meetingFocus = {
  active: false,
  overlayShown: false,
  revealTimer: 0,
  orbitProgress: 0,
  orbitMax: 0.42,
  dismissed: false,
  prevZoom: null,
  prevTarget: new THREE.Vector3(),
};
const workFocus = {
  active: false,
  requested: false,
  orbitProgress: 0,
  orbitMax: 0.42,
  prevZoom: null,
  prevTarget: new THREE.Vector3(),
};
function getOpenAIApiKey() {
  const k = typeof window !== 'undefined' && window.OPENAI_API_KEY;
  return (k && String(k).trim()) ? String(k).trim() : '';
}

function ensureNoahReportStyles() {
  if (noahReportStylesInjected) return;
  const style = document.createElement('style');
  style.textContent = `
    .noah-report-panel {
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .noah-report-panel::-webkit-scrollbar {
      width: 0;
      height: 0;
      background: transparent;
    }
  `;
  document.head.appendChild(style);
  noahReportStylesInjected = true;
}

function ensureNoahReportPanel() {
  if (noahReportPanel) return noahReportPanel;
  ensureNoahReportStyles();
  const panel = document.createElement('div');
  panel.className = 'noah-report-panel rt-terminal-surface';
  panel.style.position = 'fixed';
  panel.style.right = '18px';
  panel.style.top = '70px';
  panel.style.width = 'min(420px, calc(100vw - 36px))';
  panel.style.maxHeight = '70vh';
  panel.style.overflow = 'auto';
  panel.style.padding = '14px 14px 12px 14px';
  panel.style.whiteSpace = 'pre-wrap';
  panel.style.zIndex = '20';
  panel.style.display = 'none';
  panel.style.pointerEvents = 'auto';
  document.body.appendChild(panel);
  noahReportPanel = panel;
  return panel;
}

function ensureEthanSummaryPanel() {
  if (ethanSummaryPanel) return ethanSummaryPanel;
  ensureNoahReportStyles();
  const panel = document.createElement('div');
  panel.className = 'noah-report-panel rt-terminal-surface';
  panel.style.position = 'fixed';
  panel.style.left = '18px';
  panel.style.top = '70px';
  panel.style.width = 'min(430px, calc(100vw - 36px))';
  panel.style.maxHeight = '82vh';
  panel.style.overflow = 'auto';
  panel.style.padding = '14px 14px 12px 14px';
  panel.style.zIndex = '20';
  panel.style.display = 'none';
  panel.style.pointerEvents = 'auto';
  document.body.appendChild(panel);
  ethanSummaryPanel = panel;
  return panel;
}

function hideEthanSummaryPanel() {
  if (!ethanSummaryPanel) return;
  ethanSummaryPanel.style.display = 'none';
  ethanSummaryPanel.innerHTML = '';
}

let chloeModalInjected = false;
function injectChloeModalStyles() {
  if (chloeModalInjected) return;
  chloeModalInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    @keyframes chloe-pulse {
      0%,100% { opacity:1; box-shadow:0 0 0 0 rgba(72,212,106,0.55); }
      50% { opacity:0.7; box-shadow:0 0 0 5px rgba(72,212,106,0); }
    }
    @keyframes chloe-fadein {
      from { opacity:0; transform:scale(0.97); }
      to   { opacity:1; transform:scale(1); }
    }
    @keyframes chloe-spin { to { transform:rotate(360deg); } }
    @keyframes chloe-skeleton { 0%,100% { opacity:0.3; } 50% { opacity:0.65; } }
    .chloe-dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:#48d46a; animation:chloe-pulse 1.8s ease-in-out infinite; }
    .chloe-browser-win { animation:chloe-fadein 0.2s ease both; }
    .chloe-result-row { border-bottom:1px solid rgba(255,255,255,0.06); padding:16px 0; cursor:pointer; }
    .chloe-result-row:last-child { border-bottom:none; }
    .chloe-result-row:hover .chloe-result-title { text-decoration:underline; }
    .chloe-go-btn:disabled { opacity:0.4; cursor:not-allowed; }
    .chloe-spinner { width:20px; height:20px; border:2.5px solid rgba(255,255,255,0.1); border-top-color:#4285f4; border-radius:50%; animation:chloe-spin 0.7s linear infinite; }
    .chloe-sk { border-radius:4px; background:rgba(255,255,255,0.07); animation:chloe-skeleton 1.2s ease infinite; }
    #chloe-search-box { caret-color:#fff; }
    #chloe-search-box::placeholder { color:#5f6368; }
  `;
  document.head.appendChild(s);
}

function showChloeResearchModal() {
  injectChloeModalStyles();
  const existing = document.getElementById('chloe-research-modal');
  if (existing) { existing.remove(); return; }

  const overlay = document.createElement('div');
  overlay.id = 'chloe-research-modal';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:50;background:rgba(0,0,0,0.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px;';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  // Main browser window
  const win = document.createElement('div');
  win.className = 'chloe-browser-win';
  win.style.cssText = 'width:min(1180px,98vw);height:min(880px,96vh);display:flex;flex-direction:column;background:#202124;border-radius:12px;overflow:hidden;box-shadow:0 28px 80px rgba(0,0,0,0.85),0 0 0 1px rgba(255,255,255,0.06);font-family:arial,sans-serif;color:#e8eaed;';

  // Title bar
  const titleBar = document.createElement('div');
  titleBar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 14px;background:#292a2d;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;user-select:none;';

  const lights = document.createElement('div');
  lights.style.cssText = 'display:flex;gap:6px;flex-shrink:0;margin-right:6px;';
  [['#ff5f57','close'],['#ffbd2e',''],['#28ca41','']].forEach(([bg, action]) => {
    const d = document.createElement('div');
    d.style.cssText = 'width:13px;height:13px;border-radius:50%;background:' + bg + ';cursor:pointer;flex-shrink:0;transition:filter 0.1s;';
    d.onmouseenter = () => { d.style.filter = 'brightness(0.75)'; };
    d.onmouseleave = () => { d.style.filter = ''; };
    if (action === 'close') d.onclick = () => overlay.remove();
    lights.appendChild(d);
  });
  titleBar.appendChild(lights);

  // Address bar (wide, Google style)
  const addrWrap = document.createElement('div');
  addrWrap.style.cssText = 'flex:1;display:flex;align-items:center;gap:8px;background:#35363a;border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:6px 14px;min-width:0;';
  const addrTxt = document.createElement('span');
  addrTxt.id = 'chloe-addr-txt';
  addrTxt.style.cssText = 'font:13px/1 arial,sans-serif;color:#8a8e94;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  addrTxt.textContent = 'scout-ressearch.ai';
  addrWrap.appendChild(addrTxt);
  titleBar.appendChild(addrWrap);

  // Live badges
  const badges = document.createElement('div');
  badges.style.cssText = 'display:flex;align-items:center;gap:10px;margin-left:10px;flex-shrink:0;';
  [['INTERNET','0s'],['CRYPTO','0.35s'],['REAL-TIME','0.7s']].forEach(([lbl, delay]) => {
    const b = document.createElement('div');
    b.style.cssText = 'display:flex;align-items:center;gap:5px;';
    const dot = document.createElement('span');
    dot.className = 'chloe-dot';
    dot.style.animationDelay = delay;
    const t = document.createElement('span');
    t.style.cssText = 'font:700 10px/1 arial,sans-serif;color:#34a853;letter-spacing:0.05em;';
    t.textContent = lbl;
    b.appendChild(dot);
    b.appendChild(t);
    badges.appendChild(b);
  });
  titleBar.appendChild(badges);
  win.appendChild(titleBar);

  // Nav toolbar
  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 14px;background:#292a2d;border-bottom:1px solid rgba(255,255,255,0.05);flex-shrink:0;';
  ['<','>',' ↻'].forEach((sym) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = sym;
    b.style.cssText = 'background:rgba(255,255,255,0.04);border:1px solid transparent;color:#9aa0a6;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background 0.12s;';
    b.onmouseenter = () => { b.style.background = 'rgba(255,255,255,0.09)'; };
    b.onmouseleave = () => { b.style.background = 'rgba(255,255,255,0.04)'; };
    toolbar.appendChild(b);
  });

  // Main search bar (Google-like, big and centered inside toolbar)
  const searchWrap = document.createElement('div');
  searchWrap.style.cssText = 'flex:1;display:flex;align-items:center;gap:10px;background:#35363a;border:1px solid rgba(255,255,255,0.08);border-radius:24px;padding:8px 16px;margin:0 8px;transition:border-color 0.2s,box-shadow 0.2s;';
  const searchIco = document.createElement('span');
  searchIco.style.cssText = 'color:#9aa0a6;font-size:18px;flex-shrink:0;line-height:1;';
  searchIco.textContent = 'S';
  searchIco.style.font = 'bold 14px arial';
  searchIco.style.color = '#4285f4';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.id = 'chloe-search-box';
  searchInput.placeholder = 'Search the full web in real time...';
  searchInput.autocomplete = 'off';
  searchInput.style.cssText = 'flex:1;border:none;background:transparent;color:#e8eaed;font:16px/1.4 arial,sans-serif;outline:none;';
  searchInput.onfocus = () => { searchWrap.style.borderColor = 'rgba(138,180,248,0.5)'; searchWrap.style.boxShadow = '0 0 0 3px rgba(138,180,248,0.08)'; };
  searchInput.onblur = () => { searchWrap.style.borderColor = 'rgba(255,255,255,0.08)'; searchWrap.style.boxShadow = 'none'; };
  searchWrap.appendChild(searchIco);
  searchWrap.appendChild(searchInput);
  toolbar.appendChild(searchWrap);

  const goBtn = document.createElement('button');
  goBtn.type = 'button'; goBtn.className = 'chloe-go-btn'; goBtn.textContent = 'Search';
  goBtn.style.cssText = 'padding:8px 20px;border-radius:20px;border:none;background:#4285f4;color:#fff;font:700 14px/1 arial,sans-serif;cursor:pointer;flex-shrink:0;transition:background 0.14s,transform 0.1s;';
  goBtn.onmouseenter = () => { goBtn.style.background = '#5a95f5'; goBtn.style.transform = 'translateY(-1px)'; };
  goBtn.onmouseleave = () => { goBtn.style.background = '#4285f4'; goBtn.style.transform = ''; };
  toolbar.appendChild(goBtn);
  win.appendChild(toolbar);

  // Content area
  const content = document.createElement('div');
  content.style.cssText = 'flex:1;overflow-y:auto;background:#202124;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.1) transparent;';

  // Landing page (Google-style new tab)
  const landing = document.createElement('div');
  landing.id = 'chloe-landing';
  landing.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:24px;padding:24px;';

  const brandRow = document.createElement('div');
  brandRow.style.cssText = 'font:bold 52px/1 arial,sans-serif;letter-spacing:-2px;';
  'SCOUT'.split('').forEach((ch, i) => {
    const colors = ['#4285f4','#ea4335','#fbbc05','#4285f4','#34a853'];
    const span = document.createElement('span');
    span.style.color = colors[i % colors.length];
    span.textContent = ch;
    brandRow.appendChild(span);
  });

  const subBrand = document.createElement('div');
  subBrand.style.cssText = 'font:400 16px/1 arial,sans-serif;color:#9aa0a6;letter-spacing:0.02em;';
  subBrand.textContent = 'Research Agent Connected to the full internet';

  const connLine = document.createElement('div');
  connLine.style.cssText = 'display:flex;align-items:center;gap:20px;';
  [['Internet','0s'],['Crypto Live','0.35s'],['Real-time Web','0.7s']].forEach(([lbl, delay]) => {
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:6px;';
    const dot = document.createElement('span'); dot.className = 'chloe-dot'; dot.style.animationDelay = delay;
    const t = document.createElement('span'); t.style.cssText = 'font:400 13px/1 arial,sans-serif;color:#5f6368;'; t.textContent = lbl;
    item.appendChild(dot); item.appendChild(t);
    connLine.appendChild(item);
  });

  landing.appendChild(brandRow);
  landing.appendChild(subBrand);
  landing.appendChild(connLine);
  content.appendChild(landing);
  win.appendChild(content);

  // Status bar
  const statusBar = document.createElement('div');
  statusBar.style.cssText = 'display:flex;align-items:center;padding:4px 16px;background:#292a2d;border-top:1px solid rgba(255,255,255,0.04);font:11px/1.8 arial,sans-serif;color:#5f6368;flex-shrink:0;gap:16px;';
  const sbStatus = document.createElement('span'); sbStatus.textContent = 'Ready';
  const sbRight = document.createElement('span'); sbRight.style.marginLeft = 'auto'; sbRight.textContent = 'Tavily Search API';
  statusBar.appendChild(sbStatus); statusBar.appendChild(sbRight);
  win.appendChild(statusBar);

  // Search logic
  const doSearch = async () => {
    const q = searchInput.value.trim();
    if (!q) { searchInput.focus(); return; }
    addrTxt.textContent = 'scout-ressearch.ai/search?q=' + encodeURIComponent(q);
    sbStatus.textContent = 'Searching...';
    goBtn.disabled = true;
    content.innerHTML = '';

    // Skeleton
    const skWrap = document.createElement('div'); skWrap.style.cssText = 'padding:20px 40px;display:grid;gap:0;';
    const searchInfoSk = document.createElement('div'); searchInfoSk.className = 'chloe-sk'; searchInfoSk.style.cssText = 'height:12px;width:200px;margin-bottom:18px;';
    skWrap.appendChild(searchInfoSk);
    for (let i = 0; i < 5; i++) {
      const sk = document.createElement('div'); sk.style.cssText = 'padding:16px 0;border-bottom:1px solid rgba(255,255,255,0.05);display:grid;gap:8px;';
      const l1 = document.createElement('div'); l1.className = 'chloe-sk'; l1.style.cssText = 'height:11px;width:35%;animation-delay:0s;';
      const l2 = document.createElement('div'); l2.className = 'chloe-sk'; l2.style.cssText = 'height:20px;width:75%;animation-delay:0.1s;';
      const l3 = document.createElement('div'); l3.className = 'chloe-sk'; l3.style.cssText = 'height:13px;width:90%;animation-delay:0.2s;';
      const l4 = document.createElement('div'); l4.className = 'chloe-sk'; l4.style.cssText = 'height:13px;width:60%;animation-delay:0.3s;';
      sk.appendChild(l1); sk.appendChild(l2); sk.appendChild(l3); sk.appendChild(l4);
      skWrap.appendChild(sk);
    }
    content.appendChild(skWrap);

    try {
      const isLocal = /^(localhost|127.0.0.1)$/i.test(window.location.hostname);
      const base = isLocal ? 'http://localhost:8787' : window.location.origin;
      const resp = await fetch(base + '/api/researcher-search', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      const data = await resp.json().catch(() => ({}));
      content.innerHTML = '';

      if (!resp.ok) {
        const errWrap = document.createElement('div'); errWrap.style.cssText = 'padding:20px 40px;';
        const errTxt = document.createElement('div'); errTxt.style.cssText = 'color:#f28b82;font-size:14px;'; errTxt.textContent = 'Search error: ' + (data?.error || resp.status);
        errWrap.appendChild(errTxt); content.appendChild(errWrap);
        sbStatus.textContent = 'Error'; return;
      }

      const resultsWrap = document.createElement('div');
      resultsWrap.style.cssText = 'padding:16px 40px 24px;max-width:750px;';

      // Info bar
      const infoBar = document.createElement('div');
      infoBar.style.cssText = 'font:400 13px/1 arial,sans-serif;color:#9aa0a6;margin-bottom:18px;';
      infoBar.textContent = (data.results ? data.results.length : 0) + ' results found';
      resultsWrap.appendChild(infoBar);

      // AI Answer box (knowledge panel style)
      if (data.answer) {
        const kp = document.createElement('div');
        kp.style.cssText = 'border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:18px 20px;margin-bottom:22px;background:#2d2e31;';
        const kpLabel = document.createElement('div'); kpLabel.style.cssText = 'font:700 11px/1 arial,sans-serif;color:#4285f4;letter-spacing:0.07em;text-transform:uppercase;margin-bottom:10px;'; kpLabel.textContent = 'AI Overview';
        const kpText = document.createElement('div'); kpText.style.cssText = 'font:400 15px/1.7 arial,sans-serif;color:#c8c8cb;'; kpText.textContent = data.answer;
        const kpSource = document.createElement('div'); kpSource.style.cssText = 'font:400 12px/1 arial,sans-serif;color:#5f6368;margin-top:12px;'; kpSource.textContent = 'Generated by Tavily real-time search';
        kp.appendChild(kpLabel); kp.appendChild(kpText); kp.appendChild(kpSource);
        resultsWrap.appendChild(kp);
      }

      if (data.results && data.results.length) {
        data.results.forEach((r) => {
          let host = ''; try { host = new URL(r.url || '').hostname.replace('www.',''); } catch(_) {}
          const row = document.createElement('div'); row.className = 'chloe-result-row'; row.style.cssText = 'border-bottom:1px solid rgba(255,255,255,0.05);padding:16px 0;cursor:pointer;';
          const srcLine = document.createElement('div'); srcLine.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
          const favicon = document.createElement('div'); favicon.style.cssText = 'width:18px;height:18px;border-radius:4px;background:#35363a;border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;font:700 10px arial;color:#9aa0a6;flex-shrink:0;'; favicon.textContent = (host[0]||'?').toUpperCase();
          const hostTxt = document.createElement('span'); hostTxt.style.cssText = 'font:400 13px/1 arial,sans-serif;color:#9aa0a6;'; hostTxt.textContent = host;
          srcLine.appendChild(favicon); srcLine.appendChild(hostTxt);
          const titleEl = document.createElement('div'); titleEl.className = 'chloe-result-title'; titleEl.style.cssText = 'font:400 20px/1.35 arial,sans-serif;color:#8ab4f8;margin-bottom:6px;line-height:1.3;'; titleEl.textContent = r.title || 'Untitled';
          const urlEl = document.createElement('div'); urlEl.style.cssText = 'font:400 13px/1 arial,sans-serif;color:#5f6368;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'; urlEl.textContent = (r.url || '').slice(0, 80) + ((r.url||'').length > 80 ? '...' : '');
          const snipEl = document.createElement('div'); snipEl.style.cssText = 'font:400 14px/1.65 arial,sans-serif;color:#bdc1c6;'; const raw = r.content || r.snippet || ''; snipEl.textContent = raw.slice(0,240) + (raw.length>240?'...':'');
          row.appendChild(srcLine); row.appendChild(titleEl); row.appendChild(urlEl); row.appendChild(snipEl);
          row.onclick = () => window.open(r.url,'_blank','noopener,noreferrer');
          resultsWrap.appendChild(row);
        });
      }

      content.appendChild(resultsWrap);
      sbStatus.textContent = (data.results ? data.results.length : 0) + ' results';
    } catch(err) {
      content.innerHTML = '';
      const errWrap = document.createElement('div'); errWrap.style.cssText = 'padding:20px 40px;';
      const errTxt = document.createElement('div'); errTxt.style.cssText = 'color:#f28b82;font-size:14px;'; errTxt.textContent = 'Error: ' + (err?.message||'Unknown');
      errWrap.appendChild(errTxt); content.appendChild(errWrap);
      sbStatus.textContent = 'Error';
    } finally { goBtn.disabled = false; }
  };

  goBtn.onclick = doSearch;
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); } });

  overlay.appendChild(win);
  document.body.appendChild(overlay);
  setTimeout(() => searchInput.focus(), 80);
}
function ensureResearcherPanel() {
  if (researcherPanel) return researcherPanel;
  ensureNoahReportStyles();
  const panel = document.createElement('div');
  panel.className = 'noah-report-panel rt-terminal-surface';
  panel.style.position = 'fixed';
  panel.style.left = '50%';
  panel.style.top = '70px';
  panel.style.transform = 'translateX(-50%)';
  panel.style.width = 'min(500px, calc(100vw - 36px))';
  panel.style.maxHeight = '78vh';
  panel.style.overflow = 'auto';
  panel.style.padding = '14px 14px 12px 14px';
  panel.style.zIndex = '20';
  panel.style.display = 'none';
  panel.style.pointerEvents = 'auto';
  document.body.appendChild(panel);
  researcherPanel = panel;
  return panel;
}

function showResearcherPanel() {
  const panel = ensureResearcherPanel();
  panel.innerHTML = '';
  panel.style.display = 'block';

  // Header
  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.justifyContent = 'space-between';
  header.style.marginBottom = '12px';
  const title = document.createElement('div');
  title.style.font = '22px/1.3 VT323,Consolas,monospace';
  title.style.color = 'var(--rt-accent-skills, #8f84a8)';
  title.style.textTransform = 'uppercase';
  title.textContent = 'Researcher — Web Search';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.className = 'rt-modal-close';
  closeBtn.onclick = () => { panel.style.display = 'none'; };
  header.appendChild(title);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // Search row
  const searchRow = document.createElement('div');
  searchRow.style.display = 'grid';
  searchRow.style.gridTemplateColumns = '1fr auto';
  searchRow.style.gap = '8px';
  searchRow.style.marginBottom = '12px';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Search anything on the internet...';
  input.style.cssText = 'padding:9px 10px;border-radius:0;border:2px solid var(--rt-border,#3d5260);background:var(--rt-bg-input,#0f151c);color:var(--rt-fg,#e8e4d4);font:22px/1.4 VT323,Consolas,monospace;width:100%;outline:none;';
  const searchBtn = document.createElement('button');
  searchBtn.type = 'button';
  searchBtn.textContent = 'Search';
  searchBtn.className = 'rt-pri-connect';
  searchBtn.style.cssText = 'padding:9px 14px;white-space:nowrap;';
  searchRow.appendChild(input);
  searchRow.appendChild(searchBtn);
  panel.appendChild(searchRow);

  // Results area
  const resultsDiv = document.createElement('div');
  resultsDiv.style.display = 'grid';
  resultsDiv.style.gap = '8px';
  panel.appendChild(resultsDiv);

  const doSearch = async () => {
    const q = input.value.trim();
    if (!q) return;
    resultsDiv.innerHTML = '';
    const loading = document.createElement('div');
    loading.style.cssText = 'color:#aaa;font-size:13px;padding:8px 0;';
    loading.textContent = 'Searching...';
    resultsDiv.appendChild(loading);
    searchBtn.disabled = true;
    try {
      const isLocal = /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
      const base = isLocal ? 'http://localhost:8787' : window.location.origin;
      const resp = await fetch(`${base}/api/researcher-search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      const data = await resp.json().catch(() => ({}));
      resultsDiv.innerHTML = '';
      if (!resp.ok) {
        const err = document.createElement('div');
        err.style.cssText = 'color:#ff8a6a;font-size:13px;';
        err.textContent = `Error: ${data?.error || resp.status}`;
        resultsDiv.appendChild(err);
        return;
      }
      if (data.answer) {
        const answerCard = document.createElement('div');
        answerCard.style.cssText = 'background:rgba(143,132,168,0.15);border:2px solid var(--rt-accent-skills,#8f84a8);border-radius:0;padding:10px 12px;margin-bottom:4px;';
        const answerLabel = document.createElement('div');
        answerLabel.style.cssText = 'font:18px/1 VT323,Consolas,monospace;color:var(--rt-fg-phosphor,#9ed9b8);letter-spacing:0.06em;text-transform:uppercase;margin-bottom:6px;';
        answerLabel.textContent = 'Summary';
        const answerText = document.createElement('div');
        answerText.style.cssText = 'font:18px/1.55 VT323,Consolas,monospace;color:var(--rt-fg,#e8e4d4);';
        answerText.textContent = data.answer;
        answerCard.appendChild(answerLabel);
        answerCard.appendChild(answerText);
        resultsDiv.appendChild(answerCard);
      }
      if (!data.results || !data.results.length) {
        const noRes = document.createElement('div');
        noRes.style.cssText = 'color:#aaa;font-size:13px;';
        noRes.textContent = 'No results found.';
        resultsDiv.appendChild(noRes);
        return;
      }
      data.results.forEach((r, i) => {
        const card = document.createElement('div');
        card.style.cssText = 'background:var(--rt-bg-deep,#141c24);border:2px solid var(--rt-border,#3d5260);border-radius:0;padding:10px 12px;';
        const num = document.createElement('div');
        num.style.cssText = 'font:18px/1 VT323,Consolas,monospace;color:var(--rt-accent-skills,#8f84a8);margin-bottom:4px;';
        num.textContent = `${i + 1}. ${new URL(r.url || 'https://x.com').hostname}`;
        const titleEl = document.createElement('div');
        titleEl.style.cssText = 'font:20px/1.35 VT323,Consolas,monospace;color:var(--rt-fg,#e8e4d4);margin-bottom:4px;';
        titleEl.textContent = r.title || '—';
        const snippet = document.createElement('div');
        snippet.style.cssText = 'font:18px/1.5 VT323,Consolas,monospace;color:var(--rt-fg-dim,#8fa89c);margin-bottom:6px;';
        snippet.textContent = (r.content || r.snippet || '').slice(0, 220) + ((r.content || r.snippet || '').length > 220 ? '…' : '');
        const link = document.createElement('a');
        link.href = r.url || '#';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Open source ↗';
        link.style.cssText = 'font:700 11px/1 system-ui,sans-serif;color:#e07a54;text-decoration:none;letter-spacing:0.04em;';
        card.appendChild(num);
        card.appendChild(titleEl);
        card.appendChild(snippet);
        card.appendChild(link);
        resultsDiv.appendChild(card);
      });
    } catch (err) {
      resultsDiv.innerHTML = '';
      const errEl = document.createElement('div');
      errEl.style.cssText = 'color:#ff8a6a;font-size:13px;';
      errEl.textContent = `Error: ${err?.message || 'Unknown error'}`;
      resultsDiv.appendChild(errEl);
    } finally {
      searchBtn.disabled = false;
    }
  };

  searchBtn.onclick = doSearch;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  setTimeout(() => input.focus(), 80);
}

function buildEthanSignal(item) {
  const price = Number(item?.price);
  const rsi = Number(item?.rsi);
  const macd = Number(item?.macd);
  const macdSignal = Number(item?.macdSignal);
  const macdHist = Number(item?.macdHist);
  const ema = Number(item?.ema);
  const bbUpper = Number(item?.bbUpper);
  const bbLower = Number(item?.bbLower);
  const newsImpact = Number(item?.newsImpact);
  const newsRelevant = !!item?.newsRelevant;
  const newsReason = String(item?.newsReason || '').trim();
  const newsHeadlines = Array.isArray(item?.newsHeadlines) ? item.newsHeadlines : [];
  let score = 0;
  const reasons = [];
  let bollingerLabel = 'N/A';

  if (Number.isFinite(rsi)) {
    if (rsi <= 35) {
      score += 2;
      reasons.push(`RSI ${rsi.toFixed(2)} is near oversold.`);
    } else if (rsi >= 65) {
      score -= 2;
      reasons.push(`RSI ${rsi.toFixed(2)} is near overbought.`);
    } else if (rsi < 50) {
      score += 0.5;
      reasons.push(`RSI ${rsi.toFixed(2)} is below neutral.`);
    } else {
      score -= 0.5;
      reasons.push(`RSI ${rsi.toFixed(2)} is above neutral.`);
    }
  } else {
    reasons.push('RSI unavailable.');
  }

  if (Number.isFinite(macd) && Number.isFinite(macdSignal)) {
    if (macd > macdSignal) {
      score += 1.5;
      reasons.push('MACD is above signal.');
    } else if (macd < macdSignal) {
      score -= 1.5;
      reasons.push('MACD is below signal.');
    }
  } else {
    reasons.push('MACD line/signal unavailable.');
  }

  if (Number.isFinite(macdHist)) {
    if (macdHist > 0) score += 0.5;
    else if (macdHist < 0) score -= 0.5;
  }

  if (Number.isFinite(price) && Number.isFinite(ema)) {
    if (price > ema) {
      score += 0.8;
      reasons.push(`Price is above EMA20 (${ema.toFixed(2)}).`);
    } else if (price < ema) {
      score -= 0.8;
      reasons.push(`Price is below EMA20 (${ema.toFixed(2)}).`);
    }
  }

  if (Number.isFinite(price) && Number.isFinite(bbUpper) && Number.isFinite(bbLower)) {
    if (price > bbUpper) bollingerLabel = 'Above upper band';
    else if (price < bbLower) bollingerLabel = 'Below lower band';
    else bollingerLabel = 'Inside bands';
    if (price < bbLower) {
      score += 1.2;
      reasons.push('Price is below lower Bollinger band (potential rebound zone).');
    } else if (price > bbUpper) {
      score -= 1.2;
      reasons.push('Price is above upper Bollinger band (possible overheating).');
    }
  }

  if (newsRelevant) {
    if (Number.isFinite(newsImpact) && Math.abs(newsImpact) > 0.05) {
      score += Math.max(-1.2, Math.min(1.2, newsImpact * 1.2));
    }
    if (newsReason) reasons.push(`Noticia relevante: ${newsReason}`);
    else if (Number.isFinite(newsImpact)) reasons.push(`Impacto noticias: ${newsImpact > 0 ? '+' : ''}${newsImpact.toFixed(2)}`);
    if (newsHeadlines.length) {
      const h = newsHeadlines[0];
      const title = typeof h === 'string' ? h : (h?.title || '');
      const source = typeof h === 'object' && h?.source ? `[${h.source}] ` : '';
      reasons.push(`Titular: ${source}${String(title).slice(0, 100)}`);
    }
  }

  const action = score >= 0 ? 'Buy' : 'Sell';
  const confidence = Math.abs(score) >= 2.5 ? 'strong' : 'moderate';
  return { action, confidence, reasons, bollingerLabel };
}

function createSparklineSvg(points, width = 640, height = 150) {
  const NS = 'http://www.w3.org/2000/svg';
  const BG = '#141c24';
  const GRID = 'rgba(90, 115, 132, 0.35)';
  const GREEN = '#5f8f72';
  const RED = '#a07070';
  const values = Array.isArray(points) ? points.map((n) => Number(n)).filter((n) => Number.isFinite(n)) : [];
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.display = 'block';
  svg.style.borderRadius = '0';
  svg.style.background = BG;

  const padding = 10;
  const chartW = width - padding * 2;
  const chartH = height - padding * 2;
  const grid = document.createElementNS(NS, 'g');
  for (let i = 0; i <= 4; i++) {
    const y = padding + (i / 4) * chartH;
    const gl = document.createElementNS(NS, 'line');
    gl.setAttribute('x1', String(padding));
    gl.setAttribute('y1', String(y));
    gl.setAttribute('x2', String(width - padding));
    gl.setAttribute('y2', String(y));
    gl.setAttribute('stroke', GRID);
    gl.setAttribute('stroke-width', '1');
    grid.appendChild(gl);
  }
  const vLines = 6;
  for (let i = 0; i <= vLines; i++) {
    const x = padding + (i / vLines) * chartW;
    const gl = document.createElementNS(NS, 'line');
    gl.setAttribute('x1', String(x));
    gl.setAttribute('y1', String(padding));
    gl.setAttribute('x2', String(x));
    gl.setAttribute('y2', String(height - padding));
    gl.setAttribute('stroke', GRID);
    gl.setAttribute('stroke-width', '1');
    grid.appendChild(gl);
  }
  svg.appendChild(grid);

  if (values.length < 2) return svg;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1e-6);
  const start = values[0];
  const end = values[values.length - 1];
  const up = end >= start;

  const pointsStr = values.map((v, i) => {
    const x = padding + (i / (values.length - 1)) * chartW;
    const y = padding + ((max - v) / range) * chartH;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');

  const area = document.createElementNS(NS, 'polygon');
  area.setAttribute(
    'points',
    `${padding},${height - padding} ${pointsStr} ${width - padding},${height - padding}`
  );
  area.setAttribute('fill', up ? 'rgba(95, 143, 114, 0.2)' : 'rgba(160, 112, 112, 0.2)');
  svg.appendChild(area);

  const line = document.createElementNS(NS, 'polyline');
  line.setAttribute('points', pointsStr);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', up ? GREEN : RED);
  line.setAttribute('stroke-width', '2');
  line.setAttribute('stroke-linecap', 'square');
  line.setAttribute('stroke-linejoin', 'miter');
  svg.appendChild(line);

  return svg;
}

function createCandlestickSvg(klines, width = 640, height = 150) {
  const NS = 'http://www.w3.org/2000/svg';
  const BG = '#141c24';
  const GRID = 'rgba(90, 115, 132, 0.35)';
  const GREEN = '#5f8f72';
  const RED = '#a07070';
  const candles = Array.isArray(klines) ? klines : [];
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.display = 'block';
  svg.style.borderRadius = '0';
  svg.style.background = BG;

  if (candles.length < 1) return svg;

  const parsed = candles.map((k) => {
    const o = Number(k[1]);
    const h = Number(k[2]);
    const l = Number(k[3]);
    const c = Number(k[4]);
    return { o, h, l, c };
  }).filter((x) => Number.isFinite(x.o) && Number.isFinite(x.h) && Number.isFinite(x.l) && Number.isFinite(x.c));
  if (parsed.length < 1) return svg;

  const allPrices = parsed.flatMap((p) => [p.h, p.l]);
  const min = Math.min(...allPrices);
  const max = Math.max(...allPrices);
  const range = Math.max(max - min, 1e-6);
  const padding = 10;
  const chartW = width - padding * 2;
  const chartH = height - padding * 2;
  const candleW = Math.max(3, (chartW / parsed.length) * 0.72);
  const gap = chartW / parsed.length;

  const grid = document.createElementNS(NS, 'g');
  for (let i = 0; i <= 4; i++) {
    const y = padding + (i / 4) * chartH;
    const gl = document.createElementNS(NS, 'line');
    gl.setAttribute('x1', String(padding));
    gl.setAttribute('y1', String(y));
    gl.setAttribute('x2', String(width - padding));
    gl.setAttribute('y2', String(y));
    gl.setAttribute('stroke', GRID);
    gl.setAttribute('stroke-width', '1');
    grid.appendChild(gl);
  }
  const vLines = Math.min(8, parsed.length);
  for (let i = 0; i <= vLines; i++) {
    const x = padding + (i / Math.max(vLines, 1)) * chartW;
    const gl = document.createElementNS(NS, 'line');
    gl.setAttribute('x1', String(x));
    gl.setAttribute('y1', String(padding));
    gl.setAttribute('x2', String(x));
    gl.setAttribute('y2', String(height - padding));
    gl.setAttribute('stroke', GRID);
    gl.setAttribute('stroke-width', '1');
    grid.appendChild(gl);
  }
  svg.appendChild(grid);

  const toY = (v) => padding + ((max - v) / range) * chartH;
  const candlesG = document.createElementNS(NS, 'g');
  parsed.forEach((c, i) => {
    const x = padding + i * gap + (gap - candleW) / 2;
    const yHigh = toY(c.h);
    const yLow = toY(c.l);
    const yOpen = toY(c.o);
    const yClose = toY(c.c);
    const isUp = c.c >= c.o;
    const bodyTop = Math.min(yOpen, yClose);
    const bodyH = Math.max(Math.abs(yClose - yOpen), 1);
    const col = isUp ? GREEN : RED;

    const wick = document.createElementNS(NS, 'line');
    wick.setAttribute('x1', x + candleW / 2);
    wick.setAttribute('y1', yHigh);
    wick.setAttribute('x2', x + candleW / 2);
    wick.setAttribute('y2', yLow);
    wick.setAttribute('stroke', col);
    wick.setAttribute('stroke-width', '1.5');
    wick.setAttribute('stroke-linecap', 'square');
    candlesG.appendChild(wick);

    const body = document.createElementNS(NS, 'rect');
    body.setAttribute('x', x);
    body.setAttribute('y', bodyTop);
    body.setAttribute('width', candleW);
    body.setAttribute('height', bodyH);
    body.setAttribute('fill', col);
    body.setAttribute('stroke', col);
    body.setAttribute('stroke-width', '0');
    candlesG.appendChild(body);
  });
  svg.appendChild(candlesG);

  return svg;
}

function ensureMeetingSummaryContainer() {
  if (meetingSummaryContainer) return meetingSummaryContainer;
  const el = document.createElement('div');
  el.style.position = 'fixed';
  el.style.left = '0';
  el.style.top = '0';
  el.style.right = '0';
  el.style.bottom = '0';
  el.style.display = 'none';
  el.style.gridTemplateColumns = 'repeat(auto-fit, minmax(320px, 360px))';
  el.style.gap = '16px';
  el.style.width = '100vw';
  el.style.height = '100vh';
  el.style.overflow = 'auto';
  el.style.padding = '28px';
  el.style.zIndex = '35';
  el.style.pointerEvents = 'auto';
  el.style.alignContent = 'center';
  el.style.justifyContent = 'center';
  el.style.justifyItems = 'center';
  el.style.alignItems = 'start';
  el.className = 'rt-meeting-overlay noah-report-panel';
  document.body.appendChild(el);
  meetingSummaryContainer = el;
  return el;
}

function hideMeetingSummary() {
  if (!meetingSummaryContainer) return;
  meetingSummaryContainer.style.display = 'none';
  meetingSummaryContainer.innerHTML = '';
}

function restoreFromMeetingFocus() {
  camera.zoom = meetingFocus.prevZoom != null ? meetingFocus.prevZoom : camera.zoom;
  controls.target.copy(meetingFocus.prevTarget);
  camera.updateProjectionMatrix();
  controls.update();
}

function restoreFromWorkFocus() {
  camera.zoom = workFocus.prevZoom != null ? workFocus.prevZoom : camera.zoom;
  controls.target.copy(workFocus.prevTarget);
  camera.updateProjectionMatrix();
  controls.update();
}

function exitMeetingOverlay() {
  if (!meetingFocus.active) return;
  meetingFocus.active = false;
  meetingFocus.overlayShown = false;
  meetingFocus.revealTimer = 0;
  meetingFocus.orbitProgress = 0;
  meetingFocus.dismissed = true;
  hideMeetingSummary();
  restoreFromMeetingFocus();
}

function showMeetingSummary(workers) {
  const container = ensureMeetingSummaryContainer();
  container.innerHTML = '';
  container.style.display = 'grid';
  container.style.opacity = '0';
  container.style.transition = 'opacity 220ms ease';

  const topBar = document.createElement('div');
  topBar.style.gridColumn = '1 / -1';
  topBar.style.display = 'flex';
  topBar.style.justifyContent = 'space-between';
  topBar.style.alignItems = 'center';
  topBar.style.gap = '10px';
  topBar.style.marginBottom = '4px';

  const heading = document.createElement('div');
  heading.className = 'rt-meeting-heading';
  heading.textContent = 'Meeting Summary';
  topBar.appendChild(heading);

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'rt-meeting-back-btn';
  backBtn.textContent = 'Back to office';
  backBtn.onclick = () => exitMeetingOverlay();
  topBar.appendChild(backBtn);

  container.appendChild(topBar);

  workers.forEach((w) => {
    const name = NAMES[w.mesh.userData?.nameIndex] || 'Worker';
    const activities = Array.isArray(w.dailyActivities) ? [...w.dailyActivities] : [];
    if (name === 'Scoop' && Number.isFinite(w.noahNewsLastAt)) {
      const within24h = (Date.now() - w.noahNewsLastAt) <= (24 * 60 * 60 * 1000);
      if (within24h && !activities.includes('Shared crypto news report')) {
        activities.push('Shared crypto news report');
      }
    }
    if (name === 'Buzz' && Array.isArray(w.liamPostedTweets) && w.liamPostedTweets.length > 0) {
      const count = w.liamPostedTweets.length;
      activities.push(`Published ${count} tweet${count > 1 ? 's' : ''} on X`);
    }
    if (name === 'Sage' && typeof w.emmaWalletAddress === 'string' && w.emmaWalletAddress.trim()) {
      activities.push('Created Base wallet');
    }
    if (name === 'Quant') {
      const within24h = Number.isFinite(w.ethanSignalsLastAt)
        && (Date.now() - w.ethanSignalsLastAt) <= (24 * 60 * 60 * 1000);
      if (within24h) {
        activities.push('Shared market signals (BTC/ETH/SOL)');
      } else {
        activities.push('Did not share market signals today');
      }
    }

    const card = document.createElement('div');
    card.className = 'rt-meeting-card';
    card.style.padding = '16px';
    card.style.minHeight = '220px';
    card.style.width = 'min(360px, 88vw)';
    card.style.opacity = '0';
    card.style.transform = 'scale(0.96) translateY(10px)';
    card.style.transition = 'opacity 240ms ease, transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1)';

    const title = document.createElement('div');
    title.className = 'rt-meeting-name';
    title.textContent = name;
    title.style.marginBottom = '10px';
    card.appendChild(title);

    const body = document.createElement('div');
    if (!activities.length) {
      body.textContent = 'Did nothing today.';
    } else {
      body.innerHTML = activities.map((a) => `- ${a}`).join('<br>');
    }
    card.appendChild(body);
    container.appendChild(card);

    // Entrada suave tipo popup por tarjeta, escalonada.
    const delayMs = 40 * (container.children.length - 1);
    setTimeout(() => {
      card.style.opacity = '1';
      card.style.transform = 'scale(1) translateY(0)';
    }, delayMs);
  });

  requestAnimationFrame(() => {
    container.style.opacity = '1';
  });
}

function showNoahReport(title, text, isError = false) {
  hideEthanSummaryPanel();
  const panel = ensureNoahReportPanel();
  panel.style.display = 'block';
  panel.classList.toggle('rt-terminal-surface--error', !!isError);
  panel.innerHTML = '';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.justifyContent = 'space-between';
  header.style.gap = '8px';

  const h = document.createElement('strong');
  h.textContent = title;
  if (isError) h.style.color = 'var(--rt-red-lo, #a07070)';
  header.appendChild(h);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.className = 'rt-modal-close';
  closeBtn.onclick = () => { panel.style.display = 'none'; };
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.textContent = text;
  body.style.marginTop = '8px';

  panel.appendChild(header);
  panel.appendChild(body);
}

function showNoahReportNews(items) {
  hideEthanSummaryPanel();
  const panel = ensureNoahReportPanel();
  panel.style.display = 'block';
  panel.classList.remove('rt-terminal-surface--error');
  panel.innerHTML = '';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.justifyContent = 'space-between';
  header.style.gap = '8px';

  const h = document.createElement('strong');
  h.textContent = 'Scoop Crypto Report';
  h.style.color = '#9fe8d2';
  header.appendChild(h);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.className = 'rt-modal-close';
  closeBtn.onclick = () => { panel.style.display = 'none'; };
  header.appendChild(closeBtn);
  panel.appendChild(header);

  const body = document.createElement('div');
  body.style.marginTop = '10px';
  body.style.display = 'grid';
  body.style.rowGap = '12px';

  items.forEach((n, idx) => {
    const card = document.createElement('div');
    card.style.padding = '10px';
    card.style.border = '2px solid var(--rt-border, #3d5260)';
    card.style.borderRadius = '0';
    card.style.background = 'var(--rt-bg-deep, #141c24)';

    const title = document.createElement('div');
    title.textContent = `${idx + 1}) ${n.title || 'Untitled'}`;
    title.style.fontWeight = '700';
    title.style.marginBottom = '6px';
    card.appendChild(title);

    const summary = document.createElement('div');
    summary.textContent = `Summary: ${n.summary || 'No summary available.'}`;
    summary.style.marginBottom = '6px';
    summary.style.opacity = '0.95';
    card.appendChild(summary);

    const source = document.createElement('div');
    source.textContent = `Source: ${n.source || 'Source'}`;
    source.style.opacity = '0.85';
    source.style.marginBottom = '4px';
    card.appendChild(source);

    if (n.url) {
      const link = document.createElement('a');
      link.textContent = 'See here';
      link.href = n.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.style.color = '#7fd3ff';
      link.style.textDecoration = 'underline';
      card.appendChild(link);
    }

    body.appendChild(card);
  });

  const tip = document.createElement('div');
  tip.textContent = 'Tip: click Scoop anytime to refresh.';
  tip.style.opacity = '0.75';
  tip.style.fontSize = '12px';
  body.appendChild(tip);

  panel.appendChild(body);
}

function stripHtml(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeSummary(text, maxLen = 170) {
  const clean = stripHtml(text);
  if (!clean) return 'No summary available.';
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen).replace(/\s+\S*$/, '')}...`;
}

function stripEmojis(text) {
  return String(text || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '');
}

function stripMentions(text) {
  return String(text || '')
    .replace(/(^|\s)@[a-zA-Z0-9_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTweetText(source, text, maxLen = 240) {
  const cleanTitle = stripMentions(stripEmojis(String(text || '').replace(/\s+/g, ' ').trim()));
  const cleanSource = stripMentions(stripEmojis(String(source || 'Source').replace(/\s+/g, ' ').trim()));
  let tweet = `${cleanTitle} (${cleanSource})`;
  if (tweet.length <= maxLen) return tweet;
  const suffix = ` (${cleanSource})`;
  const allowed = Math.max(0, maxLen - suffix.length - 3);
  tweet = `${cleanTitle.slice(0, allowed).replace(/\s+\S*$/, '')}...${suffix}`;
  return tweet.slice(0, maxLen);
}

const TWITTER_CREDS_STORAGE_KEY = 'liam-twitter-creds-v1';
const EMMA_WALLET_STATE_KEY = 'emma-base-wallet-v1';



function loadEmmaPrivyState() {
  try {
    const raw = localStorage.getItem(EMMA_WALLET_STATE_KEY);
    if (!raw) return { walletAddress: '', privateKeyHex: '' };
    const parsed = JSON.parse(raw);
    return {
      walletAddress: parsed.walletAddress || '',
      privateKeyHex: parsed.privateKeyHex || '',
    };
  } catch (_) {
    return { walletAddress: '', privateKeyHex: '' };
  }
}

function saveEmmaPrivyState(state) {
  try {
    localStorage.setItem(EMMA_WALLET_STATE_KEY, JSON.stringify({
      walletAddress: state.walletAddress || '',
      privateKeyHex: state.privateKeyHex || '',
    }));
  } catch (_) {}
}

function toRawGithubMarkdownUrl(urlText) {
  let parsed;
  try {
    parsed = new URL(String(urlText || '').trim());
  } catch (_) {
    throw new Error('Invalid URL format');
  }
  const host = parsed.hostname.toLowerCase();
  if (host === 'raw.githubusercontent.com') return parsed.toString();
  if (host !== 'github.com') {
    throw new Error('Use a GitHub URL to a .md file');
  }

  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length >= 5 && parts[2] === 'blob') {
    const owner = parts[0];
    const repo = parts[1];
    const branch = parts[3];
    const filePath = parts.slice(4).join('/');
    if (!filePath.toLowerCase().endsWith('.md')) throw new Error('The GitHub file must be .md');
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  }
  if (parts.length >= 5 && parts[2] === 'raw') {
    const owner = parts[0];
    const repo = parts[1];
    const branch = parts[3];
    const filePath = parts.slice(4).join('/');
    if (!filePath.toLowerCase().endsWith('.md')) throw new Error('The GitHub file must be .md');
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  }
  throw new Error('Use a file URL like github.com/<owner>/<repo>/blob/<branch>/<file>.md');
}

function extractAgentPromptLines(markdownText) {
  const clean = String(markdownText || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\r/g, '');
  const lines = clean
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith('#') && !l.startsWith('>'));
  const bullets = lines
    .filter((l) => /^[-*]\s+/.test(l) || /^\d+\.\s+/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim())
    .filter((l) => l.length > 6);
  const fallback = lines.filter((l) => l.length > 16);
  return (bullets.length ? bullets : fallback).slice(0, 10);
}


function loadTwitterCreds() {
  try {
    const raw = localStorage.getItem(TWITTER_CREDS_STORAGE_KEY);
    if (!raw) return { apiKey: '', apiSecret: '', bearerToken: '' };
    const parsed = JSON.parse(raw);
    return {
      apiKey: parsed.apiKey || '',
      apiSecret: parsed.apiSecret || '',
      bearerToken: parsed.bearerToken || '',
      clientId: parsed.clientId || '',
      clientSecret: parsed.clientSecret || '',
      accessToken: parsed.accessToken || '',
      accessTokenSecret: parsed.accessTokenSecret || '',
      proxyUrl: parsed.proxyUrl || '',
    };
  } catch (_) {
    return {
      apiKey: '',
      apiSecret: '',
      bearerToken: '',
      clientId: '',
      clientSecret: '',
      accessToken: '',
      accessTokenSecret: '',
      proxyUrl: '',
    };
  }
}

function saveTwitterCreds(creds) {
  try {
    localStorage.setItem(TWITTER_CREDS_STORAGE_KEY, JSON.stringify({
      apiKey: creds.apiKey || '',
      apiSecret: creds.apiSecret || '',
      bearerToken: creds.bearerToken || '',
      clientId: creds.clientId || '',
      clientSecret: creds.clientSecret || '',
      accessToken: creds.accessToken || '',
      accessTokenSecret: creds.accessTokenSecret || '',
      proxyUrl: creds.proxyUrl || '',
    }));
  } catch (_) {}
}

async function buildBearerFromApiKeys(apiKey, apiSecret) {
  const basic = btoa(`${apiKey}:${apiSecret}`);
  const res = await fetch('https://api.twitter.com/oauth2/token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Token endpoint HTTP ${res.status}`);
  const data = await res.json();
  if (!data?.access_token) throw new Error('No access_token in token response');
  return data.access_token;
}

async function postSelectedTweetToTwitter(tweetText, creds) {
  const normalized = stripEmojis(tweetText).replace(/\s+/g, ' ').trim().slice(0, 150);
  if (!normalized) throw new Error('Tweet text is empty');
  const customProxy = (creds.proxyUrl || '').trim();
  const proxyUrl = customProxy || `${window.location.origin}/api/post-tweet`;
  const res = await fetch(proxyUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      text: normalized,
      apiKey: (creds.apiKey || '').trim(),
      apiSecret: (creds.apiSecret || '').trim(),
      bearerToken: (creds.bearerToken || '').trim(),
      clientId: (creds.clientId || '').trim(),
      clientSecret: (creds.clientSecret || '').trim(),
      accessToken: (creds.accessToken || '').trim(),
      accessTokenSecret: (creds.accessTokenSecret || '').trim(),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 405) {
      throw new Error('Proxy URL exists but does not allow POST. Use an endpoint like /api/post-tweet.');
    }
    throw new Error(`Post API ${res.status}: ${text}`);
  }
  return res.json();
}

function openTweetIntent(tweetText) {
  const normalized = stripEmojis(tweetText).replace(/\s+/g, ' ').trim().slice(0, 260);
  const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(normalized)}`;
  window.open(intentUrl, '_blank', 'noopener,noreferrer');
}

async function fetchCryptoNewsItems() {
  const nonce = Date.now();
  const settled = await Promise.allSettled(
    NOAH_RSS_ENDPOINTS.map((url) => {
      const sep = url.includes('?') ? '&' : '?';
      const noCacheUrl = `${url}${sep}_ts=${nonce}`;
      return fetch(noCacheUrl, { method: 'GET', cache: 'no-store' });
    })
  );
  const allPosts = [];
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    const res = result.value;
    if (!res.ok) continue;
    const json = await res.json();
    const items = Array.isArray(json?.items) ? json.items : [];
    for (const p of items) {
      if (!p?.title || !p?.link) continue;
      const ts = p.pubDate ? (new Date(p.pubDate).getTime() / 1000) : 0;
      allPosts.push({
        source: p.author || json?.feed?.title || 'Crypto Feed',
        title: String(p.title).replace(/\s+/g, ' ').trim(),
        summary: makeSummary(p.description || p.content || p.contentSnippet),
        url: p.link,
        ts: Number.isFinite(ts) ? ts : 0,
      });
    }
  }
  if (!allPosts.length) throw new Error('No public feed items');

  const nowSec = Date.now() / 1000;
  const oneDaySec = 24 * 60 * 60;
  const dedupMap = new Map();
  for (const p of allPosts) {
    const k = p.title.toLowerCase();
    if (!dedupMap.has(k) || dedupMap.get(k).ts < p.ts) dedupMap.set(k, p);
  }
  const dedup = Array.from(dedupMap.values()).sort((a, b) => b.ts - a.ts);
  const todayItems = dedup.filter((n) => n.ts > 0 && (nowSec - n.ts) <= oneDaySec);
  return (todayItems.length ? todayItems : dedup).slice(0, 7);
}

async function buildLiamTweetsWithAI(items) {
  const localLikeHost = /^(localhost|127\.0\.0\.1)$/i.test(String(window.location.hostname || ''));
  const endpoints = localLikeHost
    ? ['http://localhost:8787/api/liam-tweets', '/api/liam-tweets']
    : ['/api/liam-tweets', 'http://localhost:8787/api/liam-tweets'];

  const payloadItems = (Array.isArray(items) ? items : []).slice(0, 7).map((n) => ({
    source: String(n?.source || 'Crypto Feed'),
    title: String(n?.title || '').trim(),
    summary: String(n?.summary || '').trim(),
    url: String(n?.url || '').trim(),
    pubDate: n?.pubDate || null,
  }));

  let lastErr = null;
  for (const endpoint of endpoints) {
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: payloadItems }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);
      const tweets = Array.isArray(data?.tweets) ? data.tweets : [];
      if (!tweets.length) throw new Error('No tweets generated');
      return payloadItems.map((n, idx) => ({
        ...n,
        tweet: String(tweets[idx]?.tweet || '').trim() || toTweetText(n.source, n.summary || n.title, 240),
      }));
    } catch (err) {
      lastErr = err;
    }
  }
  throw (lastErr || new Error('Could not generate tweets'));
}

function showLiamTweetIdeas(items) {
  hideEthanSummaryPanel();
  const panel = ensureNoahReportPanel();
  panel.style.width = 'min(980px, calc(100vw - 36px))';
  panel.style.maxHeight = '82vh';
  panel.style.display = 'block';
  panel.classList.remove('rt-terminal-surface--error');
  panel.innerHTML = '';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.justifyContent = 'space-between';
  header.style.gap = '8px';

  const h = document.createElement('strong');
  h.textContent = 'Buzz Social Tweets';
  h.style.color = '#9fe8d2';
  header.appendChild(h);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.className = 'rt-modal-close';
  closeBtn.onclick = () => { panel.style.display = 'none'; };
  header.appendChild(closeBtn);
  panel.appendChild(header);

  const layout = document.createElement('div');
  layout.style.marginTop = '10px';
  layout.style.display = 'grid';
  layout.style.gridTemplateColumns = '1.25fr 1fr';
  layout.style.gap = '12px';

  const tweetsCol = document.createElement('div');
  tweetsCol.style.display = 'grid';
  tweetsCol.style.rowGap = '10px';
  tweetsCol.style.maxHeight = '68vh';
  tweetsCol.style.overflow = 'auto';
  tweetsCol.className = 'noah-report-panel';

  const rightCol = document.createElement('div');
  rightCol.style.display = 'grid';
  rightCol.style.alignContent = 'start';
  rightCol.style.gap = '10px';
  rightCol.style.background = 'var(--rt-bg-deep, #141c24)';
  rightCol.style.border = '2px solid var(--rt-border, #3d5260)';
  rightCol.style.borderRadius = '0';
  rightCol.style.padding = '10px';

  const info = document.createElement('div');
  info.textContent = 'Select a tweet on the left, then open it in X/Twitter.';
  info.style.fontSize = '12px';
  info.style.opacity = '0.85';

  const selectedTweetBox = document.createElement('div');
  selectedTweetBox.style.minHeight = '140px';
  selectedTweetBox.style.border = '2px solid var(--rt-border, #3d5260)';
  selectedTweetBox.style.borderRadius = '0';
  selectedTweetBox.style.background = 'var(--rt-bg-input, #0f151c)';
  selectedTweetBox.style.color = 'var(--rt-fg, #e8e4d4)';
  selectedTweetBox.style.padding = '8px';
  selectedTweetBox.style.whiteSpace = 'pre-wrap';
  selectedTweetBox.textContent = 'No tweet selected yet.';

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.textContent = 'Post twit';
  openBtn.className = 'rt-pri-publish';
  openBtn.style.padding = '9px 12px';
  openBtn.disabled = true;
  openBtn.style.opacity = '0.65';

  const postStatus = document.createElement('div');
  postStatus.style.fontSize = '12px';
  postStatus.style.opacity = '0.9';

  rightCol.appendChild(info);
  rightCol.appendChild(selectedTweetBox);
  rightCol.appendChild(openBtn);
  rightCol.appendChild(postStatus);

  let selectedTweet = '';
  const selectButtons = [];
  const liamIndex = NAMES.indexOf('Buzz');
  const liamWorker = workers.find((w) => w?.mesh?.userData?.nameIndex === liamIndex);
  const postedSet = new Set(Array.isArray(liamWorker?.liamPostedTweets) ? liamWorker.liamPostedTweets : []);

  items.forEach((n, idx) => {
    const tweet = String(n?.tweet || '').trim() || toTweetText(n.source, n.summary || n.title, 240);
    const card = document.createElement('div');
    card.style.padding = '10px';
    card.style.border = '2px solid var(--rt-border, #3d5260)';
    card.style.borderRadius = '0';
    card.style.background = 'var(--rt-bg-deep, #141c24)';

    const title = document.createElement('div');
    title.textContent = `Tweet ${idx + 1}`;
    title.style.fontWeight = '700';
    title.style.marginBottom = '6px';
    card.appendChild(title);

    const tweetText = document.createElement('div');
    tweetText.textContent = tweet;
    tweetText.style.marginBottom = '8px';
    card.appendChild(tweetText);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy tweet';
    copyBtn.className = 'rt-pri-connect';
    copyBtn.style.padding = '6px 10px';
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(tweet);
        copyBtn.textContent = 'Copied';
        setTimeout(() => { copyBtn.textContent = 'Copy tweet'; }, 1000);
      } catch (_) {
        copyBtn.textContent = 'Copy failed';
        setTimeout(() => { copyBtn.textContent = 'Copy tweet'; }, 1200);
      }
    };
    const actionsRow = document.createElement('div');
    actionsRow.style.display = 'flex';
    actionsRow.style.alignItems = 'center';
    actionsRow.style.gap = '8px';
    actionsRow.style.flexWrap = 'wrap';
    actionsRow.style.marginTop = '2px';
    actionsRow.appendChild(copyBtn);

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.textContent = 'Select for posting';
    selectBtn.className = 'rt-pri-skills';
    selectBtn.style.padding = '6px 10px';
    selectBtn.onclick = () => {
      selectedTweet = tweet;
      selectButtons.forEach((btn) => { btn.textContent = 'Select for posting'; });
      selectBtn.textContent = 'Selected';
      postStatus.textContent = `Selected tweet ${idx + 1}.`;
      postStatus.style.color = '#9fe8d2';
      selectedTweetBox.textContent = tweet;
      openBtn.disabled = false;
      openBtn.style.opacity = '1';
    };
    selectButtons.push(selectBtn);
    actionsRow.appendChild(selectBtn);

    const markWrap = document.createElement('label');
    markWrap.style.display = 'inline-flex';
    markWrap.style.alignItems = 'center';
    markWrap.style.gap = '6px';
    markWrap.style.cursor = 'pointer';
    markWrap.style.padding = '4px 8px';
    markWrap.style.borderRadius = '0';
    markWrap.style.border = '2px solid var(--rt-border, #3d5260)';
    markWrap.style.background = 'var(--rt-bg-input, #0f151c)';

    const markCheckbox = document.createElement('input');
    markCheckbox.type = 'checkbox';
    markCheckbox.style.accentColor = '#25c07a';
    markCheckbox.style.cursor = 'pointer';

    const markText = document.createElement('span');
    markText.style.fontSize = '12px';
    markText.style.color = '#fff';
    const refreshMarkLabel = () => {
      const isMarked = postedSet.has(tweet);
      markCheckbox.checked = isMarked;
      markText.textContent = isMarked ? 'Published' : 'Mark published';
      markWrap.style.background = isMarked ? 'rgba(107, 155, 122, 0.25)' : 'var(--rt-bg-input, #0f151c)';
      markWrap.style.borderColor = isMarked ? 'var(--rt-accent-connect, #6b9b7a)' : 'var(--rt-border, #3d5260)';
    };
    refreshMarkLabel();
    markCheckbox.onchange = () => {
      if (postedSet.has(tweet)) postedSet.delete(tweet);
      else postedSet.add(tweet);
      if (liamWorker) liamWorker.liamPostedTweets = Array.from(postedSet);
      saveWorkersState();
      refreshMarkLabel();
      postStatus.textContent = postedSet.has(tweet)
        ? `Marked tweet ${idx + 1} as published.`
        : `Unmarked tweet ${idx + 1}.`;
      postStatus.style.color = '#9fe8d2';
    };
    markWrap.appendChild(markCheckbox);
    markWrap.appendChild(markText);
    actionsRow.appendChild(markWrap);
    card.appendChild(actionsRow);
    tweetsCol.appendChild(card);
  });

  openBtn.onclick = () => {
    if (!selectedTweet) {
      postStatus.textContent = 'Select a tweet first.';
      postStatus.style.color = '#ffb4b4';
      return;
    }
    openTweetIntent(selectedTweet);
    postStatus.textContent = 'Opened X composer with selected tweet.';
    postStatus.style.color = '#9fe8d2';
  };

  layout.appendChild(tweetsCol);
  layout.appendChild(rightCol);
  panel.appendChild(layout);
}

async function fetchNoahCryptoReport() {
  showNoahReport('Scoop Crypto Report', 'Loading today\'s crypto news...');
  try {
    const picked = await fetchCryptoNewsItems();
    const noahIndex = NAMES.indexOf('Scoop');
    if (noahIndex >= 0) {
      const noahWorker = workers.find((w) => w?.mesh?.userData?.nameIndex === noahIndex);
      if (noahWorker) {
        noahWorker.noahNewsLastAt = Date.now();
        addWorkerActivity(noahWorker, 'Shared crypto news report');
      }
    }
    showNoahReportNews(picked);
  } catch (err) {
    showNoahReport(
      'Scoop Crypto Report (error)',
      'Could not load public crypto news right now.\nSome free sources may be rate-limited, please try again shortly.',
      true
    );
  }
}

async function fetchLiamSocialTweets() {
  showNoahReport('Buzz Social Tweets', 'Building tweet ideas from today\'s crypto news...');
  try {
    const picked = await fetchCryptoNewsItems();
    const enriched = await buildLiamTweetsWithAI(picked);
    const liamIndex = NAMES.indexOf('Buzz');
    if (liamIndex >= 0) {
      const liamWorker = workers.find((w) => w?.mesh?.userData?.nameIndex === liamIndex);
      if (liamWorker) addWorkerActivity(liamWorker, 'Prepared social media tweets');
    }
    showLiamTweetIdeas(enriched);
  } catch (_) {
    try {
      const fallback = await fetchCryptoNewsItems();
      showLiamTweetIdeas(fallback);
    } catch (_) {
      showNoahReport(
        'Buzz Social Tweets (error)',
        'Could not load crypto news to build tweets right now.',
        true
      );
    }
  }
}

function showEthanMarketPanel(payload) {
  const panel = ensureNoahReportPanel();
  panel.style.width = 'min(760px, calc(100vw - 36px))';
  panel.style.maxHeight = '82vh';
  panel.style.display = 'block';
  panel.classList.remove('rt-terminal-surface--error');
  panel.innerHTML = '';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.justifyContent = 'space-between';
  header.style.gap = '8px';

  const h = document.createElement('strong');
  h.textContent = 'Quant Market Snapshot';
  h.style.color = '#9fe8d2';
  header.appendChild(h);

  const headerActions = document.createElement('div');
  headerActions.style.display = 'flex';
  headerActions.style.alignItems = 'center';
  headerActions.style.gap = '8px';

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.textContent = 'Refresh';
  refreshBtn.className = 'rt-pri-connect';
  refreshBtn.style.padding = '4px 10px';
  refreshBtn.style.fontSize = '16px';
  refreshBtn.onclick = () => {
    fetchEthanMarketSnapshot(true);
  };
  headerActions.appendChild(refreshBtn);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.className = 'rt-modal-close';
  closeBtn.onclick = () => {
    panel.style.display = 'none';
    hideEthanSummaryPanel();
    if (ethanLiveRefs?.ws) {
      ethanLiveRefs.ws.close();
      ethanLiveRefs.ws = null;
    }
    ethanLiveRefs = null;
  };
  headerActions.appendChild(closeBtn);
  header.appendChild(headerActions);
  panel.appendChild(header);

  const body = document.createElement('div');
  body.style.marginTop = '10px';
  body.style.display = 'grid';
  body.style.rowGap = '10px';

  const markets = Array.isArray(payload?.markets) ? payload.markets : [];
  const intervalLabel = String(payload?.interval || '4h');
  if (ethanLiveRefs?.ws) {
    ethanLiveRefs.ws.close();
    ethanLiveRefs.ws = null;
  }
  ethanLiveRefs = { bySymbol: {}, ws: null, panel };

  if (!markets.length) {
    const empty = document.createElement('div');
    empty.textContent = 'No market data available right now.';
    body.appendChild(empty);
  } else {
    markets.forEach((m) => {
      const binanceSym = (m.binanceSymbol || m.symbol?.replace('/', '') || '').toLowerCase();
      const card = document.createElement('div');
      card.style.padding = '10px';
      card.style.border = '2px solid var(--rt-border, #3d5260)';
      card.style.borderRadius = '0';
      card.style.background = 'var(--rt-bg-deep, #141c24)';

      const title = document.createElement('div');
      title.textContent = `${m.asset} (${m.symbol})`;
      title.style.fontWeight = '700';
      title.style.marginBottom = '6px';
      card.appendChild(title);

      const chartWrap = document.createElement('div');
      chartWrap.className = 'rt-chart-wrap';
      chartWrap.style.marginBottom = '8px';
      chartWrap.style.height = '180px';
      chartWrap.style.overflow = 'hidden';
      chartWrap.style.position = 'relative';
      const chartSvg = Array.isArray(m.klines) && m.klines.length
        ? createCandlestickSvg(m.klines, 640, 280)
        : createSparklineSvg(m.chartPoints, 640, 280);
      chartWrap.appendChild(chartSvg);
      const chartLabel = document.createElement('span');
      chartLabel.className = 'rt-chart-label';
      chartLabel.textContent = Array.isArray(m.klines) && m.klines.length ? '' : 'PRICE';
      chartLabel.style.position = 'absolute';
      chartLabel.style.top = '4px';
      chartLabel.style.right = '8px';
      chartLabel.style.fontSize = '14px';
      chartWrap.appendChild(chartLabel);
      card.appendChild(chartWrap);

      const price = document.createElement('div');
      price.textContent = Number.isFinite(m.price)
        ? `Price: $${Number(m.price).toLocaleString(undefined, { maximumFractionDigits: 6 })}`
        : 'Price: N/A';
      card.appendChild(price);

      if (binanceSym && Array.isArray(m.klines) && m.klines.length) {
        ethanLiveRefs.bySymbol[binanceSym] = {
          klines: [...m.klines],
          chartWrap,
          priceEl: price,
          chartLabel,
        };
      }

      const rsi = document.createElement('div');
      rsi.textContent = Number.isFinite(m.rsi)
        ? `RSI (${intervalLabel}): ${Number(m.rsi).toFixed(2)}`
        : `RSI (${intervalLabel}): N/A`;
      card.appendChild(rsi);

      const macd = document.createElement('div');
      macd.textContent = Number.isFinite(m.macd)
        ? `MACD (${intervalLabel}): ${Number(m.macd).toFixed(6)} | Signal: ${Number(m.macdSignal || 0).toFixed(6)} | Hist: ${Number(m.macdHist || 0).toFixed(6)}`
        : `MACD (${intervalLabel}): N/A`;
      card.appendChild(macd);

      const ema = document.createElement('div');
      ema.textContent = Number.isFinite(m.ema)
        ? `EMA20 (${intervalLabel}): ${Number(m.ema).toFixed(6)}`
        : `EMA20 (${intervalLabel}): N/A`;
      card.appendChild(ema);

      const bb = document.createElement('div');
      bb.textContent = Number.isFinite(m.bbUpper) && Number.isFinite(m.bbMiddle) && Number.isFinite(m.bbLower)
        ? `Bollinger (${intervalLabel}): Upper ${Number(m.bbUpper).toFixed(6)} | Mid ${Number(m.bbMiddle).toFixed(6)} | Lower ${Number(m.bbLower).toFixed(6)}`
        : `Bollinger (${intervalLabel}): N/A`;
      card.appendChild(bb);

      if (Array.isArray(m.warnings) && m.warnings.length) {
        const warn = document.createElement('div');
        warn.style.marginTop = '6px';
        warn.style.opacity = '0.8';
        warn.style.fontSize = '11px';
        warn.textContent = 'Note: some indicators are currently unavailable.';
        card.appendChild(warn);
      }

      body.appendChild(card);
    });
  }

  panel.appendChild(body);

  const hasLiveRefs = Object.keys(ethanLiveRefs.bySymbol).length > 0;
  if (hasLiveRefs) {
    const streams = Object.keys(ethanLiveRefs.bySymbol).map((s) => `${s}@kline_1m`).join('/');
    const wsUrl = `wss://stream.binance.com:9443/stream?streams=${streams}`;
    try {
      const ws = new WebSocket(wsUrl);
      ws.onmessage = (ev) => {
        if (!ethanLiveRefs?.bySymbol) return;
        if (ethanLiveRefs.panel?.style?.display === 'none') return;
        try {
          const msg = JSON.parse(ev.data);
          const stream = msg?.stream || '';
          const sym = stream.replace('@kline_1m', '').toLowerCase();
          const ref = ethanLiveRefs?.bySymbol?.[sym];
          if (!ref || !msg?.data?.k) return;
          const k = msg.data.k;
          const candle = [Number(k.t), k.o, k.h, k.l, k.c, k.v, Number(k.T)];
          let klines = ref.klines;
          const idx = klines.findIndex((c) => Number(c[0]) === Number(k.t));
          if (idx >= 0) {
            klines = [...klines];
            klines[idx] = candle;
          } else if (klines.length && Number(k.t) > Number(klines[klines.length - 1][0])) {
            klines = [...klines, candle].slice(-48);
          } else {
            return;
          }
          ref.klines = klines;
          const oldSvg = ref.chartWrap.querySelector('svg');
          if (oldSvg) oldSvg.remove();
          ref.chartWrap.insertBefore(createCandlestickSvg(klines, 640, 280), ref.chartWrap.firstChild);
          const closePrice = Number(k.c);
          if (Number.isFinite(closePrice)) {
            ref.priceEl.textContent = `Price: $${closePrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
          }
        } catch (_) {}
      };
      ws.onerror = () => {};
      ethanLiveRefs.ws = ws;
    } catch (_) {}
  }

  const advicePanel = ensureEthanSummaryPanel();
  advicePanel.style.display = 'block';
  advicePanel.innerHTML = '';

  const adviceHeader = document.createElement('div');
  adviceHeader.style.display = 'flex';
  adviceHeader.style.alignItems = 'center';
  adviceHeader.style.justifyContent = 'space-between';
  adviceHeader.style.gap = '8px';

  const adviceTitle = document.createElement('strong');
  adviceTitle.textContent = `Quant Signals (${intervalLabel})`;
  adviceTitle.style.color = '#9fe8d2';
  adviceHeader.appendChild(adviceTitle);

  const adviceCloseBtn = document.createElement('button');
  adviceCloseBtn.type = 'button';
  adviceCloseBtn.textContent = '×';
  adviceCloseBtn.className = 'rt-modal-close';
  adviceCloseBtn.onclick = () => {
    advicePanel.style.display = 'none';
  };
  adviceHeader.appendChild(adviceCloseBtn);
  advicePanel.appendChild(adviceHeader);

  const adviceBody = document.createElement('div');
  adviceBody.style.marginTop = '10px';
  adviceBody.style.display = 'grid';
  adviceBody.style.rowGap = '10px';

  markets.forEach((m) => {
    const signal = buildEthanSignal(m);
    const isBuy = signal.action === 'Buy';
    const card = document.createElement('div');
    card.style.padding = '10px';
    card.style.border = isBuy ? '2px solid rgba(95, 143, 114, 0.65)' : '2px solid rgba(160, 112, 112, 0.65)';
    card.style.borderRadius = '0';
    card.style.background = isBuy ? 'rgba(95, 143, 114, 0.12)' : 'rgba(160, 112, 112, 0.12)';

    const top = document.createElement('div');
    top.style.display = 'flex';
    top.style.alignItems = 'center';
    top.style.justifyContent = 'space-between';
    top.style.gap = '8px';

    const assetTitle = document.createElement('div');
    assetTitle.textContent = m.asset || 'Asset';
    assetTitle.style.fontWeight = '700';
    top.appendChild(assetTitle);

    const badge = document.createElement('span');
    badge.textContent = `${signal.action} (${signal.confidence})`;
    badge.style.fontSize = '14px';
    badge.style.fontWeight = '700';
    badge.style.padding = '2px 8px';
    badge.style.borderRadius = '0';
    badge.style.background = isBuy ? 'rgba(95, 143, 114, 0.25)' : 'rgba(160, 112, 112, 0.25)';
    badge.style.border = isBuy ? '2px solid rgba(95, 143, 114, 0.7)' : '2px solid rgba(160, 112, 112, 0.7)';
    badge.style.color = isBuy ? '#c8e8d4' : '#e0c8c8';
    top.appendChild(badge);

    card.appendChild(top);

    const reason = document.createElement('div');
    reason.style.marginTop = '6px';
    reason.style.fontSize = '12px';
    reason.style.opacity = '0.94';
    reason.innerHTML = signal.reasons.slice(0, 3).map((line) => `- ${line}`).join('<br>');
    card.appendChild(reason);

    const bbSummary = document.createElement('div');
    bbSummary.style.marginTop = '6px';
    bbSummary.style.fontSize = '12px';
    bbSummary.style.opacity = '0.9';
    bbSummary.textContent = `Bollinger: ${signal.bollingerLabel}`;
    card.appendChild(bbSummary);

    if (Number.isFinite(m.bbUpper) && Number.isFinite(m.bbMiddle) && Number.isFinite(m.bbLower)) {
      const bbValues = document.createElement('div');
      bbValues.style.marginTop = '4px';
      bbValues.style.fontSize = '11px';
      bbValues.style.opacity = '0.85';
      bbValues.textContent =
        `Upper ${Number(m.bbUpper).toFixed(4)} | Mid ${Number(m.bbMiddle).toFixed(4)} | Lower ${Number(m.bbLower).toFixed(4)}`;
      card.appendChild(bbValues);
    }

    const hasNews = m.newsRelevant && (m.newsReason || (Array.isArray(m.newsHeadlines) && m.newsHeadlines.length));
    if (hasNews) {
      const newsBox = document.createElement('div');
      newsBox.style.marginTop = '8px';
      newsBox.style.padding = '10px 12px';
      newsBox.style.borderRadius = '8px';
      newsBox.style.background = 'rgba(95, 142, 255, 0.14)';
      newsBox.style.border = '1px solid rgba(130, 176, 255, 0.35)';
      newsBox.style.fontSize = '12px';
      newsBox.style.lineHeight = '1.5';

      const label = document.createElement('div');
      label.style.fontWeight = '700';
      label.style.marginBottom = '6px';
      label.style.color = '#9fe8d2';
      label.textContent = 'News that may affect the price:';
      newsBox.appendChild(label);

      if (m.newsReason) {
        const reason = document.createElement('div');
        reason.style.marginBottom = '6px';
        reason.style.opacity = '0.95';
        reason.textContent = m.newsReason;
        newsBox.appendChild(reason);
      }

      if (Array.isArray(m.newsHeadlines) && m.newsHeadlines.length) {
        m.newsHeadlines.forEach((h) => {
          const headline = document.createElement('div');
          headline.style.marginTop = '5px';
          headline.style.fontSize = '11px';
          headline.style.opacity = '0.9';
          headline.style.paddingLeft = '8px';
          headline.style.borderLeft = '2px solid rgba(130, 176, 255, 0.4)';
          const title = typeof h === 'string' ? h : (h?.title || '');
          const source = typeof h === 'object' && h?.source ? `[${h.source}] ` : '';
          headline.textContent = source ? `${source}${String(title).slice(0, 150)}` : String(title).slice(0, 150);
          newsBox.appendChild(headline);
        });
      }
      card.appendChild(newsBox);
    }
    adviceBody.appendChild(card);
  });

  advicePanel.appendChild(adviceBody);
}

const ETHAN_TRADETECH_COINS = [
  { asset: 'Bitcoin', symbol: 'BTC/USDT', coinId: 'bitcoin', binanceSymbol: 'BTCUSDT' },
  { asset: 'Ethereum', symbol: 'ETH/USDT', coinId: 'ethereum', binanceSymbol: 'ETHUSDT' },
  { asset: 'Solana', symbol: 'SOL/USDT', coinId: 'solana', binanceSymbol: 'SOLUSDT' },
];

const CORS_PROXIES = [
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

async function fetchBinanceKlines(symbol, interval = '1m', limit = 48) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  try {
    const resp = await fetch(url, { headers: { accept: 'application/json' } });
    const data = await resp.json().catch(() => []);
    if (!resp.ok || !Array.isArray(data)) return [];
    return data;
  } catch (_) {
    for (const proxyFn of CORS_PROXIES) {
      try {
        const resp = await fetch(proxyFn(url), { headers: { accept: 'application/json' } });
        const raw = await resp.text();
        const data = raw ? JSON.parse(raw) : [];
        if (Array.isArray(data)) return data;
      } catch (__) {}
    }
    return [];
  }
}

async function fetchTradeTechDirect() {
  const params = new URLSearchParams({ currency: 'usd', days: '14' });
  params.append('indicator', 'rsi:window=14');
  params.append('indicator', 'macd:window_slow=26:window_fast=12:window_sign=9');
  params.append('indicator', 'ema:window=20');
  params.append('indicator', 'bollinger_bands:window=20:window_dev=2');

  const toNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const parseTs = (ts) => (ts && typeof ts === 'string' ? Date.parse(ts.replace(' ', 'T')) : NaN);

  const markets = [];
  for (const coin of ETHAN_TRADETECH_COINS) {
    try {
      params.set('coin_id', coin.coinId);
      const apiUrl = `https://apitradetech.com/crypto?${params.toString()}`;
      let data = null;
      for (const proxyFn of CORS_PROXIES) {
        try {
          const resp = await fetch(proxyFn(apiUrl), { headers: { accept: 'application/json' } });
          const raw = await resp.text();
          data = raw ? JSON.parse(raw) : {};
          if (resp.ok && data && typeof data === 'object') break;
        } catch (_) {}
      }
      if (!data || typeof data !== 'object') throw new Error('TradeTech unreachable');

      const entries = Object.entries(data || {})
        .filter(([ts]) => Number.isFinite(parseTs(ts)))
        .sort((a, b) => parseTs(a[0]) - parseTs(b[0]));
      if (!entries.length) throw new Error('No data');

      const latest = entries[entries.length - 1][1];
      const chartPoints = entries.map(([, v]) => toNum(v?.price)).filter((n) => n != null).slice(-48);
      const klines = await fetchBinanceKlines(coin.binanceSymbol || coin.symbol.replace('/', ''), '1m', 48);

      markets.push({
        asset: coin.asset,
        symbol: coin.symbol,
        price: toNum(latest?.price),
        rsi: toNum(latest?.rsi),
        macd: toNum(latest?.macd),
        macdSignal: toNum(latest?.macd_signal),
        macdHist: toNum(latest?.macd_diff),
        ema: toNum(latest?.ema),
        bbUpper: toNum(latest?.bb_bbh),
        bbMiddle: toNum(latest?.bb_bbm),
        bbLower: toNum(latest?.bb_bbl),
        newsRelevant: false,
        newsImpact: 0,
        newsReason: '',
        newsHeadlines: [],
        chartPoints,
        klines: klines.length ? klines : undefined,
        warnings: [],
      });
    } catch (err) {
      const klines = await fetchBinanceKlines(coin.binanceSymbol || coin.symbol.replace('/', ''), '1m', 48);
      markets.push({
        asset: coin.asset,
        symbol: coin.symbol,
        price: null,
        rsi: null,
        macd: null,
        macdSignal: null,
        macdHist: null,
        ema: null,
        bbUpper: null,
        bbMiddle: null,
        bbLower: null,
        newsRelevant: false,
        newsImpact: 0,
        newsReason: '',
        newsHeadlines: [],
        chartPoints: [],
        klines: klines.length ? klines : undefined,
        warnings: [err?.message || 'Unavailable'],
      });
    }
  }
  const newsEndpoints = [
    () => fetch('http://localhost:8787/api/ethan-news', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ markets }),
    }).then((r) => r.json()),
    () => fetch('/api/ethan-news', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ markets }),
    }).then((r) => r.json()),
  ];
  for (const fn of newsEndpoints) {
    try {
      const newsData = await fn();
      const impacts = newsData?.impacts || {};
      markets.forEach((m) => {
        const key = String(m.asset || '').toLowerCase();
        const impact = impacts[key];
        if (!impact) return;
        m.newsRelevant = !!impact.newsRelevant;
        m.newsImpact = Number.isFinite(impact.newsImpact) ? impact.newsImpact : 0;
        m.newsReason = impact.newsReason || '';
        m.newsHeadlines = Array.isArray(impact.newsHeadlines) ? impact.newsHeadlines : [];
      });
      break;
    } catch (_) {}
  }
  return { ok: true, interval: '4h', markets };
}

async function fetchIndicatorsOnly() {
  const sources = [
    () => fetch('http://localhost:8787/api/ethan-market-snapshot').then((r) => r.json()),
    () => fetch('/api/ethan-market').then((r) => r.json()),
    () => fetchTradeTechDirect(),
  ];
  for (const fn of sources) {
    try {
      const data = await fn();
      if (!data?.ok || !Array.isArray(data?.markets)) throw new Error('Invalid payload');
      return data;
    } catch (_) {}
  }
  return null;
}

async function fetchEthanMarketSnapshot(forceRefresh = false) {
  showNoahReport(
    'Quant Market Snapshot',
    forceRefresh ? 'Refreshing live BTC/ETH/SOL data...' : 'Loading BTC/ETH/SOL price, RSI and MACD...'
  );
  let data = null;
  try {
    data = await fetchIndicatorsOnly();
    if (!data?.ok || !Array.isArray(data?.markets)) throw new Error('No indicators');
    const klinesPromises = data.markets.map((m) => {
      const sym = (m.binanceSymbol || m.symbol?.replace('/', '') || '').toUpperCase();
      return sym ? fetchBinanceKlines(sym, '1m', 48) : Promise.resolve([]);
    });
    const klinesResults = await Promise.all(klinesPromises);
    data.markets.forEach((m, i) => {
      const klines = Array.isArray(klinesResults[i]) ? klinesResults[i] : [];
      m.klines = klines.length ? klines : undefined;
      if (klines.length) {
        const last = klines[klines.length - 1];
        const close = Number(last?.[4]);
        if (Number.isFinite(close)) m.price = close;
      }
    });
    showEthanMarketPanel(data);
    const ethanIndex = NAMES.indexOf('Quant');
    const ethanWorker = workers.find((w) => w?.mesh?.userData?.nameIndex === ethanIndex);
    if (ethanWorker) addWorkerActivity(ethanWorker, 'Shared BTC/ETH/SOL market snapshot');
    if (ethanWorker) ethanWorker.ethanSignalsLastAt = Date.now();
  } catch (err) {
    showNoahReport(
      'Quant Market Snapshot (error)',
      `Could not load market indicators right now.\n${err?.message || 'Unknown error'}`,
      true
    );
  }
}

function showEmmaWalletPanel() {
  hideEthanSummaryPanel();
  const panel = ensureNoahReportPanel();
  panel.style.width = 'min(1160px, calc(100vw - 28px))';
  panel.style.maxHeight = '84vh';
  panel.style.display = 'block';
  panel.classList.remove('rt-terminal-surface--error');
  panel.innerHTML = '';
  /* Wider lateral padding so the two-column layout is not flush to the modal border */
  panel.style.padding = '16px 28px 18px 28px';

  // ── Pieverse skill data ───────────────────────────────────────────────────
  const PIEVERSE_SKILLS = [
    { name: 'PancakeSwap Swap', cat: 'DeFi', price: 'Free', desc: 'Execute token swaps on PancakeSwap V3 with best-route calldata generation. Supports BNB, CAKE, and all BEP-20 tokens.' },
    { name: 'Four.Meme Launch', cat: 'DeFi', price: 'Free', desc: 'Create and launch meme tokens on four.meme launchpad. Handles auth, image upload, token config and on-chain tx via purr-cli.' },
    { name: 'Lista DAO Borrow', cat: 'DeFi', price: 'Free', desc: 'Borrow lisUSD against BNB collateral on Lista DAO. Manages CDP positions, collateral ratio checks and liquidation alerts.' },
    { name: 'Aster Yield', cat: 'DeFi', price: 'Free', desc: 'Deposit assets into Aster Protocol vaults to earn optimized yield. Auto-compounds and tracks APY across strategy pools.' },
    { name: 'pieUSD Stability', cat: 'DeFi', price: 'Free', desc: 'Mint, redeem and manage pieUSD stablecoin positions. Monitors peg deviation and executes arbitrage when off-peg.' },
    { name: 'Bitget Bridge', cat: 'DeFi', price: 'Free', desc: 'Cross-chain bridge assets between BNB Chain, Ethereum, Base and Arbitrum via Bitget Bridge aggregator with lowest fee routing.' },
    { name: 'x402b Pay', cat: 'Utility', price: '0.001 BNB/call', desc: 'Monetize any API endpoint with x402b micro-payment protocol. Agents pay per call using on-chain BNB micro-transactions.' },
    { name: 'ERC-8004 Agent', cat: 'Dev Tools', price: 'Free', desc: 'Deploy and interact with ERC-8004 compliant AI agents on BNB Chain. Standard interface for agent-to-agent coordination.' },
    { name: 'purr-cli Calldata', cat: 'Dev Tools', price: 'Free', desc: 'Generate raw EVM calldata for any DeFi protocol. CLI tool for PancakeSwap, Venus, Lista DAO — no SDK needed.' },
    { name: 'Venus Lend', cat: 'DeFi', price: 'Free', desc: 'Supply and borrow assets on Venus Protocol. Tracks health factor, auto-repays at risk threshold, claims XVS rewards.' },
    { name: 'BNB Staking', cat: 'DeFi', price: 'Free', desc: 'Delegate BNB to validators for staking rewards. Monitors APY across active validators and auto-claims + re-stakes.' },
    { name: 'BSC Price Feed', cat: 'On-chain', price: 'Free', desc: 'Real-time price oracle aggregating Chainlink, PancakeSwap TWAP and Binance API. Returns USD price for any BEP-20.' },
    { name: 'Wallet Tracker', cat: 'On-chain', price: 'Free', desc: 'Monitor any BNB Chain address for incoming txs, token transfers and NFT activity. Fires webhook/agent callback on events.' },
    { name: 'Twitter Sentiment', cat: 'AI/ML', price: '0.002 BNB/call', desc: 'Analyze Twitter/X sentiment for any token ticker. Returns bullish/bearish score, trending topics and influencer mentions.' },
    { name: 'Market Snapshot', cat: 'AI/ML', price: 'Free', desc: 'Summarize current DeFi market conditions: top movers, volume leaders, new launches and fear/greed index for BNB Chain.' },
    { name: 'Trade Signal', cat: 'Trading', price: '0.005 BNB/call', desc: 'AI-powered trade signal generator for BNB Chain tokens. Uses on-chain flow, momentum and social data to rank opportunities.' },
    { name: 'Copy Trade', cat: 'Trading', price: '0.003 BNB/call', desc: 'Mirror trades of top-performing wallets on BNB Chain. Filters by PnL, win rate and max drawdown before copying.' },
    { name: 'Sniper Bot', cat: 'Trading', price: '0.01 BNB/call', desc: 'Snipe new token launches on PancakeSwap and four.meme within ms of liquidity add. Configurable slippage and gas premium.' },
    { name: 'Telegram Alert', cat: 'Social Media', price: 'Free', desc: 'Send formatted alerts to any Telegram chat or channel. Supports markdown, inline buttons and callback query handling.' },
    { name: 'Discord Notify', cat: 'Social Media', price: 'Free', desc: 'Post rich embed messages to Discord webhooks. Includes price charts, wallet stats and DeFi position summaries.' },
    { name: 'Auto Poster', cat: 'Social Media', price: '0.001 BNB/call', desc: 'Generate and post AI-written token updates to Twitter/X, Telegram and Discord simultaneously from a single skill call.' },
    { name: 'Gas Optimizer', cat: 'Utility', price: 'Free', desc: 'Monitor BSC gas prices and batch transactions to minimize fees. Queues low-priority txs for execution at gas dips.' },
    { name: 'NFT Minter', cat: 'On-chain', price: 'Free', desc: 'Deploy ERC-721 and BEP-721 NFT contracts on BNB Chain. Supports metadata upload to IPFS, mint gating and royalties.' },
    { name: 'Portfolio Tracker', cat: 'Utility', price: 'Free', desc: 'Aggregate token balances, LP positions and staking rewards across all BNB Chain protocols into a single P&L dashboard.' },
  ];

  const CATEGORIES = ['All', 'DeFi', 'Trading', 'AI/ML', 'On-chain', 'Utility', 'Social Media', 'Dev Tools'];
  const CAT_COLORS = {
    'DeFi': '#5a7a8c', 'Trading': '#9a8060', 'AI/ML': '#7d7390',
    'On-chain': '#5f8f72', 'Utility': '#8f7a62', 'Social Media': '#8f7a88',
    'Dev Tools': '#6b7580', 'All': '#6b7280',
  };

  const SKILLS_PROMPT = PIEVERSE_SKILLS.map((s) =>
    `- ${s.name} [${s.cat}] (${s.price}): ${s.desc}`
  ).join('\n');
  const PIEVERSE_SKILL_STORE_URL = 'https://www.pieverse.io/skill-store';
  const PIEVERSE_SKILL_LINKS = {
    'four.meme launch': 'https://www.pieverse.io/skill-store?search=Four.Meme+Launch&skill=24927',
    'pancakeswap swap': 'https://www.pieverse.io/skill-store?search=Four.Meme+Launch&skill=24927',
    'lista dao borrow': 'https://www.pieverse.io/skill-store?search=Four.Meme+Launch&skill=27477',
    'copy trade': 'https://www.pieverse.io/skill-store?search=Four.Meme+Launch&skill=24111',
    'bnb staking': 'https://www.pieverse.io/skill-store?search=Four.Meme+Launch&skill=4555',
  };
  const getPieverseSkillUrl = (skillName) => {
    const key = String(skillName || '').trim().toLowerCase();
    if (PIEVERSE_SKILL_LINKS[key]) return PIEVERSE_SKILL_LINKS[key];
    return `${PIEVERSE_SKILL_STORE_URL}?search=${encodeURIComponent(String(skillName || ''))}`;
  };

  // ── Header ────────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;';

  const titleWrap = document.createElement('div');
  titleWrap.style.cssText = 'display:flex;align-items:center;gap:8px;';
  const titleIcon = document.createElement('span');
  titleIcon.textContent = '◈';
  titleIcon.style.cssText = 'font-size:24px;color:var(--rt-fg-phosphor,#9ed9b8);';
  const titleEl = document.createElement('strong');
  titleEl.textContent = 'Sage — Pieverse Skill Explorer';
  titleEl.style.cssText = 'font-size:26px;color:var(--rt-fg-phosphor,#9ed9b8);font-family:VT323,Consolas,monospace;font-weight:400;';
  const subEl = document.createElement('span');
  subEl.textContent = `${PIEVERSE_SKILLS.length} skills`;
  subEl.style.cssText = 'font-size:20px;color:var(--rt-fg-dim,#8fa89c);margin-left:6px;font-family:VT323,Consolas,monospace;';
  titleWrap.appendChild(titleIcon);
  titleWrap.appendChild(titleEl);
  titleWrap.appendChild(subEl);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.className = 'rt-modal-close';
  closeBtn.onclick = () => { panel.style.display = 'none'; };

  header.appendChild(titleWrap);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // ── Layout: left = skill explorer, right = AI chat ────────────────────────
  const layout = document.createElement('div');
  layout.style.cssText = 'display:grid;grid-template-columns:1fr 420px;gap:14px;height:calc(84vh - 80px);';

  // ── LEFT: category tabs + skill grid ─────────────────────────────────────
  const leftCol = document.createElement('div');
  leftCol.style.cssText = 'display:flex;flex-direction:column;gap:8px;min-height:0;';

  // Category filter tabs
  const tabRow = document.createElement('div');
  tabRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;flex-shrink:0;';

  // Skill grid — declared first so renderSkills() can reference it safely
  const skillGrid = document.createElement('div');
  skillGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;overflow-y:auto;flex:1;min-height:0;padding-right:4px;';

  let activeCategory = 'All';
  let activeTabEl = null;

  function setActiveTab(tabEl) {
    if (activeTabEl) {
      activeTabEl.style.background = 'var(--rt-bg-input,#0f151c)';
      activeTabEl.style.border = '2px solid var(--rt-border,#3d5260)';
    }
    activeTabEl = tabEl;
    activeTabEl.style.background = 'rgba(143,132,168,0.22)';
    activeTabEl.style.border = '2px solid var(--rt-accent-skills,#8f84a8)';
  }

  function renderSkills() {
    skillGrid.innerHTML = '';
    const filtered = activeCategory === 'All'
      ? PIEVERSE_SKILLS
      : PIEVERSE_SKILLS.filter((s) => s.cat === activeCategory);
    filtered.forEach((skill) => {
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--rt-bg-deep,#141c24);border:2px solid var(--rt-border,#3d5260);border-radius:0;padding:10px;cursor:pointer;';
      card.onmouseenter = () => { card.style.background = 'var(--rt-bg-panel,#1a2630)'; };
      card.onmouseleave = () => { card.style.background = 'var(--rt-bg-deep,#141c24)'; };
      card.title = `Open ${skill.name} in Pieverse`;
      card.onclick = () => {
        const url = getPieverseSkillUrl(skill.name);
        window.open(url, '_blank', 'noopener,noreferrer');
      };

      const cardTop = document.createElement('div');
      cardTop.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:6px;margin-bottom:5px;';

      const cardName = document.createElement('div');
      cardName.textContent = skill.name;
      cardName.style.cssText = 'font-size:22px;font-weight:400;color:var(--rt-fg,#e8e4d4);line-height:1.3;font-family:VT323,Consolas,monospace;';

      const catBadge = document.createElement('span');
      catBadge.textContent = skill.cat;
      catBadge.style.cssText = `font-size:10px;font-weight:600;padding:2px 6px;border-radius:0;white-space:nowrap;color:#e8e4d4;background:${CAT_COLORS[skill.cat] || '#6b7280'};flex-shrink:0;border:1px solid #3d5260;`;

      cardTop.appendChild(cardName);
      cardTop.appendChild(catBadge);

      const cardDesc = document.createElement('div');
      cardDesc.textContent = skill.desc;
      cardDesc.style.cssText = 'font-size:19px;color:var(--rt-fg-dim,#8fa89c);line-height:1.45;font-family:VT323,Consolas,monospace;';

      const cardPrice = document.createElement('div');
      cardPrice.textContent = skill.price;
      cardPrice.style.cssText = `font-size:20px;font-weight:400;margin-top:6px;font-family:VT323,Consolas,monospace;color:${skill.price === 'Free' ? '#6b9b7a' : '#b8956e'};`;

      card.appendChild(cardTop);
      card.appendChild(cardDesc);
      card.appendChild(cardPrice);
      skillGrid.appendChild(card);
    });
  }

  CATEGORIES.forEach((cat) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.textContent = cat;
    tab.dataset.cat = cat;
    tab.style.cssText = 'font-size:19px;font-weight:400;padding:5px 12px;border-radius:0;cursor:pointer;border:2px solid var(--rt-border,#3d5260);color:var(--rt-fg,#e8e4d4);background:var(--rt-bg-input,#0f151c);font-family:VT323,Consolas,monospace;';
    tab.onclick = () => {
      activeCategory = cat;
      setActiveTab(tab);
      renderSkills();
    };
    tabRow.appendChild(tab);
    if (cat === 'All') setActiveTab(tab); // highlight first tab immediately
  });

  leftCol.appendChild(tabRow);
  leftCol.appendChild(skillGrid);
  renderSkills();

  // ── RIGHT: AI chat assistant ───────────────────────────────────────────────
  const rightCol = document.createElement('div');
  rightCol.style.cssText = 'display:flex;flex-direction:column;gap:8px;background:var(--rt-bg-deep,#141c24);border:2px solid var(--rt-border,#3d5260);border-radius:0;padding:10px;min-height:0;';

  const chatTitle = document.createElement('div');
  chatTitle.style.cssText = 'font-size:26px;font-weight:400;color:var(--rt-fg-phosphor,#9ed9b8);flex-shrink:0;font-family:VT323,Consolas,monospace;';
  chatTitle.textContent = 'Ask Sage';

  const chatSubtitle = document.createElement('div');
  chatSubtitle.style.cssText = 'font-size:19px;color:var(--rt-fg-dim,#8fa89c);flex-shrink:0;margin-top:-4px;font-family:VT323,Consolas,monospace;';
  chatSubtitle.textContent = 'Describe what you want to build and Sage will recommend the best Pieverse skills.';

  const chatHistory = document.createElement('div');
  chatHistory.style.cssText = 'flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding-right:2px;';

  const getSkillByName = (name) => PIEVERSE_SKILLS.find((s) => s.name.toLowerCase() === String(name || '').toLowerCase());

  function addChatBubble(text, isUser) {
    const bubble = document.createElement('div');
    bubble.style.cssText = isUser
      ? 'align-self:flex-end;background:rgba(107,155,122,0.18);border:2px solid var(--rt-accent-connect,#6b9b7a);border-radius:0;padding:8px 11px;font-size:19px;color:var(--rt-fg,#e8e4d4);max-width:90%;line-height:1.5;white-space:pre-wrap;font-family:VT323,Consolas,monospace;'
      : 'align-self:flex-start;background:rgba(143,132,168,0.15);border:2px solid var(--rt-accent-skills,#8f84a8);border-radius:0;padding:8px 11px;font-size:19px;color:var(--rt-fg,#e8e4d4);max-width:95%;line-height:1.5;white-space:pre-wrap;font-family:VT323,Consolas,monospace;';
    bubble.textContent = text;
    chatHistory.appendChild(bubble);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    return bubble;
  }

  function addSageResponseBubble(answerText, recommendations = []) {
    const bubble = document.createElement('div');
    bubble.style.cssText = 'align-self:flex-start;background:rgba(143,132,168,0.15);border:2px solid var(--rt-accent-skills,#8f84a8);border-radius:0;padding:8px 11px;font-size:19px;color:var(--rt-fg,#e8e4d4);max-width:95%;line-height:1.5;white-space:pre-wrap;font-family:VT323,Consolas,monospace;';
    bubble.textContent = String(answerText || '').trim() || 'No response.';

    const recs = Array.isArray(recommendations) ? recommendations : [];
    if (recs.length) {
      const cardsWrap = document.createElement('div');
      cardsWrap.style.cssText = 'display:grid;gap:8px;margin-top:10px;';
      recs.slice(0, 6).forEach((rec) => {
        const skill = getSkillByName(rec?.skillName || rec?.name || '');
        if (!skill) return;
        const card = document.createElement('button');
        card.type = 'button';
        card.style.cssText = 'text-align:left;background:var(--rt-bg-deep,#141c24);border:2px solid var(--rt-border,#3d5260);border-radius:0;padding:9px 10px;cursor:pointer;color:var(--rt-fg,#e8e4d4);font-family:VT323,Consolas,monospace;';
        card.onmouseenter = () => { card.style.background = 'var(--rt-bg-panel,#1a2630)'; card.style.borderColor = 'var(--rt-accent-skills,#8f84a8)'; };
        card.onmouseleave = () => { card.style.background = 'var(--rt-bg-deep,#141c24)'; card.style.borderColor = 'var(--rt-border,#3d5260)'; };
        card.onclick = () => {
          const url = getPieverseSkillUrl(skill.name);
          window.open(url, '_blank', 'noopener,noreferrer');
        };

        const nm = document.createElement('div');
        nm.style.cssText = 'font-size:20px;line-height:1.2;color:var(--rt-fg-phosphor,#9ed9b8);';
        nm.textContent = skill.name;
        const why = document.createElement('div');
        why.style.cssText = 'font-size:17px;line-height:1.4;color:var(--rt-fg-dim,#8fa89c);margin-top:4px;';
        why.textContent = String(rec?.why || rec?.reason || skill.desc || '').trim();
        card.appendChild(nm);
        card.appendChild(why);
        cardsWrap.appendChild(card);
      });
      if (cardsWrap.children.length) bubble.appendChild(cardsWrap);
    }

    chatHistory.appendChild(bubble);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    return bubble;
  }

  // Welcome message
  addChatBubble('Hi! Tell me what you want to build — e.g. "I want to auto-trade new meme coins" or "I need to track whale wallets and post alerts to Telegram" — and I\'ll recommend the best skills from the Pieverse store.', false);

  const inputRow = document.createElement('div');
  inputRow.style.cssText = 'display:flex;gap:6px;flex-shrink:0;';

  const chatInput = document.createElement('textarea');
  chatInput.placeholder = 'Describe your idea...';
  chatInput.rows = 2;
  chatInput.style.cssText = 'flex:1;resize:none;background:var(--rt-bg-input,#0f151c);border:2px solid var(--rt-border,#3d5260);border-radius:0;color:var(--rt-fg,#e8e4d4);padding:8px 10px;font-size:20px;font-family:VT323,Consolas,monospace;outline:none;';

  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.textContent = '→';
  sendBtn.className = 'rt-pri-skills';
  sendBtn.style.cssText = 'padding:0 14px;font-size:24px;flex-shrink:0;';

  async function sendChat() {
    const query = chatInput.value.trim();
    if (!query) return;
    chatInput.value = '';
    sendBtn.disabled = true;
    addChatBubble(query, true);
    const thinkingBubble = addChatBubble('Sage is thinking...', false);
    thinkingBubble.style.opacity = '0.5';

    try {
      const isLocal = /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
      const base = isLocal ? 'http://localhost:8787' : window.location.origin;
      const resp = await fetch(base + '/api/emma-skills', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, skillsContext: SKILLS_PROMPT }),
      });
      const json = await resp.json().catch(() => ({}));
      const answer = json.answer || json.error || 'No response.';
      let recommendations = Array.isArray(json.recommendations) ? json.recommendations : [];
      if (!recommendations.length) {
        // Fallback: infer recommended skills from plain text response
        const lower = String(answer).toLowerCase();
        recommendations = PIEVERSE_SKILLS
          .filter((s) => lower.includes(s.name.toLowerCase()))
          .slice(0, 6)
          .map((s) => ({ skillName: s.name, why: s.desc }));
      }
      thinkingBubble.remove();
      addSageResponseBubble(answer, recommendations);

      const emmaIndex = NAMES.indexOf('Sage');
      const emmaWorker = workers.find((w) => w?.mesh?.userData?.nameIndex === emmaIndex);
      if (emmaWorker) {
        addWorkerActivity(emmaWorker, 'Explored Pieverse skills');
        saveWorkersState();
      }
    } catch (err) {
      thinkingBubble.textContent = `Error: ${err.message}`;
      thinkingBubble.style.opacity = '1';
      thinkingBubble.style.color = 'var(--rt-red-lo,#a07070)';
    } finally {
      sendBtn.disabled = false;
    }
  }

  sendBtn.onclick = sendChat;
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });

  inputRow.appendChild(chatInput);
  inputRow.appendChild(sendBtn);

  rightCol.appendChild(chatTitle);
  rightCol.appendChild(chatSubtitle);
  rightCol.appendChild(chatHistory);
  rightCol.appendChild(inputRow);

  layout.appendChild(leftCol);
  layout.appendChild(rightCol);
  panel.appendChild(layout);
}

// ─── Olivia four.meme state ───────────────────────────────────────────────────
let oliviaWalletAddress = '';
let oliviaAccessToken = '';
let oliviaConnectInFlight = false;
let oliviaConnectPromise = null;
let oliviaEvmProvider = null;

function getPreferredMetaMaskProvider() {
  const injected = window.ethereum;
  if (!injected) return null;
  const providers = Array.isArray(injected.providers) ? injected.providers : [injected];
  const metaMask = providers.find((p) => p && p.isMetaMask);
  return metaMask || providers[0] || null;
}

async function oliviaCallApi(payload) {
  const isLocal = /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
  const base = isLocal ? 'http://localhost:8787' : window.location.origin;
  const resp = await fetch(base + '/api/olivia-fourmeme', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error || resp.status);
  return json.data;
}

async function oliviaConnectWallet() {
  const injectedProvider = getPreferredMetaMaskProvider();
  if (!injectedProvider) throw new Error('MetaMask not found. Please install MetaMask.');
  if (oliviaConnectPromise) return oliviaConnectPromise;
  oliviaConnectPromise = (async () => {
    const existingAccounts = await injectedProvider.request({ method: 'eth_accounts' }).catch(() => []);
    let accounts = Array.isArray(existingAccounts) ? existingAccounts : [];
    if (accounts.length === 0) {
      const requested = await injectedProvider.request({ method: 'eth_requestAccounts' });
      accounts = Array.isArray(requested) ? requested : [];
    }
    if (!accounts.length) throw new Error('No wallet account authorized.');
    const ethLib = window.ethers;
    const chainId = await injectedProvider.request({ method: 'eth_chainId' });
    if (Number(chainId) !== 56) {
      try {
        await injectedProvider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x38' }] });
      } catch(e) {
        throw new Error('Please switch MetaMask to BNB Smart Chain (BSC).');
      }
    }
    oliviaEvmProvider = injectedProvider;
    const provider = new ethLib.BrowserProvider(injectedProvider);
    const signer = await provider.getSigner();
    return { provider, signer, address: await signer.getAddress() };
  })();
  try {
    return await oliviaConnectPromise;
  } finally {
    oliviaConnectPromise = null;
  }
}

async function oliviaAuthenticate(signer, address) {
  const nonceData = await oliviaCallApi({ action: 'auth-nonce', address: address.toLowerCase() });
  // New API: data is the nonce string directly
  const nonce = typeof nonceData?.data === 'string' ? nonceData.data
    : nonceData?.data?.nonce || nonceData?.nonce || nonceData;
  if (!nonce) throw new Error('Could not get nonce from four.meme');
  const message = 'You are sign in Meme ' + nonce;
  const signature = await signer.signMessage(message);
  const loginData = await oliviaCallApi({ action: 'auth-login', signature, wallet: address.toLowerCase() });
  // New API: data is the accessToken string directly
  const token = typeof loginData?.data === 'string' ? loginData.data
    : loginData?.data?.accessToken || loginData?.accessToken || loginData?.token;
  if (!token) throw new Error('Login failed: ' + JSON.stringify(loginData));
  return token;
}

function showOliviaCustomAgentPanel() {
  hideEthanSummaryPanel();
  const panel = ensureNoahReportPanel();
  panel.style.position = 'fixed';
  panel.style.left = '18px';
  panel.style.top = '70px';
  panel.style.right = 'auto';
  panel.style.width = 'min(1100px, calc(100vw - 36px))';
  panel.style.maxHeight = '86vh';
  panel.style.display = 'block';
  panel.style.padding = '0';
  panel.style.overflow = 'hidden';
  panel.innerHTML = '';

  const MANAGER2 = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';
  const HELPER3  = '0xF251F83e40a78868FcfA3FA4599Dad6494E46034';

  // ── Header ────────────────────────────────────────────────────────────────
  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:14px 16px 10px;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0;';
  const hdrLeft = document.createElement('div');
  const hdrTitle = document.createElement('div');
  hdrTitle.style.cssText = 'font:22px/1 VT323,Consolas,monospace;color:#b8956e;letter-spacing:0.06em;text-transform:uppercase;';
  hdrTitle.textContent = 'FORGE — Four.meme Agent';
  const hdrSub = document.createElement('div');
  hdrSub.style.cssText = 'font:18px/1 VT323,Consolas,monospace;color:#8fa89c;margin-top:4px;';
  hdrSub.textContent = 'BNB Chain meme token explorer and launchpad';
  hdrLeft.appendChild(hdrTitle); hdrLeft.appendChild(hdrSub);

  const walletBadge = document.createElement('div');
  walletBadge.style.cssText = 'display:flex;align-items:center;gap:8px;';
  const walletTxt = document.createElement('span');
  walletTxt.style.cssText = 'font:18px/1 VT323,Consolas,monospace;color:#8fa89c;';
  walletTxt.textContent = oliviaWalletAddress ? oliviaWalletAddress.slice(0,6)+'...'+oliviaWalletAddress.slice(-4) : 'Not connected';
  const connectBtn = document.createElement('button');
  connectBtn.type = 'button';
  connectBtn.textContent = oliviaWalletAddress ? 'Logout' : 'Connect Wallet';
  connectBtn.className = 'rt-pri-connect';
  connectBtn.style.cssText = 'padding:5px 10px;font:18px/1 VT323,Consolas,monospace;white-space:nowrap;';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.className = 'rt-modal-close';
  closeBtn.onclick = () => { panel.style.display = 'none'; };
  walletBadge.appendChild(walletTxt); walletBadge.appendChild(connectBtn); walletBadge.appendChild(closeBtn);
  hdr.appendChild(hdrLeft); hdr.appendChild(walletBadge);
  panel.appendChild(hdr);

  // ── Tab bar ───────────────────────────────────────────────────────────────
  const TABS = ['Rankings','Search','Token Info','Launch Token','Buy / Sell'];
  let activeTab = 0;
  const tabBar = document.createElement('div');
  tabBar.style.cssText = 'display:flex;gap:4px;padding:8px 12px;border-bottom:2px solid #3d5260;background:#0f151c;overflow-x:auto;scrollbar-width:none;flex-shrink:0;';
  const tabBtns = TABS.map((name, i) => {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.textContent = name;
    btn.style.cssText = 'padding:6px 14px;border-radius:0;border:2px solid #3d5260;background:#1a2630;font:18px/1 VT323,Consolas,monospace;color:#8fa89c;cursor:pointer;white-space:nowrap;flex-shrink:0;';
    btn.onclick = () => { activeTab = i; renderPanel(); };
    return btn;
  });
  tabBtns.forEach(b => tabBar.appendChild(b));
  panel.appendChild(tabBar);

  const body = document.createElement('div');
  body.style.cssText = 'overflow-y:auto;padding:14px 16px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.1) transparent;max-height:calc(86vh - 130px);';
  panel.appendChild(body);

  const statusBar = document.createElement('div');
  statusBar.style.cssText = 'font:16px/1.9 VT323,Consolas,monospace;color:#8fa89c;padding:4px 16px;border-top:2px solid #3d5260;background:#141c24;flex-shrink:0;';
  statusBar.textContent = 'Ready';
  panel.appendChild(statusBar);

  const setStatus = (txt, color) => { statusBar.textContent = txt; statusBar.style.color = color || '#8fa89c'; };

  const updateTabs = () => tabBtns.forEach((b, i) => {
    if (i === activeTab) {
      b.style.background = 'rgba(184, 149, 110, 0.2)';
      b.style.color = '#e8e4d4';
      b.style.borderColor = '#b8956e';
    } else {
      b.style.background = '#1a2630';
      b.style.color = '#8fa89c';
      b.style.borderColor = '#3d5260';
    }
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  const fmtNum = (n) => {
    const v = Number(n); if (!Number.isFinite(v)) return 'N/A';
    if (v >= 1e9) return (v/1e9).toFixed(1)+'B'; if (v >= 1e6) return (v/1e6).toFixed(1)+'M';
    if (v >= 1e3) return (v/1e3).toFixed(1)+'K'; return v.toFixed(2);
  };
  const mkInput = (placeholder, mono) => {
    const inp = document.createElement('input'); inp.type='text'; inp.placeholder=placeholder||'';
    inp.style.cssText = 'width:100%;padding:9px 12px;border-radius:0;border:2px solid #3d5260;background:#0f151c;color:#e8e4d4;font:'+(mono?'14px':'18px')+'/1.4 VT323,Consolas,monospace;outline:none;box-sizing:border-box;font-family:VT323,Consolas,monospace;';
    inp.onfocus=()=>{ inp.style.borderColor='#b8956e'; };
    inp.onblur=()=>{ inp.style.borderColor='#3d5260'; };
    return inp;
  };
  const mkBtn = (text, color) => {
    const b=document.createElement('button'); b.type='button'; b.textContent=text;
    const bg=color==='green'?'#1e3528':color==='red'?'#3a2528':'#3a3020';
    const fg='#e8e4d4';
    const bdr=color==='green'?'#6b9b7a':color==='red'?'#a07070':'#b8956e';
    b.style.cssText='padding:9px 18px;border-radius:0;border:2px solid '+bdr+';background:'+bg+';color:'+fg+';font:18px/1 VT323,Consolas,monospace;cursor:pointer;white-space:nowrap;flex-shrink:0;';
    b.onmouseenter=()=>{ b.style.filter='brightness(1.08)'; };
    b.onmouseleave=()=>{ b.style.filter=''; };
    return b;
  };
  const mkLabel = (text) => {
    const d=document.createElement('div');
    d.style.cssText='font:18px/1 VT323,Consolas,monospace;color:#8fa89c;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:6px;margin-top:12px;';
    d.textContent=text; return d;
  };
  const mkError = (msg) => {
    const d=document.createElement('div');
    d.style.cssText='color:#a07070;font:18px VT323,Consolas,monospace;padding:8px 0;'; d.textContent='Error: '+msg; return d;
  };
  const mkSuccess = (msg) => {
    const d=document.createElement('div');
    d.style.cssText='color:#9ed9b8;font:18px VT323,Consolas,monospace;padding:8px 0;word-break:break-all;'; d.textContent=msg; return d;
  };
  const mkSpinner = () => {
    const d=document.createElement('div'); d.style.cssText='display:flex;align-items:center;gap:10px;color:#8fa89c;font:18px VT323,Consolas,monospace;padding:12px 0;';
    const sp=document.createElement('div'); sp.className='chloe-term-spinner';
    const t=document.createElement('span'); t.textContent='Loading...'; d.appendChild(sp); d.appendChild(t); return d;
  };
  const extractTokenAddress = (apiResult, receipt) => {
    const candidates = [
      apiResult?.data?.tokenAddress,
      apiResult?.tokenAddress,
      apiResult?.data?.address,
      apiResult?.address,
      apiResult?.data?.token?.address,
      apiResult?.token?.address,
    ];
    for (const c of candidates) {
      const s = String(c || '').trim();
      if (/^0x[a-fA-F0-9]{40}$/.test(s)) return s;
    }
    if (Array.isArray(receipt?.logs)) {
      for (const lg of receipt.logs) {
        if (typeof lg?.address === 'string' && /^0x[a-fA-F0-9]{40}$/.test(lg.address)) {
          // Skip manager/helper contracts; keep first other contract as best effort token CA
          if (lg.address.toLowerCase() !== MANAGER2.toLowerCase() && lg.address.toLowerCase() !== HELPER3.toLowerCase()) {
            return lg.address;
          }
        }
      }
    }
    return '';
  };
  const showLaunchSuccessPopup = ({ txHash, tokenAddress, symbol }) => {
    const existing = document.getElementById('forge-launch-success-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'forge-launch-success-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:120;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const card = document.createElement('div');
    card.style.cssText = 'width:min(620px,96vw);background:#141c24;border:2px solid #3d5260;box-shadow:0 14px 40px rgba(0,0,0,0.5);padding:14px;';
    const title = document.createElement('div');
    title.textContent = 'Token Launched';
    title.style.cssText = 'font:28px/1 VT323,Consolas,monospace;color:#9ed9b8;margin-bottom:10px;';
    const sub = document.createElement('div');
    sub.textContent = tokenAddress ? 'Your token is live. Save this CA and links.' : 'Launch confirmed. CA not returned by API; use links below.';
    sub.style.cssText = 'font:18px/1.4 VT323,Consolas,monospace;color:#8fa89c;margin-bottom:12px;';

    const mkRow = (label, value, isLink) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:90px 1fr auto;gap:8px;align-items:center;border:2px solid #3d5260;background:#0f151c;padding:8px 10px;margin-bottom:8px;';
      const l = document.createElement('div'); l.textContent = label; l.style.cssText = 'font:18px VT323,Consolas,monospace;color:#8fa89c;';
      const v = document.createElement(isLink ? 'a' : 'div');
      if (isLink) { v.href = value; v.target = '_blank'; v.rel = 'noopener noreferrer'; }
      v.textContent = value || 'N/A';
      v.style.cssText = 'font:18px VT323,Consolas,monospace;color:#e8e4d4;word-break:break-all;';
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.textContent = 'Copy';
      copyBtn.className = 'rt-pri-connect';
      copyBtn.style.cssText = 'padding:4px 10px;font:16px/1 VT323,Consolas,monospace;';
      copyBtn.onclick = async () => {
        try { await navigator.clipboard.writeText(String(value || '')); copyBtn.textContent = 'Copied'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 900); } catch (_) {}
      };
      row.appendChild(l); row.appendChild(v); row.appendChild(copyBtn);
      return row;
    };

    const bscTx = txHash ? `https://bscscan.com/tx/${txHash}` : '';
    const fourToken = tokenAddress ? `https://four.meme/token/${tokenAddress}` : (symbol ? `https://four.meme/?search=${encodeURIComponent(symbol)}` : 'https://four.meme/');
    card.appendChild(title);
    card.appendChild(sub);
    card.appendChild(mkRow('CA', tokenAddress || 'Not available', false));
    card.appendChild(mkRow('TX', txHash || 'Not available', true));
    card.appendChild(mkRow('Token', fourToken, true));
    if (bscTx) card.appendChild(mkRow('BscScan', bscTx, true));

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.className = 'rt-pri-connect';
    close.style.cssText = 'margin-top:6px;padding:6px 12px;font:18px/1 VT323,Consolas,monospace;';
    close.onclick = () => overlay.remove();
    card.appendChild(close);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
  };

  const buildTokenCard = (token) => {
    const card=document.createElement('div');
    card.style.cssText='display:grid;grid-template-columns:44px 1fr auto;gap:10px;align-items:center;padding:10px 12px;border-radius:0;background:#141c24;border:2px solid #3d5260;margin-bottom:6px;cursor:pointer;';
    card.onmouseenter=()=>{ card.style.background='#1a2630'; card.style.borderColor='#b8956e'; };
    card.onmouseleave=()=>{ card.style.background='#141c24'; card.style.borderColor='#3d5260'; };
    const img=document.createElement('div');
    img.style.cssText='width:44px;height:44px;border-radius:0;background:rgba(184,149,110,0.15);border:1px solid #3d5260;display:flex;align-items:center;justify-content:center;font:700 20px VT323,Consolas,monospace;color:#b8956e;overflow:hidden;flex-shrink:0;';
    const rawImg=token.img||token.imageUrl||token.image||token.logo||token.logoUrl||token.icon||'';
    const imgSrc=rawImg?(rawImg.startsWith('http')?rawImg:'https://four.meme'+rawImg):'';
    if (imgSrc){ const im=document.createElement('img'); im.src=imgSrc; im.referrerPolicy='no-referrer'; im.crossOrigin='anonymous'; im.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:0;'; im.onerror=()=>{ img.removeChild(im); img.textContent=(token.shortName||token.symbol||token.name||'?')[0].toUpperCase(); }; img.appendChild(im); } else img.textContent=(token.shortName||token.symbol||token.name||'?')[0].toUpperCase();
    const info=document.createElement('div');
    const nm=document.createElement('div'); nm.style.cssText='font:20px/1.2 VT323,Consolas,monospace;color:#e8e4d4;'; nm.textContent=token.name||token.tokenName||'Unknown';
    const sym=document.createElement('div'); sym.style.cssText='font:16px/1 VT323,Consolas,monospace;color:#8fa89c;margin-top:3px;';
    const addr=(token.address||token.tokenAddress||''); sym.textContent=(token.symbol||token.tokenSymbol||'')+(addr?' · '+addr.slice(0,6)+'...'+addr.slice(-4):'');
    info.appendChild(nm); info.appendChild(sym);
    const stats=document.createElement('div'); stats.style.cssText='text-align:right;';
    const rp=token.price||token.lastPrice||token.priceUsd||0;
    const pr=document.createElement('div'); pr.style.cssText='font:18px/1 VT323,Consolas,monospace;color:#b8956e;'; pr.textContent=rp?'$'+Number(rp).toExponential(2):'--';
    const rm=token.cap||token.marketCap||token.mcap||token.totalUsd||token.marketValue||0;
    const mc=document.createElement('div'); mc.style.cssText='font:16px/1 VT323,Consolas,monospace;color:#6b9b7a;margin-top:4px;'; mc.textContent=rm?'LIQ '+Number(rm).toFixed(2)+' BNB':'LIQ --';
    stats.appendChild(pr); stats.appendChild(mc);
    card.appendChild(img); card.appendChild(info); card.appendChild(stats);
    if (addr) card.onclick=()=>window.open('https://four.meme/token/'+addr,'_blank','noopener,noreferrer');
    return card;
  };

  // ── Wallet connect ────────────────────────────────────────────────────────
  connectBtn.onclick = async () => {
    if (oliviaConnectInFlight || oliviaConnectPromise) return;
    if (oliviaWalletAddress) {
      oliviaWalletAddress=''; oliviaAccessToken=''; oliviaEvmProvider = null;
      walletTxt.textContent='Not connected'; connectBtn.textContent='Connect Wallet'; setStatus('Disconnected'); return;
    }
    oliviaConnectInFlight = true;
    connectBtn.disabled=true; connectBtn.textContent='Connecting...';
    try {
      const { signer, address } = await oliviaConnectWallet();
      setStatus('Signing in with four.meme...','#b8956e');
      const token = await oliviaAuthenticate(signer, address);
      oliviaWalletAddress=address; oliviaAccessToken=token;
      walletTxt.textContent=address.slice(0,6)+'...'+address.slice(-4);
      connectBtn.textContent='Logout';
      setStatus('Connected as '+address.slice(0,6)+'...'+address.slice(-4),'#9ed9b8');
    } catch(e) { setStatus('Error: '+e.message,'#f28b82'); connectBtn.textContent='Connect Wallet'; }
    connectBtn.disabled=false;
    oliviaConnectInFlight = false;
  };

  // ── RANKINGS ──────────────────────────────────────────────────────────────
  const fetchAndRenderList = async (payload, containerEl) => {
    containerEl.innerHTML=''; containerEl.appendChild(mkSpinner()); setStatus('Loading...');
    try {
      const data = await oliviaCallApi(payload);
      containerEl.innerHTML='';
      const list=data?.list||data?.data||data?.records||data?.tokens||(Array.isArray(data)?data:[]);
      if (!list.length){ containerEl.innerHTML='<div style="color:#8fa89c;font:18px VT323,Consolas,monospace;padding:12px 0;">No tokens found.</div>'; setStatus('No results'); return; }
list.forEach(t=>containerEl.appendChild(buildTokenCard(t))); setStatus(list.length+' tokens');
    } catch(e){ containerEl.innerHTML=''; containerEl.appendChild(mkError(e.message)); setStatus('Error','#f28b82'); }
  };

  const renderRankingsTab = () => {
    body.innerHTML='';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;align-items:start;';
    body.appendChild(grid);

    const columns = [
      { title: 'New', type: 'NEW' },
      { title: 'MCap', type: 'CAP' },
      { title: 'Graduated', type: 'DEX' },
    ];

    const listTargets = columns.map((col) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'background:#141c24;border:2px solid #3d5260;border-radius:0;padding:8px;min-height:220px;';
      const head = document.createElement('div');
      head.textContent = col.title;
      head.style.cssText = 'font:18px/1 VT323,Consolas,monospace;color:#b8956e;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #3d5260;';
      const list = document.createElement('div');
      list.style.cssText = 'max-height:60vh;overflow:auto;';
      wrap.appendChild(head);
      wrap.appendChild(list);
      grid.appendChild(wrap);
      return { type: col.type, list };
    });

    setStatus('Loading New / MCap / Graduated...');
    listTargets.forEach(({ type, list }) => {
      fetchAndRenderList({ action:'rankings', type, pageSize:20 }, list);
    });
  };

  // ── SEARCH ────────────────────────────────────────────────────────────────
  const renderSearch = () => {
    body.innerHTML='';
    const row=document.createElement('div'); row.style.cssText='display:flex;gap:8px;margin-bottom:12px;';
    const input=mkInput('Token name or symbol...');
    const btn=mkBtn('Search');
    const results=document.createElement('div');
    row.appendChild(input); row.appendChild(btn); body.appendChild(row); body.appendChild(results);
    const doSearch=async()=>{ const q=input.value.trim(); if(!q){input.focus();return;} btn.disabled=true; await fetchAndRenderList({action:'search',keyword:q,pageSize:20,type:'HOT'},results); btn.disabled=false; };
    btn.onclick=doSearch; input.addEventListener('keydown',e=>{if(e.key==='Enter')doSearch();}); setTimeout(()=>input.focus(),60);
  };

  // ── TOKEN INFO ────────────────────────────────────────────────────────────
  const renderTokenInfo = () => {
    body.innerHTML='';
    const row=document.createElement('div'); row.style.cssText='display:flex;gap:8px;margin-bottom:12px;';
    const input=mkInput('Token contract address (0x...)',true);
    const btn=mkBtn('Look up');
    const infoDiv=document.createElement('div');
    row.appendChild(input); row.appendChild(btn); body.appendChild(row); body.appendChild(infoDiv);
    const doLookup=async()=>{
      const addr=input.value.trim(); if(!addr){input.focus();return;}
      btn.disabled=true; infoDiv.innerHTML=''; infoDiv.appendChild(mkSpinner()); setStatus('Fetching...');
      try{
        const data=await oliviaCallApi({action:'token-info',address:addr});
        infoDiv.innerHTML=''; const t=data?.token||data?.data||data||{};
        infoDiv.appendChild(buildTokenCard(t));
        const extra=document.createElement('div'); extra.style.cssText='margin-top:10px;padding:12px;background:rgba(248,194,0,0.04);border:1px solid rgba(248,194,0,0.1);border-radius:10px;font:12px/1.9 system-ui,sans-serif;color:#c8c8cb;display:grid;gap:2px;';
        [['Address',t.address||t.tokenAddress||addr],['Status',t.status||t.state||'N/A'],['Total Supply',t.totalSupply?fmtNum(t.totalSupply):'N/A'],['Holders',t.holdAmount||t.holders||'N/A'],['Created',t.createTime?new Date(t.createTime).toLocaleString():'N/A'],['Label',t.label||t.tag||'N/A']].forEach(([k,v])=>{
          const r=document.createElement('div'); r.style.cssText='display:flex;gap:8px;';
          const kk=document.createElement('span'); kk.style.cssText='color:#5f6368;min-width:90px;flex-shrink:0;'; kk.textContent=k;
          const vv=document.createElement('span'); vv.style.cssText='color:#e8eaed;word-break:break-all;'; vv.textContent=String(v);
          r.appendChild(kk); r.appendChild(vv); extra.appendChild(r);
        });
        infoDiv.appendChild(extra); setStatus('Token info loaded');
      }catch(e){infoDiv.innerHTML=''; infoDiv.appendChild(mkError(e.message)); setStatus('Error','#f28b82');}
      btn.disabled=false;
    };
    btn.onclick=doLookup; input.addEventListener('keydown',e=>{if(e.key==='Enter')doLookup();}); setTimeout(()=>input.focus(),60);
  };

  // ── LAUNCH TOKEN ──────────────────────────────────────────────────────────
  const renderLaunch = () => {
    body.innerHTML='';
    if (!oliviaWalletAddress) {
      const note=document.createElement('div'); note.style.cssText='background:rgba(248,194,0,0.08);border:1px solid rgba(248,194,0,0.18);border-radius:10px;padding:18px;font:14px/1.7 system-ui;color:#c8c8cb;';
      note.innerHTML='<b style="color:#b8956e;display:block;margin-bottom:6px;">Wallet not connected</b>Click <b>Connect Wallet</b> at the top right to link your MetaMask and sign in to four.meme. Make sure you are on BNB Smart Chain.';
      body.appendChild(note); return;
    }
    const fields=[['Token Name *','name',''],['Symbol *','symbol',''],['Description *','description',''],['Image URL *','imageUrl','https://...'],['Category','label','Meme, AI, Defi, Games, Infra, Social, Others'],['Website','webUrl','https://...'],['Twitter','twitterUrl','https://x.com/...'],['Telegram','telegramUrl','https://t.me/...'],['Dev Buy (BNB)','devBuyBNB','0']];
    const inputs={};
    fields.forEach(([label,key,placeholder])=>{ body.appendChild(mkLabel(label)); const inp=mkInput(placeholder); inputs[key]=inp; body.appendChild(inp); });
    const launchBtn=mkBtn('Launch Token on four.meme');
    launchBtn.style.cssText+=';width:100%;margin-top:16px;padding:12px 18px;';
    body.appendChild(launchBtn);
    const resultDiv=document.createElement('div'); body.appendChild(resultDiv);

    launchBtn.onclick=async()=>{
      const name=inputs.name.value.trim(), symbol=inputs.symbol.value.trim().toUpperCase(), description=inputs.description.value.trim(), imageUrl=inputs.imageUrl.value.trim();
      if(!name||!symbol||!description||!imageUrl){ resultDiv.innerHTML=''; resultDiv.appendChild(mkError('Name, symbol, description and image URL are required.')); return; }
      if(!oliviaAccessToken){ resultDiv.innerHTML=''; resultDiv.appendChild(mkError('Connect wallet first.')); return; }
      launchBtn.disabled=true; launchBtn.textContent='Uploading image...'; resultDiv.innerHTML=''; resultDiv.appendChild(mkSpinner()); setStatus('Uploading image to four.meme...','#b8956e');
      try{
        // Step 1: Upload image to four.meme CDN
        const uploadResult=await oliviaCallApi({ action:'upload-image', imageUrl, accessToken:oliviaAccessToken });
        const cdnImgUrl=uploadResult?.data||uploadResult;
        if(!cdnImgUrl||typeof cdnImgUrl!=='string') throw new Error('Image upload failed. Response: '+JSON.stringify(uploadResult));

        // Step 2: Create token via API
        launchBtn.textContent='Creating token...'; setStatus('Creating token via four.meme API...','#b8956e');
        const devBuyBNB=inputs.devBuyBNB.value.trim()||'0';
        const apiResult=await oliviaCallApi({ action:'create-token-api', accessToken:oliviaAccessToken, name, symbol, description, imageUrl:cdnImgUrl, label:inputs.label.value.trim()||'Meme', webUrl:inputs.webUrl.value.trim()||undefined, twitterUrl:inputs.twitterUrl.value.trim()||undefined, telegramUrl:inputs.telegramUrl.value.trim()||undefined, devBuyBNB });
        const createArg=apiResult?.data?.createArg||apiResult?.createArg;
        const sig=apiResult?.data?.signature||apiResult?.signature;
        if(!createArg||!sig) throw new Error('API did not return createArg/signature. Response: '+JSON.stringify(apiResult));

        // Step 3: On-chain createToken
        launchBtn.textContent='Reading fees...'; setStatus('Reading contract fees...','#b8956e');
        const ethLib=window.ethers;
        const provider=new ethLib.BrowserProvider(oliviaEvmProvider || getPreferredMetaMaskProvider());
        const signer=await provider.getSigner();
        // Read _launchFee() and _tradingFeeRate() via direct provider.call (avoids underscore proxy issues)
        const readUint = async (sel) => {
          const r = await provider.call({ to: MANAGER2, data: sel });
          return r && r !== '0x' ? BigInt(r) : 0n;
        };
        const launchFee = await readUint('0x009523a2');       // _launchFee()
        const devBnb = parseFloat(devBuyBNB) || 0;
        let requiredValue = launchFee;
        if (devBnb > 0) {
          const tradingFeeRate = await readUint('0x3472aee7'); // _tradingFeeRate()
          const presaleWei = ethLib.parseEther(String(devBnb));
          const tradingFee = (presaleWei * tradingFeeRate) / 10000n;
          requiredValue = launchFee + presaleWei + tradingFee;
        }
        const managerAbi=['function createToken(bytes calldata createArg, bytes calldata signature) external payable'];
        const contractWithSigner=new ethLib.Contract(MANAGER2, managerAbi, signer);
        launchBtn.textContent='Confirm in wallet...'; setStatus('Confirm transaction in MetaMask... (value: '+(Number(requiredValue)/1e18).toFixed(4)+' BNB)','#b8956e');
        const tx=await contractWithSigner.createToken(createArg, sig, { value: requiredValue, gasLimit: 500000n });
        launchBtn.textContent='Confirming...'; resultDiv.innerHTML=''; setStatus('Waiting for confirmation...','#b8956e');
        const receipt=await tx.wait();
        const tokenAddress = extractTokenAddress(apiResult, receipt);
        resultDiv.innerHTML=''; resultDiv.appendChild(mkSuccess('Token launched! Tx hash: '+receipt.hash+(tokenAddress?(' · CA: '+tokenAddress):'')));
        showLaunchSuccessPopup({ txHash: receipt.hash, tokenAddress, symbol });
        setStatus('Token created successfully!','#9ed9b8');
      }catch(e){ resultDiv.innerHTML=''; resultDiv.appendChild(mkError(e.reason||e.message||String(e))); setStatus('Launch failed','#f28b82'); }
      launchBtn.disabled=false; launchBtn.textContent='Launch Token on four.meme';
    };
  };

  // ── BUY / SELL ────────────────────────────────────────────────────────────
  const renderTrade = () => {
    body.innerHTML='';
    if (!oliviaWalletAddress) {
      const note=document.createElement('div'); note.style.cssText='background:rgba(248,194,0,0.08);border:1px solid rgba(248,194,0,0.18);border-radius:10px;padding:18px;font:14px/1.7 system-ui;color:#c8c8cb;';
      note.innerHTML='<b style="color:#b8956e;display:block;margin-bottom:6px;">Wallet not connected</b>Click <b>Connect Wallet</b> at the top right.';
      body.appendChild(note); return;
    }
    const ethLib=window.ethers;
    const helperAbi=['function tryBuy(address token, uint256 amount, uint256 funds) external view returns (uint256)','function trySell(address token, uint256 amount) external view returns (uint256)'];
    const managerAbi=['function buyTokenAMAP(address token, uint256 funds, uint256 minAmount) external payable','function sellToken(address token, uint256 amount) external'];

    let tradeSub=0;
    const subBar=document.createElement('div'); subBar.style.cssText='display:flex;gap:6px;margin-bottom:14px;';
    const buySubBtn=document.createElement('button'); buySubBtn.type='button'; buySubBtn.textContent='Buy';
    const sellSubBtn=document.createElement('button'); sellSubBtn.type='button'; sellSubBtn.textContent='Sell';
    [buySubBtn,sellSubBtn].forEach(b=>{ b.style.cssText='flex:1;padding:9px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);font:700 13px system-ui;cursor:pointer;transition:background 0.14s,color 0.14s;'; });
    const tradeArea=document.createElement('div');
    const updateSubTabs=()=>{ buySubBtn.style.background=tradeSub===0?'rgba(34,197,94,0.15)':'transparent'; buySubBtn.style.color=tradeSub===0?'#22c55e':'#6a7585'; sellSubBtn.style.background=tradeSub===1?'rgba(239,68,68,0.15)':'transparent'; sellSubBtn.style.color=tradeSub===1?'#ef4444':'#6a7585'; };
    subBar.appendChild(buySubBtn); subBar.appendChild(sellSubBtn); body.appendChild(subBar); body.appendChild(tradeArea);

    const renderBuy=()=>{
      tradeArea.innerHTML='';
      tradeArea.appendChild(mkLabel('Token Address'));
      const addrInp=mkInput('0x...',true); tradeArea.appendChild(addrInp);
      tradeArea.appendChild(mkLabel('BNB Amount to spend'));
      const bnbInp=mkInput('e.g. 0.01'); tradeArea.appendChild(bnbInp);
      const quoteDiv=document.createElement('div'); quoteDiv.style.marginTop='8px'; tradeArea.appendChild(quoteDiv);
      const row=document.createElement('div'); row.style.cssText='display:flex;gap:8px;margin-top:12px;';
      const quoteBtn=document.createElement('button'); quoteBtn.type='button'; quoteBtn.textContent='Get Quote'; quoteBtn.style.cssText='flex:1;padding:9px;border-radius:8px;border:1px solid rgba(34,197,94,0.3);background:rgba(34,197,94,0.1);color:#22c55e;font:700 13px system-ui;cursor:pointer;';
      const buyBtn=mkBtn('Buy','green'); buyBtn.style.flex='1';
      row.appendChild(quoteBtn); row.appendChild(buyBtn); tradeArea.appendChild(row);
      quoteBtn.onclick=async()=>{
        const addr=addrInp.value.trim(), bnb=bnbInp.value.trim(); if(!addr||!bnb)return;
        quoteBtn.disabled=true; quoteDiv.innerHTML=''; setStatus('Getting quote...');
        try{ const provider=new ethLib.BrowserProvider(oliviaEvmProvider || getPreferredMetaMaskProvider()); const helper=new ethLib.Contract(HELPER3,helperAbi,provider); const fundsWei=ethLib.parseEther(bnb); const amount=await helper.tryBuy(addr,0n,fundsWei); quoteDiv.appendChild(mkSuccess('Expected: '+ethLib.formatUnits(amount,18)+' tokens')); setStatus('Quote ready'); }catch(e){ quoteDiv.appendChild(mkError(e.message)); setStatus('Error','#f28b82'); }
        quoteBtn.disabled=false;
      };
      buyBtn.onclick=async()=>{
        const addr=addrInp.value.trim(), bnb=bnbInp.value.trim(); if(!addr||!bnb){setStatus('Fill token address and BNB amount','#f28b82');return;}
        buyBtn.disabled=true; buyBtn.textContent='Buying...'; setStatus('Confirm in MetaMask...','#b8956e');
        try{ const provider=new ethLib.BrowserProvider(oliviaEvmProvider || getPreferredMetaMaskProvider()); const signer=await provider.getSigner(); const contract=new ethLib.Contract(MANAGER2,managerAbi,signer); const fundsWei=ethLib.parseEther(bnb); const tx=await contract.buyTokenAMAP(addr,fundsWei,0n,{value:fundsWei}); setStatus('Waiting for confirmation...','#b8956e'); const receipt=await tx.wait(); quoteDiv.innerHTML=''; quoteDiv.appendChild(mkSuccess('Bought! Tx: '+receipt.hash)); setStatus('Buy successful!','#9ed9b8'); }catch(e){ quoteDiv.innerHTML=''; quoteDiv.appendChild(mkError(e.reason||e.message)); setStatus('Error','#f28b82'); }
        buyBtn.disabled=false; buyBtn.textContent='Buy';
      };
    };

    const renderSell=()=>{
      tradeArea.innerHTML='';
      tradeArea.appendChild(mkLabel('Token Address'));
      const addrInp=mkInput('0x...',true); tradeArea.appendChild(addrInp);
      tradeArea.appendChild(mkLabel('Token Amount to sell'));
      const amtInp=mkInput('e.g. 1000000'); tradeArea.appendChild(amtInp);
      const quoteDiv=document.createElement('div'); quoteDiv.style.marginTop='8px'; tradeArea.appendChild(quoteDiv);
      const row=document.createElement('div'); row.style.cssText='display:flex;gap:8px;margin-top:12px;';
      const quoteBtn=document.createElement('button'); quoteBtn.type='button'; quoteBtn.textContent='Get Quote'; quoteBtn.style.cssText='flex:1;padding:9px;border-radius:8px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.1);color:#ef4444;font:700 13px system-ui;cursor:pointer;';
      const sellBtn=mkBtn('Sell','red'); sellBtn.style.flex='1';
      row.appendChild(quoteBtn); row.appendChild(sellBtn); tradeArea.appendChild(row);
      quoteBtn.onclick=async()=>{
        const addr=addrInp.value.trim(), amt=amtInp.value.trim(); if(!addr||!amt)return;
        quoteBtn.disabled=true; quoteDiv.innerHTML=''; setStatus('Getting quote...');
        try{ const provider=new ethLib.BrowserProvider(oliviaEvmProvider || getPreferredMetaMaskProvider()); const helper=new ethLib.Contract(HELPER3,helperAbi,provider); const amtWei=ethLib.parseUnits(amt,18); const funds=await helper.trySell(addr,amtWei); quoteDiv.appendChild(mkSuccess('Expected: '+ethLib.formatEther(funds)+' BNB')); setStatus('Quote ready'); }catch(e){ quoteDiv.appendChild(mkError(e.message)); setStatus('Error','#f28b82'); }
        quoteBtn.disabled=false;
      };
      sellBtn.onclick=async()=>{
        const addr=addrInp.value.trim(), amt=amtInp.value.trim(); if(!addr||!amt){setStatus('Fill token address and amount','#f28b82');return;}
        sellBtn.disabled=true; sellBtn.textContent='Selling...'; setStatus('Confirm in MetaMask...','#b8956e');
        try{ const provider=new ethLib.BrowserProvider(oliviaEvmProvider || getPreferredMetaMaskProvider()); const signer=await provider.getSigner(); const contract=new ethLib.Contract(MANAGER2,managerAbi,signer); const amtWei=ethLib.parseUnits(amt,18); const tx=await contract.sellToken(addr,amtWei); setStatus('Waiting for confirmation...','#b8956e'); const receipt=await tx.wait(); quoteDiv.innerHTML=''; quoteDiv.appendChild(mkSuccess('Sold! Tx: '+receipt.hash)); setStatus('Sell successful!','#9ed9b8'); }catch(e){ quoteDiv.innerHTML=''; quoteDiv.appendChild(mkError(e.reason||e.message)); setStatus('Error','#f28b82'); }
        sellBtn.disabled=false; sellBtn.textContent='Sell';
      };
    };

    buySubBtn.onclick=()=>{ tradeSub=0; updateSubTabs(); renderBuy(); };
    sellSubBtn.onclick=()=>{ tradeSub=1; updateSubTabs(); renderSell(); };
    updateSubTabs(); renderBuy();
  };

  // ── Main render ───────────────────────────────────────────────────────────
  const renderPanel = () => {
    updateTabs();
    if (activeTab===0) renderRankingsTab();
    else if (activeTab===1) renderSearch();
    else if (activeTab===2) renderTokenInfo();
    else if (activeTab===3) renderLaunch();
    else renderTrade();
  };
  renderPanel();
}


// Cámara ortográfica (vista tipo isométrica)
const aspect = window.innerWidth / window.innerHeight;
const frustum = 35;
const camera = new THREE.OrthographicCamera(
  -frustum * aspect, frustum * aspect,
  frustum, -frustum,
  0.1, 500
);
camera.position.set(18, 12, 18);
camera.lookAt(0, 1.6, 0);
camera.zoom = 3.2;
camera.updateProjectionMatrix();

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.42;
controls.target.set(0, 1.6, 0);
controls.minZoom = 1.2;
controls.maxZoom = 8;
controls.enableZoom = false;
controls.update();

// Zoom propio: muy poco por tick de scroll para control fino
const ZOOM_STEP = 0.04;
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.deltaY === 0) return;
  const sign = e.deltaY > 0 ? -1 : 1;
  camera.zoom = Math.max(1.2, Math.min(8, camera.zoom + sign * ZOOM_STEP));
  camera.updateProjectionMatrix();
}, { passive: false });

// --- Luces (más vida: principal + relleno + ambiente más cálido) ---
const ambient = new THREE.AmbientLight(0xffeedd, 0.55);
scene.add(ambient);
const dir = new THREE.DirectionalLight(0xfff5e8, 1.4);
dir.position.set(14, 22, 12);
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
dir.shadow.camera.near = 0.5;
dir.shadow.camera.far = 80;
dir.shadow.camera.left = -25;
dir.shadow.camera.right = 25;
dir.shadow.camera.top = 25;
dir.shadow.camera.bottom = -25;
dir.shadow.bias = -0.0001;
scene.add(dir);
const fill = new THREE.DirectionalLight(0xc8d4ff, 0.35);
fill.position.set(-8, 10, 5);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffe8c8, 0.25);
rim.position.set(0, 5, -10);
scene.add(rim);

// --- Suelo y paredes (un poco más vivos y con brillo sutil) ---
const floorGeo = new THREE.PlaneGeometry(40, 30);
const floorMat = new THREE.MeshStandardMaterial({
  color: 0xefe5d8,
  roughness: 0.6,
  metalness: 0.05,
});
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Base exterior verde (césped) alrededor de la oficina
const outsideGround = new THREE.Mesh(
  new THREE.PlaneGeometry(1200, 1200),
  new THREE.MeshBasicMaterial({
    color: GRASS_GREEN,
  })
);
outsideGround.rotation.x = -Math.PI / 2;
outsideGround.position.y = -0.03;
outsideGround.receiveShadow = true;
scene.add(outsideGround);

// Panel metálico generado por canvas
function makeMetalPanelTexture(size = 512, panels = 4) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cell = size / panels;

  // Fondo metálico gris claro con gradiente sutil
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0,    '#dde1e6');
  grad.addColorStop(0.45, '#eaedf1');
  grad.addColorStop(0.55, '#d8dce2');
  grad.addColorStop(1,    '#cdd2d8');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Variación sutil por panel (efecto laminado)
  for (let row = 0; row < panels; row++) {
    for (let col = 0; col < panels; col++) {
      const x = col * cell, y = row * cell;
      const brightness = 0.97 + Math.random() * 0.06;
      ctx.fillStyle = `rgba(${Math.round(255*brightness)},${Math.round(255*brightness)},${Math.round(255*brightness)},0.18)`;
      ctx.fillRect(x + 2, y + 2, cell - 4, cell - 4);
    }
  }

  // Juntas entre paneles
  ctx.strokeStyle = '#8a9299';
  ctx.lineWidth = 6;
  for (let i = 1; i < panels; i++) {
    ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(size, i * cell); ctx.stroke();
  }
  // Borde exterior
  ctx.strokeStyle = '#9aa2ac';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);

  // Tornillos en esquinas de cada panel
  const rivetR = size * 0.013;
  for (let row = 0; row <= panels; row++) {
    for (let col = 0; col <= panels; col++) {
      const rx = col * cell, ry = row * cell;
      // sombra
      ctx.beginPath();
      ctx.arc(rx, ry, rivetR + 1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fill();
      // cuerpo
      const rg = ctx.createRadialGradient(rx - rivetR * 0.3, ry - rivetR * 0.3, rivetR * 0.1, rx, ry, rivetR);
      rg.addColorStop(0, '#f0f2f5');
      rg.addColorStop(0.5, '#b0b8c2');
      rg.addColorStop(1, '#808890');
      ctx.beginPath();
      ctx.arc(rx, ry, rivetR, 0, Math.PI * 2);
      ctx.fillStyle = rg;
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

const panelTex = makeMetalPanelTexture(1024, 2);
panelTex.repeat.set(3, 1);
const panelBump = makeMetalPanelTexture(1024, 2);
panelBump.repeat.set(3, 1);

const wallMat = new THREE.MeshStandardMaterial({
  map: panelTex,
  bumpMap: panelBump,
  bumpScale: 0.4,
  roughness: 0.35,
  metalness: 0.55,
  envMapIntensity: 1.2,
});
function addWall(w, h, x, y, z, rx = 0, ry = 0) {
  const g = new THREE.PlaneGeometry(w, h);
  const m = new THREE.Mesh(g, wallMat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, 0);
  m.receiveShadow = true;
  scene.add(m);
}
addWall(40, 4, 0, 2, -15, 0, 0);
addWall(40, 4, 0, 2, 15, 0, Math.PI);
addWall(30, 4, -20, 2, 0, 0, Math.PI / 2);
addWall(30, 4, 20, 2, 0, 0, -Math.PI / 2);

// --- Sistema de tuberías / cableado industrial en paredes ---
{
  const matMain  = new THREE.MeshStandardMaterial({ color: 0x8a9aaa, roughness: 0.25, metalness: 0.9 });
  const matSec   = new THREE.MeshStandardMaterial({ color: 0x5e6e7e, roughness: 0.2,  metalness: 0.95 });
  const matRed   = new THREE.MeshStandardMaterial({ color: 0xbb2222, roughness: 0.7,  metalness: 0.0 });
  const matBlue  = new THREE.MeshStandardMaterial({ color: 0x2244bb, roughness: 0.7,  metalness: 0.0 });
  const matYellow= new THREE.MeshStandardMaterial({ color: 0xcc9900, roughness: 0.7,  metalness: 0.0 });
  const matGreen = new THREE.MeshStandardMaterial({ color: 0x228844, roughness: 0.7,  metalness: 0.0 });

  // Tubería horizontal a lo largo del eje X (para pared frontal/trasera)
  function pipeX(x0, x1, y, z, r, mat) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, Math.abs(x1 - x0), 10), mat);
    m.rotation.z = Math.PI / 2;
    m.position.set((x0 + x1) / 2, y, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }
  // Tubería horizontal a lo largo del eje Z (para pared lateral)
  function pipeZ(z0, z1, y, x, r, mat) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, Math.abs(z1 - z0), 10), mat);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, y, (z0 + z1) / 2);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }
  // Tubería vertical
  function pipeY(x, y0, y1, z, r, mat) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, Math.abs(y1 - y0), 10), mat);
    m.position.set(x, (y0 + y1) / 2, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }
  // Brida/conector en tubería horizontal X
  function flangeX(x, y, z, r, mat) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.85, r * 1.85, 0.05, 12), mat);
    m.rotation.z = Math.PI / 2;
    m.position.set(x, y, z);
    scene.add(m);
  }
  // Brida en tubería horizontal Z
  function flangeZ(x, y, z, r, mat) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.85, r * 1.85, 0.05, 12), mat);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, y, z);
    scene.add(m);
  }
  // Soporte/abrazadera de pared para tubería X
  function clampX(x, y, z, wallZ, mat) {
    const depth = Math.abs(z - wallZ);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, depth), mat);
    m.position.set(x, y, (z + wallZ) / 2);
    scene.add(m);
  }
  // Soporte/abrazadera de pared para tubería Z
  function clampZ(x, wallX, y, z, mat) {
    const depth = Math.abs(x - wallX);
    const m = new THREE.Mesh(new THREE.BoxGeometry(depth, 0.07, 0.07), mat);
    m.position.set((x + wallX) / 2, y, z);
    scene.add(m);
  }

  // Junta de esquina esférica
  function corner(x, y, z, r, mat) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r * 1.25, 12, 12), mat);
    m.position.set(x, y, z);
    scene.add(m);
  }

  // ── Pared trasera (z = -15, tuberías en z = -14.78) ──────────────────
  const BZ = -14.78;
  const LX = -19.78;
  const RX =  19.78;

  // Las tuberías principales llegan exactamente hasta la esquina (LX / RX)
  pipeX(LX, RX, 3.35, BZ, 0.058, matMain);
  pipeX(LX, RX, 2.55, BZ, 0.04,  matSec);
  pipeX(-15, RX, 0.9,  BZ, 0.024, matRed);
  pipeX(-15, RX, 0.81, BZ, 0.024, matBlue);
  pipeX(-15, RX, 0.72, BZ, 0.024, matYellow);
  // bajantes
  pipeY(-15, 0.72, 3.35, BZ, 0.04, matSec);
  pipeY(  3, 2.55, 3.35, BZ, 0.04, matSec);
  pipeY( 13, 2.55, 3.35, BZ, 0.04, matSec);
  // bridas
  [-15, 3, 13].forEach(x => flangeX(x, 3.35, BZ, 0.058, matMain));
  [3, 13].forEach(x => flangeX(x, 2.55, BZ, 0.04, matSec));
  flangeX(-15, 0.9, BZ, 0.04, matSec);
  // abrazaderas
  [-8, 0, 8].forEach(x => clampX(x, 3.35, BZ, -15, matSec));
  [-8, 4].forEach(x => clampX(x, 2.55, BZ, -15, matSec));

  // ── Pared izquierda (x = -20, tuberías en x = LX = -19.78) ──────────
  // Las tuberías laterales arrancan en BZ para encontrarse con la pared trasera
  pipeZ(BZ, 14, 3.35, LX, 0.058, matMain);
  pipeZ(BZ, 14, 2.55, LX, 0.04,  matSec);
  pipeZ( -8, 14, 0.9,  LX, 0.024, matRed);
  pipeZ( -8, 14, 0.81, LX, 0.024, matGreen);
  pipeY(LX, 0.81, 3.35, -8, 0.04, matSec);
  pipeY(LX, 2.55, 3.35,  4, 0.04, matSec);
  pipeY(LX, 2.55, 3.35, 10, 0.04, matSec);
  [-8, 4, 10].forEach(z => flangeZ(LX, 3.35, z, 0.058, matMain));
  [4, 10].forEach(z => flangeZ(LX, 2.55, z, 0.04, matSec));
  flangeZ(LX, 0.9, -8, 0.04, matSec);
  [-4, 2, 8].forEach(z => clampZ(LX, -20, 3.35, z, matSec));

  // ── Pared derecha (x = 20, tuberías en x = RX = 19.78) ──────────────
  pipeZ(BZ, 14, 3.35, RX, 0.058, matMain);
  pipeZ(BZ, 14, 2.55, RX, 0.04,  matSec);
  pipeZ( -6, 14, 0.9,  RX, 0.024, matBlue);
  pipeZ( -6, 14, 0.81, RX, 0.024, matYellow);
  pipeY(RX, 0.81, 3.35, -6, 0.04, matSec);
  pipeY(RX, 2.55, 3.35,  5, 0.04, matSec);
  pipeY(RX, 2.55, 3.35, 12, 0.04, matSec);
  [-6, 5, 12].forEach(z => flangeZ(RX, 3.35, z, 0.058, matMain));
  [5, 12].forEach(z => flangeZ(RX, 2.55, z, 0.04, matSec));
  flangeZ(RX, 0.9, -6, 0.04, matSec);
  [-2, 4, 10].forEach(z => clampZ(RX, 20, 3.35, z, matSec));

  // ── Juntas de esquina: esfera en cada intersección ───────────────────
  // Esquina trasera-izquierda
  corner(LX, 3.35, BZ, 0.058, matMain);
  corner(LX, 2.55, BZ, 0.04,  matSec);
  // Esquina trasera-derecha
  corner(RX, 3.35, BZ, 0.058, matMain);
  corner(RX, 2.55, BZ, 0.04,  matSec);
}

// Apliques de pared en la zona de reuniones (pared izquierda)
function addWallLamp(x, y, z) {
  const lamp = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.035, 0.22, 1.45),
    new THREE.MeshStandardMaterial({
      color: 0x474d56,
      roughness: 0.3,
      metalness: 0.5,
    })
  );
  base.position.x = 0.015;
  lamp.add(base);

  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(0.11, 0.14, 1.3),
    new THREE.MeshStandardMaterial({
      color: 0xcfd5dc,
      roughness: 0.4,
      metalness: 0.2,
    })
  );
  housing.position.x = 0.07;
  lamp.add(housing);

  const diffuser = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.09, 1.2),
    new THREE.MeshStandardMaterial({
      color: 0xf5f8ff,
      emissive: 0xe4eeff,
      emissiveIntensity: 1.1,
      roughness: 0.15,
      metalness: 0.02,
    })
  );
  diffuser.position.x = 0.12;
  lamp.add(diffuser);

  const wallLight = new THREE.PointLight(0xf0f6ff, 0.5, 9, 2);
  wallLight.position.x = 0.16;
  lamp.add(wallLight);

  lamp.position.set(x, y, z);
  lamp.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  scene.add(lamp);
}

addWallLamp(-19.9, 2.2, -14.0);
addWallLamp(-19.9, 2.2, -5.0);
addWallLamp(-19.9, 2.2, 4.0);
addWallLamp(-19.9, 2.2, 13.0);

// Máquina recreativa (arcade) en la pared izquierda - diseño retro mejorado
let arcadeScreenMat;
const maquinaRecreativa = new THREE.Group();
maquinaRecreativa.position.set(-19.75, 0, -9.5);
maquinaRecreativa.rotation.y = Math.PI / 2;

const arcadeW = 0.65;
const arcadeD = 0.45;
const arcadeH = 1.55;

const cabinetMat = new THREE.MeshStandardMaterial({
  color: 0xdc2626,
  roughness: 0.55,
  metalness: 0.1,
});
const arcadeCabinet = new THREE.Mesh(
  new THREE.BoxGeometry(arcadeW, arcadeH, arcadeD),
  cabinetMat
);
arcadeCabinet.position.y = arcadeH / 2;
arcadeCabinet.castShadow = arcadeCabinet.receiveShadow = true;
maquinaRecreativa.add(arcadeCabinet);

const bezelMat = new THREE.MeshStandardMaterial({
  color: 0x1e293b,
  roughness: 0.5,
  metalness: 0.2,
});
const arcadeBezel = new THREE.Mesh(
  new THREE.BoxGeometry(arcadeW - 0.08, 0.62, 0.04),
  bezelMat
);
arcadeBezel.position.set(0, arcadeH - 0.52, 0.22);
maquinaRecreativa.add(arcadeBezel);

arcadeScreenMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0x22d3ee,
  emissiveIntensity: 0.5,
  roughness: 0.1,
  metalness: 0.02,
});
const arcadeScreen = new THREE.Mesh(
  new THREE.BoxGeometry(arcadeW - 0.2, 0.48, 0.02),
  arcadeScreenMat
);
arcadeScreen.position.set(0, arcadeH - 0.52, 0.235);
arcadeScreen.userData.noRestore = true;
maquinaRecreativa.add(arcadeScreen);

const ctrlMat = new THREE.MeshStandardMaterial({
  color: 0x0a0a0a,
  roughness: 0.5,
  metalness: 0.35,
});
const arcadeControl = new THREE.Mesh(
  new THREE.BoxGeometry(arcadeW - 0.1, 0.14, arcadeD - 0.08),
  ctrlMat
);
arcadeControl.position.set(0, 0.52, 0.22);
maquinaRecreativa.add(arcadeControl);

const joystickMat = new THREE.MeshStandardMaterial({
  color: 0xfacc15,
  roughness: 0.4,
  metalness: 0.4,
});
const arcadeJoystick = new THREE.Mesh(
  new THREE.CylinderGeometry(0.035, 0.04, 0.08, 12),
  joystickMat
);
arcadeJoystick.position.set(-0.12, 0.52, 0.42);
arcadeJoystick.rotation.x = Math.PI / 2;
maquinaRecreativa.add(arcadeJoystick);

const btnColors = [0xef4444, 0x22c55e, 0x3b82f6, 0xf59e0b];
const arcadeBtns = [];
for (let i = 0; i < 4; i++) {
  const btn = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.028, 0.025, 12),
    new THREE.MeshStandardMaterial({ color: btnColors[i], roughness: 0.4, metalness: 0.35 })
  );
  btn.position.set(0.02 + i * 0.08, 0.52, 0.42);
  btn.rotation.x = Math.PI / 2;
  maquinaRecreativa.add(btn);
  arcadeBtns.push(btn);
}

const coinSlotMat = new THREE.MeshStandardMaterial({
  color: 0x64748b,
  roughness: 0.4,
  metalness: 0.5,
});
const arcadeCoinSlot = new THREE.Mesh(
  new THREE.BoxGeometry(0.12, 0.04, 0.02),
  coinSlotMat
);
arcadeCoinSlot.position.set(0.18, 0.38, 0.22);
maquinaRecreativa.add(arcadeCoinSlot);

const arcadeHighlightMeshes = [arcadeCabinet, arcadeScreen, arcadeBezel, arcadeControl, arcadeJoystick, arcadeCoinSlot, ...arcadeBtns];
const arcadeHoverHitbox = new THREE.Mesh(
  new THREE.BoxGeometry(arcadeW + 0.1, arcadeH + 0.1, arcadeD + 0.1),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
);
arcadeHoverHitbox.position.set(0, arcadeH / 2, 0.2);
maquinaRecreativa.add(arcadeHoverHitbox);
maquinaRecreativa.userData.highlightMeshes = arcadeHighlightMeshes;
maquinaRecreativa.userData.hoverHitbox = arcadeHoverHitbox;
let arcadeLabelEl = null;
if (CSS2DObject) {
  arcadeLabelEl = document.createElement('div');
  arcadeLabelEl.className = 'worker-label rt-worker-tag';
  arcadeLabelEl.style.display = 'none';
  arcadeLabelEl.style.visibility = 'hidden';
  arcadeLabelEl.style.userSelect = 'none';
  arcadeLabelEl.style.transform = 'translateY(-2px)';
  const arcadeLabelText = document.createElement('span');
  arcadeLabelText.className = 'rt-worker-tag-text';
  arcadeLabelText.textContent = 'Compete against the AI in crypto futures';
  arcadeLabelEl.appendChild(arcadeLabelText);
  const arcadeLabelObj = new CSS2DObject(arcadeLabelEl);
  arcadeLabelObj.position.set(0, arcadeH + 0.15, 0);
  maquinaRecreativa.add(arcadeLabelObj);
  maquinaRecreativa.userData.arcadeLabelEl = arcadeLabelEl;
}
maquinaRecreativa.traverse((obj) => {
  if (obj.isMesh) {
    obj.castShadow = true;
    obj.receiveShadow = true;
  }
});
scene.add(maquinaRecreativa);

// Papelera verde con tapa en una esquina (abajo-derecha)
const papeleraGroup = new THREE.Group();
const papeleraMat = new THREE.MeshStandardMaterial({
  color: 0x2d6a3e,
  roughness: 0.5,
  metalness: 0.1,
});
const papeleraCuerpo = new THREE.Mesh(
  new THREE.CylinderGeometry(0.22, 0.2, 0.48, 16),
  papeleraMat
);
papeleraCuerpo.position.y = 0.24;
papeleraCuerpo.castShadow = papeleraCuerpo.receiveShadow = true;
papeleraGroup.add(papeleraCuerpo);
const tapaMat = new THREE.MeshStandardMaterial({
  color: 0x3d7a4e,
  roughness: 0.45,
  metalness: 0.15,
});
const tapa = new THREE.Mesh(
  new THREE.CylinderGeometry(0.24, 0.24, 0.04, 16),
  tapaMat
);
tapa.position.y = 0.5;
tapa.castShadow = true;
papeleraGroup.add(tapa);
papeleraGroup.position.set(17, 0, -13);
scene.add(papeleraGroup);

// Máquina de refrescos pegada a la pared, cerca de la papelera
const maquinaRefrescos = new THREE.Group();
maquinaRefrescos.position.set(14, 0, -14.88);
const maquinaBodyMat = new THREE.MeshStandardMaterial({
  color: 0xe8e8e8,
  roughness: 0.5,
  metalness: 0.2,
});
const body = new THREE.Mesh(
  new THREE.BoxGeometry(0.7, 1.6, 0.5),
  maquinaBodyMat
);
body.position.y = 0.8;
body.castShadow = body.receiveShadow = true;
maquinaRefrescos.add(body);
const cristalMat = new THREE.MeshStandardMaterial({
  color: 0x6080a0,
  roughness: 0.15,
  metalness: 0.08,
});
const cristal = new THREE.Mesh(
  new THREE.BoxGeometry(0.58, 1.1, 0.02),
  cristalMat
);
cristal.position.set(0, 1.05, 0.26);
maquinaRefrescos.add(cristal);
const pantallaMat = new THREE.MeshStandardMaterial({
  color: 0x1e3a5f,
  roughness: 0.3,
  metalness: 0.1,
});
const pantalla = new THREE.Mesh(
  new THREE.BoxGeometry(0.35, 0.12, 0.02),
  pantallaMat
);
pantalla.position.set(0, 1.52, 0.26);
maquinaRefrescos.add(pantalla);
const dispensadorMat = new THREE.MeshStandardMaterial({
  color: 0x505560,
  roughness: 0.4,
  metalness: 0.25,
});
const dispensador = new THREE.Mesh(
  new THREE.BoxGeometry(0.25, 0.2, 0.05),
  dispensadorMat
);
dispensador.position.set(0, 0.15, 0.26);
maquinaRefrescos.add(dispensador);
scene.add(maquinaRefrescos);

// Mesa con microondas encima (pegada a la pared)
const mesaMicroondasMat = new THREE.MeshStandardMaterial({
  color: 0xb0a090,
  roughness: 0.5,
  metalness: 0.06,
});
const mesaMicroW = 0.9;
const mesaMicroD = 0.5;
const mesaMicroH = 0.75;
const mesaMicro = new THREE.Mesh(
  new THREE.BoxGeometry(mesaMicroW, mesaMicroH, mesaMicroD),
  mesaMicroondasMat
);
mesaMicro.position.set(11, mesaMicroH / 2, -14.88);
mesaMicro.castShadow = mesaMicro.receiveShadow = true;
scene.add(mesaMicro);
const microondas = new THREE.Group();
microondas.position.set(11, mesaMicroH, -14.88);
const microMat = new THREE.MeshStandardMaterial({
  color: 0xe0e0e0,
  roughness: 0.4,
  metalness: 0.25,
});
const microCuerpo = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.32, 0.38),
  microMat
);
microCuerpo.position.y = 0.16;
microCuerpo.castShadow = true;
microondas.add(microCuerpo);
const microPuerta = new THREE.Mesh(
  new THREE.BoxGeometry(0.36, 0.22, 0.02),
  new THREE.MeshStandardMaterial({ color: 0x303030, roughness: 0.3, metalness: 0.2 })
);
microPuerta.position.set(0, 0.16, 0.19);
microondas.add(microPuerta);
const microPanel = new THREE.Mesh(
  new THREE.BoxGeometry(0.15, 0.06, 0.02),
  new THREE.MeshStandardMaterial({ color: 0x202020, roughness: 0.3 })
);
microPanel.position.set(0.18, 0.28, 0.19);
microondas.add(microPanel);
scene.add(microondas);

// Mesa con fregadero y grifo al lado de la del microondas
const mesaFregadero = new THREE.Mesh(
  new THREE.BoxGeometry(0.9, mesaMicroH, 0.5),
  mesaMicroondasMat
);
mesaFregadero.position.set(10.1, mesaMicroH / 2, -14.88);
mesaFregadero.castShadow = mesaFregadero.receiveShadow = true;
scene.add(mesaFregadero);
const fregaderoGroup = new THREE.Group();
fregaderoGroup.position.set(10.1, mesaMicroH, -14.88);
const cubetaMat = new THREE.MeshStandardMaterial({
  color: 0xc0c0c0,
  roughness: 0.35,
  metalness: 0.4,
});
const cubeta = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.12, 0.35),
  cubetaMat
);
cubeta.position.set(0, 0.06, 0);
cubeta.castShadow = true;
fregaderoGroup.add(cubeta);
const interiorFregadero = new THREE.Mesh(
  new THREE.BoxGeometry(0.46, 0.08, 0.31),
  new THREE.MeshStandardMaterial({ color: 0xa0a8b0, roughness: 0.4, metalness: 0.35 })
);
interiorFregadero.position.set(0, 0.02, 0);
fregaderoGroup.add(interiorFregadero);
const grifoMat = new THREE.MeshStandardMaterial({
  color: 0xe8eef2,
  roughness: 0.12,
  metalness: 0.88,
});
const grifoBase = new THREE.Mesh(
  new THREE.CylinderGeometry(0.045, 0.055, 0.04, 16),
  grifoMat
);
grifoBase.position.set(0.22, 0.08, 0);
grifoBase.castShadow = true;
fregaderoGroup.add(grifoBase);
const grifoColumna = new THREE.Mesh(
  new THREE.CylinderGeometry(0.028, 0.032, 0.12, 16),
  grifoMat
);
grifoColumna.position.set(0.22, 0.16, 0);
grifoColumna.castShadow = true;
fregaderoGroup.add(grifoColumna);
const grifoArco = new THREE.Mesh(
  new THREE.TorusGeometry(0.065, 0.014, 8, 16),
  grifoMat
);
grifoArco.position.set(0.22, 0.245, -0.065);
grifoArco.rotation.x = Math.PI / 2;
grifoArco.rotation.z = Math.PI / 2;
grifoArco.castShadow = true;
fregaderoGroup.add(grifoArco);
const grifoPico = new THREE.Mesh(
  new THREE.CylinderGeometry(0.012, 0.014, 0.06, 12),
  grifoMat
);
grifoPico.position.set(0.22, 0.2, -0.14);
grifoPico.rotation.x = Math.PI / 2;
grifoPico.castShadow = true;
fregaderoGroup.add(grifoPico);
const mangoIzq = new THREE.Mesh(
  new THREE.CylinderGeometry(0.012, 0.012, 0.06, 10),
  grifoMat
);
mangoIzq.position.set(0.16, 0.14, 0);
mangoIzq.rotation.z = -Math.PI / 2;
mangoIzq.castShadow = true;
fregaderoGroup.add(mangoIzq);
const mangoDer = new THREE.Mesh(
  new THREE.CylinderGeometry(0.022, 0.022, 0.03, 12),
  grifoMat
);
mangoDer.position.set(0.28, 0.14, 0);
mangoDer.rotation.z = Math.PI / 2;
mangoDer.castShadow = true;
fregaderoGroup.add(mangoDer);
scene.add(fregaderoGroup);

// Estantería con libros pegada a la pared (z = -15)
const shelfMat = new THREE.MeshStandardMaterial({
  color: 0x8b6914,
  roughness: 0.5,
  metalness: 0.05,
});
const shelfW = 1.9;
const shelfH = 1.8;
const shelfD = 0.28;
const estanteria = new THREE.Group();
estanteria.position.set(0, 0, -14.86);
const leftPanel = new THREE.Mesh(
  new THREE.BoxGeometry(0.08, shelfH, shelfD),
  shelfMat
);
leftPanel.position.set(-shelfW / 2 + 0.04, shelfH / 2, 0);
leftPanel.castShadow = true;
estanteria.add(leftPanel);
const rightPanel = new THREE.Mesh(
  new THREE.BoxGeometry(0.08, shelfH, shelfD),
  shelfMat
);
rightPanel.position.set(shelfW / 2 - 0.04, shelfH / 2, 0);
rightPanel.castShadow = true;
estanteria.add(rightPanel);
const numShelves = 4;
for (let s = 0; s < numShelves; s++) {
  const shelf = new THREE.Mesh(
    new THREE.BoxGeometry(shelfW - 0.1, 0.04, shelfD),
    shelfMat
  );
  shelf.position.set(0, 0.25 + s * (shelfH - 0.3) / (numShelves - 1), 0);
  shelf.castShadow = shelf.receiveShadow = true;
  estanteria.add(shelf);
}
const bookColors = [0x8b4513, 0x2e5090, 0x8b2635, 0x1a5f3a, 0x5c4033, 0x4a4a6a, 0x6b2d3a];
for (let s = 0; s < numShelves; s++) {
  const shelfY = 0.27 + s * (shelfH - 0.35) / (numShelves - 1);
  const bookHeight = 0.26;
  let x = -shelfW / 2 + 0.15;
  while (x < shelfW / 2 - 0.1) {
    const grosor = 0.04 + Math.random() * 0.04;
    const ancho = 0.2 + Math.random() * 0.12;
    const book = new THREE.Mesh(
      new THREE.BoxGeometry(grosor, bookHeight, ancho),
      new THREE.MeshStandardMaterial({
        color: bookColors[Math.floor(Math.random() * bookColors.length)],
        roughness: 0.7,
        metalness: 0,
      })
    );
    book.position.set(x + grosor / 2, shelfY + 0.02 + bookHeight / 2, 0);
    book.castShadow = true;
    estanteria.add(book);
    x += grosor + 0.01;
  }
}
scene.add(estanteria);

// Dos cuadros con paisaje en la pared de la estantería
function crearCuadroPaisaje(ancho, alto, x, y) {
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x5c4033,
    roughness: 0.6,
    metalness: 0.05,
  });
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 96);
  grad.addColorStop(0, '#87CEEB');
  grad.addColorStop(0.5, '#B0E0E6');
  grad.addColorStop(0.65, '#90EE90');
  grad.addColorStop(1, '#228B22');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 96);
  ctx.fillStyle = '#FFD700';
  ctx.beginPath();
  ctx.arc(100, 25, 15, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const cuadro = new THREE.Group();
  const marco = new THREE.Mesh(
    new THREE.BoxGeometry(ancho + 0.08, alto + 0.08, 0.04),
    frameMat
  );
  marco.position.set(0, 0, 0);
  marco.castShadow = true;
  cuadro.add(marco);
  const lienzo = new THREE.Mesh(
    new THREE.PlaneGeometry(ancho, alto),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
  );
  lienzo.position.set(0, 0, 0.022);
  cuadro.add(lienzo);
  cuadro.position.set(x, y, -14.98);
  return cuadro;
}
scene.add(crearCuadroPaisaje(1.2, 0.9, -5.5, 1.4));

// Cuadro con imagen chart.png (raíz del proyecto)
function crearCuadroImagen(ancho, alto, x, y, urlImagen) {
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x5c4033,
    roughness: 0.6,
    metalness: 0.05,
  });
  const cuadro = new THREE.Group();
  const marco = new THREE.Mesh(
    new THREE.BoxGeometry(ancho + 0.08, alto + 0.08, 0.04),
    frameMat
  );
  marco.position.set(0, 0, 0);
  marco.castShadow = true;
  cuadro.add(marco);
  const loader = new THREE.TextureLoader();
  loader.load(urlImagen, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    const lienzo = new THREE.Mesh(
      new THREE.PlaneGeometry(ancho, alto),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
    );
    lienzo.position.set(0, 0, 0.022);
    cuadro.add(lienzo);
  }, undefined, () => {
    const lienzo = new THREE.Mesh(
      new THREE.PlaneGeometry(ancho, alto),
      new THREE.MeshBasicMaterial({ color: 0x444444, side: THREE.DoubleSide })
    );
    lienzo.position.set(0, 0, 0.022);
    cuadro.add(lienzo);
  });
  cuadro.position.set(x, y, -14.98);
  return cuadro;
}
scene.add(crearCuadroImagen(1.2, 0.9, 5.5, 1.4, 'chart.png'));

// --- Muebles (colores más vivos y brillo sutil) ---
const deskMat = new THREE.MeshStandardMaterial({
  color: 0xd4b080,
  roughness: 0.45,
  metalness: 0.08,
});
const chairMat = new THREE.MeshStandardMaterial({
  color: 0x505060,
  roughness: 0.4,
  metalness: 0.15,
});
const monitorMat = new THREE.MeshStandardMaterial({
  color: 0x404050,
  roughness: 0.35,
  metalness: 0.2,
});
const monitorScreenMat = new THREE.MeshStandardMaterial({
  color: 0x1a1a22,
  roughness: 0.2,
  metalness: 0.05,
});
const deskDisplayMeshes = [];

const computerGifCanvas = document.createElement('canvas');
computerGifCanvas.width = 500;
computerGifCanvas.height = 300;
const computerGifCtx = computerGifCanvas.getContext('2d');
const computerGifTexture = new THREE.CanvasTexture(computerGifCanvas);
computerGifTexture.colorSpace = THREE.SRGBColorSpace;
computerGifTexture.minFilter = THREE.LinearFilter;
computerGifTexture.magFilter = THREE.LinearFilter;
computerGifTexture.generateMipmaps = false;
let computerGifReady = false;
const computerGifImage = new Image();
computerGifImage.src = new URL('../computer.gif', import.meta.url).href;
computerGifImage.onload = () => {
  computerGifReady = true;
};

function updateComputerGifTexture() {
  if (!computerGifReady || !computerGifCtx) return;
  computerGifCtx.clearRect(0, 0, computerGifCanvas.width, computerGifCanvas.height);
  computerGifCtx.drawImage(computerGifImage, 0, 0, computerGifCanvas.width, computerGifCanvas.height);
  computerGifTexture.needsUpdate = true;
}

// Silla normal: patas + asiento + respaldo
function officeChair() {
  const g = new THREE.Group();
  const legH = 0.36;
  const legSize = 0.06;
  const legPos = 0.2;
  const legGeo = new THREE.BoxGeometry(legSize, legH, legSize);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    const leg = new THREE.Mesh(legGeo, chairMat);
    leg.position.set(sx * legPos, legH / 2, sz * legPos);
    leg.castShadow = true;
    g.add(leg);
  });
  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(0.48, 0.08, 0.48),
    chairMat
  );
  seat.position.y = legH + 0.04;
  seat.castShadow = true;
  g.add(seat);
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(0.48, 0.4, 0.08),
    chairMat
  );
  back.position.set(0, legH + 0.28, -0.24);
  back.castShadow = true;
  g.add(back);
  return g;
}

// Ordenador: monitor con pantalla oscura + base/soporte
function computer() {
  const g = new THREE.Group();
  const stand = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.1, 0.14),
    monitorMat
  );
  stand.position.y = 0.78;
  stand.castShadow = true;
  g.add(stand);
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.3, 0.025),
    monitorMat
  );
  screen.position.y = 1.0;
  screen.castShadow = true;
  g.add(screen);
  const display = new THREE.Mesh(
    new THREE.PlaneGeometry(0.4, 0.24),
    monitorScreenMat.clone()
  );
  display.position.set(0, 1.0, 0.014);
  g.add(display);
  g.userData.display = display;

  // Teclado low-poly sobre el escritorio, delante del monitor.
  const keyboardBase = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.018, 0.14),
    new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.5,
      metalness: 0.08,
    })
  );
  keyboardBase.position.set(0, 0.748, 0.22);
  keyboardBase.castShadow = keyboardBase.receiveShadow = true;
  g.add(keyboardBase);

  const keyboardTop = new THREE.Mesh(
    new THREE.BoxGeometry(0.33, 0.006, 0.12),
    new THREE.MeshStandardMaterial({
      color: 0x1f1f1f,
      roughness: 0.45,
      metalness: 0.04,
    })
  );
  keyboardTop.position.set(0, 0.76, 0.22);
  keyboardTop.castShadow = true;
  g.add(keyboardTop);
  return g;
}

// Sofá: asiento + respaldo + brazos (estilo imagen)
const sofaMat = (c) => new THREE.MeshStandardMaterial({
  color: c,
  roughness: 0.55,
  metalness: 0.02,
});
function sofa(seats, color, x, z) {
  const group = new THREE.Group();
  const seatW = seats === 2 ? 1.8 : seats === 1 ? 0.95 : 2.6;
  const seatD = 0.85;
  const seatH = 0.42;
  const backH = 0.6;
  const armH = 0.5;
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(seatW, seatH, seatD),
    sofaMat(color)
  );
  base.position.y = seatH / 2;
  base.castShadow = base.receiveShadow = true;
  group.add(base);
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(seatW, backH, 0.12),
    sofaMat(color)
  );
  back.position.set(0, seatH + backH / 2, -seatD / 2 - 0.02);
  back.castShadow = true;
  group.add(back);
  const armL = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, armH, seatD),
    sofaMat(color)
  );
  armL.position.set(-seatW / 2 - 0.04, seatH / 2 + armH / 2, 0);
  armL.castShadow = true;
  group.add(armL);
  const armR = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, armH, seatD),
    sofaMat(color)
  );
  armR.position.set(seatW / 2 + 0.04, seatH / 2 + armH / 2, 0);
  armR.castShadow = true;
  group.add(armR);
  group.position.set(x, 0, z);
  return group;
}

function officePlant(x, z, scale = 1) {
  const g = new THREE.Group();
  const leafScale = scale;
  const leafHeightBoost = 1.7;
  const potScale = 1.12;

  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.105 * potScale, 0.095 * potScale, 0.28 * potScale, 16),
    new THREE.MeshStandardMaterial({
      color: 0xe8ddd0,
      roughness: 0.82,
      metalness: 0.01,
    })
  );
  pot.position.y = 0.14 * potScale;
  pot.castShadow = pot.receiveShadow = true;
  g.add(pot);

  const soil = new THREE.Mesh(
    new THREE.CylinderGeometry(0.083 * potScale, 0.083 * potScale, 0.02 * potScale, 12),
    new THREE.MeshStandardMaterial({
      color: 0x5b4a3f,
      roughness: 0.9,
      metalness: 0,
    })
  );
  soil.position.y = 0.28 * potScale;
  g.add(soil);

  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x88d8c8,
    roughness: 0.42,
    metalness: 0.03,
  });

  const centerLeaf = new THREE.Mesh(
    new THREE.ConeGeometry(0.03 * leafScale, 0.34 * leafScale * leafHeightBoost, 5),
    leafMat
  );
  centerLeaf.position.y = 0.28 + 0.17 * leafScale * leafHeightBoost;
  centerLeaf.castShadow = centerLeaf.receiveShadow = true;
  g.add(centerLeaf);

  const sideLeafA = new THREE.Mesh(
    new THREE.ConeGeometry(0.022 * leafScale, 0.25 * leafScale * leafHeightBoost, 5),
    leafMat
  );
  sideLeafA.position.set(-0.028 * leafScale, 0.28 + 0.12 * leafScale * leafHeightBoost, 0.01 * leafScale);
  sideLeafA.rotation.z = 0.3;
  sideLeafA.rotation.x = -0.1;
  sideLeafA.castShadow = sideLeafA.receiveShadow = true;
  g.add(sideLeafA);

  const sideLeafB = new THREE.Mesh(
    new THREE.ConeGeometry(0.022 * leafScale, 0.25 * leafScale * leafHeightBoost, 5),
    leafMat
  );
  sideLeafB.position.set(0.028 * leafScale, 0.28 + 0.12 * leafScale * leafHeightBoost, -0.01 * leafScale);
  sideLeafB.rotation.z = -0.3;
  sideLeafB.rotation.x = 0.1;
  sideLeafB.castShadow = sideLeafB.receiveShadow = true;
  g.add(sideLeafB);

  g.position.set(x, 0, z);
  return g;
}

// Escritorio con silla de oficina y ordenador (patas tipo panel como en la imagen)
function officeDesk(x, z, withMonitor = true) {
  const g = new THREE.Group();
  const deskW = 1.4;
  const deskD = 0.88;
  const deskTop = new THREE.Mesh(
    new THREE.BoxGeometry(deskW, 0.07, deskD),
    deskMat
  );
  deskTop.position.y = 0.715;
  deskTop.castShadow = deskTop.receiveShadow = true;
  g.add(deskTop);
  const legH = 0.68;
  const legThick = 0.08;
  const leftPanel = new THREE.Mesh(
    new THREE.BoxGeometry(legThick, legH, deskD),
    deskMat
  );
  leftPanel.position.set(-deskW / 2 + legThick / 2, legH / 2, 0);
  leftPanel.castShadow = leftPanel.receiveShadow = true;
  g.add(leftPanel);
  const rightPanel = new THREE.Mesh(
    new THREE.BoxGeometry(legThick, legH, deskD),
    deskMat
  );
  rightPanel.position.set(deskW / 2 - legThick / 2, legH / 2, 0);
  rightPanel.castShadow = rightPanel.receiveShadow = true;
  g.add(rightPanel);
  const modestyBar = new THREE.Mesh(
    new THREE.BoxGeometry(deskW - 0.2, 0.5, 0.04),
    deskMat
  );
  modestyBar.position.set(0, 0.25, deskD / 2 - 0.02);
  modestyBar.castShadow = true;
  g.add(modestyBar);
  const chair = officeChair();
  chair.position.set(0, 0, 0.72);
  chair.rotation.y = Math.PI;
  g.add(chair);
  if (withMonitor) {
    const pc = computer();
    pc.position.set(0, 0, 0);
    g.add(pc);
    if (pc.userData.display) deskDisplayMeshes.push(pc.userData.display);
  }
  g.position.set(x, 0, z);
  return g;
}

// Mesa de reuniones grande (redonda) con patas
const tableMat = new THREE.MeshStandardMaterial({
  color: 0xc9a86c,
  roughness: 0.5,
  metalness: 0.06,
});
const meetingTableGroup = new THREE.Group();
meetingTableGroup.position.set(-12, 0, -10);
const tableTop = new THREE.Mesh(
  new THREE.CylinderGeometry(2.2, 2.2, 0.08, 24),
  tableMat
);
tableTop.position.y = 0.72;
tableTop.castShadow = tableTop.receiveShadow = true;
meetingTableGroup.add(tableTop);
const tablePillar = new THREE.Mesh(
  new THREE.CylinderGeometry(0.25, 0.3, 0.68, 16),
  tableMat
);
tablePillar.position.y = 0.34;
tablePillar.castShadow = true;
meetingTableGroup.add(tablePillar);
scene.add(meetingTableGroup);
const meetingCenterX = -12, meetingCenterZ = -10;
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2;
  const ch = officeChair();
  const cx = -12 + Math.cos(a) * 2.8;
  const cz = -10 + Math.sin(a) * 2.8;
  ch.position.set(cx, 0, cz);
  ch.rotation.y = Math.atan2(meetingCenterX - cx, meetingCenterZ - cz);
  scene.add(ch);
}

// Televisor (pantalla + marco + base) para poner delante de los sofás
function television() {
  const g = new THREE.Group();
  const tvMat = new THREE.MeshStandardMaterial({
    color: 0x282830,
    roughness: 0.35,
    metalness: 0.2,
  });
  const screenW = 1.8;
  const screenH = 1.05;
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(screenW + 0.08, screenH + 0.08, 0.06),
    tvMat
  );
  frame.position.y = 0.53;
  frame.castShadow = true;
  g.add(frame);
  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x0a0a0e,
    roughness: 0.3,
    metalness: 0.05,
  });
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(screenW, screenH),
    screenMat
  );
  screen.position.set(0, 0.53, 0.032);
  screen.rotation.x = Math.PI;
  g.add(screen);
  const stand = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.35, 0.2),
    tvMat
  );
  stand.position.y = 0.175;
  stand.castShadow = true;
  g.add(stand);
  return g;
}

// Mesa bajo el televisor
const mesaTVMat = new THREE.MeshStandardMaterial({
  color: 0x9b7a4a,
  roughness: 0.5,
  metalness: 0.06,
});
const mesaTVH = 0.5;
const mesaTV = new THREE.Mesh(
  new THREE.BoxGeometry(2.2, mesaTVH, 0.6),
  mesaTVMat
);
mesaTV.position.set(9.25, mesaTVH / 2, 3);
mesaTV.castShadow = mesaTV.receiveShadow = true;
scene.add(mesaTV);

const tv = television();
tv.position.set(9.25, mesaTVH, 3);
tv.rotation.y = Math.PI;
scene.add(tv);

// Sofás azules más arriba, mirando hacia la tele (TV está en z=6, sofas en z=9-10)
const sofaAzul1 = sofa(2, 0x4a7cb8, 8, 9);
sofaAzul1.rotation.y = Math.PI;
scene.add(sofaAzul1);
const sofaAzul2 = sofa(2, 0x4a7cb8, 10.5, 9);
sofaAzul2.rotation.y = Math.PI;
scene.add(sofaAzul2);
const sofaAzul3 = sofa(1, 0x4a7cb8, 6, 10);
sofaAzul3.rotation.y = Math.PI;
scene.add(sofaAzul3);
scene.add(sofa(1, 0x7b5a9e, 0, -4));
scene.add(sofa(1, 0xd4783a, -6, -2));
scene.add(officePlant(-18.2, 12.3, 2.2));
scene.add(officePlant(18.2, 12.3, 2.2));
scene.add(officePlant(-18.2, -12.3, 2.2));

// Mesa de ping pong (zona del antiguo sofá verde)
const pingPongGroup = new THREE.Group();
pingPongGroup.position.set(-14, 0, 5);
const tablaMat = new THREE.MeshStandardMaterial({
  color: 0x2d5a27,
  roughness: 0.6,
  metalness: 0.05,
});
const tablaW = 2.74;
const tablaD = 1.525;
const tablaH = 0.076;
const tabla = new THREE.Mesh(
  new THREE.BoxGeometry(tablaW, tablaH, tablaD),
  tablaMat
);
tabla.position.y = 0.76;
tabla.castShadow = tabla.receiveShadow = true;
pingPongGroup.add(tabla);
const lineaBlanca = new THREE.Mesh(
  new THREE.BoxGeometry(tablaW, 0.002, 0.04),
  new THREE.MeshStandardMaterial({ color: 0xffffff })
);
lineaBlanca.position.set(0, 0.762, 0);
pingPongGroup.add(lineaBlanca);
const pataMat = new THREE.MeshStandardMaterial({
  color: 0x353535,
  roughness: 0.5,
  metalness: 0.3,
});
const pataGeo = new THREE.BoxGeometry(0.06, 0.76, 0.06);
[[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([sx, sz]) => {
  const pata = new THREE.Mesh(pataGeo, pataMat);
  pata.position.set(sx * (tablaW / 2 - 0.08), 0.38, sz * (tablaD / 2 - 0.08));
  pata.castShadow = true;
  pingPongGroup.add(pata);
});
const redMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
const red = new THREE.Mesh(
  new THREE.BoxGeometry(0.02, 0.15, tablaD + 0.1),
  redMat
);
red.position.set(0, 0.835, 0);
pingPongGroup.add(red);
const paletaMat = new THREE.MeshStandardMaterial({
  color: 0xe02030,
  roughness: 0.5,
  metalness: 0.08,
});
const paletaW = 0.16;
const paletaH = 0.02;
const paletaD = 0.12;
const paleta1 = new THREE.Mesh(
  new THREE.BoxGeometry(paletaW, paletaH, paletaD),
  paletaMat
);
paleta1.position.set(-0.55, 0.76 + paletaH / 2, -0.32);
paleta1.rotation.y = 0.35;
paleta1.castShadow = true;
pingPongGroup.add(paleta1);
const paleta2 = new THREE.Mesh(
  new THREE.BoxGeometry(paletaW, paletaH, paletaD),
  paletaMat
);
paleta2.position.set(0.5, 0.76 + paletaH / 2, 0.35);
paleta2.rotation.y = -0.3;
paleta2.castShadow = true;
pingPongGroup.add(paleta2);
scene.add(pingPongGroup);

// 6 escritorios con ordenador, en fila horizontal pegados a la pared opuesta (abajo, z = -12)
const deskZ = -12;
scene.add(officeDesk(-6, deskZ));
scene.add(officeDesk(-3, deskZ));
scene.add(officeDesk(0, deskZ));
scene.add(officeDesk(3, deskZ));
scene.add(officeDesk(6, deskZ));
scene.add(officeDesk(9, deskZ));

// --- Cajas crate decorativas ---
{
  const crateTexture = new THREE.TextureLoader().load(
    'https://threejs.org/examples/textures/crate.gif'
  );
  crateTexture.colorSpace = THREE.SRGBColorSpace;
  const crateMat = new THREE.MeshStandardMaterial({
    map: crateTexture,
    roughness: 0.7,
    metalness: 0.05,
  });
  const crateGeo = new THREE.BoxGeometry(0.55, 0.55, 0.55);
  // Dos cajas juntas contra la pared derecha, zona frontal libre
  const cratePositions = [
    [-19.22, 0.275, 10.0],
    [-19.22, 0.275, 10.65],
  ];
  for (const [cx, cy, cz] of cratePositions) {
    const crate = new THREE.Mesh(crateGeo, crateMat);
    crate.position.set(cx, cy, cz);
    crate.castShadow = true;
    crate.receiveShadow = true;
    scene.add(crate);
  }
}

// --- Trabajadores blocky (estilo imagen: cabeza, torso, piernas) ---
const NAMES = ['Buzz', 'Forge', 'Scoop', 'Sage', 'Quant', 'Scout', 'Researcher'];
const OUTFITS = [
  { shirt: 0x4a7cb8, pants: 0x6b4423 },
  { shirt: 0x5a9e6b, pants: 0x6b4423 },
  { shirt: 0xe8a8b8, pants: 0x8b5566 },
  { shirt: 0xd4a84a, pants: 0x6b4423 },
  { shirt: 0x7b8ca8, pants: 0x6b4423 },
  { shirt: 0x6b5b95, pants: 0x6b4423 },
  { shirt: 0xe05c2a, pants: 0x6b4423 },
];

function createWorker(nameIndex, startX, startZ, gltfData) {
  const g = new THREE.Group();
  const workerName = NAMES[nameIndex];

  // --- RobotExpressive GLTF model ---
  let mixer = null;
  let walkAction = null, idleAction = null, sittingAction = null, currentAction = null;
  const highlightMeshes = [];

  // Per-worker body colors (replaces the yellow parts of the robot)
  const ROBOT_COLORS = [0xF5C518, 0x2ECC71, 0x3498DB, 0xE91E63, 0x9B59B6, 0xFF5722];
  const workerColor = new THREE.Color(ROBOT_COLORS[nameIndex % ROBOT_COLORS.length]);

  if (gltfData && skeletonClone) {
    const robotScene = skeletonClone(gltfData.scene);
    robotScene.scale.setScalar(0.35);
    robotScene.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.material = child.material.clone();
        // Recolor yellow/warm-colored parts; keep grey, white and black as-is
        if (child.material.color) {
          const hsl = {};
          child.material.color.getHSL(hsl);
          // Yellow range: hue 0.05–0.22, saturation > 0.45
          if (hsl.h >= 0.05 && hsl.h <= 0.22 && hsl.s > 0.45) {
            child.material.color.copy(workerColor);
            if (child.material.emissive) {
              child.material.emissive.copy(workerColor).multiplyScalar(0.08);
            }
          }
        }
        highlightMeshes.push(child);
      }
    });
    g.add(robotScene);

    mixer = new THREE.AnimationMixer(robotScene);
    const clips = gltfData.animations;
    const walkClip = THREE.AnimationClip.findByName(clips, 'Walking');
    const idleClip = THREE.AnimationClip.findByName(clips, 'Idle');
    const sitClip = THREE.AnimationClip.findByName(clips, 'Sitting');

    walkAction = walkClip ? mixer.clipAction(walkClip) : null;
    idleAction = idleClip ? mixer.clipAction(idleClip) : null;
    sittingAction = sitClip ? mixer.clipAction(sitClip) : null;

    currentAction = walkAction || idleAction;
    if (currentAction) currentAction.play();
  }

  g.position.set(startX, 0, startZ);
  const lataMat = new THREE.MeshStandardMaterial({ color: 0xc41e3a, metalness: 0.4, roughness: 0.5 });
  const lata = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.11, 12), lataMat);
  lata.position.set(0.14, 0.42, 0.12);
  lata.rotation.x = Math.PI / 2;
  lata.visible = false;
  lata.castShadow = true;
  g.add(lata);
  g.userData = {
    nameIndex,
    mixer,
    walkAction,
    idleAction,
    sittingAction,
    currentAction,
    phase: Math.random() * Math.PI * 2,
    can: lata,
    highlightMeshes,
    hoverHitbox: null,
  };

  if (workerName === 'Scoop' || workerName === 'Buzz' || workerName === 'Forge' || workerName === 'Sage' || workerName === 'Quant' || workerName === 'Scout' || workerName === 'Researcher') {
    const hoverHitbox = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 1.95, 0.9),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    hoverHitbox.position.y = 0.98;
    g.add(hoverHitbox);
    g.userData.hoverHitbox = hoverHitbox;
  }

  if (CSS2DObject) {
    const nameLabel = document.createElement('div');
    nameLabel.className = 'worker-label rt-worker-tag';
    const isInteractiveWorker =
      workerName === 'Scoop'
      || workerName === 'Buzz'
      || workerName === 'Forge'
      || workerName === 'Sage'
      || workerName === 'Quant'
      || workerName === 'Scout'
      || workerName === 'Researcher';
    nameLabel.style.pointerEvents = isInteractiveWorker ? 'auto' : 'none';
    nameLabel.style.userSelect = 'none';
    nameLabel.style.transform = 'translateY(-2px)';

    const labelText = document.createElement('span');
    labelText.className = 'rt-worker-tag-text';
    labelText.textContent = workerName;

    const statusDot = document.createElement('span');
    statusDot.className = 'rt-worker-tag-dot';

    if (isInteractiveWorker) {
      nameLabel.style.cursor = 'pointer';
      nameLabel.title = workerName === 'Scoop'
        ? 'Click for today\'s crypto report'
        : workerName === 'Buzz'
          ? 'Click for social tweet ideas'
          : workerName === 'Forge'
            ? 'Click to configure custom agent prompt from GitHub'
            : workerName === 'Sage'
              ? 'Click to create/export Base wallet'
              : workerName === 'Scout'
                ? 'Click to search the internet in real time'
                : workerName === 'Researcher'
                  ? 'Click to search the internet'
                  : 'Click for BTC/ETH/SOL indicators';
      nameLabel.addEventListener('mouseenter', () => {
        nameLabel.classList.add('rt-worker-tag--active');
      });
      nameLabel.addEventListener('mouseleave', () => {
        nameLabel.classList.remove('rt-worker-tag--active');
      });
      nameLabel.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (workerName === 'Scoop') fetchNoahCryptoReport();
        if (workerName === 'Buzz') fetchLiamSocialTweets();
        if (workerName === 'Forge') showOliviaCustomAgentPanel();
        if (workerName === 'Sage') showEmmaWalletPanel();
        if (workerName === 'Quant') fetchEthanMarketSnapshot();
        if (workerName === 'Scout') showChloeResearchModal();
        if (workerName === 'Researcher') showResearcherPanel();
      });
    }

    nameLabel.appendChild(labelText);
    nameLabel.appendChild(statusDot);

    const labelObj = new CSS2DObject(nameLabel);
    labelObj.position.set(0, 1.9, 0);
    g.add(labelObj);
  }

  return g;
}

function smoothStep(t) {
  return t * t * (3 - 2 * t);
}

// --- Gatito NPC: camina por la oficina y a veces duerme ---
function createCat() {
  const g = new THREE.Group();

  const furMat = new THREE.MeshStandardMaterial({
    color: 0xd89f62,
    roughness: 0.75,
    metalness: 0.02,
  });
  const earInnerMat = new THREE.MeshStandardMaterial({
    color: 0xe8b8a8,
    roughness: 0.8,
    metalness: 0,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.2, 0.24), furMat);
  body.position.y = 0.16;
  body.castShadow = body.receiveShadow = true;
  g.add(body);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.18), furMat);
  head.position.set(0.29, 0.2, 0);
  head.castShadow = head.receiveShadow = true;
  g.add(head);

  const earL = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.08, 4), furMat);
  earL.position.set(0.31, 0.31, -0.05);
  earL.rotation.x = Math.PI;
  earL.castShadow = true;
  g.add(earL);
  const earR = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.08, 4), furMat);
  earR.position.set(0.31, 0.31, 0.05);
  earR.rotation.x = Math.PI;
  earR.castShadow = true;
  g.add(earR);

  const earInnerL = new THREE.Mesh(new THREE.ConeGeometry(0.023, 0.045, 4), earInnerMat);
  earInnerL.position.set(0.31, 0.285, -0.05);
  earInnerL.rotation.x = Math.PI;
  g.add(earInnerL);
  const earInnerR = new THREE.Mesh(new THREE.ConeGeometry(0.023, 0.045, 4), earInnerMat);
  earInnerR.position.set(0.31, 0.285, 0.05);
  earInnerR.rotation.x = Math.PI;
  g.add(earInnerR);

  const legGeo = new THREE.BoxGeometry(0.06, 0.15, 0.06);
  const legOffsets = [
    [-0.13, 0.075, -0.08],
    [0.1, 0.075, -0.08],
    [-0.13, 0.075, 0.08],
    [0.1, 0.075, 0.08],
  ];
  const legPivots = [];
  legOffsets.forEach(([x, y, z]) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y + 0.1, z);
    const leg = new THREE.Mesh(legGeo, furMat);
    leg.position.y = -0.075;
    leg.castShadow = leg.receiveShadow = true;
    pivot.add(leg);
    g.add(pivot);
    legPivots.push(pivot);
  });

  const tailBase = new THREE.Group();
  tailBase.position.set(-0.27, 0.23, 0);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.022, 0.34, 10), furMat);
  tail.rotation.z = Math.PI / 2;
  tail.position.x = -0.17;
  tail.castShadow = true;
  tailBase.add(tail);
  g.add(tailBase);

  g.userData = {
    phase: Math.random() * Math.PI * 2,
    body,
    head,
    tailBase,
    legPivots,
  };
  return g;
}

function createMonkey() {
  const g = new THREE.Group();

  const furMat = new THREE.MeshStandardMaterial({
    color: 0x6e4a2f,
    roughness: 0.78,
    metalness: 0.02,
  });
  const faceMat = new THREE.MeshStandardMaterial({
    color: 0xd8b187,
    roughness: 0.82,
    metalness: 0,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x3a2a1d,
    roughness: 0.85,
    metalness: 0.02,
  });
  const bellyFurMat = new THREE.MeshStandardMaterial({
    color: 0xb88b62,
    roughness: 0.88,
    metalness: 0.01,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.34, 0.2), furMat);
  body.position.y = 0.35;
  body.castShadow = body.receiveShadow = true;
  g.add(body);

  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.09, 0.16), bellyFurMat);
  belly.position.set(0.132, 0.35, 0);
  belly.castShadow = true;
  g.add(belly);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), furMat);
  head.position.set(0.08, 0.62, 0);
  head.castShadow = head.receiveShadow = true;
  g.add(head);

  const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.085, 0.095), faceMat);
  muzzle.position.set(0.17, 0.58, 0);
  muzzle.castShadow = true;
  g.add(muzzle);

  const earL = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.04, 10), furMat);
  earL.position.set(0.06, 0.72, -0.105);
  earL.rotation.z = Math.PI / 2;
  earL.castShadow = true;
  g.add(earL);
  const earR = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.04, 10), furMat);
  earR.position.set(0.06, 0.72, 0.105);
  earR.rotation.z = Math.PI / 2;
  earR.castShadow = true;
  g.add(earR);

  const earInL = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.042, 10), faceMat);
  earInL.position.copy(earL.position);
  earInL.rotation.copy(earL.rotation);
  g.add(earInL);
  const earInR = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.042, 10), faceMat);
  earInR.position.copy(earR.position);
  earInR.rotation.copy(earR.rotation);
  g.add(earInR);

  const legGeo = new THREE.BoxGeometry(0.075, 0.21, 0.09);
  const legOffsets = [
    [0.01, 0.2, -0.06],
    [0.01, 0.2, 0.06],
  ];
  const legPivots = [];
  legOffsets.forEach(([x, y, z]) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const leg = new THREE.Mesh(legGeo, furMat);
    leg.position.y = -0.105;
    leg.castShadow = leg.receiveShadow = true;
    pivot.add(leg);
    g.add(pivot);
    legPivots.push(pivot);
  });

  const armGeo = new THREE.BoxGeometry(0.06, 0.19, 0.075);
  const armPivots = [];
  [
    [0.03, 0.47, -0.12],
    [0.03, 0.47, 0.12],
  ].forEach(([x, y, z]) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const arm = new THREE.Mesh(armGeo, furMat);
    arm.position.y = -0.095;
    arm.castShadow = arm.receiveShadow = true;
    pivot.add(arm);
    g.add(pivot);
    armPivots.push(pivot);
  });

  const plushFurMat = new THREE.MeshStandardMaterial({
    color: 0xe38a2f,
    roughness: 0.86,
    metalness: 0.01,
  });
  const plushFaceMat = new THREE.MeshStandardMaterial({
    color: 0xf1c796,
    roughness: 0.9,
    metalness: 0,
  });
  const plushDarkMat = new THREE.MeshStandardMaterial({
    color: 0x6b3f1f,
    roughness: 0.88,
    metalness: 0.01,
  });
  const plush = new THREE.Group();
  const plushBody = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.075, 0.055), plushFurMat);
  plushBody.position.y = 0.04;
  plushBody.castShadow = plushBody.receiveShadow = true;
  plush.add(plushBody);
  const plushHead = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.055), plushFurMat);
  plushHead.position.set(0.022, 0.098, 0);
  plushHead.castShadow = true;
  plush.add(plushHead);
  const plushFace = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.022, 0.024), plushFaceMat);
  plushFace.position.set(0.045, 0.088, 0);
  plushFace.castShadow = true;
  plush.add(plushFace);
  const plushEarL = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 8), plushFurMat);
  plushEarL.position.set(0.02, 0.13, -0.03);
  plushEarL.rotation.z = Math.PI / 2;
  plush.add(plushEarL);
  const plushEarR = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 8), plushFurMat);
  plushEarR.position.set(0.02, 0.13, 0.03);
  plushEarR.rotation.z = Math.PI / 2;
  plush.add(plushEarR);
  const plushTail = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.006, 0.06, 8), plushDarkMat);
  plushTail.position.set(-0.03, 0.06, 0);
  plushTail.rotation.z = Math.PI / 2;
  plush.add(plushTail);
  plush.position.set(0.055, -0.205, 0);
  plush.rotation.y = -0.25;
  plush.scale.set(1.75, 1.75, 1.75);
  if (armPivots[1]) armPivots[1].add(plush);

  const tailBase = new THREE.Group();
  tailBase.position.set(-0.12, 0.33, 0);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.02, 0.3, 10), darkMat);
  tail.rotation.z = Math.PI / 2;
  tail.position.x = -0.15;
  tail.castShadow = true;
  tailBase.add(tail);
  g.add(tailBase);

  g.userData = {
    phase: Math.random() * Math.PI * 2,
    body,
    head,
    tailBase,
    legPivots,
    armPivots,
  };

  return g;
}

function createClickIndicatorArrow() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x3af97f,
    emissive: 0x12a84a,
    emissiveIntensity: 0.55,
    roughness: 0.25,
    metalness: 0.05,
  });
  const stem = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.21, 0.05), mat);
  stem.position.y = 0.15;
  stem.castShadow = true;
  g.add(stem);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.135, 0.28, 12), mat);
  tip.position.y = -0.045;
  tip.rotation.x = Math.PI;
  tip.castShadow = true;
  g.add(tip);
  g.userData.baseY = 0;
  g.userData.phase = Math.random() * Math.PI * 2;
  return g;
}

const catBed = new THREE.Group();
const catBedOuter = new THREE.Mesh(
  new THREE.CylinderGeometry(0.62, 0.62, 0.14, 24),
  new THREE.MeshStandardMaterial({ color: 0x7a8aa0, roughness: 0.75, metalness: 0.03 })
);
catBedOuter.position.y = 0.07;
catBedOuter.castShadow = catBedOuter.receiveShadow = true;
catBed.add(catBedOuter);
const catBedInner = new THREE.Mesh(
  new THREE.CylinderGeometry(0.45, 0.45, 0.06, 24),
  new THREE.MeshStandardMaterial({ color: 0xe7e0d1, roughness: 0.92, metalness: 0 })
);
catBedInner.position.y = 0.12;
catBedInner.castShadow = true;
catBed.add(catBedInner);
catBed.position.set(-16.2, 0, 11.3);
scene.add(catBed);

const monkeyBed = new THREE.Group();
const monkeyBedOuter = new THREE.Mesh(
  new THREE.CylinderGeometry(0.58, 0.58, 0.14, 24),
  new THREE.MeshStandardMaterial({ color: 0x7a5b43, roughness: 0.75, metalness: 0.03 })
);
monkeyBedOuter.position.y = 0.07;
monkeyBedOuter.castShadow = monkeyBedOuter.receiveShadow = true;
monkeyBed.add(monkeyBedOuter);
const monkeyBedInner = new THREE.Mesh(
  new THREE.CylinderGeometry(0.42, 0.42, 0.06, 24),
  new THREE.MeshStandardMaterial({ color: 0xd9c3a4, roughness: 0.92, metalness: 0 })
);
monkeyBedInner.position.y = 0.12;
monkeyBedInner.castShadow = true;
monkeyBed.add(monkeyBedInner);
monkeyBed.position.set(15.4, 0, 10.7);
scene.add(monkeyBed);

const catWaypoints = [
  [-16, 9],
  [-10, 7],
  [-4, 9],
  [2, 8],
  [9, 5],
  [11, -1],
  [7, -7],
  [1, -9],
  [-6, -8],
  [-12, -4],
  [-15, 2],
];

const officeCat = {
  mesh: createCat(),
  mode: 'walking',
  wpIndex: 0,
  t: 0,
  speed: 0.85,
  sleepTimer: 0,
  nextSleepIn: 11 + Math.random() * 10,
  roamTargetX: null,
  roamTargetZ: null,
  collisionStuckTimer: 0,
  lastMoveDx: 0,
  lastMoveDz: 0,
};
officeCat.mesh.position.set(catWaypoints[0][0], 0.01, catWaypoints[0][1]);
scene.add(officeCat.mesh);

const monkeyWaypoints = [
  [14, 9],
  [10, 7],
  [6, 9],
  [1, 9],
  [-4, 7],
  [-9, 4],
  [-13, 1],
  [-15, -4],
  [-10, -8],
  [-4, -9],
  [2, -9],
  [8, -8],
  [13, -6],
  [15, -1],
];
const officeMonkey = {
  mesh: createMonkey(),
  mode: 'walking',
  wpIndex: 0,
  t: 0,
  speed: 0.92,
  sleepTimer: 0,
  nextSleepIn: 9 + Math.random() * 9,
  roamTargetX: null,
  roamTargetZ: null,
  collisionStuckTimer: 0,
  lastMoveDx: 0,
  lastMoveDz: 0,
};
officeMonkey.mesh.position.set(monkeyWaypoints[0][0], 0.01, monkeyWaypoints[0][1]);
scene.add(officeMonkey.mesh);

const clickableIndicators = [];
const catClickIndicator = createClickIndicatorArrow();
catClickIndicator.position.set(0, 0.95, 0);
catClickIndicator.userData.baseY = 0.95;
officeCat.mesh.add(catClickIndicator);
clickableIndicators.push(catClickIndicator);

const monkeyClickIndicator = createClickIndicatorArrow();
monkeyClickIndicator.position.set(0, 1.38, 0);
monkeyClickIndicator.userData.baseY = 1.38;
officeMonkey.mesh.add(monkeyClickIndicator);
clickableIndicators.push(monkeyClickIndicator);

if (CSS2DObject) {
  const monkeyLabelEl = document.createElement('div');
  monkeyLabelEl.className = 'worker-label rt-worker-tag rt-worker-tag--accent';
  monkeyLabelEl.style.userSelect = 'none';
  monkeyLabelEl.style.lineHeight = '1';

  const monkeyName = document.createElement('span');
  monkeyName.className = 'rt-worker-tag-text';
  monkeyName.textContent = 'punch';

  const monkeyDot = document.createElement('span');
  monkeyDot.className = 'rt-worker-tag-dot';

  monkeyLabelEl.appendChild(monkeyName);
  monkeyLabelEl.appendChild(monkeyDot);
  const monkeyLabelObj = new CSS2DObject(monkeyLabelEl);
  monkeyLabelObj.position.set(0, 1.15, 0);
  officeMonkey.mesh.add(monkeyLabelObj);
}

let catMeowLabelEl = null;
let catMeowLabelObj = null;
let catMeowTimer = null;
let monkeyBubbleLabelObj = null;
let monkeyBubbleTimer = null;
if (CSS2DObject) {
  catMeowLabelEl = document.createElement('div');
  catMeowLabelEl.className = 'worker-label rt-worker-tag';
  catMeowLabelEl.style.userSelect = 'none';
  const catMeowText = document.createElement('span');
  catMeowText.className = 'rt-worker-tag-text';
  catMeowText.textContent = 'Meaaoww!!';
  catMeowLabelEl.appendChild(catMeowText);
  catMeowLabelObj = new CSS2DObject(catMeowLabelEl);
  catMeowLabelObj.position.set(0, 0.72, 0);
  catMeowLabelObj.visible = false;
  officeCat.mesh.add(catMeowLabelObj);

  const monkeyBubbleEl = document.createElement('div');
  monkeyBubbleEl.className = 'worker-label rt-worker-tag rt-worker-tag--accent';
  monkeyBubbleEl.style.userSelect = 'none';
  const monkeyBubbleText = document.createElement('span');
  monkeyBubbleText.className = 'rt-worker-tag-text';
  monkeyBubbleText.textContent = 'Oooh oooh!!';
  monkeyBubbleEl.appendChild(monkeyBubbleText);
  monkeyBubbleLabelObj = new CSS2DObject(monkeyBubbleEl);
  monkeyBubbleLabelObj.position.set(0, 0.9, 0);
  monkeyBubbleLabelObj.visible = false;
  officeMonkey.mesh.add(monkeyBubbleLabelObj);
}

function showCatMeowBubble() {
  if (!catMeowLabelObj) return;
  catMeowLabelObj.visible = true;
  if (catMeowTimer) clearTimeout(catMeowTimer);
  catMeowTimer = setTimeout(() => {
    if (catMeowLabelObj) catMeowLabelObj.visible = false;
    catMeowTimer = null;
  }, 3000);
}

function showMonkeyBubble() {
  if (!monkeyBubbleLabelObj) return;
  monkeyBubbleLabelObj.visible = true;
  if (monkeyBubbleTimer) clearTimeout(monkeyBubbleTimer);
  monkeyBubbleTimer = setTimeout(() => {
    if (monkeyBubbleLabelObj) monkeyBubbleLabelObj.visible = false;
    monkeyBubbleTimer = null;
  }, 2500);
}

function updateClickIndicators(t) {
  for (const arrow of clickableIndicators) {
    if (!arrow) continue;
    const baseY = Number.isFinite(arrow.userData.baseY) ? arrow.userData.baseY : 1;
    const phase = Number.isFinite(arrow.userData.phase) ? arrow.userData.phase : 0;
    arrow.position.y = baseY + Math.sin(t * 4.6 + phase) * 0.08;
  }
}

function findNearestCatWaypointIndex(x, z) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < catWaypoints.length; i++) {
    const p = catWaypoints[i];
    const d = (p[0] - x) * (p[0] - x) + (p[1] - z) * (p[1] - z);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function findNearestMonkeyWaypointIndex(x, z) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < monkeyWaypoints.length; i++) {
    const p = monkeyWaypoints[i];
    const d = (p[0] - x) * (p[0] - x) + (p[1] - z) * (p[1] - z);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function randomWorkerRoamPoint() {
  // Zona útil interior para que no rocen paredes.
  return {
    x: -16 + Math.random() * 32,
    z: -11 + Math.random() * 22,
  };
}

const WORKERS_STATE_KEY = 'office-threejs-workers-v1';
function sanitizeWorkerActivities(workerIndex, activities) {
  if (!Array.isArray(activities)) return [];
  const cleaned = [];
  for (const raw of activities) {
    const text = String(raw || '').trim();
    if (!text) continue;
    if (/bankr/i.test(text)) {
      if (workerIndex === NAMES.indexOf('Forge')) {
        cleaned.push('Configured wallet access');
      }
      continue;
    }
    if (!cleaned.includes(text)) cleaned.push(text);
  }
  return cleaned;
}

function addWorkerActivity(worker, activity) {
  if (!worker) return;
  if (/bankr/i.test(String(activity || ''))) return;
  if (!Array.isArray(worker.dailyActivities)) worker.dailyActivities = [];
  if (!worker.dailyActivities.includes(activity)) worker.dailyActivities.push(activity);
}

function saveWorkersState() {
  try {
    const snapshot = workers.map((w) => ({
      x: w.mesh.position.x,
      y: w.mesh.position.y,
      z: w.mesh.position.z,
      rotY: w.mesh.rotation.y,
      speed: w.speed,
      mode: w.mode,
      targetX: w.targetX,
      targetZ: w.targetZ,
      roamTargetX: w.roamTargetX,
      roamTargetZ: w.roamTargetZ,
      roamPause: w.roamPause,
      breakTimer: w.breakTimer,
      hasCan: w.hasCan,
      breakSofaIndex: w.breakSofaIndex,
      pingPongSlot: w.pingPongSlot,
      meetingSeatIndex: w.meetingSeatIndex,
      dailyActivities: sanitizeWorkerActivities(
        w.mesh?.userData?.nameIndex,
        Array.isArray(w.dailyActivities) ? w.dailyActivities : []
      ),
      noahNewsLastAt: w.noahNewsLastAt,
      ethanSignalsLastAt: w.ethanSignalsLastAt,
      liamPostedTweets: Array.isArray(w.liamPostedTweets) ? w.liamPostedTweets : [],
      emmaWalletAddress: w.emmaWalletAddress || '',
      phase: w.mesh.userData.phase,
    }));
    localStorage.setItem(WORKERS_STATE_KEY, JSON.stringify(snapshot));
  } catch (_) {}
}

function loadWorkersState() {
  try {
    const raw = localStorage.getItem(WORKERS_STATE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    if (parsed.length !== workers.length) return;

    parsed.forEach((saved, i) => {
      const w = workers[i];
      if (!w || !saved) return;
      if (Number.isFinite(saved.x) && Number.isFinite(saved.z)) {
        w.mesh.position.x = saved.x;
        w.mesh.position.z = saved.z;
      }
      if (Number.isFinite(saved.y)) w.mesh.position.y = saved.y;
      if (Number.isFinite(saved.rotY)) w.mesh.rotation.y = saved.rotY;
      if (Number.isFinite(saved.speed)) w.speed = saved.speed;
      if (typeof saved.mode === 'string') w.mode = saved.mode;
      if (saved.targetX == null || Number.isFinite(saved.targetX)) w.targetX = saved.targetX;
      if (saved.targetZ == null || Number.isFinite(saved.targetZ)) w.targetZ = saved.targetZ;
      if (saved.roamTargetX == null || Number.isFinite(saved.roamTargetX)) w.roamTargetX = saved.roamTargetX;
      if (saved.roamTargetZ == null || Number.isFinite(saved.roamTargetZ)) w.roamTargetZ = saved.roamTargetZ;
      if (saved.roamPause == null || Number.isFinite(saved.roamPause)) w.roamPause = saved.roamPause;
      if (saved.breakTimer == null || Number.isFinite(saved.breakTimer)) w.breakTimer = saved.breakTimer;
      if (typeof saved.hasCan === 'boolean') w.hasCan = saved.hasCan;
      if (saved.breakSofaIndex == null || Number.isFinite(saved.breakSofaIndex)) w.breakSofaIndex = saved.breakSofaIndex;
      if (saved.pingPongSlot == null || Number.isFinite(saved.pingPongSlot)) w.pingPongSlot = saved.pingPongSlot;
      if (saved.meetingSeatIndex == null || Number.isFinite(saved.meetingSeatIndex)) w.meetingSeatIndex = saved.meetingSeatIndex;
      if (Array.isArray(saved.dailyActivities)) {
        w.dailyActivities = sanitizeWorkerActivities(w.mesh?.userData?.nameIndex, saved.dailyActivities);
      }
      if (saved.noahNewsLastAt == null || Number.isFinite(saved.noahNewsLastAt)) w.noahNewsLastAt = saved.noahNewsLastAt;
      if (saved.ethanSignalsLastAt == null || Number.isFinite(saved.ethanSignalsLastAt)) {
        w.ethanSignalsLastAt = saved.ethanSignalsLastAt;
      }
      if (Array.isArray(saved.liamPostedTweets)) w.liamPostedTweets = saved.liamPostedTweets;
      if (typeof saved.emmaWalletAddress === 'string') w.emmaWalletAddress = saved.emmaWalletAddress;
      if (Number.isFinite(saved.phase)) w.mesh.userData.phase = saved.phase;
      if (w.mesh.userData.can) w.mesh.userData.can.visible = !!w.hasCan;
    });
  } catch (_) {}
}

const workers = [];
for (let i = 0; i < 6; i++) {
  const start = randomWorkerRoamPoint();
  const firstTarget = randomWorkerRoamPoint();
  const w = createWorker(i, start.x, start.z, robotGltfData);
  scene.add(w);
  workers.push({
    mesh: w,
    speed: 0.4 + Math.random() * 0.3,
    mode: 'walking',
    roamTargetX: firstTarget.x,
    roamTargetZ: firstTarget.z,
    roamPause: Math.random() * 1.2,
    dailyActivities: [],
    liamPostedTweets: [],
    emmaWalletAddress: '',
    ethanSignalsLastAt: null,
  });
}
loadWorkersState();

// After restoring mode from localStorage, snap each worker's animation to match.
// Workers that were seated/stationary should show Idle, not Walking.
const IDLE_MODES = new Set(['working', 'inMeeting', 'watchingTV', 'atMachine', 'atTrash', 'playingPingPong']);
for (const w of workers) {
  const ud = w.mesh.userData;
  if (!ud.mixer) continue;
  const isIdle = IDLE_MODES.has(w.mode);
  const toAction = isIdle
    ? (ud.idleAction || ud.walkAction)
    : (ud.walkAction || ud.idleAction);
  if (toAction && ud.currentAction !== toAction) {
    if (ud.currentAction) ud.currentAction.stop();
    toAction.play();
    ud.currentAction = toAction;
  }
}

for (const w of workers) {
  const idx = w?.mesh?.userData?.nameIndex;
  const isInteractive =
    idx === NAMES.indexOf('Scoop')
    || idx === NAMES.indexOf('Buzz')
    || idx === NAMES.indexOf('Forge')
    || idx === NAMES.indexOf('Sage')
    || idx === NAMES.indexOf('Quant')
    || idx === NAMES.indexOf('Scout');
  if (!isInteractive) continue;
  const workerIndicator = createClickIndicatorArrow();
  workerIndicator.position.set(0, 2.65, 0);
  workerIndicator.userData.baseY = 2.65;
  w.mesh.add(workerIndicator);
  clickableIndicators.push(workerIndicator);
}
saveWorkersState();
try {
  const emmaState = loadEmmaPrivyState();
  const emmaIndex = NAMES.indexOf('Sage');
  const emmaWorker = workers.find((w) => w?.mesh?.userData?.nameIndex === emmaIndex);
  if (emmaWorker && emmaState.walletAddress) {
    emmaWorker.emmaWalletAddress = emmaState.walletAddress;
  }
} catch (_) {}

function updateDeskScreenUsage() {
  for (let i = 0; i < deskDisplayMeshes.length; i++) {
    const display = deskDisplayMeshes[i];
    if (!display?.material) continue;
    const active = !!workers[i] && workers[i].mode === 'working' && computerGifReady;
    if (active) {
      if (display.material.map !== computerGifTexture) display.material.map = computerGifTexture;
      display.material.color.set(0xffffff);
      display.material.emissive.set(0x2a2a2a);
      display.material.emissiveIntensity = 0.35;
    } else {
      if (display.material.map) display.material.map = null;
      display.material.color.set(0x1a1a22);
      display.material.emissive.set(0x000000);
      display.material.emissiveIntensity = 0;
    }
    display.material.needsUpdate = true;
  }
}

const interactiveNameIndexSet = new Set([
  NAMES.indexOf('Scoop'),
  NAMES.indexOf('Buzz'),
  NAMES.indexOf('Forge'),
  NAMES.indexOf('Sage'),
  NAMES.indexOf('Quant'),
  NAMES.indexOf('Scout'),
  NAMES.indexOf('Researcher'),
]);
const workerHoverRaycaster = new THREE.Raycaster();
const catClickRaycaster = new THREE.Raycaster();
const workerPointerNdc = new THREE.Vector2(2, 2);
let hoveredInteractiveWorker = null;
let hoveredArcade = false;

function getInteractiveWorkers() {
  return workers.filter((w) => interactiveNameIndexSet.has(w?.mesh?.userData?.nameIndex));
}

function setWorkerBodyHover(worker, enabled) {
  if (!worker) return;
  if (worker.isBodyHovered === enabled) return;
  worker.isBodyHovered = enabled;

  const highlightMeshes = Array.isArray(worker.mesh.userData.highlightMeshes)
    ? worker.mesh.userData.highlightMeshes
    : [];

  highlightMeshes.forEach((mesh) => {
    if (!mesh?.material) return;
    const mat = mesh.material;
    if (mat.color && !mat.userData.noahBaseColor) mat.userData.noahBaseColor = mat.color.clone();
    if (mat.emissive && !mat.userData.noahBaseEmissive) {
      mat.userData.noahBaseEmissive = mat.emissive.clone();
      mat.userData.noahBaseEmissiveIntensity = mat.emissiveIntensity ?? 1;
    }
    if (enabled) {
      if (mat.color) mat.color.set(0x37c66a);
      if (mat.emissive) {
        mat.emissive.set(0x0f6f3d);
        mat.emissiveIntensity = 0.35;
      }
    } else {
      if (mat.color && mat.userData.noahBaseColor) mat.color.copy(mat.userData.noahBaseColor);
      if (mat.emissive && mat.userData.noahBaseEmissive) {
        mat.emissive.copy(mat.userData.noahBaseEmissive);
        mat.emissiveIntensity = mat.userData.noahBaseEmissiveIntensity ?? mat.emissiveIntensity;
      }
    }
  });
}

function setArcadeHover(enabled) {
  if (hoveredArcade === enabled) return;
  hoveredArcade = enabled;
  const highlightMeshes = maquinaRecreativa.userData.highlightMeshes || [];
  highlightMeshes.forEach((mesh) => {
    if (!mesh?.material) return;
    const mat = mesh.material;
    if (mat.userData.noRestore) {
      if (enabled) {
        if (mat.color) mat.color.set(0x37c66a);
        if (mat.emissive) {
          mat.emissive.set(0x0f6f3d);
          mat.emissiveIntensity = 0.35;
        }
      }
      return;
    }
    if (mat.color && !mat.userData.noahBaseColor) mat.userData.noahBaseColor = mat.color.clone();
    if (mat.emissive && !mat.userData.noahBaseEmissive) {
      mat.userData.noahBaseEmissive = mat.emissive.clone();
      mat.userData.noahBaseEmissiveIntensity = mat.emissiveIntensity ?? 1;
    }
    if (enabled) {
      if (mat.color) mat.color.set(0x37c66a);
      if (mat.emissive) {
        mat.emissive.set(0x0f6f3d);
        mat.emissiveIntensity = 0.35;
      }
    } else {
      if (mat.color && mat.userData.noahBaseColor) mat.color.copy(mat.userData.noahBaseColor);
      if (mat.emissive && mat.userData.noahBaseEmissive) {
        mat.emissive.copy(mat.userData.noahBaseEmissive);
        mat.emissiveIntensity = mat.userData.noahBaseEmissiveIntensity ?? mat.emissiveIntensity;
      }
    }
  });
  const labelEl = maquinaRecreativa.userData.arcadeLabelEl;
  if (labelEl) {
    labelEl.style.display = enabled ? 'block' : 'none';
    labelEl.style.visibility = enabled ? 'visible' : 'hidden';
    labelEl.style.background = enabled ? 'rgba(16, 88, 58, 0.96)' : 'rgba(14,14,14,0.92)';
    labelEl.style.borderColor = enabled ? 'rgba(120, 255, 190, 0.65)' : 'rgba(255,255,255,0.14)';
    labelEl.style.boxShadow = enabled ? '0 4px 12px rgba(40, 210, 130, 0.35)' : '0 2px 8px rgba(0,0,0,0.35)';
  }
}

function updateInteractiveBodyHover() {
  const candidates = getInteractiveWorkers();
  if (workerPointerNdc.x > 1.5) {
    if (hoveredInteractiveWorker) setWorkerBodyHover(hoveredInteractiveWorker, false);
    hoveredInteractiveWorker = null;
    if (hoveredArcade) setArcadeHover(false);
    canvas.style.cursor = 'default';
    return;
  }

  workerHoverRaycaster.setFromCamera(workerPointerNdc, camera);
  let hitWorker = null;
  let bestDistance = Infinity;
  for (const w of candidates) {
    const hoverHitbox = w.mesh.userData.hoverHitbox;
    if (!hoverHitbox) continue;
    const hits = workerHoverRaycaster.intersectObject(hoverHitbox, false);
    if (hits.length && hits[0].distance < bestDistance) {
      bestDistance = hits[0].distance;
      hitWorker = w;
    }
  }
  const arcadeHits = workerHoverRaycaster.intersectObject(maquinaRecreativa.userData.hoverHitbox, false);
  const hitArcade = arcadeHits.length && (!hitWorker || arcadeHits[0].distance < bestDistance);

  if (hitArcade) {
    if (hoveredInteractiveWorker) setWorkerBodyHover(hoveredInteractiveWorker, false);
    hoveredInteractiveWorker = null;
    setArcadeHover(true);
    canvas.style.cursor = 'pointer';
  } else {
    if (hoveredArcade) setArcadeHover(false);
    if (hoveredInteractiveWorker && hoveredInteractiveWorker !== hitWorker) {
      setWorkerBodyHover(hoveredInteractiveWorker, false);
    }
    if (hitWorker) {
      setWorkerBodyHover(hitWorker, true);
      canvas.style.cursor = 'pointer';
    } else {
      canvas.style.cursor = 'default';
    }
  }
  hoveredInteractiveWorker = hitWorker;
}

canvas.addEventListener('pointermove', (e) => {
  const rect = canvas.getBoundingClientRect();
  workerPointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  workerPointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
});
canvas.addEventListener('pointerleave', () => {
  workerPointerNdc.set(2, 2);
  if (hoveredInteractiveWorker) setWorkerBodyHover(hoveredInteractiveWorker, false);
  hoveredInteractiveWorker = null;
  if (hoveredArcade) setArcadeHover(false);
  canvas.style.cursor = 'default';
});
canvas.addEventListener('click', (e) => {
  if (hoveredArcade) {
    e.preventDefault();
    window.open('https://ro-ach.vercel.app/', '_blank', 'noopener,noreferrer');
    return;
  }
  if (hoveredInteractiveWorker) {
    e.preventDefault();
    const idx = hoveredInteractiveWorker.mesh.userData.nameIndex;
    if (idx === NAMES.indexOf('Scoop')) fetchNoahCryptoReport();
    if (idx === NAMES.indexOf('Buzz')) fetchLiamSocialTweets();
    if (idx === NAMES.indexOf('Forge')) showOliviaCustomAgentPanel();
    if (idx === NAMES.indexOf('Sage')) showEmmaWalletPanel();
    if (idx === NAMES.indexOf('Quant')) fetchEthanMarketSnapshot();
    if (idx === NAMES.indexOf('Scout')) showChloeResearchModal();
    if (idx === NAMES.indexOf('Researcher')) showResearcherPanel();
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  catClickRaycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
  const catHits = catClickRaycaster.intersectObject(officeCat.mesh, true);
  if (catHits.length) {
    e.preventDefault();
    showCatMeowBubble();
    return;
  }
  const monkeyHits = catClickRaycaster.intersectObject(officeMonkey.mesh, true);
  if (monkeyHits.length) {
    e.preventDefault();
    showMonkeyBubble();
  }
});

const deskPositions = [-6, -3, 0, 3, 6, 9].map((x) => ({ x, z: deskZ + 0.72 }));

document.getElementById('btn-go-work').addEventListener('click', () => {
  workFocus.requested = true;
  deskPositions.forEach((desk, i) => {
    if (!workers[i]) return;
    const w = workers[i];
    w.mode = 'goingToWork';
    w.targetX = desk.x;
    w.targetZ = desk.z;
    addWorkerActivity(w, 'Worked at desk');
  });
  workers.slice(deskPositions.length).forEach((w) => {
    w.mode = 'walking';
    w.targetX = undefined;
    w.targetZ = undefined;
  });
});

const meetingChairPositions = [];
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2;
  meetingChairPositions.push({
    x: meetingCenterX + Math.cos(a) * 2.8,
    z: meetingCenterZ + Math.sin(a) * 2.8,
  });
}

function assignMeetingSeatForWorker(worker, usedSeatSet = null) {
  let bestSeat = -1;
  let bestDist = Infinity;
  for (let i = 0; i < meetingChairPositions.length; i++) {
    if (usedSeatSet && usedSeatSet.has(i)) continue;
    if (!usedSeatSet && isMeetingSeatOccupiedByOther(worker, i)) continue;
    const seat = meetingChairPositions[i];
    const d = Math.hypot(seat.x - worker.mesh.position.x, seat.z - worker.mesh.position.z);
    if (d < bestDist) {
      bestDist = d;
      bestSeat = i;
    }
  }
  if (bestSeat === -1) return false;
  if (usedSeatSet) usedSeatSet.add(bestSeat);
  worker.meetingSeatIndex = bestSeat;
  worker.meetingApproachTimer = 0;
  worker.mode = 'goingToMeeting';
  worker.targetX = meetingChairPositions[bestSeat].x;
  worker.targetZ = meetingChairPositions[bestSeat].z;
  return true;
}

function isMeetingSeatOccupiedByOther(worker, seatIndex) {
  const seat = meetingChairPositions[seatIndex];
  for (const other of workers) {
    if (!other || other === worker) continue;
    const isClaimingSeat =
      (other.mode === 'goingToMeeting' || other.mode === 'inMeeting') &&
      other.meetingSeatIndex === seatIndex;
    const isOnSeat =
      other.mode === 'inMeeting' &&
      Math.hypot(other.mesh.position.x - seat.x, other.mesh.position.z - seat.z) < 0.28;
    if (isClaimingSeat || isOnSeat) return true;
  }
  return false;
}

document.getElementById('btn-meeting').addEventListener('click', () => {
  workFocus.requested = false;
  meetingFocus.dismissed = false;
  const usedSeats = new Set();
  workers.forEach((w) => {
    if (!w) return;
    assignMeetingSeatForWorker(w, usedSeats);
    addWorkerActivity(w, 'Attended meeting');
  });
  workers.slice(meetingChairPositions.length).forEach((w) => {
    w.mode = 'walking';
    w.targetX = undefined;
    w.targetZ = undefined;
    w.meetingSeatIndex = undefined;
    w.meetingApproachTimer = 0;
  });
});

// Break: sofás mirando a la TV (9.25, 3), máquina (14, -14.88), papelera (17, -13)
const tvCenterX = 9.25, tvCenterZ = 3;
const breakSofaPositions = [
  { x: 7.5, z: 8.6 }, { x: 8.5, z: 8.6 }, { x: 10, z: 8.6 }, { x: 11, z: 8.6 }, { x: 6, z: 9.6 }
];
const breakMachinePosition = { x: 13.5, z: -14.4 };
const breakTrashPosition = { x: 16, z: -13 };
const pingPongCenterX = -14, pingPongCenterZ = 5;
// Jugadores en el lado corto de la mesa (extremos en X)
const breakPingPongPositions = [
  { x: pingPongCenterX - 2.74 / 2 - 0.45, z: pingPongCenterZ },
  { x: pingPongCenterX + 2.74 / 2 + 0.45, z: pingPongCenterZ },
];
// Pelota de ping pong (se muestra cuando hay 2 en playingPingPong)
const pingPongBall = new THREE.Mesh(
  new THREE.SphereGeometry(0.04, 12, 12),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0 })
);
pingPongBall.position.set(pingPongCenterX, 0.85, pingPongCenterZ);
pingPongBall.visible = false;
pingPongBall.castShadow = true;
scene.add(pingPongBall);
let pingPongBallT = 0;
let pingPongBallDir = 1;
const PINGPONG_BALL_SPEED = 1.2;
const GRAB_TIME = 0.4;
const DRINK_TIME = 2.2;
const THROW_TIME = 1.2;

document.getElementById('btn-break').addEventListener('click', () => {
  workFocus.requested = false;
  const n = workers.length;
  const activities = ['pingpong', 'pingpong'];
  for (let i = 2; i < n; i++) activities.push(Math.random() < 0.5 ? 'tv' : 'drink');
  activities.sort(() => Math.random() - 0.5);
  let sofaIdx = 0;
  let drinkSofaIdx = 0;
  let pingPongSlot = 0;
  workers.forEach((w, i) => {
    w.breakTimer = 0;
    const act = activities[i];
    if (act === 'pingpong') {
      const slot = pingPongSlot++;
      const pos = breakPingPongPositions[slot % breakPingPongPositions.length];
      w.mode = 'goingToPingPong';
      w.targetX = pos.x;
      w.targetZ = pos.z;
      w.pingPongSlot = slot;
      addWorkerActivity(w, 'Played ping pong');
    } else if (act === 'tv') {
      const pos = breakSofaPositions[sofaIdx % breakSofaPositions.length];
      sofaIdx++;
      w.mode = 'goingToBreakSofa';
      w.targetX = pos.x;
      w.targetZ = pos.z;
      addWorkerActivity(w, 'Watched TV in break area');
    } else {
      w.mode = 'goingToMachine';
      w.targetX = breakMachinePosition.x;
      w.targetZ = breakMachinePosition.z;
      w.hasCan = false;
      w.breakSofaIndex = (2 + drinkSofaIdx++) % breakSofaPositions.length;
      addWorkerActivity(w, 'Grabbed a drink from vending machine');
    }
  });
});

const WALK_TO_DESK_SPEED = 1.8;
const ARRIVAL_DIST = 0.25;

const ANIMAL_COLLISION_OBSTACLES = [
  { x: 9.25, z: 3, halfX: 1.45, halfZ: 0.9 }, // TV + mueble
  { x: -12, z: -10, halfX: 2.5, halfZ: 2.5 }, // Mesa reunión
  { x: -14, z: 5, halfX: 1.55, halfZ: 0.9 }, // Ping pong
  { x: 8, z: 9, halfX: 1.1, halfZ: 0.56 },
  { x: 10.5, z: 9, halfX: 1.1, halfZ: 0.56 },
  { x: 6, z: 10, halfX: 0.68, halfZ: 0.56 },
  { x: 0, z: -4, halfX: 0.68, halfZ: 0.56 },
  { x: -6, z: -2, halfX: 0.68, halfZ: 0.56 },
  // Fila de escritorios
  { x: -6, z: -12, halfX: 1.15, halfZ: 0.72 },
  { x: -3, z: -12, halfX: 1.15, halfZ: 0.72 },
  { x: 0, z: -12, halfX: 1.15, halfZ: 0.72 },
  { x: 3, z: -12, halfX: 1.15, halfZ: 0.72 },
  { x: 6, z: -12, halfX: 1.15, halfZ: 0.72 },
  // Máquina y papelera
  { x: 14.2, z: -15, halfX: 0.7, halfZ: 0.7 },
  { x: 16.2, z: -13, halfX: 0.45, halfZ: 0.45 },
];

function randomAnimalRoamPoint() {
  for (let i = 0; i < 20; i++) {
    const x = -16.2 + Math.random() * 32.4;
    const z = -10.7 + Math.random() * 21.4;
    let blocked = false;
    for (const obs of ANIMAL_COLLISION_OBSTACLES) {
      if (Math.abs(x - obs.x) < obs.halfX + 0.35 && Math.abs(z - obs.z) < obs.halfZ + 0.35) {
        blocked = true;
        break;
      }
    }
    if (!blocked) return { x, z };
  }
  return { x: -12 + Math.random() * 24, z: -9 + Math.random() * 18 };
}

function resolveAnimalCollision(prevX, prevZ, nextX, nextZ, radius = 0.24) {
  let x = THREE.MathUtils.clamp(nextX, -16.8, 16.8);
  let z = THREE.MathUtils.clamp(nextZ, -11.4, 11.4);
  let collided = false;
  for (const obs of ANIMAL_COLLISION_OBSTACLES) {
    const halfX = obs.halfX + radius;
    const halfZ = obs.halfZ + radius;
    const dx = x - obs.x;
    const dz = z - obs.z;
    if (Math.abs(dx) < halfX && Math.abs(dz) < halfZ) {
      collided = true;
      const penX = halfX - Math.abs(dx);
      const penZ = halfZ - Math.abs(dz);
      if (penX < penZ) {
        const dir = Math.sign(dx || (prevX - obs.x) || 1);
        x = obs.x + dir * halfX;
      } else {
        const dir = Math.sign(dz || (prevZ - obs.z) || 1);
        z = obs.z + dir * halfZ;
      }
    }
  }
  return { x, z, collided };
}

function moveAnimalWithCollision(animal, nx, nz, intendedMove, delta, isRoaming = true) {
  const mesh = animal.mesh;
  const prevX = mesh.position.x;
  const prevZ = mesh.position.z;
  const pos = resolveAnimalCollision(prevX, prevZ, nx, nz, animal === officeMonkey ? 0.26 : 0.22);
  mesh.position.x = pos.x;
  mesh.position.z = pos.z;
  animal.lastMoveDx = pos.x - prevX;
  animal.lastMoveDz = pos.z - prevZ;

  const moved = Math.hypot(animal.lastMoveDx, animal.lastMoveDz);
  const blocked = pos.collided && intendedMove > 0.0005 && moved < intendedMove * 0.3;
  if (blocked) {
    animal.collisionStuckTimer = (animal.collisionStuckTimer || 0) + delta;
  } else {
    animal.collisionStuckTimer = Math.max(0, (animal.collisionStuckTimer || 0) - delta * 1.2);
  }

  if ((animal.collisionStuckTimer || 0) >= 1.15) {
    animal.collisionStuckTimer = 0;
    if (isRoaming) {
      const nextTarget = randomAnimalRoamPoint();
      animal.roamTargetX = nextTarget.x;
      animal.roamTargetZ = nextTarget.z;
      return false;
    }
    return true;
  }
  return false;
}

function setAnimalFacingFromMotion(animal, fallbackDx, fallbackDz) {
  const mdx = Number.isFinite(animal.lastMoveDx) ? animal.lastMoveDx : 0;
  const mdz = Number.isFinite(animal.lastMoveDz) ? animal.lastMoveDz : 0;
  if (Math.hypot(mdx, mdz) > 0.0002) {
    animal.mesh.rotation.y = Math.atan2(-mdz, mdx);
    return;
  }
  if (Math.hypot(fallbackDx, fallbackDz) > 0.0002) {
    animal.mesh.rotation.y = Math.atan2(-fallbackDz, fallbackDx);
  }
}

function updateCat(delta) {
  const mesh = officeCat.mesh;
  const data = mesh.userData;
  const CAT_STEP_HEIGHT = 0.012;
  const CAT_LEG_SWING = 0.55;

  if (officeCat.mode === 'sleeping') {
    officeCat.sleepTimer -= delta;
    data.phase += delta * 2.5;
    mesh.position.y = 0.01 + Math.sin(data.phase) * 0.003;
    data.body.rotation.z = 0.1;
    data.head.rotation.z = 0.06;
    data.tailBase.rotation.y = 1.05;
    data.legPivots.forEach((pivot) => { pivot.rotation.z = 0; });

    if (officeCat.sleepTimer <= 0) {
      officeCat.mode = 'walking';
      officeCat.nextSleepIn = 14 + Math.random() * 12;
      const target = randomAnimalRoamPoint();
      officeCat.roamTargetX = target.x;
      officeCat.roamTargetZ = target.z;
      data.body.rotation.z = 0;
      data.head.rotation.z = 0;
    }
    return;
  }

  if (officeCat.mode === 'goingToBed') {
    const targetX = catBed.position.x + 0.03;
    const targetZ = catBed.position.z;
    const dx = targetX - mesh.position.x;
    const dz = targetZ - mesh.position.z;
    const dist = Math.hypot(dx, dz);
    const move = Math.min(delta * 1.35, dist);
    if (dist > 0.0001) {
      const nx = mesh.position.x + (dx / dist) * move;
      const nz = mesh.position.z + (dz / dist) * move;
      const failedToRoute = moveAnimalWithCollision(officeCat, nx, nz, move, delta, false);
      setAnimalFacingFromMotion(officeCat, dx, dz);
      if (failedToRoute) {
        officeCat.mode = 'walking';
        officeCat.nextSleepIn = 1.8 + Math.random() * 2.2;
      }
    }
    data.phase += delta * 7;
    mesh.position.y = 0.01 + Math.abs(Math.sin(data.phase)) * CAT_STEP_HEIGHT * 0.8;
    data.legPivots[0].rotation.x = Math.sin(data.phase) * CAT_LEG_SWING;
    data.legPivots[1].rotation.x = Math.sin(data.phase + Math.PI) * CAT_LEG_SWING;
    data.legPivots[2].rotation.x = Math.sin(data.phase + Math.PI) * CAT_LEG_SWING;
    data.legPivots[3].rotation.x = Math.sin(data.phase) * CAT_LEG_SWING;
    data.tailBase.rotation.y = 0.45 + Math.sin(data.phase * 0.8) * 0.16;

    if (dist < 0.14) {
      officeCat.mode = 'sleeping';
      officeCat.sleepTimer = 7 + Math.random() * 6;
      mesh.rotation.y = Math.PI / 2;
      mesh.position.y = 0.01;
      return;
    }
    return;
  }

  officeCat.nextSleepIn -= delta;
  if (officeCat.nextSleepIn <= 0) {
    officeCat.mode = 'goingToBed';
    return;
  }

  if (officeCat.roamTargetX == null || officeCat.roamTargetZ == null) {
    const target = randomAnimalRoamPoint();
    officeCat.roamTargetX = target.x;
    officeCat.roamTargetZ = target.z;
  }
  const dx = officeCat.roamTargetX - mesh.position.x;
  const dz = officeCat.roamTargetZ - mesh.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.24) {
    const target = randomAnimalRoamPoint();
    officeCat.roamTargetX = target.x;
    officeCat.roamTargetZ = target.z;
  } else {
    const move = Math.min((0.95 + officeCat.speed * 0.45) * delta, dist);
    const nx = mesh.position.x + (dx / dist) * move;
    const nz = mesh.position.z + (dz / dist) * move;
    moveAnimalWithCollision(officeCat, nx, nz, move, delta, true);
    setAnimalFacingFromMotion(officeCat, dx, dz);
  }

  data.phase += delta * 8;
  mesh.position.y = 0.01 + Math.abs(Math.sin(data.phase)) * CAT_STEP_HEIGHT;
  data.legPivots[0].rotation.x = Math.sin(data.phase) * CAT_LEG_SWING;
  data.legPivots[1].rotation.x = Math.sin(data.phase + Math.PI) * CAT_LEG_SWING;
  data.legPivots[2].rotation.x = Math.sin(data.phase + Math.PI) * CAT_LEG_SWING;
  data.legPivots[3].rotation.x = Math.sin(data.phase) * CAT_LEG_SWING;
  data.tailBase.rotation.y = 0.5 + Math.sin(data.phase * 0.7) * 0.2;
}

function updateMonkey(delta) {
  const mesh = officeMonkey.mesh;
  const data = mesh.userData;
  const MONKEY_STEP_HEIGHT = 0.016;
  const MONKEY_LEG_SWING = 0.72;
  const MONKEY_ARM_SWING = 0.58;

  if (officeMonkey.mode === 'sleeping') {
    officeMonkey.sleepTimer -= delta;
    data.phase += delta * 2.4;
    mesh.position.y = 0.01 + Math.sin(data.phase) * 0.003;
    data.body.rotation.z = 0.11;
    data.head.rotation.z = 0.06;
    data.tailBase.rotation.y = 1.15;
    data.legPivots.forEach((pivot) => {
      pivot.rotation.x *= 0.84;
      pivot.rotation.z = 0;
    });
    if (Array.isArray(data.armPivots)) {
      data.armPivots.forEach((pivot) => {
        pivot.rotation.x *= 0.84;
      });
    }

    if (officeMonkey.sleepTimer <= 0) {
      officeMonkey.mode = 'walking';
      officeMonkey.nextSleepIn = 12 + Math.random() * 10;
      const target = randomAnimalRoamPoint();
      officeMonkey.roamTargetX = target.x;
      officeMonkey.roamTargetZ = target.z;
      data.body.rotation.z = 0;
      data.head.rotation.z = 0;
    }
    return;
  }

  if (officeMonkey.mode === 'goingToBed') {
    const targetX = monkeyBed.position.x + 0.02;
    const targetZ = monkeyBed.position.z;
    const dx = targetX - mesh.position.x;
    const dz = targetZ - mesh.position.z;
    const dist = Math.hypot(dx, dz);
    const move = Math.min(delta * 1.42, dist);
    if (dist > 0.0001) {
      const nx = mesh.position.x + (dx / dist) * move;
      const nz = mesh.position.z + (dz / dist) * move;
      const failedToRoute = moveAnimalWithCollision(officeMonkey, nx, nz, move, delta, false);
      setAnimalFacingFromMotion(officeMonkey, dx, dz);
      if (failedToRoute) {
        officeMonkey.mode = 'walking';
        officeMonkey.nextSleepIn = 1.8 + Math.random() * 2.2;
      }
    }
    data.phase += delta * 8.3;
    mesh.position.y = 0.01 + Math.abs(Math.sin(data.phase)) * MONKEY_STEP_HEIGHT * 0.85;
    data.legPivots[0].rotation.x = Math.sin(data.phase) * MONKEY_LEG_SWING;
    data.legPivots[1].rotation.x = Math.sin(data.phase + Math.PI) * MONKEY_LEG_SWING;
    if (Array.isArray(data.armPivots)) {
      data.armPivots[0].rotation.x = Math.sin(data.phase + Math.PI) * MONKEY_ARM_SWING;
      data.armPivots[1].rotation.x = Math.sin(data.phase) * MONKEY_ARM_SWING;
    }
    data.tailBase.rotation.y = 0.62 + Math.sin(data.phase * 0.7) * 0.24;

    if (dist < 0.14) {
      officeMonkey.mode = 'sleeping';
      officeMonkey.sleepTimer = 7 + Math.random() * 6;
      mesh.rotation.y = Math.PI / 2;
      mesh.position.y = 0.01;
      return;
    }
    return;
  }

  officeMonkey.nextSleepIn -= delta;
  if (officeMonkey.nextSleepIn <= 0) {
    officeMonkey.mode = 'goingToBed';
    return;
  }

  if (officeMonkey.roamTargetX == null || officeMonkey.roamTargetZ == null) {
    const target = randomAnimalRoamPoint();
    officeMonkey.roamTargetX = target.x;
    officeMonkey.roamTargetZ = target.z;
  }
  const dx = officeMonkey.roamTargetX - mesh.position.x;
  const dz = officeMonkey.roamTargetZ - mesh.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.26) {
    const target = randomAnimalRoamPoint();
    officeMonkey.roamTargetX = target.x;
    officeMonkey.roamTargetZ = target.z;
  } else {
    const move = Math.min((1.02 + officeMonkey.speed * 0.55) * delta, dist);
    const nx = mesh.position.x + (dx / dist) * move;
    const nz = mesh.position.z + (dz / dist) * move;
    moveAnimalWithCollision(officeMonkey, nx, nz, move, delta, true);
    setAnimalFacingFromMotion(officeMonkey, dx, dz);
  }

  data.phase += delta * 8.3;
  mesh.position.y = 0.01 + Math.abs(Math.sin(data.phase)) * MONKEY_STEP_HEIGHT;
  data.legPivots[0].rotation.x = Math.sin(data.phase) * MONKEY_LEG_SWING;
  data.legPivots[1].rotation.x = Math.sin(data.phase + Math.PI) * MONKEY_LEG_SWING;
  if (Array.isArray(data.armPivots)) {
    data.armPivots[0].rotation.x = Math.sin(data.phase + Math.PI) * MONKEY_ARM_SWING;
    data.armPivots[1].rotation.x = Math.sin(data.phase) * MONKEY_ARM_SWING;
  }
  data.tailBase.rotation.y = 0.7 + Math.sin(data.phase * 0.72) * 0.24;
}

function resolveWorkerCollision(prevX, prevZ, nextX, nextZ) {
  // Colisiones de muebles principales para evitar que los workers atraviesen objetos.
  const obstacles = [
    // TV + mueble
    { x: 9.25, z: 3, halfX: 1.45, halfZ: 0.9 },
    // Mesa redonda de reuniones
    { x: -12, z: -10, halfX: 2.5, halfZ: 2.5 },
    // Mesa de ping pong
    { x: -14, z: 5, halfX: 1.55, halfZ: 0.9 },
    // Sofas azules (zona TV)
    { x: 8, z: 9, halfX: 1.1, halfZ: 0.56 },
    { x: 10.5, z: 9, halfX: 1.1, halfZ: 0.56 },
    { x: 6, z: 10, halfX: 0.68, halfZ: 0.56 },
    // Sofas sueltos
    { x: 0, z: -4, halfX: 0.68, halfZ: 0.56 },
    { x: -6, z: -2, halfX: 0.68, halfZ: 0.56 },
  ];
  let x = nextX;
  let z = nextZ;
  let collided = false;
  for (const obs of obstacles) {
    const dx = x - obs.x;
    const dz = z - obs.z;
    if (Math.abs(dx) < obs.halfX && Math.abs(dz) < obs.halfZ) {
      collided = true;
      const penX = obs.halfX - Math.abs(dx);
      const penZ = obs.halfZ - Math.abs(dz);
      if (penX < penZ) {
        const dir = Math.sign(dx || (prevX - obs.x) || 1);
        x = obs.x + dir * obs.halfX;
      } else {
        const dir = Math.sign(dz || (prevZ - obs.z) || 1);
        z = obs.z + dir * obs.halfZ;
      }
    }
  }
  return { x, z, collided };
}

function applyWorkerMoveWithUnstuck(w, nx, nz, intendedMove, delta, isRoaming = false, allowBypass = true) {
  const prevX = w.mesh.position.x;
  const prevZ = w.mesh.position.z;

  if ((w.collisionBypassTimer || 0) > 0) {
    w.collisionBypassTimer -= delta;
    w.mesh.position.x = nx;
    w.mesh.position.z = nz;
    w.lastMoveDx = w.mesh.position.x - prevX;
    w.lastMoveDz = w.mesh.position.z - prevZ;
    w.collisionStuckTimer = 0;
    return;
  }

  const pos = resolveWorkerCollision(prevX, prevZ, nx, nz);
  w.mesh.position.x = pos.x;
  w.mesh.position.z = pos.z;
  w.lastMoveDx = pos.x - prevX;
  w.lastMoveDz = pos.z - prevZ;

  const moved = Math.hypot(pos.x - prevX, pos.z - prevZ);
  const blockedByCollision = pos.collided && intendedMove > 0.0005 && moved < intendedMove * 0.35;
  if (blockedByCollision) {
    w.collisionStuckTimer = (w.collisionStuckTimer || 0) + delta;
  } else {
    w.collisionStuckTimer = Math.max(0, (w.collisionStuckTimer || 0) - delta * 1.5);
  }

  if ((w.collisionStuckTimer || 0) >= 2) {
    if (isRoaming) {
      const nextTarget = randomWorkerRoamPoint();
      w.roamTargetX = nextTarget.x;
      w.roamTargetZ = nextTarget.z;
      w.roamPause = 0.15 + Math.random() * 0.35;
    } else {
      if (allowBypass) {
        // Si se atasca en modo dirigido, permitimos atravesar un momento.
        w.collisionBypassTimer = 1.1;
        w.mesh.position.x = nx;
        w.mesh.position.z = nz;
        w.lastMoveDx = w.mesh.position.x - prevX;
        w.lastMoveDz = w.mesh.position.z - prevZ;
      } else {
        w.collisionStuckTimer = 0;
        w.lastMoveDx = 0;
        w.lastMoveDz = 0;
        return true;
      }
    }
    w.collisionStuckTimer = 0;
  }
  return false;
}

function updateWorkers(delta) {
  // Update all GLTF animation mixers
  workers.forEach((w) => {
    if (w.mesh.userData.mixer) w.mesh.userData.mixer.update(delta);
  });

  const switchAction = (mesh, toAction) => {
    if (!toAction) return;
    const from = mesh.userData.currentAction;
    if (from === toAction) return;
    if (from) from.fadeOut(0.25);
    toAction.reset().fadeIn(0.25).play();
    mesh.userData.currentAction = toAction;
  };
  const setPose = (mesh) => {
    switchAction(mesh, mesh.userData.idleAction || mesh.userData.walkAction);
  };
  const setWalkPose = (mesh) => {
    switchAction(mesh, mesh.userData.walkAction || mesh.userData.idleAction);
  };
  const setWorkerYaw = (w, yaw) => {
    w.mesh.rotation.y = yaw;
  };
  const setFacingFromMotion = (w, fallbackDx, fallbackDz) => {
    const mdx = Number.isFinite(w.lastMoveDx) ? w.lastMoveDx : 0;
    const mdz = Number.isFinite(w.lastMoveDz) ? w.lastMoveDz : 0;
    if (Math.hypot(mdx, mdz) > 0.0002) {
      setWorkerYaw(w, Math.atan2(mdx, mdz));
      return;
    }
    if (Math.hypot(fallbackDx, fallbackDz) > 0.0002) {
      setWorkerYaw(w, Math.atan2(fallbackDx, fallbackDz));
    }
  };

  workers.forEach((w) => {
    if (w.mode === 'working' || w.mode === 'inMeeting' || w.mode === 'playingPingPong') return;
    if (w.mode === 'watchingTV' && !w.hasCan) return;

    if (w.mode === 'watchingTV' && w.hasCan) {
      w.breakTimer = (w.breakTimer || 0) + delta;
      if (w.breakTimer >= DRINK_TIME) {
        w.mode = 'goingToTrash';
        w.targetX = breakTrashPosition.x;
        w.targetZ = breakTrashPosition.z;
        w.breakTimer = 0;
      }
      return;
    }

    if (w.mode === 'atMachine') {
      w.breakTimer = (w.breakTimer || 0) + delta;
      if (w.breakTimer >= GRAB_TIME) {
        w.hasCan = true;
        const idx = (w.breakSofaIndex != null ? w.breakSofaIndex : 0) % breakSofaPositions.length;
        const pos = breakSofaPositions[idx];
        w.mode = 'goingToBreakSofa';
        w.targetX = pos.x;
        w.targetZ = pos.z;
        w.breakTimer = 0;
      }
      return;
    }
    if (w.mode === 'atTrash') {
      w.breakTimer = (w.breakTimer || 0) + delta;
      if (w.breakTimer >= THROW_TIME) {
        if (w.mesh.userData.can) w.mesh.userData.can.visible = false;
        w.hasCan = false;
        const idx = (w.breakSofaIndex != null ? w.breakSofaIndex : 3) % breakSofaPositions.length;
        const pos = breakSofaPositions[idx];
        w.mode = 'goingToBreakSofa';
        w.targetX = pos.x;
        w.targetZ = pos.z;
        w.breakTimer = 0;
      }
      return;
    }

    if (w.mode === 'goingToPingPong' && w.targetX != null) {
      const dx = w.targetX - w.mesh.position.x;
      const dz = w.targetZ - w.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < ARRIVAL_DIST) {
        w.mode = 'playingPingPong';
        w.mesh.position.set(w.targetX, 0.04, w.targetZ);
        setWorkerYaw(w, Math.atan2(pingPongCenterX - w.targetX, pingPongCenterZ - w.targetZ));
        setPose(w.mesh, 0, 0);
        return;
      }
      const move = Math.min(WALK_TO_DESK_SPEED * delta, dist);
      const nx = w.mesh.position.x + (dx / dist) * move;
      const nz = w.mesh.position.z + (dz / dist) * move;
      applyWorkerMoveWithUnstuck(w, nx, nz, move, delta);
      setWalkPose(w.mesh);
      setFacingFromMotion(w, dx, dz);
      return;
    }

    if (w.mode === 'goingToBreakSofa' && w.targetX != null) {
      const dx = w.targetX - w.mesh.position.x;
      const dz = w.targetZ - w.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < ARRIVAL_DIST) {
        w.mode = 'watchingTV';
        w.mesh.position.set(w.targetX, 0.04, w.targetZ);
        setWorkerYaw(w, Math.atan2(tvCenterX - w.targetX, tvCenterZ - w.targetZ));
        setPose(w.mesh, -0.72, -0.22);
        if (w.hasCan) w.breakTimer = 0;
        return;
      }
      const move = Math.min(WALK_TO_DESK_SPEED * delta, dist);
      const nx = w.mesh.position.x + (dx / dist) * move;
      const nz = w.mesh.position.z + (dz / dist) * move;
      applyWorkerMoveWithUnstuck(w, nx, nz, move, delta);
      setWalkPose(w.mesh);
      setFacingFromMotion(w, dx, dz);
      return;
    }

    if (w.mode === 'goingToMachine' && w.targetX != null) {
      const dx = w.targetX - w.mesh.position.x;
      const dz = w.targetZ - w.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < ARRIVAL_DIST) {
        w.mode = 'atMachine';
        w.mesh.position.set(w.targetX, 0.04, w.targetZ);
        setWorkerYaw(w, Math.atan2(maquinaRefrescos.position.x - w.targetX, maquinaRefrescos.position.z - w.targetZ));
        setPose(w.mesh, 0, 0);
        if (w.mesh.userData.can) w.mesh.userData.can.visible = true;
        w.breakTimer = 0;
        return;
      }
      const move = Math.min(WALK_TO_DESK_SPEED * delta, dist);
      const nx = w.mesh.position.x + (dx / dist) * move;
      const nz = w.mesh.position.z + (dz / dist) * move;
      applyWorkerMoveWithUnstuck(w, nx, nz, move, delta);
      setWalkPose(w.mesh);
      setFacingFromMotion(w, dx, dz);
      return;
    }

    if (w.mode === 'goingToTrash' && w.targetX != null) {
      const dx = w.targetX - w.mesh.position.x;
      const dz = w.targetZ - w.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < ARRIVAL_DIST) {
        w.mode = 'atTrash';
        w.mesh.position.set(w.targetX, 0.04, w.targetZ);
        setWorkerYaw(w, Math.atan2(papeleraGroup.position.x - w.targetX, papeleraGroup.position.z - w.targetZ));
        setPose(w.mesh, 0, 0);
        w.breakTimer = 0;
        return;
      }
      const move = Math.min(WALK_TO_DESK_SPEED * delta, dist);
      const nx = w.mesh.position.x + (dx / dist) * move;
      const nz = w.mesh.position.z + (dz / dist) * move;
      applyWorkerMoveWithUnstuck(w, nx, nz, move, delta);
      setWalkPose(w.mesh);
      setFacingFromMotion(w, dx, dz);
      return;
    }

    if (w.mode === 'goingToWork' && w.targetX != null) {
      const dx = w.targetX - w.mesh.position.x;
      const dz = w.targetZ - w.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < ARRIVAL_DIST) {
        w.mode = 'working';
        w.mesh.position.set(w.targetX, 0.04, w.targetZ);
        setWorkerYaw(w, Math.PI);
        setPose(w.mesh, -0.72, -0.25);
        return;
      }
      const move = Math.min(WALK_TO_DESK_SPEED * delta, dist);
      const nx = w.mesh.position.x + (dx / dist) * move;
      const nz = w.mesh.position.z + (dz / dist) * move;
      applyWorkerMoveWithUnstuck(w, nx, nz, move, delta);
      setWalkPose(w.mesh);
      setFacingFromMotion(w, dx, dz);
      return;
    }

    if (w.mode === 'goingToMeeting' && w.targetX != null) {
      w.meetingApproachTimer = (w.meetingApproachTimer || 0) + delta;
      const dx = w.targetX - w.mesh.position.x;
      const dz = w.targetZ - w.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      const seatArrivalDist = 0.32;
      const forceReassign = (w.meetingApproachTimer || 0) > 4.5;
      if (dist < seatArrivalDist) {
        const seatIndex = Number.isFinite(w.meetingSeatIndex) ? w.meetingSeatIndex : -1;
        if (seatIndex >= 0 && isMeetingSeatOccupiedByOther(w, seatIndex)) {
          const reassigned = assignMeetingSeatForWorker(w);
          if (!reassigned) {
            w.mode = 'walking';
            w.targetX = undefined;
            w.targetZ = undefined;
          }
          return;
        }
        w.mode = 'inMeeting';
        // Snap corto solo al estar muy cerca para quedar bien centrado en la silla.
        w.mesh.position.set(w.targetX, 0.04, w.targetZ);
        setWorkerYaw(w, Math.atan2(meetingCenterX - w.targetX, meetingCenterZ - w.targetZ));
        setPose(w.mesh, -0.72, -0.2);
        w.meetingApproachTimer = 0;
        return;
      }
      if (forceReassign) {
        w.meetingApproachTimer = 0;
        assignMeetingSeatForWorker(w);
        return;
      }
      const move = Math.min(WALK_TO_DESK_SPEED * delta, dist);
      const nx = w.mesh.position.x + (dx / dist) * move;
      const nz = w.mesh.position.z + (dz / dist) * move;
      applyWorkerMoveWithUnstuck(w, nx, nz, move, delta, false, true);
      setWalkPose(w.mesh);
      setFacingFromMotion(w, dx, dz);
      return;
    }

    const { mesh } = w;
    if ((w.roamPause || 0) > 0) {
      w.roamPause -= delta;
      mesh.position.y = 0;
      switchAction(mesh, mesh.userData.idleAction || mesh.userData.walkAction);
      return;
    }

    if (w.roamTargetX == null || w.roamTargetZ == null) {
      const nextTarget = randomWorkerRoamPoint();
      w.roamTargetX = nextTarget.x;
      w.roamTargetZ = nextTarget.z;
    }

    const dx = w.roamTargetX - mesh.position.x;
    const dz = w.roamTargetZ - mesh.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < ARRIVAL_DIST) {
      const nextTarget = randomWorkerRoamPoint();
      w.roamTargetX = nextTarget.x;
      w.roamTargetZ = nextTarget.z;
      w.roamPause = 0.35 + Math.random() * 1.15;
      mesh.position.y = 0;
      setPose(mesh, 0, 0);
      return;
    }

    const roamSpeed = 0.55 + w.speed * 0.45;
    const move = Math.min(roamSpeed * delta, dist);
    const nx = mesh.position.x + (dx / dist) * move;
    const nz = mesh.position.z + (dz / dist) * move;
    applyWorkerMoveWithUnstuck(w, nx, nz, move, delta, true);
    setWalkPose(mesh);
    setFacingFromMotion(w, dx, dz);
  });

  // Pelota de ping pong: visible y animada solo cuando hay 2 jugando
  const playingCount = workers.filter((w) => w.mode === 'playingPingPong').length;
  if (playingCount === 2) {
    pingPongBall.visible = true;
    pingPongBallT += delta * PINGPONG_BALL_SPEED * pingPongBallDir;
    if (pingPongBallT >= 1) {
      pingPongBallT = 1;
      pingPongBallDir = -1;
    } else if (pingPongBallT <= 0) {
      pingPongBallT = 0;
      pingPongBallDir = 1;
    }
    const a = breakPingPongPositions[0];
    const b = breakPingPongPositions[1];
    pingPongBall.position.x = a.x + (b.x - a.x) * pingPongBallT;
    pingPongBall.position.z = a.z + (b.z - a.z) * pingPongBallT;
    pingPongBall.position.y = 0.85 + Math.sin(pingPongBallT * Math.PI) * 0.08;
  } else {
    pingPongBall.visible = false;
  }
}

// --- Resize y loop ---
window.addEventListener('resize', () => {
  const aspect = window.innerWidth / window.innerHeight;
  camera.left = -frustum * aspect;
  camera.right = frustum * aspect;
  camera.top = frustum;
  camera.bottom = -frustum;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (labelRenderer) labelRenderer.setSize(window.innerWidth, window.innerHeight);
});
window.addEventListener('beforeunload', saveWorkersState);

const clock = new THREE.Clock();
let workersSaveTimer = 0;
function updateMeetingFocusUI(delta) {
  const allSeated = workers.length > 0 && workers.every((w) => w.mode === 'inMeeting');
  if (allSeated && !meetingFocus.active && !meetingFocus.dismissed) {
    meetingFocus.active = true;
    meetingFocus.overlayShown = false;
    meetingFocus.revealTimer = 0;
    meetingFocus.orbitProgress = 0;
    meetingFocus.prevZoom = camera.zoom;
    meetingFocus.prevTarget.copy(controls.target);
  } else if (!allSeated && meetingFocus.active) {
    meetingFocus.active = false;
    meetingFocus.overlayShown = false;
    meetingFocus.revealTimer = 0;
    meetingFocus.orbitProgress = 0;
    hideMeetingSummary();
    restoreFromMeetingFocus();
  } else if (!allSeated && meetingFocus.dismissed) {
    meetingFocus.dismissed = false;
  }

  if (meetingFocus.active) {
    const desiredTarget = new THREE.Vector3(meetingCenterX, 0.7, meetingCenterZ);
    controls.target.lerp(desiredTarget, 0.035);
    // Solo un pequeño giro inicial y luego se queda fijo.
    if (meetingFocus.orbitProgress < meetingFocus.orbitMax) {
      const relX = camera.position.x - controls.target.x;
      const relZ = camera.position.z - controls.target.z;
      const remaining = meetingFocus.orbitMax - meetingFocus.orbitProgress;
      const ang = Math.min(delta * 0.22, remaining);
      const cosA = Math.cos(ang);
      const sinA = Math.sin(ang);
      camera.position.x = controls.target.x + relX * cosA - relZ * sinA;
      camera.position.z = controls.target.z + relX * sinA + relZ * cosA;
      meetingFocus.orbitProgress += ang;
    }
    const desiredZoom = 6.1;
    camera.zoom += (desiredZoom - camera.zoom) * 0.035;
    camera.updateProjectionMatrix();
    if (!meetingFocus.overlayShown) {
      meetingFocus.revealTimer += delta;
      if (meetingFocus.revealTimer >= 2) {
        showMeetingSummary(workers);
        meetingFocus.overlayShown = true;
      }
    }
  }
}

function updateWorkFocusUI(delta) {
  if (meetingFocus.active || meetingFocus.overlayShown) {
    if (workFocus.active) {
      workFocus.active = false;
      workFocus.orbitProgress = 0;
      restoreFromWorkFocus();
    }
    return;
  }

  const seatedWorkers = workers.slice(0, deskPositions.length);
  const allWorking = seatedWorkers.length > 0 && seatedWorkers.every((w) => w.mode === 'working');

  if (allWorking && workFocus.requested && !workFocus.active) {
    workFocus.active = true;
    workFocus.orbitProgress = 0;
    workFocus.prevZoom = camera.zoom;
    workFocus.prevTarget.copy(controls.target);
  } else if ((!allWorking || !workFocus.requested) && workFocus.active) {
    workFocus.active = false;
    workFocus.orbitProgress = 0;
    restoreFromWorkFocus();
  }

  if (!allWorking) workFocus.requested = false;
  if (!workFocus.active) return;

  const desiredTarget = new THREE.Vector3(0, 0.85, deskZ + 0.2);
  controls.target.lerp(desiredTarget, 0.035);
  if (workFocus.orbitProgress < workFocus.orbitMax) {
    const relX = camera.position.x - controls.target.x;
    const relZ = camera.position.z - controls.target.z;
    const remaining = workFocus.orbitMax - workFocus.orbitProgress;
    const ang = Math.min(delta * 0.22, remaining);
    const cosA = Math.cos(ang);
    const sinA = Math.sin(ang);
    camera.position.x = controls.target.x + relX * cosA - relZ * sinA;
    camera.position.z = controls.target.z + relX * sinA + relZ * cosA;
    workFocus.orbitProgress += ang;
  }
  const desiredZoom = 6.1;
  camera.zoom += (desiredZoom - camera.zoom) * 0.035;
  camera.updateProjectionMatrix();
}

function updateArcadeScreen(t) {
  if (!arcadeScreenMat || hoveredArcade) return;
  const colors = [0x00ffff, 0xff00ff, 0xffff00, 0x00ff88, 0xff6600, 0x0088ff];
  const idx = Math.floor(t * 1.2) % colors.length;
  const nextIdx = (idx + 1) % colors.length;
  const blend = (Math.sin(t * 8) * 0.5 + 0.5);
  const c1 = colors[idx];
  const c2 = colors[nextIdx];
  const r = ((c1 >> 16) & 0xff) * (1 - blend) + ((c2 >> 16) & 0xff) * blend;
  const g = ((c1 >> 8) & 0xff) * (1 - blend) + ((c2 >> 8) & 0xff) * blend;
  const b = (c1 & 0xff) * (1 - blend) + (c2 & 0xff) * blend;
  arcadeScreenMat.emissive.setRGB(r / 255, g / 255, b / 255);
  arcadeScreenMat.emissiveIntensity = 0.4 + Math.sin(t * 6) * 0.35;
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  if (abbKinematics) {
    abbJointTime += delta;
    let ji = 0;
    for (const prop in abbKinematics.joints) {
      if (!abbKinematics.joints[prop].static) {
        const { min, max } = abbKinematics.joints[prop].limits;
        const v = min + (max - min) * 0.5 * (1 + Math.sin(abbJointTime * 0.4 + ji * 1.3));
        abbKinematics.setJointValue(prop, v);
        ji++;
      }
    }
  }
  updateArcadeScreen(t);
  updateComputerGifTexture();
  updateClickIndicators(t);
  updateCat(delta);
  updateMonkey(delta);
  updateWorkers(delta);
  updateWorkFocusUI(delta);
  updateMeetingFocusUI(delta);
  updateInteractiveBodyHover();
  updateDeskScreenUsage();
  workersSaveTimer += delta;
  if (workersSaveTimer >= 0.75) {
    workersSaveTimer = 0;
    saveWorkersState();
  }
  controls.update();
  renderer.render(scene, camera);
  if (labelRenderer) labelRenderer.render(scene, camera);
}
animate();
