import type {
  ApiEntry,
  ApiFile,
  ApiSearchResult,
  ApiSettings,
  ApiSource,
  ApiStatus,
} from "@llangtop/pwiki-api";
import { PwikiApiClient } from "./api-client.js";

type ThemeId = "midnight" | "paper" | "ocean" | "forest" | "rose" | "amber";
type ViewMode = "preview" | "live" | "source";
type SidebarMode = "files" | "search";

interface HeadingItem {
  id: string;
  level: number;
  text: string;
  line: number;
}

interface ThemeOption {
  id: ThemeId;
  label: string;
  description: string;
  swatch: string;
}

type WindowKind = "entry" | "workspace";

interface WorkspaceWindow {
  id: string;
  kind: WindowKind;
  sourceId: string;
  sourceName: string;
  relPath: string;
  title: string;
}

interface SearchHistoryItem {
  id: string;
  query: string;
  mode: "keyword" | "semantic" | "hybrid";
  sourceId?: string;
  total: number;
  createdAt: string;
  result: ApiSearchResult;
}

interface RecentlyClosedFile {
  id: string;
  sourceId: string;
  sourceName: string;
  relPath: string;
  title: string;
  closedAt: string;
}

const themes: ThemeOption[] = [
  { id: "midnight", label: "夜幕紫", description: "深色 · 紫罗兰", swatch: "#a78bfa" },
  { id: "paper", label: "纸张米白", description: "浅色 · 暖灰", swatch: "#c88b5a" },
  { id: "ocean", label: "海湾蓝", description: "深色 · 青蓝", swatch: "#62c8d4" },
  { id: "forest", label: "松林绿", description: "深色 · 松石", swatch: "#78c59a" },
  { id: "rose", label: "玫瑰粉", description: "深色 · 柔粉", swatch: "#ef91ae" },
  { id: "amber", label: "琥珀橙", description: "深色 · 金橙", swatch: "#e6ad68" },
];

const client = new PwikiApiClient();
const SEARCH_HISTORY_KEY = "pwiki-search-history";
const SEARCH_HISTORY_LIMIT = 8;
const RECENTLY_CLOSED_KEY = "pwiki-recently-closed";
const RECENTLY_CLOSED_LIMIT = 8;
const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const elements = {
  mobileSidebarButton: el<HTMLButtonElement>("mobile-sidebar-button"),
  brandRepositoryName: el<HTMLElement>("brand-repository-name"),
  brandProductName: el<HTMLElement>("brand-product-name"),
  fileSidebar: el<HTMLElement>("file-sidebar"),
  tabBar: el<HTMLElement>("tab-bar"),
  windowManagerButton: el<HTMLButtonElement>("window-manager-button"),
  newWindowButton: el<HTMLButtonElement>("new-window-button"),
  windowManagerPopover: el<HTMLElement>("window-manager-popover"),
  windowManagerContent: el<HTMLElement>("window-manager-content"),
  focusSearch: el<HTMLButtonElement>("focus-search"),
  themeButton: el<HTMLButtonElement>("theme-button"),
  themePopover: el<HTMLElement>("theme-popover"),
  themeOptions: el<HTMLElement>("theme-options"),
  statusPill: el<HTMLElement>("status-pill"),
  workspaceGrid: el<HTMLElement>("workspace-grid"),
  sourcePopover: el<HTMLElement>("source-popover"),
  sourceSelect: el<HTMLSelectElement>("source-select"),
  closeSourcePopover: el<HTMLButtonElement>("close-source-popover"),
  sourcePopoverSettings: el<HTMLButtonElement>("source-popover-settings"),
  sourcePopoverRefresh: el<HTMLButtonElement>("source-popover-refresh"),
  sourcePopoverMeta: el<HTMLElement>("source-popover-meta"),
  sourcePopoverName: el<HTMLElement>("source-popover-name"),
  newNoteButton: el<HTMLButtonElement>("new-note-button"),
  refreshButton: el<HTMLButtonElement>("refresh-button"),
  toggleFileSidebarButton: el<HTMLButtonElement>("toggle-file-sidebar-button"),
  fileManagerPanel: el<HTMLElement>("file-manager-panel"),
  searchSidebarPanel: el<HTMLElement>("search-sidebar-panel"),
  railFiles: el<HTMLButtonElement>("rail-files"),
  railSearch: el<HTMLButtonElement>("rail-search"),
  fileFilter: el<HTMLInputElement>("file-filter"),
  treeCount: el<HTMLElement>("tree-count"),
  fileTree: el<HTMLElement>("file-tree"),
  fileCount: el<HTMLElement>("file-count"),
  indexState: el<HTMLElement>("index-state"),
  loadSourceButton: el<HTMLButtonElement>("load-source-button"),
  breadcrumb: el<HTMLElement>("breadcrumb"),
  previewModeButton: el<HTMLButtonElement>("preview-mode-button"),
  liveModeButton: el<HTMLButtonElement>("live-mode-button"),
  sourceModeButton: el<HTMLButtonElement>("source-mode-button"),
  saveEntryButton: el<HTMLButtonElement>("save-entry-button"),
  documentMoreButton: el<HTMLButtonElement>("document-more-button"),
  searchForm: el<HTMLFormElement>("search-form"),
  searchInput: el<HTMLInputElement>("search-input"),
  searchMode: el<HTMLSelectElement>("search-mode"),
  searchSubmitButton: el<HTMLButtonElement>("search-submit-button"),
  searchHeading: el<HTMLElement>("search-heading"),
  searchMeta: el<HTMLElement>("search-meta"),
  closeSearchButton: el<HTMLButtonElement>("close-search-button"),
  searchResultList: el<HTMLElement>("search-result-list"),
  searchHistory: el<HTMLDetailsElement>("search-history"),
  searchHistoryList: el<HTMLElement>("search-history-list"),
  searchHistoryCount: el<HTMLElement>("search-history-count"),
  clearSearchHistoryButton: el<HTMLButtonElement>("clear-search-history"),
  emptyState: el<HTMLElement>("empty-state"),
  emptyNewButton: el<HTMLButtonElement>("empty-new-button"),
  emptySourceButton: el<HTMLButtonElement>("empty-source-button"),
  recentlyClosedList: el<HTMLElement>("recently-closed-list"),
  clearRecentlyClosedButton: el<HTMLButtonElement>("clear-recently-closed"),
  entryView: el<HTMLElement>("entry-view"),
  entryPath: el<HTMLElement>("entry-path"),
  entryTitle: el<HTMLElement>("entry-title"),
  entryTags: el<HTMLElement>("entry-tags"),
  entryMeta: el<HTMLElement>("entry-meta"),
  markdownView: el<HTMLElement>("markdown-view"),
  liveEditorView: el<HTMLElement>("live-editor-view"),
  liveEditorPath: el<HTMLElement>("live-editor-path"),
  liveEntryEditor: el<HTMLTextAreaElement>("live-entry-editor"),
  liveMarkdownView: el<HTMLElement>("live-markdown-view"),
  liveDirtyIndicator: el<HTMLElement>("live-dirty-indicator"),
  liveEditorCount: el<HTMLElement>("live-editor-count"),
  editorView: el<HTMLElement>("editor-view"),
  editorPath: el<HTMLElement>("editor-path"),
  entryEditor: el<HTMLTextAreaElement>("entry-editor"),
  dirtyIndicator: el<HTMLElement>("dirty-indicator"),
  editorCount: el<HTMLElement>("editor-count"),
  outlinePane: el<HTMLElement>("outline-pane"),
  toggleOutlineButton: el<HTMLButtonElement>("toggle-outline-button"),
  outlineList: el<HTMLElement>("outline-list"),
  outlineEmpty: el<HTMLElement>("outline-empty"),
  detailsCard: el<HTMLElement>("details-card"),
  entryDialog: el<HTMLDialogElement>("entry-dialog"),
  entryForm: el<HTMLFormElement>("entry-form"),
  newTitle: el<HTMLInputElement>("new-title"),
  newPath: el<HTMLInputElement>("new-path"),
  newContent: el<HTMLTextAreaElement>("new-content"),
  sourceDialog: el<HTMLDialogElement>("source-dialog"),
  sourceForm: el<HTMLFormElement>("source-form"),
  sourcePath: el<HTMLInputElement>("source-path"),
  settingsView: el<HTMLElement>("settings-view"),
  settingsBackButton: el<HTMLButtonElement>("settings-back-button"),
  settingsRefreshButton: el<HTMLButtonElement>("settings-refresh-button"),
  settingsRepositoryStats: el<HTMLElement>("settings-repository-stats"),
  settingsLastScan: el<HTMLElement>("settings-last-scan"),
  settingsVectorState: el<HTMLElement>("settings-vector-state"),
  settingsStorageBadge: el<HTMLElement>("settings-storage-badge"),
  settingsSemanticBadge: el<HTMLElement>("settings-semantic-badge"),
  settingsSemanticButton: el<HTMLButtonElement>("settings-semantic-button"),
  settingsModelList: el<HTMLElement>("settings-model-list"),
  settingsModelMessage: el<HTMLElement>("settings-model-message"),
  settingsRerankerToggle: el<HTMLInputElement>("settings-reranker-toggle"),
  settingsRerankerState: el<HTMLElement>("settings-reranker-state"),
  settingsRerankerBadge: el<HTMLElement>("settings-reranker-badge"),
  settingsLlmBadge: el<HTMLElement>("settings-llm-badge"),
  settingsLlmBase: el<HTMLElement>("settings-llm-base"),
  settingsLlmModel: el<HTMLElement>("settings-llm-model"),
  settingsLlmKey: el<HTMLElement>("settings-llm-key"),
  settingsSourceCount: el<HTMLElement>("settings-source-count"),
  settingsSourceForm: el<HTMLFormElement>("settings-source-form"),
  settingsSourcePath: el<HTMLInputElement>("settings-source-path"),
  settingsSourceMessage: el<HTMLElement>("settings-source-message"),
  settingsSourceList: el<HTMLElement>("settings-source-list"),
  toast: el<HTMLElement>("toast"),
};

