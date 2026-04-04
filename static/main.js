const ICONS = {
  chevron: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
  library: '<svg viewBox="0 0 24 24"><path d="m3 7 9-4 9 4-9 4-9-4Z"/><path d="m3 12 9 4 9-4"/><path d="m3 17 9 4 9-4"/></svg>',
  compose: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 6v12l10-6Z"/></svg>',
  filePlus: '<svg viewBox="0 0 24 24"><path d="M7 4h7l5 5v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/><path d="M14 4v5h5"/><path d="M12 11v6M9 14h6"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="5" r="1.5" fill="currentColor"/><circle cx="12" cy="19" r="1.5" fill="currentColor"/></svg>',
};

const state = {
  library: { subjects: [] },
  selectedSubject: null,
  selectedUnit: null,
  expanded: new Set(),
  loading: false,
  mobile: window.matchMedia("(max-width: 860px)").matches,
  activeTab: "explore",
  defaultVoice: "",
};

const el = {
  subjectList: document.getElementById("subjectList"),
  subjectChip: document.getElementById("subjectChip"),
  unitChip: document.getElementById("unitChip"),
  statusChip: document.getElementById("statusChip"),
  focusTitle: document.getElementById("focusTitle"),
  focusBody: document.getElementById("focusBody"),
  exploreMeta: document.getElementById("exploreMeta"),
  detail: document.getElementById("detail"),
  composeHint: document.getElementById("composeHint"),
  input: document.getElementById("inputText"),
  voice: document.getElementById("voice"),
  cleanState: document.getElementById("cleanState"),
  charCount: document.getElementById("charCount"),
  overlay: document.getElementById("overlay"),
  toasts: document.getElementById("toasts"),
  generate: document.getElementById("generate"),
  generateSpinner: document.getElementById("generateSpinner"),
  addSubject: document.getElementById("addSubject"),
  addUnitHero: document.getElementById("addUnitHero"),
  deleteUnitHero: document.getElementById("deleteUnitHero"),
  toggleSidebar: document.getElementById("toggleSidebar"),
  openSidebar: document.getElementById("openSidebar"),
  floatingPlayer: document.getElementById("floatingPlayer"),
  fpUnit: document.getElementById("fpUnit"),
  fpSubject: document.getElementById("fpSubject"),
  fpBody: document.getElementById("fpBody"),
  fpAudio: document.getElementById("fpAudio"),
  closeFloatingPlayer: document.getElementById("closeFloatingPlayer"),
  openSettings: document.getElementById("openSettings"),
  closeSettings: document.getElementById("closeSettings"),
  settingsModal: document.getElementById("settingsModal"),
  settingApiKey: document.getElementById("settingApiKey"),
  settingDefaultVoice: document.getElementById("settingDefaultVoice"),
  settingAudioDir: document.getElementById("settingAudioDir"),
  saveSettingsBtn: document.getElementById("saveSettings"),
  promptModal: document.getElementById("promptModal"),
  promptTitle: document.getElementById("promptTitle"),
  promptInput: document.getElementById("promptInput"),
  submitPrompt: document.getElementById("submitPrompt"),
  closePrompt: document.getElementById("closePrompt"),
  tabButtons: document.querySelectorAll("[data-tab]"),
  panels: {
    explore: document.getElementById("panel-explore"),
    compose: document.getElementById("panel-compose"),
    player: document.getElementById("panel-player"),
  },
};

