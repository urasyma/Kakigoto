const STORAGE_KEY = 'kakigoto_writer_data_v2';
const LEGACY_STORAGE_KEY = 'mythos_writer_data_v2';
const PROJECT_FILE_TYPE = 'kakigoto-writer-project';
const LEGACY_PROJECT_FILE_TYPE = 'mythos-writer-project';
const PROJECT_FILE_VERSION = 1;
const PROJECT_FILE_EXT = 'mwpj';
const PDF_PAGE_MAX_WIDTH = 720;
const PDF_PAGE_A4_HEIGHT_PX = (297 / 25.4) * 96;
const PDF_PAGE_PADDING_TOP = 28;
const PDF_PAGE_PADDING_X = 40;
const PDF_PAGE_PADDING_BOTTOM = 48;
const PDF_CONTENT_WIDTH = PDF_PAGE_MAX_WIDTH - (PDF_PAGE_PADDING_X * 2);
const PDF_CONTENT_HEIGHT = PDF_PAGE_A4_HEIGHT_PX - PDF_PAGE_PADDING_TOP - PDF_PAGE_PADDING_BOTTOM;

let _writerPageGuideTimer = null;
let _pdfGuideMeasureRoot = null;

document.documentElement.style.setProperty('--pdf-content-width', `${PDF_CONTENT_WIDTH}px`);

// プリセットカラーパレット（セリフ・NPC用）
const PALETTE = [
  '#e05c5c','#d4845a','#c9a83c','#6ab04c','#3aaa8c',
  '#3a8fd4','#5a6fd4','#9b59b6','#c0578c','#7f8c8d',
  '#2c3e50','#8e6b3e'
];

const GENERAL_NPC_STATS = [
  { id:'npcStr', label:'体力' },
  { id:'npcCon', label:'持久' },
  { id:'npcPow', label:'意志' },
  { id:'npcDex', label:'機敏' },
  { id:'npcInt', label:'思考' },
  { id:'npcEdu', label:'知識' },
  { id:'npcApp', label:'印象' },
  { id:'npcSiz', label:'存在感' },
];

const WRITING_TEMPLATES = {
  default: {
    blockTypeLabels: { scene: '👁 本文', dialog: '💬 会話', game: '🎲 メモ' },
    emptyTitle: '「ブロック追加」で執筆を始めましょう',
    emptySub: '本文・会話・メモ、または参照挿入からデータを構築できます',
    sceneNames: ['章 1', '章 2', '章 3']
  },
  novel: {
    blockTypeLabels: { scene: '👁 地の文', dialog: '💬 会話', game: '🎲 補助メモ' },
    emptyTitle: '「ブロック追加」で小説執筆を始めましょう',
    emptySub: '地の文・会話・補助メモを組み合わせて章を構成できます',
    sceneNames: ['導入', '展開', '転換', '結末']
  },
  script: {
    blockTypeLabels: { scene: '👁 ト書き', dialog: '💬 セリフ', game: '🎲 演出指示' },
    emptyTitle: '「ブロック追加」で脚本作成を始めましょう',
    emptySub: 'ト書き・セリフ・演出指示でシーン進行を作成できます',
    sceneNames: ['オープニング', 'シーン 1', 'シーン 2', 'エンディング']
  },
  article: {
    blockTypeLabels: { scene: '👁 本文', dialog: '💬 引用', game: '🎲 注記' },
    emptyTitle: '「ブロック追加」で記事執筆を始めましょう',
    emptySub: '本文・引用・注記で読みやすい記事構成を作れます',
    sceneNames: ['導入', '要点整理', '詳細', 'まとめ']
  }
};

let S = {
  projectMode: 'general',
  writingTemplate: 'default',
  writingMode: 'horizontal',
  blockFilterType: 'all',
  blockFilterSpeaker: 'all',
  title: '',
  scenes: [],
  curScene: 0,
  blockType: 'scene',
  npcs: [],
  artifacts: [],
  floors: [],      // [{id,name,type:'indoor'|'outdoor',note}]
  rooms: [],       // [{id,name,num,cat,floorId,desc,clue,kp,x,y}]
  edges: [],       // [{id,aId,bId,type,note,floorId}]
  timeline: [],
  plots: []
};

function createInitialState() {
  return {
    projectMode: 'general',
    writingTemplate: 'default',
    writingMode: 'horizontal',
    blockFilterType: 'all',
    blockFilterSpeaker: 'all',
    title: '',
    scenes: [{ id: uid(), name: 'オープニング', blocks: [] }],
    curScene: 0,
    blockType: 'scene',
    npcs: [],
    artifacts: [],
    floors: [],
    rooms: [],
    edges: [],
    timeline: [],
    plots: []
  };
}

let selRoom = null;  // legacy compat - unused by new engine

// ======= Storage =======
function hasQuickSaveData() {
  try {
    return !!(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY));
  } catch (e) {
    return false;
  }
}

function resetMapState() {
  MAP.curFloor = null;
  MAP.selRoom = null;
  MAP.selEdge = null;
  MAP.mode = 'select';
  MAP.doorType = 'normal';
  MAP.drag = null;
  MAP.connSrc = null;
  MAP.pendingFurnitureName = '';
  MAP.sideTab = 'detail';
}

function finalizeLoadedState() {
  if (!S.scenes || !S.scenes.length) {
    S.scenes = [{ id: uid(), name: 'オープニング', blocks: [] }];
    S.curScene = 0;
  }
  if (!S.floors) S.floors = [];
  if (!S.rooms) S.rooms = [];
  if (!S.edges) S.edges = [];
  if (!S.npcs) S.npcs = [];
  if (!S.artifacts) S.artifacts = [];
  if (!S.timeline) S.timeline = [];
  if (!S.plots) S.plots = [];
  if (!S.projectMode) S.projectMode = 'general';
  if (!S.writingTemplate || !WRITING_TEMPLATES[S.writingTemplate]) S.writingTemplate = 'default';
  if (!['horizontal', 'vertical'].includes(S.writingMode)) S.writingMode = 'horizontal';
  if (!S.blockFilterType) S.blockFilterType = 'all';
  if (!S.blockFilterSpeaker) S.blockFilterSpeaker = 'all';

  // 旧データ互換：roomsにfloorId/cat/x/yがない場合付与
  if (S.rooms && S.rooms.length && S.floors.length === 0) {
    S.floors.push({ id: uid(), name: '1F', type: 'indoor', note: '' });
  }
  if (S.rooms) S.rooms.forEach((r, i) => {
    if (!r.floorId && S.floors.length) r.floorId = S.floors[0].id;
    if (!r.cat) r.cat = 'normal';
    if (r.x === undefined) { r.x = 20 + (i % 4) * 170; r.y = 20 + Math.floor(i / 4) * 90; }
    if (!r.id) r.id = uid();
  });

  ensureDefaultFloor();
  if (S.floors.length) {
    MAP.curFloor = S.floors[0]?.id || null;
  }

  // タイトル復元（初期設定モーダル）
  const titleInput = document.getElementById('scenarioTitle');
  if (titleInput) titleInput.value = S.title || '';
  // プロジェクトモード/エディションUI初期化
  setTimeout(() => { renderProjectModeUI(); renderProjectEditionBtns(); renderWritingTemplateUI(); }, 0);
  renderAll();
  _dirty = false;
  setAutoSaveState('saved');
  startPeriodicAutoSave();
  // マップCanvasイベント初期化（DOMレンダリング後）
  setTimeout(() => { resizeFpCanvas(); initFpEvents(); }, 100);
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) {
      S = JSON.parse(raw);
    } else {
      S = createInitialState();
    }
  } catch(e) {
    S = createInitialState();
  }
  finalizeLoadedState();
}

function startNewWriting(initialSettings = null) {
  S = createInitialState();
  if (initialSettings && typeof initialSettings === 'object') {
    S.title = (initialSettings.title || '').trim();
    S.projectMode = initialSettings.projectMode === 'trpg' ? 'trpg' : 'general';
    S.writingTemplate = WRITING_TEMPLATES[initialSettings.writingTemplate] ? initialSettings.writingTemplate : 'default';
    S.edition = initialSettings.edition === '6th' ? '6th' : '7th';
  }
  resetMapState();
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch (e) {}
  finalizeLoadedState();
  toast('🆕 新規執筆を開始しました');
}

let _startupChoiceFromEditor = false;
let _initialSettingsForNew = false;
let _initialEditionDraft = '7th';

function writingTemplateLabel(tpl) {
  return { default:'汎用', novel:'小説', script:'脚本', article:'記事' }[tpl] || '汎用';
}

function projectModeLabel(mode) {
  return mode === 'trpg' ? 'TRPG' : '汎用';
}

function editionLabel(ed) {
  return ed === '6th' ? '6版' : '7版';
}

function renderScenarioHeaderMeta() {
  const titleEl = document.getElementById('scenarioTitleText');
  const modeChip = document.getElementById('projectModeChip');
  const tplChip = document.getElementById('writingTemplateChip');
  const edChip = document.getElementById('projectEditionChip');
  const npcChip = document.getElementById('characterCountChip');

  if (titleEl) titleEl.textContent = (S.title || '').trim() || '（未設定）';
  if (modeChip) modeChip.textContent = `モード：${projectModeLabel(S.projectMode || 'general')}`;
  if (tplChip) {
    tplChip.style.display = isTrpgMode() ? 'none' : '';
    tplChip.textContent = `テンプレート：${writingTemplateLabel(S.writingTemplate || 'default')}`;
  }
  if (edChip) {
    const show = isTrpgMode();
    edChip.style.display = show ? '' : 'none';
    if (show) edChip.textContent = `ルール版：${editionLabel(S.edition || '7th')}`;
  }
  if (npcChip) npcChip.textContent = `キャラクター：${(S.npcs || []).length}件`;
}

function syncInitialSettingsModeUI() {
  const modeSel = document.getElementById('projectModeSel');
  const mode = modeSel?.value === 'trpg' ? 'trpg' : 'general';
  const showEdition = mode === 'trpg';
  const showTemplate = !showEdition;
  const pSep = document.getElementById('projectEditionSep');
  const pLbl = document.getElementById('projectEditionLabel');
  const pWrap = document.getElementById('projectEditionWrap');
  const tSep = document.getElementById('writingTemplateSep');
  const tLbl = document.getElementById('writingTemplateLabel');
  const tWrap = document.getElementById('writingTemplateWrap');
  if (pSep) pSep.style.display = showEdition ? '' : 'none';
  if (pLbl) pLbl.style.display = showEdition ? '' : 'none';
  if (pWrap) pWrap.style.display = showEdition ? '' : 'none';
  if (tSep) tSep.style.display = showTemplate ? '' : 'none';
  if (tLbl) tLbl.style.display = showTemplate ? '' : 'none';
  if (tWrap) tWrap.style.display = showTemplate ? '' : 'none';
  renderProjectEditionBtns();
}

function openInitialSettingsModal(forNew = false) {
  _initialSettingsForNew = !!forNew;
  const title = document.getElementById('initialSettingsTitle');
  const desc = document.getElementById('initialSettingsDesc');
  const cancelBtn = document.getElementById('initialSettingsCancelBtn');
  const applyBtn = document.getElementById('initialSettingsApplyBtn');
  const titleInput = document.getElementById('scenarioTitle');
  const modeSel = document.getElementById('projectModeSel');
  const tplSel = document.getElementById('writingTemplateSel');

  if (title) title.textContent = forNew ? '新規作成の初期設定' : '初期設定変更';
  if (desc) desc.textContent = forNew
    ? 'タイトル・モード・テンプレートを先に設定してから執筆を開始します。'
    : '執筆途中でも、タイトルやモードなどの初期設定を変更できます。';
  if (cancelBtn) cancelBtn.style.display = forNew ? 'none' : '';
  if (applyBtn) applyBtn.textContent = forNew ? 'この設定で開始' : 'この設定で更新';

  const base = forNew ? createInitialState() : S;
  if (titleInput) titleInput.value = base.title || '';
  if (modeSel) modeSel.value = base.projectMode || 'general';
  if (tplSel) tplSel.value = base.writingTemplate || 'default';
  _initialEditionDraft = (base.edition === '6th' || base.edition === '7th') ? base.edition : '7th';
  renderProjectEditionBtns();
  syncInitialSettingsModeUI();

  openModal('initialSettingsModal');
}

function applyInitialSettings() {
  const titleInput = document.getElementById('scenarioTitle');
  const modeSel = document.getElementById('projectModeSel');
  const tplSel = document.getElementById('writingTemplateSel');
  const nextTitle = (titleInput?.value || '').trim();
  if (!nextTitle) {
    toast('タイトルを入力してください', true);
    return;
  }

  const nextMode = modeSel?.value === 'trpg' ? 'trpg' : 'general';
  const nextTpl = WRITING_TEMPLATES[tplSel?.value] ? tplSel.value : 'default';
  const nextEd = _initialEditionDraft === '6th' ? '6th' : '7th';

  if (_initialSettingsForNew) {
    startNewWriting({
      title: nextTitle,
      projectMode: nextMode,
      writingTemplate: nextTpl,
      edition: nextEd,
    });
    closeModal('initialSettingsModal');
    _initialSettingsForNew = false;
    return;
  }

  S.title = nextTitle;
  S.projectMode = nextMode;
  if (!isTrpgMode()) {
    S.writingTemplate = nextTpl;
  }
  if (isTrpgMode()) {
    S.edition = nextEd;
  }
  syncInitialSettingsModeUI();
  renderWritingTemplateUI();
  renderScenarioHeaderMeta();
  renderBlocks();
  renderNPCs();
  markDirty();
  closeModal('initialSettingsModal');
  toast('初期設定を更新しました');
}

function chooseStartupMode(mode) {
  const fromEditor = _startupChoiceFromEditor;
  _startupChoiceFromEditor = false;

  if (fromEditor) {
    const actionLabel = mode === 'continue' ? '続きから開始' : '新規執筆の開始';
    const ok = confirm(`${actionLabel}を実行すると、現在の表示内容は切り替わります。続行しますか？`);
    if (!ok) return;
  }

  closeModal('startupChoiceModal');
  if (mode === 'continue' && hasQuickSaveData()) {
    loadData();
    if (fromEditor) toast('📂 クイック保存データを読み込みました');
    return;
  }
  if (mode === 'continue' && !hasQuickSaveData()) {
    toast('続きデータが見つかりません', true);
    return;
  }
  openInitialSettingsModal(true);
}

function openStartupChoice(fromEditor = false) {
  _startupChoiceFromEditor = !!fromEditor;
  const title = document.getElementById('startupChoiceTitle');
  const desc = document.getElementById('startupChoiceDesc');
  const continueBtn = document.getElementById('startupContinueBtn');
  const note = document.getElementById('startupContinueNote');
  const canContinue = hasQuickSaveData();
  if (title) title.textContent = fromEditor ? '開始方法を選択' : '執筆を開始';
  if (desc) desc.textContent = fromEditor
    ? '現在の作業中でも、新規作成または前回データの読込に切り替えられます。'
    : 'このページでは、新規作成か前回の続きから再開するかを選べます。';
  if (continueBtn) continueBtn.disabled = !canContinue;
  if (note) note.textContent = canContinue
    ? '前回のクイック保存データから再開します'
    : '前回データが見つからないため、続きから開始は選べません';
  openModal('startupChoiceModal');
}

function openStartupChoiceFromEditor() {
  openInitialSettingsModal(false);
}

function playLogoIntroAndStart() {
  const intro = document.getElementById('logoIntro');
  if (!intro) {
    openStartupChoice();
    return;
  }
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    openStartupChoice();
    return;
  }

  document.body.classList.add('intro-playing');
  intro.setAttribute('aria-hidden', 'false');

  requestAnimationFrame(() => {
    intro.classList.add('is-active');
  });

  let startupOpened = false;

  setTimeout(() => {
    openStartupChoice();
    startupOpened = true;
    intro.classList.add('is-leaving');
  }, 1880);

  setTimeout(() => {
    intro.classList.remove('is-active', 'is-leaving');
    intro.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('intro-playing');
    if (!startupOpened) openStartupChoice();
  }, 2400);
}

// ======= SAVE SYSTEM =======
const SLOT_KEY_PREFIX = 'kakigoto_slot_';
const LEGACY_SLOT_KEY_PREFIX = 'mythos_slot_';
const SLOT_INDEX_KEY  = 'kakigoto_slots_index';
const LEGACY_SLOT_INDEX_KEY  = 'mythos_slots_index';
const MAX_SLOTS = 10;

let _dirty = false;       // 未保存の変更があるか
let _autoSaveTimer = null;
let _autoSaveInterval = null;

// ── ダーティフラグ管理 ──
function markDirty() {
  if (_dirty) return;
  _dirty = true;
  setAutoSaveState('dirty');
  // 5秒後に自動保存
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => autoSave(), 5000);
}

function setAutoSaveState(state) {
  const el = document.getElementById('autosaveIndicator');
  const icon = document.getElementById('autosaveIcon');
  const text = document.getElementById('autosaveText');
  if (!el) return;
  el.className = 'autosave-indicator ' + state;
  const states = {
    saved:  { icon:'●', text:'保存済' },
    dirty:  { icon:'●', text:'未保存' },
    saving: { icon:'●', text:'保存中…' },
    error:  { icon:'●', text:'保存失敗' },
  };
  const s = states[state] || states.saved;
  if (icon) icon.textContent = s.icon;
  if (text) text.textContent = s.text;
}

// ── クイック保存（localStorage 上書き）──
function quickSave() {
  setAutoSaveState('saving');
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(S));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    _dirty = false;
    setAutoSaveState('saved');
    toast('💾 保存しました');
  } catch(e) {
    setAutoSaveState('error');
    toast('保存に失敗しました（容量不足の可能性があります）', true);
  }
}

// 旧 saveData との互換
function saveData() { quickSave(); }

// ── 自動保存 ──
function autoSave() {
  if (!_dirty) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(S));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    _dirty = false;
    setAutoSaveState('saved');
  } catch(e) {
    setAutoSaveState('error');
  }
}

// ── スロット保存 ──
function getSlotIndex() {
  try {
    const raw = localStorage.getItem(SLOT_INDEX_KEY) || localStorage.getItem(LEGACY_SLOT_INDEX_KEY) || '[]';
    return JSON.parse(raw);
  } catch(e) {
    return [];
  }
}
function saveSlotIndex(idx) {
  localStorage.setItem(SLOT_INDEX_KEY, JSON.stringify(idx));
  localStorage.removeItem(LEGACY_SLOT_INDEX_KEY);
}

function getSlotRaw(slotId) {
  return localStorage.getItem(SLOT_KEY_PREFIX + slotId) || localStorage.getItem(LEGACY_SLOT_KEY_PREFIX + slotId);
}