const state: {
  status?: ApiStatus;
  sources: ApiSource[];
  selectedSource?: ApiSource;
  folders: Map<string, ApiFile[]>;
  expandedFolders: Set<string>;
  loadingFolders: Set<string>;
  currentFolder: string;
  entry: ApiEntry | null;
  viewMode: ViewMode;
  draftContent: string;
  dirty: boolean;
  sidebarMode: SidebarMode;
  windows: WorkspaceWindow[];
  activeWindowId?: string;
  windowManagerOpen: boolean;
  detailsOpen: boolean;
  searchResult?: ApiSearchResult;
  searchHistory: SearchHistoryItem[];
  activeSearchHistoryId?: string;
  recentlyClosed: RecentlyClosedFile[];
  searchLoading: boolean;
  searchRequest: number;
  filter: string;
  filterResults: ApiFile[] | null;
  filterTotal: number;
  filterLoading: boolean;
  filterRequest: number;
  settings?: ApiSettings;
  settingsOpen: boolean;
  fileCollapsed: boolean;
  outlineCollapsed: boolean;
} = {
  sources: [],
  folders: new Map(),
  expandedFolders: new Set([""]),
  loadingFolders: new Set(),
  currentFolder: "",
  entry: null,
  viewMode: "preview",
  draftContent: "",
  dirty: false,
  sidebarMode: "files",
  windows: [],
  windowManagerOpen: false,
  detailsOpen: false,
  searchHistory: [],
  recentlyClosed: [],
  searchLoading: false,
  searchRequest: 0,
  filter: "",
  filterResults: null,
  filterTotal: 0,
  filterLoading: false,
  filterRequest: 0,
  settingsOpen: false,
  fileCollapsed: false,
  outlineCollapsed: false,
};

let toastTimer: number | undefined;
let workspaceWindowSerial = 0;

async function boot(): Promise<void> {
  applyStoredTheme();
  renderThemeOptions();
  loadSearchHistory();
  loadRecentlyClosed();
  bindEvents();
  renderWorkspace();
  await Promise.all([loadStatus(), loadSources()]);
}

function bindEvents(): void {
  elements.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void runSearch();
  });
  elements.focusSearch.addEventListener("click", () => openSearch());
  elements.closeSearchButton.addEventListener("click", () => closeSearch());
  elements.railFiles.addEventListener("click", () => setSidebarMode("files"));
  elements.railSearch.addEventListener("click", () => openSearch());
  elements.settingsRerankerToggle.addEventListener("change", () => { void toggleReranker(); });
  elements.clearSearchHistoryButton.addEventListener("click", () => clearSearchHistory());
  elements.clearRecentlyClosedButton.addEventListener("click", () => clearRecentlyClosed());
  elements.fileFilter.addEventListener("input", () => {
    void applyFileFilter();
  });
  elements.sourceSelect.addEventListener("change", () => {
    const source = state.sources.find((candidate) => candidate.id === elements.sourceSelect.value);
    if (source) {
      closeSourcePopover();
      void selectSource(source);
    }
  });
  elements.closeSourcePopover.addEventListener("click", () => closeSourcePopover());
  elements.sourcePopoverSettings.addEventListener("click", () => openSettings());
  elements.sourcePopoverRefresh.addEventListener("click", () => { void refreshWorkspace(); });
  elements.newNoteButton.addEventListener("click", () => openCreateDialog());
  elements.newWindowButton.addEventListener("click", () => openWorkspaceWindow());
  elements.windowManagerButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleWindowManager();
  });
  elements.emptyNewButton.addEventListener("click", () => openCreateDialog());
  elements.refreshButton.addEventListener("click", () => { void refreshWorkspace(); });
  elements.loadSourceButton.addEventListener("click", () => openSourceDialog());
  document.getElementById("rail-refresh")?.addEventListener("click", () => { void refreshWorkspace(); });
  document.getElementById("rail-source")?.addEventListener("click", () => toggleSourcePopover());
  document.getElementById("rail-settings")?.addEventListener("click", () => openSettings());
  document.querySelector('[data-rail="search"]')?.addEventListener("click", () => openSearch());
  elements.toggleFileSidebarButton.addEventListener("click", () => toggleFileSidebar());
  elements.emptySourceButton.addEventListener("click", () => openSourceDialog());
  elements.previewModeButton.addEventListener("click", () => setViewMode("preview"));
  elements.liveModeButton.addEventListener("click", () => setViewMode("live"));
  elements.sourceModeButton.addEventListener("click", () => setViewMode("source"));
  elements.saveEntryButton.addEventListener("click", () => { void saveEntry(); });
  elements.entryEditor.addEventListener("input", () => handleDraftInput(elements.entryEditor.value));
  elements.liveEntryEditor.addEventListener("input", () => handleDraftInput(elements.liveEntryEditor.value));
  elements.documentMoreButton.addEventListener("click", () => {
    if (state.entry) toggleDetails();
    else notify("打开一篇 Markdown 后可进行文件操作。", true);
  });
  elements.toggleOutlineButton.addEventListener("click", () => {
    state.outlineCollapsed = !state.outlineCollapsed;
    elements.outlinePane.classList.toggle("collapsed", state.outlineCollapsed);
    elements.workspaceGrid.classList.toggle("outline-collapsed", state.outlineCollapsed);
    elements.toggleOutlineButton.textContent = state.outlineCollapsed ? "‹" : "›";
    elements.toggleOutlineButton.title = state.outlineCollapsed ? "展开大纲" : "收起大纲";
  });
  elements.mobileSidebarButton.addEventListener("click", () => {
    elements.fileSidebar.classList.toggle("mobile-open");
  });
  elements.themeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    elements.themePopover.classList.toggle("hidden");
  });
  document.addEventListener("click", (event) => {
    const target = event.target as Node;
    if (!elements.themePopover.contains(target) && !elements.themeButton.contains(target)) {
      elements.themePopover.classList.add("hidden");
    }
    if (!elements.sourcePopover.contains(target) && !document.getElementById("rail-source")?.contains(target)) {
      closeSourcePopover();
    }
    if (!elements.windowManagerPopover.contains(target) && !elements.windowManagerButton.contains(target)) {
      closeWindowManager();
    }
    if (state.detailsOpen && !elements.detailsCard.contains(target) && !elements.documentMoreButton.contains(target)) {
      state.detailsOpen = false;
      renderDetails();
    }
  });
  elements.entryForm.addEventListener("submit", (event) => {
    const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter && submitter.value !== "default") return;
    event.preventDefault();
    void createEntry();
  });
  elements.sourceForm.addEventListener("submit", (event) => {
    const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter && submitter.value !== "default") return;
    event.preventDefault();
    void addSource();
  });
  elements.settingsBackButton.addEventListener("click", () => closeSettings());
  elements.settingsRefreshButton.addEventListener("click", () => { void loadSettings(); });
  elements.settingsSemanticButton.addEventListener("click", () => { void toggleSemanticService(); });
  elements.settingsSourceForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void addSettingsSource();
  });
  elements.settingsModelList.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-model-id]");
    if (button) void selectSettingsModel(button.dataset.modelId ?? "");
  });
  elements.settingsSourceList.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const sourceButton = target.closest<HTMLButtonElement>("[data-settings-source]");
    if (!sourceButton) return;
    const sourceId = sourceButton.dataset.sourceId ?? "";
    if (sourceButton.dataset.settingsSource === "select") {
      const source = state.sources.find((candidate) => candidate.id === sourceId);
      if (source) {
        closeSettings();
        void selectSource(source);
      }
    } else if (sourceButton.dataset.settingsSource === "refresh") {
      void refreshSource(sourceId);
    } else if (sourceButton.dataset.settingsSource === "remove") {
      void removeSettingsSource(sourceId);
    }
  });
  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === "k") {
      event.preventDefault();
      openSearch();
    }
    if ((event.metaKey || event.ctrlKey) && key === "p") {
      event.preventDefault();
      setSidebarMode("files");
      elements.fileFilter.focus();
    }
    if ((event.metaKey || event.ctrlKey) && key === "s" && state.entry && state.dirty) {
      event.preventDefault();
      void saveEntry();
    }
    if (!event.metaKey && !event.ctrlKey && key === "n" && !isTypingTarget(event.target)) {
      event.preventDefault();
      openCreateDialog();
    }
    if (event.key === "Escape") elements.fileSidebar.classList.remove("mobile-open");
    if (event.key === "Escape") {
      closeWindowManager();
      state.detailsOpen = false;
      renderDetails();
    }
  });
}

async function loadStatus(): Promise<void> {
  const response = await client.status();
  if (!response.ok) {
    setConnectionState(false, response.error.message);
    return;
  }
  state.status = response.value;
  setConnectionState(true, "已连接");
  elements.fileCount.textContent = String(response.value.files);
  elements.indexState.textContent = response.value.semantic ? "语义就绪" : "关键词可用";
  elements.indexState.title = response.value.lastScan ? `最近扫描：${response.value.lastScan}` : "尚未扫描";
  renderRerankerControl();
  if (state.settingsOpen) renderSettings();
}

