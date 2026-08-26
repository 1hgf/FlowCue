(() => {
  'use strict';

  const API_URL = 'https://api.siliconflow.cn/v1/audio/transcriptions';
  const MODEL = 'XingChenAGI/XingChenASR-V3.2-Ultra';
  const STORAGE_KEY = 'flowcue:state:v1';
  const SCRIPTS_KEY = 'flowcue:scripts:v1';
  const LOCAL_KEY = 'flowcue:api-key';
  const SESSION_KEY = 'flowcue:session-api-key';

  const SAMPLE_SCRIPT = `让表达，自然发生。

大家好，欢迎来到今天的分享。

很多时候，我们不是没有准备好内容，而是在面对镜头和观众时，既要记住下一句话，又要保持眼神和节奏。于是，原本自然的表达，变成了追赶文字。

FlowCue 想做的事情很简单：让讲稿跟着人走。

在匀速模式下，它会按照你选择的字数速度稳定推进。你可以随时上下滑动，新的位置会自动成为当前进度。

在 AI 跟读模式下，浏览器会把短音频片段发送给硅基流动的语音识别模型。识别结果只会在当前位置之后的一小段讲稿里进行模糊匹配，因此，即使你临场换了几个词，它也能继续跟上，同时减少跳到重复段落的概率。

现在，把注意力放回观众，放回你的语气，也放回你真正想说的内容。

准备好了，我们就开始。`;

  const defaults = {
    title: '第一次使用 FlowCue',
    script: SAMPLE_SCRIPT,
    mode: 'auto',
    speed: 240,
    progress: 0,
    settings: {
      lookahead: 260,
      fuzzy: 72,
      chunkSeconds: 5,
      lineSpacing: 1.55,
      microphoneId: '',
      rememberKey: false,
    },
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const genId = () => `sc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const elements = {
    modeButtons: $$('.mode-btn'),
    autoOptions: $('#autoOptions'),
    aiOptions: $('#aiOptions'),
    speedRange: $('#speedRange'),
    speedValue: $('#speedValue'),
    scriptTitle: $('#scriptTitle'),
    scriptPreview: $('#scriptPreview'),
    scriptCount: $('#scriptCount'),
    playButton: $('#playButton'),
    playLabel: $('#playLabel'),
    resetButton: $('#resetButton'),
    fullscreenButton: $('#fullscreenButton'),
    scriptView: $('#scriptView'),
    scriptSelect: $('#scriptSelect'),
    newScriptButton: $('#newScriptButton'),
    deleteScriptButton: $('#deleteScriptButton'),
    progressFill: $('#progressFill'),
    progressLabel: $('#progressLabel'),
    positionLabel: $('#positionLabel'),
    statusDot: $('#statusDot'),
    statusText: $('#statusText'),
    transcriptPill: $('#transcriptPill'),
    transcriptText: $('#transcriptText'),
    confidenceText: $('#confidenceText'),
    aiOrb: $('#aiOrb'),
    aiStateTitle: $('#aiStateTitle'),
    aiStateDetail: $('#aiStateDetail'),
    scriptDialog: $('#scriptDialog'),
    scriptForm: $('#scriptForm'),
    titleInput: $('#titleInput'),
    scriptInput: $('#scriptInput'),
    editorCount: $('#editorCount'),
    settingsDialog: $('#settingsDialog'),
    settingsForm: $('#settingsForm'),
    apiKeyInput: $('#apiKeyInput'),
    rememberKeyInput: $('#rememberKeyInput'),
    revealKeyButton: $('#revealKeyButton'),
    microphoneSelect: $('#microphoneSelect'),
    lookaheadRange: $('#lookaheadRange'),
    lookaheadValue: $('#lookaheadValue'),
    fuzzyRange: $('#fuzzyRange'),
    fuzzyValue: $('#fuzzyValue'),
    chunkRange: $('#chunkRange'),
    chunkValue: $('#chunkValue'),
    lineSpacingRange: $('#lineSpacingRange'),
    lineSpacingValue: $('#lineSpacingValue'),
    toastStack: $('#toastStack'),
  };

  let state = loadState();
  let scripts = [];
  let apiKey = readApiKey();
  let isRunning = false;
  let animationFrame = 0;
  let lastFrameTime = 0;
  let autoNormalizedPosition = 0;
  let normalizedScript = { text: '', map: [] };
  let spanByIndex = [];
  let allSpans = [];
  let activeSpan = null;
  let activeParagraph = null;
  let previousProgress = -1;
  let manualScrollUntil = 0;
  let suppressScrollUntil = 0;
  let scrollDebounce = 0;
  let saveDebounce = 0;
  let wakeLock = null;
  let mediaStream = null;
  let mediaRecorder = null;
  let segmentTimer = 0;
  let segmentStartedAt = 0;
  let aiRunId = 0;
  let transcriptionQueue = Promise.resolve();

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!stored) return structuredClone(defaults);
      return {
        ...structuredClone(defaults),
        ...stored,
        settings: { ...defaults.settings, ...(stored.settings || {}) },
      };
    } catch {
      return structuredClone(defaults);
    }
  }

  function readApiKey() {
    try {
      const localKey = localStorage.getItem(LOCAL_KEY);
      if (localKey) {
        state.settings.rememberKey = true;
        return localKey;
      }
      return sessionStorage.getItem(SESSION_KEY) || '';
    } catch {
      return '';
    }
  }

  function persistStateSoon() {
    clearTimeout(saveDebounce);
    saveDebounce = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          scriptId: state.scriptId,
          title: state.title,
          script: state.script,
          mode: state.mode,
          speed: state.speed,
          progress: state.progress,
          settings: state.settings,
        }));
      } catch {
        // The app still works if storage is unavailable.
      }
    }, 180);
  }

  function loadScripts() {
    try {
      const raw = JSON.parse(localStorage.getItem(SCRIPTS_KEY) || 'null');
      if (Array.isArray(raw)) {
        return raw
          .filter((s) => s && typeof s === 'object' && typeof s.script === 'string')
          .map((s) => ({ id: s.id || genId(), title: s.title || '未命名讲稿', script: s.script }));
      }
    } catch {
      // fall through to empty
    }
    return [];
  }

  function persistScripts() {
    try {
      localStorage.setItem(SCRIPTS_KEY, JSON.stringify(scripts));
    } catch {
      // The app still works if storage is unavailable.
    }
  }

  function ensureScripts() {
    scripts = loadScripts();
    if (!scripts.length) {
      const legacy = { title: state.title, script: state.script };
      const seed = (legacy.script && legacy.script.trim())
        ? legacy
        : { title: defaults.title, script: SAMPLE_SCRIPT };
      scripts = [{ id: genId(), title: seed.title || defaults.title, script: seed.script || SAMPLE_SCRIPT }];
      persistScripts();
    }
    const activeId = scripts.some((s) => s.id === state.scriptId) ? state.scriptId : scripts[0].id;
    const active = scripts.find((s) => s.id === activeId) || scripts[0];
    state.scriptId = active.id;
    state.title = active.title;
    state.script = active.script;
  }

  function renderScriptSelect() {
    const select = elements.scriptSelect;
    select.replaceChildren();
    scripts.forEach((s) => {
      select.add(new Option(s.title || '未命名讲稿', s.id));
    });
    select.value = scripts.some((s) => s.id === state.scriptId) ? state.scriptId : '';
    elements.deleteScriptButton.disabled = !state.scriptId;
  }

  function switchScript(scriptId) {
    const target = scripts.find((s) => s.id === scriptId);
    if (!target || target.id === state.scriptId) return;
    state.scriptId = target.id;
    state.title = target.title;
    state.script = target.script;
    state.progress = 0;
    persistStateSoon();
    renderScript();
    renderScriptSelect();
    showToast(`已切换到「${target.title || '未命名讲稿'}」。`);
  }

  function createScript() {
    const scriptObj = { id: genId(), title: '未命名讲稿', script: '' };
    scripts.unshift(scriptObj);
    state.scriptId = scriptObj.id;
    state.title = scriptObj.title;
    state.script = scriptObj.script;
    state.progress = 0;
    persistScripts();
    persistStateSoon();
    renderScript();
    renderScriptSelect();
    openScriptEditor();
    showToast('已新建讲稿，填入内容后点击「保存并应用」。');
  }

  function deleteActiveScript() {
    if (!state.scriptId) return;
    const target = scripts.find((s) => s.id === state.scriptId);
    if (!target) return;
    const confirmed = window.confirm(`确定删除讲稿「${target.title || '未命名讲稿'}」吗？此操作无法撤销。`);
    if (!confirmed) return;

    scripts = scripts.filter((s) => s.id !== state.scriptId);
    if (scripts.length) {
      const next = scripts[0];
      state.scriptId = next.id;
      state.title = next.title;
      state.script = next.script;
    } else {
      state.scriptId = '';
      state.title = '未命名讲稿';
      state.script = '';
    }
    state.progress = 0;
    persistScripts();
    persistStateSoon();
    renderScript();
    renderScriptSelect();
    elements.scriptDialog.close();
    showToast(scripts.length ? '讲稿已删除，已切换到下一份。' : '讲稿已删除。', 'success');
  }

  function persistApiKey() {
    try {
      if (state.settings.rememberKey) {
        localStorage.setItem(LOCAL_KEY, apiKey);
        sessionStorage.removeItem(SESSION_KEY);
      } else {
        localStorage.removeItem(LOCAL_KEY);
        if (apiKey) sessionStorage.setItem(SESSION_KEY, apiKey);
        else sessionStorage.removeItem(SESSION_KEY);
      }
    } catch {
      showToast('浏览器拒绝保存 Key，本次页面打开期间仍可使用。', 'error');
    }
  }

  function updateRange(range) {
    const min = Number(range.min);
    const max = Number(range.max);
    const value = Number(range.value);
    const progress = ((value - min) / (max - min)) * 100;
    range.style.setProperty('--range-progress', `${progress}%`);
  }

  function normalizeWithMap(text) {
    let normalized = '';
    const map = [];
    let originalOffset = 0;
    for (const originalChar of Array.from(text)) {
      const clean = originalChar
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[\p{P}\p{S}\s]/gu, '');
      for (const normalizedChar of Array.from(clean)) {
        normalized += normalizedChar;
        map.push(originalOffset);
      }
      originalOffset += originalChar.length;
    }
    return { text: normalized, map };
  }

  function originalToNormalized(originalIndex) {
    const map = normalizedScript.map;
    if (!map.length) return 0;
    let low = 0;
    let high = map.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (map[mid] < originalIndex) low = mid + 1;
      else high = mid;
    }
    return clamp(low, 0, map.length - 1);
  }

  function renderScript() {
    elements.scriptView.replaceChildren();
    spanByIndex = new Array(state.script.length);
    allSpans = [];
    normalizedScript = normalizeWithMap(state.script);

    if (!state.script.trim()) {
      const empty = document.createElement('div');
      empty.className = 'empty-script';
      empty.textContent = '还没有讲稿。点击“编辑讲稿”粘贴你的内容。';
      elements.scriptView.append(empty);
      updateScriptSummary();
      return;
    }

    let globalIndex = 0;
    const lines = state.script.split('\n');
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const paragraph = document.createElement('p');
      paragraph.className = 'script-paragraph';

      if (!lines[lineIndex]) {
        paragraph.append(document.createElement('br'));
      } else {
        for (const char of Array.from(lines[lineIndex])) {
          const span = document.createElement('span');
          span.className = 'script-char';
          span.dataset.index = String(globalIndex);
          span.textContent = char;
          paragraph.append(span);
          spanByIndex[globalIndex] = span;
          allSpans.push(span);
          globalIndex += char.length;
        }
      }

      elements.scriptView.append(paragraph);
      if (lineIndex < lines.length - 1) globalIndex += 1;
    }

    previousProgress = -1;
    state.progress = clamp(Number(state.progress) || 0, 0, Math.max(0, state.script.length - 1));
    setProgress(state.progress, { scroll: false, persist: false });
    requestAnimationFrame(() => scrollToProgress(state.progress, 'auto'));
    updateScriptSummary();
  }

  function updateScriptSummary() {
    const readableCount = normalizedScript.text.length;
    elements.scriptTitle.textContent = state.title || '未命名讲稿';
    elements.scriptPreview.textContent = state.script.replace(/\s+/g, ' ').trim().slice(0, 48) || '点击编辑讲稿';
    elements.scriptCount.textContent = `${readableCount} 字`;
  }

  function nearestSpan(index) {
    if (spanByIndex[index]) return spanByIndex[index];
    for (let distance = 1; distance < Math.min(10, spanByIndex.length); distance += 1) {
      if (spanByIndex[index + distance]) return spanByIndex[index + distance];
      if (spanByIndex[index - distance]) return spanByIndex[index - distance];
    }
    return allSpans[0] || null;
  }

  function setProgress(index, options = {}) {
    if (!state.script.length) return;
    const next = clamp(Math.round(index), 0, Math.max(0, state.script.length - 1));
    const previous = previousProgress;

    if (previous < 0) {
      for (const span of allSpans) {
        const spanIndex = Number(span.dataset.index);
        span.classList.toggle('spoken', spanIndex < next);
      }
    } else if (next > previous) {
      for (let i = previous; i < next; i += 1) spanByIndex[i]?.classList.add('spoken');
    } else if (next < previous) {
      for (let i = next; i <= previous; i += 1) spanByIndex[i]?.classList.remove('spoken');
    }

    activeSpan?.classList.remove('current');
    activeParagraph?.classList.remove('current-paragraph');
    activeSpan = nearestSpan(next);
    activeSpan?.classList.add('current');
    activeParagraph = activeSpan?.closest('.script-paragraph') || null;
    activeParagraph?.classList.add('current-paragraph');

    state.progress = next;
    previousProgress = next;
    autoNormalizedPosition = originalToNormalized(next);

    const percent = state.script.length > 1 ? (next / (state.script.length - 1)) * 100 : 0;
    elements.progressFill.style.width = `${percent.toFixed(2)}%`;
    elements.progressLabel.textContent = `${Math.round(percent)}%`;
    elements.positionLabel.textContent = `第 ${next + 1} / ${state.script.length} 字`;

    if (options.scroll) scrollToProgress(next, options.behavior || 'smooth');
    if (options.persist !== false) persistStateSoon();
  }

  function scrollToProgress(index, behavior = 'smooth') {
    const target = nearestSpan(index);
    if (!target) return;
    const viewRect = elements.scriptView.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const guideY = viewRect.top + viewRect.height * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--guide-y')) / 100 || 0.42);
    const desired = elements.scriptView.scrollTop + targetRect.top - guideY;
    suppressScrollUntil = performance.now() + (behavior === 'smooth' ? 780 : 100);
    elements.scriptView.scrollTo({ top: Math.max(0, desired), behavior });
  }

  function syncProgressFromScroll() {
    if (!allSpans.length) return;
    const rect = elements.scriptView.getBoundingClientRect();
    const guideY = rect.top + rect.height * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--guide-y')) / 100 || 0.42);
    let low = 0;
    let high = allSpans.length - 1;
    let best = 0;

    while (low <= high) {
      const mid = (low + high) >> 1;
      if (allSpans[mid].getBoundingClientRect().top <= guideY) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const lineTop = allSpans[best].getBoundingClientRect().top;
    while (best > 0 && Math.abs(allSpans[best - 1].getBoundingClientRect().top - lineTop) < 2) best -= 1;
    setProgress(Number(allSpans[best].dataset.index), { scroll: false });
  }

  function setMode(mode) {
    if (!['auto', 'ai'].includes(mode)) return;
    if (isRunning) stopRunning('模式已切换');
    state.mode = mode;
    elements.modeButtons.forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', String(active));
    });
    elements.autoOptions.classList.toggle('hidden', mode !== 'auto');
    elements.aiOptions.classList.toggle('hidden', mode !== 'ai');
    elements.playLabel.textContent = mode === 'ai' ? '开始跟读' : '开始提词';
    setStatus(mode === 'ai' ? 'AI 跟读待命' : '匀速模式待命');
    persistStateSoon();
  }

  function setStatus(text, type = 'ready') {
    elements.statusText.textContent = text;
    elements.statusDot.classList.toggle('running', type === 'running');
    elements.statusDot.classList.toggle('error', type === 'error');
  }

  function updateRunningUi(running) {
    elements.playButton.classList.toggle('running', running);
    elements.playButton.querySelector('.play-symbol').textContent = running ? 'Ⅱ' : '▶';
    elements.playLabel.textContent = running
      ? (state.mode === 'ai' ? '停止跟读' : '暂停提词')
      : (state.mode === 'ai' ? '开始跟读' : '开始提词');
    elements.aiOrb.classList.toggle('listening', running && state.mode === 'ai');
  }

  async function toggleRunning() {
    if (isRunning) {
      stopRunning('已暂停');
      return;
    }
    if (!state.script.trim()) {
      showToast('请先添加讲稿。', 'error');
      openScriptEditor();
      return;
    }
    if (state.mode === 'ai') await startAiFollowing();
    else startAutoScroll();
  }

  function startAutoScroll() {
    isRunning = true;
    autoNormalizedPosition = originalToNormalized(state.progress);
    lastFrameTime = performance.now();
    updateRunningUi(true);
    setStatus(`匀速滚动 · ${state.speed} 字/分钟`, 'running');
    requestWakeLock();
    animationFrame = requestAnimationFrame(autoTick);
  }

  function autoTick(now) {
    if (!isRunning || state.mode !== 'auto') return;
    const elapsed = Math.min(100, now - lastFrameTime);
    lastFrameTime = now;
    autoNormalizedPosition += (elapsed * state.speed) / 60000;

    if (autoNormalizedPosition >= normalizedScript.map.length - 1) {
      const finalIndex = Math.max(0, state.script.length - 1);
      setProgress(finalIndex, { scroll: true, behavior: 'smooth' });
      stopRunning('已到讲稿末尾');
      showToast('讲稿播放完成。');
      return;
    }

    const target = normalizedScript.map[Math.floor(autoNormalizedPosition)] ?? state.progress;
    if (target !== state.progress) setProgress(target, { scroll: true, behavior: 'auto' });
    animationFrame = requestAnimationFrame(autoTick);
  }

  async function startAiFollowing() {
    if (!apiKey.trim()) {
      showToast('请先填写硅基流动 API Key。', 'error');
      openSettings();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      showToast('当前浏览器不支持录音，请使用最新版 Chrome、Edge 或 Safari。', 'error');
      return;
    }
    if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      showToast('麦克风需要 HTTPS。请通过 GitHub Pages 的 HTTPS 地址打开。', 'error');
      return;
    }

    try {
      const audio = state.settings.microphoneId
        ? { deviceId: { exact: state.settings.microphoneId }, echoCancellation: true, noiseSuppression: true }
        : { echoCancellation: true, noiseSuppression: true };
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio });
      await refreshMicrophones();
      isRunning = true;
      aiRunId += 1;
      updateRunningUi(true);
      setStatus('AI 正在聆听', 'running');
      elements.transcriptPill.classList.remove('hidden');
      elements.transcriptText.textContent = '正在聆听…';
      elements.confidenceText.textContent = '';
      elements.aiStateTitle.textContent = '正在跟读';
      elements.aiStateDetail.textContent = `每 ${state.settings.chunkSeconds} 秒校准一次进度`;
      requestWakeLock();
      startRecordingSegment(aiRunId);
    } catch (error) {
      const message = error?.name === 'NotAllowedError'
        ? '麦克风权限被拒绝，请在浏览器地址栏中允许麦克风。'
        : error?.name === 'OverconstrainedError'
          ? '找不到已选择的麦克风，请重新选择设备。'
          : '无法启动麦克风，请检查设备占用和浏览器权限。';
      setStatus('麦克风不可用', 'error');
      showToast(message, 'error');
      stopMediaTracks();
    }
  }

  function supportedMimeType() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4;codecs=mp4a.40.2',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  function startRecordingSegment(runId) {
    if (!isRunning || state.mode !== 'ai' || runId !== aiRunId || !mediaStream) return;
    const chunks = [];
    const mimeType = supportedMimeType();

    try {
      mediaRecorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);
    } catch {
      setStatus('录音格式不受支持', 'error');
      showToast('无法创建兼容的录音格式，请尝试更换浏览器。', 'error');
      stopRunning('已停止');
      return;
    }

    segmentStartedAt = performance.now();
    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size) chunks.push(event.data);
    });
    mediaRecorder.addEventListener('error', () => {
      if (runId !== aiRunId) return;
      showToast('录音出现异常，AI 跟读已停止。', 'error');
      stopRunning('录音异常');
    });
    mediaRecorder.addEventListener('stop', () => {
      clearTimeout(segmentTimer);
      const duration = performance.now() - segmentStartedAt;
      const stillActive = isRunning && state.mode === 'ai' && runId === aiRunId;
      if (stillActive) window.setTimeout(() => startRecordingSegment(runId), 35);

      if (stillActive && duration > 900 && chunks.length) {
        const blob = new Blob(chunks, { type: mediaRecorder?.mimeType || mimeType || 'audio/webm' });
        queueTranscription(blob, runId);
      }
    }, { once: true });

    mediaRecorder.start();
    segmentTimer = window.setTimeout(() => {
      if (mediaRecorder?.state === 'recording' && runId === aiRunId) mediaRecorder.stop();
    }, state.settings.chunkSeconds * 1000);
  }

  function queueTranscription(blob, runId) {
    transcriptionQueue = transcriptionQueue
      .then(() => transcribeAndAdvance(blob, runId))
      .catch((error) => {
        if (runId === aiRunId) handleTranscriptionError(error);
      });
  }

  async function transcribeAndAdvance(blob, runId) {
    if (runId !== aiRunId) return;
    elements.aiStateTitle.textContent = '正在识别';
    elements.aiStateDetail.textContent = '麦克风仍在持续录音';
    elements.transcriptText.textContent = '正在识别刚才的内容…';
    elements.confidenceText.textContent = '';

    const extension = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    const formData = new FormData();
    formData.append('file', blob, `flowcue-segment.${extension}`);
    formData.append('model', MODEL);

    let response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
        body: formData,
      });
    } catch (error) {
      const networkError = new Error('NETWORK');
      networkError.cause = error;
      throw networkError;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const error = new Error(`HTTP_${response.status}`);
      error.detail = body;
      throw error;
    }

    const result = await response.json();
    if (runId !== aiRunId) return;
    const transcript = String(result?.text || '').trim();

    if (!transcript) {
      elements.transcriptText.textContent = '没有听到清晰语音';
      elements.aiStateTitle.textContent = '继续聆听';
      elements.aiStateDetail.textContent = '未改变当前进度';
      return;
    }

    const match = findForwardMatch(transcript);
    elements.transcriptText.textContent = transcript;

    if (match.accepted) {
      elements.confidenceText.textContent = `${Math.round(match.confidence * 100)}% 匹配`;
      elements.aiStateTitle.textContent = '已同步';
      elements.aiStateDetail.textContent = `向前推进 ${Math.max(0, match.targetOriginal - state.progress)} 字`;
      if (match.targetOriginal > state.progress) {
        setProgress(match.targetOriginal, { scroll: true, behavior: 'smooth' });
      }
    } else {
      elements.confidenceText.textContent = match.confidence ? `${Math.round(match.confidence * 100)}%` : '';
      elements.aiStateTitle.textContent = '继续聆听';
      elements.aiStateDetail.textContent = match.reason;
    }
  }

  function findForwardMatch(transcript) {
    const query = normalizeWithMap(transcript).text.slice(-120);
    if (query.length < 4) {
      return { accepted: false, confidence: 0, reason: '语音太短，等待下一段' };
    }
    if (!normalizedScript.text.length) {
      return { accepted: false, confidence: 0, reason: '讲稿为空' };
    }

    const currentNormalized = originalToNormalized(state.progress);
    const windowEnd = Math.min(normalizedScript.text.length, currentNormalized + state.settings.lookahead);
    const windowText = normalizedScript.text.slice(currentNormalized, windowEnd);
    const alignment = localAlign(query, windowText);
    const startDistance = alignment.start;
    const continuityLimit = Math.max(80, query.length * 5);
    const threshold = state.settings.fuzzy / 100;
    const tooFarWithoutCertainty = startDistance > continuityLimit && alignment.confidence < 0.92;
    const targetNormalized = clamp(currentNormalized + alignment.end, currentNormalized, normalizedScript.map.length - 1);
    const targetOriginal = normalizedScript.map[targetNormalized] ?? state.progress;
    const accepted = alignment.coverage >= 0.55
      && alignment.queryUsed >= Math.min(4, query.length)
      && alignment.confidence >= threshold
      && !tooFarWithoutCertainty
      && targetOriginal >= state.progress;

    return {
      accepted,
      confidence: alignment.confidence,
      targetOriginal,
      reason: tooFarWithoutCertainty ? '候选位置过远，已避免跳段' : '未达到匹配阈值',
    };
  }

  function localAlign(query, target) {
    const rows = query.length + 1;
    const cols = target.length + 1;
    let previous = new Float32Array(cols);
    let current = new Float32Array(cols);
    const directions = new Uint8Array(rows * cols);
    let bestScore = 0;
    let bestI = 0;
    let bestJ = 0;

    for (let i = 1; i < rows; i += 1) {
      current.fill(0);
      for (let j = 1; j < cols; j += 1) {
        const isMatch = query[i - 1] === target[j - 1];
        const diagonal = previous[j - 1] + (isMatch ? 3 : -2);
        const up = previous[j] - 1.5;
        const left = current[j - 1] - 1.5;
        let score = 0;
        let direction = 0;

        if (diagonal > score) { score = diagonal; direction = 1; }
        if (up > score) { score = up; direction = 2; }
        if (left > score) { score = left; direction = 3; }
        current[j] = score;
        directions[i * cols + j] = direction;

        if (score > bestScore) {
          bestScore = score;
          bestI = i;
          bestJ = j;
        }
      }
      [previous, current] = [current, previous];
    }

    let i = bestI;
    let j = bestJ;
    let matches = 0;
    let queryUsed = 0;
    let targetUsed = 0;
    const end = Math.max(0, bestJ - 1);

    while (i > 0 && j > 0) {
      const direction = directions[i * cols + j];
      if (!direction) break;
      if (direction === 1) {
        queryUsed += 1;
        targetUsed += 1;
        if (query[i - 1] === target[j - 1]) matches += 1;
        i -= 1;
        j -= 1;
      } else if (direction === 2) {
        queryUsed += 1;
        i -= 1;
      } else {
        targetUsed += 1;
        j -= 1;
      }
    }

    const coverage = query.length ? queryUsed / query.length : 0;
    const precision = matches / Math.max(1, queryUsed, targetUsed);
    const scoreRatio = bestScore / Math.max(1, query.length * 3);
    const confidence = clamp(precision * 0.4 + coverage * 0.35 + scoreRatio * 0.25, 0, 1);
    return { confidence, coverage, queryUsed, start: j, end, matches };
  }

  function handleTranscriptionError(error) {
    const code = error?.message || '';
    let message = '语音识别失败，请稍后重试。';
    if (code === 'NETWORK') message = '无法连接硅基流动 API。请检查网络、浏览器跨域限制或代理设置。';
    else if (code === 'HTTP_401' || code === 'HTTP_403') message = 'API Key 无效或没有该模型的访问权限。';
    else if (code === 'HTTP_429') message = '请求过于频繁或额度受限，请稍后再试。';
    else if (code === 'HTTP_503' || code === 'HTTP_504') message = '识别服务暂时繁忙，稍后会继续尝试。';

    elements.aiStateTitle.textContent = '识别暂时失败';
    elements.aiStateDetail.textContent = '录音仍在继续';
    elements.transcriptText.textContent = message;
    elements.confidenceText.textContent = '';
    showToast(message, 'error');

    if (code === 'HTTP_401' || code === 'HTTP_403') stopRunning('认证失败');
  }

  function stopRunning(status = '已暂停') {
    if (!isRunning && !mediaStream) return;
    isRunning = false;
    cancelAnimationFrame(animationFrame);
    aiRunId += 1;
    clearTimeout(segmentTimer);
    if (mediaRecorder?.state === 'recording') {
      try { mediaRecorder.stop(); } catch { /* no-op */ }
    }
    window.setTimeout(stopMediaTracks, 80);
    updateRunningUi(false);
    setStatus(status);
    elements.aiOrb.classList.remove('listening');
    if (state.mode === 'ai') {
      elements.aiStateTitle.textContent = '已暂停';
      elements.aiStateDetail.textContent = '点击开始继续跟读';
      elements.transcriptPill.classList.add('hidden');
    }
    releaseWakeLock();
  }

  function stopMediaTracks() {
    mediaStream?.getTracks().forEach((track) => track.stop());
    mediaStream = null;
    mediaRecorder = null;
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      // Wake lock is an enhancement, not a requirement.
    }
  }

  async function releaseWakeLock() {
    try { await wakeLock?.release(); } catch { /* no-op */ }
    wakeLock = null;
  }

  async function refreshMicrophones() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const microphones = devices.filter((device) => device.kind === 'audioinput');
      const selected = state.settings.microphoneId;
      elements.microphoneSelect.replaceChildren(new Option('系统默认麦克风', ''));
      microphones.forEach((device, index) => {
        elements.microphoneSelect.add(new Option(device.label || `麦克风 ${index + 1}`, device.deviceId));
      });
      elements.microphoneSelect.value = microphones.some((device) => device.deviceId === selected) ? selected : '';
    } catch {
      // Device enumeration may require permission first.
    }
  }

  function openScriptEditor() {
    if (isRunning) stopRunning('编辑讲稿');
    elements.titleInput.value = state.title;
    elements.scriptInput.value = state.script;
    elements.editorCount.textContent = `${normalizeWithMap(state.script).text.length} 字`;
    elements.scriptDialog.showModal();
    requestAnimationFrame(() => elements.scriptInput.focus());
  }

  function openSettings() {
    if (isRunning && state.mode === 'ai') {
      stopRunning('正在配置 AI');
      showToast('AI 跟读已暂停，保存设置后可继续。');
    }
    elements.apiKeyInput.value = apiKey;
    elements.rememberKeyInput.checked = state.settings.rememberKey;
    elements.lookaheadRange.value = String(state.settings.lookahead);
    elements.fuzzyRange.value = String(state.settings.fuzzy);
    elements.chunkRange.value = String(state.settings.chunkSeconds);
    elements.lineSpacingRange.value = String(state.settings.lineSpacing);
    elements.microphoneSelect.value = state.settings.microphoneId;
    syncSettingsOutputs();
    elements.settingsDialog.showModal();
    refreshMicrophones();
  }

  function saveScript(event) {
    if (event.submitter?.value !== 'default') return;
    event.preventDefault();
    const nextScript = elements.scriptInput.value.trim();
    if (!nextScript) {
      showToast('讲稿正文不能为空。', 'error');
      elements.scriptInput.focus();
      return;
    }
    state.title = elements.titleInput.value.trim() || '未命名讲稿';
    state.script = nextScript;
    state.progress = 0;

    const index = scripts.findIndex((s) => s.id === state.scriptId);
    if (index >= 0) {
      scripts[index].title = state.title;
      scripts[index].script = state.script;
    } else {
      scripts.unshift({ id: genId(), title: state.title, script: state.script });
      state.scriptId = scripts[0].id;
    }
    persistScripts();

    renderScript();
    renderScriptSelect();
    persistStateSoon();
    elements.scriptDialog.close();
    showToast('讲稿已更新，并回到开头。');
  }

  function saveSettings(event) {
    if (event.submitter?.value !== 'default') return;
    event.preventDefault();
    apiKey = elements.apiKeyInput.value.trim();
    state.settings.rememberKey = elements.rememberKeyInput.checked;
    state.settings.lookahead = Number(elements.lookaheadRange.value);
    state.settings.fuzzy = Number(elements.fuzzyRange.value);
    state.settings.chunkSeconds = Number(elements.chunkRange.value);
    state.settings.lineSpacing = Number(elements.lineSpacingRange.value);
    state.settings.microphoneId = elements.microphoneSelect.value;
    persistApiKey();
    persistStateSoon();
    applyLineSpacing();
    requestAnimationFrame(() => scrollToProgress(state.progress, 'auto'));
    elements.settingsDialog.close();
    elements.aiStateDetail.textContent = `每 ${state.settings.chunkSeconds} 秒识别并校准进度`;
    showToast(apiKey ? 'AI 跟读设置已保存。' : '设置已保存；开始跟读前还需填写 API Key。');
  }

  function syncSettingsOutputs() {
    elements.lookaheadValue.textContent = `${elements.lookaheadRange.value} 字`;
    elements.fuzzyValue.textContent = `${elements.fuzzyRange.value}%`;
    elements.chunkValue.textContent = `${elements.chunkRange.value} 秒`;
    elements.lineSpacingValue.textContent = elements.lineSpacingRange.value;
    [elements.lookaheadRange, elements.fuzzyRange, elements.chunkRange, elements.lineSpacingRange].forEach(updateRange);
  }

  function applyLineSpacing() {
    document.documentElement.style.setProperty('--script-line-height', String(state.settings.lineSpacing));
  }

  function resetToStart() {
    if (isRunning) stopRunning('已重置');
    setProgress(0, { scroll: true, behavior: 'smooth' });
    showToast('已回到讲稿开头。');
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      showToast('浏览器未允许进入全屏。', 'error');
    }
  }

  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    elements.toastStack.append(toast);
    window.setTimeout(() => toast.remove(), 3800);
  }

  function closeOnBackdrop(dialog) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }

  function bindEvents() {
    elements.modeButtons.forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
    elements.speedRange.addEventListener('input', () => {
      state.speed = Number(elements.speedRange.value);
      elements.speedValue.textContent = `${state.speed} 字/分钟`;
      updateRange(elements.speedRange);
      if (isRunning && state.mode === 'auto') setStatus(`匀速滚动 · ${state.speed} 字/分钟`, 'running');
      persistStateSoon();
    });
    elements.playButton.addEventListener('click', toggleRunning);
    elements.resetButton.addEventListener('click', resetToStart);
    elements.fullscreenButton.addEventListener('click', toggleFullscreen);
    $('#settingsButton').addEventListener('click', openSettings);
    $('#openAiSettings').addEventListener('click', openSettings);
    $('#mobileSettingsButton').addEventListener('click', openSettings);
    $('#editScriptButton').addEventListener('click', openScriptEditor);
    $('#stageEditButton').addEventListener('click', openScriptEditor);
    elements.newScriptButton.addEventListener('click', createScript);
    elements.scriptSelect.addEventListener('change', () => switchScript(elements.scriptSelect.value));
    elements.deleteScriptButton.addEventListener('click', deleteActiveScript);
    elements.scriptForm.addEventListener('submit', saveScript);
    elements.settingsForm.addEventListener('submit', saveSettings);
    elements.scriptInput.addEventListener('input', () => {
      elements.editorCount.textContent = `${normalizeWithMap(elements.scriptInput.value).text.length} 字`;
    });
    elements.revealKeyButton.addEventListener('click', () => {
      const showing = elements.apiKeyInput.type === 'text';
      elements.apiKeyInput.type = showing ? 'password' : 'text';
      elements.revealKeyButton.textContent = showing ? '显示' : '隐藏';
    });
    [elements.lookaheadRange, elements.fuzzyRange, elements.chunkRange, elements.lineSpacingRange].forEach((range) => {
      range.addEventListener('input', syncSettingsOutputs);
    });
    closeOnBackdrop(elements.scriptDialog);
    closeOnBackdrop(elements.settingsDialog);

    const markManual = () => {
      suppressScrollUntil = 0;
      manualScrollUntil = performance.now() + 1400;
    };
    elements.scriptView.addEventListener('wheel', markManual, { passive: true });
    elements.scriptView.addEventListener('touchstart', markManual, { passive: true });
    elements.scriptView.addEventListener('touchmove', markManual, { passive: true });
    elements.scriptView.addEventListener('pointerdown', markManual, { passive: true });
    elements.scriptView.addEventListener('keydown', (event) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) markManual();
    });
    elements.scriptView.addEventListener('scroll', () => {
      if (performance.now() < suppressScrollUntil || performance.now() > manualScrollUntil) return;
      clearTimeout(scrollDebounce);
      scrollDebounce = window.setTimeout(syncProgressFromScroll, 90);
    }, { passive: true });

    document.addEventListener('keydown', (event) => {
      if (event.target.matches('input, textarea, select, button') || elements.scriptDialog.open || elements.settingsDialog.open) return;
      if (event.code === 'Space') {
        event.preventDefault();
        toggleRunning();
      } else if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        resetToStart();
      }
    });
    document.addEventListener('fullscreenchange', () => {
      elements.fullscreenButton.textContent = document.fullscreenElement ? '×' : '⛶';
      elements.fullscreenButton.title = document.fullscreenElement ? '退出全屏' : '进入全屏';
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && isRunning) requestWakeLock();
    });
    window.addEventListener('beforeunload', () => {
      stopMediaTracks();
      releaseWakeLock();
    });
  }

  function initialize() {
    elements.speedRange.value = String(state.speed);
    elements.speedValue.textContent = `${state.speed} 字/分钟`;
    updateRange(elements.speedRange);
    elements.aiStateDetail.textContent = `每 ${state.settings.chunkSeconds} 秒识别并校准进度`;
    applyLineSpacing();
    ensureScripts();
    renderScript();
    renderScriptSelect();
    bindEvents();
    setMode(state.mode);
    refreshMicrophones();
  }

  initialize();

  // Expose the matcher for lightweight browser-console verification.
  window.FlowCue = Object.freeze({ localAlign });
})();
