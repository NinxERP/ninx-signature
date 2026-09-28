/* ── CONFIGURAÇÃO ── */

const API_BASE = 'https://ninx-api.maataug.com.br';

const PDF_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const PDF_WORKER_SRI = 'sha512-BbrZ76UNZq5BhH7LL7pn9A4TKQpQeNCHOo65/akfelcIBbcVvYWOFQKPXIrykE3qZxYjmDX573oa4Ywsc7rpTw==';

const RENDER_SCALE = 1.5;        // px CSS por ponto do PDF com zoom 1
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;
const ZOOM_SNAP = 0.03;
const WHEEL_ZOOM_SPEED = 0.002;
const MIN_POINT_DIST = 2;        // px; descarta pontos redundantes

const PEN_COLOR = '#1a1a18';
const PEN_COLOR_RGB = [0.102, 0.102, 0.094];

const HINT_PEN = '✎ Assine aqui';
const HINT_HAND = 'Toque em ✎ para assinar';

/* ── ELEMENTOS ── */

const $ = id => document.getElementById(id);

const pdfCanvas = $('pdf-canvas');
const pdfCtx = pdfCanvas.getContext('2d');
const sigCanvas = $('sig-canvas');
const sigCtx = sigCanvas.getContext('2d');
const canvasWrap = $('canvas-wrap');
const canvasScroll = $('canvas-scroll');
const signHint = $('sign-hint');
const penSize = $('pen-size');
const btnPen = $('btn-pen');
const btnPrev = $('btn-prev');
const btnNext = $('btn-next');
const btnConclude = $('btn-conclude');
const confirmDialog = $('confirm-dialog');

/* ── ESTADO ── */

let docGuid = '';
let originalBytes = null;
let pdfDoc = null;
let currentPage = 1;
let pageCount = 1;
let pageWidthPts = 1;

// { [página]: [{ pts: [{x, y}] normalizados 0..1, size em pontos do PDF }] }
const pageSignatures = {};
let currentStroke = [];
let drawing = false;

let mode = 'hand';      // 'hand' | 'pen'
let zoomLevel = 1;
let baseWidth = 0;      // px CSS com zoom 1
const activePointers = new Map();
let pinch = null;       // { dist, zoom, pt }

/* ── INICIALIZAÇÃO ── */

document.addEventListener('DOMContentLoaded', () => {
  bindToolbar();
  bindPointerEvents();
  init();
});

function bindToolbar() {
  btnPrev.addEventListener('click', () => changePage(-1));
  btnNext.addEventListener('click', () => changePage(1));
  btnPen.addEventListener('click', () => setMode(mode === 'pen' ? 'hand' : 'pen'));
  $('btn-zoom-in').addEventListener('click', () => zoomAt(zoomLevel * ZOOM_STEP));
  $('btn-zoom-out').addEventListener('click', () => zoomAt(zoomLevel / ZOOM_STEP));
  $('btn-undo').addEventListener('click', undoLastStroke);
  $('btn-clear').addEventListener('click', clearPage);
  btnConclude.addEventListener('click', conclude);
  window.addEventListener('resize', updateBaseWidth);
}

async function init() {
  showState('state-loading');

  docGuid = readGuidFromUrl();
  if (!docGuid) {
    showError('Nenhum identificador de documento encontrado na URL.');
    return;
  }

  try {
    const { filename, bytes } = await fetchDocument(docGuid);
    $('doc-name').textContent = filename ?? `Documento ${docGuid}`;
    originalBytes = bytes;

    await setupPdfWorker();
    await openPdf();
    restoreDraft();

    showState('state-doc');
    updateBaseWidth(); // só agora o #canvas-scroll tem largura
  } catch (e) {
    showError(e.message);
  }
}

