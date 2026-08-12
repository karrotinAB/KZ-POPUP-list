/* ==========================================================
   카자흐스탄 팝업 매대 배정 도구
   - products.json: 정적 제품 데이터 (검색/필터용)
   - Supabase table `shelf_assignments`: 실시간 공유되는 매대 배정 데이터
   ========================================================== */

const SHELF_COUNT = 6;
const PAGE_SIZE = 60;
const SHELF_NAMES = {
  1: "지제",
  2: "문구",
  3: "완구",
  4: "생활잡화",
  5: "뷰티잡화",
  6: "패션잡화",
};

const state = {
  products: [],           // 전체 제품 (정적)
  assignments: {},        // { [product_code]: { shelf, updated_by, updated_at } }
  filtered: [],           // 현재 필터 적용된 결과
  visibleCount: PAGE_SIZE,
  filters: { q: "", cat1: "", cat2: "", cat3: "", cat4: "", shelf: "" },
  me: localStorage.getItem("kaz_pog_me") || "",
  selected: new Set(),    // 일괄 배정을 위해 체크된 제품코드
};

let sb = null;
let channel = null;
let isOnline = false;

const el = (id) => document.getElementById(id);

/* ---------------- init ---------------- */

async function init() {
  el("meInput").value = state.me;
  el("meInput").addEventListener("input", (e) => {
    state.me = e.target.value.trim();
    localStorage.setItem("kaz_pog_me", state.me);
  });

  await loadProducts();
  buildCategoryOptions();
  bindFilterEvents();
  bindBulkEvents();
  renderShelfSummary();
  applyFilters();

  initSupabase();
}

async function loadProducts() {
  const res = await fetch("data/products.json");
  state.products = await res.json();
}

/* ---------------- supabase ---------------- */

function initSupabase() {
  if (!window.supabase || !SUPABASE_URL || SUPABASE_URL.includes("YOUR-PROJECT-ID")) {
    setConn(false, "Supabase 미설정 (config.js 확인)");
    return;
  }

  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      fetch: (url, options = {}) => fetch(url, { ...options, cache: "no-store" }),
    },
  });
  setConn(false, "연결 중…");

  fetchAllAssignments().then(() => {
    setConn(true, "실시간 연결됨");
    renderShelfSummary();
    applyFilters();
  }).catch((err) => {
    console.error(err);
    setConn(false, "연결 실패");
  });

  channel = sb
    .channel("shelf_assignments_changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "shelf_assignments" },
      handleRealtimeChange
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setConn(true, "실시간 연결됨");
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setConn(false, "연결 끊김");
    });
}

async function fetchAllAssignments() {
  state.assignments = {};
  const pageSize = 500; // Supabase 기본 응답 제한(보통 1,000개)보다 넉넉히 낮게 잡아서 안전하게 나눠 받음
  let from = 0;

  while (true) {
    const { data, error } = await sb.from("shelf_assignments").select("*").range(from, from + pageSize - 1);
    if (error) throw error;
    for (const row of data) {
      state.assignments[row.product_code] = row;
    }
    if (data.length < pageSize) break; // 더 가져올 게 없으면 종료
    from += pageSize;
  }
}

function handleRealtimeChange(payload) {
  const { eventType, new: newRow, old: oldRow } = payload;

  if (eventType === "DELETE") {
    delete state.assignments[oldRow.product_code];
    pushActivity({ ...oldRow, shelf: null, _removed: true });
  } else {
    state.assignments[newRow.product_code] = newRow;
    pushActivity(newRow);
  }

  renderShelfSummary();
  renderVisibleRow(eventType === "DELETE" ? oldRow.product_code : newRow.product_code);
}

function setConn(online, label) {
  isOnline = online;
  el("connDot").className = "conn-dot " + (online ? "online" : "offline");
  el("connLabel").textContent = label;
  el("connBanner").hidden = online;
}

/* ---------------- category filter options ---------------- */

function buildCategoryOptions() {
  fillSelect("cat1Select", uniqueSorted(state.products.map((p) => p.cat1)));
  updateCat2Options();
}

