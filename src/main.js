import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { pipeline, env } from '@huggingface/transformers';
import './style.css';

env.allowLocalModels = false;
env.useBrowserCache = true;

const app = document.querySelector('#app');
app.innerHTML = `
  <header class="topbar"><a class="brand" href="#" aria-label="Transcreve AI início"><span class="brand-mark">✳</span><span>transcreve<span class="brand-light">AI</span></span></a><span class="privacy"><i></i> Processamento no seu computador</span></header>
  <main>
    <section class="intro"><div class="eyebrow"><span class="eyebrow-line"></span> FERRAMENTA GRATUITA · SEM CADASTRO</div><h1>Do vídeo para o texto.<br><em>Sem complicação.</em></h1><p class="lead">Escolha um vídeo e deixe o Transcreve AI cuidar do resto.<br>O arquivo fica no seu computador.</p></section>
    <section class="workspace" aria-label="Transcrever vídeo">
      <div class="step-label"><span class="step-number">1</span><span>Escolha seu vídeo</span><span class="step-note">MP4, MOV, WebM e outros</span></div>
      <label id="dropzone" class="dropzone" for="video-file" tabindex="0">
        <input id="video-file" type="file" accept="video/*,audio/*" hidden />
        <span class="upload-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14"/></svg></span>
        <strong id="file-title">Arraste o vídeo para cá</strong><span id="file-subtitle">ou <u>selecione no computador</u></span>
      </label>
      <div id="file-meta" class="file-meta" hidden></div>
      <div class="options"><label for="language">Idioma do vídeo</label><select id="language"><option value="portuguese">Português</option><option value="english">Inglês</option><option value="spanish">Espanhol</option><option value="french">Francês</option><option value="auto">Detetar automaticamente</option></select></div>
      <div class="options"><label for="quality">Qualidade da transcrição</label><select id="quality"><option value="tiny">Mais rápida (recomendada para computadores simples)</option><option value="base">Mais qualidade (download e processamento maiores)</option></select></div>
      <button id="start" class="primary" disabled><span>Transcrever vídeo</span><span aria-hidden="true">→</span></button>
      <div id="progress-wrap" class="progress-wrap" hidden><div class="progress-head"><span id="progress-label">A preparar o vídeo…</span><span class="progress-meta"><span id="progress-percent"></span><span>Decorrido</span><span id="progress-time" class="progress-time" aria-live="off">00:00</span></span></div><div class="track"><div id="progress-bar"></div></div><p id="progress-detail" class="progress-detail">Isso pode levar alguns minutos. Mantenha esta página aberta.</p></div>
      <div class="privacy-note"><span class="lock">▣</span><span>O vídeo é processado localmente. Não é enviado para a internet.<br><small>Na primeira utilização, será baixado um modelo de reconhecimento de voz.</small></span></div>
    </section>
    <section id="result" class="result" hidden><div class="result-heading"><div><div class="step-label result-label"><span class="step-number done">✓</span><span>Transcrição pronta</span></div><h2 id="result-name">O seu texto</h2></div><div class="result-actions"><button id="copy" class="secondary">Copiar texto</button><button id="download" class="secondary">Baixar .txt</button></div></div><textarea id="transcript" spellcheck="true" aria-label="Transcrição do vídeo"></textarea><p class="edit-hint">Você pode revisar e corrigir o texto antes de copiar ou baixar. Trechos entre colchetes indicam repetições detectadas; confira no áudio.</p></section>
    <section id="error" class="error" hidden></section>
    <section class="how"><div class="how-title">É simples assim</div><div class="how-grid"><article><span>01</span><h3>Escolha</h3><p>Selecione um vídeo salvo no computador.</p></article><article><span>02</span><h3>Aguarde</h3><p>O navegador reconhece a fala sem enviar o arquivo.</p></article><article><span>03</span><h3>Use o texto</h3><p>Copie ou baixe a transcrição para estudar.</p></article></div></section>
    <footer>Feito para aprender, no seu ritmo. <span>Transcreve AI</span></footer>
  </main>`;

const input = document.querySelector('#video-file');
const drop = document.querySelector('#dropzone');
const start = document.querySelector('#start');
const fileMeta = document.querySelector('#file-meta');
const progressWrap = document.querySelector('#progress-wrap');
const resultSection = document.querySelector('#result');
const errorSection = document.querySelector('#error');
let selectedFile = null;
let ffmpeg;
const recognizers = new Map();
let busy = false;
let elapsedTimer;