async function loadSettings(): Promise<void> {
  const response = await client.settings();
  if (!response.ok) {
    elements.settingsModelMessage.textContent = response.error.message;
    notify(response.error.message, true);
    return;
  }
  state.settings = response.value;
  state.sources = response.value.sources;
  const selected = state.sources.find((source) => source.id === state.selectedSource?.id);
  state.selectedSource = selected ?? state.sources[0];
  renderSourcePicker();
  renderRerankerControl();
  renderSettings();
}

async function loadSources(preferredId?: string): Promise<void> {
  const response = await client.sources();
  if (!response.ok) {
    notify(response.error.message, true);
    return;
  }
  const previousId = state.selectedSource?.id;
  state.sources = response.value;
  const next = state.sources.find((source) => source.id === (preferredId ?? previousId)) ?? state.sources[0];
  state.selectedSource = next;
  renderSourcePicker();
  if (!next) {
    resetFileState();
    renderWorkspace();
    return;
  }
  if (previousId !== next.id || !state.folders.has("")) {
    resetFileState();
    state.selectedSource = next;
    await loadFolder("");
  }
  renderWorkspace();
}

async function refreshSourceList(): Promise<void> {
  const response = await client.sources();
  if (!response.ok) {
    notify(response.error.message, true);
    return;
  }
  state.sources = response.value;
  const selected = state.sources.find((source) => source.id === state.selectedSource?.id);
  state.selectedSource = selected;
  renderSourcePicker();
  if (state.settingsOpen) await loadSettings();
}

async function applyFileFilter(): Promise<void> {
  state.filter = elements.fileFilter.value.trim();
  const query = state.filter;
  const request = ++state.filterRequest;
  if (!query) {
    state.filterResults = null;
    state.filterTotal = 0;
    state.filterLoading = false;
    renderFileTree();
    return;
  }
  const source = state.selectedSource;
  if (!source) {
    state.filterResults = [];
    state.filterTotal = 0;
    state.filterLoading = false;
    renderFileTree();
    return;
  }
  state.filterLoading = true;
  state.filterResults = null;
  renderFileTree();
  const response = await client.files(source.id, "", 100, query);
  if (request !== state.filterRequest) return;
  state.filterLoading = false;
  if (!response.ok) {
    state.filterResults = [];
    state.filterTotal = 0;
    notify(response.error.message, true);
    renderFileTree();
    return;
  }
  state.filterResults = response.value.items.filter((item) => item.kind === "file");
  state.filterTotal = response.value.total;
  renderFileTree();
}

async function loadFolder(path: string, force = false): Promise<void> {
  const source = state.selectedSource;
  if (!source || (!force && state.folders.has(path))) return;
  state.loadingFolders.add(path);
  renderFileTree();
  const response = await client.files(source.id, path, 200);
  state.loadingFolders.delete(path);
  if (state.selectedSource?.id !== source.id) return;
  if (!response.ok) {
    notify(response.error.message, true);
    renderFileTree();
    return;
  }
  state.folders.set(path, response.value.items);
  renderFileTree();
}

async function selectSource(source: ApiSource): Promise<void> {
  state.selectedSource = source;
  resetFileState();
  state.filter = "";
  elements.fileFilter.value = "";
  state.entry = null;
  state.draftContent = "";
  state.activeWindowId = undefined;
  state.detailsOpen = false;
  state.viewMode = "preview";
  clearSearchSession();
  closeSearch();
  renderWorkspace();
  await loadFolder("");
  renderWorkspace();
}

async function toggleFolder(path: string): Promise<void> {
  state.currentFolder = path;
  if (state.expandedFolders.has(path)) {
    state.expandedFolders.delete(path);
  } else {
    state.expandedFolders.add(path);
    await loadFolder(path);
  }
  renderBreadcrumb();
  renderFileTree();
}

async function openEntry(path: string, sourceId = state.selectedSource?.id, skipConfirm = false): Promise<void> {
  if (!sourceId) return;
  const nextId = windowKey(sourceId, path);
  if (!skipConfirm && state.activeWindowId && state.activeWindowId !== nextId && !confirmLeaveWindow()) return;
  const response = await client.entry(sourceId, path);
  if (!response.ok) {
    notify(response.error.message, true);
    return;
  }
  if (!response.value) {
    notify("文件不存在，可能已被外部修改。请刷新文件树。", true);
    return;
  }
  const source = state.sources.find((candidate) => candidate.id === response.value?.sourceId);
  if (source) state.selectedSource = source;
  state.entry = response.value;
  state.draftContent = response.value.content;
  removeRecentlyClosed(response.value.sourceId, response.value.relPath);
  upsertWindow(response.value);
  state.currentFolder = parentPath(response.value.relPath);
  state.viewMode = "preview";
  state.dirty = false;
  state.detailsOpen = false;
  closeSearch();
  closeWindowManager();
  expandFolderState(state.currentFolder);
  await loadFolderPath(state.currentFolder);
  renderWorkspace();
  elements.fileSidebar.classList.remove("mobile-open");
}

async function loadFolderPath(path: string): Promise<void> {
  let prefix = "";
  state.expandedFolders.add("");
  await loadFolder("");
  for (const part of path.split("/").filter(Boolean)) {
    prefix = prefix ? `${prefix}/${part}` : part;
    state.expandedFolders.add(prefix);
    await loadFolder(prefix);
  }
}

async function runSearch(): Promise<void> {
  const query = elements.searchInput.value.trim();
  if (!query) {
    notify("请输入搜索关键词。", true);
    return;
  }
  if (state.searchLoading) return;
  const requestId = ++state.searchRequest;
  state.searchLoading = true;
  elements.searchSubmitButton.disabled = true;
  elements.searchSubmitButton.textContent = "搜索中…";
  elements.searchMeta.textContent = "正在检索并整理结果…";
  elements.searchResultList.innerHTML = `<div class="search-loading"><span class="loading-spinner"></span><strong>正在搜索</strong><span>二次精排可能需要几秒钟。</span></div>`;
  const response = await client.search({
    query,
    mode: elements.searchMode.value as "keyword" | "semantic" | "hybrid",
    source: state.selectedSource?.id,
    limit: 30,
  });
  if (requestId !== state.searchRequest) return;
  if (!response.ok) {
    notify(response.error.message, true);
    elements.searchResultList.innerHTML = `<div class="search-empty">搜索失败，请稍后重试。</div>`;
    state.searchLoading = false;
    elements.searchSubmitButton.disabled = false;
    elements.searchSubmitButton.textContent = "搜索";
    return;
  }
  state.searchResult = response.value;
  saveSearchHistory(response.value);
  renderSearchResults(response.value);
}

function openSearch(): void {
  if (state.settingsOpen) closeSettings();
  closeSourcePopover();
  setSidebarMode("search");
  renderSearchPanel();
  window.setTimeout(() => elements.searchInput.focus(), 0);
}

function closeSearch(): void {
  state.searchRequest += 1;
  state.searchLoading = false;
  elements.searchSubmitButton.disabled = false;
  elements.searchSubmitButton.textContent = "搜索";
  setSidebarMode("files");
}

function clearSearchSession(): void {
  state.searchRequest += 1;
  state.searchLoading = false;
  state.searchResult = undefined;
  state.activeSearchHistoryId = undefined;
  elements.searchInput.value = "";
  elements.searchSubmitButton.disabled = false;
  elements.searchSubmitButton.textContent = "搜索";
  resetSearchDisplay();
  renderSearchHistory();
}

function renderSearchPanel(): void {
  renderSearchHistory();
  if (state.searchResult) {
    renderSearchResults(state.searchResult, false);
  } else if (!state.searchLoading) {
    resetSearchDisplay();
  }
}

function resetSearchDisplay(): void {
  elements.searchHeading.textContent = "搜索";
  elements.searchMeta.textContent = "";
  elements.searchResultList.innerHTML = "";
}

function renderSearchResults(result: ApiSearchResult, focus = false): void {
  state.searchResult = result;
  state.searchLoading = false;
  elements.searchSubmitButton.disabled = false;
  elements.searchSubmitButton.textContent = "搜索";
  setSidebarMode("search");
  elements.searchInput.value = result.query;
  elements.searchMode.value = result.mode;
  elements.searchHeading.textContent = "搜索";
  elements.searchMeta.textContent = `“${result.query}” · ${result.total} 个结果 · ${result.mode}`;
  renderSearchHistory();
  if (result.results.length === 0) {
    elements.searchResultList.innerHTML = `<div class="search-empty">没有找到匹配的 Markdown 文件。</div>`;
    if (focus) window.setTimeout(() => elements.searchInput.focus(), 0);
    return;
  }
  elements.searchResultList.innerHTML = result.results.map((hit) => `
    <button class="search-result" type="button" data-search-source="${escapeHtml(hit.sourceId)}" data-search-path="${escapeHtml(hit.relPath)}">
      <span class="search-result-title">${escapeHtml(hit.title)}</span>
      <span class="search-result-path">${escapeHtml(hit.sourceId)} / ${escapeHtml(hit.relPath)}</span>
      <span class="search-result-snippet">${escapeHtml(hit.snippet || hit.summary || "无摘要")}</span>
      <span class="search-result-score">${formatScore(hit.score)}</span>
    </button>`).join("");
  elements.searchResultList.querySelectorAll<HTMLButtonElement>("[data-search-path]").forEach((button) => {
    button.addEventListener("click", () => {
      void openEntry(button.dataset.searchPath ?? "", button.dataset.searchSource);
    });
  });
  if (focus) window.setTimeout(() => elements.searchInput.focus(), 0);
}