function sanitizeMarkdown(text) {
  let value = (text || "").replace(/\r\n/g, "\n");
  value = value.replace(/```[^\n]*\n?/g, "");
  value = value.replace(/```/g, "");
  value = value.replace(/`([^`]+)`/g, "$1");
  value = value.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
  value = value.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  value = value.replace(/^\s{0,3}#{1,6}\s*/gm, "");
  value = value.replace(/^\s{0,3}>\s?/gm, "");
  value = value.replace(/^\s*[-*+]\s+/gm, "");
  value = value.replace(/^\s*\d+\.\s+/gm, "");
  value = value.replace(/^\s*([-*_]\s*){3,}$/gm, "");
  value = value.replace(/\*\*([^*]+)\*\*/g, "$1");
  value = value.replace(/__([^_]+)__/g, "$1");
  value = value.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1");
  value = value.replace(/(?<!_)_([^_\n]+)_(?!_)/g, "$1");
  value = value.replace(/~~([^~]+)~~/g, "$1");
  value = value.replace(/\n{3,}/g, "\n\n");
  return value.trim();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toast(message, type = "info") {
  const node = document.createElement("div");
  node.className = `toast ${type === "error" ? "error" : ""}`.trim();
  node.textContent = message;
  el.toasts.appendChild(node);
  window.setTimeout(() => node.remove(), 3200);
}

function formatDate(value) {
  if (!value) {
    return "없음";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function selectedSubject() {
  return state.library.subjects.find((subject) => subject.name === state.selectedSubject) || null;
}

function selectedUnit() {
  const subject = selectedSubject();
  return subject ? subject.units.find((unit) => unit.name === state.selectedUnit) || null : null;
}

function totalUnits() {
  return state.library.subjects.reduce((count, subject) => count + subject.units.length, 0);
}

function totalReadyUnits() {
  return state.library.subjects.reduce(
    (count, subject) => count + subject.units.filter((unit) => unit.audio_path).length,
    0,
  );
}

function syncSelection() {
  const subject = selectedSubject();
  const wasNull = !state.selectedSubject;

  if (!subject) {
    const first = state.library.subjects[0] || null;
    state.selectedSubject = first ? first.name : null;
    state.selectedUnit = first && first.units[0] ? first.units[0].name : null;
  } else if (!subject.units.some((unit) => unit.name === state.selectedUnit)) {
    state.selectedUnit = subject.units[0] ? subject.units[0].name : null;
  }

  if (wasNull && state.selectedSubject) {
    state.expanded.add(state.selectedSubject);
  }
}

function recommendedTab() {
  const unit = selectedUnit();
  if (!state.selectedSubject || !unit) {
    return "explore";
  }
  return unit.audio_path ? "player" : "compose";
}

function setActiveTab(tab) {
  state.activeTab = tab;
  for (const [name, panel] of Object.entries(el.panels)) {
    panel.classList.toggle("active", name === tab);
  }
  el.tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
}

function setLoading(value) {
  state.loading = value;
  el.overlay.classList.toggle("show", value);
  el.overlay.setAttribute("aria-hidden", value ? "false" : "true");
  el.generateSpinner.hidden = !value;
  el.generate.disabled = value || !state.selectedSubject || !state.selectedUnit;
  el.addSubject.disabled = value;
  el.addUnitHero.disabled = value || !state.selectedSubject;
  el.deleteUnitHero.disabled = value || !state.selectedUnit;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    throw new Error((data && data.detail) || "요청 처리에 실패했습니다.");
  }
  return data;
}

function updateSidebarMode() {
  state.mobile = window.matchMedia("(max-width: 860px)").matches;
  if (state.mobile) {
    document.body.classList.add("mobile-sidebar-closed");
    document.body.classList.remove("sidebar-collapsed");
  } else {
    document.body.classList.remove("mobile-sidebar-closed");
  }
}

function renderContext() {
  const subject = selectedSubject();
  const unit = selectedUnit();
  const status = !subject || !unit ? "대기" : unit.audio_path ? "재생" : "작성";

  el.subjectChip.innerHTML = `<strong>${escapeHtml(subject ? subject.name : "과목 없음")}</strong>`;
  el.unitChip.innerHTML = `<strong>${escapeHtml(unit ? unit.name : "단원 없음")}</strong>`;
  el.statusChip.innerHTML = `<strong>${status}</strong>`;
}

function renderExplore() {
  const subject = selectedSubject();
  const unit = selectedUnit();

  if (!subject) {
    el.focusTitle.textContent = "Library";
    el.focusBody.innerHTML = `
          <div class="empty-state">
            <div>
              <div class="empty-icon">${ICONS.library}</div>
              <strong>과목부터 추가</strong>
              <div>좌측 상단 + 버튼으로 시작</div>
              <div class="focus-actions" style="justify-content:center; margin-top:16px;">
                <button class="primary-btn" type="button" data-quick-action="add-subject" title="과목 추가">${ICONS.plus}</button>
              </div>
            </div>
          </div>
        `;
  } else if (!unit) {
    el.focusTitle.textContent = subject.name;
    el.focusBody.innerHTML = `
          <div class="focus-stack">
            <div class="focus-stat">
              <span>현재 과목</span>
              <strong>${escapeHtml(subject.name)}</strong>
            </div>
            <div class="focus-stat">
              <span>단원 수</span>
              <strong>${subject.units.length}</strong>
            </div>
            <div class="focus-actions">
              <button class="primary-btn" type="button" data-quick-action="add-unit" title="단원 추가">${ICONS.filePlus}</button>
            </div>
          </div>
        `;
  } else {
    el.focusTitle.textContent = unit.name;
    el.focusBody.innerHTML = `
          <div class="focus-stack">
            <div class="focus-stat">
              <span>과목</span>
              <strong>${escapeHtml(subject.name)}</strong>
            </div>
            <div class="focus-stat">
              <span>상태</span>
              <strong>${unit.audio_path ? "재생 가능" : "작성 필요"}</strong>
            </div>
            <div class="focus-stat">
              <span>목소리</span>
              <strong>${escapeHtml(unit.voice || "alloy")}</strong>
            </div>
            <div class="focus-actions">
              <button class="soft-btn" type="button" data-quick-tab="compose" title="작성">${ICONS.compose}</button>
              <button class="soft-btn" type="button" data-quick-tab="player" ${unit.audio_path ? "" : "disabled"} title="재생">${ICONS.play}</button>
            </div>
          </div>
        `;
  }

  const dynamicLabel = unit ? "마지막 저장" : "현재 선택";
  const dynamicValue = unit ? formatDate(unit.created_at) : subject ? subject.name : "없음";
  el.exploreMeta.innerHTML = `
        <div class="mini-stat"><span>과목</span><strong>${state.library.subjects.length}</strong></div>
        <div class="mini-stat"><span>단원</span><strong>${totalUnits()}</strong></div>
        <div class="mini-stat"><span>오디오</span><strong>${totalReadyUnits()}</strong></div>
        <div class="mini-stat"><span>${dynamicLabel}</span><strong>${escapeHtml(dynamicValue)}</strong></div>
      `;
}

function renderComposeHint() {
  const subject = selectedSubject();
  const unit = selectedUnit();
  if (unit && unit.voice) {
    el.voice.value = unit.voice;
  } else if (state.defaultVoice) {
    el.voice.value = state.defaultVoice;
  }
  el.composeHint.innerHTML = subject && unit
    ? `${ICONS.filePlus}<span>${escapeHtml(subject.name)} / ${escapeHtml(unit.name)}</span>`
    : `${ICONS.compose}<span>선택 필요</span>`;

}

function renderDetail() {
  const subject = selectedSubject();
  const unit = selectedUnit();

  if (!subject || !unit) {
    el.detail.innerHTML = `
          <div class="empty-state">
            <div>
              <div class="empty-icon">${ICONS.play}</div>
              <strong>단원 선택</strong>
              <div>사이드바에서 고르면 여기서 바로 재생</div>
            </div>
          </div>
        `;
    return;
  }

  if (!unit.audio_path) {
    el.detail.innerHTML = `
          <div class="audio-shell">
            <div class="audio-card">
              <strong>${escapeHtml(unit.name)}</strong>
              <p>저장된 오디오가 없습니다.</p>
            </div>
            <div class="focus-actions">
              <button class="primary-btn" type="button" data-quick-tab="compose" title="작성 열기">${ICONS.compose}</button>
            </div>
          </div>
        `;
    return;
  }

  const version = encodeURIComponent(unit.created_at || Date.now());
  el.detail.innerHTML = `
        <div class="audio-shell">
          <div class="audio-card">
            <strong>${escapeHtml(unit.name)}</strong>
            <p>${escapeHtml(subject.name)}</p>
            <audio controls preload="metadata" src="${escapeHtml(`${unit.audio_path}?v=${version}`)}"></audio>
            ${unit.text ? `
            <div style="margin-top: 20px;">
              <button class="primary-btn" type="button" data-quick-action="open-floating-player">
                ${ICONS.play} 대본과 함께 보기
              </button>
            </div>
            ` : ""}
          </div>
          <details class="meta-disclosure">
            <summary>정보 보기</summary>
            <div class="meta-stack">
              <div class="info-row"><span>목소리</span><strong>${escapeHtml(unit.voice || "alloy")}</strong></div>
              <div class="info-row"><span>생성</span><strong>${escapeHtml(formatDate(unit.created_at))}</strong></div>
              <div class="info-row"><span>경로</span><strong>${escapeHtml(unit.audio_path)}</strong></div>
            </div>
          </details>
        </div>
      `;
}

function renderSidebar() {
  if (!state.library.subjects.length) {
    el.subjectList.innerHTML = `<div class="sidebar-empty">과목 없음<br>+</div>`;
    return;
  }

  el.subjectList.innerHTML = state.library.subjects.map((subject, subjectIndex) => {
    const open = state.expanded.has(subject.name);
    const activeSubject = subject.name === state.selectedSubject;
    const units = subject.units.length
      ? subject.units.map((unit, unitIndex) => {
        const activeUnit = activeSubject && unit.name === state.selectedUnit;
        return `
                <div class="unit-row">
                  <button class="unit-main ${activeUnit ? "active" : ""}" type="button" data-action="select-unit" data-subject="${subjectIndex}" data-unit="${unitIndex}">
                    <span class="unit-copy">
                      <span class="unit-name">${escapeHtml(unit.name)}</span>
                    </span>
                    <span class="unit-status ${unit.audio_path ? "ready" : ""}"></span>
                  </button>
                  <div class="dropdown">
                    <button class="mini-btn" type="button" title="메뉴" onclick="window.toggleDropdown(event, this)">
                      ${ICONS.more}
                    </button>
                    <div class="dropdown-menu">
                      <button class="dropdown-item danger" type="button" data-action="delete-unit" data-subject="${subjectIndex}" data-unit="${unitIndex}">
                        ${ICONS.trash} 단원 삭제
                      </button>
                    </div>
                  </div>
                </div>
              `;
      }).join("")
      : `<div class="sidebar-empty" style="padding:12px;">단원 없음</div>`;

    return `
          <section class="subject-card ${open ? "open" : ""} ${activeSubject ? "active" : ""}">
            <div class="subject-row">
              <button class="subject-main" type="button" data-action="toggle-subject" data-subject="${subjectIndex}">
                <span class="chevron">${ICONS.chevron}</span>
                <span class="subject-dot"></span>
                <span class="subject-copy">
                  <span class="subject-name">${escapeHtml(subject.name)}</span>
                  <span class="subject-count">${subject.units.length}</span>
                </span>
              </button>
              <div class="dropdown">
                <button class="mini-btn" type="button" title="메뉴" onclick="window.toggleDropdown(event, this)">
                  ${ICONS.more}
                </button>
                <div class="dropdown-menu">
                  <button class="dropdown-item" type="button" data-action="add-unit" data-subject="${subjectIndex}">
                    ${ICONS.plus} 단원 추가
                  </button>
                  <button class="dropdown-item danger" type="button" data-action="delete-subject" data-subject="${subjectIndex}">
                    ${ICONS.trash} 과목 삭제
                  </button>
                </div>
              </div>
            </div>
            <div class="unit-list">${units}</div>
          </section>
        `;
  }).join("");
}

function render() {
  syncSelection();
  renderContext();
  renderSidebar();
  renderExplore();
  renderComposeHint();
  renderDetail();
  setActiveTab(state.activeTab);
  setLoading(state.loading);
}

function refreshTextMeta(forceClean = false) {
  const before = el.input.value;
  const after = sanitizeMarkdown(before);
  if (forceClean || before !== after) {
    el.input.value = after;
  }
  const len = after.length;
  el.charCount.textContent = len > 4096
    ? `${len}자 (청크 ${estimateChunks(after)}개 예상)`
    : `${len} / 4096`;
  el.cleanState.textContent = before !== after ? "정리 완료" : "정리됨";
}

function estimateChunks(text, max = 4096) {
  if (text.length <= max) return 1;
  return Math.ceil(text.length / max) + 1; // rough estimate
}

function playCurrentAudio() {
  const audio = el.detail.querySelector("audio");
  if (audio) {
    audio.load();
    audio.play().catch(() => { });
  }
}

function showPrompt(title, placeholder = "") {
  return new Promise((resolve) => {
    el.promptTitle.textContent = title;
    el.promptInput.placeholder = placeholder;
    el.promptInput.value = "";
    el.promptModal.classList.add("show");
    el.promptModal.setAttribute("aria-hidden", "false");
    el.promptInput.focus();

    const cleanup = () => {
      el.submitPrompt.removeEventListener("click", onSubmit);
      el.closePrompt.removeEventListener("click", onCancel);
      el.promptInput.removeEventListener("keydown", onKeydown);
      el.promptModal.classList.remove("show");
      el.promptModal.setAttribute("aria-hidden", "true");
    };

    const onSubmit = () => {
      cleanup();
      resolve(el.promptInput.value.trim());
    };

    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    const onKeydown = (e) => {
      if (e.key === "Enter") onSubmit();
      if (e.key === "Escape") onCancel();
    };

    el.submitPrompt.addEventListener("click", onSubmit);
    el.closePrompt.addEventListener("click", onCancel);
    el.promptInput.addEventListener("keydown", onKeydown);
  });
}

async function addSubject() {
  const name = await showPrompt("새 과목 이름", "예: 웹 개발 기초");
  if (!name) {
    return;
  }

  try {
    setLoading(true);
    const data = await api("/api/subjects", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    state.library = data.library;
    state.selectedSubject = name.trim().replace(/\s+/g, " ");
    state.selectedUnit = null;
    state.expanded.add(state.selectedSubject);
    setActiveTab("explore");
    render();
    toast("과목 추가");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setLoading(false);
  }
}

async function addUnit(subjectName) {
  if (!subjectName) {
    toast("과목 선택 필요", "error");
    return;
  }

  const name = await showPrompt(`"${subjectName}" 단원 이름`, "단원명을 입력하세요");
  if (!name) {
    return;
  }

  try {
    setLoading(true);
    const data = await api("/api/units", {
      method: "POST",
      body: JSON.stringify({ subject: subjectName, name }),
    });
    state.library = data.library;
    state.selectedSubject = subjectName;
    state.selectedUnit = name.trim().replace(/\s+/g, " ");
    state.expanded.add(subjectName);
    setActiveTab("compose");
    render();
    toast("단원 추가");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setLoading(false);
  }
}

async function deleteSubject(subjectName) {
  if (!subjectName || !window.confirm(`"${subjectName}" 과목을 삭제하시겠습니까? 관련 파일이 모두 삭제됩니다.`)) {
    return;
  }

  try {
    setLoading(true);
    const data = await api(`/api/subjects?name=${encodeURIComponent(subjectName)}`, {
      method: "DELETE",
    });
    state.library = data.library;
    if (state.selectedSubject === subjectName) {
      state.selectedSubject = null;
      state.selectedUnit = null;
    }
    state.expanded.delete(subjectName);
    setActiveTab("explore");
    render();
    toast("과목 삭제");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setLoading(false);
  }
}

async function deleteUnit(subjectName, unitName) {
  if (!subjectName || !unitName || !window.confirm(`"${unitName}" 단원을 삭제하시겠습니까?`)) {
    return;
  }

  try {
    setLoading(true);
    const data = await api(
      `/api/units?subject=${encodeURIComponent(subjectName)}&name=${encodeURIComponent(unitName)}`,
      { method: "DELETE" },
    );
    state.library = data.library;
    if (state.selectedSubject === subjectName && state.selectedUnit === unitName) {
      state.selectedUnit = null;
    }
    setActiveTab("explore");
    render();
    toast("단원 삭제");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setLoading(false);
  }
}

async function generate() {
  if (!state.selectedSubject || !state.selectedUnit) {
    toast("과목과 단원 선택 필요", "error");
    return;
  }

  refreshTextMeta(true);
  if (!el.input.value) {
    toast("텍스트 입력 필요", "error");
    return;
  }

  try {
    setLoading(true);
    const data = await api("/api/generate", {
      method: "POST",
      body: JSON.stringify({
        subject: state.selectedSubject,
        unit: state.selectedUnit,
        text: el.input.value,
        voice: el.voice.value,
      }),
    });
    state.library = data.library;
    el.input.value = data.cleaned_text;
    setActiveTab("player");
    render();
    refreshTextMeta(true);
    toast("오디오 저장");
    playCurrentAudio();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setLoading(false);
  }
}

el.subjectList.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) {
    return;
  }

  const action = target.dataset.action;
  const subject = state.library.subjects[Number(target.dataset.subject)];
  const unit = subject && target.dataset.unit !== undefined
    ? subject.units[Number(target.dataset.unit)]
    : null;

  if (action === "toggle-subject" && subject) {
    if (state.expanded.has(subject.name)) {
      state.expanded.delete(subject.name);
    } else {
      state.expanded.add(subject.name);
    }
    state.selectedSubject = subject.name;
    if (!state.selectedUnit && subject.units[0]) {
      state.selectedUnit = subject.units[0].name;
    }
    setActiveTab("explore");
    render();
    if (state.mobile) {
      document.body.classList.add("mobile-sidebar-closed");
    }
    return;
  }

  if (action === "select-unit" && subject && unit) {
    state.selectedSubject = subject.name;
    state.selectedUnit = unit.name;
    state.expanded.add(subject.name);
    setActiveTab(unit.audio_path ? "player" : "compose");
    render();
    if (state.mobile) {
      document.body.classList.add("mobile-sidebar-closed");
    }
    return;
  }

  if (action === "add-unit" && subject) {
    addUnit(subject.name);
    return;
  }

  if (action === "delete-subject" && subject) {
    deleteSubject(subject.name);
    return;
  }

  if (action === "delete-unit" && subject && unit) {
    deleteUnit(subject.name, unit.name);
  }
});

document.addEventListener("click", (event) => {
  const tabTarget = event.target.closest("[data-tab]");
  if (tabTarget) {
    setActiveTab(tabTarget.dataset.tab);
    return;
  }

  const quickTab = event.target.closest("[data-quick-tab]");
  if (quickTab) {
    if (quickTab.hasAttribute("disabled")) {
      return;
    }
    setActiveTab(quickTab.dataset.quickTab);
    return;
  }

  const quickAction = event.target.closest("[data-quick-action]");
  if (quickAction) {
    const action = quickAction.dataset.quickAction;
    if (action === "add-subject") {
      addSubject();
    } else if (action === "add-unit") {
      addUnit(state.selectedSubject);
    } else if (action === "open-floating-player") {
      openFloatingPlayer();
    }
  }
});

function parseMarkdownForView(text) {
  if (!text) return "";
  let html = escapeHtml(text);
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  html = html.replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Simple lists
  html = html.replace(/^\s*-\s+(.*)$/gim, '<li>$1</li>');
  // Wrap paragraphs
  html = html.replace(/^(?!<[a-z])(.*)\n/gim, '<p>$1</p>');
  return html;
}

function openFloatingPlayer() {
  const subject = selectedSubject();
  const unit = selectedUnit();
  if (!subject || !unit || !unit.audio_path) return;

  const version = encodeURIComponent(unit.created_at || Date.now());
  el.fpSubject.textContent = subject.name;
  el.fpUnit.textContent = unit.name;
  el.fpBody.innerHTML = parseMarkdownForView(unit.text);
  el.fpAudio.src = `${unit.audio_path}?v=${version}`;

  el.floatingPlayer.classList.add("show");

  // Stop the inline audio if playing
  const inlineAudio = el.detail.querySelector("audio");
  if (inlineAudio) {
    inlineAudio.pause();
  }

  // Auto play the floating audio softly
  el.fpAudio.play().catch(() => { });
}

el.closeFloatingPlayer.addEventListener("click", () => {
  el.floatingPlayer.classList.remove("show");
  el.fpAudio.pause();
});

el.input.addEventListener("paste", (event) => {
  event.preventDefault();
  const pasted = (event.clipboardData || window.clipboardData).getData("text");
  const cleaned = sanitizeMarkdown(pasted);
  const start = el.input.selectionStart;
  const end = el.input.selectionEnd;
  el.input.value = `${el.input.value.slice(0, start)}${cleaned}${el.input.value.slice(end)}`;
  el.input.setSelectionRange(start + cleaned.length, start + cleaned.length);
  refreshTextMeta();
});

el.input.addEventListener("input", () => refreshTextMeta());
el.input.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key === "Enter") {
    e.preventDefault();
    generate();
  }
});
el.generate.addEventListener("click", generate);
el.addSubject.addEventListener("click", addSubject);
el.addUnitHero.addEventListener("click", () => addUnit(state.selectedSubject));
el.deleteUnitHero.addEventListener("click", () => deleteUnit(state.selectedSubject, state.selectedUnit));
el.toggleSidebar.addEventListener("click", () => {
  if (state.mobile) {
    document.body.classList.toggle("mobile-sidebar-closed");
  } else {
    document.body.classList.toggle("sidebar-collapsed");
  }
});
el.openSidebar.addEventListener("click", () => {
  document.body.classList.remove("mobile-sidebar-closed");
  document.body.classList.remove("sidebar-collapsed");
});

el.openSettings.addEventListener("click", async () => {
  try {
    setLoading(true);
    const settings = await api("/api/settings");
    el.settingApiKey.value = settings.api_key || "";
    el.settingAudioDir.value = settings.audio_dir || "";
    el.settingDefaultVoice.value = settings.default_voice || "";
    el.settingsModal.classList.add("show");
    el.settingsModal.setAttribute("aria-hidden", "false");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setLoading(false);
  }
});

el.closeSettings.addEventListener("click", () => {
  el.settingsModal.classList.remove("show");
  el.settingsModal.setAttribute("aria-hidden", "true");
});

el.saveSettingsBtn.addEventListener("click", async () => {
  try {
    setLoading(true);
    const saved = await api("/api/settings", {
      method: "POST",
      body: JSON.stringify({
        api_key: el.settingApiKey.value,
        audio_dir: el.settingAudioDir.value,
        default_voice: el.settingDefaultVoice.value,
      }),
    });
    state.defaultVoice = saved.default_voice || "";
    if (state.defaultVoice) {
      el.voice.value = state.defaultVoice;
    }
    el.settingsModal.classList.remove("show");
    el.settingsModal.setAttribute("aria-hidden", "true");
    toast("설정이 저장되었습니다.");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setLoading(false);
  }
});

window.addEventListener("resize", () => {
  updateSidebarMode();
  render();
});

async function init() {
  updateSidebarMode();
  refreshTextMeta();
  setLoading(false);
  try {
    const [data, settings] = await Promise.all([
      api("/api/library"),
      api("/api/settings"),
    ]);
    state.library = data.library;
    state.defaultVoice = settings.default_voice || "";
    if (state.defaultVoice) {
      el.voice.value = state.defaultVoice;
    }
    setActiveTab(recommendedTab());
    render();
  } catch (error) {
    toast(error.message, "error");
  }
}

window.toggleDropdown = function (event, btn) {
  event.stopPropagation();
  const menu = btn.nextElementSibling;
  const isOpen = menu.classList.contains("open");

  window.closeAllDropdowns();

  if (!isOpen) {
    const rect = btn.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${rect.right - 140}px`; // Aligns right edge based on 140px min-width
    menu.classList.add("open");
  }
};