function readGuidFromUrl() {
  const match = location.pathname.match(/documento\/([^/?#]+)/i);
  return match ? match[1] : new URLSearchParams(location.search).get('guid');
}

/* ── API ── */

async function fetchDocument(guid) {
  const res = await fetch(`${API_BASE}/api/AssinaturaEletronica/${guid}`);
  if (res.status === 404) throw new Error('Documento não encontrado (404).');
  if (!res.ok) throw new Error(await apiErrorMessage(res, `Erro ao buscar documento (${res.status}).`));

  const data = await res.json();
  if (!data.documentoBase64) throw new Error('Documento não foi encontrado.');

  return { filename: data.filename, bytes: base64ToBytes(data.documentoBase64) };
}

async function postSignedDocument(guid, pdfBase64) {
  const res = await fetch(`${API_BASE}/api/AssinaturaEletronica/confirmar/${guid}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ImagemBase64: pdfBase64 })
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res, `Falha ao enviar (${res.status}).`));
}

// Erros de negócio da API vêm como { messagem } (ex.: link expirado).
async function apiErrorMessage(res, fallback) {
  try {
    const body = await res.json();
    if (body && typeof body.messagem === 'string' && body.messagem) return body.messagem;
  } catch (e) {}
  return fallback;
}

/* ── PDF: CARREGAMENTO E RENDERIZAÇÃO ── */

// Worker não aceita integrity como <script>: baixa com SRI e instancia do conteúdo verificado.
async function setupPdfWorker() {
  let res;
  try {
    res = await fetch(PDF_WORKER_URL, { integrity: PDF_WORKER_SRI, mode: 'cors', credentials: 'omit' });
  } catch (e) {
    throw new Error('Não foi possível carregar o visualizador de documentos com segurança.');
  }
  if (!res.ok) throw new Error('Não foi possível carregar o visualizador de documentos.');
  const blobUrl = URL.createObjectURL(new Blob([await res.text()], { type: 'text/javascript' }));
  pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(blobUrl);
}

async function openPdf() {
  pdfDoc = await pdfjsLib.getDocument({ data: originalBytes.slice() }).promise;
  pageCount = pdfDoc.numPages;
  currentPage = 1;

  $('page-nav').hidden = pageCount === 1;

  await renderPage(currentPage);
}

async function renderPage(num) {
  const page = await pdfDoc.getPage(num);
  const dpr = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: RENDER_SCALE * dpr });
  pageWidthPts = page.getViewport({ scale: 1 }).width;

  pdfCanvas.width = sigCanvas.width = viewport.width;
  pdfCanvas.height = sigCanvas.height = viewport.height;
  await page.render({ canvasContext: pdfCtx, viewport }).promise;

  updatePageNav(num);
  pageSignatures[num] ??= [];

  zoomLevel = 1;
  updateBaseWidth();
  redrawStrokes();
}

function updatePageNav(num) {
  $('page-label').textContent = `${num} / ${pageCount}`;
  btnPrev.disabled = num === 1;
  btnNext.disabled = num === pageCount;
}

async function changePage(dir) {
  const next = currentPage + dir;
  if (next < 1 || next > pageCount) return;
  currentPage = next;
  await renderPage(currentPage);
}

/* ── MODO (MOVER / CANETA) ── */

function setMode(newMode) {
  mode = newMode;
  const isPen = mode === 'pen';
  canvasScroll.classList.toggle('mode-pen', isPen);
  canvasScroll.classList.toggle('mode-hand', !isPen);
  btnPen.classList.toggle('active', isPen);
  btnPen.setAttribute('aria-pressed', String(isPen));
  signHint.textContent = isPen ? HINT_PEN : HINT_HAND;
}

/* ── ZOOM ── */
// Muda a largura real do documento (não transform), para o #canvas-scroll poder rolar.

function contentPointAt(ox, oy) {
  return {
    x: (canvasScroll.scrollLeft + ox) / zoomLevel,
    y: (canvasScroll.scrollTop + oy) / zoomLevel
  };
}

// Mantém o ponto de conteúdo `pt` sob (ox, oy).
function setZoom(zoom, ox, oy, pt) {
  zoomLevel = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  if (Math.abs(zoomLevel - 1) < ZOOM_SNAP) zoomLevel = 1;

  canvasWrap.style.width = `${baseWidth * zoomLevel}px`;
  canvasScroll.scrollLeft = pt.x * zoomLevel - ox;
  canvasScroll.scrollTop = pt.y * zoomLevel - oy;
}

function zoomAt(zoom, clientX, clientY) {
  const rect = canvasScroll.getBoundingClientRect();
  const ox = clientX === undefined ? rect.width / 2 : clientX - rect.left;
  const oy = clientY === undefined ? rect.height / 2 : clientY - rect.top;
  setZoom(zoom, ox, oy, contentPointAt(ox, oy));
}

function updateBaseWidth() {
  if (!canvasScroll.clientWidth) return; // ainda oculto
  const style = getComputedStyle(canvasScroll);
  const available = canvasScroll.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  baseWidth = Math.min(available, pageWidthPts * RENDER_SCALE);
  zoomAt(zoomLevel);
}

/* ── ENTRADA DE PONTEIRO (TOQUE, CANETA, MOUSE) ── */

function bindPointerEvents() {
  canvasScroll.addEventListener('pointerdown', onPointerDown);
  canvasScroll.addEventListener('pointermove', onPointerMove);
  canvasScroll.addEventListener('pointerup', onPointerUp);
  canvasScroll.addEventListener('pointercancel', onPointerUp);
  // Ctrl+roda e pinça do trackpad
  canvasScroll.addEventListener('wheel', onWheel, { passive: false });
}

function onPointerDown(e) {
  const isMouse = e.pointerType === 'mouse';
  if (isMouse && (e.button !== 0 || e.target === canvasScroll)) return; // barra de rolagem / margem

  canvasScroll.setPointerCapture(e.pointerId);
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (activePointers.size === 2) {
    cancelStroke();
    startPinch();
    return;
  }
  if (activePointers.size > 2) return;

  e.preventDefault();
  if (mode === 'pen' && e.target === sigCanvas) startStroke(e);
}

function onPointerMove(e) {
  const prev = activePointers.get(e.pointerId);
  if (!prev) return;
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  e.preventDefault();

  if (pinch) {
    if (activePointers.size === 2) updatePinch();
  } else if (drawing) {
    extendStroke(e);
  } else if (mode === 'hand' && activePointers.size === 1) {
    canvasScroll.scrollBy(prev.x - e.clientX, prev.y - e.clientY);
  }
}

function onPointerUp(e) {
  activePointers.delete(e.pointerId);
  if (activePointers.size < 2) pinch = null;
  if (drawing) finishStroke();
}

function onWheel(e) {
  if (!e.ctrlKey) return;
  e.preventDefault();
  zoomAt(zoomLevel * Math.exp(-e.deltaY * WHEEL_ZOOM_SPEED), e.clientX, e.clientY);
}

function measurePinch() {
  const [a, b] = [...activePointers.values()];
  const rect = canvasScroll.getBoundingClientRect();
  return {
    ox: (a.x + b.x) / 2 - rect.left,
    oy: (a.y + b.y) / 2 - rect.top,
    dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
  };
}

function startPinch() {
  const { ox, oy, dist } = measurePinch();
  pinch = { dist, zoom: zoomLevel, pt: contentPointAt(ox, oy) };
}

function updatePinch() {
  const { ox, oy, dist } = measurePinch();
  setZoom(pinch.zoom * dist / pinch.dist, ox, oy, pinch.pt);
}

/* ── TRAÇOS DA ASSINATURA ── */

function pointFromEvent(e) {
  const rect = sigCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / rect.width,
    y: (e.clientY - rect.top) / rect.height
  };
}

function startStroke(e) {
  drawing = true;
  currentStroke = [pointFromEvent(e)];
}

function extendStroke(e) {
  const point = pointFromEvent(e);
  const last = currentStroke[currentStroke.length - 1];
  const distPx = Math.hypot((point.x - last.x) * sigCanvas.width, (point.y - last.y) * sigCanvas.height);
  if (distPx < MIN_POINT_DIST) return;

  currentStroke.push(point);
  redrawStrokes();
}

function finishStroke() {
  if (currentStroke.length > 1) {
    pageSignatures[currentPage].push({ pts: currentStroke, size: +penSize.value });
    onStrokesChanged();
  }
  cancelStroke();
}

function cancelStroke() {
  drawing = false;
  currentStroke = [];
  redrawStrokes();
}

function undoLastStroke() {
  if (!pageSignatures[currentPage]?.length) return;
  pageSignatures[currentPage].pop();
  redrawStrokes();
  onStrokesChanged();
}

function clearPage() {
  pageSignatures[currentPage] = [];
  redrawStrokes();
  onStrokesChanged();
}

function countStrokes() {
  return Object.values(pageSignatures).reduce((total, strokes) => total + strokes.length, 0);
}

function onStrokesChanged() {
  saveDraft();
  updateSignState();
}

function updateSignState() {
  const hasSignature = countStrokes() > 0;
  signHint.classList.toggle('hidden', hasSignature);
  btnConclude.disabled = !hasSignature;
}

function redrawStrokes() {
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);

  const strokes = [...(pageSignatures[currentPage] || [])];
  if (currentStroke.length > 0) strokes.push({ pts: currentStroke, size: +penSize.value });

  for (const stroke of strokes) drawStroke(stroke);
}

function drawStroke({ pts, size }) {
  if (pts.length < 2) return;
  const w = sigCanvas.width;
  const h = sigCanvas.height;

  sigCtx.beginPath();
  sigCtx.strokeStyle = PEN_COLOR;
  sigCtx.lineWidth = size * w / pageWidthPts;
  sigCtx.lineCap = 'round';
  sigCtx.lineJoin = 'round';
  sigCtx.moveTo(pts[0].x * w, pts[0].y * h);
  for (const p of pts.slice(1)) sigCtx.lineTo(p.x * w, p.y * h);
  sigCtx.stroke();
}

/* ── RASCUNHO (LOCALSTORAGE) ── */

// v2: traços normalizados; rascunhos v1 (em px) são ignorados.
function draftKey() {
  return `ninx-sig-draft-v2-${docGuid}`;
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

function restoreDraft() {
  const draft = loadDraft();
  if (draft) {
    Object.assign(pageSignatures, draft);
    redrawStrokes();
    toast('Rascunho restaurado.');
  }
  updateSignState();
}

/* ── CONCLUSÃO E ENVIO ── */

// <dialog> e não confirm(): WebViews (WhatsApp, Instagram) podem ignorar confirm().
function conclude() {
  if (countStrokes() === 0) {
    toast('Por favor, faça a sua assinatura antes de concluir.');
    return;
  }

  confirmDialog.returnValue = '';
  confirmDialog.addEventListener('close', () => {
    if (confirmDialog.returnValue === 'ok') send();
  }, { once: true });
  confirmDialog.showModal();
}

async function send() {
  setSending(true);
  try {
    const signedPdf = await buildSignedPdf();
    await postSignedDocument(docGuid, bytesToBase64(signedPdf));
    clearDraft();
    showState('state-done');
  } catch (e) {
    toast(e.message);
    setSending(false);
  }
}

async function buildSignedPdf() {
  const pdf = await PDFLib.PDFDocument.load(originalBytes);
  const pages = pdf.getPages();

  for (const [pageNum, strokes] of Object.entries(pageSignatures)) {
    const page = pages[Number(pageNum) - 1];
    const { width, height } = page.getSize();

    for (const { pts, size } of strokes) {
      if (pts.length < 2) continue;

      const svgPath = pts
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * width} ${p.y * height}`)
        .join(' ');

      page.drawSvgPath(svgPath, {
        x: 0,
        y: height,
        borderColor: PDFLib.rgb(...PEN_COLOR_RGB),
        borderWidth: size,
        borderOpacity: 1,
        borderLineCap: PDFLib.LineCapStyle.Round
      });
    }
  }

  return pdf.save();
}

/* ── UTILITÁRIOS ── */

function base64ToBytes(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

// Em blocos: fromCharCode com o arquivo inteiro estoura a pilha.
function bytesToBase64(bytes) {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/* ── UI: ESTADOS DA TELA E AVISOS ── */

function showState(id) {
  document.querySelectorAll('.state-container').forEach(el => el.classList.remove('show'));
  $(id).classList.add('show');
}

function showError(message) {
  $('error-msg').textContent = message;
  showState('state-error');
}

function setSending(sending) {
  btnConclude.disabled = sending;
  $('btn-spinner').style.display = sending ? 'block' : 'none';
  $('btn-label').textContent = sending ? 'Enviando…' : 'Concluir';
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}
