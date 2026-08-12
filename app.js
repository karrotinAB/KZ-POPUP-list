/* ==========================================================
   카자흐스탄 팝업 매대 배정 도구
   - products.json: 정적 제품 데이터 (검색/필터용)
   - Supabase table `shelf_assignments`: 실시간 공유되는 매대 배정 데이터
   ========================================================== */

const SHELF_COUNT = 6;
const PAGE_SIZE = 60;

const state = {
  products: [],           // 전체 제품 (정적)
  assignments: {},        // { [product_code]: { shelf, updated_by, updated_at } }
  filtered: [],           // 현재 필터 적용된 결과
  visibleCount: PAGE_SIZE,
  filters: { q: "", cat1: "", cat2: "", cat3: "", cat4: "", shelf: "" },
  me: localStorage.getItem("kaz_pog_me") || "",
};

let sb = null;
let channel = null;

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

  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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
  const { data, error } = await sb.from("shelf_assignments").select("*");
  if (error) throw error;
  state.assignments = {};
  for (const row of data) {
    state.assignments[row.product_code] = row;
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
  el("connDot").className = "conn-dot " + (online ? "online" : "offline");
  el("connLabel").textContent = label;
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

  el("loadMoreBtn").addEventListener("click", () => {
    state.visibleCount += PAGE_SIZE;
    renderProductList();
  });
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
      const hay = (p.code + " " + p.name + " " + p.nameEn + " " + p.barcode).toLowerCase();
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

  const shelfButtons = Array.from({ length: SHELF_COUNT }, (_, i) => {
    const n = i + 1;
    const active = shelf === n ? "active" : "";
    return `<button class="shelf-btn s${n} ${active}" data-code="${escAttr(p.code)}" data-shelf="${n}" title="${n}번 매대${active ? " (배정됨 · 클릭시 해제)" : ""}">${n}</button>`;
  }).join("");

  return `
    <div class="product-row ${assignedClass}" data-code="${escAttr(p.code)}">
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
  const btn = e.target.closest(".shelf-btn");
  if (!btn) return;
  const code = btn.dataset.code;
  const shelf = Number(btn.dataset.shelf);
  toggleAssignment(code, shelf);
});

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
    chip.addEventListener("click", () => {
      const shelf = chip.dataset.shelf;
      el("shelfFilterSelect").value = shelf;
      state.filters.shelf = shelf;
      state.visibleCount = PAGE_SIZE;
      applyFilters();
      highlightActiveChip();
    });
  });
  highlightActiveChip();
}

function highlightActiveChip() {
  document.querySelectorAll(".shelf-chip").forEach((chip) => {
    chip.classList.toggle("active-filter", chip.dataset.shelf === state.filters.shelf && state.filters.shelf !== "");
  });
}

function chipHtml(n, label, count, qty) {
  const cls = n === 0 ? "shelf-chip unassigned" : "shelf-chip";
  const dotStyle = n === 0 ? "" : `style="background: var(--shelf-${n})"`;
  return `
    <div class="${cls}" data-shelf="${n}">
      <span class="dot" ${dotStyle}></span>
      <span class="label">${label}</span>
      <span class="count">${count.toLocaleString("ko")}종 · ${qty.toLocaleString("ko")}개</span>
    </div>
  `;
}

/* ---------------- assignment write ---------------- */

async function toggleAssignment(code, shelf) {
  if (!sb) {
    showToast("Supabase가 설정되지 않아 저장할 수 없어요. config.js를 확인해주세요.", true);
    return;
  }

  const current = state.assignments[code]?.shelf;
  const isUnassigning = current === shelf;

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
    showToast("저장에 실패했어요. 네트워크를 확인해주세요.", true);
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
      const action = a.shelf ? `${a.shelf}번 매대로 배정` : "배정 해제";
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