function loadSearchHistory(): void {
  try {
    const value = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) ?? "[]") as unknown;
    state.searchHistory = Array.isArray(value)
      ? value.filter(isSearchHistoryItem).slice(0, SEARCH_HISTORY_LIMIT)
      : [];
  } catch {
    state.searchHistory = [];
  }
}

function isSearchHistoryItem(value: unknown): value is SearchHistoryItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SearchHistoryItem>;
  return typeof item.id === "string"
    && typeof item.query === "string"
    && (item.mode === "keyword" || item.mode === "semantic" || item.mode === "hybrid")
    && typeof item.total === "number"
    && typeof item.createdAt === "string"
    && isSearchResult(item.result);
}

function isSearchResult(value: unknown): value is ApiSearchResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<ApiSearchResult>;
  return typeof result.query === "string"
    && (result.mode === "keyword" || result.mode === "semantic" || result.mode === "hybrid")
    && typeof result.total === "number"
    && Array.isArray(result.results);
}

function saveSearchHistory(result: ApiSearchResult): void {
  const item: SearchHistoryItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    query: result.query,
    mode: result.mode,
    sourceId: state.selectedSource?.id,
    total: result.total,
    createdAt: new Date().toISOString(),
    result,
  };
  state.searchHistory = [
    item,
    ...state.searchHistory.filter((candidate) => !(candidate.query === item.query && candidate.mode === item.mode && candidate.sourceId === item.sourceId)),
  ].slice(0, SEARCH_HISTORY_LIMIT);
  state.activeSearchHistoryId = item.id;
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(state.searchHistory));
  renderSearchHistory();
}

function clearSearchHistory(): void {
  state.searchHistory = [];
  state.activeSearchHistoryId = undefined;
  localStorage.removeItem(SEARCH_HISTORY_KEY);
  renderSearchHistory();
  notify("已清空搜索历史");
}

function renderSearchHistory(): void {
  elements.searchHistory.classList.toggle("hidden", state.searchHistory.length === 0);
  if (state.searchHistory.length === 0) {
    elements.searchHistory.open = false;
    elements.searchHistoryCount.textContent = "";
    elements.searchHistoryList.innerHTML = "";
    return;
  }
  elements.searchHistoryCount.textContent = `${state.searchHistory.length}`;
  elements.searchHistoryList.innerHTML = state.searchHistory.map((item) => `
    <button class="search-history-item${item.id === state.activeSearchHistoryId ? " active" : ""}" type="button" data-search-history-id="${escapeHtml(item.id)}">
      <span>${escapeHtml(item.query)}</span>
      <small>${escapeHtml(item.mode)} · ${item.total} 个结果 · ${formatSearchHistoryTime(item.createdAt)}</small>
    </button>`).join("");
  elements.searchHistoryList.querySelectorAll<HTMLButtonElement>("[data-search-history-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.searchHistory.find((candidate) => candidate.id === button.dataset.searchHistoryId);
      if (!item) return;
      state.activeSearchHistoryId = item.id;
      elements.searchInput.value = item.query;
      elements.searchMode.value = item.mode;
      setSidebarMode("search");
      renderSearchResults(item.result);
    });
  });
}

function formatSearchHistoryTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "较早";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function loadRecentlyClosed(): void {
  try {
    const value = JSON.parse(localStorage.getItem(RECENTLY_CLOSED_KEY) ?? "[]") as unknown;
    state.recentlyClosed = Array.isArray(value)
      ? value.filter(isRecentlyClosedFile).slice(0, RECENTLY_CLOSED_LIMIT)
      : [];
  } catch {
    state.recentlyClosed = [];
  }
}

function isRecentlyClosedFile(value: unknown): value is RecentlyClosedFile {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RecentlyClosedFile>;
  return typeof item.id === "string"
    && typeof item.sourceId === "string"
    && typeof item.sourceName === "string"
    && typeof item.relPath === "string"
    && typeof item.title === "string"
    && typeof item.closedAt === "string";
}

function rememberRecentlyClosed(item: WorkspaceWindow): void {
  if (item.kind !== "entry") return;
  const recentlyClosed: RecentlyClosedFile = {
    id: item.id,
    sourceId: item.sourceId,
    sourceName: item.sourceName,
    relPath: item.relPath,
    title: item.title,
    closedAt: new Date().toISOString(),
  };
  state.recentlyClosed = [
    recentlyClosed,
    ...state.recentlyClosed.filter((candidate) => candidate.id !== recentlyClosed.id),
  ].slice(0, RECENTLY_CLOSED_LIMIT);
  persistRecentlyClosed();
}

function removeRecentlyClosed(sourceId: string, relPath: string): void {
  const id = windowKey(sourceId, relPath);
  const next = state.recentlyClosed.filter((item) => item.id !== id);
  if (next.length === state.recentlyClosed.length) return;
  state.recentlyClosed = next;
  persistRecentlyClosed();
}

function persistRecentlyClosed(): void {
  localStorage.setItem(RECENTLY_CLOSED_KEY, JSON.stringify(state.recentlyClosed));
}

function clearRecentlyClosed(): void {
  state.recentlyClosed = [];
  localStorage.removeItem(RECENTLY_CLOSED_KEY);
  renderRecentlyClosed();
  notify("已清空最近关闭");
}

function renderRecentlyClosed(): void {
  elements.clearRecentlyClosedButton.classList.toggle("hidden", state.recentlyClosed.length === 0);
  if (state.recentlyClosed.length === 0) {
    elements.recentlyClosedList.innerHTML = `<div class="recently-closed-empty">关闭过的 Markdown 会出现在这里，点击即可快速恢复。</div>`;
    return;
  }
  elements.recentlyClosedList.innerHTML = state.recentlyClosed.map((item) => `
    <button class="recently-closed-item" type="button" data-reopen-source="${escapeHtml(item.sourceId)}" data-reopen-path="${escapeHtml(item.relPath)}">
      <span class="recently-closed-icon">·</span>
      <span class="recently-closed-main"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.sourceName)} / ${escapeHtml(item.relPath)}</small></span>
      <span class="recently-closed-time">${formatSearchHistoryTime(item.closedAt)}</span>
      <em>打开</em>
    </button>`).join("");
  elements.recentlyClosedList.querySelectorAll<HTMLButtonElement>("[data-reopen-path]").forEach((button) => {
    button.addEventListener("click", () => {
      void openEntry(button.dataset.reopenPath ?? "", button.dataset.reopenSource);
    });
  });
}

function setSidebarMode(mode: SidebarMode): void {
  state.sidebarMode = mode;
  if (mode === "search" && state.fileCollapsed) toggleFileSidebar();
  elements.fileManagerPanel.classList.toggle("hidden", mode !== "files");
  elements.searchSidebarPanel.classList.toggle("hidden", mode !== "search");
  elements.railFiles.classList.toggle("active", mode === "files");
  elements.railSearch.classList.toggle("active", mode === "search");
}

function openCreateDialog(): void {
  if (!state.selectedSource) {
    notify("请先加载一个 Markdown 知识库目录。", true);
    openSourceDialog();
    return;
  }
  elements.entryForm.reset();
  const base = state.currentFolder ? `${state.currentFolder}/` : "";
  elements.newPath.value = `${base}新笔记.md`;
  elements.entryDialog.showModal();
  window.setTimeout(() => elements.newTitle.focus(), 0);
}

async function createEntry(): Promise<void> {
  const source = state.selectedSource;
  const path = elements.newPath.value.trim();
  if (!source || !path) {
    notify("新建笔记需要相对路径。", true);
    return;
  }
  const title = elements.newTitle.value.trim() || titleFromPath(path);
  const response = await client.createEntry({
    source: source.id,
    relPath: path,
    title,
    content: elements.newContent.value,
  });
  if (!response.ok) {
    notify(response.error.message, true);
    return;
  }
  elements.entryDialog.close("default");
  state.entry = response.value;
  state.draftContent = response.value.content;
  upsertWindow(response.value);
  state.currentFolder = parentPath(response.value.relPath);
  state.viewMode = "preview";
  state.dirty = false;
  expandFolderState(state.currentFolder);
  await refreshAfterMutation();
  await loadFolderPath(state.currentFolder);
  renderWorkspace();
  notify(`已创建 ${response.value.relPath}`);
}

function openSourceDialog(): void {
  elements.sourceForm.reset();
  elements.sourceDialog.showModal();
  window.setTimeout(() => elements.sourcePath.focus(), 0);
}

async function addSource(): Promise<void> {
  const path = elements.sourcePath.value.trim();
  if (!path) {
    notify("请输入本地目录绝对路径。", true);
    return;
  }
  const response = await client.addSource({ path });
  if (!response.ok) {
    notify(response.error.message, true);
    return;
  }
  elements.sourceDialog.close("default");
  await loadSources(response.value.source.id);
  notify(`已加载 ${response.value.source.name} · ${response.value.files} 个 Markdown 文件`);
}

function toggleSourcePopover(): void {
  if (state.settingsOpen) closeSettings();
  elements.sourcePopover.classList.toggle("hidden");
}

function closeSourcePopover(): void {
  elements.sourcePopover.classList.add("hidden");
}

