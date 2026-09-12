const API_BASE = 'https://ninx-api.maataug.com.br';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfDoc = null;
let currentPage = 1;
let pageCount = 1;
let originalBytes = null; 
let docGuid = '';
let drawing = false;
let currentStroke = [];
const PEN_COLOR = '#1a1a18';

const pageSignatures = {};

const pdfCanvas = document.getElementById('pdf-canvas');
const pdfCtx = pdfCanvas.getContext('2d');
const sigCanvas = document.getElementById('sig-canvas');
const sigCtx = sigCanvas.getContext('2d');
const canvasWrap = document.getElementById('canvas-wrap');
const signHint = document.getElementById('sign-hint');

/* ── ZOOM (PINÇA) ── */
const MIN_ZOOM = 1, MAX_ZOOM = 3;
let zoomLevel = 1;
const activePointers = new Map();
let pinchStartDist = 0;
let pinchStartZoom = 1;

/* ── RASCUNHO (LOCALSTORAGE) ── */
function draftKey() {
  return `ninx-sig-draft-${docGuid}`;
}
function saveDraft() {
  try { localStorage.setItem(draftKey(), JSON.stringify(pageSignatures)); } catch (e) {}
}
function loadDraft() {
  try {
    const raw = localStorage.getItem(draftKey());
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function clearDraft() {
  try { localStorage.removeItem(draftKey()); } catch (e) {}
}

function updateHint() {
  const totalStrokes = Object.values(pageSignatures).reduce((acc, curr) => acc + curr.length, 0);
  signHint.classList.toggle('hidden', totalStrokes > 0);
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  setupSignatureEvents();
  
  document.getElementById('btn-prev').addEventListener('click', () => changePage(-1));
  document.getElementById('btn-next').addEventListener('click', () => changePage(1));
  document.getElementById('btn-clear').addEventListener('click', clearSig);
  document.getElementById('btn-undo').addEventListener('click', undoLast);
  document.getElementById('btn-conclude').addEventListener('click', conclude);
});

function showState(id) {
  ['state-loading', 'state-error', 'state-doc', 'state-done'].forEach(s => {
    document.getElementById(s).classList.remove('show');
  });
  document.getElementById(id).classList.add('show');
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

async function init() {
  showState('state-loading');

  const path = location.pathname;
  const match = path.match(/documento\/([^/?#]+)/i);
  const params = new URLSearchParams(location.search);
  docGuid = match ? match[1] : params.get('guid');

  if (!docGuid) {
    document.getElementById('error-msg').textContent = 'Nenhum identificador de documento encontrado na URL.';
    showState('state-error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/AssinaturaEletronica/${docGuid}`);
    if (res.status === 404) throw new Error('Documento não encontrado (404).');
    if (!res.ok) throw new Error(`Erro ao buscar documento (${res.status}).`);

    const data = await res.json();
    const b64 = data.documentoBase64;
    if (!b64) throw new Error('Documento não foi encontrado.');

    document.getElementById('doc-name').textContent = data.filename ?? `Documento ${docGuid}`;

    const binary = atob(b64);
    originalBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      originalBytes[i] = binary.charCodeAt(i);
    }

    await loadPdfViewer();

    const draft = loadDraft();
    if (draft) {
      Object.assign(pageSignatures, draft);
      redraw();
      toast('Rascunho restaurado.');
    }
    updateHint();

    showState('state-doc');
  } catch (e) {
    document.getElementById('error-msg').textContent = e.message;
    showState('state-error');
  }
}

async function loadPdfViewer() {
  pdfDoc = await pdfjsLib.getDocument({ data: originalBytes.slice() }).promise;
  pageCount = pdfDoc.numPages;
  currentPage = 1;

  if (pageCount > 1) {
    document.getElementById('page-nav').style.display = 'flex';
  }

  await renderPage(currentPage);
}

async function renderPage(num) {
  const page = await pdfDoc.getPage(num);

  const dpr = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: 1.5 * dpr });

  pdfCanvas.width = viewport.width;
  pdfCanvas.height = viewport.height;
  pdfCanvas.style.width = `${viewport.width / dpr}px`;
  sigCanvas.width = viewport.width;
  sigCanvas.height = viewport.height;

  await page.render({ canvasContext: pdfCtx, viewport: viewport }).promise;

  document.getElementById('page-label').textContent = `${num} / ${pageCount}`;
  document.getElementById('btn-prev').disabled = num === 1;
  document.getElementById('btn-next').disabled = num === pageCount;

  if (!pageSignatures[currentPage]) {
    pageSignatures[currentPage] = [];
  }
  
  redraw();
}

async function changePage(dir) {
  const next = currentPage + dir;
  if (next < 1 || next > pageCount) return;
  currentPage = next;
  await renderPage(currentPage);
}

/* ── CAPTURA DE TRAÇOS (SIGNATURE CANVAS) ── */
const MIN_POINT_DIST = 2; // px no buffer do canvas — descarta pontos redundantes, PDF final fica bem menor

function pointerDist(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function applyZoom() {
  canvasWrap.style.transform = zoomLevel === 1 ? '' : `scale(${zoomLevel})`;
}

function setupSignatureEvents() {
  sigCanvas.addEventListener('pointerdown', e => {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 2) {
      drawing = false;
      currentStroke = [];
      redraw();
      const [p1, p2] = [...activePointers.values()];
      pinchStartDist = pointerDist(p1, p2);
      pinchStartZoom = zoomLevel;

      const rect = canvasWrap.getBoundingClientRect();
      const originX = ((p1.x + p2.x) / 2 - rect.left) / rect.width * 100;
      const originY = ((p1.y + p2.y) / 2 - rect.top) / rect.height * 100;
      canvasWrap.style.transformOrigin = `${originX}% ${originY}%`;
      return;
    }
    if (activePointers.size > 2) return;

    e.preventDefault();
    drawing = true;
    currentStroke = [getCoordinates(e)];
  });

  sigCanvas.addEventListener('pointermove', e => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 2) {
      e.preventDefault();
      const [p1, p2] = [...activePointers.values()];
      const newDist = pointerDist(p1, p2);
      zoomLevel = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchStartZoom * (newDist / pinchStartDist)));
      if (Math.abs(zoomLevel - 1) < 0.03) zoomLevel = 1;
      applyZoom();
      return;
    }

    if (!drawing) return;
    e.preventDefault();
    const point = getCoordinates(e);
    const last = currentStroke[currentStroke.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= MIN_POINT_DIST) {
      currentStroke.push(point);
      redraw();
    }
  });

  const stopDrawing = e => {
    activePointers.delete(e.pointerId);
    if (!drawing) return;
    drawing = false;
    if (currentStroke.length > 1) {
      const sizeValue = +document.getElementById('pen-size').value;
      pageSignatures[currentPage].push({
        pts: [...currentStroke],
        size: sizeValue
      });
      saveDraft();
      updateHint();
    }
    currentStroke = [];
    redraw();
  };

  sigCanvas.addEventListener('pointerup', stopDrawing);
  sigCanvas.addEventListener('pointerleave', stopDrawing);
  sigCanvas.addEventListener('pointercancel', stopDrawing);
}