function openSlotModal() {
  renderSlotList();
  openModal('slotModal');
  // 保存名の初期値：シナリオタイトル＋日時
  const title = S.title || 'シナリオ';
  const now = new Date();
  const dt = `${now.getMonth()+1}/${now.getDate()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  document.getElementById('slotSaveName').value = `${title} — ${dt}`;
}

function renderSlotList() {
  const list = document.getElementById('slotList');
  const idx = getSlotIndex();
  if (!idx.length) {
    list.innerHTML = '<div class="slot-empty">まだ保存されたスロットはありません</div>';
    return;
  }
  list.innerHTML = idx.map(slot => {
    const sc = slot.sceneCount || 0;
    const npc = slot.npcCount || 0;
    const dt = slot.savedAt ? new Date(slot.savedAt).toLocaleString('ja-JP', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
    return `<div class="slot-card">
      <div class="slot-icon">📂</div>
      <div class="slot-info">
        <div class="slot-name" title="${h(slot.name)}">${h(slot.name)}</div>
        <div class="slot-meta">${dt}　シーン${sc}件・キャラクター${npc}件</div>
      </div>
      <div class="slot-actions">
        <button class="btn btn-sm btn-primary" onclick="loadFromSlot('${slot.id}')">読込</button>
        <button class="btn btn-sm" onclick="overwriteSlot('${slot.id}')">上書</button>
        <button class="btn btn-sm btn-danger" onclick="deleteSlot('${slot.id}')">🗑</button>
      </div>
    </div>`;
  }).join('');
}

function saveToSlot() {
  const name = document.getElementById('slotSaveName').value.trim();
  if (!name) { toast('保存名を入力してください', true); return; }
  const idx = getSlotIndex();
  if (idx.length >= MAX_SLOTS) { toast(`スロットは最大${MAX_SLOTS}件までです。不要なスロットを削除してください`, true); return; }
  const slotId = uid();
  const meta = {
    id: slotId, name, savedAt: Date.now(),
    sceneCount: S.scenes.length, npcCount: S.npcs.length
  };
  try {
    localStorage.setItem(SLOT_KEY_PREFIX + slotId, JSON.stringify(S));
    localStorage.removeItem(LEGACY_SLOT_KEY_PREFIX + slotId);
    idx.unshift(meta); // 先頭に追加
    saveSlotIndex(idx);
    renderSlotList();
    document.getElementById('slotSaveName').value = '';
    toast(`✅ 「${name}」に保存しました`);
  } catch(e) {
    toast('スロット保存に失敗しました（容量不足の可能性があります）', true);
  }
}

function overwriteSlot(slotId) {
  const idx = getSlotIndex();
  const meta = idx.find(s => s.id === slotId);
  if (!meta) return;
  if (!confirm(`「${meta.name}」を現在の内容で上書きしますか？`)) return;
  try {
    meta.savedAt = Date.now();
    meta.sceneCount = S.scenes.length;
    meta.npcCount = S.npcs.length;
    localStorage.setItem(SLOT_KEY_PREFIX + slotId, JSON.stringify(S));
    localStorage.removeItem(LEGACY_SLOT_KEY_PREFIX + slotId);
    saveSlotIndex(idx);
    renderSlotList();
    toast(`✅ 「${meta.name}」を上書き保存しました`);
  } catch(e) {
    toast('上書き保存に失敗しました', true);
  }
}

function loadFromSlot(slotId) {
  const idx = getSlotIndex();
  const meta = idx.find(s => s.id === slotId);
  if (!meta) return;
  if (!confirm(`「${meta.name}」を読み込みますか？\n現在の編集内容は上書きされます（クイック保存されていれば復元できます）`)) return;
  try {
    const raw = getSlotRaw(slotId);
    if (!raw) { toast('データが見つかりません', true); return; }
    S = JSON.parse(raw);
    // 必須フィールド補完
    if (!S.floors) S.floors = [];
    if (!S.edges)  S.edges  = [];
    ensureDefaultFloor();
    if (S.floors.length) MAP.curFloor = S.floors[0].id;
    const titleInput = document.getElementById('scenarioTitle');
    if (titleInput) titleInput.value = S.title || '';
    closeModal('slotModal');
    renderAll();
    toast(`📂 「${meta.name}」を読み込みました`);
    setAutoSaveState('saved');
    _dirty = false;
  } catch(e) {
    toast('読み込みに失敗しました', true);
  }
}

function deleteSlot(slotId) {
  const idx = getSlotIndex();
  const meta = idx.find(s => s.id === slotId);
  if (!meta || !confirm(`「${meta.name}」を削除しますか？`)) return;
  localStorage.removeItem(SLOT_KEY_PREFIX + slotId);
  localStorage.removeItem(LEGACY_SLOT_KEY_PREFIX + slotId);
  saveSlotIndex(idx.filter(s => s.id !== slotId));
  renderSlotList();
  toast('削除しました');
}

// ── プロジェクトファイル エクスポート ──
function exportProjectFile() {
  const title = (S.title || 'kakigoto_scenario').replace(/[\\/:*?"<>|]/g, '_');
  const now = new Date();
  const dt = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const filename = `${title}_${dt}.${PROJECT_FILE_EXT}`;
  const projectFile = {
    fileType: PROJECT_FILE_TYPE,
    version: PROJECT_FILE_VERSION,
    app: 'Kakigoto Writer',
    exportedAt: now.toISOString(),
    data: S
  };
  const blob = new Blob([JSON.stringify(projectFile, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`📤 「${filename}」をダウンロードしました`);
}

function normalizeImportedProject(rawObj) {
  // 新形式（プロジェクトファイル）
  if (rawObj && (rawObj.fileType === PROJECT_FILE_TYPE || rawObj.fileType === LEGACY_PROJECT_FILE_TYPE) && rawObj.data && rawObj.data.scenes) {
    return rawObj.data;
  }
  // 旧形式（直接JSON）
  if (rawObj && rawObj.scenes) {
    return rawObj;
  }
  throw new Error('不正なプロジェクトファイルです');
}

// ── プロジェクトファイル インポート ──
function importProjectFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!confirm(`「${file.name}」を読み込みますか？\n現在の編集内容は上書きされます。\n（事前にプロジェクトファイルをエクスポートしてバックアップすることをおすすめします）`)) {
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const imported = JSON.parse(e.target.result);
      S = normalizeImportedProject(imported);
      finalizeLoadedState();
      // localStorage にも保存
      localStorage.setItem(STORAGE_KEY, JSON.stringify(S));
      toast(`📥 「${file.name}」を読み込みました`);
    } catch(err) {
      toast('読み込みに失敗しました：' + err.message, true);
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}

// 旧関数名との互換
function exportJSON() { exportProjectFile(); }
function importJSON(event) { importProjectFile(event); }

// ── 保存メニュー開閉 ──
function toggleSaveMenu(e) {
  e.stopPropagation();
  document.getElementById('saveDropdown').classList.toggle('open');
}
function closeSaveMenu() {
  document.getElementById('saveDropdown').classList.remove('open');
}

// ── キーボードショートカット ──
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    quickSave();
  }
});
// 外クリックで保存メニューを閉じる
document.addEventListener('click', () => closeSaveMenu());

// ── 定期自動保存（30秒ごと）──
function startPeriodicAutoSave() {
  if (_autoSaveInterval) clearInterval(_autoSaveInterval);
  _autoSaveInterval = setInterval(() => {
    if (_dirty) autoSave();
  }, 30000);
}

// ── ページ離脱前の警告 ──
window.addEventListener('beforeunload', e => {
  if (_dirty) {
    e.preventDefault();
    e.returnValue = '保存されていない変更があります。ページを離れますか？';
  }
});


// ======= Utils =======
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function h(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function toast(msg, err=false, durationMs=2200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = err ? '#a32d2d' : '#185fa5';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), Math.max(600, Number(durationMs) || 2200));
}

function isTrpgMode() {
  return (S.projectMode || 'general') === 'trpg';
}

function setProjectMode(mode) {
  S.projectMode = mode === 'trpg' ? 'trpg' : 'general';
  renderProjectModeUI();
  renderProjectEditionBtns();
  renderWritingTemplateUI();
  if (document.getElementById('npcModal')?.classList.contains('open')) {
    setNpcEdition(isTrpgMode() ? (S.edition || '7th') : 'general');
    renderSkillList();
  }
  renderNPCs();
  markDirty();
  toast(S.projectMode === 'trpg' ? 'TRPGモードに切り替えました' : '汎用モードに切り替えました');
}

function renderProjectModeUI() {
  const mode = S.projectMode || 'general';
  const sel = document.getElementById('projectModeSel');
  if (sel) sel.value = mode;
  const showEdition = mode === 'trpg';
  const sep = document.getElementById('projectEditionSep');
  const label = document.getElementById('projectEditionLabel');
  const wrap = document.getElementById('projectEditionWrap');
  if (sep) sep.style.display = showEdition ? '' : 'none';
  if (label) label.style.display = showEdition ? '' : 'none';
  if (wrap) wrap.style.display = showEdition ? '' : 'none';

  const tSep = document.getElementById('writingTemplateSep');
  const tLbl = document.getElementById('writingTemplateLabel');
  const tWrap = document.getElementById('writingTemplateWrap');
  const showTemplate = !showEdition;
  if (tSep) tSep.style.display = showTemplate ? '' : 'none';
  if (tLbl) tLbl.style.display = showTemplate ? '' : 'none';
  if (tWrap) tWrap.style.display = showTemplate ? '' : 'none';

  renderNpcModeTexts();
  applyWritingTemplateVisuals();
  renderScenarioHeaderMeta();
}

function getWritingTemplateDef() {
  return WRITING_TEMPLATES[S.writingTemplate] || WRITING_TEMPLATES.default;
}

function renderWritingTemplateUI() {
  const sel = document.getElementById('writingTemplateSel');
  if (sel) sel.value = S.writingTemplate || 'default';
  applyWritingTemplateVisuals();
  renderBlockTypePillTexts();
  renderScenarioHeaderMeta();
}

function applyWritingTemplateVisuals() {
  const body = document.body;
  const container = document.getElementById('blockList');
  if (!body) return;
  ['default', 'novel', 'script', 'article', 'trpg'].forEach((tpl) => {
    body.classList.remove(`tpl-${tpl}`);
  });
  const activeTpl = isTrpgMode()
    ? 'trpg'
    : (WRITING_TEMPLATES[S.writingTemplate] ? S.writingTemplate : 'default');
  body.classList.add(`tpl-${activeTpl}`);
  if (container) container.dataset.template = activeTpl;
}

function setWritingTemplate(tpl) {
  if (!WRITING_TEMPLATES[tpl]) tpl = 'default';
  S.writingTemplate = tpl;
  renderWritingTemplateUI();
  renderBlocks();
  markDirty();
  const labelMap = { default: '汎用', novel: '小説', script: '脚本', article: '記事' };
  toast(`${labelMap[tpl] || '汎用'}テンプレートに切り替えました`);
}

function applyWritingTemplatePreset() {
  if (isTrpgMode()) return;
  if (!confirm('現在のシーン構成をテンプレート構成に置き換えます。続行しますか？')) return;
  const def = getWritingTemplateDef();
  S.scenes = (def.sceneNames || ['章 1']).map(name => ({ id: uid(), name, blocks: [] }));
  S.curScene = 0;
  renderScenes();
  renderBlocks();
  markDirty();
  toast('テンプレート構成を適用しました');
}

function renderBlockTypePillTexts() {
  const map = isTrpgMode()
    ? { scene: '👁 場面描写', dialog: '💬 セリフ', game: '🎲 ゲーム処理' }
    : getWritingTemplateDef().blockTypeLabels;
  const sceneBtn = document.getElementById('tpScene');
  const dialogBtn = document.getElementById('tpDialog');
  const gameBtn = document.getElementById('tpGame');
  if (sceneBtn) sceneBtn.textContent = map.scene;
  if (dialogBtn) dialogBtn.textContent = map.dialog;
  if (gameBtn) gameBtn.textContent = map.game;
}

function renderNpcModeTexts() {
  const trpg = isTrpgMode();
  const statsTab = document.getElementById('nmtab-stats');
  const skillsTab = document.getElementById('nmtab-skills');
  const statsHd = document.getElementById('npcStatsSectionHd');
  const skillsLbl = document.getElementById('npcSkillListLabel');
  const weaponsLbl = document.getElementById('npcWeaponsLbl');
  const abilitiesLbl = document.getElementById('npcAbilitiesLbl');
  const weapons = document.getElementById('npcWeapons');
  const abilities = document.getElementById('npcAbilities');
  if (statsTab) statsTab.textContent = trpg ? '📊 能力値' : '📊 プロファイル';
  if (skillsTab) skillsTab.textContent = trpg ? '⚔️ 技能' : '🧩 項目';
  if (statsHd) statsHd.textContent = trpg ? '基本能力値' : '基本プロファイル';
  if (skillsLbl) skillsLbl.textContent = trpg ? '技能一覧' : '項目一覧';
  if (weaponsLbl) weaponsLbl.textContent = trpg ? '武器・攻撃手段' : '装備・関連情報';
  if (abilitiesLbl) abilitiesLbl.textContent = trpg ? '特殊能力・特記事項' : '補足事項';
  if (weapons) weapons.placeholder = trpg ? '例：拳銃（.38口径） 1d10 / 格闘 1d3+DB' : '例：持ち物、関連人物、外部リンク';
  if (abilities) abilities.placeholder = trpg ? '例：接触した相手にストレス判定を要求' : '例：特徴、注意点、運用メモ';
}
// プロジェクト全体のデフォルトエディション
function setProjectEdition(ed) {
  const inInitialModal = !!document.getElementById('initialSettingsModal')?.classList.contains('open');
  const normalized = ed === '6th' ? '6th' : '7th';
  if (inInitialModal) {
    _initialEditionDraft = normalized;
    renderProjectEditionBtns();
    return;
  }
  if (!isTrpgMode()) return;
  S.edition = normalized;
  // ボタン状態更新
  ['7th','6th'].forEach(e => {
    const btn = document.getElementById('projEdBtn'+e[0]);
    if (!btn) return;
    btn.className = 'edition-btn' + (e === ed ? ' '+(e==='7th'?'active-7th':'active-6th') : '');
  });
  // NPC追加時のデフォルトに反映
  markDirty();
  toast('デフォルトルール版を '+(ed==='7th'?'第7版':'第6版')+' に設定しました');
}

function renderProjectEditionBtns() {
  const inInitialModal = !!document.getElementById('initialSettingsModal')?.classList.contains('open');
  if (!isTrpgMode() && !inInitialModal) return;
  const ed = inInitialModal ? (_initialEditionDraft || '7th') : (S.edition || '7th');
  ['7th','6th'].forEach(e => {
    const btn = document.getElementById('projEdBtn'+e[0]);
    if (!btn) return;
    btn.className = 'edition-btn' + (e === ed ? ' '+(e==='7th'?'active-7th':'active-6th') : '');
  });
  if (!inInitialModal) renderScenarioHeaderMeta();
}

function switchTab(tab) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-' + tab).classList.add('active');
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  if (tab === 'map') setTimeout(() => { resizeFpCanvas(); initFpEvents(); drawFp(); }, 30);
}

function setModalScrollLock(locked) {
  if (locked) {
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    document.body.style.overflow = 'hidden';
    document.body.style.paddingRight = scrollbarWidth > 0 ? `${scrollbarWidth}px` : '';
    return;
  }
  document.body.style.overflow = '';
  document.body.style.paddingRight = '';
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('open');

  const hasOpenOverlay = document.querySelector('.overlay.open');
  if (!hasOpenOverlay) {
    setModalScrollLock(false);
  }
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('open');
  setModalScrollLock(true);
}
function renderAll() { renderScenarioHeaderMeta(); renderScenes(); renderBlocks(); renderNPCs(); renderArts(); renderMap(); renderTimeline(); renderPlots(); }

// ======= SCENARIO =======
function renderScenes() {
  const list = document.getElementById('sceneList');
  list.innerHTML = S.scenes.map((sc, i) => `
    <div class="scene-item ${i === S.curScene ? 'active' : ''}"
      id="sc-${i}"
      ondragover="sceneDragOver(event,${i})"
      ondragleave="sceneDragLeave(event,${i})"
      ondrop="sceneDrop(event,${i})"
      onclick="selectScene(${i})">
      <span class="scene-drag-handle"
        title="ドラッグして並び替え"
        draggable="true"
        ondragstart="sceneDragStart(event,${i})"
        ondragend="sceneDragEnd()"
        onclick="event.stopPropagation()">
        <span class="grip-dots"><span></span><span></span><span></span><span></span><span></span><span></span></span>
      </span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(sc.name)}</span>
      <span class="cnt">${(sc.blocks||[]).length}</span>
    </div>`).join('');
}

function selectScene(i) { S.curScene = i; renderScenes(); renderBlocks(); }

function addScene() {
  const name = prompt('シーン名を入力してください');
  if (!name) return;
  S.scenes.push({ id: uid(), name, blocks: [] });
  S.curScene = S.scenes.length - 1;
  renderScenes(); renderBlocks(); markDirty();
}

function renameScene() {
  const sc = S.scenes[S.curScene];
  const name = prompt('シーン名', sc.name);
  if (!name) return;
  sc.name = name;
  renderScenes(); markDirty();
}

function deleteCurrentScene() {
  if (S.scenes.length <= 1) { toast('最後のシーンは削除できません', true); return; }
  if (!confirm(`「${S.scenes[S.curScene].name}」を削除しますか？`)) return;
  S.scenes.splice(S.curScene, 1);
  S.curScene = Math.max(0, S.curScene - 1);
  renderScenes(); renderBlocks(); markDirty();
}

function setBlockType(t) {
  S.blockType = t;
  const map = { scene: 'pill-scene', dialog: 'pill-dialog', game: 'pill-game', pagebreak: 'pill-pagebreak' };
  ['scene','dialog','game','pagebreak'].forEach(type => {
    const el = document.getElementById('tp' + type.charAt(0).toUpperCase() + type.slice(1));
    if (!el) return;
    el.className = 'type-pill' + (t === type ? ' ' + map[type] : '');
  });
  renderBlockTypePillTexts();
}

function getSceneDialogSpeakers(sc) {
  const names = new Set();
  (sc?.blocks || []).forEach((b) => {
    if (b.type !== 'dialog') return;
    const name = String(b.speaker || '').trim();
    if (name) names.add(name);
  });
  return Array.from(names);
}

function renderBlockFilterUI(sc = S.scenes[S.curScene]) {
  const typeSel = document.getElementById('blockFilterType');
  const speakerSel = document.getElementById('blockFilterSpeaker');
  const speakerWrap = document.getElementById('blockFilterSpeakerWrap');
  const badge = document.getElementById('blockFilterBadge');
  const validTypes = ['all', 'scene', 'dialog', 'game', 'pagebreak', 'artifact', 'map', 'timeline', 'plot'];
  if (!validTypes.includes(S.blockFilterType)) S.blockFilterType = 'all';
  if (typeSel) typeSel.value = S.blockFilterType;

  const speakers = getSceneDialogSpeakers(sc);
  const prevSpeaker = S.blockFilterSpeaker || 'all';
  const validSpeaker = prevSpeaker === 'all' || prevSpeaker === '__none__' || speakers.includes(prevSpeaker);
  S.blockFilterSpeaker = validSpeaker ? prevSpeaker : 'all';

  if (speakerSel) {
    const options = [
      '<option value="all">全話者</option>',
      '<option value="__none__">話者未設定</option>',
      ...speakers.map((name) => `<option value="${h(name)}">${h(name)}</option>`)
    ];
    speakerSel.innerHTML = options.join('');
    speakerSel.value = S.blockFilterSpeaker;
    speakerSel.disabled = speakers.length === 0;
  }
  if (speakerWrap) speakerWrap.style.display = speakers.length ? '' : 'none';

  const activeCount = (S.blockFilterType !== 'all' ? 1 : 0) + (S.blockFilterSpeaker !== 'all' ? 1 : 0);
  if (badge) {
    badge.style.display = activeCount ? '' : 'none';
    badge.textContent = `適用中: ${activeCount}`;
  }
}

function isBlockVisibleByFilter(b) {
  const typeFilter = S.blockFilterType || 'all';
  const speakerFilter = S.blockFilterSpeaker || 'all';

  if (typeFilter !== 'all' && b.type !== typeFilter) return false;
  if (speakerFilter === 'all') return true;
  if (b.type !== 'dialog') return false;

  const speaker = String(b.speaker || '').trim();
  if (speakerFilter === '__none__') return !speaker;
  return speaker === speakerFilter;
}

function setBlockFilterType(type) {
  const validTypes = ['all', 'scene', 'dialog', 'game', 'pagebreak', 'artifact', 'map', 'timeline', 'plot'];
  S.blockFilterType = validTypes.includes(type) ? type : 'all';
  renderBlocks();
}

function setBlockFilterSpeaker(speaker) {
  S.blockFilterSpeaker = speaker || 'all';
  if (S.blockFilterSpeaker !== 'all' && S.blockFilterType === 'all') {
    S.blockFilterType = 'dialog';
  }
  renderBlocks();
}

function clearBlockFilters() {
  S.blockFilterType = 'all';
  S.blockFilterSpeaker = 'all';
  renderBlocks();
}

function renderWritingModeUI() {
  if (!['horizontal', 'vertical'].includes(S.writingMode)) S.writingMode = 'horizontal';
  const horizontalBtn = document.getElementById('wmHorizontal');
  const verticalBtn = document.getElementById('wmVertical');
  if (horizontalBtn) {
    const active = S.writingMode === 'horizontal';
    horizontalBtn.classList.toggle('active', active);
    horizontalBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  if (verticalBtn) {
    const active = S.writingMode === 'vertical';
    verticalBtn.classList.toggle('active', active);
    verticalBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function setWritingMode(mode) {
  const nextMode = mode === 'vertical' ? 'vertical' : 'horizontal';
  if (S.writingMode === nextMode) return;
  S.writingMode = nextMode;
  renderBlocks();
  markDirty();
  if (nextMode === 'vertical') {
    toast('ただいま縦書き対応の出力機能は利用できません', true, 4000);
  } else {
    toast('横書き表示に切り替えました');
  }
}

// ======= カラーユーティリティ =======
function colorToLight(hex) {
  // 暗い色→白文字、明るい色→暗文字
  if (!hex) return '#185fa5';
  const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return (0.299*r+0.587*g+0.114*b) > 160 ? '#1a202c' : '#ffffff';
}
function hexToRgba(hex, a) {
  if (!hex) return '';
  const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}
function npcColorFor(speakerName) {
  const npc = S.npcs.find(n => n.name === speakerName);
  return npc && npc.color ? npc.color : null;
}

function buildColorPopover(blockIdx, currentColor) {
  const swatches = PALETTE.map(c => {
    const chosen = currentColor === c ? ' chosen' : '';
    return `<div class="color-swatch${chosen}" style="background:${c}" title="${c}" onclick="event.stopPropagation();setBlockColor(${blockIdx},'${c}')"></div>`;
  }).join('');
  const noneChosen = !currentColor ? ' style="border-color:var(--text-muted)"' : '';
  return `<div class="color-popover" id="cp-${blockIdx}">
    <div class="color-swatch-none" title="色なし"${noneChosen} onclick="event.stopPropagation();setBlockColor(${blockIdx},'')">✕</div>
    ${swatches}
    <input type="color" class="color-swatch" style="padding:0;cursor:pointer;border:2px solid var(--border);background:var(--surface);width:22px;height:22px;border-radius:50%" title="カスタム" oninput="event.stopPropagation();setBlockColor(${blockIdx},this.value)" onclick="event.stopPropagation()">
  </div>`;
}

function toggleColorPopover(blockIdx, event) {
  event.stopPropagation();
  document.querySelectorAll('.color-popover').forEach(p => {
    if (p.id !== `cp-${blockIdx}`) p.classList.remove('open');
  });
  document.getElementById(`cp-${blockIdx}`)?.classList.toggle('open');
}

function setBlockColor(i, color) {
  S.scenes[S.curScene].blocks[i].color = color;
  // ポップオーバー閉じてブロック更新
  document.getElementById(`cp-${i}`)?.classList.remove('open');
  // ブロックのスタイルだけ部分更新
  const blk = document.getElementById(`blk-${i}`);
  if (blk) applyBlockColor(blk, S.scenes[S.curScene].blocks[i]);
}

function applyBlockColor(el, b) {
  const color = b.color || npcColorFor(b.speaker) || '';
  if (color) {
    el.style.borderLeftColor = color;
    el.style.background = hexToRgba(color, 0.06);
    const badge = el.querySelector('.speaker-badge-txt');
    if (badge) {
      badge.style.color = color;
      badge.style.background = hexToRgba(color, 0.12);
    }
    const btn = el.querySelector('.spk-color-btn');
    if (btn) btn.style.background = color;
  } else {
    el.style.borderLeftColor = '';
    el.style.background = '';
    const btn = el.querySelector('.spk-color-btn');
    if (btn) btn.style.background = '#e2e8f0';
  }
}

function buildSpeakerRow(b, i) {
  const npcOptions = S.npcs.map(n => {
    const dot = n.color ? `<span class="spk-npc-dot" style="background:${n.color}"></span>` : '';
    const isSelected = b.speaker === n.name && !b.speakerFree;
    return `<option value="${h(n.name)}" ${isSelected?'selected':''}>${n.name}${n.role?'（'+n.role+'）':''}</option>`;
  }).join('');
  const isFree = b.speakerFree || (!b.speakerFree && b.speaker && !S.npcs.find(n => n.name === b.speaker));
  const blockColor = b.color || npcColorFor(b.speaker) || '';
  const btnBg = blockColor || '#e2e8f0';
  const freeInput = `<input class="speaker-free" id="spk-free-${i}"
    value="${h(isFree ? b.speaker : '')}"
    placeholder="名前を入力..."
    style="${isFree ? '' : 'display:none'}"
    oninput="updateSpeakerFree(${i}, this.value)"
    onclick="event.stopPropagation()">`;
  return `<div class="speaker-row" onclick="event.stopPropagation()">
    <span class="speaker-label">💬 話者：</span>
    <select class="speaker-select" id="spk-sel-${i}" onchange="onSpeakerSelect(${i}, this.value)">
      <option value="" ${!b.speaker?'selected':''}>── 未選択 ──</option>
      ${S.npcs.length ? `<optgroup label="登録済みNPC">${npcOptions}</optgroup>` : ''}
      <optgroup label="その他">
        <option value="__free__" ${isFree?'selected':''}>自由入力（モブ等）</option>
      </optgroup>
    </select>
    ${freeInput}
    <div class="speaker-color-wrap">
      <div class="speaker-color-btn spk-color-btn" style="background:${btnBg}" title="セリフカラーを設定" onclick="toggleColorPopover(${i},event)"></div>
      ${buildColorPopover(i, b.color||'')}
    </div>
  </div>`;
}

function onSpeakerSelect(i, val) {
  const b = S.scenes[S.curScene].blocks[i];
  const freeEl = document.getElementById(`spk-free-${i}`);
  if (val === '__free__') {
    b.speakerFree = true;
    b.speaker = '';
    if (freeEl) { freeEl.style.display = ''; freeEl.focus(); }
  } else {
    b.speakerFree = false;
    b.speaker = val;
    if (freeEl) freeEl.style.display = 'none';
  }
  // NPC登録色を自動反映（ブロック独自色が未設定の場合）
  if (!b.color) {
    const el = document.getElementById(`blk-${i}`);
    if (el) applyBlockColor(el, b);
    // カラーボタンの色も更新
    const nColor = npcColorFor(b.speaker);
    const btn = el?.querySelector('.spk-color-btn');
    if (btn) btn.style.background = nColor || '#e2e8f0';
  }
  markDirty();
  scheduleWriterPageMarkers();
}

function updateSpeakerFree(i, val) {
  S.scenes[S.curScene].blocks[i].speaker = val;
  S.scenes[S.curScene].blocks[i].speakerFree = true;
  markDirty();
  scheduleWriterPageMarkers();
}

function autoGrowBlockTextarea(el) {
  if (!el) return;
  if ((S.writingMode || 'horizontal') === 'vertical') return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function ensurePdfGuideMeasureRoot() {
  if (_pdfGuideMeasureRoot) return _pdfGuideMeasureRoot;
  const root = document.createElement('div');
  root.id = 'pdfGuideMeasureRoot';
  root.setAttribute('aria-hidden', 'true');
  root.style.cssText = [
    'position:fixed',
    'left:-99999px',
    'top:-99999px',
    `width:${PDF_CONTENT_WIDTH}px`,
    'visibility:hidden',
    'pointer-events:none',
    'z-index:-1'
  ].join(';');
  root.innerHTML = `<style>
    .pdf-measure-flow{
      width:${PDF_CONTENT_WIDTH}px;
      font-family:'Noto Serif JP','Hiragino Mincho ProN','Yu Mincho',Georgia,serif;
      font-size:11pt;
      line-height:1.9;
      color:#1a1a2e;
    }
    .pdf-measure-flow *{box-sizing:border-box}
    .pdf-measure-flow .scene-hd{margin:22px 0 10px;padding:8px 14px;background:#e6f1fb;border-radius:6px;display:flex;align-items:baseline;gap:8px}
    .pdf-measure-flow .scene-hd + .b-scene,
    .pdf-measure-flow .scene-hd + .b-dialog,
    .pdf-measure-flow .scene-hd + .b-game,
    .pdf-measure-flow .scene-hd + .b-ref,
    .pdf-measure-flow .scene-hd + .b-pagebreak{margin-top:28px}
    .pdf-measure-flow .scene-num{font-size:8pt;font-weight:700;letter-spacing:0.12em;color:#185fa5;font-family:'Noto Sans JP',sans-serif;flex-shrink:0}
    .pdf-measure-flow .scene-name{font-size:11pt;font-weight:700;color:#1a1a2e;font-family:'Noto Sans JP',sans-serif}
    .pdf-measure-flow .b-scene{font-size:10.5pt;line-height:2.05;color:#1a1a2e;margin:0;padding:0;text-indent:1em}
    .pdf-measure-flow .b-scene + .b-scene{margin-top:4px}
    .pdf-measure-flow .b-dialog{margin:6px 1px;padding:7px 12px 7px 11px;border-left:3px solid #2d5a1b;background:#eef7e6;border-radius:6px}
    .pdf-measure-flow .dialog-speaker-badge{display:inline-block;font-size:8.5pt;line-height:1.3;font-weight:700;margin-bottom:2px;font-family:'Noto Sans JP',sans-serif;color:#2d5a1b}
    .pdf-measure-flow .dialog-no-speaker{display:inline-block;font-size:8pt;color:#7f8ea5;margin-bottom:2px}
    .pdf-measure-flow .dialog-line{font-size:10.5pt;line-height:1.95;white-space:pre-wrap;word-break:break-word}
    .pdf-measure-flow .b-dialog + .b-dialog{margin-top:2px}
    .pdf-measure-flow .b-scene + .b-dialog,.pdf-measure-flow .b-dialog + .b-scene{margin-top:10px}
    .pdf-measure-flow .b-game{margin:16px 1px;padding:10px 12px 10px 13px;border:1px dashed #c8b87a;border-left:3px solid #6b3d00;background:#fdf3e3;border-radius:6px;position:relative;overflow:visible;box-decoration-break:clone;-webkit-box-decoration-break:clone}
    .pdf-measure-flow .b-game-hd{display:flex;align-items:center;gap:6px;margin-bottom:5px}
    .pdf-measure-flow .b-game-hd-lbl{font-size:8pt;font-weight:700;letter-spacing:0.08em;color:#6b3d00;font-family:'Noto Sans JP',sans-serif;text-transform:uppercase}
    .pdf-measure-flow .b-game-body{font-size:10pt;line-height:1.85;white-space:pre-wrap;word-break:break-word}
    .pdf-measure-flow .b-scene + .b-game,.pdf-measure-flow .b-dialog + .b-game{margin-top:18px}
    .pdf-measure-flow .b-game + .b-scene,.pdf-measure-flow .b-game + .b-dialog{margin-top:18px}
    .pdf-measure-flow .b-ref{margin:14px 0;border-radius:6px;padding:10px 14px}
    .pdf-measure-flow .b-ref-lbl{font-size:8pt;font-weight:700;letter-spacing:0.1em;margin-bottom:6px;opacity:0.75}
    .pdf-measure-flow .b-ref-name{font-size:11pt;font-weight:700;margin-bottom:4px}
    .pdf-measure-flow .b-ref-sub{font-size:9pt;color:#64748b;margin-bottom:6px}
    .pdf-measure-flow .b-ref-body{font-size:9.5pt;line-height:1.8;color:#1a1a2e;white-space:pre-wrap;word-break:break-word}
    .pdf-measure-flow .b-ref-box{margin-top:7px;padding:6px 9px;border-radius:4px;font-size:9pt;line-height:1.6}
    .pdf-measure-flow .b-ref-san{display:inline-block;font-size:8.5pt;padding:2px 8px;border-radius:10px;background:#fcebeb;color:#a32d2d;font-weight:700;margin:4px 0}
    .pdf-measure-flow .b-ref-plot-item{font-size:9.5pt;line-height:1.7;position:relative;padding-left:10px}
    .pdf-measure-flow .b-ref-plot-item::before{content:'・';position:absolute;left:0;top:0}
    .pdf-measure-flow .keep-next{break-after:avoid;page-break-after:avoid}
    .pdf-measure-flow .keep-next + *{break-before:avoid;page-break-before:avoid}
    .pdf-measure-flow .b-pagebreak{height:0;margin:0;padding:0;border:0;break-after:page;page-break-after:always}
  </style><div class="pdf-measure-flow" id="pdfMeasureFlow"></div>`;
  document.body.appendChild(root);
  _pdfGuideMeasureRoot = root;
  return root;
}

function buildPdfMeasureBlockHtml(b) {
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const nl = (s) => esc(s).replace(/\n/g, '<br>');
  const txt = nl(b.content || '');
  const keepCls = b.keepWithNext ? ' keep-next' : '';
  if (b.type === 'pagebreak') return '<div class="b-pagebreak"></div>';
  if (b.type === 'scene') return `<p class="b-scene${keepCls}">${txt}</p>`;
  if (b.type === 'dialog') {
    const spk = b.speaker || '';
    const spkEl = spk
      ? `<div class="dialog-speaker-badge">${esc(spk)}</div>`
      : '<div class="dialog-no-speaker">──</div>';
    return `<div class="b-dialog${keepCls}">${spkEl}<div class="dialog-line">${txt}</div></div>`;
  }
  if (b.type === 'game') {
    return `<div class="b-game${keepCls}"><div class="b-game-hd"><span class="b-game-hd-dice">🎲</span><span class="b-game-hd-lbl">KP ／ ゲーム処理</span></div><div class="b-game-body">${txt}</div></div>`;
  }
  if (b.type === 'artifact') {
    const a = b.refData || {};
    return `<div class="b-ref b-ref-artifact${keepCls}"><div class="b-ref-lbl">📦 アーティファクト参照</div><div class="b-ref-name">${esc(a.name || '')}</div><div class="b-ref-sub">${esc(a.type || '')}</div>${a.desc ? `<div class="b-ref-body">${esc(a.desc)}</div>` : ''}${a.san ? `<div class="b-ref-san">🧠 SAN減少：${esc(a.san)}</div>` : ''}${a.req ? `<div class="b-ref-sub">使用条件：${esc(a.req)}</div>` : ''}${a.effect ? `<div class="b-ref-box">${esc(a.effect)}</div>` : ''}</div>`;
  }
  if (b.type === 'map') {
    const r = b.refData || {};
    const isFloorRef = r.refKind === 'floor';
    return `<div class="b-ref b-ref-map${keepCls}"><div class="b-ref-lbl">🗺 マップ参照</div><div class="b-ref-name">${isFloorRef ? '🗺' : '🚪'} ${esc(r.name || '')}</div>${r.floorName ? `<div class="b-ref-sub">所属フロア：${esc(r.floorName)}</div>` : ''}${isFloorRef ? (r.floorNote ? `<div class="b-ref-body">${esc(r.floorNote)}</div>` : '') : (r.desc ? `<div class="b-ref-body">${esc(r.desc)}</div>` : '')}${!isFloorRef && r.clue ? `<div class="b-ref-box">🔍 ${esc(r.clue)}</div>` : ''}</div>`;
  }
  if (b.type === 'timeline') {
    const e = b.refData || {};
    const chipLbl = { event: 'イベント', combat: '戦闘', reveal: '手がかり' }[e.tag] || 'イベント';
    return `<div class="b-ref b-ref-timeline${keepCls}"><div class="b-ref-lbl">⏰ 時系列参照</div><div class="b-ref-sub">${esc(e.time || '')}</div><div class="b-ref-name">${esc(e.title || '')}</div>${e.desc ? `<div class="b-ref-body">${esc(e.desc)}</div>` : ''}<span class="b-ref-sub">${chipLbl}</span></div>`;
  }
  if (b.type === 'plot') {
    const p = b.refData || {};
    const phaseNum = S.plots.findIndex(x => x.name === p.name);
    const items = (p.items || '').split('\n').filter(x => x.trim());
    return `<div class="b-ref b-ref-plot${keepCls}"><div class="b-ref-lbl">📋 プロット参照${phaseNum >= 0 ? ` — フェーズ ${phaseNum + 1}` : ''}</div><div class="b-ref-name">${esc(p.name || '')}</div>${p.goal ? `<div class="b-ref-sub">${esc(p.goal)}</div>` : ''}${items.map(it => `<div class="b-ref-plot-item">${esc(it)}</div>`).join('')}${p.note ? `<div class="b-ref-box">📌 ${esc(p.note)}</div>` : ''}</div>`;
  }
  return '';
}

function computeWriterPageBreakIndexes(sc) {
  if (!sc || !sc.blocks || !sc.blocks.length) return [];
  const root = ensurePdfGuideMeasureRoot();
  const flow = root.querySelector('#pdfMeasureFlow');
  if (!flow) return [];

  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = `<div class="scene-hd"><span class="scene-num">SCENE ${S.curScene + 1}</span><span class="scene-name">${esc(sc.name || '')}</span></div>`;
  sc.blocks.forEach((b, i) => {
    html += `<div class="pdf-measure-unit" data-idx="${i}">${buildPdfMeasureBlockHtml(b)}</div>`;
  });
  flow.innerHTML = html;

  const units = Array.from(flow.querySelectorAll('.pdf-measure-unit'));
  if (!units.length) return [];

  const sceneHeaderHeight = units[0].offsetTop;
  const footprints = units.map((el, i) => {
    if (i < units.length - 1) {
      return units[i + 1].offsetTop - el.offsetTop;
    }
    return el.getBoundingClientRect().height;
  });

  const breakIdxs = [];
  let used = sceneHeaderHeight;
  for (let i = 0; i < sc.blocks.length; i++) {
    const b = sc.blocks[i] || {};
    const h = footprints[i] || 0;

    if (b.type === 'pagebreak') {
      if (i + 1 < sc.blocks.length) breakIdxs.push(i + 1);
      used = 0;
      continue;
    }

    let unitHeight = h;
    if (b.keepWithNext && i + 1 < sc.blocks.length && sc.blocks[i + 1].type !== 'pagebreak') {
      unitHeight += footprints[i + 1] || 0;
      if (used > 0 && used + unitHeight > PDF_CONTENT_HEIGHT) {
        breakIdxs.push(i);
        used = unitHeight;
      } else {
        used += unitHeight;
      }
      i += 1;
      continue;
    }

    if (used > 0 && used + unitHeight > PDF_CONTENT_HEIGHT) {
      breakIdxs.push(i);
      used = unitHeight;
    } else {
      used += unitHeight;
    }
  }
  return Array.from(new Set(breakIdxs)).sort((a, b) => a - b);
}

function applyWriterPageMarkers() {
  const container = document.getElementById('blockList');
  if (container) container.querySelectorAll('.pdf-page-marker').forEach((el) => el.remove());
  const sc = S.scenes[S.curScene];
  if (!container || !sc || !sc.blocks || !sc.blocks.length) return;

  const blocks = Array.from(container.children).filter((el) => el.id && el.id.startsWith('blk-'));
  if (!blocks.length) return;

  const breakIdxs = computeWriterPageBreakIndexes(sc);
  breakIdxs.forEach((idx, order) => {
    const target = blocks[idx];
    if (!target) return;
    const marker = document.createElement('div');
    marker.className = 'pdf-page-marker';
    marker.textContent = `ここまでで ${order + 1} ページ`;
    container.insertBefore(marker, target);
  });
}

function scheduleWriterPageMarkers() {
  clearTimeout(_writerPageGuideTimer);
  _writerPageGuideTimer = setTimeout(applyWriterPageMarkers, 80);
}

function renderBlocks() {
  applyWritingTemplateVisuals();
  renderWritingModeUI();
  const sc = S.scenes[S.curScene];
  const container = document.getElementById('blockList');
  const writerBody = document.querySelector('.writer-body');
  const isVertical = S.writingMode === 'vertical';
  if (container) container.classList.toggle('is-vertical', isVertical);
  if (writerBody) writerBody.classList.toggle('vertical-mode', isVertical);
  renderBlockFilterUI(sc);

  if (!sc || !sc.blocks || !sc.blocks.length) {
    const td = isTrpgMode()
      ? { emptyTitle: '「ブロック追加」で執筆を始めましょう', emptySub: '場面描写・セリフ・ゲーム処理、または参照挿入からデータを埋め込めます' }
      : getWritingTemplateDef();
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📝</div><p>${td.emptyTitle}</p><p style="font-size:11px;margin-top:4px">${td.emptySub}</p></div>`;
    return;
  }

  const visibleIndexes = [];
  sc.blocks.forEach((b, i) => {
    if (isBlockVisibleByFilter(b)) visibleIndexes.push(i);
  });

  if (!visibleIndexes.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔎</div><p>フィルター条件に一致するブロックがありません</p><p style="font-size:11px;margin-top:4px">条件を変更するか、フィルター解除を実行してください</p><button class="btn btn-sm" style="margin-top:8px" onclick="clearBlockFilters()">フィルター解除</button></div>`;
    return;
  }

  const grip = `<span class="blk-drag-handle" title="ドラッグして並び替え"
    onmousedown="event.stopPropagation()"
    ondragstart="event.stopPropagation()">
    <span class="grip-dots"><span></span><span></span><span></span><span></span><span></span><span></span></span>
  </span>`;
  container.innerHTML = visibleIndexes.map((i) => {
    const b = sc.blocks[i];
    // ブロック自体はdraggable=falseにして、ハンドル経由のみ許可
    const dndAttrs = `draggable="false"
      ondragover="blkDragOver(event,${i})"
      ondragleave="blkDragLeave(event,${i})"
      ondrop="blkDrop(event,${i})"
      ondragend="blkDragEnd()"`;
    const handleAttrs = `draggable="true"
      ondragstart="blkDragStart(event,${i})"
      ondragend="blkDragEnd()"`;
    const keepBtn = `<button class="block-keep-btn${b.keepWithNext ? ' active' : ''}" onclick="event.stopPropagation();toggleKeepWithNext(${i})" title="次のブロックと同じページに配置">⛓ 次と一体</button>`;
    if (b.type === 'pagebreak') {
      const selCls = b.sel ? ' sel' : '';
      const gripH = `<span class="blk-drag-handle" title="ドラッグして並び替え" ${handleAttrs}><span class="grip-dots"><span></span><span></span><span></span><span></span><span></span><span></span></span></span>`;
      return `<div class="writing-block block-pagebreak${selCls}" id="blk-${i}" ${dndAttrs} onclick="selectBlock(${i})">
        <div class="block-type-row">${gripH}📄 改ページ（次ページへ）
          <button class="block-del" onclick="event.stopPropagation();removeBlock(${i})" title="このブロックを削除">✕</button>
        </div>
        <div class="pagebreak-note">PDF出力時、この位置で次のページへ送ります。</div>
      </div>`;
    }
    if (['artifact','map','timeline','plot'].includes(b.type)) {
      const selCls = b.sel ? ' sel' : '';
      const inner = b.type==='artifact' ? renderRefArtifact(b) : b.type==='map' ? renderRefMap(b) : b.type==='timeline' ? renderRefTimeline(b) : renderRefPlot(b);
      const typeLabels = { artifact:'📦 アイテム参照', map:'🗺 マップ参照', timeline:'⏰ 時系列参照', plot:'📋 プロット参照' };
      const gripH = `<span class="blk-drag-handle" title="ドラッグして並び替え" ${handleAttrs}><span class="grip-dots"><span></span><span></span><span></span><span></span><span></span><span></span></span></span>`;
      return `<div class="block-ref block-ref-${b.type}${selCls}" id="blk-${i}" ${dndAttrs} onclick="selectBlock(${i})">
        <div class="ref-type-row">${gripH}${typeLabels[b.type]||''}
          <span style="margin-left:auto"></span>
          ${keepBtn}
          <button class="ref-del" style="margin-left:6px" onclick="event.stopPropagation();removeBlock(${i})" title="削除">✕</button>
        </div>${inner}</div>`;
    }
    const labels = isTrpgMode()
      ? { scene: '👁 場面描写', dialog: '💬 セリフ', game: '🎲 ゲーム処理' }
      : getWritingTemplateDef().blockTypeLabels;
    const speakerRow = b.type === 'dialog' ? buildSpeakerRow(b, i) : '';
    const gripH = `<span class="blk-drag-handle" title="ドラッグして並び替え" ${handleAttrs}><span class="grip-dots"><span></span><span></span><span></span><span></span><span></span><span></span></span></span>`;
    return `<div class="writing-block block-${b.type} ${b.sel?'sel':''}" id="blk-${i}" ${dndAttrs} onclick="selectBlock(${i})">
      <div class="block-type-row">${gripH}${labels[b.type]||''}
        <span style="margin-left:auto"></span>
        ${keepBtn}
        <button class="block-del" style="margin-left:6px" onclick="event.stopPropagation();removeBlock(${i})" title="このブロックを削除">✕</button>
      </div>
      ${speakerRow}
      <textarea class="block-textarea" rows="3" placeholder="ここに入力..." oninput="updateBlock(${i},'content',this.value);autoGrowBlockTextarea(this)">${h(b.content||'')}</textarea>
    </div>`;
  }).join('');
  // カラーを各ダイアログブロックに適用
  sc.blocks.forEach((b, i) => {
    if (b.type === 'dialog') {
      const el = document.getElementById(`blk-${i}`);
      if (el) applyBlockColor(el, b);
    }
  });
  container.querySelectorAll('.block-textarea').forEach(autoGrowBlockTextarea);
  if (isVertical || S.blockFilterType !== 'all' || S.blockFilterSpeaker !== 'all') {
    container.querySelectorAll('.pdf-page-marker').forEach((el) => el.remove());
  } else {
    scheduleWriterPageMarkers();
  }
  // ポップオーバーを外クリックで閉じる
  document.addEventListener('click', () => {
    document.querySelectorAll('.color-popover.open').forEach(p => p.classList.remove('open'));
    document.getElementById('insertDropdown')?.classList.remove('open');
  }, { once: true });
}

// ======= 参照ブロック描画 =======
const REF_ART_ICONS = ['📖','🗝','🗿','💀','🔮','🧿','📿','🪬','⚗️'];
const MAP_REF_IMAGE_CACHE = {};
const MAP_REF_IMAGE_LOADING = new Set();

function getFloorMapImageCache(floorId) {
  if (!floorId) return null;
  return MAP_REF_IMAGE_CACHE[floorId] || null;
}

async function ensureFloorMapImageCache(floorId) {
  if (!floorId) return null;
  if (MAP_REF_IMAGE_CACHE[floorId]) return MAP_REF_IMAGE_CACHE[floorId];
  const img = await generateFloorDataUrl(floorId);
  if (img) MAP_REF_IMAGE_CACHE[floorId] = img;
  return img || null;
}

function buildMapRefImageHtml(refData) {
  const floorId = refData?.floorId;
  const img = getFloorMapImageCache(floorId);
  if (img) {
    return `<img class="ref-map-img" src="${img}" alt="${h((refData?.name||'場所'))} のマップ">`;
  }
  return '<div class="ref-map-img-placeholder">マップ画像を生成中…</div>';
}
function renderRefBlock(b, i) {
  const selCls = b.sel ? ' sel' : '';
  let inner = '';
  switch(b.type) {
    case 'artifact': inner = renderRefArtifact(b); break;
    case 'map':      inner = renderRefMap(b); break;
    case 'timeline': inner = renderRefTimeline(b); break;
    case 'plot':     inner = renderRefPlot(b); break;
  }
  const typeLabels = { artifact:'📦 アイテム参照', map:'🗺 マップ参照', timeline:'⏰ 時系列参照', plot:'📋 プロット参照' };
  return `<div class="block-ref block-ref-${b.type}${selCls}" id="blk-${i}" onclick="selectBlock(${i})">
    <div class="ref-type-row">
      ${typeLabels[b.type]||''}
      <button class="ref-del" onclick="event.stopPropagation();removeBlock(${i})" title="削除">✕</button>
    </div>
    ${inner}
  </div>`;
}

function renderRefArtifact(b) {
  const a = b.refData || {};
  const idx = (S.artifacts.findIndex(x=>x.name===a.name)+9) % 9;
  const icon = REF_ART_ICONS[idx] || '📦';
  return `<div class="ref-art-header">
    <div class="ref-art-icon">${icon}</div>
    <div>
      <div class="ref-art-name">${h(a.name||'(不明)')}</div>
      <div class="ref-art-type">${h(a.type||'')}</div>
    </div>
  </div>
  ${a.desc ? `<div class="ref-art-body">${h(a.desc)}</div>` : ''}
  ${a.san ? `<span class="ref-san">🧠 影響 ${h(a.san)}</span>` : ''}
  ${a.req ? `<div style="font-size:11px;color:var(--text-hint);margin-top:6px">使用条件：${h(a.req)}</div>` : ''}
  ${a.effect ? `<div class="ref-effect">${h(a.effect)}</div>` : ''}`;
}

function renderRefMap(b) {
  const r = b.refData || {};
  const floorId = r.floorId;
  const isFloorRef = r.refKind === 'floor';
  if (floorId && b.id && !getFloorMapImageCache(floorId) && !MAP_REF_IMAGE_LOADING.has(b.id)) {
    MAP_REF_IMAGE_LOADING.add(b.id);
    ensureFloorMapImageCache(floorId)
      .then(() => { if (document.getElementById('blockList')) renderBlocks(); })
      .finally(() => MAP_REF_IMAGE_LOADING.delete(b.id));
  }
  return `<div class="ref-map-name">${isFloorRef ? '🗺' : '🚪'} ${h(r.name||'(不明)')}</div>
  <div class="ref-map-meta"><span class="ref-kind-badge ${isFloorRef ? 'floor' : 'room'}">${isFloorRef ? 'フロアデータ' : '部屋データ'}</span>${r.floorName ? `<span>所属フロア：${h(r.floorName)}</span>` : ''}</div>
  ${floorId ? buildMapRefImageHtml(r) : ''}
  ${isFloorRef ? (r.floorNote ? `<div class="ref-map-desc">${h(r.floorNote)}</div>` : '') : (r.desc ? `<div class="ref-map-desc">${h(r.desc)}</div>` : '')}
  ${!isFloorRef && r.clue ? `<div class="ref-map-clue">🔍 ${h(r.clue)}</div>` : ''}`;
}

function renderRefTimeline(b) {
  const e = b.refData || {};
  const chipMap = { event:['rtc-event','イベント'], combat:['rtc-combat','戦闘'], reveal:['rtc-reveal','手がかり'] };
  const [cls, lbl] = chipMap[e.tag] || chipMap.event;
  return `<div class="ref-tl-when">${h(e.time||'')}</div>
  <div class="ref-tl-title">${h(e.title||'(不明)')}</div>
  ${e.desc ? `<div class="ref-tl-desc">${h(e.desc)}</div>` : ''}
  <span class="ref-tl-chip ${cls}">${lbl}</span>`;
}

function renderRefPlot(b) {
  const p = b.refData || {};
  const phaseNum = S.plots.findIndex(x=>x.name===p.name);
  const items = (p.items||'').split('\n').filter(x=>x.trim());
  return `<div class="ref-plot-phase">${phaseNum >= 0 ? `フェーズ ${phaseNum+1}` : 'フェーズ'}</div>
  <div class="ref-plot-name">${h(p.name||'(不明)')}</div>
  ${p.goal ? `<div class="ref-plot-goal">${h(p.goal)}</div>` : ''}
  <div class="ref-plot-items">${items.slice(0,4).map(it=>`<div class="ref-plot-item">${h(it)}</div>`).join('')}${items.length>4?`<div style="font-size:11px;color:var(--text-hint);padding-left:15px">…他${items.length-4}件</div>`:''}</div>
  ${p.note ? `<div class="ref-plot-note">📌 ${h(p.note)}</div>` : ''}`;
}

// ======= 参照挿入メニュー =======
function toggleInsertMenu(e) {
  e.stopPropagation();
  document.getElementById('insertDropdown').classList.toggle('open');
}

let _pickerType = null;
let _pickerItems = [];

function buildMapRefItems() {
  const floors = (S.floors || []).slice();
  const rooms = (S.rooms || []).slice();

  if (!floors.length && !rooms.length) return [];

  const floorOrder = floors.map(f => f.id);
  const roomGroups = {};
  rooms.forEach(r => {
    const fid = r.floorId || '__no_floor__';
    if (!roomGroups[fid]) roomGroups[fid] = [];
    roomGroups[fid].push(r);
  });

  const result = [];
  floors.forEach(fl => {
    result.push({
      refKind: 'floor',
      floorId: fl.id,
      floorName: fl.name || '(フロア名なし)',
      floorType: fl.type || 'indoor',
      floorNote: fl.note || '',
    });
    const inFloor = roomGroups[fl.id] || [];
    inFloor.forEach(r => {
      result.push({
        refKind: 'room',
        roomId: r.id,
        floorId: fl.id,
        floorName: fl.name || '(フロア名なし)',
        floorType: fl.type || 'indoor',
        name: r.name || '(場所名なし)',
        num: r.num || '',
        desc: r.desc || '',
        clue: r.clue || '',
        kp: r.kp || '',
      });
    });
    delete roomGroups[fl.id];
  });

  if (roomGroups.__no_floor__) {
    result.push({
      refKind: 'floor',
      floorId: '',
      floorName: '未割当フロア',
      floorType: 'indoor',
      floorNote: '',
    });
    roomGroups.__no_floor__.forEach(r => {
      result.push({
        refKind: 'room',
        roomId: r.id,
        floorId: '',
        floorName: '未割当フロア',
        floorType: 'indoor',
        name: r.name || '(場所名なし)',
        num: r.num || '',
        desc: r.desc || '',
        clue: r.clue || '',
        kp: r.kp || '',
      });
    });
  }

  return result;
}

function renderMapRefPickerList(items) {
  let currentFloor = null;
  return items.map((item, i) => {
    const floorChanged = currentFloor !== item.floorName;
    if (floorChanged) currentFloor = item.floorName;
    const floorIcon = item.floorType === 'outdoor' ? '🌿' : '🏠';
    const head = floorChanged ? `<div class="ref-picker-group-hd">${floorIcon} ${h(item.floorName || '(フロア名なし)')}</div>` : '';
    if (item.refKind === 'floor') {
      const floorTypeLabel = item.floorType === 'outdoor' ? '屋外' : '屋内';
      const summary = item.floorNote
        ? `差し込み内容：フロア名・種別・メモ・マップ画像`
        : `差し込み内容：フロア名・種別・マップ画像`;
      return `${head}<div class="ref-picker-item" onclick="insertRefBlock(${i})">
        <div class="ref-picker-item-name"><span class="ref-kind-badge floor">フロアデータ</span> ${h(item.floorName || '(フロア名なし)')}</div>
        <div class="ref-picker-item-sub">種別：${floorTypeLabel}${item.floorNote ? ` ／ メモ：${h(item.floorNote.slice(0, 60))}${item.floorNote.length > 60 ? '…' : ''}` : ''}</div>
        <div class="ref-picker-item-sub ref-picker-item-insert">${summary}</div>
      </div>`;
    }
    const roomSummary = `差し込み内容：部屋名・説明・手がかり・所属フロア・マップ画像`;
    const roomMeta = [item.num ? `調査番号：${h(item.num)}` : '', item.desc ? h(item.desc.slice(0, 48)) + (item.desc.length > 48 ? '…' : '') : '説明なし']
      .filter(Boolean).join(' ／ ');
    return `${head}<div class="ref-picker-item" onclick="insertRefBlock(${i})">
      <div class="ref-picker-item-name"><span class="ref-kind-badge room">部屋データ</span> ${h(item.name || '(場所名なし)')}</div>
      <div class="ref-picker-item-sub">${roomMeta}</div>
      <div class="ref-picker-item-sub ref-picker-item-insert">${roomSummary}</div>
    </div>`;
  }).join('');
}

function openRefPicker(type) {
  _pickerType = type;
  document.getElementById('insertDropdown').classList.remove('open');
  const titles = { artifact:'アイテムを選択', map:'マップ／場所を選択', timeline:'時系列イベントを選択', plot:'プロットフェーズを選択' };
  document.getElementById('refPickerTitle').textContent = titles[type] || '参照先を選択';
  const list = document.getElementById('refPickerList');
  _pickerItems = getRefItems(type);
  if (!_pickerItems.length) {
    list.innerHTML = `<div class="ref-picker-empty">📭 登録データがありません。<br>先に${titles[type].replace('を選択','')}タブで追加してください。</div>`;
  } else {
    if (type === 'map') {
      list.innerHTML = renderMapRefPickerList(_pickerItems);
    } else {
      list.innerHTML = _pickerItems.map((item, i) => {
        const { primary, secondary } = getRefItemLabels(type, item);
        return `<div class="ref-picker-item" onclick="insertRefBlock(${i})">
          <div class="ref-picker-item-name">${h(primary)}</div>
          ${secondary ? `<div class="ref-picker-item-sub">${h(secondary)}</div>` : ''}
        </div>`;
      }).join('');
    }
  }
  document.getElementById('refPickerOverlay').classList.add('open');
}

function getRefItems(type) {
  if (type === 'artifact') return S.artifacts;
  if (type === 'map') return buildMapRefItems();
  if (type === 'timeline') return S.timeline;
  if (type === 'plot') return S.plots;
  return [];
}

function getRefItemLabels(type, item) {
  if (type === 'artifact') return { primary: item.name, secondary: [item.type, item.san?`影響:${item.san}`:''].filter(Boolean).join(' ／ ') };
  if (type === 'map') {
    if (item.refKind === 'floor') {
      return { primary: `フロア：${item.floorName}`, secondary: `${item.floorType === 'outdoor' ? '屋外' : '屋内'} ／ 差し込み: フロア情報` };
    }
    return { primary: `部屋：${item.name}`, secondary: `差し込み: 部屋情報 ／ 所属フロア ${item.floorName}` };
  }
  if (type === 'timeline') return { primary: item.title, secondary: [item.time, {event:'イベント',combat:'戦闘',reveal:'手がかり'}[item.tag]].filter(Boolean).join(' — ') };
  if (type === 'plot') return { primary: item.name, secondary: item.goal || '' };
  return { primary: '', secondary: '' };
}

async function insertRefBlock(itemIdx) {
  const picked = _pickerItems[itemIdx];
  if (!picked) return;
  let refData = { ...picked };
  if (_pickerType === 'map') {
    if (picked.refKind === 'floor') {
      refData = {
        refKind: 'floor',
        floorId: picked.floorId || '',
        floorName: picked.floorName || '(フロア名なし)',
        floorType: picked.floorType || 'indoor',
        floorNote: picked.floorNote || '',
        name: picked.floorName || '(フロア名なし)',
      };
    } else {
      refData = {
        refKind: 'room',
        roomId: picked.roomId,
        floorId: picked.floorId || '',
        floorName: picked.floorName || '',
        floorType: picked.floorType || 'indoor',
        name: picked.name || '(場所名なし)',
        num: picked.num || '',
        desc: picked.desc || '',
        clue: picked.clue || '',
        kp: picked.kp || '',
      };
    }
    const floorId = refData.floorId;
    if (floorId) {
      const fl = S.floors.find(f => f.id === floorId);
      if (fl) {
        refData.floorName = fl.name || '';
        refData.floorType = fl.type || 'indoor';
      }
      const img = await ensureFloorMapImageCache(floorId);
      if (img) refData.floorMapImage = img;
    }
  }
  const sc = S.scenes[S.curScene];
  if (!sc.blocks) sc.blocks = [];
  sc.blocks.push({ id: uid(), type: _pickerType, refData });
  closeRefPicker();
  renderBlocks();
  setTimeout(scrollWriterToNewestBlock, 50);
}

function closeRefPicker() {
  document.getElementById('refPickerOverlay').classList.remove('open');
  _pickerType = null;
  _pickerItems = [];
}

function addBlock() {
  const sc = S.scenes[S.curScene];
  if (!sc.blocks) sc.blocks = [];
  if (S.blockType === 'dialog') {
    sc.blocks.push({ id: uid(), type: 'dialog', content: '', speaker: '', keepWithNext: false });
  } else if (S.blockType === 'pagebreak') {
    sc.blocks.push({ id: uid(), type: 'pagebreak' });
  } else {
    sc.blocks.push({ id: uid(), type: S.blockType, content: '', keepWithNext: false });
  }
  renderBlocks();
  setTimeout(scrollWriterToNewestBlock, 50);
  markDirty();
}

function scrollWriterToNewestBlock() {
  const container = document.getElementById('blockList');
  if (!container) return;
  if ((S.writingMode || 'horizontal') === 'vertical') {
    container.scrollTo({ left: 0, behavior: 'smooth' });
    return;
  }
  container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
}

function toggleKeepWithNext(i) {
  const b = S.scenes[S.curScene].blocks[i];
  if (!b || b.type === 'pagebreak') return;
  b.keepWithNext = !b.keepWithNext;
  renderBlocks();
  markDirty();
}

function updateBlock(i, field, val) { S.scenes[S.curScene].blocks[i][field] = val; markDirty(); scheduleWriterPageMarkers(); }
function removeBlock(i) { S.scenes[S.curScene].blocks.splice(i, 1); renderBlocks(); markDirty(); }
function selectBlock(i) {
  S.scenes[S.curScene].blocks.forEach((b, j) => b.sel = j === i);
  document.querySelectorAll('.writing-block, .block-ref').forEach((el) => {
    const idx = Number((el.id || '').replace('blk-', ''));
    el.classList.toggle('sel', idx === i);
  });
}

// ======= DRAG & DROP — シーン並び替え =======
let _sceneDrag = null;  // ドラッグ中のインデックス

function sceneDragStart(e, i) {
  _sceneDrag = i;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', i);
  setTimeout(() => document.getElementById(`sc-${i}`)?.classList.add('dnd-ghost'), 0);
}

function sceneDragOver(e, i) {
  if (_sceneDrag === null || _sceneDrag === i) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  // どちら半分かで上下ラインを切り替え
  const el = document.getElementById(`sc-${i}`);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const half = e.clientY < rect.top + rect.height / 2;
  el.classList.toggle('dnd-over-top',    half);
  el.classList.toggle('dnd-over-bottom', !half);
}

function sceneDragLeave(e, i) {
  const el = document.getElementById(`sc-${i}`);
  el?.classList.remove('dnd-over-top', 'dnd-over-bottom');
}

function sceneDrop(e, i) {
  e.preventDefault();
  if (_sceneDrag === null || _sceneDrag === i) return;
  const el = document.getElementById(`sc-${i}`);
  const rect = el?.getBoundingClientRect();
  const insertAfter = rect ? e.clientY >= rect.top + rect.height / 2 : false;

  // 配列を組み替える
  const moved = S.scenes.splice(_sceneDrag, 1)[0];
  let target = i > _sceneDrag ? i - 1 : i; // splice後のズレを補正
  if (insertAfter) target += 1;
  S.scenes.splice(target, 0, moved);

  // curSceneも追従
  S.curScene = target;
  _sceneDrag = null;
  renderScenes(); renderBlocks(); markDirty();
}

function sceneDragEnd() {
  _sceneDrag = null;
  document.querySelectorAll('.scene-item').forEach(el =>
    el.classList.remove('dnd-ghost', 'dnd-over-top', 'dnd-over-bottom')
  );
}

// ======= DRAG & DROP — ブロック並び替え =======
let _blkDrag = null;  // ドラッグ中のブロックインデックス

function blkDragStart(e, i) {
  _blkDrag = i;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', i);
  setTimeout(() => document.getElementById(`blk-${i}`)?.classList.add('blk-dnd-ghost'), 0);
}

function blkDragOver(e, i) {
  if (_blkDrag === null || _blkDrag === i) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const el = document.getElementById(`blk-${i}`);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const half = e.clientY < rect.top + rect.height / 2;
  el.classList.toggle('blk-dnd-over-top',    half);
  el.classList.toggle('blk-dnd-over-bottom', !half);
}

function blkDragLeave(e, i) {
  const el = document.getElementById(`blk-${i}`);
  el?.classList.remove('blk-dnd-over-top', 'blk-dnd-over-bottom');
}

function blkDrop(e, i) {
  e.preventDefault();
  if (_blkDrag === null || _blkDrag === i) return;
  const el = document.getElementById(`blk-${i}`);
  const rect = el?.getBoundingClientRect();
  const insertAfter = rect ? e.clientY >= rect.top + rect.height / 2 : false;

  const blocks = S.scenes[S.curScene].blocks;
  const moved = blocks.splice(_blkDrag, 1)[0];
  let target = i > _blkDrag ? i - 1 : i;
  if (insertAfter) target += 1;
  blocks.splice(target, 0, moved);

  _blkDrag = null;
  renderBlocks(); markDirty();
}

function blkDragEnd() {
  _blkDrag = null;
  document.querySelectorAll('.writing-block,.block-ref').forEach(el =>
    el.classList.remove('blk-dnd-ghost', 'blk-dnd-over-top', 'blk-dnd-over-bottom')
  );
}


// ======= NPC SKILL PRESETS =======
// ======= 技能プリセット（版別） =======
const SKILL_PRESETS_7TH = [
  { group:'🗣 社会・対話', items:[
    {name:'言いくるめ',base:5},{name:'信用',base:15},{name:'説得',base:15},{name:'値切り',base:5},
    {name:'母国語',base:null,baseNote:'EDU'},{name:'他国語',base:1},{name:'威圧',base:15},{name:'魅惑',base:15},
  ]},
  { group:'🔍 探索・知覚', items:[
    {name:'目星',base:25},{name:'聞き耳',base:25},{name:'追跡',base:10},{name:'忍び歩き',base:20},
    {name:'隠れる',base:20},{name:'図書館',base:20},{name:'ナビゲート',base:10},{name:'写真術',base:10},
    {name:'心理学',base:10},{name:'精神分析',base:1},
  ]},
  { group:'🔬 学問・知識', items:[
    {name:'医学',base:5},{name:'薬学',base:1},{name:'生物学',base:1},{name:'地質学',base:1},
    {name:'物理学',base:1},{name:'化学',base:1},{name:'天文学',base:1},{name:'考古学',base:1},
    {name:'人類学',base:1},{name:'歴史',base:5},{name:'法律',base:5},{name:'オカルト',base:5},
    {name:'クトゥルフ神話',base:0},{name:'コンピューター',base:5},{name:'電子工学',base:1},
  ]},
  { group:'⚔️ 戦闘・身体', items:[
    {name:'回避',base:null,baseNote:'DEX÷2'},{name:'格闘（近接）',base:25},{name:'こぶし',base:50},
    {name:'キック',base:25},{name:'頭突き',base:10},{name:'組み付き',base:25},
    {name:'拳銃',base:20},{name:'ライフル/散弾銃',base:25},{name:'短機関銃',base:15},
    {name:'機関銃',base:10},{name:'投擲',base:20},{name:'弓',base:15},
    {name:'刃物（短刀）',base:25},{name:'刃物（大型）',base:20},{name:'チェーンソー',base:10},
  ]},
  { group:'🔧 技術・運動', items:[
    {name:'応急手当',base:30},{name:'電気修理',base:10},{name:'機械修理',base:10},
    {name:'鍵開け',base:1},{name:'爆発物',base:1},{name:'変装',base:5},
    {name:'手さばき',base:10},{name:'早業',base:10},{name:'乗馬',base:5},
    {name:'運転（自動車）',base:20},{name:'操縦（飛行機）',base:1},{name:'操縦（船舶）',base:1},
    {name:'水泳',base:20},{name:'跳躍',base:20},{name:'登攀',base:20},{name:'武道',base:1},
  ]},
  { group:'🎨 芸術・技芸', items:[
    {name:'芸術（絵画）',base:5},{name:'芸術（音楽）',base:5},{name:'芸術（執筆）',base:5},
    {name:'芸術（演技）',base:5},{name:'工芸',base:5},
  ]},
  { group:'👹 怪物・特殊', items:[
    {name:'超自然的な感知',base:null},{name:'精神汚染攻撃',base:null},{name:'恐怖オーラ',base:null},
    {name:'再生',base:null},{name:'テレパシー',base:null},{name:'次元跳躍',base:null},
    {name:'物質透過',base:null},{name:'毒（噛みつき）',base:null},{name:'締めつけ',base:null},{name:'飛行',base:null},
  ]},
];

const SKILL_PRESETS_6TH = [
  { group:'🗣 社会・対話', items:[
    {name:'言いくるめ',base:5},{name:'信用',base:15},{name:'説得',base:15},{name:'値切り',base:5},
    {name:'母国語',base:null,baseNote:'EDU×5'},{name:'他国語',base:1},{name:'威圧',base:15},{name:'魅惑',base:15},
  ]},
  { group:'🔍 探索・知覚', items:[
    {name:'目星',base:25},{name:'聞き耳',base:25},{name:'追跡',base:10},{name:'忍び歩き',base:10},
    {name:'隠れる',base:10},{name:'図書館',base:25},{name:'ナビゲート',base:10},{name:'写真術',base:10},
    {name:'心理学',base:5},{name:'精神分析',base:1},
  ]},
  { group:'🔬 学問・知識', items:[
    {name:'医学',base:5},{name:'薬学',base:1},{name:'生物学',base:1},{name:'地質学',base:1},
    {name:'物理学',base:1},{name:'化学',base:1},{name:'天文学',base:1},{name:'考古学',base:1},
    {name:'人類学',base:1},{name:'歴史',base:20},{name:'法律',base:5},{name:'オカルト',base:5},
    {name:'クトゥルフ神話',base:0},
  ]},
  { group:'⚔️ 戦闘・身体', items:[
    {name:'回避',base:null,baseNote:'DEX×5'},{name:'格闘（近接）',base:25},{name:'こぶし',base:50},
    {name:'キック',base:25},{name:'頭突き',base:10},{name:'組み付き',base:25},
    {name:'拳銃',base:20},{name:'ライフル',base:25},{name:'散弾銃',base:30},
    {name:'短機関銃',base:15},{name:'機関銃',base:15},{name:'投擲',base:25},{name:'弓',base:15},
  ]},
  { group:'🔧 技術・運動', items:[
    {name:'応急手当',base:30},{name:'電気修理',base:10},{name:'機械修理',base:20},
    {name:'鍵開け',base:1},{name:'爆発物',base:1},{name:'コンピューター',base:1},{name:'電子工学',base:1},
    {name:'運転（自動車）',base:20},{name:'操縦（飛行機）',base:1},
    {name:'水泳',base:25},{name:'飛び越え',base:25},{name:'登攀',base:40},{name:'跳躍',base:25},
    {name:'変装',base:1},{name:'手さばき',base:10},{name:'早業',base:10},
  ]},
  { group:'🎨 芸術・技芸', items:[
    {name:'芸術（絵画）',base:5},{name:'芸術（音楽）',base:5},{name:'芸術（執筆）',base:5},{name:'工芸',base:5},
  ]},
  { group:'👹 怪物・特殊', items:[
    {name:'超自然的な感知',base:null},{name:'精神汚染攻撃',base:null},{name:'恐怖オーラ',base:null},
    {name:'再生',base:null},{name:'テレパシー',base:null},{name:'次元跳躍',base:null},{name:'物質透過',base:null},
  ]},
];

function getSkillPresets() {
  return _npcEdition === '6th' ? SKILL_PRESETS_6TH : SKILL_PRESETS_7TH;
}

let _editSkills = [];
let _skillPresetOpen = true;

function switchNpcTab(tab) {
  ['basic','stats','skills','memo'].forEach(t => {
    document.getElementById('nmtab-'+t)?.classList.toggle('active', t===tab);
    document.getElementById('nmtp-'+t)?.classList.toggle('active', t===tab);
  });
  if (tab === 'skills') renderSkillList();
}

// ======= エディション管理 =======
let _npcEdition = '7th'; // '7th' | '6th'

// ── MOV算出（第7版・6版共通） ──
function calcMov(str, dex, siz) {
  if (!str || !dex || !siz) return null;
  if (str < siz && dex < siz) return 7;
  if (str > siz && dex > siz) return 9;
  return 8;
}

// ── DB/Build算出（第7版） ──
function calcDbBuild(strSiz) {
  if      (strSiz <=  64) return { db:'-2',    build:-2 };
  else if (strSiz <=  84) return { db:'-1',    build:-1 };
  else if (strSiz <= 124) return { db:'0',     build: 0 };
  else if (strSiz <= 164) return { db:'+1D4',  build: 1 };
  else if (strSiz <= 204) return { db:'+1D6',  build: 2 };
  else if (strSiz <= 284) return { db:'+2D6',  build: 3 };
  else if (strSiz <= 364) return { db:'+3D6',  build: 4 };
  else                    return { db:'+4D6',  build: 5 };
}

// ── 6版 DB テーブル ──
function calcDbBuild6th(strSiz) {
  if      (strSiz <=  12) return '-1D6';
  else if (strSiz <=  16) return '-1D4';
  else if (strSiz <=  24) return '0';
  else if (strSiz <=  32) return '+1D4';
  else if (strSiz <=  40) return '+1D6';
  else if (strSiz <=  56) return '+2D6';
  else if (strSiz <=  72) return '+3D6';
  else if (strSiz <=  88) return '+4D6';
  else                    return '+5D6';
}

// ── 6版・7版の定義 ──
const EDITION_DEF = {
  '7th': {
    label: '第7版（2016〜）',
    badge: '7th Edition',
    badgeClass: 'badge-7th',
    btnActive: 'active-7th',
    // 基本能力値
    stats: [
      { id:'npcStr', label:'STR', sub:'筋力',    dice:'3D6×5',   note:'3〜18 → ×5' },
      { id:'npcCon', label:'CON', sub:'体力',    dice:'3D6×5',   note:'' },
      { id:'npcDex', label:'DEX', sub:'敏捷性',  dice:'3D6×5',   note:'' },
      { id:'npcApp', label:'APP', sub:'外見',    dice:'3D6×5',   note:'' },
      { id:'npcPow', label:'POW', sub:'精神力',  dice:'3D6×5',   note:'' },
      { id:'npcSiz', label:'SIZ', sub:'体格',    dice:'(2D6+6)×5', note:'' },
      { id:'npcInt', label:'INT', sub:'知性',    dice:'(2D6+6)×5', note:'' },
      { id:'npcEdu', label:'EDU', sub:'教育',    dice:'(2D6+6)×5', note:'' },
    ],
    // 派生値
    derived: [
      { id:'npcHp',    label:'HP',   sub:'耐久力',   formula:'(CON+SIZ)÷10' },
      { id:'npcMp',    label:'MP',   sub:'魔術点',   formula:'POW÷5' },
      { id:'npcSan',   label:'SAN',  sub:'正気度',   formula:'POW' },
      { id:'npcLuck',  label:'幸運',  sub:'Luck',    formula:'3D6×5（別ロール）', isText:false },
      { id:'npcDb',    label:'DB',   sub:'ダメボ',   formula:'STR+SIZテーブル', isText:true },
      { id:'npcBuild', label:'ビルド', sub:'Build',   formula:'STR+SIZテーブル' },
      { id:'npcMov',   label:'MOV',  sub:'移動力',   formula:'STR/DEX/SIZ比較' },
    ],
    // 算出式
    formulas: [
      { key:'HP',    val:'(CON + SIZ) ÷ 10（端数切捨）' },
      { key:'MP',    val:'POW ÷ 5（端数切捨）' },
      { key:'SAN',   val:'POW（初期値）　最大値 = 99 − クトゥルフ神話技能' },
      { key:'幸運',   val:'3D6 × 5（作成時のみ別ロール。NPCは任意設定）' },
      { key:'DB/Build', val:'STR+SIZ 2〜64:−2 | 65〜84:−1 | 85〜124:0 | 125〜164:+1D4/+1 | 165〜204:+1D6/+2 | 205〜284:+2D6/+3…' },
      { key:'MOV',   val:'STR＜SIZ かつ DEX＜SIZ → 7　|　STR＞SIZ かつ DEX＞SIZ → 9　|　その他 → 8（年齢補正：40代−1、50代−2、60代−3、70代−4）' },
    ],
    // 自動計算ロジック
    calc(g, s, force) {
      const str=g('npcStr'), con=g('npcCon'), pow=g('npcPow');
      const dex=g('npcDex'), siz=g('npcSiz');
      if(con && siz)  s('npcHp',  Math.floor((con+siz)/10), force);
      if(pow)         s('npcMp',  Math.floor(pow/5),        force);
      if(pow)         s('npcSan', pow,                      force);
      if(str && siz){ const {db,build}=calcDbBuild(str+siz); s('npcDb',db,force); s('npcBuild',build,force); }
      const mov=calcMov(str,dex,siz); if(mov!==null) s('npcMov',mov,force);
    },
    // 技能基本値（能力値依存）
    skillBases(stats) {
      const edu=stats.edu||0, dex=stats.dex||0, str=stats.str||0, int_=stats.int||0;
      return {
        '母国語':        edu || null,
        '回避':          dex ? Math.floor(dex/2) : null,
        '格闘（近接）':  25,
        'こぶし':        50,
      };
    },
  },
  '6th': {
    label: '第6版（旧版）',
    badge: '6th Edition',
    badgeClass: 'badge-6th',
    btnActive: 'active-6th',
    stats: [
      { id:'npcStr', label:'STR', sub:'筋力',    dice:'3D6',    note:'3〜18' },
      { id:'npcCon', label:'CON', sub:'体力',    dice:'3D6',    note:'' },
      { id:'npcDex', label:'DEX', sub:'敏捷性',  dice:'3D6',    note:'' },
      { id:'npcApp', label:'APP', sub:'外見',    dice:'3D6',    note:'' },
      { id:'npcPow', label:'POW', sub:'精神力',  dice:'3D6',    note:'' },
      { id:'npcSiz', label:'SIZ', sub:'体格',    dice:'2D6+6',  note:'' },
      { id:'npcInt', label:'INT', sub:'知性',    dice:'2D6+6',  note:'' },
      { id:'npcEdu', label:'EDU', sub:'教育',    dice:'3D6+3',  note:'' },
    ],
    derived: [
      { id:'npcHp',    label:'HP',   sub:'耐久力',   formula:'(CON+SIZ)÷2' },
      { id:'npcMp',    label:'MP',   sub:'魔力',     formula:'POW' },
      { id:'npcSan',   label:'SAN',  sub:'正気度',   formula:'POW×5' },
      { id:'npcIdea',  label:'アイデア', sub:'Idea', formula:'INT×5' },
      { id:'npcKnow',  label:'知識',  sub:'Know',    formula:'EDU×5' },
      { id:'npcLuck',  label:'幸運',  sub:'Luck',    formula:'POW×5' },
      { id:'npcDb',    label:'DB',   sub:'ダメボ',   formula:'STR+SIZテーブル', isText:true },
      { id:'npcMov',   label:'MOV',  sub:'移動力',   formula:'STR/DEX/SIZ比較' },
    ],
    formulas: [
      { key:'HP',      val:'(CON + SIZ) ÷ 2（端数切捨）' },
      { key:'MP',      val:'POW（そのまま）' },
      { key:'SAN',     val:'POW × 5（初期値）　最大値 = 99 − クトゥルフ神話' },
      { key:'アイデア', val:'INT × 5' },
      { key:'知識',     val:'EDU × 5' },
      { key:'幸運',     val:'POW × 5' },
      { key:'DB',      val:'STR+SIZ 2〜12:−1D6 | 13〜16:−1D4 | 17〜24:0 | 25〜32:+1D4 | 33〜40:+1D6（以降+8毎に+1D6）' },
      { key:'MOV',     val:'STR＜SIZ かつ DEX＜SIZ → 7　|　STR＞SIZ かつ DEX＞SIZ → 9　|　その他 → 8' },
    ],
    calc(g, s, force) {
      const str=g('npcStr'), con=g('npcCon'), pow=g('npcPow');
      const dex=g('npcDex'), siz=g('npcSiz'), int_=g('npcInt'), edu=g('npcEdu');
      if(con && siz)  s('npcHp',   Math.floor((con+siz)/2),  force);
      if(pow)         s('npcMp',   pow,                       force);
      if(pow)         s('npcSan',  pow*5,                     force);
      if(int_)        s('npcIdea', int_*5,                    force);
      if(edu)         s('npcKnow', edu*5,                     force);
      if(pow)         s('npcLuck', pow*5,                     force);
      if(str && siz){ const db=calcDbBuild6th(str+siz); s('npcDb',db,force); }
      const mov=calcMov(str,dex,siz); if(mov!==null) s('npcMov',mov,force);
    },
    skillBases(stats) {
      const edu=stats.edu||0, dex=stats.dex||0, int_=stats.int||0;
      return {
        '母国語':    edu ? edu*5 : null,   // 6版：EDU×5
        '回避':      dex ? dex*5 : null,   // 6版：DEX×5
        'こぶし':    50,
        '心理学':    5,
      };
    },
  },
};

// ── エディション切替 ──
function setNpcEdition(ed) {
  _npcEdition = isTrpgMode() ? ed : 'general';
  const def = EDITION_DEF[ed] || EDITION_DEF['7th'];
  // ボタン状態
  if (isTrpgMode()) {
    ['7th','6th'].forEach(e => {
      const btn = document.getElementById('edBtn'+e[0]);
      if(btn) { btn.className = 'edition-btn' + (e===ed ? ' '+EDITION_DEF[e].btnActive : ''); }
    });
  }
  // バッジ
  const badge = document.getElementById('editionBadge');
  if(badge){
    if (isTrpgMode()) {
      badge.textContent = def.badge;
      badge.className = 'edition-badge '+def.badgeClass;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }
  // 能力値グリッド再描画（数値入力のみ）
  renderNpcStatsGrid(ed);
}

function renderNpcStatsGrid(ed) {
  const grid = document.getElementById('npcStatsGrid'); if(!grid) return;
  const statsDef = isTrpgMode() ? (EDITION_DEF[ed] || EDITION_DEF['7th']).stats : GENERAL_NPC_STATS;
  grid.innerHTML = statsDef.map(s => `
    <div class="npc-stat-cell">
      <div class="nsc-lbl">${s.label}</div>
      <input class="form-input nsc-inp" id="${s.id}" type="number" min="0" max="999" placeholder="—">
    </div>`).join('');
}

function renderNpcDerivedGrid(ed) {
  const grid = document.getElementById('npcDerivedGrid'); if(!grid) return;
  const def = EDITION_DEF[ed];
  grid.innerHTML = def.derived.map(d => `
    <div class="npc-stat-cell nsc-derived">
      <div class="nsc-lbl">${d.label}<span>${d.sub}</span><span class="nsc-formula">${d.formula}</span></div>
      <input class="form-input nsc-inp" id="${d.id}" type="${d.isText?'text':'number'}" min="-6" max="999" placeholder="—">
    </div>`).join('');
}

function renderNpcFormulaPanel(ed) {
  const panel = document.getElementById('statFormulaPanel'); if(!panel) return;
  const def = EDITION_DEF[ed];
  const color = ed==='7th' ? '#185fa5' : '#3b6d11';
  panel.innerHTML = `
    <div class="stat-formula-panel" style="border-color:${color}20">
      <div class="sfp-title" style="color:${color}">📐 ${def.label}の算出ルール</div>
      <div class="sfp-grid">
        ${def.formulas.map(f=>`<div class="sfp-item"><span class="sfp-key" style="color:${color}">${f.key}</span><span class="sfp-val">${f.val}</span></div>`).join('')}
      </div>
    </div>`;
}

// ── 自動計算 ──
function onStatInput() {
  autoCalcNpcStats(false);
}

function autoCalcNpcStats(force = false) {
  const def = EDITION_DEF[_npcEdition];
  const g = id => { const el = document.getElementById(id); return el ? parseInt(el.value)||0 : 0; };
  const s = (id, val, f) => {
    const el = document.getElementById(id); if(!el) return;
    if(f || !el.value.trim()) el.value = (val!==null && val!==undefined) ? val : '';
  };
  def.calc(g, s, force);
  if(force) toast('能力値を自動計算しました');
}

// ── 技能基本値を能力値から反映 ──
function autoFillSkillBases() {
  if (!isTrpgMode()) {
    toast('汎用モードでは能力値連動の自動反映は無効です');
    return;
  }
  const def = EDITION_DEF[_npcEdition];
  const gv = id => { const el=document.getElementById(id); return el ? parseInt(el.value)||0 : 0; };
  const stats = { str:gv('npcStr'), con:gv('npcCon'), pow:gv('npcPow'), dex:gv('npcDex'),
    app:gv('npcApp'), siz:gv('npcSiz'), int:gv('npcInt'), edu:gv('npcEdu') };
  const bases = def.skillBases(stats);
  let updated = 0;
  _editSkills.forEach(sk => {
    if(bases[sk.name] !== undefined && bases[sk.name] !== null) {
      sk.base = String(bases[sk.name]);
      if(!sk.val) sk.val = sk.base;
      updated++;
    }
  });
  renderSkillList();
  toast(updated > 0 ? `${updated}件の技能の基本値を反映しました` : '能力値依存の技能が見つかりませんでした');
}


function renderSkillPresets() {
  const wrap = document.getElementById('skillPresetGroups'); if(!wrap)return;
  const existNames = new Set(_editSkills.map(s=>s.name));
  const presets = getSkillPresets();
  wrap.innerHTML = presets.map(g => `
    <div>
      <div class="skill-group-name">${g.group}</div>
      <div class="skill-preset-chips">
        ${g.items.map(item => {
          const isAdded = existNames.has(item.name);
          const baseDisp = item.base!==null&&item.base!==undefined ? (item.baseNote||item.base+'%') : (item.baseNote||'');
          return '<button class="skill-pchip'+(isAdded?' added':'')+'" onclick="addPresetSkill(\'' + item.name.replace(/'/g,"\\'") + '\',' + (item.base!==null&&item.base!==undefined?item.base:'null') + ')">'
            + (isAdded ? '✓ ' : '') + item.name
            + (baseDisp ? '<span style="opacity:0.6;font-size:10px"> '+baseDisp+'</span>' : '')
            + '</button>';
        }).join('')}
      </div>
    </div>`).join('');
}

function toggleSkillPreset() {
  _skillPresetOpen = !_skillPresetOpen;
  const el = document.getElementById('skillPresetGroups');
  const btn = document.getElementById('skillPresetToggleBtn');
  if(el) el.style.display = _skillPresetOpen ? '' : 'none';
  if(btn) btn.textContent = _skillPresetOpen ? '▲ 折りたたむ' : '▼ 展開する';
}

function addPresetSkill(name, base) {
  if (_editSkills.find(s=>s.name===name)) { toast('「'+name+'」は既に追加されています', true); return; }
  const baseVal = base !== null && base !== undefined ? String(base) : '';
  _editSkills.push({ name, base: baseVal, val: baseVal });
  renderSkillList(); renderSkillPresets();
}

function addCustomSkill() {
  const name = document.getElementById('skillCustomName').value.trim();
  if (!name) { toast('技能名を入力してください', true); return; }
  if (_editSkills.find(s=>s.name===name)) { toast('同じ名前の技能が既にあります', true); return; }
  const val  = document.getElementById('skillCustomVal').value;
  const note = document.getElementById('skillCustomNote').value;
  _editSkills.push({ name, val, note });
  document.getElementById('skillCustomName').value='';
  document.getElementById('skillCustomVal').value='';
  document.getElementById('skillCustomNote').value='';
  renderSkillList();
}

function removeSkill(i) {
  _editSkills.splice(i,1); renderSkillList();
}

function updateSkillField(i, field, val) {
  if (_editSkills[i]) _editSkills[i][field] = val;
}

function renderSkillList() {
  const list = document.getElementById('npcSkillList'); if (!list) return;
  const trpg = isTrpgMode();
  if (!_editSkills.length) {
    list.innerHTML = trpg
      ? '<div class="skill-empty">技能が登録されていません。上の入力欄から追加してください。</div>'
      : '<div class="skill-empty">項目が登録されていません。上の入力欄から追加してください。</div>';
    return;
  }
  list.innerHTML =
    `<div class="skill-list-hd" style="grid-template-columns:1fr 90px 1fr 28px"><span>${trpg?'技能名':'項目名'}</span><span>${trpg?'技能値':'値'}</span><span>補足情報</span><span></span></div>` +
    _editSkills.map((s, i) => {
      return `<div class="skill-row" style="grid-template-columns:1fr 90px 1fr 28px">
        <div class="skill-row-name">${h(s.name)}</div>
        <input class="form-input skill-row-inp" type="number" min="0" max="999" value="${h(s.val||'')}" placeholder="—"
          oninput="updateSkillField(${i},'val',this.value)">
        <input class="form-input" type="text" value="${h(s.note||'')}" placeholder="任意"
          oninput="updateSkillField(${i},'note',this.value)">
        <button class="skill-row-del" onclick="removeSkill(${i})" title="削除">✕</button>
      </div>`;
    }).join('');
}

function openNPCModal() {
  const basicFields = ['npcEid','npcName','npcRole','npcDesc','npcSecret','npcTags','npcWeapons','npcAbilities'];
  basicFields.forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('npcAlignment').value = '';
  document.getElementById('npcColor').value = '';
  document.getElementById('npcColorCustom').value = '#3a8fd4';
  _editSkills = [];
  // デフォルトはプロジェクト設定（なければ7版）
  _npcEdition = isTrpgMode() ? (S.edition || '7th') : 'general';
  renderNpcModeTexts();
  setNpcEdition(_npcEdition);
  initNpcColorSwatches('');
  switchNpcTab('basic');
  renderSkillList();
  openModal('npcModal');
}

function editNPC(i) {
  const n = S.npcs[i];
  document.getElementById('npcEid').value = i;
  document.getElementById('npcName').value = n.name||'';
  document.getElementById('npcRole').value = n.role||'';
  document.getElementById('npcAlignment').value = n.alignment||'';
  document.getElementById('npcDesc').value    = n.desc||'';
  document.getElementById('npcSecret').value  = n.secret||'';
  document.getElementById('npcTags').value    = n.tags||'';
  document.getElementById('npcWeapons').value   = n.weapons||'';
  document.getElementById('npcAbilities').value = n.abilities||'';
  document.getElementById('npcColor').value = n.color||'';
  document.getElementById('npcColorCustom').value = n.color||'#3a8fd4';
  _editSkills = (n.skills||[]).map(s=>({ name:s.name||'', val:(s.val||s.base||''), note:s.note||'' }));
  // エディション復元（保存データにない場合は7版）
  _npcEdition = isTrpgMode() ? (n.edition || S.edition || '7th') : 'general';
  renderNpcModeTexts();
  setNpcEdition(_npcEdition);   // グリッドを描画してから値をセット
  // 能力値・派生値をセット（グリッド描画後）
  const statFields = {
    npcStr:n.str, npcCon:n.con, npcPow:n.pow, npcDex:n.dex,
    npcApp:n.app, npcSiz:n.siz, npcInt:n.int, npcEdu:n.edu,
    npcSan:n.san, npcHp:n.hp,  npcMp:n.mp,   npcDb:n.db,
    npcMov:n.mov, npcLuck:n.luck, npcBuild:n.build,
    // 6版専用
    npcIdea:n.idea, npcKnow:n.know,
  };
  Object.entries(statFields).forEach(([id,val]) => {
    const el = document.getElementById(id);
    if(el && val!==undefined && val!==null) el.value = val;
  });
  initNpcColorSwatches(n.color||'');
  switchNpcTab('basic');
  renderSkillList();
  openModal('npcModal');
}

function saveNPC() {
  const name = document.getElementById('npcName').value.trim();
  if (!name) { toast('名前を入力してください', true); switchNpcTab('basic'); return; }
  const gv = id => { const el=document.getElementById(id); return el ? el.value : ''; };
  const n = {
    edition: isTrpgMode() ? _npcEdition : 'general',
    name, role: gv('npcRole'),
    alignment: gv('npcAlignment'),
    // 共通能力値
    str:gv('npcStr'), con:gv('npcCon'), pow:gv('npcPow'), dex:gv('npcDex'),
    app:gv('npcApp'), siz:gv('npcSiz'), int:gv('npcInt'), edu:gv('npcEdu'),
    // 共通派生値
    san:gv('npcSan'), hp:gv('npcHp'), mp:gv('npcMp'), db:gv('npcDb'),
    mov:gv('npcMov'), luck:gv('npcLuck'), build:gv('npcBuild'),
    // 6版固有派生値
    idea:gv('npcIdea'), know:gv('npcKnow'),
    // その他
    desc:gv('npcDesc'), secret:gv('npcSecret'), tags:gv('npcTags'),
    weapons:gv('npcWeapons'), abilities:gv('npcAbilities'),
    color:gv('npcColor'),
    skills: _editSkills.map(s=>({ name:s.name||'', val:s.val||'', note:s.note||'' })),
  };
  const id = document.getElementById('npcEid').value;
  if (id !== '') S.npcs[parseInt(id)] = n; else S.npcs.push(n);
  closeModal('npcModal'); renderNPCs(); renderBlocks(); markDirty();
}


function renderNPCs() {
  const g = document.getElementById('npcGrid');
  if (!S.npcs.length) {
    g.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">👥</div><p>キャラクターをまだ追加していません</p></div>';
    renderScenarioHeaderMeta();
    return;
  }
  const alignMap = {
    ally:'<span class="alignment-badge ab-ally">🟢 味方</span>',
    enemy:'<span class="alignment-badge ab-enemy">🔴 敵</span>',
    neutral:'<span class="alignment-badge ab-neutral">🟡 中立</span>',
    unknown:'<span class="alignment-badge ab-unknown">⚫ 不明</span>',
  };
  g.innerHTML = S.npcs.map((n,i) => {
    const initials = (n.name||'?').slice(0,2);
    const tags = n.tags ? n.tags.split(',').map(t=>'<span class="chip">'+h(t.trim())+'</span>').join('') : '';
    const avBg = n.color ? 'background:'+n.color : '';
    const avCls = n.color ? 'npc-av npc-av-custom' : 'npc-av';
    const colorDot = n.color ? '<div class="npc-color-dot" style="background:'+n.color+'" title="セリフカラー"></div>' : '';
    const alignBadge = n.alignment ? (alignMap[n.alignment]||'') : '';
    const edBadge = isTrpgMode()
      ? (n.edition === '6th'
        ? '<span style="font-size:10px;padding:1px 7px;border-radius:8px;background:#eaf3de;color:#3b6d11;font-weight:600">6th</span>'
        : '<span style="font-size:10px;padding:1px 7px;border-radius:8px;background:#e6f1fb;color:#185fa5;font-weight:600">7th</span>')
      : '';
    const skillSummary = (n.skills||[]).slice(0,5).map(s =>
      '<span class="skill-chip">'+h(s.name)+(s.val?'<b style="color:var(--blue-600)"> '+s.val+'%</b>':'')+'</span>'
    ).join('');
    const moreSkills = (n.skills||[]).length>5 ? '<span class="skill-chip" style="color:var(--text-hint)">+'+((n.skills||[]).length-5)+'件</span>' : '';
    const statPairs = isTrpgMode()
      ? [['STR','str'],['CON','con'],['POW','pow'],['DEX','dex'],['INT','int'],['SAN','san'],['HP','hp'],['MP','mp']]
      : [['体力','str'],['持久','con'],['意志','pow'],['機敏','dex'],['思考','int'],['知識','edu'],['印象','app'],['存在','siz']];
    const statsHtml = statPairs.some(([,k]) => n[k])
      ? '<div class="npc-stats">'+statPairs.map(([lbl,key])=>'<div class="stat-box"><div class="stat-lbl">'+lbl+'</div><div class="stat-val">'+(n[key]||'—')+'</div></div>').join('')+'</div>'
      : '';
    return '<div class="npc-card" onclick="editNPC('+i+')">'
      + '<div class="npc-hd"><div class="'+avCls+'" style="'+avBg+'">'+h(initials)+'</div>'
      + '<div style="flex:1;min-width:0"><div class="npc-name" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">'+h(n.name||'')+colorDot+alignBadge+edBadge+'</div>'
      + '<div class="npc-role">'+h(n.role||'')+'</div></div></div>'
      + statsHtml
      + '<div class="npc-desc">'+h(n.desc||'')+'</div>'
      + ((n.skills||[]).length ? '<div class="npc-skill-summary">'+skillSummary+moreSkills+'</div>' : '')
      + (tags ? '<div class="tag-row" style="margin-top:8px">'+tags+'</div>' : '')
      + '</div>';
  }).join('');
  renderScenarioHeaderMeta();
}

// ======= ARTIFACTS =======

function renderArts() {
  const g = document.getElementById('artGrid');
  if (!S.artifacts.length) {
    g.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">📦</div><p>アイテムをまだ追加していません</p></div>`;
    return;
  }
  const icons = ['📖','🗝','🗿','💀','🔮','🧿','📿','🪬','⚗️'];
  g.innerHTML = S.artifacts.map((a, i) => `
    <div class="art-card" onclick="editArt(${i})">
      <div class="art-icon">${icons[i % icons.length]}</div>
      <div class="art-name">${h(a.name||'')}</div>
      <div class="art-type">${h(a.type||'')}</div>
      <div class="art-desc">${h(a.desc||'')}</div>
      ${a.san ? `<span class="san-chip">🧠 影響 ${h(a.san)}</span>` : ''}
      ${a.effect ? `<div class="effect-box">${h(a.effect)}</div>` : ''}
    </div>`).join('');
}

function openArtModal() {
  ['artEid','artName','artType','artDesc','artSan','artReq','artEffect','artKp'].forEach(id => document.getElementById(id).value = '');
  openModal('artModal');
}

function editArt(i) {
  const a = S.artifacts[i];
  document.getElementById('artEid').value = i;
  document.getElementById('artName').value = a.name||'';
  document.getElementById('artType').value = a.type||'';
  document.getElementById('artDesc').value = a.desc||'';
  document.getElementById('artSan').value = a.san||'';
  document.getElementById('artReq').value = a.req||'';
  document.getElementById('artEffect').value = a.effect||'';
  document.getElementById('artKp').value = a.kp||'';
  openModal('artModal');
}

function saveArt() {
  const name = document.getElementById('artName').value.trim();
  if (!name) { toast('名称を入力してください', true); return; }
  const a = { name, type: document.getElementById('artType').value, desc: document.getElementById('artDesc').value,
    san: document.getElementById('artSan').value, req: document.getElementById('artReq').value,
    effect: document.getElementById('artEffect').value, kp: document.getElementById('artKp').value };
  const id = document.getElementById('artEid').value;
  if (id !== '') S.artifacts[parseInt(id)] = a; else S.artifacts.push(a);
  closeModal('artModal'); renderArts(); markDirty();
}

// ======= MAP ENGINE (Canvas2D 間取り図) =======
let MAP = {
  curFloor: null,
  selRoom:  null,   // room id
  selEdge:  null,   // edge id
  mode:     'select',   // 'select' | 'room' | 'door'
  doorType: 'normal',
  drag:     null,   // {type:'move'|'resize', id, dir, sx,sy, ox,oy, ow,oh}
  connSrc:  null,
  sideTab:  'detail',
  zoom:     1.0,
  pan:      {x:0, y:0},
  panning:  false,
  panStart: null,
  dirty:    false,
  pendingFurnitureName: '',
};

// ── グリッド設定 ──
const GRID = 20;           // px per unit (屋内)
const GRID_OUT = 40;       // px per unit (屋外)
function gsize() { return curFloorObj()?.type === 'outdoor' ? GRID_OUT : GRID; }
function snap(v) { const g = gsize(); return Math.round(v / g) * g; }

// ── カテゴリ色テーブル ──
const CAT_COLOR = {
  normal:    { fill:'#f0f4f8', stroke:'#6a9fc0', text:'#2c5f7a' },
  entry:     { fill:'#e8f5e9', stroke:'#43a047', text:'#1b5e20' },
  key:       { fill:'#fff8e1', stroke:'#f9a825', text:'#7a5800' },
  danger:    { fill:'#fce4ec', stroke:'#e53935', text:'#7f0000' },
  secret:    { fill:'#f3e5f5', stroke:'#8e24aa', text:'#4a0072' },
  outdoor:   { fill:'#e8f5e9', stroke:'#388e3c', text:'#1b5e20' },
  landmark:  { fill:'#e3f2fd', stroke:'#1976d2', text:'#0d47a1' },
  shop:      { fill:'#fff3e0', stroke:'#f57c00', text:'#7a3600' },
  religious: { fill:'#fff8e1', stroke:'#c0784a', text:'#7c3d12' },
  medical:   { fill:'#e0f7fa', stroke:'#00897b', text:'#00363a' },
  school:    { fill:'#e8eaf6', stroke:'#5c6bc0', text:'#1a237e' },
  govt:      { fill:'#ede7f6', stroke:'#7b1fa2', text:'#4a0072' },
  transport: { fill:'#fff9c4', stroke:'#c09030', text:'#7a5800' },
  water:     { fill:'#e1f5fe', stroke:'#0288d1', text:'#01579b' },
  forest:    { fill:'#f1f8e9', stroke:'#558b2f', text:'#1b5e20' },
  ruin:      { fill:'#efebe9', stroke:'#795548', text:'#3e2723' },
};
const CAT_ICON = {
  normal:'🚪', entry:'🚪', key:'⭐', danger:'⚠', secret:'🔒',
  outdoor:'🌿', landmark:'🏛', shop:'🏪', religious:'⛪', medical:'🏥',
  school:'🏫', govt:'🏛', transport:'🚉', water:'🌊', forest:'🌲', ruin:'🏚',
};
const DOOR_COLOR = {
  normal: '#378add', locked: '#ba7517', secret: '#9b59b6', outdoor: '#3aaa8c',
};

// ── Canvas 参照 ──
function fpCanvas() { return document.getElementById('fpCanvas'); }
function fpCtx()    { const c=fpCanvas(); return c ? c.getContext('2d') : null; }
function fpSvgEl()  { return document.getElementById('fpSvg'); }

function ensureDefaultFloor() {
  if (!MAP.curFloor && S.floors.length) MAP.curFloor = S.floors[0].id;
}
function curFloorObj() { return S.floors.find(f=>f.id===MAP.curFloor)||S.floors[0]; }
function roomsOnFloor(fid) { return S.rooms.filter(r=>r.floorId===(fid||MAP.curFloor)); }
function edgesOnFloor(fid) { return S.edges.filter(e=>e.floorId===(fid||MAP.curFloor)); }

// ── メインレンダリング ──
function renderMap() {
  ensureDefaultFloor();
  if (!S.floors.length) { showMapWelcome(); return; }
  showMapMain();
  renderFpToolbar();
  renderFpFloorTabs();
  resizeFpCanvas();
  drawFp();
  renderFpSide();
}

function showMapWelcome() {
  const w=document.getElementById('mapWelcome'), m=document.getElementById('mapMain');
  if(w) w.style.display=''; if(m) m.style.display='none';
}
function showMapMain() {
  const w=document.getElementById('mapWelcome'), m=document.getElementById('mapMain');
  if(w) w.style.display='none'; if(m) m.style.display='flex';
}

// ── Canvas リサイズ ──
function resizeFpCanvas() {
  const wrap = document.querySelector('.fp-canvas-wrap');
  const c = fpCanvas();
  if (!wrap || !c) return;
  const r = wrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  c.width  = r.width  * dpr;
  c.height = r.height * dpr;
  c.style.width  = r.width  + 'px';
  c.style.height = r.height + 'px';
  const ctx = fpCtx();
  if (ctx) {
    // resetTransformでDPRスケールの累積を防ぐ
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }
}
window.addEventListener('resize', () => { if(S.floors.length) { resizeFpCanvas(); drawFp(); } });

// ── メイン描画 ──
function drawFp() {
  const c = fpCanvas();
  const ctx = fpCtx();
  if (!c || !ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const W = c.width  / dpr;
  const H = c.height / dpr;

  // 毎フレーム変換を初期化して、リサイズ後のスケール崩れを防ぐ
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(MAP.pan.x, MAP.pan.y);
  ctx.scale(MAP.zoom, MAP.zoom);

  // グリッド描画
  drawGrid(ctx, W, H);

  const rooms = roomsOnFloor();
  const edges = edgesOnFloor();
  const furns = furnituresOnFloor();

  // 接続線（壁の後ろに描画）
  edges.forEach(e => drawEdge(ctx, e, rooms));

  // 部屋描画
  rooms.forEach(r => drawRoom(ctx, r));

  // 家具・設備描画
  furns.forEach(f => drawFurniture(ctx, f));

  ctx.restore();

  // SVGオーバーレイ更新（リサイズハンドル等）
  updateFpSvg(rooms, furns);
}

function drawGrid(ctx, W, H) {
  const fl = curFloorObj();
  const isOut = fl?.type === 'outdoor';
  const g = gsize() * MAP.zoom;
  const offX = MAP.pan.x % g;
  const offY = MAP.pan.y % g;
  ctx.save();
  ctx.strokeStyle = isOut ? '#c8e6c9' : '#d0dce8';
  ctx.lineWidth = 0.5;
  for (let x = offX; x < W; x += g) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = offY; y < H; y += g) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.restore();
}

// ======================================================
//  間取り図描画エンジン v2（壁厚・扉記号・家具・柱）
// ======================================================

const WALL_T   = 8;   // 壁の厚み（px、グリッド座標）
const WALL_COL = '#2c3e50';
const WALL_FILL= '#ecf0f1';

// ── 家具・設備シンボルカタログ ──
const FURNITURE_CATALOG = {
  indoor: [
    { key:'door_swing',  label:'開き扉',     w:40, h:40, icon:'🚪' },
    { key:'door_slide',  label:'引き戸',      w:60, h:10, icon:'⬛' },
    { key:'window',      label:'窓',          w:60, h:10, icon:'🔲' },
    { key:'stairs_up',   label:'階段（上）',  w:60, h:60, icon:'🔼' },
    { key:'stairs_down', label:'階段（下）',  w:60, h:60, icon:'🔽' },
    { key:'toilet',      label:'トイレ',      w:36, h:48, icon:'🚽' },
    { key:'bath',        label:'浴槽',        w:60, h:80, icon:'🛁' },
    { key:'sink',        label:'洗面台',      w:40, h:30, icon:'🪣' },
    { key:'kitchen',     label:'キッチン',    w:100,h:50, icon:'🍳' },
    { key:'bed_s',       label:'ベッド(S)',   w:60, h:80, icon:'🛏' },
    { key:'bed_d',       label:'ベッド(D)',   w:80, h:80, icon:'🛏' },
    { key:'desk',        label:'机',          w:60, h:40, icon:'🖥' },
    { key:'sofa',        label:'ソファ',      w:80, h:40, icon:'🛋' },
    { key:'table',       label:'テーブル',    w:60, h:40, icon:'⬜' },
    { key:'bookshelf',   label:'本棚',        w:80, h:20, icon:'📚' },
    { key:'pillar',      label:'柱',          w:20, h:20, icon:'⬛' },
    { key:'column_wall', label:'構造壁',      w:80, h:16, icon:'▬' },
    { key:'altar',       label:'祭壇',        w:60, h:40, icon:'🕯' },
    { key:'coffin',      label:'棺',          w:40, h:80, icon:'⚰' },
  ],
  outdoor: [
    { key:'tree',        label:'樹木',        w:30, h:30, icon:'🌲' },
    { key:'bench',       label:'ベンチ',      w:40, h:16, icon:'🪑' },
    { key:'fountain',    label:'噴水',        w:40, h:40, icon:'⛲' },
    { key:'well',        label:'井戸',        w:30, h:30, icon:'⭕' },
    { key:'fence',       label:'柵・フェンス',w:80, h:10, icon:'🔳' },
    { key:'gate',        label:'門',          w:40, h:20, icon:'🏛' },
    { key:'road_h',      label:'道（横）',    w:80, h:20, icon:'➖' },
    { key:'road_v',      label:'道（縦）',    w:20, h:80, icon:'|' },
    { key:'pillar',      label:'柱・石碑',    w:20, h:20, icon:'⬛' },
    { key:'grave',       label:'墓石',        w:24, h:30, icon:'🪦' },
    { key:'bonfire',     label:'焚き火',      w:24, h:24, icon:'🔥' },
    { key:'sign',        label:'標識',        w:20, h:30, icon:'🪧' },
  ],
};

const FIXED_FURNITURE_KEYS = new Set([
  'door_swing',
  'door_slide',
  'window',
  'toilet',
  'bath',
  'sink',
  'kitchen',
  'pillar',
  'column_wall',
]);

const CUSTOM_FURNITURE_KEY = 'custom_named';

function findFurnitureCatalogItem(key) {
  if (key === CUSTOM_FURNITURE_KEY) {
    const isOut = curFloorObj()?.type === 'outdoor';
    return {
      key: CUSTOM_FURNITURE_KEY,
      label: '任意項目',
      w: isOut ? 48 : 60,
      h: isOut ? 32 : 40,
      icon: '🏷️',
    };
  }
  return FURNITURE_CATALOG.indoor.concat(FURNITURE_CATALOG.outdoor).find(c => c.key === key) || null;
}

function isFixedFurnitureKey(key) {
  return FIXED_FURNITURE_KEYS.has(key);
}

// ── 家具描画ディスパッチャ ──
function drawFurniture(ctx, f) {
  const x=f.x||0, y=f.y||0, w=f.w||40, h=f.h||40;
  const rot = (f.rot||0) * Math.PI / 180;
  const isSel = MAP.selFurniture === f.id;
  ctx.save();
  ctx.translate(x + w/2, y + h/2);
  ctx.rotate(rot);
  ctx.translate(-w/2, -h/2);

  switch(f.key) {
    case 'door_swing':  drawDoorSwing(ctx, 0, 0, w, h, f.flip); break;
    case 'door_slide':  drawDoorSlide(ctx, 0, 0, w, h); break;
    case 'window':      drawWindow(ctx, 0, 0, w, h); break;
    case 'stairs_up':
    case 'stairs_down': drawStairs(ctx, 0, 0, w, h, f.key==='stairs_up'); break;
    case 'toilet':      drawToilet(ctx, 0, 0, w, h); break;
    case 'bath':        drawBath(ctx, 0, 0, w, h); break;
    case 'sink':        drawSink(ctx, 0, 0, w, h); break;
    case 'kitchen':     drawKitchen(ctx, 0, 0, w, h); break;
    case 'pillar':      drawPillar(ctx, 0, 0, w, h); break;
    case 'column_wall': drawColumnWall(ctx, 0, 0, w, h); break;
    case 'tree':        drawTree(ctx, 0, 0, w, h); break;
    case 'fountain':    drawFountain(ctx, 0, 0, w, h); break;
    default:            drawGenericFurniture(ctx, 0, 0, w, h, f); break;
  }

  if (f.customName) {
    ctx.save();
    ctx.font='500 11px sans-serif';
    ctx.textAlign='center';
    ctx.textBaseline='top';
    const label = truncateText(ctx, f.customName, Math.max(60, w + 24));
    const tw = ctx.measureText(label).width;
    const lx = w/2;
    const ly = h + 6;
    ctx.fillStyle='rgba(255,255,255,0.92)';
    ctx.strokeStyle='rgba(70,85,110,0.35)';
    ctx.lineWidth=1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(lx - tw/2 - 6, ly - 2, tw + 12, 16, 4);
    else ctx.rect(lx - tw/2 - 6, ly - 2, tw + 12, 16);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle='#334155';
    ctx.fillText(label, lx, ly);
    ctx.restore();
  }

  // 選択枠
  if (isSel) {
    ctx.strokeStyle='#185fa5'; ctx.lineWidth=1.5; ctx.setLineDash([4,3]);
    ctx.strokeRect(-2,-2,w+4,h+4);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

// 建築図面：開き戸
function drawDoorSwing(ctx, x, y, w, h, flip) {
  ctx.save();
  ctx.strokeStyle=WALL_COL; ctx.lineWidth=2; ctx.fillStyle='#fff';
  // 扉本体（細長い矩形）
  const dw=Math.min(w,h), thick=4;
  ctx.fillRect(x, y, dw, thick); ctx.strokeRect(x, y, dw, thick);
  // 開き円弧
  ctx.beginPath();
  if (!flip) ctx.arc(x, y+thick, dw, -Math.PI/2, 0);
  else       ctx.arc(x+dw, y+thick, dw, -Math.PI/2, Math.PI, true);
  ctx.stroke();
  ctx.restore();
}
// 建築図面：引き戸
function drawDoorSlide(ctx, x, y, w, h) {
  ctx.save();
  ctx.strokeStyle=WALL_COL; ctx.lineWidth=2; ctx.fillStyle='#e8eef4';
  ctx.fillRect(x,y,w,h); ctx.strokeRect(x,y,w,h);
  ctx.beginPath(); ctx.moveTo(x+w*0.6,y); ctx.lineTo(x+w*0.6,y+h); ctx.stroke();
  ctx.restore();
}
// 建築図面：窓
function drawWindow(ctx, x, y, w, h) {
  ctx.save();
  ctx.fillStyle='#d6eaf8'; ctx.fillRect(x,y,w,h);
  ctx.strokeStyle=WALL_COL; ctx.lineWidth=2; ctx.strokeRect(x,y,w,h);
  const mid = y + h/2;
  ctx.beginPath(); ctx.moveTo(x,mid); ctx.lineTo(x+w,mid); ctx.stroke();
  ctx.restore();
}
// 建築図面：階段
function drawStairs(ctx, x, y, w, h, goUp) {
  const steps = 6;
  ctx.save();
  ctx.strokeStyle=WALL_COL; ctx.lineWidth=1.5; ctx.fillStyle='#f0f0f0';
  ctx.fillRect(x,y,w,h); ctx.strokeRect(x,y,w,h);
  const sw = w / steps;
  for (let i=1; i<steps; i++) {
    ctx.beginPath(); ctx.moveTo(x+sw*i,y); ctx.lineTo(x+sw*i,y+h); ctx.stroke();
  }
  // 矢印
  const ax=x+w/2, ay=goUp?y+h-6:y+6;
  ctx.fillStyle=WALL_COL; ctx.beginPath();
  if (goUp) { ctx.moveTo(ax,y+4); ctx.lineTo(ax-6,y+h-4); ctx.lineTo(ax+6,y+h-4); }
  else      { ctx.moveTo(ax,y+h-4); ctx.lineTo(ax-6,y+4); ctx.lineTo(ax+6,y+4); }
  ctx.fill();
  ctx.restore();
}
// 建築図面：トイレ
function drawToilet(ctx, x, y, w, h) {
  ctx.save();
  ctx.strokeStyle='#5b9bd5'; ctx.lineWidth=1.5; ctx.fillStyle='#e8f4fc';
  // タンク
  ctx.fillRect(x+w*0.1, y, w*0.8, h*0.3); ctx.strokeRect(x+w*0.1, y, w*0.8, h*0.3);
  // 便器（楕円）
  ctx.beginPath(); ctx.ellipse(x+w/2, y+h*0.65, w*0.4, h*0.32, 0, 0, Math.PI*2);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}
// 建築図面：浴槽
function drawBath(ctx, x, y, w, h) {
  ctx.save();
  ctx.fillStyle='#d6eaf8'; ctx.strokeStyle='#5b9bd5'; ctx.lineWidth=1.5;
  // 外枠
  ctx.fillRect(x,y,w,h); ctx.strokeRect(x,y,w,h);
  // 内枠
  ctx.beginPath(); ctx.roundRect(x+6,y+6,w-12,h-12,4); ctx.stroke();
  // 排水口
  ctx.beginPath(); ctx.arc(x+w/2, y+h-12, 4, 0, Math.PI*2); ctx.stroke();
  ctx.restore();
}
// 建築図面：洗面台
function drawSink(ctx, x, y, w, h) {
  ctx.save();
  ctx.fillStyle='#e8f4fc'; ctx.strokeStyle='#5b9bd5'; ctx.lineWidth=1.5;
  ctx.fillRect(x,y,w,h); ctx.strokeRect(x,y,w,h);
  ctx.beginPath(); ctx.ellipse(x+w/2, y+h/2, w*0.3, h*0.3, 0, 0, Math.PI*2); ctx.stroke();
  ctx.restore();
}
// 建築図面：キッチン
function drawKitchen(ctx, x, y, w, h) {
  ctx.save();
  ctx.fillStyle='#fef9e7'; ctx.strokeStyle='#b7950b'; ctx.lineWidth=1.5;
  ctx.fillRect(x,y,w,h); ctx.strokeRect(x,y,w,h);
  // コンロ（円2つ）
  [[0.25,0.45],[0.6,0.45]].forEach(([fx,fy])=>{
    ctx.beginPath(); ctx.arc(x+w*fx,y+h*fy,w*0.12,0,Math.PI*2); ctx.stroke();
  });
  // シンク
  ctx.strokeRect(x+w*0.05,y+h*0.05,w*0.25,h*0.5);
  ctx.restore();
}
// 建築図面：柱（塗り潰し正方形）
function drawPillar(ctx, x, y, w, h) {
  ctx.save();
  ctx.fillStyle=WALL_COL; ctx.fillRect(x,y,w,h);
  ctx.restore();
}
// 建築図面：構造壁（ハッチ塗り）
function drawColumnWall(ctx, x, y, w, h) {
  ctx.save();
  ctx.fillStyle=WALL_COL; ctx.fillRect(x,y,w,h);
  ctx.strokeStyle='#fff'; ctx.lineWidth=1.5;
  const step=8;
  for (let i=step; i<w; i+=step) {
    ctx.beginPath(); ctx.moveTo(x+i,y); ctx.lineTo(x+i,y+h); ctx.stroke();
  }
  ctx.restore();
}
// 屋外：樹木
function drawTree(ctx, x, y, w, h) {
  ctx.save();
  ctx.fillStyle='#27ae60'; ctx.strokeStyle='#1e8449'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.arc(x+w/2, y+h/2, Math.min(w,h)/2, 0, Math.PI*2);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle='#145a32'; ctx.font=`${Math.max(10,Math.min(w,h)*0.5)}px sans-serif`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('🌲', x+w/2, y+h/2);
  ctx.restore();
}
// 屋外：噴水
function drawFountain(ctx, x, y, w, h) {
  ctx.save();
  ctx.fillStyle='#85c1e9'; ctx.strokeStyle='#2980b9'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.arc(x+w/2,y+h/2,Math.min(w,h)/2,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(x+w/2,y+h/2,Math.min(w,h)/4,0,Math.PI*2); ctx.stroke();
  ctx.restore();
}
// 汎用（アイコン表示）
function drawGenericFurniture(ctx, x, y, w, h, f) {
  ctx.save();
  ctx.fillStyle='rgba(240,244,248,0.85)'; ctx.strokeStyle='#aab'; ctx.lineWidth=1;
  ctx.fillRect(x,y,w,h); ctx.strokeRect(x,y,w,h);
  const cat = FURNITURE_CATALOG.indoor.concat(FURNITURE_CATALOG.outdoor).find(c=>c.key===f.key);
  const icon = cat?.icon || f.icon || '□';
  if (cat) {
    ctx.font=`${Math.max(10,Math.min(w,h)*0.55)}px sans-serif`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(icon, x+w/2, y+h/2);
  } else {
    ctx.font=`${Math.max(10,Math.min(w,h)*0.55)}px sans-serif`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(icon, x+w/2, y+h/2);
  }
  ctx.restore();
}

// ── 部屋描画（壁厚付き間取り図版）──
function drawRoom(ctx, r) {
  const col = CAT_COLOR[r.cat] || CAT_COLOR.normal;
  const isSel = MAP.selRoom === r.id;
  const x=r.x||0, y=r.y||0, w=r.w||120, h2=r.h||80;
  const T = WALL_T;

  // 外壁（厚み付き）
  ctx.save();
  if (isSel) { ctx.shadowColor='rgba(55,138,221,0.4)'; ctx.shadowBlur=14; }
  ctx.fillStyle = WALL_COL;
  ctx.fillRect(x, y, w, h2);
  ctx.restore();

  // 内部（床）
  ctx.fillStyle = col.fill;
  ctx.fillRect(x+T, y+T, w-T*2, h2-T*2);

  // 選択ハイライト枠
  if (isSel) {
    ctx.strokeStyle='#185fa5'; ctx.lineWidth=2.5; ctx.strokeRect(x,y,w,h2);
  }

  // 秘密部屋：斜線ハッチ（内部）
  if (r.cat === 'secret') {
    ctx.save();
    ctx.rect(x+T, y+T, w-T*2, h2-T*2); ctx.clip();
    ctx.strokeStyle=col.stroke; ctx.lineWidth=0.8; ctx.globalAlpha=0.28;
    for (let i=-h2; i<w+h2; i+=10) {
      ctx.beginPath(); ctx.moveTo(x+T+i,y+T); ctx.lineTo(x+T+i+h2,y+T+h2-T*2); ctx.stroke();
    }
    ctx.restore();
  }

  // ラベル
  const icon = CAT_ICON[r.cat] || '🚪';
  const innerW = w - T*2, innerH = h2 - T*2;
  const cx = x + w/2, cy = y + h2/2;
  const fontSize = Math.max(10, Math.min(14, innerW / 7));

  ctx.save();
  ctx.rect(x+T+2, y+T+2, innerW-4, innerH-4); ctx.clip();

  // 部屋名
  ctx.fillStyle = col.text;
  ctx.font = `600 ${fontSize}px -apple-system,sans-serif`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  const lineCount = r.num ? 2 : 1;
  const lineH = fontSize * 1.3;
  const startY = cy - (lineCount-1)*lineH/2;
  ctx.fillText(truncateText(ctx, r.name||'', innerW-8), cx, startY);
  // 調査番号
  if (r.num) {
    ctx.font=`500 ${Math.max(9,fontSize-3)}px -apple-system,sans-serif`;
    ctx.fillStyle=col.stroke;
    ctx.fillText(r.num, cx, startY + lineH);
  }

  // アイコン（左上内側）
  ctx.font=`${Math.max(9,fontSize-2)}px sans-serif`;
  ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillText(icon, x+T+3, y+T+3);
  ctx.restore();

  // 手がかりドット（右上角、壁の上）
  if (r.clue) {
    ctx.beginPath(); ctx.arc(x+w-T/2, y+T/2, 5, 0, Math.PI*2);
    ctx.fillStyle='#e05c5c'; ctx.fill();
  }
}

// ── 扉・接続描画（建築図面記号）──
function drawEdge(ctx, e, rooms) {
  const a=rooms.find(r=>r.id===e.aId), b=rooms.find(r=>r.id===e.bId);
  if (!a||!b) return;
  const isSel = MAP.selEdge === e.id;

  // 壁面交点を取得
  const ax=(a.x||0)+(a.w||120)/2, ay=(a.y||0)+(a.h||80)/2;
  const bx=(b.x||0)+(b.w||120)/2, by=(b.y||0)+(b.h||80)/2;
  const pa=wallIntersect(a,ax,ay,bx,by);
  const pb=wallIntersect(b,bx,by,ax,ay);
  const mx=(pa.x+pb.x)/2, my=(pa.y+pb.y)/2;
  const ang=Math.atan2(pb.y-pa.y,pb.x-pa.x);
  const col = DOOR_COLOR[e.type]||DOOR_COLOR.normal;
  const doorW = 28;  // 扉の幅

  ctx.save();
  ctx.strokeStyle = isSel ? '#e05c5c' : col;
  ctx.lineWidth   = isSel ? 2.5 : 1.8;

  if (e.type === 'outdoor') {
    // 屋外路：破線
    ctx.setLineDash([10,5]);
    ctx.beginPath(); ctx.moveTo(pa.x,pa.y); ctx.lineTo(pb.x,pb.y); ctx.stroke();
    ctx.setLineDash([]);
  } else if (e.type === 'secret') {
    // 秘密通路：点線
    ctx.setLineDash([3,6]);
    ctx.beginPath(); ctx.moveTo(pa.x,pa.y); ctx.lineTo(pb.x,pb.y); ctx.stroke();
    ctx.setLineDash([]);
  } else if (e.type === 'locked') {
    // 施錠扉：開き扉＋錠前マーク
    drawDoorSymbol(ctx, mx, my, ang, doorW, col);
    // 錠前
    ctx.font='11px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('🔒', mx + Math.sin(ang)*14, my - Math.cos(ang)*14);
  } else {
    // 通常扉：開き扉シンボル
    drawDoorSymbol(ctx, mx, my, ang, doorW, col);
  }

  // 壁に開口部（扉幅分の壁を白で塗り潰し）
  ctx.save();
  ctx.strokeStyle='#fff'; ctx.lineWidth=WALL_T+1;
  ctx.beginPath(); ctx.moveTo(mx - Math.cos(ang)*doorW/2, my - Math.sin(ang)*doorW/2);
  ctx.lineTo(mx + Math.cos(ang)*doorW/2, my + Math.sin(ang)*doorW/2);
  ctx.stroke();
  ctx.restore();

  // 扉本体を再描画（開口部の上）
  if (e.type !== 'outdoor' && e.type !== 'secret') {
    drawDoorSymbol(ctx, mx, my, ang, doorW, isSel?'#e05c5c':col);
  }

  ctx.restore();
}

// 建築図面標準の開き扉シンボル
function drawDoorSymbol(ctx, mx, my, ang, doorW, col) {
  const perp = ang + Math.PI/2;
  const hingeX = mx - Math.cos(ang)*doorW/2;
  const hingeY = my - Math.sin(ang)*doorW/2;
  // 扉板
  ctx.save();
  ctx.strokeStyle=col; ctx.lineWidth=2;
  ctx.beginPath();
  ctx.moveTo(hingeX, hingeY);
  ctx.lineTo(hingeX + Math.cos(perp)*doorW, hingeY + Math.sin(perp)*doorW);
  ctx.stroke();
  // 開き円弧
  ctx.beginPath();
  ctx.arc(hingeX, hingeY, doorW, perp, ang+Math.PI/2, false);
  ctx.stroke();
  ctx.restore();
}

// ── 家具データアクセス ──
function furnituresOnFloor(fid) {
  if (!S.furnitures) S.furnitures=[];
  return S.furnitures.filter(f=>f.floorId===(fid||MAP.curFloor));
}

// ── SVGオーバーレイ（部屋＋家具のリサイズハンドル）──
function updateFpSvg(rooms, furns) {
  const svg=fpSvgEl(); if(!svg)return;
  const tx=v=>v*MAP.zoom+MAP.pan.x;
  const ty=v=>v*MAP.zoom+MAP.pan.y;
  let html='';

  // 選択中の部屋のリサイズハンドル
  if (MAP.selRoom) {
    const r=rooms.find(x=>x.id===MAP.selRoom);
    if (r) {
      const rx=tx(r.x||0), ry=ty(r.y||0), rw=(r.w||120)*MAP.zoom, rh=(r.h||80)*MAP.zoom;
      const handles=[
        {dir:'se',cx:rx+rw,cy:ry+rh},{dir:'sw',cx:rx,cy:ry+rh},
        {dir:'ne',cx:rx+rw,cy:ry},{dir:'nw',cx:rx,cy:ry},
        {dir:'e',cx:rx+rw,cy:ry+rh/2},{dir:'w',cx:rx,cy:ry+rh/2},
        {dir:'s',cx:rx+rw/2,cy:ry+rh},{dir:'n',cx:rx+rw/2,cy:ry},
      ];
      html+=handles.map(hd=>
        `<rect class="fp-resize-handle" data-dir="${hd.dir}" x="${hd.cx-5}" y="${hd.cy-5}" width="10" height="10" rx="2"
          onmousedown="startResize(event,'${r.id}','${hd.dir}')" ontouchstart="startResize(event,'${r.id}','${hd.dir}')" style="cursor:${cursorForDir(hd.dir)}"/>`
      ).join('');
    }
  }

  // 選択中の家具のリサイズ／回転ハンドル
  if (MAP.selFurniture) {
    const f=(furns||furnituresOnFloor()).find(x=>x.id===MAP.selFurniture);
    if (f) {
      const fx=tx(f.x||0), fy=ty(f.y||0), fw=(f.w||40)*MAP.zoom, fh=(f.h||40)*MAP.zoom;
      // 削除ボタン
      html+=`<g>
        <circle cx="${fx+fw+8}" cy="${fy-8}" r="9" fill="#e05c5c" style="cursor:pointer;pointer-events:all" onclick="event.stopPropagation();deleteFurniture('${f.id}')"/>
        <text x="${fx+fw+8}" y="${fy-4}" text-anchor="middle" font-size="11" fill="#fff" style="cursor:pointer;pointer-events:none">✕</text>
      </g>`;
      // 回転ボタン
      html+=`<g>
        <circle cx="${fx+fw/2}" cy="${fy-16}" r="9" fill="#378add" style="cursor:pointer;pointer-events:all" onclick="event.stopPropagation();rotateFurniture('${f.id}')"/>
        <text x="${fx+fw/2}" y="${fy-12}" text-anchor="middle" font-size="11" fill="#fff" style="cursor:pointer;pointer-events:none">↻</text>
      </g>`;
      if (f.customName !== undefined) {
        html+=`<g>
          <circle cx="${fx-8}" cy="${fy-8}" r="9" fill="#2f855a" style="cursor:pointer;pointer-events:all" onclick="event.stopPropagation();renameFurniture('${f.id}')"/>
          <text x="${fx-8}" y="${fy-4}" text-anchor="middle" font-size="11" fill="#fff" style="cursor:pointer;pointer-events:none">✎</text>
        </g>`;
      }
      // SEリサイズ
      html+=`<rect class="fp-resize-handle" x="${fx+fw-5}" y="${fy+fh-5}" width="10" height="10" rx="2"
        onmousedown="startFurnResize(event,'${f.id}')" ontouchstart="startFurnResize(event,'${f.id}')" style="cursor:se-resize"/>`;
    }
  }

  svg.innerHTML=html;
}

// ── 家具操作 ──
function rotateFurniture(id) {
  const f=S.furnitures?.find(x=>x.id===id); if(!f)return;
  f.rot=((f.rot||0)+90)%360; drawFp(); markDirty();
}
function deleteFurniture(id) {
  if(!S.furnitures)return;
  S.furnitures=S.furnitures.filter(x=>x.id!==id);
  MAP.selFurniture=null; drawFp(); markDirty();
}
function renameFurniture(id) {
  const f=S.furnitures?.find(x=>x.id===id); if(!f)return;
  const now = (f.customName||'').trim();
  const nm = prompt('設置名称を入力してください（空欄で解除）', now);
  if (nm === null) return;
  f.customName = nm.trim();
  drawFp();
  markDirty();
}
function startFurnResize(e,id) {
  e.preventDefault(); e.stopPropagation();
  const f=S.furnitures?.find(x=>x.id===id); if(!f)return;
  fpSnapshot();
  const pos=canvasPos(e);
  MAP.drag = {
    type:'furn-resize',
    id,
    sx:pos.x,
    sy:pos.y,
    ow:f.w||40,
    oh:f.h||40
  };
}

// ── 家具ヒットテスト ──
function hitTestFurniture(pos) {
  const furns = furnituresOnFloor();
  for (let i = furns.length - 1; i >= 0; i--) {
    const f = furns[i]; const fx=f.x||0,fy=f.y||0,fw=f.w||40,fh=f.h||40;
    if (pos.x>=fx && pos.x<=fx+fw && pos.y>=fy && pos.y<=fy+fh) return f;
  }
  return null;
}

// ======= UNDO / REDO スタック =======
const FP_UNDO_STACK = [];
const FP_REDO_STACK = [];
const FP_MAX_HISTORY = 50;

function fpSnapshot() {
  // 現在のマップ状態（フロア含む）を保存
  const snap = {
    floors:     JSON.parse(JSON.stringify(S.floors || [])),
    rooms:      JSON.parse(JSON.stringify(S.rooms)),
    edges:      JSON.parse(JSON.stringify(S.edges)),
    furnitures: JSON.parse(JSON.stringify(S.furnitures || [])),
    curFloor:   MAP.curFloor,
  };
  FP_UNDO_STACK.push(snap);
  if (FP_UNDO_STACK.length > FP_MAX_HISTORY) FP_UNDO_STACK.shift();
  FP_REDO_STACK.length = 0; // Undo後の分岐をクリア
  renderFpToolbar();
}

function fpUndo() {
  if (!FP_UNDO_STACK.length) { toast('これ以上戻れません', true); return; }
  // 現在の状態をRedoスタックに
  FP_REDO_STACK.push({
    floors:     JSON.parse(JSON.stringify(S.floors || [])),
    rooms:      JSON.parse(JSON.stringify(S.rooms)),
    edges:      JSON.parse(JSON.stringify(S.edges)),
    furnitures: JSON.parse(JSON.stringify(S.furnitures || [])),
    curFloor:   MAP.curFloor,
  });
  const prev = FP_UNDO_STACK.pop();
  S.floors     = prev.floors || [];
  S.rooms      = prev.rooms;
  S.edges      = prev.edges;
  S.furnitures = prev.furnitures;
  MAP.curFloor = prev.curFloor || S.floors[0]?.id || null;
  MAP.selRoom = null; MAP.selEdge = null; MAP.selFurniture = null;
  renderMap(); markDirty();
  toast('↩ 元に戻しました');
}

function fpRedo() {
  if (!FP_REDO_STACK.length) { toast('これ以上進めません', true); return; }
  FP_UNDO_STACK.push({
    floors:     JSON.parse(JSON.stringify(S.floors || [])),
    rooms:      JSON.parse(JSON.stringify(S.rooms)),
    edges:      JSON.parse(JSON.stringify(S.edges)),
    furnitures: JSON.parse(JSON.stringify(S.furnitures || [])),
    curFloor:   MAP.curFloor,
  });
  const next = FP_REDO_STACK.pop();
  S.floors     = next.floors || [];
  S.rooms      = next.rooms;
  S.edges      = next.edges;
  S.furnitures = next.furnitures;
  MAP.curFloor = next.curFloor || S.floors[0]?.id || null;
  MAP.selRoom = null; MAP.selEdge = null; MAP.selFurniture = null;
  renderMap(); markDirty();
  toast('↪ やり直しました');
}

// ── Canvas イベント ──
let _fpEventsInited = false;
function initFpEvents() {
  const c = fpCanvas(); if (!c) return;
  if (c.dataset.eventsInited) return;  // 重複登録防止
  c.dataset.eventsInited = '1';

  c.addEventListener('mousedown', e => {
    const pos = canvasPos(e);
    // ── パン（中ボタン or Alt+左ボタン）
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      MAP.panning = true;
      MAP.panStart = { x: e.clientX - MAP.pan.x, y: e.clientY - MAP.pan.y };
      c.style.cursor = 'grabbing'; return;
    }
    // ── 部屋追加モード：クリックでモーダルを開く
    if (MAP.mode === 'room') {
      openRoomModalAt(snap(pos.x), snap(pos.y), 120, 80);
      return;
    }
    // ── 扉接続モード
    if (MAP.mode === 'door') {
      const hit = hitTestRoom(pos);
      if (hit) {
        if (!MAP.connSrc) {
          MAP.connSrc = hit.id; drawFp(); toast('接続先の部屋をクリックしてください');
        } else if (MAP.connSrc !== hit.id) {
          const exists = edgesOnFloor().find(e =>
            (e.aId === MAP.connSrc && e.bId === hit.id) ||
            (e.aId === hit.id && e.bId === MAP.connSrc));
          if (!exists) {
            fpSnapshot();
            S.edges.push({ id: uid(), aId: MAP.connSrc, bId: hit.id, type: MAP.doorType, note: '', floorId: MAP.curFloor });
            markDirty();
          } else toast('既に接続されています', true);
          MAP.connSrc = null; drawFp();
        }
      } else {
        // 空白クリックで接続キャンセル
        MAP.connSrc = null; drawFp();
      }
      return;
    }
    // ── 家具配置モード
    if (MAP.mode === 'furniture') {
      if (MAP.pendingFurniture) {
        const cat = findFurnitureCatalogItem(MAP.pendingFurniture);
        if (cat) {
          fpSnapshot();
          if (!S.furnitures) S.furnitures = [];
          const isFixed = isFixedFurnitureKey(cat.key);
          const customName = isFixed ? '' : (MAP.pendingFurnitureName || '').trim();
          S.furnitures.push({
            id: uid(), key: cat.key, floorId: MAP.curFloor,
            x: snap(pos.x - cat.w/2), y: snap(pos.y - cat.h/2),
            w: cat.w, h: cat.h, rot: 0,
            icon: cat.icon || '',
            customName,
          });
          drawFp(); markDirty();
          toast(`${customName || cat.label}を配置しました`);
        }
      } return;
    }
    // ── 選択モード：リサイズハンドル優先
    const hitR = hitTestRoom(pos);
    const hitH = hitR && MAP.selRoom === hitR.id ? hitTestResizeHandle(pos, hitR) : null;
    const hitFH = !hitH && MAP.selFurniture ? hitTestFurnResizeHandle(pos) : null;
    if (hitH) {
      // リサイズ開始（スナップショットを先に取る）
      fpSnapshot();
      MAP.drag = { type:'resize', id: hitR.id, dir: hitH,
        sx: pos.x, sy: pos.y, ox: hitR.x||0, oy: hitR.y||0, ow: hitR.w||120, oh: hitR.h||80 };
      return;
    }
    if (hitFH) {
      const f = S.furnitures.find(x => x.id === MAP.selFurniture);
      if (f) {
        fpSnapshot();
        MAP.drag = { type:'furn-resize', id: f.id, sx: pos.x, sy: pos.y, ow: f.w||40, oh: f.h||40 };
      }
      return;
    }
    const hitF = hitTestFurniture(pos);
    const hitE = hitTestEdge(pos);
    if (hitF) {
      MAP.selFurniture = hitF.id; MAP.selRoom = null; MAP.selEdge = null;
      fpSnapshot();
      MAP.drag = { type:'furn-move', id: hitF.id, sx: pos.x, sy: pos.y, ox: hitF.x||0, oy: hitF.y||0 };
      renderFpSide(); renderFpToolbar(); drawFp();
    } else if (hitR) {
      const prevSel = MAP.selRoom;
      MAP.selRoom = hitR.id; MAP.selEdge = null; MAP.selFurniture = null;
      fpSnapshot();
      MAP.drag = { type:'move', id: hitR.id, sx: pos.x, sy: pos.y, ox: hitR.x||0, oy: hitR.y||0 };
      if (prevSel !== hitR.id) { renderFpSide(); renderFpToolbar(); }
      drawFp();
    } else if (hitE) {
      MAP.selEdge = hitE.id; MAP.selRoom = null; MAP.selFurniture = null;
      openEdgeModal(hitE.id); renderFpToolbar();
    } else {
      MAP.selRoom = null; MAP.selEdge = null; MAP.selFurniture = null;
      // 選択解除は履歴操作ではないため、Undo/Redoスタックは変更しない
      renderFpSide(); renderFpToolbar(); drawFp();
    }
  });

  c.addEventListener('mousemove', e => {
    if (MAP.panning) {
      MAP.pan.x = e.clientX - MAP.panStart.x;
      MAP.pan.y = e.clientY - MAP.panStart.y;
      drawFp(); return;
    }
    const pos = canvasPos(e);
    if (MAP.drag?.type === 'move') {
      const r = S.rooms.find(x => x.id === MAP.drag.id); if (!r) return;
      r.x = snap(MAP.drag.ox + (pos.x - MAP.drag.sx));
      r.y = snap(MAP.drag.oy + (pos.y - MAP.drag.sy));
      drawFp();
    } else if (MAP.drag?.type === 'furn-move') {
      const f = S.furnitures?.find(x => x.id === MAP.drag.id); if (!f) return;
      f.x = snap(MAP.drag.ox + (pos.x - MAP.drag.sx));
      f.y = snap(MAP.drag.oy + (pos.y - MAP.drag.sy));
      drawFp();
    } else if (MAP.drag?.type === 'resize') {
      applyResize(MAP.drag, pos); drawFp();
    } else if (MAP.drag?.type === 'furn-resize') {
      const f = S.furnitures?.find(x => x.id === MAP.drag.id); if (!f) return;
      const MIN = 12;
      f.w = Math.max(MIN, MAP.drag.ow + (pos.x - MAP.drag.sx));
      f.h = Math.max(MIN, MAP.drag.oh + (pos.y - MAP.drag.sy));
      drawFp();
    } else {
      // カーソル変化（リサイズハンドル上）
      if (MAP.mode === 'select') {
        const hitR = hitTestRoom(pos);
        const hitH = hitR && MAP.selRoom === hitR.id ? hitTestResizeHandle(pos, hitR) : null;
        const hitFH = !hitH && MAP.selFurniture ? hitTestFurnResizeHandle(pos) : null;
        c.style.cursor = hitH ? cursorForDir(hitH) : hitFH ? 'nwse-resize' : 'default';
      }
    }
    // 家具配置モード：カーソル追従プレビュー
    if (MAP.mode === 'furniture' && MAP.pendingFurniture) {
      drawFp();
      const ctx = fpCtx();
      if (ctx) {
        const cat = findFurnitureCatalogItem(MAP.pendingFurniture);
        if (cat) {
          ctx.save(); ctx.translate(MAP.pan.x, MAP.pan.y); ctx.scale(MAP.zoom, MAP.zoom);
          ctx.globalAlpha = 0.55;
          ctx.strokeStyle = '#378add'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
          ctx.strokeRect(snap(pos.x - cat.w/2), snap(pos.y - cat.h/2), cat.w, cat.h);
          ctx.restore();
        }
      }
    }
    // 部屋追加モードはクリック方式なのでプレビュー不要
  });

  c.addEventListener('mouseup', e => {
    if (MAP.panning) {
      MAP.panning = false;
      c.style.cursor = MAP.mode === 'door' ? 'cell' : MAP.mode === 'room' ? 'copy' : 'default';
      return;
    }
    if (MAP.drag) {
      MAP.drag = null; drawFp(); markDirty();
    }
  });

  document.addEventListener('mousemove', e => {
    if (!MAP.panning && !MAP.drag) return;
    if (c.contains(e.target)) return;

    if (MAP.panning) {
      MAP.pan.x = e.clientX - MAP.panStart.x;
      MAP.pan.y = e.clientY - MAP.panStart.y;
      drawFp();
      return;
    }

    const pos = canvasPos(e);
    if (MAP.drag?.type === 'move') {
      const r = S.rooms.find(x => x.id === MAP.drag.id); if (!r) return;
      r.x = snap(MAP.drag.ox + (pos.x - MAP.drag.sx));
      r.y = snap(MAP.drag.oy + (pos.y - MAP.drag.sy));
      drawFp();
    } else if (MAP.drag?.type === 'furn-move') {
      const f = S.furnitures?.find(x => x.id === MAP.drag.id); if (!f) return;
      f.x = snap(MAP.drag.ox + (pos.x - MAP.drag.sx));
      f.y = snap(MAP.drag.oy + (pos.y - MAP.drag.sy));
      drawFp();
    } else if (MAP.drag?.type === 'resize') {
      applyResize(MAP.drag, pos);
      drawFp();
    } else if (MAP.drag?.type === 'furn-resize') {
      const f = S.furnitures?.find(x => x.id === MAP.drag.id); if (!f) return;
      const MIN = 12;
      f.w = Math.max(MIN, MAP.drag.ow + (pos.x - MAP.drag.sx));
      f.h = Math.max(MIN, MAP.drag.oh + (pos.y - MAP.drag.sy));
      drawFp();
    }
  });

  document.addEventListener('mouseup', e => {
    if (e.target === c) return;

    if (MAP.panning) {
      MAP.panning = false;
      c.style.cursor = MAP.mode === 'door' ? 'cell' : MAP.mode === 'room' ? 'copy' : 'default';
      return;
    }

    if (MAP.drag) {
      MAP.drag = null;
      drawFp();
      markDirty();
    }
  });

  c.addEventListener('mouseleave', e => {
    if (!MAP.drag && !MAP.panning) {
      c.style.cursor = MAP.mode === 'door' ? 'cell' : MAP.mode === 'room' ? 'copy' : 'default';
    }
  });

  // Delete / Backspaceキーで選択中のオブジェクトを削除
  document.addEventListener('keydown', e => {
    if (!document.getElementById('panel-map')?.classList.contains('active')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelected();
    }
    // Ctrl+Z / Cmd+Z でUndo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault(); fpUndo();
    }
    // Ctrl+Shift+Z / Ctrl+Y でRedo
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault(); fpRedo();
    }
  });

  // ホイールズーム
  c.addEventListener('wheel', e => {
    e.preventDefault();
    const screen = canvasScreenPos(e);
    const world = canvasPos(e);
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.max(0.25, Math.min(3, MAP.zoom * factor));
    MAP.pan.x = screen.x - world.x * newZoom;
    MAP.pan.y = screen.y - world.y * newZoom;
    MAP.zoom = newZoom; drawFp();
  }, { passive: false });

  // タッチ：1本指ドラッグ（移動/リサイズ）＋2本指ピンチズーム
  let lastTouches = null;
  c.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      lastTouches = e.touches;
      e.preventDefault();
      return;
    }
    if (e.touches.length === 1) {
      lastTouches = null;
      const t = e.touches[0];
      e.preventDefault();
      c.dispatchEvent(new MouseEvent('mousedown', {
        clientX: t.clientX,
        clientY: t.clientY,
        button: 0,
        bubbles: true,
      }));
    }
  }, { passive: false });

  c.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && lastTouches) {
      e.preventDefault();
      const d0 = Math.hypot(lastTouches[0].clientX - lastTouches[1].clientX, lastTouches[0].clientY - lastTouches[1].clientY);
      const d1 = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const ratio = d0 > 0 ? (d1 / d0) : 1;
      const centerClientX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const centerClientY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const rect = c.getBoundingClientRect();
      const centerX = centerClientX - rect.left;
      const centerY = centerClientY - rect.top;
      const worldX = (centerX - MAP.pan.x) / MAP.zoom;
      const worldY = (centerY - MAP.pan.y) / MAP.zoom;
      const newZoom = Math.max(0.25, Math.min(3, MAP.zoom * ratio));
      MAP.pan.x = centerX - worldX * newZoom;
      MAP.pan.y = centerY - worldY * newZoom;
      MAP.zoom = newZoom;
      lastTouches = e.touches;
      drawFp();
      return;
    }
    if (e.touches.length === 1 && !lastTouches) {
      const t = e.touches[0];
      e.preventDefault();
      c.dispatchEvent(new MouseEvent('mousemove', {
        clientX: t.clientX,
        clientY: t.clientY,
        bubbles: true,
      }));
    }
  }, { passive: false });

  c.addEventListener('touchend', e => {
    if (e.touches.length < 2) lastTouches = null;
    if (e.touches.length === 0 && e.changedTouches.length) {
      const t = e.changedTouches[0];
      e.preventDefault();
      document.dispatchEvent(new MouseEvent('mouseup', {
        clientX: t.clientX,
        clientY: t.clientY,
        button: 0,
        bubbles: true,
      }));
    }
  }, { passive: false });

  c.addEventListener('touchcancel', () => {
    lastTouches = null;
    if (MAP.drag || MAP.panning) {
      MAP.drag = null;
      MAP.panning = false;
      c.style.cursor = MAP.mode === 'door' ? 'cell' : MAP.mode === 'room' ? 'copy' : 'default';
      drawFp();
    }
  }, { passive: true });
}

// リサイズハンドルのヒットテスト（部屋）
function hitTestResizeHandle(pos, r) {
  if (!r) return null;
  const HIT = 10;
  const x=r.x||0,y=r.y||0,w=r.w||120,h=r.h||80;
  const handles = [
    {dir:'nw',cx:x,      cy:y},
    {dir:'n', cx:x+w/2,  cy:y},
    {dir:'ne',cx:x+w,    cy:y},
    {dir:'e', cx:x+w,    cy:y+h/2},
    {dir:'se',cx:x+w,    cy:y+h},
    {dir:'s', cx:x+w/2,  cy:y+h},
    {dir:'sw',cx:x,      cy:y+h},
    {dir:'w', cx:x,      cy:y+h/2},
  ];
  for (const hd of handles) {
    if (Math.abs(pos.x - hd.cx) <= HIT && Math.abs(pos.y - hd.cy) <= HIT) return hd.dir;
  }
  return null;
}

// リサイズハンドルのヒットテスト（家具）
function hitTestFurnResizeHandle(pos) {
  if (!MAP.selFurniture) return false;
  const f = S.furnitures?.find(x => x.id === MAP.selFurniture);
  if (!f) return false;
  const HIT = 10;
  const cx = (f.x||0) + (f.w||40), cy = (f.y||0) + (f.h||40);
  return Math.abs(pos.x - cx) <= HIT && Math.abs(pos.y - cy) <= HIT;
}



function pointerClientPos(e) {
  if (typeof e.clientX === 'number' && typeof e.clientY === 'number') {
    return { x: e.clientX, y: e.clientY };
  }
  const t = e.touches?.[0] || e.changedTouches?.[0];
  if (t) return { x: t.clientX, y: t.clientY };
  return { x: 0, y: 0 };
}

function canvasScreenPos(e) {
  const c = fpCanvas();
  if (!c) return { x: 0, y: 0 };
  const r = c.getBoundingClientRect();
  const p = pointerClientPos(e);
  return { x: p.x - r.left, y: p.y - r.top };
}

// Canvas座標変換（マウス→ワールド）
function canvasPos(e) {
  const s = canvasScreenPos(e);
  return { x:(s.x-MAP.pan.x)/MAP.zoom, y:(s.y-MAP.pan.y)/MAP.zoom };
}

// ヒットテスト
function hitTestRoom(pos) {
  const rooms=roomsOnFloor();
  // 後から描いたものが上 → 逆順で検索
  for(let i=rooms.length-1;i>=0;i--){
    const r=rooms[i];
    if(pos.x>=(r.x||0)&&pos.x<=(r.x||0)+(r.w||120)&&pos.y>=(r.y||0)&&pos.y<=(r.y||0)+(r.h||80))
      return r;
  }
  return null;
}
function hitTestEdge(pos) {
  for(const e of edgesOnFloor()){
    const a=S.rooms.find(r=>r.id===e.aId), b=S.rooms.find(r=>r.id===e.bId);
    if(!a||!b)continue;
    const ax=(a.x||0)+(a.w||120)/2, ay=(a.y||0)+(a.h||80)/2;
    const bx=(b.x||0)+(b.w||120)/2, by=(b.y||0)+(b.h||80)/2;
    if(distToSegment(pos,{x:ax,y:ay},{x:bx,y:by})<10) return e;
  }
  return null;
}
function distToSegment(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y;
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)||0));
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}

// ── リサイズ ──
function startResize(e,id,dir){
  e.preventDefault(); e.stopPropagation();
  const r=S.rooms.find(x=>x.id===id); if(!r)return;
  fpSnapshot();
  const pos=canvasPos(e);
  MAP.drag={type:'resize',id,dir,sx:pos.x,sy:pos.y,ox:r.x||0,oy:r.y||0,ow:r.w||120,oh:r.h||80};
}
function applyResize(d,pos){
  const r=S.rooms.find(x=>x.id===d.id); if(!r)return;
  const dx=pos.x-d.sx, dy=pos.y-d.sy;
  const MIN=24;
  if(d.dir.includes('e')){r.w=Math.max(MIN,d.ow+dx);}
  if(d.dir.includes('s')){r.h=Math.max(MIN,d.oh+dy);}
  if(d.dir.includes('w')){const nw=Math.max(MIN,d.ow-dx);r.x=d.ox+d.ow-nw;r.w=nw;}
  if(d.dir.includes('n')){const nh=Math.max(MIN,d.oh-dy);r.y=d.oy+d.oh-nh;r.h=nh;}
}

// ── 部屋追加（ドラッグ描画後）──
function openRoomModalAt(x,y,w,h2){
  // フォームをクリア
  ['roomEid','roomName','roomNum','roomDesc','roomClue','roomKp'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  // 座標をhiddenフィールドに
  document.getElementById('roomEid').dataset.x=x;
  document.getElementById('roomEid').dataset.y=y;
  document.getElementById('roomEid').dataset.w=w;
  document.getElementById('roomEid').dataset.h=h2;
  // カテゴリ初期化
  const fl=curFloorObj(); const isOut=fl?.type==='outdoor';
  injectTemplatePicker(isOut?'outdoor':'indoor');
  const catSel=document.getElementById('roomCat');
  if(catSel) catSel.value=isOut?'outdoor':'normal';
  const flSel=document.getElementById('roomFloor');
  if(flSel) flSel.innerHTML=S.floors.map(f=>`<option value="${f.id}"${f.id===MAP.curFloor?' selected':''}>${h(f.name)}</option>`).join('');
  openModal('roomModal');
}

// ── サイドパネル ──
function switchFpTab(tab){ MAP.sideTab=tab; renderFpSide(); }
function switchMapTab(t){ switchFpTab(t); }

function renderFpSide(){
  const body=document.getElementById('fpSideBody'); if(!body)return;
  ['detail','list','furniture','legend'].forEach(t=>{
    const el=document.getElementById('fst-'+t); if(el) el.classList.toggle('active',t===MAP.sideTab);
  });
  if(MAP.sideTab==='detail') renderFpDetail(body);
  else if(MAP.sideTab==='list') renderFpList(body);
  else if(MAP.sideTab==='furniture') renderFpFurniturePanel(body);
  else renderFpLegend(body);
}
// legacy shim
function renderMapSide(){renderFpSide();}

function renderFpDetail(body){
  if(!MAP.selRoom){
    body.innerHTML='<div style="color:var(--text-hint);text-align:center;padding:24px 8px;font-size:12px">部屋をクリックして選択してください<br><br>▭ 部屋追加モードでクリックすると新しい部屋を追加できます<br>選択後はハンドルをドラッグしてサイズ変更できます</div>';
    return;
  }
  const r=S.rooms.find(x=>x.id===MAP.selRoom); if(!r)return;
  const col=CAT_COLOR[r.cat]||CAT_COLOR.normal;
  const icon=CAT_ICON[r.cat]||'🚪';
  const myEdges=edgesOnFloor().filter(e=>e.aId===r.id||e.bId===r.id);
  const connHtml=myEdges.map(e=>{
    const oid=e.aId===r.id?e.bId:e.aId;
    const other=S.rooms.find(x=>x.id===oid);
    const dl={normal:'通常',locked:'施錠',secret:'秘密',outdoor:'屋外路'}[e.type]||'通常';
    return `<div class="nd-conn-item" onclick="MAP.selRoom='${oid}';drawFp();renderFpSide()">
      ${other?h(other.name):'?'} <span class="conn-type-pill ct-${e.type}">${dl}</span>
    </div>`;
  }).join('');
  body.innerHTML=`
    <div class="fp-room-name">${icon} ${h(r.name||'')}</div>
    <div class="fp-room-size">W:${r.w||120}px × H:${r.h||80}px　調査番号：${r.num||'なし'}</div>
    ${r.desc?`<div class="fp-room-desc">${h(r.desc)}</div>`:''}
    ${r.clue?`<div class="fp-room-clue">🔍 ${h(r.clue)}</div>`:''}
    ${r.kp  ?`<div class="fp-room-kp">📌 ${h(r.kp)}</div>`:''}
    ${myEdges.length?`<div class="nd-conns-hd">接続先</div>${connHtml}`:''}
    <div style="display:flex;gap:6px;margin-top:12px">
      <button class="btn btn-sm" style="flex:1" onclick="editRoom('${r.id}')">✏ 編集</button>
      <button class="btn btn-sm btn-danger" onclick="deleteSelected()">🗑</button>
    </div>`;
}

function renderFpList(body){
  const rooms=roomsOnFloor();
  if(!rooms.length){body.innerHTML='<div style="color:var(--text-hint);font-size:12px;text-align:center;padding:20px 0">部屋がありません</div>';return;}
  body.innerHTML=rooms.map(r=>{
    const col=CAT_COLOR[r.cat]||CAT_COLOR.normal;
    return `<div class="fp-list-item${MAP.selRoom===r.id?' sel':''}" onclick="MAP.selRoom='${r.id}';MAP.sideTab='detail';drawFp();renderFpSide();renderFpToolbar()">
      <div class="fp-list-dot" style="background:${col.stroke}"></div>
      <span class="fp-list-name">${h(r.name||'')}</span>
      ${r.num?`<span class="fp-list-num">${h(r.num)}</span>`:''}
      ${r.clue?'<span style="color:#e05c5c;font-size:10px">●</span>':''}
    </div>`;
  }).join('')+`<button class="scene-add-btn" style="margin-top:8px" onclick="setFpMode('room');toast('キャンバス上をドラッグして部屋を描いてください')">＋ 部屋を描く</button>`;
}

function renderFpLegend(body){
  const floors=S.floors.map((f,i)=>`
    <div style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:12px;border-bottom:1px solid var(--border)">
      <span style="font-weight:${f.id===MAP.curFloor?700:400}">${f.type==='outdoor'?'🌿':'🏠'} ${h(f.name)}</span>
      <span style="font-size:10px;color:var(--text-hint);margin-left:auto">${roomsOnFloor(f.id).length}部屋</span>
      <button class="btn btn-sm" style="padding:2px 6px;font-size:10px" onclick="editFloor('${f.id}')">編集</button>
      ${S.floors.length>1?`<button class="btn btn-sm btn-danger" style="padding:2px 6px;font-size:10px" onclick="deleteFloor('${f.id}')">🗑</button>`:''}
    </div>`).join('');
  const catLeg=Object.entries(CAT_COLOR).map(([k,c])=>`
    <div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:11px">
      <div style="width:24px;height:16px;background:${c.fill};border:2px solid ${c.stroke};border-radius:3px"></div>
      ${CAT_ICON[k]||''} ${(CAT['nc-'+k]?.label)||{normal:'通常',entry:'入口',key:'重要',danger:'危険',secret:'秘密',outdoor:'屋外エリア',landmark:'ランドマーク',shop:'店舗',religious:'宗教',medical:'医療',school:'学校',govt:'官公庁',transport:'交通',water:'水域',forest:'森林',ruin:'廃墟'}[k]||k}
    </div>`).join('');
  const edgeLeg=Object.entries(DOOR_COLOR).map(([k,c])=>`
    <div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:11px">
      <svg width="24" height="10"><line x1="0" y1="5" x2="24" y2="5" stroke="${c}" stroke-width="2" ${k==='locked'?'stroke-dasharray="6 3"':k==='secret'?'stroke-dasharray="3 5"':''}/></svg>
      ${{normal:'通常',locked:'施錠',secret:'秘密通路',outdoor:'屋外路'}[k]||k}
    </div>`).join('');
  body.innerHTML=`
    <div style="font-size:11px;font-weight:600;color:var(--text-hint);margin-bottom:8px">フロア一覧</div>
    ${floors}
    <div style="height:1px;background:var(--border);margin:12px 0"></div>
    <div style="font-size:11px;font-weight:600;color:var(--text-hint);margin-bottom:6px">部屋カテゴリ</div>
    ${catLeg}
    <div style="height:1px;background:var(--border);margin:10px 0"></div>
    <div style="font-size:11px;font-weight:600;color:var(--text-hint);margin-bottom:6px">扉・接続タイプ</div>
    ${edgeLeg}`;
}

// ── ツールバー描画 ──
function renderFpToolbar() {
  const tb = document.getElementById('fpToolbar');
  if (!tb) return;
  const fl = curFloorObj();
  const isOut = fl?.type === 'outdoor';
  const doorTypes = isOut
    ? [{k:'outdoor',l:'⌇ 道路'},{k:'normal',l:'─ 通路'},{k:'locked',l:'╌ 施錠'},{k:'secret',l:'… 秘密'}]
    : [{k:'normal',l:'─ 通常'},{k:'locked',l:'╌ 施錠'},{k:'secret',l:'… 秘密'},{k:'outdoor',l:'⌇ 屋外路'}];
  const doorTypeHTML = doorTypes.map(dt =>
    `<button class="map-tool-btn${MAP.doorType===dt.k?' active':''}"
      style="${MAP.mode!=='door'?'display:none':''}"
      onclick="setDoorType('${dt.k}')">${dt.l}</button>`
  ).join('');
  tb.innerHTML = `
    <span class="tb-label">モード：</span>
    <button class="map-tool-btn${MAP.mode==='select'?    ' active':''}" onclick="setFpMode('select')" title="クリックで選択・ドラッグで移動・角の■でリサイズ">🖱 選択</button>
    <button class="map-tool-btn${MAP.mode==='room'?      ' active':''}" onclick="setFpMode('room')" title="マップ上をクリックして部屋を追加">▭ 部屋追加</button>
    <button class="map-tool-btn${MAP.mode==='door'?      ' active':''}" onclick="setFpMode('door')" title="部屋→部屋の順にクリックして扉を繋ぐ">🚪 扉接続</button>
    <button class="map-tool-btn${MAP.mode==='furniture'? ' active':''}" onclick="setFpMode('furniture');MAP.sideTab='furniture';renderFpSide()" title="右パネルから家具を選んでクリックで配置">🪑 家具・設備</button>
    <div class="map-toolbar-sep"></div>
    <span class="tb-label" style="${MAP.mode!=='door'?'display:none':''}">扉タイプ：</span>
    ${doorTypeHTML}
    ${MAP.mode==='door'?'<div class="map-toolbar-sep"></div>':''}
    <button class="map-tool-btn" onclick="fpUndo()" title="元に戻す (Ctrl+Z)" ${!FP_UNDO_STACK.length?'disabled style="opacity:0.35;cursor:not-allowed"':''}>↩ 戻す</button>
    <button class="map-tool-btn" onclick="fpRedo()" title="やり直し (Ctrl+Shift+Z)" ${!FP_REDO_STACK.length?'disabled style="opacity:0.35;cursor:not-allowed"':''}>↪ 進む</button>
    <div class="map-toolbar-sep"></div>
    <button class="map-tool-btn" onclick="fpZoomIn()" title="拡大">＋</button>
    <button class="map-tool-btn" onclick="fpZoomReset()" title="100%">100%</button>
    <button class="map-tool-btn" onclick="fpZoomOut()" title="縮小">－</button>
    <div class="map-toolbar-sep"></div>
    <button class="map-tool-btn" onclick="fpAutoFit()" title="全体を画面に合わせる">⟳ 全体表示</button>
    <div style="margin-left:auto;display:flex;gap:6px">
      <button class="map-tool-btn" onclick="fpExportPng()" title="PNG画像として保存">🖼 PNG出力</button>
      ${(S.floors?.length || S.rooms?.length || S.furnitures?.length) ?
        `<button class="map-tool-btn danger" onclick="clearAllRooms()" title="マップ全体を初期化（屋内/屋外の選択画面に戻す）">🧹 マップ全消去</button>` : ''}
      ${MAP.selRoom||MAP.selEdge||MAP.selFurniture ?
        `<button class="map-tool-btn danger" onclick="deleteSelected()" title="選択中を削除 (Deleteキー)">🗑 削除</button>` : ''}
    </div>
    ${MAP.mode==='room'?`<div class="fp-hint">💡 マップ上をクリックして部屋を追加。追加後は選択モードで移動・リサイズ可能</div>`:''}
    ${MAP.mode==='door'?`<div class="fp-hint">💡 1つ目の部屋→2つ目の部屋の順にクリックで扉を繋ぎます。空白クリックでキャンセル</div>`:''}
    ${MAP.mode==='furniture'?`<div class="fp-hint">💡 右パネルの「家具・設備」タブから選択→マップ上でクリックして配置</div>`:''}
    ${MAP.selRoom?`<div class="fp-hint" style="color:var(--blue-600)">💡 選択中：ドラッグで移動 ／ 角・辺の■をドラッグでリサイズ ／ Deleteで削除</div>`:''}
  `;
}


// ── モード設定 ──
function setFpMode(mode) {
  MAP.mode = mode;
  MAP.connSrc = null;
  if (mode !== 'furniture') {
    MAP.pendingFurniture = null;
    MAP.pendingFurnitureName = '';
  }
  const c = fpCanvas();
  if (c) c.style.cursor = (mode==='room'||mode==='furniture') ? 'crosshair' : mode==='door' ? 'cell' : 'default';
  renderFpToolbar();
}
function setDoorType(t) { MAP.doorType = t; renderFpToolbar(); }
function setMapMode(m)  { setFpMode(m === 'connect' ? 'door' : 'select'); }
function setConnType(t) { setDoorType(t); }

// ── フロアタブ描画 ──
function renderFpFloorTabs() {
  const el = document.getElementById('fpFloorTabs');
  if (!el) return;
  el.innerHTML = S.floors.map(f => {
    const icon = f.type === 'outdoor' ? '🌿' : '🏠';
    return `<button class="fp-floor-tab${f.id===MAP.curFloor?' active':''}" onclick="switchFloor('${f.id}')">${icon} ${h(f.name)}</button>`;
  }).join('') + `<button class="fp-floor-tab-add" onclick="openAddFloorSheet()">＋ フロア追加</button>`;
}

// ── ズーム ──
function fpZoomIn()    { MAP.zoom = Math.min(3, MAP.zoom*1.25); drawFp(); }
function fpZoomOut()   { MAP.zoom = Math.max(0.25, MAP.zoom/1.25); drawFp(); }
function fpZoomReset() { MAP.zoom = 1; MAP.pan = {x:0,y:0}; drawFp(); }
function fpAutoFit() {
  const rooms = roomsOnFloor();
  if (!rooms.length) { MAP.zoom=1; MAP.pan={x:0,y:0}; drawFp(); return; }
  const c = fpCanvas(); if (!c) return;
  const W = c.width/(window.devicePixelRatio||1), H = c.height/(window.devicePixelRatio||1);
  const minX = Math.min(...rooms.map(r=>r.x||0));
  const minY = Math.min(...rooms.map(r=>r.y||0));
  const maxX = Math.max(...rooms.map(r=>(r.x||0)+(r.w||120)));
  const maxY = Math.max(...rooms.map(r=>(r.y||0)+(r.h||80)));
  const margin = 60;
  MAP.zoom = Math.min(2, Math.max(0.3, Math.min((W-margin*2)/(maxX-minX||1),(H-margin*2)/(maxY-minY||1))));
  MAP.pan.x = margin - minX*MAP.zoom;
  MAP.pan.y = margin - minY*MAP.zoom;
  drawFp();
}

// ── PNG エクスポート ──
// ── フロア画像をオフスクリーンで生成 ──
function generateFloorDataUrl(floorId) {
  return new Promise(resolve => {
    const rooms = S.rooms.filter(r => r.floorId === floorId);
    if (!rooms.length) { resolve(null); return; }

    // キャンバスサイズ計算（全部屋を包含する矩形＋余白）
    const WALL_T = 8, PAD = 48, GRID = 20;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    rooms.forEach(r => {
      const x = r.x || 20, y = r.y || 20;
      const w = r.w || 120, h2 = r.h || 80;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h2);
    });
    // 家具も考慮
    (S.furnitures || []).filter(f => f.floorId === floorId).forEach(f => {
      minX = Math.min(minX, f.x || 0); minY = Math.min(minY, f.y || 0);
      maxX = Math.max(maxX, (f.x || 0) + 40); maxY = Math.max(maxY, (f.y || 0) + 40);
    });

    const cw = Math.max(400, maxX - minX + PAD * 2);
    const ch = Math.max(300, maxY - minY + PAD * 2);
    const ox = -minX + PAD;  // オフセット
    const oy = -minY + PAD;

    const oc = document.createElement('canvas');
    oc.width  = cw;
    oc.height = ch;
    const ctx = oc.getContext('2d');
    const fl = S.floors.find(f => f.id === floorId);
    const isOutdoor = fl && fl.type === 'outdoor';

    // 背景
    if (isOutdoor) {
      ctx.fillStyle = '#e8f5e9';
      ctx.fillRect(0, 0, cw, ch);
      // グリッド
      ctx.strokeStyle = '#c8e6c9'; ctx.lineWidth = 0.5;
      for (let x = 0; x < cw; x += GRID) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,ch); ctx.stroke(); }
      for (let y = 0; y < ch; y += GRID) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(cw,y); ctx.stroke(); }
    } else {
      ctx.fillStyle = '#f4f7fb';
      ctx.fillRect(0, 0, cw, ch);
      ctx.strokeStyle = '#dde4ee'; ctx.lineWidth = 0.5;
      for (let x = 0; x < cw; x += GRID) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,ch); ctx.stroke(); }
      for (let y = 0; y < ch; y += GRID) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(cw,y); ctx.stroke(); }
    }

    // 部屋
    const CAT_COLORS = {
      normal:   { wall:'#4a5568', floor:'#ffffff' },
      entry:    { wall:'#2e7d32', floor:'#f1f8e9' },
      key:      { wall:'#b45309', floor:'#fffde7' },
      danger:   { wall:'#c62828', floor:'#fce4ec' },
      secret:   { wall:'#6a1b9a', floor:'#f3e5f5' },
      outdoor:  { wall:'#2e7d32', floor:'#e8f5e9' },
      landmark: { wall:'#1565c0', floor:'#e3f2fd' },
      shop:     { wall:'#e65100', floor:'#fff3e0' },
      religious:{ wall:'#7b3f00', floor:'#fdf8f0' },
      medical:  { wall:'#00695c', floor:'#e0f2f1' },
      school:   { wall:'#283593', floor:'#e8eaf6' },
      govt:     { wall:'#4a148c', floor:'#f3e5f5' },
      transport:{ wall:'#795548', floor:'#efebe9' },
      water:    { wall:'#01579b', floor:'#e1f5fe' },
      forest:   { wall:'#1b5e20', floor:'#e8f5e9' },
      ruin:     { wall:'#546e7a', floor:'#eceff1' },
    };

    // 接続線（扉）を先に描く
    const edges = (S.edges || []).filter(e => e.floorId === floorId);
    edges.forEach(e => {
      const ra = rooms.find(r => r.id === e.aId);
      const rb = rooms.find(r => r.id === e.bId);
      if (!ra || !rb) return;
      const ax = (ra.x||20) + (ra.w||120)/2 + ox;
      const ay = (ra.y||20) + (ra.h||80)/2  + oy;
      const bx = (rb.x||20) + (rb.w||120)/2 + ox;
      const by = (rb.y||20) + (rb.h||80)/2  + oy;
      ctx.save();
      if (e.type === 'locked')  { ctx.setLineDash([6,3]); ctx.strokeStyle = '#e53935'; }
      else if (e.type === 'secret') { ctx.setLineDash([2,4]); ctx.strokeStyle = '#8e24aa'; }
      else if (e.type === 'outdoor') { ctx.setLineDash([8,4]); ctx.strokeStyle = '#43a047'; }
      else { ctx.setLineDash([]); ctx.strokeStyle = '#78909c'; }
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.restore();
    });

    // 部屋ボックス
    rooms.forEach(r => {
      const rx = (r.x||20) + ox, ry = (r.y||20) + oy;
      const rw = r.w||120, rh = r.h||80;
      const cat = r.cat || 'normal';
      const colors = CAT_COLORS[cat] || CAT_COLORS.normal;

      // 壁（外枠）
      ctx.fillStyle = colors.wall;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(rx, ry, rw, rh, 4) : ctx.rect(rx, ry, rw, rh);
      ctx.fill();

      // 床（内側）
      const WT = WALL_T;
      ctx.fillStyle = colors.floor;
      ctx.beginPath();
      ctx.rect(rx+WT, ry+WT, rw-WT*2, rh-WT*2);
      ctx.fill();

      // 秘密部屋はハッチング
      if (cat === 'secret') {
        ctx.save();
        ctx.strokeStyle = 'rgba(106,27,154,0.18)'; ctx.lineWidth = 1;
        for (let i = -rh; i < rw; i += 10) {
          ctx.beginPath();
          ctx.moveTo(rx+WT+i, ry+WT);
          ctx.lineTo(rx+WT+i+rh, ry+rh-WT);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 調査番号バッジ
      if (r.num) {
        ctx.fillStyle = colors.wall;
        ctx.fillRect(rx + rw - 28, ry + WT + 2, 26, 14);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(r.num, rx + rw - 15, ry + WT + 12);
      }

      // 場所名
      ctx.fillStyle = '#1a202c';
      ctx.font = `bold ${Math.min(13, Math.floor(rw/8))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = r.name || '';
      // 長い名前は折り返し
      if (ctx.measureText(label).width > rw - WT*2 - 8) {
        const half = Math.ceil(label.length/2);
        ctx.fillText(label.slice(0,half), rx+rw/2, ry+rh/2-7);
        ctx.fillText(label.slice(half),   rx+rw/2, ry+rh/2+7);
      } else {
        ctx.fillText(label, rx+rw/2, ry+rh/2);
      }

      // 手がかりドット
      if (r.clue) {
        ctx.fillStyle = '#e53935';
        ctx.beginPath(); ctx.arc(rx+rw-WT-4, ry+WT+4, 4, 0, Math.PI*2); ctx.fill();
      }
    });

    // 家具・設備（通常マップと同じ描画ロジックを利用）
    (S.furnitures || []).filter(f => f.floorId === floorId).forEach(f => {
      const fx = (f.x||0) + ox, fy = (f.y||0) + oy;
      drawFurniture(ctx, {
        ...f,
        id: `__export_${f.id || uid()}`,
        x: fx,
        y: fy,
      });
    });

    // フロアタイトル
    ctx.fillStyle = 'rgba(24,95,165,0.12)';
    ctx.fillRect(0, 0, cw, 22);
    ctx.fillStyle = '#185fa5';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${isOutdoor ? '🌿' : '🏠'} ${fl?.name || 'フロア'}`, 8, 11);

    resolve(oc.toDataURL('image/png'));
  });
}