window.closeAllDropdowns = function () {
  document.querySelectorAll(".dropdown-menu.open").forEach(el => el.classList.remove("open"));
};

window.addEventListener("click", window.closeAllDropdowns);
window.addEventListener("resize", window.closeAllDropdowns);
el.subjectList.addEventListener("scroll", window.closeAllDropdowns, { passive: true });

// ── Keyboard Shortcuts ────────────────────────────────────────────────────────

function getActiveAudio() {
  // Floating player takes priority if visible
  if (el.floatingPlayer.classList.contains("show")) {
    return el.fpAudio;
  }
  // Otherwise try inline player
  return el.detail.querySelector("audio") || null;
}

function showSeekBubble(seconds) {
  const sign = seconds > 0 ? "+" : "";
  showKbdToast(`${sign}${seconds}초`);
}

function showVolumeBubble(volume) {
  showKbdToast(`볼륨 ${Math.round(volume * 100)}%`);
}

let kbdToastTimer = null;
function showKbdToast(text) {
  let bubble = document.getElementById("kbdToast");
  if (!bubble) {
    bubble = document.createElement("div");
    bubble.id = "kbdToast";
    bubble.className = "kbd-toast";
    document.body.appendChild(bubble);
  }
  bubble.textContent = text;
  bubble.classList.add("show");
  clearTimeout(kbdToastTimer);
  kbdToastTimer = setTimeout(() => bubble.classList.remove("show"), 900);
}