function toggleWindowManager(): void {
  state.windowManagerOpen = !state.windowManagerOpen;
  elements.windowManagerPopover.classList.toggle("hidden", !state.windowManagerOpen);
  elements.windowManagerButton.setAttribute("aria-expanded", String(state.windowManagerOpen));
  if (state.windowManagerOpen) renderWindowManager();
}

function closeWindowManager(): void {
  if (!state.windowManagerOpen) return;
  state.windowManagerOpen = false;
  elements.windowManagerPopover.classList.add("hidden");
  elements.windowManagerButton.setAttribute("aria-expanded", "false");
}

function toggleDetails(): void {
  state.detailsOpen = !state.detailsOpen;
  renderDetails();
}

function openWorkspaceWindow(): void {
  if (!confirmLeaveWindow()) return;
  const id = `workspace:${Date.now()}-${++workspaceWindowSerial}`;
  state.windows.push({
    id,
    kind: "workspace",
    sourceId: "",
    sourceName: "pwiki",
    relPath: "",
    title: "新工作区",
  });
  activateWorkspaceWindow(state.windows.at(-1)!);
}

function windowKey(sourceId: string, relPath: string): string {
  return `${sourceId}::${relPath}`;
}

function upsertWindow(entry: ApiEntry): void {
  const id = windowKey(entry.sourceId, entry.relPath);
  const source = state.sources.find((candidate) => candidate.id === entry.sourceId);
  const existing = state.windows.find((item) => item.id === id);
  if (existing) {
    existing.title = entry.title;
    existing.sourceName = source?.name ?? existing.sourceName;
  } else {
    state.windows.push({
      id,
      kind: "entry",
      sourceId: entry.sourceId,
      sourceName: source?.name ?? entry.sourceId,
      relPath: entry.relPath,
      title: entry.title,
    });
  }
  state.activeWindowId = id;
}

function removeWindow(id: string): void {
  state.windows = state.windows.filter((item) => item.id !== id);
  if (state.activeWindowId === id) state.activeWindowId = undefined;
}

function updateWindowPath(previousId: string | undefined, entry: ApiEntry): void {
  if (previousId && previousId !== windowKey(entry.sourceId, entry.relPath)) removeWindow(previousId);
  upsertWindow(entry);
}

function confirmLeaveWindow(): boolean {
  return !state.dirty || window.confirm("当前 Markdown 有未保存修改，切换窗口会放弃这些修改。是否继续？");
}

async function closeWindow(id: string): Promise<void> {
  const index = state.windows.findIndex((item) => item.id === id);
  if (index < 0) return;
  if (state.activeWindowId === id && !confirmLeaveWindow()) return;
  rememberRecentlyClosed(state.windows[index]);
  const wasActive = state.activeWindowId === id;
  removeWindow(id);
  if (!wasActive) {
    renderWorkspace();
    return;
  }
  const next = state.windows[index] ?? state.windows[index - 1];
  state.entry = null;
  state.draftContent = "";
  state.viewMode = "preview";
  state.dirty = false;
  state.detailsOpen = false;
  if (next) await activateWindow(next.id);
  else renderWorkspace();
}

function windowLocation(item: WorkspaceWindow): string {
  return item.kind === "workspace" ? "空白工作区" : `${item.sourceName} / ${item.relPath}`;
}

function renderTabs(): void {
  elements.tabBar.classList.toggle("empty-tabs", state.windows.length === 0);
  elements.tabBar.classList.toggle("compact-tabs", state.windows.length > 5);
  elements.tabBar.classList.toggle("stacked-tabs", state.windows.length > 10);
  elements.tabBar.innerHTML = state.windows.length
    ? state.windows.map((item) => `<div class="note-tab${item.id === state.activeWindowId ? " active" : ""}" role="tab" aria-selected="${item.id === state.activeWindowId}">
        <button class="tab-main" type="button" data-window-open="${escapeHtml(item.id)}" title="${escapeHtml(windowLocation(item))}"><span class="tab-dot"></span><span class="tab-title">${escapeHtml(item.title)}</span></button>
        <button class="tab-close" type="button" data-window-close="${escapeHtml(item.id)}" title="关闭窗口">×</button>
      </div>`).join("")
    : `<div class="tab-empty"><span class="tab-dot"></span><span>没有打开的窗口</span></div>`;
  elements.tabBar.querySelectorAll<HTMLButtonElement>("[data-window-open]").forEach((button) => {
    button.addEventListener("click", () => { void activateWindow(button.dataset.windowOpen ?? ""); });
  });
  elements.tabBar.querySelectorAll<HTMLButtonElement>("[data-window-close]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      void closeWindow(button.dataset.windowClose ?? "");
    });
  });
}

function renderWindowManager(): void {
  const opened = state.windows;
  const candidates = allLoadedFiles().filter((file) => !state.windows.some((item) => item.id === windowKey(file.sourceId, file.relPath)));
  elements.windowManagerContent.innerHTML = `
    <div class="window-manager-heading"><div><span class="panel-eyebrow">Workspace windows</span><strong>窗口管理</strong></div><span class="window-manager-count">${opened.length} 个已打开</span></div>
    <section class="window-manager-section"><div class="window-manager-section-title">已打开 <span>${opened.length}</span></div>
      ${opened.length ? opened.map((item) => `<div class="window-row${item.id === state.activeWindowId ? " active" : ""}">
        <button class="window-row-main" type="button" data-window-open="${escapeHtml(item.id)}"><span class="tab-dot"></span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(windowLocation(item))}</small></span></button>
        <button class="small-icon-button" type="button" data-window-close="${escapeHtml(item.id)}" title="关闭窗口">×</button>
      </div>`).join("") : `<div class="window-empty">暂无打开窗口。点击文件或从下方选择页面。</div>`}
    </section>
    <section class="window-manager-section unopened-section"><div class="window-manager-section-title">未打开页面 <span>${candidates.length}</span></div>
      ${candidates.length ? candidates.slice(0, 40).map((file) => `<button class="window-row unopened" type="button" data-window-open="${escapeHtml(windowKey(file.sourceId, file.relPath))}" data-window-source="${escapeHtml(file.sourceId)}" data-window-path="${escapeHtml(file.relPath)}"><span class="tab-dot"></span><span><strong>${escapeHtml(file.title ?? file.name)}</strong><small>${escapeHtml(file.relPath)}</small></span><em>打开</em></button>`).join("") : `<div class="window-empty">当前已加载的文件都已打开，或请先展开文件目录。</div>`}
    </section>`;
  elements.windowManagerContent.querySelectorAll<HTMLElement>("[data-window-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.windowOpen ?? "";
      const sourceId = button.dataset.windowSource;
      const path = button.dataset.windowPath;
      if (sourceId && path) void openEntry(path, sourceId);
      else void activateWindow(id);
    });
  });
  elements.windowManagerContent.querySelectorAll<HTMLButtonElement>("[data-window-close]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      void closeWindow(button.dataset.windowClose ?? "");
    });
  });
}

async function activateWindow(id: string): Promise<void> {
  const item = state.windows.find((candidate) => candidate.id === id);
  if (!item || state.activeWindowId === id) {
    closeWindowManager();
    return;
  }
  if (!confirmLeaveWindow()) return;
  if (item.kind === "workspace") {
    activateWorkspaceWindow(item);
  } else {
    await openEntry(item.relPath, item.sourceId, true);
  }
  closeWindowManager();
}

function activateWorkspaceWindow(item: WorkspaceWindow): void {
  state.activeWindowId = item.id;
  state.entry = null;
  state.draftContent = "";
  state.currentFolder = "";
  state.viewMode = "preview";
  state.dirty = false;
  state.detailsOpen = false;
  setSidebarMode("files");
  renderWorkspace();
  elements.fileSidebar.classList.remove("mobile-open");
}

function toggleFileSidebar(): void {
  state.fileCollapsed = !state.fileCollapsed;
  elements.fileSidebar.classList.toggle("collapsed", state.fileCollapsed);
  elements.workspaceGrid.classList.toggle("file-collapsed", state.fileCollapsed);
  elements.toggleFileSidebarButton.textContent = state.fileCollapsed ? "›" : "‹";
  elements.toggleFileSidebarButton.title = state.fileCollapsed ? "展开文件栏" : "收起文件栏";
}

function openSettings(): void {
  closeSourcePopover();
  closeSearch();
  elements.fileSidebar.classList.remove("mobile-open");
  state.settingsOpen = true;
  elements.workspaceGrid.classList.add("settings-mode");
  elements.settingsView.classList.remove("hidden");
  renderSettings();
  void loadSettings();
}

function closeSettings(): void {
  state.settingsOpen = false;
  elements.workspaceGrid.classList.remove("settings-mode");
  elements.settingsView.classList.add("hidden");
}

async function selectSettingsModel(modelId: string): Promise<void> {
  if (!modelId || modelId === state.settings?.currentModelId) return;
  const response = await client.selectModel({ modelId });
  if (!response.ok) {
    elements.settingsModelMessage.textContent = response.error.message;
    notify(response.error.message, true);
    return;
  }
  state.settings = response.value.settings;
  state.status = await readStatusValue();
  renderSettings();
  notify(response.value.message);
}

async function toggleSemanticService(): Promise<void> {
  const enabled = state.settings?.repository.semantic ?? state.status?.semantic ?? false;
  if (!enabled && !window.confirm("启用语义服务可能需要初始化本地模型或访问模型仓库，是否继续？")) return;
  const response = await client.setSemantic({ enabled });
  if (!response.ok) {
    elements.settingsModelMessage.textContent = response.error.message;
    notify(response.error.message, true);
    return;
  }
  state.settings = response.value.settings;
  state.status = await readStatusValue();
  renderSettings();
  notify(response.value.message);
}