// 家具パレット
function renderFpFurniturePanel(body) {
  const fl = curFloorObj();
  const type = fl?.type === 'outdoor' ? 'outdoor' : 'indoor';
  const catalog = FURNITURE_CATALOG[type] || [];
  const fixedItems = catalog.filter(item => isFixedFurnitureKey(item.key));
  const currentName = h(MAP.pendingFurnitureName || '');
  body.innerHTML = `
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;line-height:1.6">
      クリックして選択 → キャンバス上でクリックして配置<br>
      配置後は選択モードでドラッグ移動・↻で回転・✕で削除
    </div>
    <div style="font-size:11px;font-weight:600;color:var(--text-hint);margin-bottom:6px">固定項目</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
      ${fixedItems.map(item => {
        const isActive = MAP.pendingFurniture === item.key;
        return `<button class="fp-furn-chip${isActive?' active':''}" onclick="selectFurnTool('${item.key}')">
          <span style="font-size:16px">${item.icon}</span>
          <span style="font-size:11px">${item.label}</span>
        </button>`;
      }).join('')}
    </div>
    <div style="height:1px;background:var(--border);margin:10px 0"></div>
    <div style="font-size:11px;font-weight:600;color:var(--text-hint);margin-bottom:6px">任意名称で配置</div>
    <input id="fpFurnitureNameInput" class="form-input" style="height:30px;font-size:12px;margin-bottom:8px" value="${currentName}" placeholder="設置名称（例：発電機、祭壇、簡易ベッド）" oninput="MAP.pendingFurnitureName=this.value">
    <button class="btn btn-sm btn-primary" style="width:100%;justify-content:center" onclick="addCustomFurnitureMode()">＋ 追加</button>
    <div style="font-size:10px;color:var(--text-hint);margin-top:6px;line-height:1.6">※ 追加後、キャンバス上をクリックして配置します。</div>
    <button class="btn btn-sm" style="width:100%;margin-top:10px;justify-content:center" onclick="setFpMode('select');MAP.pendingFurniture=null;renderFpToolbar()">
      ← 選択モードに戻る
    </button>`;
}