function formatSize(bytes) { return bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`; }
function formatTime(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
function readMediaDuration(file) {
  return new Promise(resolve => {
    const media = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio');
    const url = URL.createObjectURL(file);
    const finish = duration => { URL.revokeObjectURL(url); resolve(Number.isFinite(duration) ? duration : null); };
    media.preload = 'metadata';
    media.onloadedmetadata = () => finish(media.duration);
    media.onerror = () => finish(null);
    media.src = url;
  });
}
function estimateDetail(duration) {
  if (!duration) return 'O tempo varia conforme a duração do arquivo e a velocidade do computador. Mantenha esta página aberta.';
  return `Estimativa aproximada: de ${formatTime(duration)} a ${formatTime(duration * 3)}. Pode variar conforme o computador. Na primeira utilização, o download do modelo pode levar alguns minutos extras.`;
}
function chooseFile(file) {
  if (!file) return;
  if (!file.type.startsWith('video/') && !file.type.startsWith('audio/')) return showError('Escolha um arquivo de vídeo ou áudio.');
  selectedFile = file;
  errorSection.hidden = true;
  resultSection.hidden = true;
  document.querySelector('#file-title').textContent = file.name;
  document.querySelector('#file-subtitle').textContent = 'Arquivo selecionado';
  fileMeta.textContent = `${file.type.startsWith('video/') ? 'Vídeo' : 'Áudio'} · ${formatSize(file.size)}`;
  fileMeta.hidden = false;
  start.disabled = false;
}
input.addEventListener('change', e => chooseFile(e.target.files[0]));
for (const event of ['dragenter','dragover']) drop.addEventListener(event, e => { e.preventDefault(); drop.classList.add('dragging'); });
for (const event of ['dragleave','drop']) drop.addEventListener(event, e => { e.preventDefault(); drop.classList.remove('dragging'); });
drop.addEventListener('drop', e => chooseFile(e.dataTransfer.files[0]));
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });

function progress(label, pct, detail='') {
  document.querySelector('#progress-label').textContent = label;
  document.querySelector('#progress-percent').textContent = pct == null ? '' : `${Math.round(pct)}%`;
  document.querySelector('#progress-bar').style.width = pct == null ? '30%' : `${pct}%`;
  document.querySelector('.track').classList.toggle('indeterminate', pct == null);
  if (detail) document.querySelector('#progress-detail').textContent = detail;
}
function formatElapsed(seconds) { return `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`; }
function showError(message) { errorSection.innerHTML = `<strong>Não foi possível continuar</strong><span>${message}</span>`; errorSection.hidden = false; }
async function getFFmpeg() {
  if (ffmpeg) return ffmpeg;
  ffmpeg = new FFmpeg();
  ffmpeg.on('progress', ({ progress: p }) => progress('A extrair o áudio…', Math.min(38, 8 + p * 30)));
  // Vite deployments must load the ESM build of the FFmpeg core.
  const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
  await ffmpeg.load({ coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'), wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm') });
  return ffmpeg;
}
async function getRecognizer(estimate, modelSize) {
  const modelId = `onnx-community/whisper-${modelSize}`;
  if (recognizers.has(modelId)) return recognizers.get(modelId);
  const progressCallback = p => {
    if (p.status === 'progress' && p.total) {
      progress('A descarregar o modelo de voz…', 42 + (p.progress / 100) * 32, `${estimate} Este download pode ser reutilizado pelo navegador.`);
    }
  };
  let canTryWebGPU = false;
  try { canTryWebGPU = Boolean(navigator.gpu && await navigator.gpu.requestAdapter()); } catch { /* Use CPU when adapter detection is blocked. */ }
  if (canTryWebGPU) {
    progress('A preparar a aceleração gráfica…', 43, `${estimate} Vou tentar usar a GPU do computador; se não funcionar neste navegador, o processamento continua no modo compatível.`);
    try {
      const recognizer = await pipeline('automatic-speech-recognition', modelId, {
        device: 'webgpu',
        dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' },
        progress_callback: progressCallback
      });
      recognizers.set(modelId, recognizer);
      progress('Modelo pronto com aceleração gráfica…', 74, estimate);
    } catch (error) {
      console.warn('WebGPU indisponível para este dispositivo; usando o modo compatível.', error);
      recognizers.delete(modelId);
      progress('A carregar o modelo compatível…', 45, `${estimate} A aceleração gráfica não funcionou neste aparelho. O modo compatível vai continuar o processamento.`);
    }
  }
  if (!recognizers.has(modelId)) {
    if (!canTryWebGPU) progress('A carregar o modelo de voz…', 45, `${estimate} O modelo será baixado apenas na primeira utilização.`);
    const recognizer = await pipeline('automatic-speech-recognition', modelId, {
      dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
      progress_callback: progressCallback
    });
    recognizers.set(modelId, recognizer);
  }
  return recognizers.get(modelId);
}
function removeObviousLoops(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const output = [];
  const marker = '[trecho repetido pelo reconhecimento; confira o áudio]';
  const normalize = value => value.toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]/gu, '');
  for (let i = 0; i < words.length;) {
    const current = words[i];
    const normalized = normalize(current);
    if (/(.{1,3})\1{5,}/u.test(normalized)) {
      output.push(marker);
      i++;
      continue;
    }
    let repeatedLength = 0;
    let repeatedCount = 0;
    for (let size = 1; size <= 5; size++) {
      const phrase = words.slice(i, i + size);
      if (phrase.length !== size) continue;
      let count = 1;
      while (count < 20) {
        const start = i + count * size;
        const next = words.slice(start, start + size);
        if (next.length !== size || next.some((word, index) => normalize(word) !== normalize(phrase[index]))) break;
        count++;
      }
      if (count >= 5 && size > repeatedLength) { repeatedLength = size; repeatedCount = count; }
    }
    if (repeatedLength) {
      output.push(words.slice(i, i + repeatedLength).join(' '), marker);
      i += repeatedLength * repeatedCount;
      continue;
    }
    output.push(current);
    i++;
  }
  return output.join(' ').replace(/\s+([,.!?;:])/g, '$1').replace(/\s{2,}/g, ' ');
}
function cleanText(result) {
  const text = Array.isArray(result.chunks) ? result.chunks.map(c => c.text.trim()).join(' ') : result.text;
  return removeObviousLoops(text || '');
}

start.addEventListener('click', async () => {
  if (!selectedFile || busy) return;
  busy = true;
  start.disabled = true;
  errorSection.hidden = true;
  progressWrap.hidden = false;
  progressWrap.scrollIntoView({behavior:'smooth', block:'nearest'});
  const startedAt = Date.now();
  document.querySelector('#progress-time').textContent = '00:00';
  clearInterval(elapsedTimer);
  elapsedTimer = setInterval(() => {
    document.querySelector('#progress-time').textContent = formatElapsed(Math.floor((Date.now() - startedAt) / 1000));
  }, 1000);
  try {
    const duration = await readMediaDuration(selectedFile);
    const detail = estimateDetail(duration);
    progress('A preparar o áudio…', 8);
    document.querySelector('#progress-detail').textContent = detail;
    let audioUrl;
    if (selectedFile.type.startsWith('audio/')) {
      // Audio files can be passed directly to Transformers.js; FFmpeg is only
      // needed to extract the soundtrack from video files.
      audioUrl = URL.createObjectURL(selectedFile);
    } else {
      const ff = await getFFmpeg();
      const ext = (selectedFile.name.split('.').pop() || 'mp4').replace(/[^a-z0-9]/gi,'').slice(0,8) || 'mp4';
      const source = `source.${ext}`;
      await ff.writeFile(source, await fetchFile(selectedFile));
      await ff.exec(['-i', source, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', 'audio.wav']);
      const data = await ff.readFile('audio.wav');
      const wav = new Blob([data.buffer], {type:'audio/wav'});
      audioUrl = URL.createObjectURL(wav);
    }
    const modelSize = document.querySelector('#quality').value;
    const modelDetail = modelSize === 'base' ? `${detail} O modelo de maior qualidade pode levar mais tempo e exige um download maior.` : detail;
    const rec = await getRecognizer(modelDetail, modelSize);
    progress('A reconhecer a fala…', null, `${detail} O indicador animado mostra que o navegador continua trabalhando. Mantenha esta página aberta.`);
    const language = document.querySelector('#language').value;
    const output = await rec(audioUrl, {
      chunk_length_s: 30, stride_length_s: 5,
      ...(language !== 'auto' ? { language } : {}),
      task: 'transcribe',
      return_timestamps: true,
      repetition_penalty: 1.08
    });
    URL.revokeObjectURL(audioUrl);
    const text = cleanText(output).trim();
    if (!text) throw new Error('Não foi encontrada fala clara neste arquivo. Tente outro vídeo ou confirme se ele tem áudio.');
    document.querySelector('#transcript').value = text;
    document.querySelector('#result-name').textContent = selectedFile.name;
    resultSection.hidden = false;
    progressWrap.hidden = true;
    resultSection.scrollIntoView({behavior:'smooth', block:'start'});
  } catch (error) {
    console.error(error);
    showError(error.message?.includes('memory') ? 'Este vídeo é grande para a memória disponível no navegador. Tente um vídeo mais curto ou reduza o tamanho do arquivo.' : (error.message || 'Verifique sua conexão com a internet e tente novamente.'));
    progressWrap.hidden = true;
  } finally {
    clearInterval(elapsedTimer);
    busy = false;
    start.disabled = !selectedFile;
  }
});
document.querySelector('#copy').addEventListener('click', async () => {
  const btn = document.querySelector('#copy');
  await navigator.clipboard.writeText(document.querySelector('#transcript').value);
  btn.textContent = 'Copiado!';
  setTimeout(() => btn.textContent = 'Copiar texto', 1800);
});
document.querySelector('#download').addEventListener('click', () => {
  const blob = new Blob([document.querySelector('#transcript').value], {type:'text/plain;charset=utf-8'});
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${(selectedFile?.name || 'transcricao').replace(/\.[^.]+$/, '')}.txt`;
  link.click(); URL.revokeObjectURL(link.href);
});