function toggleCheatsheet() {
  let sheet = document.getElementById("kbdCheatsheet");
  if (!sheet) {
    sheet = document.createElement("div");
    sheet.id = "kbdCheatsheet";
    sheet.className = "kbd-cheatsheet";
    sheet.innerHTML = `
      <div class="kbd-cheatsheet-inner">
        <div class="kbd-cheatsheet-title">키보드 단축키 <span class="kbd-cheatsheet-close" id="kbdCheatsheetClose">✕</span></div>
        <table class="kbd-table">
          <tr><td><kbd>Space</kbd></td><td>재생 / 정지</td></tr>
          <tr><td><kbd>←</kbd></td><td>10초 뒤로</td></tr>
          <tr><td><kbd>→</kbd></td><td>10초 앞으로</td></tr>
          <tr><td><kbd>↑</kbd></td><td>볼륨 +10%</td></tr>
          <tr><td><kbd>↓</kbd></td><td>볼륨 −10%</td></tr>
          <tr><td><kbd>M</kbd></td><td>음소거 토글</td></tr>
          <tr><td><kbd>?</kbd></td><td>단축키 도움말</td></tr>
        </table>
      </div>`;
    document.body.appendChild(sheet);
    document.getElementById("kbdCheatsheetClose").addEventListener("click", () => {
      sheet.classList.remove("show");
    });
  }
  sheet.classList.toggle("show");
}