function addCustomFurnitureMode() {
  const nmEl = document.getElementById('fpFurnitureNameInput');
  const name = (nmEl?.value || '').trim();
  if (!name) {
    toast('設置名称を入力してください', true);
    return;
  }
  MAP.pendingFurnitureName = name;
  selectFurnTool(CUSTOM_FURNITURE_KEY, true);
}

function selectFurnTool(key, useCustomName=false) {
  if (useCustomName) {
    const nmEl = document.getElementById('fpFurnitureNameInput');
    MAP.pendingFurnitureName = (nmEl?.value || MAP.pendingFurnitureName || '').trim();
  } else {
    MAP.pendingFurnitureName = '';
  }
  MAP.pendingFurniture = key;
  MAP.mode = 'furniture';
  fpCanvas().style.cursor = 'crosshair';
  renderFpToolbar();
  renderFpSide();
  const cat = findFurnitureCatalogItem(key);
  const nm = MAP.pendingFurnitureName || cat?.label || '設備';
  toast(`${nm}を配置できます。キャンバス上をクリックしてください`);
}

// ── フロア管理（互換 shim）──
function renderMapToolbar(){renderFpToolbar();}
function renderFloorTabs(){renderFpFloorTabs();}
function renderMapCanvas(){drawFp();}

function switchFloor(id){
  MAP.curFloor=id; MAP.selRoom=null; MAP.selEdge=null; MAP.connSrc=null;
  renderMap();
}