function updateCat2Options() {
  const pool = state.filters.cat1
    ? state.products.filter((p) => p.cat1 === state.filters.cat1)
    : state.products;
  fillSelect("cat2Select", uniqueSorted(pool.map((p) => p.cat2)), state.filters.cat2);
  updateCat3Options();
}

function updateCat3Options() {
  let pool = state.products;
  if (state.filters.cat1) pool = pool.filter((p) => p.cat1 === state.filters.cat1);
  if (state.filters.cat2) pool = pool.filter((p) => p.cat2 === state.filters.cat2);
  fillSelect("cat3Select", uniqueSorted(pool.map((p) => p.cat3)), state.filters.cat3);
  updateCat4Options();
}

function updateCat4Options() {
  let pool = state.products;
  if (state.filters.cat1) pool = pool.filter((p) => p.cat1 === state.filters.cat1);
  if (state.filters.cat2) pool = pool.filter((p) => p.cat2 === state.filters.cat2);
  if (state.filters.cat3) pool = pool.filter((p) => p.cat3 === state.filters.cat3);
  fillSelect("cat4Select", uniqueSorted(pool.map((p) => p.cat4)), state.filters.cat4);
}

function uniqueSorted(arr) {
  return [...new Set(arr.filter((v) => v !== "" && v != null))].sort((a, b) =>
    String(a).localeCompare(String(b), "ko")
  );
}

function fillSelect(id, values, keepValue) {
  const select = el(id);
  const current = keepValue !== undefined ? keepValue : select.value;
  const placeholder = select.options[0];
  select.innerHTML = "";
  select.appendChild(placeholder);
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  }
  if (values.includes(current)) select.value = current;
}

/* ---------------- filter events ---------------- */

function bindFilterEvents() {
  let debounceTimer;
  el("searchInput").addEventListener("input", (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      state.filters.q = e.target.value.trim().toLowerCase();
      state.visibleCount = PAGE_SIZE;
      applyFilters();
    }, 150);
  });

  el("cat1Select").addEventListener("change", (e) => {
    state.filters.cat1 = e.target.value;
    state.filters.cat2 = state.filters.cat3 = state.filters.cat4 = "";
    updateCat2Options();
    state.visibleCount = PAGE_SIZE;
    applyFilters();
  });
  el("cat2Select").addEventListener("change", (e) => {
    state.filters.cat2 = e.target.value;
    state.filters.cat3 = state.filters.cat4 = "";
    updateCat3Options();
    state.visibleCount = PAGE_SIZE;
    applyFilters();
  });
  el("cat3Select").addEventListener("change", (e) => {
    state.filters.cat3 = e.target.value;
    state.filters.cat4 = "";
    updateCat4Options();
    state.visibleCount = PAGE_SIZE;
    applyFilters();
  });
  el("cat4Select").addEventListener("change", (e) => {
    state.filters.cat4 = e.target.value;
    state.visibleCount = PAGE_SIZE;
    applyFilters();
  });
  el("shelfFilterSelect").addEventListener("change", (e) => {
    state.filters.shelf = e.target.value;
    state.visibleCount = PAGE_SIZE;
    applyFilters();
  });

  el("resetFilters").addEventListener("click", () => {
    state.filters = { q: "", cat1: "", cat2: "", cat3: "", cat4: "", shelf: "" };
    el("searchInput").value = "";
    el("shelfFilterSelect").value = "";
    buildCategoryOptions();
    state.visibleCount = PAGE_SIZE;
    applyFilters();
  });

  el("exportExcelBtn").addEventListener("click", exportToExcel);

  el("loadMoreBtn").addEventListener("click", () => {
    state.visibleCount += PAGE_SIZE;
    renderProductList();
  });
}

/* ---------------- excel export ---------------- */