document.addEventListener("keydown", (e) => {
  // Don't intercept when typing in inputs / modals are open
  const tag = document.activeElement.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if (document.querySelector(".overlay.show")) return;

  const audio = getActiveAudio();

  switch (e.key) {
    case " ":
    case "Spacebar": {
      if (!audio) return;
      e.preventDefault();
      if (audio.paused) {
        audio.play().catch(() => {});
        showKbdToast("▶ 재생");
      } else {
        audio.pause();
        showKbdToast("⏸ 정지");
      }
      break;
    }
    case "ArrowLeft": {
      if (!audio) return;
      e.preventDefault();
      audio.currentTime = Math.max(0, audio.currentTime - 10);
      showSeekBubble(-10);
      break;
    }
    case "ArrowRight": {
      if (!audio) return;
      e.preventDefault();
      audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10);
      showSeekBubble(+10);
      break;
    }
    case "ArrowUp": {
      if (!audio) return;
      e.preventDefault();
      audio.volume = Math.min(1, +(audio.volume + 0.1).toFixed(1));
      showVolumeBubble(audio.volume);
      break;
    }
    case "ArrowDown": {
      if (!audio) return;
      e.preventDefault();
      audio.volume = Math.max(0, +(audio.volume - 0.1).toFixed(1));
      showVolumeBubble(audio.volume);
      break;
    }
    case "m":
    case "M": {
      if (!audio) return;
      audio.muted = !audio.muted;
      showKbdToast(audio.muted ? "🔇 음소거" : "🔊 음소거 해제");
      break;
    }
    case "?": {
      toggleCheatsheet();
      break;
    }
  }
});

init();