function openFloorModal(editId){
  document.getElementById('floorEid').value=editId||'';
  if(editId){
    const f=S.floors.find(x=>x.id===editId);
    document.getElementById('floorName').value=f.name;
    document.getElementById('floorType').value=f.type;
    document.getElementById('floorNote').value=f.note||'';
  } else {
    document.getElementById('floorName').value='';
    document.getElementById('floorType').value='indoor';
    document.getElementById('floorNote').value='';
  }
  openModal('floorModal');
}

function openAddFloorSheet(){openModal('addFloorSheet');}
function addFloor(){openAddFloorSheet();}

function pickFloorType(type){
  closeModal('addFloorSheet');
  const indoorNames=['1F','2F','3F','地下1F','地下2F','屋根裏'];
  const outdoorNames=['広域マップ','街区','港エリア','森林地帯','郊外'];
  const ex=S.floors.filter(f=>f.type===type).length;
  const names=type==='indoor'?indoorNames:outdoorNames;
  document.getElementById('floorEid').value='';
  document.getElementById('floorType').value=type;
  document.getElementById('floorName').value=names[ex]||(type==='indoor'?`${ex+1}F`:`エリア${ex+1}`);
  document.getElementById('floorNote').value='';
  openModal('floorModal');
}

function editFloor(id){openFloorModal(id);}