async function toggleReranker(): Promise<void> {
  const enabled = elements.settingsRerankerToggle.checked;
  elements.settingsRerankerToggle.disabled = true;
  const response = await client.setReranker({ enabled });
  elements.settingsRerankerToggle.disabled = false;
  if (!response.ok) {
    renderRerankerControl();
    notify(response.error.message, true);
    return;
  }
  state.settings = response.value.settings;
  state.status = await readStatusValue();
  renderRerankerControl();
  renderSettings();
  notify(response.value.message);
}

function renderRerankerControl(): void {
  const reranker = state.settings?.repository.reranker ?? state.status?.reranker;
  const enabled = reranker?.enabled ?? false;
  elements.settingsRerankerToggle.checked = enabled;
  elements.settingsRerankerToggle.disabled = state.settings ? !state.settings.sourceManagement : false;
  elements.settingsRerankerBadge.textContent = enabled ? "已开启" : "默认关闭";
  elements.settingsRerankerState.textContent = reranker?.loaded
    ? `已加载 ${reranker.runtimeModel ?? reranker.model}`
    : enabled
      ? "启用后首次混合搜索时加载模型"
      : "默认关闭，保持基础搜索稳定";
}

async function readStatusValue(): Promise<ApiStatus | undefined> {
  const response = await client.status();
  if (!response.ok) return undefined;
  return response.value;
}

async function addSettingsSource(): Promise<void> {
  const path = elements.settingsSourcePath.value.trim();
  if (!path) {
    elements.settingsSourceMessage.textContent = "请输入本地目录绝对路径。";
    return;
  }
  const response = await client.addSource({ path });
  if (!response.ok) {
    elements.settingsSourceMessage.textContent = response.error.message;
    notify(response.error.message, true);
    return;
  }
  elements.settingsSourcePath.value = "";
  elements.settingsSourceMessage.textContent = `已加载 ${response.value.source.name} · ${response.value.files} 个 Markdown 文件。`;
  await loadSources(response.value.source.id);
  await loadSettings();
}

async function refreshSource(sourceId: string): Promise<void> {
  const response = await client.refresh({ source: sourceId });
  if (!response.ok) {
    notify(response.error.message, true);
    return;
  }
  if (state.selectedSource?.id === sourceId) await loadSources(sourceId);
  await loadStatus();
  await loadSettings();
  notify(`已刷新 ${sourceId} · ${response.value.files} 个 Markdown 文件`);
}

async function removeSettingsSource(sourceId: string): Promise<void> {
  const source = state.sources.find((candidate) => candidate.id === sourceId);
  if (!source || !window.confirm(`确认移除数据源“${source.name}”吗？\n这只会移除 Pwiki 索引，不会删除磁盘文件。`)) return;
  const response = await client.removeSource(sourceId);
  if (!response.ok) {
    notify(response.error.message, true);
    return;
  }
  if (state.selectedSource?.id === sourceId) {
    state.selectedSource = undefined;
    state.entry = null;
    state.draftContent = "";
    resetFileState();
  }
  await loadSources();
  await loadSettings();
  notify(`已移除数据源 ${source.name}`);
}

function renderSettings(): void {
  const settings = state.settings;
  if (!settings) {
    elements.settingsRepositoryStats.innerHTML = `<div class="settings-loading">正在读取仓库信息…</div>`;
    elements.settingsSourceList.innerHTML = "";
    return;
  }
  const repository = settings.repository;
  elements.settingsStorageBadge.textContent = repository.storage === "local" ? "本地仓库" : repository.storage;
  elements.settingsRepositoryStats.innerHTML = [
    ["数据源", `${repository.sourceCount} 个`],
    ["Markdown", repository.fileCount.toLocaleString()],
    ["嵌入向量", repository.embeddings.toLocaleString()],
    ["已编译", repository.compiled.toLocaleString()],
  ].map(([label, value]) => `<div class="settings-stat"><span>${label}</span><strong>${value}</strong></div>`).join("");
  elements.settingsLastScan.textContent = repository.lastScan ? formatDate(repository.lastScan) : "尚未扫描";
  const queue = repository.backgroundVectors;
  elements.settingsVectorState.textContent = queue.running
    ? `运行中 · 队列 ${queue.queued}`
    : `空闲 · 完成 ${queue.completed} · 失败 ${queue.failed}`;
  elements.settingsSemanticBadge.textContent = repository.semantic ? "语义就绪" : "关键词模式";
  elements.settingsSemanticButton.textContent = repository.semantic ? "关闭语义服务" : "启用语义服务";
  elements.settingsSemanticButton.disabled = !settings.sourceManagement;
  elements.settingsModelList.innerHTML = settings.models.map((model) => `
    <button class="model-option${model.id === settings.currentModelId ? " active" : ""}" type="button" data-model-id="${escapeHtml(model.id)}" ${settings.sourceManagement ? "" : "disabled"}>
      <span class="model-option-main"><strong>${escapeHtml(model.name)}</strong><small>${escapeHtml(model.id)} · ${model.dim}d · ${model.languages.length} languages</small></span>
      <span class="model-option-check">${model.id === settings.currentModelId ? "当前" : "选择"}</span>
    </button>`).join("");
  elements.settingsModelMessage.textContent = `当前模型：${settings.currentModelId} · ${repository.modelDim} 维`;
  elements.settingsLlmBase.textContent = settings.llm.apiBase || "未配置";
  elements.settingsLlmModel.textContent = settings.llm.model || "未配置";
  elements.settingsLlmKey.textContent = settings.llm.hasKey ? "已配置（不显示）" : "未配置";
  elements.settingsLlmBadge.textContent = settings.llm.hasKey ? "已连接配置" : "未配置";
  renderRerankerControl();
  elements.settingsSourceCount.textContent = `${settings.sources.length} 个`;
  elements.settingsSourcePath.disabled = !settings.sourceManagement;
  elements.settingsSourceForm.querySelector<HTMLButtonElement>("button[type=submit]")!.disabled = !settings.sourceManagement;
  elements.settingsSourceMessage.textContent = settings.sourceManagement ? "路径只在本地服务端使用，页面不会回显物理路径。" : "当前服务实例已关闭数据源管理。";
  elements.settingsSourceList.innerHTML = settings.sources.length
    ? settings.sources.map((source) => `<div class="settings-source-row">
        <button class="settings-source-select${source.id === state.selectedSource?.id ? " active" : ""}" type="button" data-settings-source="select" data-source-id="${escapeHtml(source.id)}">
          <span><strong>${escapeHtml(source.name)}</strong><small>${escapeHtml(source.id)}</small></span><em>${source.fileCount.toLocaleString()} 文件</em>
        </button>
        <button class="small-icon-button" type="button" title="刷新数据源" data-settings-source="refresh" data-source-id="${escapeHtml(source.id)}">↻</button>
        <button class="small-icon-button source-remove-button" type="button" title="移除数据源" data-settings-source="remove" data-source-id="${escapeHtml(source.id)}" ${settings.sourceManagement ? "" : "disabled"}>×</button>
      </div>`).join("")
    : `<div class="settings-empty">还没有加载 Markdown 数据源。</div>`;
}

function setViewMode(mode: ViewMode): void {
  if (mode !== "preview" && !state.entry) {
    notify("请先打开一篇 Markdown 文件。", true);
    return;
  }
  state.viewMode = mode;
  renderWorkspace();
  if (mode === "live") window.setTimeout(() => elements.liveEntryEditor.focus(), 0);
  if (mode === "source") window.setTimeout(() => elements.entryEditor.focus(), 0);
}

async function saveEntry(): Promise<void> {
  const source = state.selectedSource;
  const entry = state.entry;
  if (!source || !entry) return;
  const content = currentDraftContent();
  const response = await client.modifyEntry({
    source: source.id,
    relPath: entry.relPath,
    content,
  });
  if (!response.ok) {
    notify(response.error.message, true);
    return;
  }
  state.entry = response.value;
  state.draftContent = response.value.content;
  state.dirty = false;
  state.viewMode = "preview";
  await refreshAfterMutation();
  renderWorkspace();
  notify("已保存 Markdown，关键词索引已更新，语义索引按变更 chunk 维护。" );
}

async function renameEntry(): Promise<void> {
  const source = state.selectedSource;
  const entry = state.entry;
  const title = valueFromInput("rename-title");
  if (!source || !entry || !title) return;
  const response = await client.renameEntry({ source: source.id, relPath: entry.relPath, title });
  if (!response.ok) {
    notify(response.error.message, true);
    return;
  }
  updateWindowPath(state.activeWindowId, response.value);
  state.entry = response.value;
  state.draftContent = response.value.content;
  state.dirty = false;
  await refreshAfterMutation();
  renderWorkspace();
  notify("文件标题已更新。" );
}

async function moveEntry(): Promise<void> {
  const source = state.selectedSource;
  const entry = state.entry;
  const newRelPath = valueFromInput("move-path");
  if (!source || !entry || !newRelPath) return;
  const response = await client.moveEntry({ source: source.id, relPath: entry.relPath, newRelPath });
  if (!response.ok) {
    notify(response.error.message, true);
    return;
  }
  updateWindowPath(state.activeWindowId, response.value);
  state.entry = response.value;
  state.draftContent = response.value.content;
  state.dirty = false;
  state.currentFolder = parentPath(response.value.relPath);
  expandFolderState(state.currentFolder);
  await refreshAfterMutation();
  await loadFolderPath(state.currentFolder);
  renderWorkspace();
  notify(`文件已移动到 ${response.value.relPath}`);
}

