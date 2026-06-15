const API_BASE = 'https://api.exemplo.com';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfDoc = null;
let currentPage = 1;
let pageCount = 1;
let originalBytes = null; 
let docGuid = '';
let drawing = false;
let currentStroke = [];
let penColor = '#1a1a18';


const pageSignatures = {};

const pdfCanvas = document.getElementById('pdf-canvas');
const pdfCtx = pdfCanvas.getContext('2d');
const sigCanvas = document.getElementById('sig-canvas');
const sigCtx = sigCanvas.getContext('2d');

document.addEventListener('DOMContentLoaded', () => {
  init();
  setupSignatureEvents();
  
  document.getElementById('btn-prev').addEventListener('click', () => changePage(-1));
  document.getElementById('btn-next').addEventListener('click', () => changePage(1));
  document.getElementById('btn-clear').addEventListener('click', clearSig);
  document.getElementById('btn-undo').addEventListener('click', undoLast);
  document.getElementById('btn-conclude').addEventListener('click', conclude);
  
  document.querySelectorAll('.color-dot').forEach(dot => {
    dot.addEventListener('click', (e) => {
      penColor = e.target.getAttribute('data-color');
      document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
      e.target.classList.add('active');
    });
  });
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
    const res = await fetch(`${API_BASE}/documento/${docGuid}`);
    if (res.status === 404) throw new Error('Documento não encontrado (404).');
    if (!res.ok) throw new Error(`Erro ao buscar documento (${res.status}).`);

    const data = await res.json();
    const b64 = data.base64 ?? data.document ?? data.file ?? data.content;
    if (!b64) throw new Error('Resposta da API não contém o documento em base64.');

    document.getElementById('doc-name').textContent = data.filename ?? `Documento ${docGuid}`;

    const binary = atob(b64);
    originalBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      originalBytes[i] = binary.charCodeAt(i);
    }

    await loadPdfViewer();
    showState('state-doc');
  } catch (e) {
    document.getElementById('error-msg').textContent = e.message;
    showState('state-error');
  }
}

async function loadPdfViewer() {
  pdfDoc = await pdfjsLib.getDocument({ data: originalBytes }).promise;
  pageCount = pdfDoc.numPages;
  currentPage = 1;

  if (pageCount > 1) {
    document.getElementById('page-nav').style.display = 'flex';
  }

  await renderPage(currentPage);
}

async function renderPage(num) {
  const page = await pdfDoc.getPage(num);
  
  const viewport = page.getViewport({ scale: 1.5 });

  pdfCanvas.width = viewport.width;
  pdfCanvas.height = viewport.height;
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
function setupSignatureEvents() {
  sigCanvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    drawing = true;
    currentStroke = [getCoordinates(e)];
  });

  sigCanvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    e.preventDefault();
    currentStroke.push(getCoordinates(e));
    redraw();
  });

  const stopDrawing = () => {
    if (!drawing) return;
    drawing = false;
    if (currentStroke.length > 1) {
      const sizeValue = +document.getElementById('pen-size').value;
      pageSignatures[currentPage].push({
        pts: [...currentStroke],
        color: penColor,
        size: sizeValue
      });
    }
    currentStroke = [];
    redraw();
  };

  sigCanvas.addEventListener('pointerup', stopDrawing);
  sigCanvas.addEventListener('pointerleave', stopDrawing);
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
      color: penColor,
      size: +document.getElementById('pen-size').value
    });
  }

  for (const stroke of activeStrokes) {
    if (stroke.pts.length < 2) continue;
    sigCtx.beginPath();
    sigCtx.strokeStyle = stroke.color;
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
  }
}

function clearSig() {
  pageSignatures[currentPage] = [];
  redraw();
}


function hexToRgb(hex) {
  const match = hex.replace(/^#/, '').match(/.{2}/g);
  return {
    r: parseInt(match[0], 16) / 255,
    g: parseInt(match[1], 16) / 255,
    b: parseInt(match[2], 16) / 255
  };
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
        const rgb = hexToRgb(stroke.color);
        
        for (let i = 0; i < stroke.pts.length - 1; i++) {
          const p1 = stroke.pts[i];
          const p2 = stroke.pts[i + 1];


          targetPage.drawLine({
            start: { x: p1.x * scaleX, y: height - (p1.y * scaleY) },
            end: { x: p2.x * scaleX, y: height - (p2.y * scaleY) },
            thickness: stroke.size * scaleX, 
            color: PDFLib.rgb(rgb.r, rgb.g, rgb.b),
            opacity: 1,
            lineCap: PDFLib.LineCapStyle.Round
          });
        }
      }
    }

    const modifiedPdfBase64 = await pdfDocLib.saveAsBase64();

    const res = await fetch(`${API_BASE}/documento/${docGuid}/assinar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        signedBase64: modifiedPdfBase64
      })
    });

    if (!res.ok) throw new Error(`Falha ao enviar (${res.status}).`);

    showState('state-done');
  } catch (e) {
    toast(e.message);
    btn.disabled = false;
    spinner.style.display = 'none';
    label.textContent = 'Concluir';
  }
}