function exportToExcel() {
  if (typeof XLSX === "undefined") {
    showToast("엑셀 내보내기 기능을 불러오지 못했어요. 인터넷 연결을 확인해주세요.", true);
    return;
  }

  const headers = ["제품코드", "제품명", "제품명(영문)", "대분류", "중분류", "소분류", "세부분류", "출고수량", "바코드"];
  const colWidths = [{ wch: 12 }, { wch: 32 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 16 }];

  function rowsForShelf(shelfNum) {
    return state.products
      .filter((p) => (state.assignments[p.code]?.shelf || 0) === shelfNum)
      .sort((a, b) => {
        const ka = [a.cat1, a.cat2, a.cat3, a.cat4].join("");
        const kb = [b.cat1, b.cat2, b.cat3, b.cat4].join("");
        return ka.localeCompare(kb, "ko") || a.code.localeCompare(b.code);
      })
      .map((p) => [p.code, p.name, p.nameEn, p.cat1, p.cat2, p.cat3, p.cat4, p.qty, p.barcode]);
  }

  const wb = XLSX.utils.book_new();

  for (let n = 1; n <= SHELF_COUNT; n++) {
    const aoa = [headers, ...rowsForShelf(n)];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = colWidths;
    XLSX.utils.book_append_sheet(wb, ws, `${n}_${SHELF_NAMES[n]}`);
  }

  const unassignedAoa = [headers, ...rowsForShelf(0)];
  const wsUnassigned = XLSX.utils.aoa_to_sheet(unassignedAoa);
  wsUnassigned["!cols"] = colWidths;
  XLSX.utils.book_append_sheet(wb, wsUnassigned, "미배정");

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  XLSX.writeFile(wb, `매대배정_${dateStr}.xlsx`);
}

/* ---------------- filtering & rendering ---------------- */