async function deleteEntry(): Promise<void> {
  const source = state.selectedSource;
  const entry = state.entry;
  if (!source || !entry) return;
  if (!window.confirm(`确认删除“${entry.relPath}”吗？\n这会删除磁盘上的 Markdown 文件。`)) return;
  const response = await client.deleteEntry({ source: source.id, relPath: entry.relPath });
  if (!response.ok) {
    notify(response.error.message, true);
    return;
  }
  removeWindow(windowKey(entry.sourceId, entry.relPath));
  state.currentFolder = parentPath(entry.relPath);
  state.entry = null;
  state.draftContent = "";
  state.viewMode = "preview";
  state.dirty = false;
  await refreshAfterMutation();
  await loadFolderPath(state.currentFolder);
  renderWorkspace();
  notify(`已删除 ${entry.relPath}`);
}

async function refreshWorkspace(): Promise<void> {
  const source = state.selectedSource;
  const response = await client.refresh(source ? { source: source.id } : {});
  if (!response.ok) {
    notify(response.error.message, true);
    return;
  }
  await loadStatus();
  await refreshAfterMutation();
  notify(`索引已刷新 · ${response.value.files} 个 Markdown 文件`);
}

async function refreshAfterMutation(): Promise<void> {
  await refreshSourceList();
  const paths = [...state.expandedFolders];
  state.folders.clear();
  await Promise.all(paths.map((path) => loadFolder(path, true)));
  if (!state.folders.has("")) await loadFolder("", true);
}

function resetFileState(): void {
  state.folders.clear();
  state.loadingFolders.clear();
  state.expandedFolders.clear();
  state.expandedFolders.add("");
  state.currentFolder = "";
  state.filterResults = null;
  state.filterTotal = 0;
  state.filterLoading = false;
}

function expandFolderState(path: string): void {
  state.expandedFolders.add("");
  let prefix = "";
  for (const part of path.split("/").filter(Boolean)) {
    prefix = prefix ? `${prefix}/${part}` : part;
    state.expandedFolders.add(prefix);
  }
}

function renderWorkspace(): void {
  renderTabs();
  setSidebarMode(state.sidebarMode);
  renderSourcePicker();
  renderFileTree();
  renderBreadcrumb();
  renderDocumentActions();
  renderEntryView();
  renderRecentlyClosed();
  renderOutline();
  renderDetails();
  renderRerankerControl();
  if (state.windowManagerOpen) renderWindowManager();
  updateEditorCount();
}

function renderSourcePicker(): void {
  if (state.sources.length === 0) {
    elements.sourceSelect.innerHTML = `<option value="">未加载知识库</option>`;
    elements.sourceSelect.disabled = true;
    elements.sourcePopoverName.textContent = "未加载";
    elements.sourcePopoverMeta.textContent = "从设置页添加或移除 Markdown 数据源。";
    renderBrand();
    return;
  }
  elements.sourceSelect.disabled = false;
  elements.sourceSelect.innerHTML = state.sources.map((source) => `<option value="${escapeHtml(source.id)}">${escapeHtml(source.name)} · ${source.fileCount}</option>`).join("");
  elements.sourceSelect.value = state.selectedSource?.id ?? state.sources[0]?.id ?? "";
  const selected = state.sources.find((source) => source.id === elements.sourceSelect.value) ?? state.sources[0];
  elements.sourcePopoverName.textContent = selected.name;
  elements.sourcePopoverMeta.textContent = `${selected.fileCount.toLocaleString()} 个 Markdown 文件 · ${selected.id}`;
  renderBrand(selected);
}

function renderBrand(source = state.selectedSource): void {
  const repositoryName = source?.name?.trim() || "知识库";
  elements.brandRepositoryName.textContent = repositoryName;
  elements.brandProductName.textContent = "pwiki";
  document.title = `${repositoryName} · pwiki`;
}

function renderFileTree(): void {
  const source = state.selectedSource;
  const rootItems = state.folders.get("") ?? [];
  elements.treeCount.textContent = source ? String(source.fileCount) : "0";
  if (!source) {
    elements.fileTree.innerHTML = `<div class="tree-empty"><span class="empty-tree-icon">＋</span><strong>还没有知识库</strong><span>加载一个本地 Markdown 目录开始。</span><button class="secondary-button" data-tree-load="true" type="button">加载目录</button></div>`;
    elements.fileTree.querySelector("[data-tree-load]")?.addEventListener("click", () => openSourceDialog());
    return;
  }
  if (state.loadingFolders.has("") && rootItems.length === 0) {
    elements.fileTree.innerHTML = `<div class="tree-loading"><span class="loading-spinner"></span>正在读取文件树…</div>`;
    return;
  }
  if (state.filter) {
    if (state.filterLoading) {
      elements.fileTree.innerHTML = `<div class="tree-loading"><span class="loading-spinner"></span>正在搜索整个知识库…</div>`;
      return;
    }
    const matches = state.filterResults ?? [];
    elements.treeCount.textContent = String(state.filterTotal);
    elements.fileTree.innerHTML = matches.length
      ? `<div class="tree-filter-label">匹配 ${state.filterTotal} 个文件 · 显示前 ${matches.length} 个</div>${matches.map((file) => renderFileRow(file, 0, true)).join("")}`
      : `<div class="tree-empty compact-tree-empty">没有匹配“${escapeHtml(state.filter)}”的文件</div>`;
    bindFileTreeActions();
    return;
  }
  elements.fileTree.innerHTML = rootItems.length
    ? renderTreeItems(rootItems, 0)
    : `<div class="tree-empty compact-tree-empty">当前知识库还没有 Markdown 文件</div>`;
  bindFileTreeActions();
}

function renderTreeItems(items: ApiFile[], depth: number): string {
  return items.map((file) => {
    if (file.kind === "directory") {
      const expanded = state.expandedFolders.has(file.relPath);
      const children = expanded ? state.folders.get(file.relPath) : undefined;
      return `<div class="tree-branch" role="treeitem" aria-expanded="${expanded}" data-depth="${depth}">
        <button class="tree-row folder-row" type="button" data-folder-path="${escapeHtml(file.relPath)}" style="--depth:${depth}">
          <span class="tree-caret">${expanded ? "⌄" : "›"}</span><span class="tree-icon folder-icon">${expanded ? "▾" : "▸"}</span><span class="tree-label">${escapeHtml(file.name)}</span>
        </button>
        ${expanded ? `<div class="tree-children">${children?.length ? renderTreeItems(children, depth + 1) : (state.loadingFolders.has(file.relPath) ? `<div class="tree-loading nested"><span class="loading-spinner"></span>读取中…</div>` : `<div class="tree-empty nested-empty">空目录</div>`)}</div>` : ""}
      </div>`;
    }
    return renderFileRow(file, depth);
  }).join("");
}

function renderFileRow(file: ApiFile, depth: number, showPath = false): string {
  const active = state.entry?.relPath === file.relPath && state.entry.sourceId === file.sourceId;
  const label = file.title || file.name.replace(/\.md$/i, "");
  return `<button class="tree-row file-row${active ? " active" : ""}" type="button" data-file-path="${escapeHtml(file.relPath)}" style="--depth:${depth}">
    <span class="tree-caret"></span><span class="tree-icon file-icon">·</span><span class="tree-label">${escapeHtml(label)}${showPath ? `<small class="tree-match-path">${escapeHtml(file.relPath)}</small>` : ""}</span><span class="tree-extension">md</span>
  </button>`;
}

function bindFileTreeActions(): void {
  elements.fileTree.querySelectorAll<HTMLButtonElement>("[data-folder-path]").forEach((button) => {
    button.addEventListener("click", () => { void toggleFolder(button.dataset.folderPath ?? ""); });
  });
  elements.fileTree.querySelectorAll<HTMLButtonElement>("[data-file-path]").forEach((button) => {
    button.addEventListener("click", () => { void openEntry(button.dataset.filePath ?? ""); });
  });
}