function getCoordinates(e) {
  const rect = sigCanvas.getBoundingClientRect();
  const scaleX = sigCanvas.width / rect.width;
  const scaleY = sigCanvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

function redraw() {
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  
  const currentPageStrokes = pageSignatures[currentPage] || [];
  const activeStrokes = [...currentPageStrokes];
  
  if (currentStroke.length > 0) {
    activeStrokes.push({
      pts: currentStroke,
      size: +document.getElementById('pen-size').value
    });
  }

  for (const stroke of activeStrokes) {
    if (stroke.pts.length < 2) continue;
    sigCtx.beginPath();
    sigCtx.strokeStyle = PEN_COLOR;
    sigCtx.lineWidth = stroke.size;
    sigCtx.lineCap = 'round';
    sigCtx.lineJoin = 'round';
    
    sigCtx.moveTo(stroke.pts[0].x, stroke.pts[0].y);
    for (let i = 1; i < stroke.pts.length; i++) {
      sigCtx.lineTo(stroke.pts[i].x, stroke.pts[i].y);
    }
    sigCtx.stroke();
  }
}

function undoLast() {
  if (pageSignatures[currentPage] && pageSignatures[currentPage].length > 0) {
    pageSignatures[currentPage].pop();
    redraw();
    saveDraft();
    updateHint();
  }
}

function clearSig() {
  pageSignatures[currentPage] = [];
  redraw();
  saveDraft();
  updateHint();
}


async function conclude() {
  const totalStrokes = Object.values(pageSignatures).reduce((acc, curr) => acc + curr.length, 0);
  if (totalStrokes === 0) {
    toast('Por favor, faça a sua assinatura antes de concluir.');
    return;
  }

  const btn = document.getElementById('btn-conclude');
  const spinner = document.getElementById('btn-spinner');
  const label = document.getElementById('btn-label');

  btn.disabled = true;
  spinner.style.display = 'block';
  label.textContent = 'Enviando…';

  try {
    const pdfDocLib = await PDFLib.PDFDocument.load(originalBytes);
    const pages = pdfDocLib.getPages();

    for (const pageIdxStr in pageSignatures) {
      const pageIndex = parseInt(pageIdxStr) - 1; // Mapeia para index baseado em zero
      const targetPage = pages[pageIndex];
      const strokesInPage = pageSignatures[pageIdxStr];

      if (!strokesInPage || strokesInPage.length === 0) continue;

      const { width, height } = targetPage.getSize();
      
      const scaleX = width / sigCanvas.width;
      const scaleY = height / sigCanvas.height;

      for (const stroke of strokesInPage) {
        if (stroke.pts.length < 2) continue;

        const svgPath = stroke.pts
          .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * scaleX} ${p.y * scaleY}`)
          .join(' ');

        targetPage.drawSvgPath(svgPath, {
          x: 0,
          y: height,
          borderColor: PDFLib.rgb(0.102, 0.102, 0.094),
          borderWidth: stroke.size * scaleX,
          borderOpacity: 1,
          borderLineCap: PDFLib.LineCapStyle.Round
        });
      }
    }

    const savedBytes = await pdfDocLib.save();
    const modifiedPdfBase64 = btoa(
      String.fromCharCode.apply(null, savedBytes)
    );

    const res = await fetch(`${API_BASE}/api/AssinaturaEletronica/confirmar/${docGuid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        ImagemBase64: modifiedPdfBase64
      })
    });

    if (!res.ok) throw new Error(`Falha ao enviar (${res.status}).`);

    clearDraft();
    showState('state-done');
  } catch (e) {
    toast(e.message);
    btn.disabled = false;
    spinner.style.display = 'none';
    label.textContent = 'Concluir';
  }
}