function applyFilters() {
  const { q, cat1, cat2, cat3, cat4, shelf } = state.filters;

  state.filtered = state.products.filter((p) => {
    if (cat1 && p.cat1 !== cat1) return false;
    if (cat2 && p.cat2 !== cat2) return false;
    if (cat3 && p.cat3 !== cat3) return false;
    if (cat4 && p.cat4 !== cat4) return false;

    if (shelf) {
      const assigned = state.assignments[p.code]?.shelf || 0;
      if (shelf === "0" && assigned) return false;
      if (shelf !== "0" && assigned !== Number(shelf)) return false;
    }

    if (q) {
      const hay = (p.code + " " + p.name + " " + p.nameEn + " " + p.barcode + " " + p.cat1 + " " + p.cat2 + " " + p.cat3 + " " + p.cat4).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  el("resultCount").textContent = `${state.filtered.length.toLocaleString("ko")}개 제품`;
  renderProductList();
}

function renderProductList() {
  const container = el("productList");
  const slice = state.filtered.slice(0, state.visibleCount);
  container.innerHTML = slice.map(rowHtml).join("");

  const hasMore = state.filtered.length > state.visibleCount;
  el("loadMoreBtn").disabled = !hasMore;
  el("loadMoreBtn").textContent = hasMore
    ? `더 보기 (${(state.filtered.length - state.visibleCount).toLocaleString("ko")}개 남음)`
    : "모두 표시됨";

  renderBulkBar();
}

function renderVisibleRow(code) {
  const rowEl = document.querySelector(`.product-row[data-code="${cssEscape(code)}"]`);
  if (!rowEl) return;
  const product = state.products.find((p) => p.code === code);
  if (!product) return;
  rowEl.outerHTML = rowHtml(product);
}

function cssEscape(str) {
  return String(str).replace(/["\\]/g, "\\$&");
}

function rowHtml(p) {
  const a = state.assignments[p.code];
  const shelf = a?.shelf || 0;
  const assignedClass = shelf ? `assigned-${shelf}` : "";
  const selected = state.selected.has(p.code);
  const selectedClass = selected ? "row-selected" : "";

  const shelfButtons = Array.from({ length: SHELF_COUNT }, (_, i) => {
    const n = i + 1;
    const active = shelf === n ? "active" : "";
    const nameLabel = SHELF_NAMES[n];
    return `<button class="shelf-btn s${n} ${active}" data-code="${escAttr(p.code)}" data-shelf="${n}" title="${n}번 · ${nameLabel}${active ? " (배정됨 · 클릭시 해제)" : ""}">${n}</button>`;
  }).join("");

  return `
    <div class="product-row ${assignedClass} ${selectedClass}" data-code="${escAttr(p.code)}">
      <span class="col-check"><input type="checkbox" class="row-check" data-code="${escAttr(p.code)}" ${selected ? "checked" : ""}></span>
      <span class="col-code">${esc(p.code)}</span>
      <span class="col-name">
        <span class="pname">${esc(p.name)}</span>
        <span class="pname-en">${esc(p.nameEn)}</span>
      </span>
      <span class="col-cat">
        <b>${esc(p.cat1)}</b> · ${esc(p.cat2)}<br>${esc(p.cat3)} ${p.cat4 ? "· " + esc(p.cat4) : ""}
      </span>
      <span class="col-qty">${p.qty.toLocaleString("ko")}</span>
      <span class="col-shelf">${shelfButtons}</span>
    </div>
  `;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
function escAttr(s) {
  return esc(s).replace(/"/g, "&quot;");
}

document.addEventListener("click", (e) => {
  const bulkBtn = e.target.closest("[data-bulk-shelf]");
  if (bulkBtn) {
    bulkAssign(Number(bulkBtn.dataset.bulkShelf));
    return;
  }
  const btn = e.target.closest(".shelf-btn");
  if (!btn) return;
  const code = btn.dataset.code;
  const shelf = Number(btn.dataset.shelf);
  toggleAssignment(code, shelf);
});

document.addEventListener("change", (e) => {
  const cb = e.target.closest(".row-check");
  if (!cb) return;
  const code = cb.dataset.code;
  if (cb.checked) state.selected.add(code);
  else state.selected.delete(code);

  const row = document.querySelector(`.product-row[data-code="${cssEscape(code)}"]`);
  if (row) row.classList.toggle("row-selected", cb.checked);
  renderBulkBar();
});

/* ---------------- bulk selection & bulk assign ---------------- */

function bindBulkEvents() {
  buildBulkShelfButtons();

  el("selectAllCheckbox").addEventListener("change", (e) => {
    if (e.target.checked) {
      state.filtered.forEach((p) => state.selected.add(p.code));
    } else {
      state.selected.clear();
    }
    renderProductList();
  });

  el("bulkClearAssignBtn").addEventListener("click", () => bulkAssign(0));

  el("bulkDeselectBtn").addEventListener("click", () => {
    state.selected.clear();
    renderProductList();
  });
}

function buildBulkShelfButtons() {
  el("bulkShelfBtns").innerHTML = Array.from(
    { length: SHELF_COUNT },
    (_, i) => `<button class="shelf-btn s${i + 1}" data-bulk-shelf="${i + 1}" title="선택한 제품을 ${i + 1}번 · ${SHELF_NAMES[i + 1]}로 배정">${i + 1}</button>`
  ).join("");
}

function renderBulkBar() {
  const bar = el("bulkBar");
  const count = state.selected.size;
  el("bulkCount").textContent = `${count.toLocaleString("ko")}개 선택됨`;
  bar.hidden = count === 0;
  updateSelectAllCheckboxState();
}

function updateSelectAllCheckboxState() {
  const cb = el("selectAllCheckbox");
  if (!cb) return;
  const codes = state.filtered.map((p) => p.code);
  const allSelected = codes.length > 0 && codes.every((c) => state.selected.has(c));
  const someSelected = codes.some((c) => state.selected.has(c));
  cb.checked = allSelected;
  cb.indeterminate = !allSelected && someSelected;
}

async function bulkAssign(shelf) {
  if (!sb || !isOnline) {
    showToast("⚠️ 서버 연결이 끊겨있어 저장할 수 없어요. 상단이 초록불일 때 다시 시도해주세요.", true);
    return;
  }
  const codes = Array.from(state.selected);
  if (codes.length === 0) return;

  const isClear = shelf === 0;
  const nowIso = new Date().toISOString();
  const by = state.me || "익명";
  const previous = {};
  for (const code of codes) previous[code] = state.assignments[code]; // 실패 시 롤백용

  // optimistic update
  for (const code of codes) {
    if (isClear) delete state.assignments[code];
    else state.assignments[code] = { product_code: code, shelf, updated_by: by, updated_at: nowIso };
  }
  renderShelfSummary();
  renderProductList();

  try {
    if (isClear) {
      const { error } = await sb.from("shelf_assignments").delete().in("product_code", codes);
      if (error) throw error;
    } else {
      const rows = codes.map((code) => ({ product_code: code, shelf, updated_by: by, updated_at: nowIso }));
      const { error } = await sb.from("shelf_assignments").upsert(rows, { onConflict: "product_code" });
      if (error) throw error;
    }
    showToast(`${codes.length.toLocaleString("ko")}개 제품을 ${isClear ? "미배정으로 변경" : SHELF_NAMES[shelf] + "(" + shelf + "번)로 배정"}했어요.`);
  } catch (err) {
    console.error(err);
    // 저장 실패 시 전부 되돌림
    for (const code of codes) {
      if (previous[code]) state.assignments[code] = previous[code];
      else delete state.assignments[code];
    }
    showToast("❌ 일괄 저장에 실패해서 되돌렸어요. 연결 상태를 확인하고 다시 시도해주세요.", true);
  }

  state.selected.clear();
  renderProductList();
  renderShelfSummary();
}

/* ---------------- shelf summary strip ---------------- */

function renderShelfSummary() {
  const counts = Array(SHELF_COUNT + 1).fill(0); // index 0 = 미배정
  const qtys = Array(SHELF_COUNT + 1).fill(0);

  for (const p of state.products) {
    const shelf = state.assignments[p.code]?.shelf || 0;
    counts[shelf]++;
    qtys[shelf] += p.qty;
  }

  const chips = [];
  chips.push(chipHtml(0, "미배정", counts[0], qtys[0]));
  for (let n = 1; n <= SHELF_COUNT; n++) {
    chips.push(chipHtml(n, `${n}번 매대`, counts[n], qtys[n]));
  }
  el("shelfSummary").innerHTML = chips.join("");

  document.querySelectorAll(".shelf-chip").forEach((chip) => {
    chip.addEventListener("click", (e) => {
      if (e.target.closest(".chip-copy-btn")) return; // 복사 버튼은 별도 핸들러에서 처리
      const shelf = chip.dataset.shelf;
      el("shelfFilterSelect").value = shelf;
      state.filters.shelf = shelf;
      state.visibleCount = PAGE_SIZE;
      applyFilters();
      highlightActiveChip();
    });
  });
  document.querySelectorAll(".chip-copy-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      copyShelfCodes(Number(btn.dataset.copyShelf));
    });
  });
  highlightActiveChip();
}

function copyShelfCodes(shelfNum) {
  const codes = state.products
    .filter((p) => (state.assignments[p.code]?.shelf || 0) === shelfNum)
    .map((p) => p.code);

  if (codes.length === 0) {
    showToast(`${SHELF_NAMES[shelfNum]}에 배정된 제품이 아직 없어요.`, true);
    return;
  }

  const text = codes.join("\n");

  const done = () => showToast(`${SHELF_NAMES[shelfNum]} 제품코드 ${codes.length.toLocaleString("ko")}개를 복사했어요.`);
  const fail = () => showToast("복사에 실패했어요. 직접 선택해서 복사해주세요.", true);

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done).catch(fail);
  } else {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      done();
    } catch {
      fail();
    }
    document.body.removeChild(ta);
  }
}

function highlightActiveChip() {
  document.querySelectorAll(".shelf-chip").forEach((chip) => {
    chip.classList.toggle("active-filter", chip.dataset.shelf === state.filters.shelf && state.filters.shelf !== "");
  });
}

function chipHtml(n, label, count, qty) {
  const cls = n === 0 ? "shelf-chip unassigned" : "shelf-chip";
  const dotStyle = n === 0 ? "" : `style="background: var(--shelf-${n})"`;
  const displayLabel = n === 0 ? label : `${n}. ${SHELF_NAMES[n]}`;
  const copyBtn = n === 0 ? "" : `<button class="chip-copy-btn" data-copy-shelf="${n}" title="${SHELF_NAMES[n]} 제품코드 복사">복사</button>`;
  return `
    <div class="${cls}" data-shelf="${n}">
      <span class="dot" ${dotStyle}></span>
      <span class="label">${displayLabel}</span>
      <span class="count">${count.toLocaleString("ko")}종 · ${qty.toLocaleString("ko")}개</span>
      ${copyBtn}
    </div>
  `;
}

/* ---------------- assignment write ---------------- */

async function toggleAssignment(code, shelf) {
  if (!sb || !isOnline) {
    showToast("⚠️ 서버 연결이 끊겨있어 저장할 수 없어요. 상단이 초록불일 때 다시 시도해주세요.", true);
    return;
  }

  const current = state.assignments[code]?.shelf;
  const isUnassigning = current === shelf;
  const previous = state.assignments[code]; // 실패 시 롤백용

  // optimistic update
  if (isUnassigning) {
    delete state.assignments[code];
  } else {
    state.assignments[code] = {
      product_code: code,
      shelf,
      updated_by: state.me || "익명",
      updated_at: new Date().toISOString(),
    };
  }
  renderVisibleRow(code);
  renderShelfSummary();

  try {
    if (isUnassigning) {
      const { error } = await sb.from("shelf_assignments").delete().eq("product_code", code);
      if (error) throw error;
    } else {
      const { error } = await sb.from("shelf_assignments").upsert(
        {
          product_code: code,
          shelf,
          updated_by: state.me || "익명",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "product_code" }
      );
      if (error) throw error;
    }
  } catch (err) {
    console.error(err);
    // 저장 실패 시 화면도 원래 상태로 되돌려서 "저장된 것처럼 보이는" 상황을 방지
    if (previous) state.assignments[code] = previous;
    else delete state.assignments[code];
    renderVisibleRow(code);
    renderShelfSummary();
    showToast("❌ 저장에 실패해서 되돌렸어요. 연결 상태를 확인하고 다시 시도해주세요.", true);
  }
}

/* ---------------- activity feed ---------------- */

const activityLog = [];

function pushActivity(row) {
  const product = state.products.find((p) => p.code === row.product_code);
  activityLog.unshift({
    code: row.product_code,
    name: product?.name || row.product_code,
    shelf: row._removed ? null : row.shelf,
    by: row.updated_by || "익명",
    at: row.updated_at || new Date().toISOString(),
  });
  if (activityLog.length > 30) activityLog.pop();
  renderActivity();
}

function renderActivity() {
  const feed = el("activityFeed");
  if (activityLog.length === 0) {
    feed.innerHTML = `<p class="activity-empty">아직 변경 내역이 없어요.</p>`;
    return;
  }
  feed.innerHTML = activityLog
    .map((a) => {
      const dotStyle = a.shelf ? `style="background: var(--shelf-${a.shelf})"` : `style="background:#C9C3B4"`;
      const action = a.shelf ? `${SHELF_NAMES[a.shelf]}(${a.shelf}번)로 배정` : "배정 해제";
      return `
        <div class="activity-item">
          <span class="activity-dot" ${dotStyle}></span>
          <span class="activity-text">
            <b>${esc(a.by)}</b>님이 <b>${esc(a.name)}</b>을(를) ${action}
            <span class="activity-time">${formatTime(a.at)}</span>
          </span>
        </div>
      `;
    })
    .join("");
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/* ---------------- toast ---------------- */

let toastTimer;
function showToast(msg, isError) {
  const t = el("toast");
  t.textContent = msg;
  t.className = "toast show" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast"), 3000);
}

init();