function allLoadedFiles(): ApiFile[] {
  const files = new Map<string, ApiFile>();
  for (const items of state.folders.values()) {
    for (const file of items) if (file.kind === "file") files.set(file.relPath, file);
  }
  return [...files.values()].sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function renderBreadcrumb(): void {
  const source = state.selectedSource;
  if (!source) {
    elements.breadcrumb.innerHTML = `<span class="muted">选择左侧 Markdown 文件</span>`;
    return;
  }
  const location = state.entry ? state.entry.relPath : state.currentFolder || "根目录";
  elements.breadcrumb.innerHTML = `<span class="crumb-source">${escapeHtml(source.name)}</span><span class="crumb-divider">/</span><span>${escapeHtml(location)}</span>`;
}

function renderDocumentActions(): void {
  elements.previewModeButton.classList.toggle("active", state.viewMode === "preview");
  elements.liveModeButton.classList.toggle("active", state.viewMode === "live");
  elements.sourceModeButton.classList.toggle("active", state.viewMode === "source");
  elements.saveEntryButton.classList.toggle("hidden", !state.entry || (!state.dirty && state.viewMode === "preview"));
}

function renderEntryView(): void {
  const entry = state.entry;
  const showPreview = Boolean(entry) && state.viewMode === "preview";
  const showLiveEditor = Boolean(entry) && state.viewMode === "live";
  const showSourceEditor = Boolean(entry) && state.viewMode === "source";
  elements.emptyState.classList.toggle("hidden", Boolean(entry));
  elements.entryView.classList.toggle("hidden", !showPreview);
  elements.liveEditorView.classList.toggle("hidden", !showLiveEditor);
  elements.editorView.classList.toggle("hidden", !showSourceEditor);
  if (!entry) {
    return;
  }
  const content = currentDraftContent();
  elements.entryPath.textContent = `${state.selectedSource?.name ?? entry.sourceId} / ${entry.relPath}`;
  elements.entryTitle.textContent = entry.title;
  const tags = entry.tags.filter(Boolean);
  elements.entryTags.innerHTML = tags.length
    ? tags.map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join("")
    : `<span class="muted">无标签</span>`;
  elements.entryMeta.textContent = entry.truncated ? "内容已截断" : `${content.length.toLocaleString()} 字符`;
  elements.markdownView.innerHTML = renderMarkdown(content);
  elements.editorPath.textContent = `${state.selectedSource?.name ?? entry.sourceId} / ${entry.relPath}`;
  elements.liveEditorPath.textContent = `${state.selectedSource?.name ?? entry.sourceId} / ${entry.relPath}`;
  elements.entryEditor.value = content;
  elements.liveEntryEditor.value = content;
  elements.liveMarkdownView.innerHTML = renderMarkdown(content);
  for (const indicator of [elements.dirtyIndicator, elements.liveDirtyIndicator]) {
    indicator.textContent = state.dirty ? "未保存" : "已加载";
    indicator.classList.toggle("dirty", state.dirty);
  }
}

function renderOutline(): void {
  const headings = state.entry ? extractHeadings(currentDraftContent()) : [];
  elements.outlineList.innerHTML = headings.map((heading) => `<button class="outline-item level-${heading.level}" type="button" data-heading-id="${escapeHtml(heading.id)}"><span>${escapeHtml(heading.text)}</span><small>${heading.line}</small></button>`).join("");
  elements.outlineEmpty.classList.toggle("hidden", headings.length > 0);
  elements.outlineList.classList.toggle("hidden", headings.length === 0);
  elements.outlineList.querySelectorAll<HTMLButtonElement>("[data-heading-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const container = state.viewMode === "live" ? elements.liveMarkdownView : elements.markdownView;
      const target = document.getElementById(button.dataset.headingId ?? "");
      if (target && container.contains(target)) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function renderDetails(): void {
  const entry = state.entry;
  const source = state.selectedSource;
  if (!entry || !source || !state.detailsOpen) {
    elements.detailsCard.classList.add("hidden");
    if (!entry || !source) elements.detailsCard.innerHTML = "";
    return;
  }
  elements.detailsCard.classList.remove("hidden");
  elements.detailsCard.innerHTML = `<div class="details-heading"><span class="panel-eyebrow">File actions</span><strong>文件属性</strong></div>
    <div class="details-source"><span>知识库</span><strong>${escapeHtml(source.name)}</strong></div>
    <form class="details-form" id="rename-form"><label>显示标题<input id="rename-title" value="${escapeHtml(entry.title)}" /></label><button class="secondary-button" type="submit">更新标题</button></form>
    <form class="details-form" id="move-form"><label>文件路径<input id="move-path" value="${escapeHtml(entry.relPath)}" spellcheck="false" /></label><button class="secondary-button" type="submit">移动文件</button></form>
    <div class="details-tags"><span>标签</span><div class="tag-row">${entry.tags.filter(Boolean).length ? entry.tags.filter(Boolean).map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join("") : `<em>暂无标签</em>`}</div></div>
    <button class="danger-button delete-button" id="delete-entry-button" type="button">删除 Markdown 文件</button>`;
  elements.detailsCard.querySelector("#rename-form")?.addEventListener("submit", (event) => { event.preventDefault(); void renameEntry(); });
  elements.detailsCard.querySelector("#move-form")?.addEventListener("submit", (event) => { event.preventDefault(); void moveEntry(); });
  elements.detailsCard.querySelector("#delete-entry-button")?.addEventListener("click", () => { void deleteEntry(); });
}

function renderThemeOptions(): void {
  const current = document.documentElement.dataset.theme as ThemeId | undefined;
  elements.themeOptions.innerHTML = themes.map((theme) => `<button class="theme-option${theme.id === current ? " active" : ""}" type="button" data-theme-id="${theme.id}">
    <span class="theme-swatch" style="--swatch:${theme.swatch}"></span><span><strong>${theme.label}</strong><small>${theme.description}</small></span><span class="theme-check">✓</span>
  </button>`).join("");
  elements.themeOptions.querySelectorAll<HTMLButtonElement>("[data-theme-id]").forEach((button) => {
    button.addEventListener("click", () => {
      applyTheme(button.dataset.themeId as ThemeId);
      elements.themePopover.classList.add("hidden");
    });
  });
}

function applyTheme(theme: ThemeId): void {
  if (!themes.some((option) => option.id === theme)) return;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("pwiki-theme", theme);
  renderThemeOptions();
}

function applyStoredTheme(): void {
  const stored = localStorage.getItem("pwiki-theme") as ThemeId | null;
  applyTheme(themes.some((theme) => theme.id === stored) ? stored! : "midnight");
}

function setConnectionState(ready: boolean, label: string): void {
  elements.statusPill.classList.toggle("ready", ready);
  elements.statusPill.classList.toggle("error", !ready);
  const text = elements.statusPill.querySelector("span:last-child");
  if (text) text.textContent = label;
}

function currentDraftContent(): string {
  return state.entry ? state.draftContent : "";
}

function handleDraftInput(content: string): void {
  if (!state.entry) return;
  state.draftContent = content;
  state.dirty = content !== state.entry.content;
  for (const indicator of [elements.dirtyIndicator, elements.liveDirtyIndicator]) {
    indicator.textContent = state.dirty ? "未保存" : "已加载";
    indicator.classList.toggle("dirty", state.dirty);
  }
  updateEditorCount();
  renderLivePreview();
  renderOutline();
  renderDocumentActions();
}

function renderLivePreview(): void {
  elements.liveMarkdownView.innerHTML = renderMarkdown(currentDraftContent());
}

function updateEditorCount(): void {
  const count = currentDraftContent().length.toLocaleString();
  elements.editorCount.textContent = `${count} 字符`;
  elements.liveEditorCount.textContent = `${count} 字符`;
}

function updateEditorCountIfVisible(): void {
  if (state.viewMode !== "preview") updateEditorCount();
}

function notify(message: string, error = false): void {
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", error);
  elements.toast.classList.add("show");
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("show"), 3400);
}

function valueFromInput(id: string): string {
  return (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? "";
}

function parentPath(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

function titleFromPath(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  return name.replace(/\.md$/i, "") || "未命名笔记";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function formatScore(score: number): string {
  return Number.isFinite(score) ? score.toFixed(2) : "—";
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return element?.tagName === "INPUT" || element?.tagName === "TEXTAREA" || element?.tagName === "SELECT";
}

function extractHeadings(value: string): HeadingItem[] {
  const headings: HeadingItem[] = [];
  const lines = stripFrontmatter(value).replace(/\r\n/g, "\n").split("\n");
  let headingIndex = 0;
  lines.forEach((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) return;
    headingIndex++;
    const text = match[2].trim();
    headings.push({ id: headingId(text, headingIndex), level: match[1].length, text, line: index + 1 });
  });
  return headings;
}

function headingId(text: string, index: number): string {
  const slug = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return `heading-${index}-${slug || "section"}`;
}

function renderMarkdown(value: string): string {
  const lines = stripFrontmatter(value).replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let headingIndex = 0;

  const closeList = () => {
    if (listType) output.push(`</${listType}>`);
    listType = null;
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (inCode) {
        output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
      }
      inCode = !inCode;
      return;
    }
    if (inCode) {
      codeLines.push(line);
      return;
    }
    if (!trimmed) {
      closeList();
      return;
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      closeList();
      headingIndex++;
      const text = heading[2].trim();
      const level = heading[1].length;
      output.push(`<h${level} id="${headingId(text, headingIndex)}">${inlineMarkdown(text)}</h${level}>`);
      return;
    }
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const nextList: "ul" | "ol" = unordered ? "ul" : "ol";
      if (listType !== nextList) {
        closeList();
        output.push(`<${nextList}>`);
        listType = nextList;
      }
      const item = (unordered ?? ordered)?.[1] ?? "";
      output.push(`<li>${inlineMarkdown(item)}</li>`);
      return;
    }
    closeList();
    if (/^\s*>\s?/.test(line)) {
      output.push(`<blockquote>${inlineMarkdown(line.replace(/^\s*>\s?/, ""))}</blockquote>`);
      return;
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      output.push("<hr>");
      return;
    }
    output.push(`<p>${inlineMarkdown(line)}</p>`);
  });

  closeList();
  if (inCode) output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  return output.join("");
}

function inlineMarkdown(value: string): string {
  const escaped = escapeHtml(value);
  const code: string[] = [];
  let result = escaped.replace(/`([^`]+)`/g, (_, content: string) => {
    const marker = `\u0000CODE${code.length}\u0000`;
    code.push(`<code>${content}</code>`);
    return marker;
  });
  result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return result.replace(/\u0000CODE(\d+)\u0000/g, (_, index: string) => code[Number(index)] ?? "");
}

function stripFrontmatter(value: string): string {
  return value.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>\'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

void boot().catch((error) => {
  setConnectionState(false, "连接失败");
  notify(error instanceof Error ? error.message : "页面初始化失败", true);
});