function saveFloor(){
  const name=document.getElementById('floorName').value.trim();
  if(!name){toast('フロア名を入力してください',true);return;}
  const id=document.getElementById('floorEid').value;
  const f={name,type:document.getElementById('floorType').value,note:document.getElementById('floorNote').value};
  if(id){const idx=S.floors.findIndex(x=>x.id===id);if(idx>=0)S.floors[idx]={...S.floors[idx],...f};}
  else{const nf={id:uid(),...f};S.floors.push(nf);MAP.curFloor=nf.id;}
  closeModal('floorModal'); renderMap(); markDirty();
}

function deleteFloor(id){
  if(roomsOnFloor(id).length&&!confirm('このフロアの部屋と接続もすべて削除されます。続けますか？'))return;
  S.rooms=S.rooms.filter(r=>r.floorId!==id);
  S.edges=S.edges.filter(e=>e.floorId!==id);
  S.floors=S.floors.filter(f=>f.id!==id);
  MAP.selRoom=null;MAP.selEdge=null;
  if(MAP.curFloor===id)MAP.curFloor=S.floors[0]?.id||null;
  closeModal('floorModal'); renderMap(); markDirty();
}

// ── 部屋 CRUD ──
function openRoomModal(){
  const fl=curFloorObj(); const isOut=fl?.type==='outdoor';
  ['roomEid','roomName','roomNum','roomDesc','roomClue','roomKp'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  // 座標リセット
  const eid=document.getElementById('roomEid');
  delete eid.dataset.x; delete eid.dataset.y; delete eid.dataset.w; delete eid.dataset.h;
  const catSel=document.getElementById('roomCat');
  catSel.innerHTML=isOut?`
    <optgroup label="✅ 屋外（推奨）">
      <option value="outdoor">🌿 屋外エリア</option><option value="landmark">🏛 ランドマーク</option>
      <option value="shop">🏪 店舗・施設</option><option value="danger">⚠ 危険エリア</option>
      <option value="religious">⛪ 宗教施設</option><option value="medical">🏥 医療施設</option>
      <option value="school">🏫 教育施設</option><option value="govt">🏛 官公庁</option>
      <option value="transport">🚉 交通</option><option value="water">🌊 水域</option>
      <option value="forest">🌲 森林・自然</option><option value="ruin">🏚 廃墟・遺跡</option>
    </optgroup>
    <optgroup label="屋内"><option value="normal">🚪 通常</option><option value="entry">🚪 入口</option>
      <option value="key">⭐ 重要</option><option value="secret">🔒 秘密</option></optgroup>`:`
    <optgroup label="✅ 屋内（推奨）">
      <option value="normal">🚪 通常</option><option value="entry">🚪 入口・出口</option>
      <option value="key">⭐ 重要</option><option value="danger">⚠ 危険</option><option value="secret">🔒 秘密</option>
    </optgroup>
    <optgroup label="屋外">
      <option value="outdoor">🌿 屋外エリア</option><option value="landmark">🏛 ランドマーク</option>
      <option value="shop">🏪 店舗・施設</option><option value="religious">⛪ 宗教施設</option>
      <option value="medical">🏥 医療</option><option value="school">🏫 学校</option>
      <option value="govt">🏛 官公庁</option><option value="transport">🚉 交通</option>
      <option value="water">🌊 水域</option><option value="forest">🌲 森林</option><option value="ruin">🏚 廃墟</option>
    </optgroup>`;
  catSel.value=isOut?'outdoor':'normal';
  const flSel=document.getElementById('roomFloor');
  flSel.innerHTML=S.floors.map(f=>`<option value="${f.id}"${f.id===MAP.curFloor?' selected':''}>${h(f.name)}</option>`).join('');
  injectTemplatePicker(isOut?'outdoor':'indoor');
  openModal('roomModal');
}

function editRoom(rid){
  const r=typeof rid==='string'?S.rooms.find(x=>x.id===rid):S.rooms[rid];
  if(!r)return;
  const fl=S.floors.find(f=>f.id===r.floorId)||curFloorObj();
  const isOut=fl?.type==='outdoor';
  document.getElementById('roomEid').value=r.id;
  document.getElementById('roomName').value=r.name||'';
  document.getElementById('roomNum').value=r.num||'';
  document.getElementById('roomDesc').value=r.desc||'';
  document.getElementById('roomClue').value=r.clue||'';
  document.getElementById('roomKp').value=r.kp||'';
  const catSel=document.getElementById('roomCat');
  // 簡易セレクト再構築（全カテゴリ表示）
  catSel.innerHTML=`
    <optgroup label="屋内"><option value="normal">🚪 通常</option><option value="entry">🚪 入口</option>
      <option value="key">⭐ 重要</option><option value="danger">⚠ 危険</option><option value="secret">🔒 秘密</option></optgroup>
    <optgroup label="屋外"><option value="outdoor">🌿 屋外エリア</option><option value="landmark">🏛 ランドマーク</option>
      <option value="shop">🏪 店舗</option><option value="religious">⛪ 宗教</option><option value="medical">🏥 医療</option>
      <option value="school">🏫 学校</option><option value="govt">🏛 官公庁</option><option value="transport">🚉 交通</option>
      <option value="water">🌊 水域</option><option value="forest">🌲 森林</option><option value="ruin">🏚 廃墟</option></optgroup>`;
  catSel.value=r.cat||'normal';
  const flSel=document.getElementById('roomFloor');
  flSel.innerHTML=S.floors.map(f=>`<option value="${f.id}"${f.id===r.floorId?' selected':''}>${h(f.name)}</option>`).join('');
  injectTemplatePicker(isOut?'outdoor':'indoor');
  openModal('roomModal');
}

function saveRoom(){
  const name=document.getElementById('roomName').value.trim();
  if(!name){toast('場所名を入力してください',true);return;}
  const eid=document.getElementById('roomEid');
  const existingId=eid.value;
  const floorId=document.getElementById('roomFloor').value||MAP.curFloor;
  if(existingId){
    const idx=S.rooms.findIndex(x=>x.id===existingId);
    if(idx>=0) S.rooms[idx]={...S.rooms[idx],name,num:document.getElementById('roomNum').value,
      cat:document.getElementById('roomCat').value,floorId,desc:document.getElementById('roomDesc').value,
      clue:document.getElementById('roomClue').value,kp:document.getElementById('roomKp').value};
  } else {
    // 座標：ドラッグ描画から来た場合はdataset、そうでなければ自動配置
    const rooms=roomsOnFloor(floorId);
    const g=gsize();
    const x=parseFloat(eid.dataset.x)||( 20 + (rooms.length%4)*160 );
    const y=parseFloat(eid.dataset.y)||( 20 + Math.floor(rooms.length/4)*100 );
    const w=parseFloat(eid.dataset.w)||(g*8);
    const h2=parseFloat(eid.dataset.h)||(g*5);
    S.rooms.push({id:uid(),name,num:document.getElementById('roomNum').value,
      cat:document.getElementById('roomCat').value,floorId,x,y,w,h:h2,
      desc:document.getElementById('roomDesc').value,clue:document.getElementById('roomClue').value,
      kp:document.getElementById('roomKp').value});
    MAP.selRoom=S.rooms[S.rooms.length-1].id;
  }
  closeModal('roomModal'); drawFp(); renderFpSide(); renderFpToolbar(); markDirty();
}

function deleteRoom(rid){
  const r=S.rooms.find(x=>x.id===rid);
  if(!r||!confirm(`「${r.name}」を削除しますか？`))return;
  S.rooms=S.rooms.filter(x=>x.id!==rid);
  S.edges=S.edges.filter(e=>e.aId!==rid&&e.bId!==rid);
  MAP.selRoom=null; drawFp(); renderFpSide(); renderFpToolbar(); markDirty();
}

function deleteSelected(){
  if(MAP.selFurniture){ fpSnapshot(); deleteFurniture(MAP.selFurniture); return; }
  if(MAP.selRoom)     { fpSnapshot(); deleteRoom(MAP.selRoom); return; }
  if(MAP.selEdge){
    if(!confirm('この接続を削除しますか？'))return;
    fpSnapshot();
    S.edges=S.edges.filter(e=>e.id!==MAP.selEdge);
    MAP.selEdge=null; drawFp(); renderFpToolbar(); markDirty();
  }
}
function deleteSelectedNode(){deleteSelected();}

function clearAllRooms(){
  const roomCount = S.rooms?.length || 0;
  const edgeCount = S.edges?.length || 0;
  const furnitureCount = S.furnitures?.length || 0;
  const floorCount = S.floors?.length || 0;
  if(!roomCount && !edgeCount && !furnitureCount && !floorCount){
    toast('削除対象のマップデータがありません', true);
    return;
  }
  if(!confirm(`マップデータを全消去して、屋内/屋外の選択画面へ戻します。\n部屋 ${roomCount}件 / 接続 ${edgeCount}件 / 家具設備 ${furnitureCount}件 / フロア ${floorCount}件`)) return;
  fpSnapshot();
  S.floors = [];
  S.rooms = [];
  S.edges = [];
  S.furnitures = [];
  MAP.curFloor = null;
  MAP.selRoom = null;
  MAP.selEdge = null;
  MAP.selFurniture = null;
  MAP.mode = 'select';
  MAP.connSrc = null;
  MAP.pendingFurniture = null;
  MAP.pendingFurnitureName = '';
  MAP.zoom = 1;
  MAP.pan = {x:0,y:0};
  renderMap();
  markDirty();
  toast('🧹 マップを初期化しました');
}

// ── 扉モーダル ──
function openEdgeModal(id){
  const e=S.edges.find(x=>x.id===id); if(!e)return;
  document.getElementById('edgeEid').value=id;
  document.getElementById('edgeType').value=e.type;
  document.getElementById('edgeNote').value=e.note||'';
  openModal('edgeModal');
}
function saveEdge(){
  const id=document.getElementById('edgeEid').value;
  const idx=S.edges.findIndex(x=>x.id===id);
  if(idx>=0){S.edges[idx].type=document.getElementById('edgeType').value;S.edges[idx].note=document.getElementById('edgeNote').value;}
  closeModal('edgeModal'); drawFp(); markDirty();
}
function deleteEdge(){
  const id=document.getElementById('edgeEid').value||MAP.selEdge;
  if(!id)return;
  S.edges=S.edges.filter(e=>e.id!==id);
  MAP.selEdge=null; closeModal('edgeModal'); drawFp(); renderFpToolbar(); markDirty();
}

// ── 自動整列 ──
function autoLayout(){
  const rooms=roomsOnFloor();
  if(!rooms.length)return;
  const g=gsize();
  const cols=Math.ceil(Math.sqrt(rooms.length));
  rooms.forEach((r,i)=>{r.x=20+(i%cols)*(( r.w||g*8)+20);r.y=20+(Math.floor(i/cols))*(( r.h||g*5)+20);});
  fpAutoFit(); markDirty(); toast('整列しました');
}

// ── createFirstFloor（ウェルカムから）──
function createFirstFloor(type){
  const name=type==='indoor'?'1F':'広域マップ';
  const f={id:uid(),name,type,note:''};
  S.floors.push(f); MAP.curFloor=f.id;
  showMapMain();
  // Canvasイベントを初期化してから描画
  setTimeout(()=>{resizeFpCanvas();initFpEvents();drawFp();renderMap();
    toast(type==='indoor'?'🏠 ▭ 部屋追加モードでドラッグして部屋を描いてください':'🌿 ▭ 部屋追加モードでドラッグしてエリアを描いてください');
    setFpMode('room');
  },50);
  markDirty();
}

// ── legacy shims ──
function selectRoom(i){if(S.rooms[i]){MAP.selRoom=S.rooms[i].id;drawFp();renderFpSide();}}
function clickNode(e,id){MAP.selRoom=id;drawFp();renderFpSide();}
function clickEdge(id){openEdgeModal(id);}

// ======= 地図記号テンプレート =======
const MAP_TEMPLATES = {
  indoor: [
    { group:'基本の部屋', items:[
      { name:'玄関・エントランス',  cat:'entry',  icon:'🚪', desc:'建物の入口。外から最初に足を踏み入れる場所。' },
      { name:'廊下',                cat:'normal', icon:'🚶', desc:'各部屋を繋ぐ通路。人の往来が多い。' },
      { name:'階段',                cat:'normal', icon:'🔼', desc:'上下階を繋ぐ階段。' },
      { name:'書斎・執務室',        cat:'key',    icon:'📚', desc:'机と書棚が並ぶ静かな部屋。重要な文書が眠っているかもしれない。' },
      { name:'居間・応接室',        cat:'normal', icon:'🛋', desc:'来客を迎える部屋。調度品が並ぶ。' },
      { name:'寝室',                cat:'normal', icon:'🛏', desc:'主人の私室。プライバシーが保たれている。' },
      { name:'食堂・ダイニング',    cat:'normal', icon:'🍽', desc:'食事をとる広い部屋。長いテーブルが中央に据えられている。' },
      { name:'台所・調理場',        cat:'normal', icon:'🍳', desc:'食事を準備する場所。鍋や食器が並ぶ。' },
      { name:'浴室・洗面所',        cat:'normal', icon:'🛁', desc:'水回りの設備がある部屋。' },
      { name:'物置・納戸',          cat:'normal', icon:'📦', desc:'雑多なものが押し込まれた薄暗い部屋。' },
    ]},
    { group:'特殊な部屋', items:[
      { name:'図書室・書庫',        cat:'key',    icon:'📖', desc:'大量の書籍が収められた部屋。手がかりが隠されているかもしれない。' },
      { name:'礼拝堂・祭壇室',      cat:'key',    icon:'🕯', desc:'宗教的な儀式が行われる小部屋。異様な雰囲気が漂う。' },
      { name:'地下室',              cat:'danger', icon:'⬇', desc:'薄暗く湿った地下空間。何かが隠されている予感がする。' },
      { name:'隠し部屋',            cat:'secret', icon:'🔒', desc:'通常の方法では発見できない秘密の空間。' },
      { name:'実験室・研究室',      cat:'danger', icon:'⚗', desc:'各種実験器具が並ぶ部屋。危険な薬品も置かれている。' },
      { name:'牢獄・拘禁室',        cat:'danger', icon:'⛓', desc:'鉄格子で仕切られた閉鎖空間。' },
      { name:'金庫室',              cat:'key',    icon:'🔐', desc:'重要な書類や財物が保管される施錠された部屋。' },
      { name:'資料室・アーカイブ',  cat:'key',    icon:'🗂', desc:'記録や文書が保管された部屋。調査の手がかりが眠る。' },
      { name:'屋根裏',              cat:'secret', icon:'🕷', desc:'埃が積もった薄暗い屋根裏空間。' },
    ]},
    { group:'病院・大型施設', items:[
      { name:'診察室',              cat:'normal', icon:'🩺', desc:'医師が患者を診察する部屋。医療器具が並ぶ。' },
      { name:'手術室',              cat:'danger', icon:'🔪', desc:'手術が行われる無菌の部屋。強い照明が照らす。' },
      { name:'病室・病棟',          cat:'normal', icon:'🛏', desc:'患者が収容されている区画。' },
      { name:'霊安室・遺体安置所',  cat:'danger', icon:'💀', desc:'遺体が安置される冷たい部屋。' },
      { name:'警備室',              cat:'normal', icon:'👁',  desc:'施設の警備員が常駐する部屋。監視カメラの映像が映る。' },
    ]},
  ],
  outdoor: [
    { group:'宗教・文化施設', items:[
      { name:'教会・礼拝堂',          cat:'religious', icon:'⛪', desc:'地域の人々が礼拝に集まる場所。尖塔が空に向かって伸びる。' },
      { name:'神社・寺院',            cat:'religious', icon:'⛩',  desc:'古くからの信仰の場。境内には古い石碑が立つ。' },
      { name:'墓地・霊園',            cat:'religious', icon:'🪦', desc:'無数の墓石が並ぶ静寂の場所。夜には人が来ない。' },
      { name:'博物館・美術館',        cat:'landmark',  icon:'🏛', desc:'歴史的な展示物が並ぶ建物。秘密が眠るコレクションがある。' },
      { name:'図書館',                cat:'landmark',  icon:'📚', desc:'膨大な蔵書を誇る公共施設。古い記録文書も保管されている。' },
      { name:'劇場・ホール',          cat:'landmark',  icon:'🎭', desc:'演劇や催し物が行われる大型施設。' },
    ]},
    { group:'官公庁・公共施設', items:[
      { name:'警察署',                cat:'govt', icon:'🚔', desc:'地域の治安を担う警察の建物。調書や記録が保管されている。' },
      { name:'市役所・役場',          cat:'govt', icon:'🏛', desc:'行政手続きが行われる公共施設。公的記録が保管されている。' },
      { name:'裁判所',                cat:'govt', icon:'⚖',  desc:'法的な判断が下される重厚な建物。' },
      { name:'刑務所・拘置所',        cat:'govt', icon:'⛓', desc:'受刑者が収容される厳重に管理された施設。' },
      { name:'消防署',                cat:'govt', icon:'🚒', desc:'消防士が待機する施設。' },
      { name:'郵便局',                cat:'shop', icon:'📮', desc:'郵便物の取り扱いを行う施設。情報のやりとりが行われる。' },
    ]},
    { group:'医療・教育施設', items:[
      { name:'病院・診療所',          cat:'medical', icon:'🏥', desc:'患者の治療を行う医療施設。' },
      { name:'精神病院・療養所',      cat:'medical', icon:'🏥', desc:'精神疾患の患者が収容される閉鎖的な施設。' },
      { name:'薬局・薬店',            cat:'medical', icon:'💊', desc:'薬品が販売される店舗。特殊な薬も入手できるかもしれない。' },
      { name:'大学・学校',            cat:'school',  icon:'🏫', desc:'学術研究が行われる高等教育機関。' },
      { name:'研究所・研究機関',      cat:'school',  icon:'🔬', desc:'最先端の研究が行われる施設。危険な実験も？' },
    ]},
    { group:'商業・宿泊施設', items:[
      { name:'ホテル・旅館',          cat:'shop',      icon:'🏨', desc:'旅人が宿泊する施設。様々な客が出入りする。' },
      { name:'バー・酒場',            cat:'shop',      icon:'🍺', desc:'酒と情報が飛び交う薄暗い店。' },
      { name:'レストラン・食堂',      cat:'shop',      icon:'🍽', desc:'食事を提供する店。地域の人が集まる。' },
      { name:'古書店',                cat:'shop',      icon:'📖', desc:'古い本や希少文献が並ぶ店。まれに禁断の書物も。' },
      { name:'骨董品店・質屋',        cat:'shop',      icon:'🏺', desc:'古物や貴重品が集まる店。曰くつきの品もある。' },
      { name:'鉄道駅',                cat:'transport', icon:'🚉', desc:'鉄道が発着する交通の要所。' },
      { name:'港・波止場',            cat:'transport', icon:'⚓', desc:'船が停泊し、積み荷が行き交う場所。' },
      { name:'港湾倉庫',              cat:'shop',      icon:'🏭', desc:'港湾地区に建つ大型倉庫。怪しい荷物が保管されている。' },
    ]},
    { group:'自然・地形', items:[
      { name:'森・林',                cat:'forest',  icon:'🌲', desc:'鬱蒼と茂る樹木に覆われた区域。迷いやすい。' },
      { name:'川・河川',              cat:'water',   icon:'🌊', desc:'水の流れる地帯。氾濫の痕跡が残る。' },
      { name:'湖・池',                cat:'water',   icon:'🏞', desc:'静寂に満ちた水面。何かが沈んでいるかもしれない。' },
      { name:'海岸・浜辺',            cat:'water',   icon:'🏖', desc:'波が打ち寄せる海岸線。孤立した場所だ。' },
      { name:'沼・湿地',              cat:'water',   icon:'🌿', desc:'足をとられる湿った地帯。不気味な霧が立ち込める。' },
      { name:'丘・高台',              cat:'outdoor', icon:'⛰',  desc:'周囲を見渡せる高台。遠くの異変に気づける。' },
      { name:'洞窟・地下道',          cat:'danger',  icon:'🕳', desc:'深く暗い地下空間。奥に何かがいる気配がする。' },
    ]},
    { group:'廃墟・怪異スポット', items:[
      { name:'廃屋・廃墟',            cat:'ruin', icon:'🏚', desc:'かつて栄えた建物が朽ち果てた残骸。' },
      { name:'廃工場・廃倉庫',        cat:'ruin', icon:'🏭', desc:'機械が錆びつき廃棄された工場跡。' },
      { name:'廃病院',                cat:'ruin', icon:'🏥', desc:'医療機器が放置されたまま廃墟と化した病院。' },
      { name:'廃寺・廃教会',          cat:'ruin', icon:'⛪', desc:'信者がいなくなった宗教施設の廃墟。' },
      { name:'古代遺跡',              cat:'ruin', icon:'🗿', desc:'文明の痕跡を留める古代の構造物。' },
      { name:'儀式場・祭祀跡',        cat:'danger', icon:'🕯', desc:'何らかの儀式が行われた形跡がある場所。' },
    ]},
  ]
};

let _tplPickerOpen = true;

function injectTemplatePicker(floorType) {
  const wrap = document.getElementById('tplPickerWrap');
  if (!wrap) return;
  const type = floorType || 'indoor';
  const groups = MAP_TEMPLATES[type] || [];
  const groupsHtml = groups.map(g => `
    <div class="tpl-group-name">${g.group}</div>
    <div class="tpl-chips">
      ${g.items.map(item =>
        `<button class="tpl-chip" onclick="applyTemplate('${item.name.replace(/'/g,"\\'")}','${item.cat}','${item.desc.replace(/'/g,"\\'")}')">
          <span class="tpl-chip-icon">${item.icon}</span>${h(item.name)}
        </button>`).join('')}
    </div>`).join('');
  wrap.innerHTML = `
    <div class="tpl-picker-hd">
      <span class="tpl-picker-lbl">📍 入力候補から選択</span>
      <button class="tpl-picker-toggle" id="tplToggleBtn" onclick="toggleTplPicker()">${_tplPickerOpen ? '▲ 折りたたむ' : '▼ 展開する'}</button>
    </div>
    <div class="tpl-groups" id="tplGroups" style="display:${_tplPickerOpen ? '' : 'none'}">${groupsHtml}</div>`;
}

function toggleTplPicker() {
  _tplPickerOpen = !_tplPickerOpen;
  const groups = document.getElementById('tplGroups');
  const btn = document.getElementById('tplToggleBtn');
  if (groups) groups.style.display = _tplPickerOpen ? '' : 'none';
  if (btn) btn.textContent = _tplPickerOpen ? '▲ 折りたたむ' : '▼ 展開する';
}

function applyTemplate(name, cat, desc) {
  document.getElementById('roomName').value = name;
  document.getElementById('roomDesc').value = desc;
  const catSel = document.getElementById('roomCat');
  if (catSel && cat) { catSel.value = cat; }
  document.querySelectorAll('.tpl-chip').forEach(c => c.classList.remove('chosen'));
  // ハイライト：data属性ではなくテキスト比較
  document.querySelectorAll('.tpl-chip').forEach(c => { if (c.textContent.trim().includes(name)) c.classList.add('chosen'); });
  document.getElementById('roomName').focus();
}

// ======= TIMELINE =======
function renderTimeline() {
  const list = document.getElementById('timelineList');
  if (!S.timeline.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">⏰</div><p>イベントをまだ追加していません</p></div>';
    return;
  }
  const chipMap = { event:['tc-event','イベント'], combat:['tc-combat','戦闘'], reveal:['tc-reveal','手がかり'] };
  list.innerHTML = S.timeline.map((e, i) => {
    const [cls, lbl] = chipMap[e.tag] || chipMap.event;
    return `<div class="tl-event" id="tl-${i}"
      ondragover="tlDragOver(event,${i})"
      ondragleave="tlDragLeave(event,${i})"
      ondrop="tlDrop(event,${i})"
      ondragend="tlDragEnd()">
      <div class="tl-spine">
        <span class="tl-drag-handle" title="ドラッグして並び替え"
          draggable="true"
          ondragstart="tlDragStart(event,${i})"
          ondragend="tlDragEnd()">
          <span class="grip-dots"><span></span><span></span><span></span><span></span><span></span><span></span></span>
        </span>
        <div class="tl-dot"></div>
        ${i < S.timeline.length - 1 ? '<div class="tl-line"></div>' : ''}
      </div>
      <div class="tl-body">
        <div class="tl-when">${h(e.time||'')}</div>
        <div class="tl-title">${h(e.title||'')}</div>
        <div class="tl-desc">${h(e.desc||'')}</div>
        <span class="tl-chip ${cls}">${lbl}</span>
        <div class="tl-actions">
          <button class="btn btn-sm" onclick="editTL(${i})">✏ 編集</button>
          <button class="btn btn-sm btn-danger" onclick="deleteTL(${i})">🗑</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ======= DRAG & DROP — 時系列 =======
let _tlDrag = null;

function tlDragStart(e, i) {
  _tlDrag = i;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', i);
  setTimeout(() => document.getElementById(`tl-${i}`)?.classList.add('tl-dnd-ghost'), 0);
}

function tlDragOver(e, i) {
  if (_tlDrag === null || _tlDrag === i) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const el = document.getElementById(`tl-${i}`);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const half = e.clientY < rect.top + rect.height / 2;
  el.classList.toggle('tl-dnd-over-top',    half);
  el.classList.toggle('tl-dnd-over-bottom', !half);
}

function tlDragLeave(e, i) {
  const el = document.getElementById(`tl-${i}`);
  el?.classList.remove('tl-dnd-over-top', 'tl-dnd-over-bottom');
}

function tlDrop(e, i) {
  e.preventDefault();
  if (_tlDrag === null || _tlDrag === i) return;
  const el = document.getElementById(`tl-${i}`);
  const rect = el?.getBoundingClientRect();
  const insertAfter = rect ? e.clientY >= rect.top + rect.height / 2 : false;
  const moved = S.timeline.splice(_tlDrag, 1)[0];
  let target = i > _tlDrag ? i - 1 : i;
  if (insertAfter) target += 1;
  S.timeline.splice(target, 0, moved);
  _tlDrag = null;
  renderTimeline(); markDirty();
}

function tlDragEnd() {
  _tlDrag = null;
  document.querySelectorAll('.tl-event').forEach(el =>
    el.classList.remove('tl-dnd-ghost', 'tl-dnd-over-top', 'tl-dnd-over-bottom')
  );
}

function openTLModal() {
  ['tlEid','tlTime','tlTitle','tlDesc'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('tlTag').value = 'event';
  openModal('tlModal');
}

function editTL(i) {
  const e = S.timeline[i];
  document.getElementById('tlEid').value = i;
  document.getElementById('tlTime').value = e.time||'';
  document.getElementById('tlTag').value = e.tag||'event';
  document.getElementById('tlTitle').value = e.title||'';
  document.getElementById('tlDesc').value = e.desc||'';
  openModal('tlModal');
}

function saveTL() {
  const title = document.getElementById('tlTitle').value.trim();
  if (!title) { toast('タイトルを入力してください', true); return; }
  const e = { time: document.getElementById('tlTime').value, tag: document.getElementById('tlTag').value,
    title, desc: document.getElementById('tlDesc').value };
  const id = document.getElementById('tlEid').value;
  if (id !== '') S.timeline[parseInt(id)] = e; else S.timeline.push(e);
  closeModal('tlModal'); renderTimeline(); markDirty();
}

function deleteTL(i) {
  if (!confirm('このイベントを削除しますか？')) return;
  S.timeline.splice(i, 1); renderTimeline(); markDirty();
}

// ======= PLOT =======
function renderPlots() {
  const g = document.getElementById('plotGrid');
  if (!S.plots.length) {
    g.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>フェーズをまだ追加していません</p></div>`;
    return;
  }
  g.innerHTML = S.plots.map((p, i) => {
    const items = (p.items||'').split('\n').filter(x=>x.trim());
    return `<div class="phase-card">
      <div class="phase-meta">
        <div class="phase-num">フェーズ ${i+1}</div>
        <div class="phase-name">${h(p.name||'')}</div>
        <div class="phase-goal">${h(p.goal||'')}</div>
      </div>
      <div class="phase-content">
        <div class="phase-items">${items.map(it=>`<div class="phase-item">${h(it)}</div>`).join('')}</div>
        ${p.note ? `<div class="phase-note">📌 ${h(p.note)}</div>` : ''}
      </div>
      <div class="phase-actions">
        <button class="phase-edit-btn" onclick="editPlot(${i})">✏ 編集</button>
        <button class="phase-edit-btn" onclick="deletePlot(${i})" style="color:var(--red-600)">🗑 削除</button>
      </div>
    </div>`;
  }).join('');
}

function openPlotModal() {
  ['plotEid','plotName','plotGoal','plotItems','plotNote'].forEach(id => document.getElementById(id).value = '');
  openModal('plotModal');
}

function editPlot(i) {
  const p = S.plots[i];
  document.getElementById('plotEid').value = i;
  document.getElementById('plotName').value = p.name||'';
  document.getElementById('plotGoal').value = p.goal||'';
  document.getElementById('plotItems').value = p.items||'';
  document.getElementById('plotNote').value = p.note||'';
  openModal('plotModal');
}

function savePlot() {
  const name = document.getElementById('plotName').value.trim();
  if (!name) { toast('フェーズ名を入力してください', true); return; }
  const p = { name, goal: document.getElementById('plotGoal').value,
    items: document.getElementById('plotItems').value, note: document.getElementById('plotNote').value };
  const id = document.getElementById('plotEid').value;
  if (id !== '') S.plots[parseInt(id)] = p; else S.plots.push(p);
  closeModal('plotModal'); renderPlots(); markDirty();
}

function deletePlot(i) {
  if (!confirm('このフェーズを削除しますか？')) return;
  S.plots.splice(i, 1); renderPlots(); markDirty();
}

// ======= TEXT EXPORT =======
function exportText() {
  const lines = [];
  const titleText = (S.title || '').trim() || '執筆ドキュメント';
  if ((S.writingMode || 'horizontal') === 'vertical') {
    toast('ただいま縦書き対応の出力機能は利用できません', true, 4000);
    return;
  }
  const now = new Date();
  const dt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const textTemplateKey = isTrpgMode() ? 'trpg' : (S.writingTemplate || 'default');
  const TEXT_TEMPLATE_DEF = {
    trpg:   { contentTitle: '本文', scenePrefix: 'SCENE', gameHeader: 'メモ ／ 処理' },
    default:{ contentTitle: '本文', scenePrefix: 'SECTION', gameHeader: 'メモ ／ 処理' },
    novel:  { contentTitle: '本文', scenePrefix: 'CHAPTER', gameHeader: '補助メモ' },
    script: { contentTitle: '脚本本文', scenePrefix: 'SCENE', gameHeader: '演出指示' },
    article:{ contentTitle: '記事本文', scenePrefix: 'PART', gameHeader: '注記' },
  };
  const textTpl = TEXT_TEMPLATE_DEF[textTemplateKey] || TEXT_TEMPLATE_DEF.default;

  const add = (s = '') => lines.push(String(s));
  const addBlock = (label, text) => {
    if (!text) return;
    add(`${label}`);
    add(`${String(text).trim()}`);
  };

  add(`# ${titleText}`);
  add(`出力日時: ${dt}`);
  add('');

  if (S.scenes.some(sc => sc.blocks && sc.blocks.length)) {
    add(`## ${textTpl.contentTitle}`);
    add('');
    S.scenes.forEach((sc, sIdx) => {
      if (!sc.blocks || !sc.blocks.length) return;
      add(`### ${textTpl.scenePrefix} ${sIdx + 1}: ${sc.name || ''}`);
      add('');
      (sc.blocks || []).forEach(b => {
        const content = (b.content || '').trim();
        if (b.type === 'scene') {
          if (content) add(content);
          add('');
          return;
        }
        if (b.type === 'dialog') {
          const spk = (b.speaker || '').trim();
          add(spk ? `【${spk}】` : '【セリフ】');
          if (content) add(content);
          add('');
          return;
        }
        if (b.type === 'game') {
          add(`【${textTpl.gameHeader}】`);
          if (content) add(content);
          add('');
          return;
        }
        if (b.type === 'pagebreak') {
          add('--- 改ページ ---');
          add('');
          return;
        }
        if (b.type === 'artifact') {
          const a = b.refData || {};
          add(`【アイテム参照】${a.name || ''}`);
          if (a.type) add(`種別: ${a.type}`);
          if (a.desc) add(`説明: ${a.desc}`);
          if (a.san) add(`影響: ${a.san}`);
          if (a.req) add(`使用条件: ${a.req}`);
          if (a.effect) add(`効果: ${a.effect}`);
          add('');
          return;
        }
        if (b.type === 'timeline') {
          const e = b.refData || {};
          const chipLbl = { event: 'イベント', combat: '戦闘', reveal: '手がかり' }[e.tag] || 'イベント';
          add(`【時系列参照】${e.title || ''}`);
          if (e.time) add(`時刻: ${e.time}`);
          add(`種別: ${chipLbl}`);
          if (e.desc) add(`内容: ${e.desc}`);
          add('');
          return;
        }
        if (b.type === 'plot') {
          const p = b.refData || {};
          add(`【プロット参照】${p.name || ''}`);
          if (p.goal) add(`目標: ${p.goal}`);
          if (p.items) addBlock('項目:', p.items);
          if (p.note) add(`メモ: ${p.note}`);
          add('');
          return;
        }
        if (b.type === 'map') {
          add('【マップ参照】画像媒体のためテキスト出力では省略');
          add('');
          return;
        }
      });
    });
  }

  if (S.npcs.length) {
    add('## キャラクター一覧');
    add('');
    S.npcs.forEach((n, idx) => {
      add(`${idx + 1}. ${n.name || '名称未設定'}`);
      if (n.role) add(`役割・職業: ${n.role}`);
      if (n.tags) add(`タグ: ${n.tags}`);
      if (n.alignment) {
        const alignLabel = { ally: '味方', enemy: '敵', neutral: '中立', unknown: '不明' };
        add(`陣営: ${alignLabel[n.alignment] || n.alignment}`);
      }
      if (n.desc) addBlock('説明:', n.desc);
      if (n.skills && n.skills.length) {
        add('項目:');
        n.skills.forEach(s => {
          const parts = [s.name || '項目'];
          if (s.val !== undefined && s.val !== null && s.val !== '') parts.push(`値 ${s.val}`);
          if (s.note) parts.push(`補足 ${s.note}`);
          add(`- ${parts.join(' / ')}`);
        });
      }
      if (n.weapons) addBlock('装備・関連情報:', n.weapons);
      if (n.abilities) addBlock('補足事項:', n.abilities);
      if (n.secret) addBlock('非公開メモ:', n.secret);
      add('');
    });
  }

  if (S.artifacts.length) {
    add('## アイテム');
    add('');
    S.artifacts.forEach((a, idx) => {
      add(`${idx + 1}. ${a.name || '名称未設定'}`);
      if (a.type) add(`種別: ${a.type}`);
      if (a.san) add(`影響: ${a.san}`);
      if (a.desc) addBlock('説明:', a.desc);
      if (a.req) add(`使用条件: ${a.req}`);
      if (a.effect) addBlock('効果:', a.effect);
      if (a.kp) addBlock('非公開メモ:', a.kp);
      add('');
    });
  }

  if (S.timeline.length) {
    add('## 時系列');
    add('');
    const chipLbl = { event: 'イベント', combat: '戦闘', reveal: '重要な手がかり' };
    S.timeline.forEach((e, idx) => {
      add(`${idx + 1}. ${e.title || 'タイトル未設定'}`);
      if (e.time) add(`時刻: ${e.time}`);
      add(`種別: ${chipLbl[e.tag] || 'イベント'}`);
      if (e.desc) addBlock('内容:', e.desc);
      add('');
    });
  }

  if (S.plots.length) {
    add('## プロット');
    add('');
    S.plots.forEach((p, idx) => {
      add(`PHASE ${idx + 1}: ${p.name || '名称未設定'}`);
      if (p.goal) add(`目標: ${p.goal}`);
      if (p.items) addBlock('項目:', p.items);
      if (p.note) addBlock('メモ:', p.note);
      add('');
    });
  }

  add('## 備考');
  add('- マップデータおよび画像媒体の情報はテキスト出力対象外です。');

  const title = (S.title || 'kakigoto_scenario').replace(/[\\/:*?"<>|]/g, '_');
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const filename = `${title}_${datePart}.txt`;
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`📝 「${filename}」をダウンロードしました`);
}

// ======= PDF EXPORT =======
async function exportPDF() {
  if ((S.writingMode || 'horizontal') === 'vertical') {
    toast('ただいま縦書き対応の出力機能は利用できません', true, 4000);
    return;
  }
  // マップ画像を事前生成（フロアごと）
  const floorImgs = {};
  if (S.floors && S.floors.length) {
    for (const fl of S.floors) {
      if (S.rooms.some(r => r.floorId === fl.id)) {
        floorImgs[fl.id] = await generateFloorDataUrl(fl.id);
        if (floorImgs[fl.id]) MAP_REF_IMAGE_CACHE[fl.id] = floorImgs[fl.id];
      }
    }
  }

  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function nl(s) { return esc(s).replace(/\n/g,'<br>'); }

  const w = window.open('', '_blank');
  const titleText = S.title && S.title.trim() ? S.title.trim() : '執筆ドキュメント';
  const pdfTemplateKey = isTrpgMode() ? 'trpg' : (S.writingTemplate || 'default');
  const PDF_TEMPLATE_DEF = {
    trpg:   { coverSub: 'WRITING PROJECT DOCUMENT', contentTitle: '本文', scenePrefix: 'SCENE',   gameHeader: 'メモ ／ 処理' },
    default:{ coverSub: 'WRITING PROJECT DOCUMENT', contentTitle: '本文', scenePrefix: 'SECTION', gameHeader: 'メモ ／ 処理' },
    novel:  { coverSub: 'NOVEL MANUSCRIPT',         contentTitle: '本文', scenePrefix: 'CHAPTER', gameHeader: '補助メモ' },
    script: { coverSub: 'SCRIPT DOCUMENT',          contentTitle: '脚本本文', scenePrefix: 'SCENE', gameHeader: '演出指示' },
    article:{ coverSub: 'ARTICLE DRAFT',            contentTitle: '記事本文', scenePrefix: 'PART',  gameHeader: '注記' },
  };
  const pdfTpl = PDF_TEMPLATE_DEF[pdfTemplateKey] || PDF_TEMPLATE_DEF.default;

  // NPC色マップ
  const npcColorMap = {};
  S.npcs.forEach(n => { if (n.color) npcColorMap[n.name] = n.color; });
  function resolveColor(b) {
    return b.color || npcColorMap[b.speaker] || '';
  }
  function hexRgba(hex, a) {
    if (!hex) return '';
    const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b2=parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b2},${a})`;
  }

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;500;700&family=Noto+Sans+JP:wght@400;500;700&display=swap');
    @page{size:A4;margin:${PDF_PAGE_PADDING_TOP}px ${PDF_PAGE_PADDING_X}px ${PDF_PAGE_PADDING_BOTTOM}px}
    *{box-sizing:border-box;margin:0;padding:0}
    :root{
      --ink:#1a1a2e;
      --ink-muted:#4a4a6a;
      --ink-faint:#8888aa;
      --paper:#fdfcf8;
      --rule:#d0cfc4;
      --blue:#185fa5;
      --blue-lt:#e6f1fb;
      --green:#2d5a1b;
      --green-lt:#eaf3de;
      --amber:#6b3d00;
      --amber-lt:#fdf3e3;
      --red-lt:#fcebeb;
      --red:#7a1f1f;
    }
    body{
      font-family:'Noto Serif JP','Hiragino Mincho ProN','Yu Mincho',Georgia,serif;
      font-size:11pt;line-height:1.9;color:var(--ink);
      background:var(--paper);
      max-width:${PDF_CONTENT_WIDTH}px;margin:0 auto;padding:0;
    }
    body.pdf-template-article{
      font-family:'Noto Sans JP','Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif;
      background:#fbfcfd;
    }
    body.pdf-template-script{
      font-family:'Noto Sans JP','Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif;
      background:#fcfcfa;
    }

    /* ── 表紙風タイトル ── */
    .cover{text-align:center;padding:32px 0 28px;border-bottom:2px solid var(--ink);margin-bottom:32px}
    .cover-kana{font-size:9pt;letter-spacing:0.3em;color:var(--ink-muted);font-family:'Noto Sans JP',sans-serif;margin-bottom:6px}
    .cover-title{font-size:22pt;font-weight:700;letter-spacing:0.05em;line-height:1.3}
    .cover-rule{width:60px;height:2px;background:var(--blue);margin:14px auto}
    body.pdf-template-novel .cover{padding-top:40px;border-bottom:1px solid #b8b8c8}
    body.pdf-template-script .cover{border:2px solid #d8dbe2;border-radius:10px;padding:20px 18px;margin-bottom:24px;background:#fff}
    body.pdf-template-article .cover{padding:18px 0 16px;border-bottom:1px solid #d7dfeb;margin-bottom:22px}
    body.pdf-template-article .cover-title{font-size:20pt;letter-spacing:0.02em}
    body.pdf-template-article .cover-kana{letter-spacing:0.18em}

    /* ── セクション見出し ── */
    .sec{margin:36px 0 16px;display:flex;align-items:center;gap:10px}
    .sec-icon{width:28px;height:28px;border-radius:6px;background:var(--blue);display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .sec-icon svg{width:15px;height:15px;stroke:#fff;fill:none;stroke-width:2}
    .sec-title{font-size:13pt;font-weight:700;font-family:'Noto Sans JP',sans-serif;color:var(--blue);letter-spacing:0.04em}
    .sec-line{flex:1;height:1px;background:var(--rule)}

    /* ── シーン見出し ── */
    .scene-hd{margin:22px 0 10px;padding:8px 14px;background:var(--blue-lt);border-radius:6px;display:flex;align-items:baseline;gap:8px}
    .scene-hd + .b-scene,
    .scene-hd + .b-dialog,
    .scene-hd + .b-game,
    .scene-hd + .b-ref,
    .scene-hd + .b-pagebreak{margin-top:28px}
    .scene-num{font-size:8pt;font-weight:700;letter-spacing:0.12em;color:var(--blue);font-family:'Noto Sans JP',sans-serif;flex-shrink:0}
    .scene-name{font-size:11pt;font-weight:700;color:var(--ink);font-family:'Noto Sans JP',sans-serif}
    body.pdf-template-novel .scene-hd{background:transparent;border-bottom:1px solid #cfd2d8;border-radius:0;padding:0 0 5px;margin:28px 0 14px}
    body.pdf-template-novel .scene-num{font-size:8.5pt;color:#56617a}
    body.pdf-template-script .scene-hd{background:#f2f5f8;border-left:4px solid #8092aa;border-radius:4px}
    body.pdf-template-article .scene-hd{background:transparent;border-left:3px solid #378add;border-radius:0;padding:0 0 0 8px;margin:24px 0 12px}

    /* ── ブロック：場面描写 ── 地の文・小説スタイル */
    .b-scene{
      font-size:10.5pt;line-height:2.05;color:var(--ink);
      margin:0;padding:0;
      text-indent:1em;
      break-inside:avoid;
      page-break-inside:avoid;
      -webkit-column-break-inside:avoid;
      orphans:999;
      widows:999;
    }
    /* 場面描写が連続するとき段落間にわずかな余白 */
    .b-scene + .b-scene{ margin-top:4px; }

    /* ── ブロック：セリフ ── 台本ライン形式 */
    .b-dialog{
      margin:6px 1px;
      padding:5px 0 5px 14px;
      border-left:2.5px solid var(--green);
      position:relative;
      break-inside:avoid;
      page-break-inside:avoid;
      -webkit-column-break-inside:avoid;
    }
    /* 話者名バッジ */
    .dialog-speaker-badge{
      display:inline-block;
      font-size:8.5pt;font-weight:700;
      font-family:'Noto Sans JP',sans-serif;
      color:var(--green);
      margin-bottom:2px;
      letter-spacing:0.04em;
    }
    .dialog-speaker-badge::after{ content:'　—'; color:var(--ink-faint); font-weight:400; }
    /* 話者なしの場合 */
    .dialog-no-speaker{
      font-size:8.5pt;color:var(--ink-faint);
      font-family:'Noto Sans JP',sans-serif;
      margin-bottom:2px;
    }
    /* セリフ本文 */
    .dialog-line{
      font-size:10.5pt;line-height:1.9;color:var(--ink);
    }
    /* セリフが複数連続するとき少し詰める */
    .b-dialog + .b-dialog{ margin-top:2px; }
    /* 場面描写→セリフ、セリフ→場面描写の切り替わりに余白 */
    .b-scene + .b-dialog,
    .b-dialog + .b-scene{ margin-top:10px; }
    body.pdf-template-script .b-scene{font-family:'Noto Sans JP',sans-serif;text-indent:0;font-size:10pt;line-height:1.8;color:#4a5568}
    body.pdf-template-script .b-dialog{background:#f8fbff;border-left:3px solid #6d8fc0;border-radius:4px;padding:8px 10px 8px 12px}
    body.pdf-template-script .dialog-speaker-badge{font-size:8pt;letter-spacing:0.08em;text-transform:uppercase}
    body.pdf-template-article .b-scene{font-family:'Noto Sans JP',sans-serif;text-indent:0;font-size:10.2pt;line-height:1.92}
    body.pdf-template-article .b-dialog{border-left-width:2px;background:#f7fafc}

    /* ── ブロック：ゲーム処理 ── KP専用の囲み欄（ここだけ明確に区別） */
    .b-game{
      margin:16px 1px;
      border-radius:6px;
      overflow:visible;
      /* 点線で「本文の外」感を演出 */
      border:1px dashed #c8b87a;
      background:#fffdf5;
      position:relative;
      box-decoration-break:clone;
      -webkit-box-decoration-break:clone;
      break-inside:avoid;
      page-break-inside:avoid;
      -webkit-column-break-inside:avoid;
    }
    /* 左端に縦ライン */
    .b-game::before{
      content:'';position:absolute;left:0;top:0;bottom:0;
      width:4px;background:var(--amber-lt);
      border-right:1px solid #c8b87a;
    }
    .b-game-hd{
      padding:5px 12px 5px 16px;
      display:flex;align-items:center;gap:7px;
      border-bottom:1px dashed #c8b87a;
    }
    .b-game-hd-lbl{
      font-size:8pt;font-weight:700;
      font-family:'Noto Sans JP',sans-serif;
      color:var(--amber);letter-spacing:0.12em;
      text-transform:uppercase;
    }
    .b-game-hd-dice{ font-size:12px; }
    .b-game-body{
      padding:8px 14px 8px 16px;
      font-size:10pt;line-height:1.85;
      font-family:'Noto Sans JP',sans-serif;
      color:var(--ink);
    }
    /* ゲーム処理ブロックは前後に余白を多めに */
    .b-scene + .b-game,
    .b-dialog + .b-game{ margin-top:18px; }
    .b-game + .b-scene,
    .b-game + .b-dialog{ margin-top:18px; }

    /* ── 参照ブロック共通 ── */
    .b-ref{margin:14px 0;border-radius:6px;padding:10px 14px;break-inside:avoid;page-break-inside:avoid;-webkit-column-break-inside:avoid}
    .b-ref-lbl{font-size:8pt;font-weight:700;letter-spacing:0.1em;margin-bottom:6px;opacity:0.75}
    .b-ref-name{font-size:11pt;font-weight:700;margin-bottom:4px}
    .b-ref-sub{font-size:9pt;color:#64748b;margin-bottom:6px}
    .b-ref-body{font-size:9.5pt;line-height:1.75;color:#374151}
    .b-ref-box{margin-top:7px;padding:6px 9px;border-radius:4px;font-size:9pt;line-height:1.6}
    /* アーティファクト */
    .b-ref-artifact{border:1.5px solid #c8b87a;background:#fffdf5;border-left:4px solid #ba7517}
    .b-ref-artifact .b-ref-lbl{color:#854f0b}
    .b-ref-artifact .b-ref-box{background:#faeeda;color:#854f0b}
    .b-ref-san{display:inline-block;font-size:8.5pt;padding:2px 8px;border-radius:10px;background:#fcebeb;color:#a32d2d;font-weight:700;margin:4px 0}
    /* マップ */
    .b-ref-map{border:1.5px solid #b5c8e8;background:#f5f9ff;border-left:4px solid #3a8fd4}
    .b-ref-map .b-ref-lbl{color:#2869a3}
    .b-ref-map .b-ref-box{background:#e6f1fb;color:#185fa5}
    /* 時系列 */
    .b-ref-timeline{border:1.5px solid #a8d8c8;background:#f5fff8;border-left:4px solid #3aaa8c}
    .b-ref-timeline .b-ref-lbl{color:#1e7a60}
    .b-ref-tl-chip{display:inline-block;font-size:8pt;padding:2px 8px;border-radius:10px;margin-top:4px;font-weight:600}
    /* プロット */
    .b-ref-plot{border:1.5px solid #d8b5e8;background:#faf5ff;border-left:4px solid #9b59b6}
    .b-ref-plot .b-ref-lbl{color:#7b3fa0}
    .b-ref-plot-item{font-size:9.5pt;color:#374151;padding:2px 0}
    .b-ref-plot-item::before{content:"▸ ";color:#9b59b6}
    .keep-next{break-after:avoid;page-break-after:avoid}
    .keep-next + *{break-before:avoid;page-break-before:avoid}
    .b-pagebreak{height:0;margin:0;padding:0;border:0;break-after:page;page-break-after:always}

    /* ── NPC ── */
    .npc-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:4px}
    .npc-box{border:1px solid var(--rule);border-radius:8px;overflow:hidden;break-inside:avoid}
    .npc-box-hd{background:var(--blue-lt);padding:10px 14px;border-bottom:1px solid #ccdff5}
    .npc-box-name{font-size:11pt;font-weight:700;font-family:'Noto Sans JP',sans-serif}
    .npc-box-role{font-size:8.5pt;color:var(--ink-muted);font-family:'Noto Sans JP',sans-serif;margin-top:1px}
    .npc-box-body{padding:10px 14px}
    .stats{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px}
    .stat{font-size:8pt;font-family:'Noto Sans JP',sans-serif;font-weight:700;padding:2px 7px;border-radius:4px;background:var(--blue-lt);color:var(--blue)}
    .npc-desc{font-size:9.5pt;color:var(--ink-muted);line-height:1.7}
    .npc-secret{margin-top:7px;padding:6px 10px;background:var(--amber-lt);border-radius:4px;font-size:9pt;font-family:'Noto Sans JP',sans-serif;color:var(--amber)}
    .npc-section-lbl{font-size:8.5pt;font-weight:700;color:var(--blue);letter-spacing:0.05em;margin-top:7px;margin-bottom:3px;text-transform:uppercase}
    .npc-skill-section{margin-top:8px}
    .skill-table{width:100%;border-collapse:collapse;font-size:8.5pt;font-family:'Noto Sans JP',sans-serif}
    .skill-table th{background:#e6f1fb;color:#185fa5;padding:3px 6px;text-align:left;font-weight:700;font-size:8pt}
    .skill-table td{padding:3px 6px;border-bottom:1px solid #eef2f7}
    .skill-table tbody tr:nth-child(even) td{background:#f8fbff}
    .skill-table td:nth-child(2),.skill-table td:nth-child(3),.skill-table td:nth-child(4),.skill-table td:nth-child(5){text-align:center}
    .stat-derived{background:#e6f1fb;color:#185fa5}
    .pdf-align-badge{display:inline-block;font-size:8pt;padding:1px 7px;border-radius:8px;font-weight:500;margin-left:6px}
    .ab-ally{background:#eaf3de;color:#3b6d11}.ab-enemy{background:#fcebeb;color:#a32d2d}
    .ab-neutral{background:#faeeda;color:#854f0b}.ab-unknown{background:#f1f1f1;color:#555}

    /* ── アーティファクト ── */
    .art-box{border:1px solid var(--rule);border-radius:8px;overflow:hidden;margin-bottom:10px;break-inside:avoid}
    .art-box-hd{background:var(--amber-lt);padding:10px 14px;border-bottom:1px solid #e8d8bc;display:flex;align-items:baseline;gap:10px}
    .art-name{font-size:11pt;font-weight:700;font-family:'Noto Sans JP',sans-serif;color:var(--amber)}
    .art-type{font-size:8.5pt;color:var(--ink-muted);font-family:'Noto Sans JP',sans-serif}
    .san-chip{font-size:8pt;padding:2px 9px;border-radius:10px;background:var(--red-lt);color:var(--red);font-family:'Noto Sans JP',sans-serif;font-weight:700;margin-left:auto}
    .art-body{padding:10px 14px}
    .art-desc{font-size:9.5pt;color:var(--ink-muted);line-height:1.7;margin-bottom:6px}
    .art-effect{font-size:9.5pt;color:var(--ink);margin-bottom:4px}
    .art-req{font-size:8.5pt;color:var(--ink-faint);font-family:'Noto Sans JP',sans-serif}
    .kp-note{margin-top:7px;padding:6px 10px;background:var(--blue-lt);border-radius:4px;font-size:9pt;font-family:'Noto Sans JP',sans-serif;color:var(--blue)}

    /* ── マップ・場所 ── */
    .room-box{margin-bottom:8px;padding:10px 14px;border:1px solid var(--rule);border-radius:6px;break-inside:avoid}
    .room-name{font-size:10.5pt;font-weight:700;font-family:'Noto Sans JP',sans-serif;margin-bottom:4px}
    .room-desc{font-size:9.5pt;color:var(--ink-muted);line-height:1.7;margin-bottom:5px}
    .room-clue{font-size:9pt;padding:6px 10px;background:var(--blue-lt);border-radius:4px;color:var(--blue);font-family:'Noto Sans JP',sans-serif}
    .floor-map-img{width:100%;height:auto;display:block;border-radius:8px;border:1px solid #dde4ee;background:#f4f7fb;margin-bottom:12px}

    /* ── 時系列 ── */
    .tl-wrap{padding-left:20px;border-left:2px solid #d0cfc4;margin-top:4px}
    .tl-item{position:relative;margin-bottom:16px;padding-left:18px}
    .tl-item::before{content:'';position:absolute;left:-26px;top:6px;width:10px;height:10px;border-radius:50%;background:var(--blue);border:2px solid var(--paper)}
    .tl-when{font-size:8.5pt;font-weight:700;font-family:'Noto Sans JP',sans-serif;color:var(--ink-faint);letter-spacing:0.04em;margin-bottom:2px}
    .tl-chip{display:inline-block;font-size:7.5pt;padding:1px 7px;border-radius:8px;font-family:'Noto Sans JP',sans-serif;font-weight:700;margin-left:6px;vertical-align:middle}
    .tc-event{background:var(--blue-lt);color:var(--blue)}
    .tc-combat{background:var(--red-lt);color:var(--red)}
    .tc-reveal{background:var(--amber-lt);color:var(--amber)}
    .tl-t{font-size:10.5pt;font-weight:700;font-family:'Noto Sans JP',sans-serif;margin-bottom:3px}
    .tl-d{font-size:9.5pt;color:var(--ink-muted);line-height:1.7}

    /* ── プロット ── */
    .plot-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-top:4px}
    .phase-box{border:1px solid var(--rule);border-radius:8px;overflow:hidden;break-inside:avoid}
    .phase-hd{background:var(--blue-lt);padding:8px 12px;border-bottom:1px solid #ccdff5}
    .phase-num{font-size:7.5pt;font-weight:700;font-family:'Noto Sans JP',sans-serif;color:var(--blue);letter-spacing:0.1em;margin-bottom:2px}
    .phase-name{font-size:10pt;font-weight:700;font-family:'Noto Sans JP',sans-serif}
    .phase-goal{font-size:8.5pt;color:var(--ink-muted);font-family:'Noto Sans JP',sans-serif;margin-top:2px}
    .phase-body{padding:8px 12px}
    .phase-item{font-size:9pt;color:var(--ink-muted);padding:2px 0;font-family:'Noto Sans JP',sans-serif;display:flex;gap:5px}
    .phase-item::before{content:'▸';color:var(--blue);flex-shrink:0}
    .phase-kp{margin-top:7px;padding:5px 9px;background:var(--blue-lt);border-radius:4px;font-size:8.5pt;color:var(--blue);font-family:'Noto Sans JP',sans-serif}

    /* ── 印刷 ── */
    @media print{
      body{max-width:${PDF_CONTENT_WIDTH}px;margin:0 auto;padding:0;font-size:10.5pt}
      .sec{page-break-before:always}
      .sec:first-of-type{page-break-before:avoid}
      .scene-hd{page-break-after:avoid}
      .b-scene,.b-dialog,.b-game,.b-ref,.npc-box,.art-box,.room-box,.phase-box{page-break-inside:avoid;break-inside:avoid}
      .keep-next{page-break-after:avoid;break-after:avoid}
      .keep-next + *{page-break-before:avoid;break-before:avoid}
      .b-pagebreak{page-break-after:always;break-after:page}
    }
  `;

  // ── SVGアイコン helpers ──
  const icons = {
    book:   '<svg viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>',
    user:   '<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    box:    '<svg viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>',
    map:    '<svg viewBox="0 0 24 24"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>',
    clock:  '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    list:   '<svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  };
  function secHd(iconKey, label) {
    return `<div class="sec"><div class="sec-icon">${icons[iconKey]}</div><div class="sec-title">${label}</div><div class="sec-line"></div></div>`;
  }

  let body = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>${titleText}</title><style>${css}</style></head><body class="pdf-template-${pdfTemplateKey}">`;

  // 表紙
  body += `<div class="cover">
    <div class="cover-kana">${esc(pdfTpl.coverSub)}</div>
    <div class="cover-title">${esc(titleText)}</div>
    <div class="cover-rule"></div>
  </div>`;

  // ── 本文 ──
  if (S.scenes.some(sc => sc.blocks && sc.blocks.length)) {
    body += secHd('book', pdfTpl.contentTitle);
    S.scenes.forEach((sc, sIdx) => {
      if (!sc.blocks || !sc.blocks.length) return;
      body += `<div class="scene-hd"><span class="scene-num">${esc(pdfTpl.scenePrefix)} ${sIdx + 1}</span><span class="scene-name">${esc(sc.name)}</span></div>`;
      (sc.blocks||[]).forEach(b => {
        const keepCls = b.keepWithNext ? ' keep-next' : '';
        const txt = nl(b.content || '');
        if (b.type === 'pagebreak') {
          body += `<div class="b-pagebreak" aria-hidden="true"></div>`;
        } else if (b.type === 'scene') {
          body += `<p class="b-scene${keepCls}">${txt}</p>`;
        } else if (b.type === 'dialog') {
          const spk = b.speaker || '';
          const color = resolveColor(b);
          const borderColor = color || 'var(--green)';
          const bgColor = color ? hexRgba(color, 0.07) : '';
          const spkColor = color || 'var(--green)';
          const spkStyle = color ? `color:${color}` : '';
          const inlineStyle = `border-left-color:${borderColor};${bgColor?'background:'+bgColor:''}`;
          const spkEl = spk
            ? `<div class="dialog-speaker-badge" style="${spkStyle}">${esc(spk)}</div>`
            : `<div class="dialog-no-speaker">──</div>`;
          body += `<div class="b-dialog${keepCls}" style="${inlineStyle}">${spkEl}<div class="dialog-line">${txt}</div></div>`;
        } else if (b.type === 'game') {
          body += `<div class="b-game${keepCls}"><div class="b-game-hd"><span class="b-game-hd-dice">🎲</span><span class="b-game-hd-lbl">${esc(pdfTpl.gameHeader)}</span></div><div class="b-game-body">${txt}</div></div>`;
        } else if (b.type === 'artifact') {
          const a = b.refData || {};
          body += `<div class="b-ref b-ref-artifact${keepCls}">
            <div class="b-ref-lbl">📦 アイテム参照</div>
            <div class="b-ref-name">${esc(a.name||'')}</div>
            <div class="b-ref-sub">${esc(a.type||'')}</div>
            ${a.desc ? `<div class="b-ref-body">${esc(a.desc)}</div>` : ''}
            ${a.san ? `<div class="b-ref-san">🧠 影響：${esc(a.san)}</div>` : ''}
            ${a.req ? `<div class="b-ref-sub">使用条件：${esc(a.req)}</div>` : ''}
            ${a.effect ? `<div class="b-ref-box">${esc(a.effect)}</div>` : ''}
          </div>`;
        } else if (b.type === 'map') {
          const r = b.refData || {};
          const isFloorRef = r.refKind === 'floor';
          const mapImg = r.floorMapImage || floorImgs[r.floorId] || null;
          body += `<div class="b-ref b-ref-map${keepCls}">
            <div class="b-ref-lbl">🗺 マップ参照</div>
            <div class="b-ref-name">${isFloorRef ? '🗺' : '🚪'} ${esc(r.name||'')}</div>
            <div class="b-ref-sub">${isFloorRef ? 'フロアデータ' : '部屋データ'}${r.floorName ? ` ／ 所属フロア：${esc(r.floorName)}` : ''}</div>
            ${mapImg ? `<div style="margin:8px 0 10px;border:1px solid #d6e4f5;border-radius:6px;overflow:hidden;background:#eef5fd"><img src="${mapImg}" style="width:100%;height:auto;display:block;max-height:280px;object-fit:contain" alt="${esc(r.name||'マップ')} の参照画像"></div>` : ''}
            ${isFloorRef ? (r.floorNote ? `<div class="b-ref-body">${esc(r.floorNote)}</div>` : '') : (r.desc ? `<div class="b-ref-body">${esc(r.desc)}</div>` : '')}
            ${!isFloorRef && r.clue ? `<div class="b-ref-box">🔍 ${esc(r.clue)}</div>` : ''}
          </div>`;
        } else if (b.type === 'timeline') {
          const e = b.refData || {};
          const chipColorMap = { event:'background:#e6f1fb;color:#185fa5', combat:'background:#fcebeb;color:#a32d2d', reveal:'background:#faeeda;color:#854f0b' };
          const chipStyle = chipColorMap[e.tag] || chipColorMap.event;
          const chipLbl = {event:'イベント',combat:'戦闘',reveal:'手がかり'}[e.tag] || 'イベント';
          body += `<div class="b-ref b-ref-timeline${keepCls}">
            <div class="b-ref-lbl">⏰ 時系列参照</div>
            <div class="b-ref-sub">${esc(e.time||'')}</div>
            <div class="b-ref-name">${esc(e.title||'')}</div>
            ${e.desc ? `<div class="b-ref-body">${esc(e.desc)}</div>` : ''}
            <span class="b-ref-tl-chip" style="${chipStyle}">${chipLbl}</span>
          </div>`;
        } else if (b.type === 'plot') {
          const p = b.refData || {};
          const phaseNum = S.plots.findIndex(x=>x.name===p.name);
          const items = (p.items||'').split('\n').filter(x=>x.trim());
          body += `<div class="b-ref b-ref-plot${keepCls}">
            <div class="b-ref-lbl">📋 プロット参照${phaseNum>=0?` — フェーズ ${phaseNum+1}`:''}</div>
            <div class="b-ref-name">${esc(p.name||'')}</div>
            ${p.goal ? `<div class="b-ref-sub">${esc(p.goal)}</div>` : ''}
            ${items.map(it=>`<div class="b-ref-plot-item">${esc(it)}</div>`).join('')}
            ${p.note ? `<div class="b-ref-box">📌 ${esc(p.note)}</div>` : ''}
          </div>`;
        }
      });
    });
  }

  // ── キャラクター ──
  if (S.npcs.length) {
    body += secHd('user', 'キャラクター一覧');
    body += '<div class="npc-grid">';
    const alignLabel = { ally:'🟢 味方', enemy:'🔴 敵', neutral:'🟡 中立', unknown:'⚫ 不明' };
    S.npcs.forEach(n => {
      const is6th = n.edition === '6th';
      const edBadge = isTrpgMode()
        ? `<span class="pdf-align-badge" style="background:${is6th?'#eaf3de':'#e6f1fb'};color:${is6th?'#3b6d11':'#185fa5'}">${is6th?'6th Ed.':'7th Ed.'}</span>`
        : '';
      const stats = (isTrpgMode()
        ? ['STR','CON','POW','DEX','APP','SIZ','INT','EDU'].map(s => [s, n[s.toLowerCase()]])
        : [['体力',n.str],['持久',n.con],['意志',n.pow],['機敏',n.dex],['思考',n.int],['知識',n.edu],['印象',n.app],['存在',n.siz]]
      ).map(([lbl,val]) => `<span class="stat">${lbl} ${val||'—'}</span>`).join('');
      const derivedKeys = isTrpgMode()
        ? (is6th
          ? [['HP','hp'],['MP','mp'],['SAN','san'],['アイデア','idea'],['知識','know'],['幸運','luck'],['DB','db'],['MOV','mov']]
          : [['HP','hp'],['MP','mp'],['SAN','san'],['幸運','luck'],['DB','db'],['ビルド','build'],['MOV','mov']])
        : [];
      const derived = derivedKeys.map(([lbl,key]) => `<span class="stat stat-derived">${lbl} ${n[key]||'—'}</span>`).join('');
      // 項目テーブル（TRPGモード時は技能判定列つき、汎用モード時は簡易）
      const skillRows = (n.skills||[]).map(s => {
        if (!isTrpgMode()) {
          return `<tr><td>${esc(s.name)}</td><td><b>${s.val||'—'}</b></td><td>${esc(s.note||'')}</td></tr>`;
        }
        const v = parseInt(s.val)||0;
        const half = v ? Math.floor(v/2) : '—';
        const fifth = v ? Math.floor(v/5) : '—';
        return is6th
          ? `<tr><td>${esc(s.name)}</td><td>${s.base||'—'}%</td><td><b>${s.val||'—'}%</b></td><td>${half}</td></tr>`
          : `<tr><td>${esc(s.name)}</td><td>${s.base||'—'}%</td><td><b>${s.val||'—'}%</b></td><td>${half}</td><td>${fifth}</td></tr>`;
      }).join('');
      const skillThead = !isTrpgMode()
        ? '<tr><th>項目名</th><th>値</th><th>補足</th></tr>'
        : (is6th
          ? '<tr><th>技能名</th><th>基本値</th><th>現在値</th><th>½成功</th></tr>'
          : '<tr><th>技能名</th><th>基本値</th><th>現在値</th><th>困難(½)</th><th>極限(⅕)</th></tr>');
      const skillTable = skillRows ? `
        <div class="npc-skill-section">
          <div class="npc-section-lbl">${isTrpgMode() ? '技能' : '項目'}</div>
          <table class="skill-table">
            <thead>${skillThead}</thead>
            <tbody>${skillRows}</tbody>
          </table>
        </div>` : '';
      const alignBadge = n.alignment ? `<span class="pdf-align-badge ab-${n.alignment}">${alignLabel[n.alignment]||''}</span>` : '';
      body += `<div class="npc-box">
        <div class="npc-box-hd">
          <div class="npc-box-name">${esc(n.name)} ${alignBadge}</div>
          <div class="npc-box-role">${esc(n.role||'')}${n.tags?'　'+n.tags:''}</div>
        </div>
        <div class="npc-box-body">
          <div class="stats">${stats}</div>
          ${derived ? `<div class="stats" style="margin-top:4px">${derived}</div>` : ''}
          ${n.desc ? `<div class="npc-desc">${nl(n.desc)}</div>` : ''}
          ${skillTable}
          ${n.weapons ? `<div class="npc-section-lbl" style="margin-top:8px">${isTrpgMode() ? '武器・攻撃' : '装備・関連情報'}</div><div class="npc-desc">${nl(n.weapons)}</div>` : ''}
          ${n.abilities ? `<div class="npc-section-lbl" style="margin-top:6px">${isTrpgMode() ? '特殊能力・呪文' : '補足事項'}</div><div class="npc-desc">${nl(n.abilities)}</div>` : ''}
          ${n.secret ? `<div class="npc-secret">🔒 非公開メモ：${nl(n.secret)}</div>` : ''}
        </div>
      </div>`;
    });
    body += '</div>';
  }

  // ── アイテム ──
  if (S.artifacts.length) {
    body += secHd('box', 'アイテム');
    S.artifacts.forEach(a => {
      body += `<div class="art-box">
        <div class="art-box-hd">
          <div class="art-name">${esc(a.name)}</div>
          <div class="art-type">${esc(a.type||'')}</div>
          ${a.san ? `<div class="san-chip">影響 ${esc(a.san)}</div>` : ''}
        </div>
        <div class="art-body">
          <div class="art-desc">${nl(a.desc||'')}</div>
          ${a.req ? `<div class="art-req">使用条件：${esc(a.req)}</div>` : ''}
          ${a.effect ? `<div class="art-effect">${nl(a.effect)}</div>` : ''}
          ${a.kp ? `<div class="kp-note">📌 非公開メモ：${nl(a.kp)}</div>` : ''}
        </div>
      </div>`;
    });
  }

  // ── マップ・場所 ──
  if (S.rooms && S.rooms.length) {
    body += secHd('map', 'マップ・場所');
    const floors = S.floors && S.floors.length ? S.floors : [{ id: null, name: 'フロア', type: 'indoor' }];
    floors.forEach(fl => {
      const flRooms = S.rooms.filter(r => !fl.id || r.floorId === fl.id);
      if (!flRooms.length) return;
      const isOut = fl.type === 'outdoor';
      body += `<div style="margin-bottom:20px;break-inside:avoid">`;
      body += `<div style="font-size:11pt;font-weight:700;color:#185fa5;margin:0 0 10px;border-left:3px solid #378add;padding-left:8px">${isOut ? '🌿' : '🏠'} ${esc(fl.name)}</div>`;

      // ── マップ画像 ──
      const imgData = floorImgs[fl.id];
      if (imgData) {
        body += `<div style="margin-bottom:14px;border:1px solid #dde4ee;border-radius:8px;overflow:hidden;background:#f4f7fb">
          <img src="${imgData}" style="width:100%;height:auto;display:block;max-height:420px;object-fit:contain" alt="${esc(fl.name)} マップ">
        </div>`;
      }

      // ── 凡例バー ──
      body += `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;font-size:8pt;color:#64748b">
        <span>🔴 = 手がかりあり</span>
        <span style="color:#e53935">╌╌ 施錠</span>
        <span style="color:#8e24aa">⋯ 秘密通路</span>
        <span style="color:#43a047">╌╌ 屋外路</span>
      </div>`;

      // ── 場所リスト ──
      const catMap  = { normal:'通常', entry:'入口', key:'重要', danger:'危険', secret:'秘密', outdoor:'屋外', landmark:'ランドマーク', shop:'店舗・施設', religious:'宗教施設', medical:'医療施設', school:'教育施設', govt:'官公庁', transport:'交通', water:'水域', forest:'森林', ruin:'廃墟' };
      const catIcon = { normal:'🚪', entry:'🚪', key:'⭐', danger:'⚠', secret:'🔒', outdoor:'🌿', landmark:'🏛', shop:'🏪', religious:'⛪', medical:'🏥', school:'🏫', govt:'🏛', transport:'🚉', water:'🌊', forest:'🌲', ruin:'🏚' };
      body += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">`;
      flRooms.forEach(r => {
        const cat = r.cat || 'normal';
        const myEdges = (S.edges||[]).filter(e => e.floorId === fl.id && (e.aId===r.id||e.bId===r.id));
        const connText = myEdges.map(e => {
          const otherId = e.aId===r.id ? e.bId : e.aId;
          const other = S.rooms.find(x => x.id === otherId);
          const etl = {normal:'通常', locked:'施錠', secret:'秘密通路', outdoor:'屋外路'}[e.type]||'通常';
          return `${other ? esc(other.name) : '?'}（${etl}${e.note ? '：'+esc(e.note) : ''}）`;
        }).join('、');
        body += `<div class="room-box" style="break-inside:avoid">
          <div class="room-name">${catIcon[cat]||'🚪'} ${esc(r.name)}${r.num ? ` <span style="font-size:8pt;color:#94a3b8">No.${esc(r.num)}</span>` : ''} <span style="font-size:8pt;color:#94a3b8">${catMap[cat]||''}</span></div>
          ${r.desc  ? `<div class="room-desc">${nl(r.desc)}</div>` : ''}
          ${r.clue  ? `<div class="room-clue">🔍 ${nl(r.clue)}</div>` : ''}
          ${connText ? `<div style="font-size:8pt;color:#64748b;margin-top:3px">接続：${connText}</div>` : ''}
          ${r.kp    ? `<div style="font-size:8pt;background:#faeeda;color:#854f0b;padding:4px 7px;border-radius:4px;margin-top:4px">📌 ${nl(r.kp)}</div>` : ''}
        </div>`;
      });
      body += `</div></div>`;
    });
  }

  // ── 時系列 ──
  if (S.timeline.length) {
    body += secHd('clock', '時系列');
    const chipMap = {event:'tc-event',combat:'tc-combat',reveal:'tc-reveal'};
    const chipLbl = {event:'イベント',combat:'戦闘',reveal:'重要な手がかり'};
    body += '<div class="tl-wrap">';
    S.timeline.forEach(e => {
      const cls = chipMap[e.tag]||'tc-event';
      const lbl = chipLbl[e.tag]||'イベント';
      body += `<div class="tl-item">
        <div class="tl-when">${esc(e.time||'')}<span class="tl-chip ${cls}">${lbl}</span></div>
        <div class="tl-t">${esc(e.title||'')}</div>
        ${e.desc ? `<div class="tl-d">${nl(e.desc)}</div>` : ''}
      </div>`;
    });
    body += '</div>';
  }

  // ── プロット ──
  if (S.plots.length) {
    body += secHd('list', 'プロット');
    body += '<div class="plot-grid">';
    S.plots.forEach((p, i) => {
      const items = (p.items||'').split('\n').filter(x=>x.trim());
      body += `<div class="phase-box">
        <div class="phase-hd">
          <div class="phase-num">PHASE ${i+1}</div>
          <div class="phase-name">${esc(p.name||'')}</div>
          <div class="phase-goal">${esc(p.goal||'')}</div>
        </div>
        <div class="phase-body">
          ${items.map(it=>`<div class="phase-item">${esc(it)}</div>`).join('')}
          ${p.note ? `<div class="phase-kp">📌 ${nl(p.note)}</div>` : ''}
        </div>
      </div>`;
    });
    body += '</div>';
  }

  body += '<scr'+'ipt>window.onload=()=>window.print()<'+'/script></body></html>';
  w.document.write(body);
  w.document.close();
}


// ======= MISSING UTILITY FUNCTIONS =======

// PNG書き出し（現在表示中のフロアをダウンロード）
async function fpExportPng() {
  if (!MAP.curFloor) { toast('フロアがありません', true); return; }
  const dataUrl = await generateFloorDataUrl(MAP.curFloor);
  if (!dataUrl) { toast('書き出すデータがありません', true); return; }
  MAP_REF_IMAGE_CACHE[MAP.curFloor] = dataUrl;
  const fl = S.floors.find(f => f.id === MAP.curFloor);
  const name = (fl?.name || 'map').replace(/[\\/:*?"<>|]/g, '_');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `${name}.png`;
  a.click();
  toast('🖼 PNGをダウンロードしました');
}

// テキストを最大幅に収める（Canvas描画用）
function truncateText(ctx, text, maxWidth) {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

// リサイズハンドルのカーソル種別
function cursorForDir(dir) {
  const map = {
    n:'ns-resize', s:'ns-resize', e:'ew-resize', w:'ew-resize',
    ne:'nesw-resize', sw:'nesw-resize', nw:'nwse-resize', se:'nwse-resize'
  };
  return map[dir] || 'default';
}

// 値を min〜max にクランプ
function minmax(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// NPC色スウォッチ初期化（モーダル内カラーピッカー）
function initNpcColorSwatches(current) {
  const wrap = document.getElementById('npcColorSwatches');
  const preview = document.getElementById('npcColorPreview');
  if (!wrap) return;
  const noneEl = `<div class="color-swatch-none" onclick="selectNpcColor('')" title="色なし">✕</div>`;
  const swatches = PALETTE.map(c =>
    `<div class="color-swatch${current===c?' chosen':''}" style="background:${c};width:26px;height:26px" onclick="selectNpcColor('${c}')" title="${c}"></div>`
  ).join('');
  wrap.innerHTML = noneEl + swatches;
  updateNpcColorPreview(current);
  const customEl = document.getElementById('npcColorCustom');
  if (customEl) customEl.oninput = function() { selectNpcColor(this.value); };
}

function selectNpcColor(color) {
  document.getElementById('npcColor').value = color;
  document.querySelectorAll('#npcColorSwatches .color-swatch').forEach(el => {
    el.classList.toggle('chosen', el.title === color);
  });
  updateNpcColorPreview(color);
}

function updateNpcColorPreview(color) {
  const p = document.getElementById('npcColorPreview');
  if (!p) return;
  if (color) {
    p.style.background = hexToRgba(color, 0.15);
    p.style.color = color;
    p.textContent = '● プレビュー';
  } else {
    p.style.background = '#e6f1fb';
    p.style.color = '#185fa5';
    p.textContent = '色なし';
  }
}

playLogoIntroAndStart();
