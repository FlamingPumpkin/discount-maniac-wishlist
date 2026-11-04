import { db, ready } from "@terminus-ai/app-sdk";
import itemsCollectionOptions from "../schema";
import { INITIAL_DATA, type DashboardItem } from "./seed";

type ItemFilter = DashboardItem["type"] | "all" | "deals" | "pending";
type ItemFields = Omit<DashboardItem, "id">;

const items = db.collection<ItemFields>("items", itemsCollectionOptions);

declare global {
  interface Window {
    setFilter: (type: ItemFilter, button: HTMLElement) => void;
    renderItems: typeof renderItems;
    openAddModal: () => void;
    closeAddModal: () => void;
    saveNewItem: () => Promise<void>;
    exportData: () => void;
    importData: (event: Event) => void;
  }
}

let appData: DashboardItem[] = [...INITIAL_DATA];
let currentFilter: ItemFilter = "all";
let isTerminusConnected = false;
let receivedInitialSnapshot = false;

function makeSvgPlaceholder(icon?: string): string {
  const safeIcon = escapeHtml(icon || "📦");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect width="80" height="80" fill="#141b2d"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-size="36">${safeIcon}</text></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

function escapeHtml(value: string | undefined): string {
  return (value || "").replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[char];
  });
}

function safeHttpUrl(value: string | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function setSyncStatus(text: string): void {
  const badge = document.getElementById("syncStatus");
  if (badge) badge.innerText = text;
}

function reportError(operation: string, error: unknown): void {
  console.error(`${operation} failed`, error);
  setSyncStatus("Sync error — check console");
}

function normalizeImportedItem(value: unknown): DashboardItem | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.title !== "string" ||
    (record.type !== "todo" && record.type !== "tobuy" && record.type !== "wishlist")
  ) {
    return null;
  }

  const pricingRecord =
    record.pricing && typeof record.pricing === "object"
      ? (record.pricing as Record<string, unknown>)
      : undefined;
  const pricing = pricingRecord
    ? {
        official: typeof pricingRecord.official === "string" ? pricingRecord.official : undefined,
        current_best: typeof pricingRecord.current_best === "string" ? pricingRecord.current_best : undefined,
        target_deal: typeof pricingRecord.target_deal === "string" ? pricingRecord.target_deal : undefined,
        strategy: typeof pricingRecord.strategy === "string" ? pricingRecord.strategy : undefined
      }
    : undefined;
  const links = Array.isArray(record.links)
    ? record.links.flatMap((link: unknown) => {
        if (!link || typeof link !== "object") return [];
        const candidate = link as Record<string, unknown>;
        return typeof candidate.title === "string" && typeof candidate.url === "string"
          ? [{ title: candidate.title, url: candidate.url }]
          : [];
      })
    : undefined;

  return {
    id: record.id,
    title: record.title,
    type: record.type,
    icon: typeof record.icon === "string" ? record.icon : undefined,
    wiki_title: typeof record.wiki_title === "string" ? record.wiki_title : undefined,
    commons_query: typeof record.commons_query === "string" ? record.commons_query : undefined,
    img: typeof record.img === "string" ? record.img : undefined,
    price_summary: typeof record.price_summary === "string" ? record.price_summary : undefined,
    deal_alert: record.deal_alert === true || record.deal_alert === "true",
    deal_badge: typeof record.deal_badge === "string" ? record.deal_badge : undefined,
    pricing,
    notes: typeof record.notes === "string" ? record.notes : undefined,
    links,
    completed: record.completed === true || record.completed === "true"
  };
}

async function initStore() {
  try {
    const info = await ready();
    const live = await items.live();
    const syncRecords = async (): Promise<void> => {
      if (!receivedInitialSnapshot) {
        receivedInitialSnapshot = true;
        if (live.records.length === 0) {
          for (const item of INITIAL_DATA) {
            const { id, ...fields } = item;
            await items.put(id, fields);
          }
          return;
        }
      }

      appData = live.records.map((record) => ({ id: record.id, ...record.value }));
      renderItems();
      void resolveAllImages();
    };
    const handleRecordsChanged = (): void => {
      void syncRecords().catch((error: unknown) => reportError("Loading Terminus records", error));
    };
    live.subscribe(handleRecordsChanged);
    handleRecordsChanged();
    isTerminusConnected = true;
    setSyncStatus(info.guest ? "Terminus Guest" : `🟢 Sync: @${info.user?.handle || "Online"}`);
  } catch (err) {
    isTerminusConnected = false;
    console.error("Terminus connection failed; switching to local-only mode.", err);
    setSyncStatus("Local-only mode — Terminus unavailable");
    try {
      const stored = localStorage.getItem("discount_freak_items_v6");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) appData = parsed;
      }
    } catch (storageError) {
      console.error("Could not read the local backup.", storageError);
    }
    renderItems();
    void resolveAllImages();
  }
}

async function persistItem(item: DashboardItem) {
  if (isTerminusConnected) {
    const { id, ...fields } = item;
    await items.put(id, fields);
  } else {
    localStorage.setItem("discount_freak_items_v6", JSON.stringify(appData));
    renderItems();
  }
}

function updateCounters() {
  const setTxt = (id: string, val: number) => {
    const el = document.getElementById(id);
    if (el) el.innerText = String(val);
  };
  setTxt("cnt-all", appData.length);
  setTxt("cnt-deals", appData.filter((i) => i.deal_alert).length);
  setTxt("cnt-todo", appData.filter((i) => i.type === "todo").length);
  setTxt("cnt-tobuy", appData.filter((i) => i.type === "tobuy").length);
  setTxt("cnt-wishlist", appData.filter((i) => i.type === "wishlist").length);
}

async function resolveAllImages() {
  const needWiki = appData.filter((i) => !i.img && i.wiki_title);
  if (needWiki.length > 0) {
    const titles = needWiki.map((i) => i.wiki_title).join("|");
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=thumbnail&pithumbsize=160&titles=${encodeURIComponent(titles)}&redirects=1&format=json&origin=*`;
    try {
      const res = await fetch(wikiUrl);
      if (!res.ok) throw new Error(`Wikipedia returned HTTP ${res.status}`);
      const data = await res.json();
      const pages = data?.query?.pages || {};
      const titleToThumb: Record<string, string> = {};
      Object.values(pages).forEach((page: any) => {
        if (page.thumbnail?.source) {
          titleToThumb[page.title.toLowerCase()] = page.thumbnail.source;
        }
      });
      const normMap: Record<string, string> = {};
      (data?.query?.normalized || []).forEach((normalized: any) => (normMap[normalized.from] = normalized.to));
      (data?.query?.redirects || []).forEach((redirect: any) => (normMap[redirect.from] = redirect.to));

      for (const item of needWiki) {
        let lookup = (item.wiki_title || "").replace(/_/g, " ");
        if (item.wiki_title && normMap[item.wiki_title]) lookup = normMap[item.wiki_title];
        if (normMap[lookup]) lookup = normMap[lookup];
        const found = titleToThumb[lookup.toLowerCase()];
        if (found) {
          item.img = found;
          const domImg = document.getElementById("img-" + item.id) as HTMLImageElement | null;
          if (domImg) domImg.src = found;
          await persistItem(item);
        }
      }
    } catch (error) {
      console.warn("Could not resolve Wikipedia thumbnails.", error);
    }
  }

  const stillMissing = appData.filter((i) => !i.img && i.commons_query);
  for (const item of stillMissing) {
    await resolveSingleCommonsImage(item);
  }
}

async function resolveSingleCommonsImage(item: DashboardItem) {
  if (!item.commons_query) return;
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=1&gsrsearch=${encodeURIComponent("filetype:bitmap " + item.commons_query)}&prop=imageinfo&iiprop=url&iiurlwidth=160&format=json&origin=*`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Wikimedia Commons returned HTTP ${res.status}`);
    const data = await res.json();
    const pages = data?.query?.pages || {};
    const firstPage: any = Object.values(pages)[0];
    const thumb = firstPage?.imageinfo?.[0]?.thumburl;
    if (thumb) {
      item.img = thumb;
      const domImg = document.getElementById("img-" + item.id) as HTMLImageElement | null;
      if (domImg) domImg.src = thumb;
      await persistItem(item);
    }
  } catch (error) {
    console.warn(`Could not resolve thumbnail for "${item.title}".`, error);
  }
}

export function renderItems() {
  const list = document.getElementById("taskList");
  const searchBox = document.getElementById("searchBox") as HTMLInputElement | null;
  if (!list) return;

  const q = (searchBox?.value || "").toLowerCase();
  list.innerHTML = "";

  const filtered = appData.filter((item) => {
    const matchType =
      currentFilter === "all" ||
      (currentFilter === "deals" && item.deal_alert) ||
      (currentFilter === "pending" && !item.completed) ||
      item.type === currentFilter;
    const matchSearch =
      item.title.toLowerCase().includes(q) ||
      (item.notes && item.notes.toLowerCase().includes(q)) ||
      (item.price_summary && item.price_summary.toLowerCase().includes(q));
    return matchType && matchSearch;
  });

  filtered.forEach((item) => {
    const row = document.createElement("div");
    row.className = `task-row ${item.completed ? "completed" : ""} ${item.deal_alert && !item.completed ? "deal-active" : ""}`;

    let badgeClass = "badge-todo";
    let badgeName = "To-Do";
    if (item.type === "tobuy") {
      badgeClass = "badge-tobuy";
      badgeName = "To-Buy";
    } else if (item.type === "wishlist") {
      badgeClass = "badge-wishlist";
      badgeName = "Wishlist";
    }

    const dealFlameHtml =
      item.deal_alert && item.deal_badge
        ? `<span class="deal-flame-badge">${escapeHtml(item.deal_badge)}</span>`
        : "";
    const priceHtml = item.price_summary ? `<span class="price-pill">${escapeHtml(item.price_summary)}</span>` : "";

    let pricingBoxHtml = "";
    if (item.pricing) {
      pricingBoxHtml = `
        <div class="deal-breakdown-box">
          ${item.pricing.official ? `<div class="price-metric"><span class="metric-title">Regular price:</span><span class="metric-val">${escapeHtml(item.pricing.official)}</span></div>` : ""}
          ${item.pricing.current_best ? `<div class="price-metric"><span class="metric-title">Best current price:</span><span class="metric-val best">${escapeHtml(item.pricing.current_best)}</span></div>` : ""}
          ${item.pricing.target_deal ? `<div class="price-metric"><span class="metric-title">Target price:</span><span class="metric-val target">🎯 ${escapeHtml(item.pricing.target_deal)}</span></div>` : ""}
          ${item.pricing.strategy ? `<div class="strategy-note"><strong>💡 Strategy:</strong> ${escapeHtml(item.pricing.strategy)}</div>` : ""}
        </div>
      `;
    }

    let linksHtml = "";
    if (item.links?.length) {
      linksHtml =
        '<div class="links-strip">' +
        item.links
          .map((link) => {
            const url = safeHttpUrl(link.url);
            return url
              ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="action-link">🔗 ${escapeHtml(link.title || "Link")}</a>`
              : "";
          })
          .join("") +
        "</div>";
    }

    const safeFallback = makeSvgPlaceholder(item.icon);
    const currentSrc = safeHttpUrl(item.img) || safeFallback;
    const escapedId = escapeHtml(item.id);

    row.innerHTML = `
      <div class="row-header">
        <input type="checkbox" class="custom-check" ${item.completed ? "checked" : ""} data-action="toggle" data-id="${escapedId}">
        <div class="thumb-wrapper" data-action="edit-thumb" data-id="${escapedId}" title="Click to change image">
          <img id="img-${escapedId}" src="${escapeHtml(currentSrc)}" class="item-img" alt="Item thumbnail" loading="lazy">
        </div>
        <div class="title-col">
          <span class="task-name">${escapeHtml(item.title)}</span>
          <div class="badge-strip">
            <span class="badge ${badgeClass}">${badgeName}</span>
            ${dealFlameHtml}
          </div>
        </div>
      </div>
      <div class="row-footer">
        ${priceHtml}
        <div class="actions-group">
          <button class="expand-btn" id="btn-exp-${escapedId}" data-action="details" data-id="${escapedId}">▼ Details</button>
          <button class="del-btn" data-action="delete" data-id="${escapedId}" title="Delete">✕</button>
        </div>
      </div>
      <div class="row-details" id="details-${escapedId}">
        ${pricingBoxHtml}
        ${item.notes ? `<div class="item-notes-text">${escapeHtml(item.notes)}</div>` : ""}
        ${linksHtml}
      </div>
    `;
    list.appendChild(row);
    const image = row.querySelector("img");
    image?.addEventListener("error", () => {
      image.src = safeFallback;
    }, { once: true });
  });

  updateCounters();
}

document.addEventListener("click", async (e) => {
  const target = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-action]") : null;
  if (!target) return;

  const action = target.dataset.action;
  const id = target.dataset.id;
  if (!id) return;

  if (action === "details") {
    const el = document.getElementById("details-" + id);
    if (el) {
      el.classList.toggle("open");
      target.innerText = el.classList.contains("open") ? "▲ Less" : "▼ Details";
    }
  } else if (action === "delete") {
    if (confirm("Delete this item?")) {
      try {
        if (isTerminusConnected) {
          await items.delete(id);
        } else {
          appData = appData.filter((i) => i.id !== id);
          localStorage.setItem("discount_freak_items_v6", JSON.stringify(appData));
          renderItems();
        }
      } catch (error) {
        reportError("Deleting item", error);
      }
    }
  } else if (action === "edit-thumb") {
    const it = appData.find((i) => i.id === id);
    if (!it) return;
    const val = prompt("Enter a direct image URL or English search terms:", it.img || it.commons_query || "");
    if (val === null) return;
    const trimmed = val.trim();
    const imageUrl = safeHttpUrl(trimmed);
    if (imageUrl) {
      try {
        it.img = imageUrl;
        await persistItem(it);
        renderItems();
      } catch (error) {
        reportError("Updating item image", error);
      }
    } else if (trimmed.length > 0) {
      it.commons_query = trimmed;
      it.img = "";
      void resolveSingleCommonsImage(it);
    }
  }
});

document.addEventListener("change", async (e) => {
  const target = e.target instanceof HTMLInputElement ? e.target : null;
  if (!target) return;
  if (target.dataset.action === "toggle" && target.dataset.id) {
    const it = appData.find((i) => i.id === target.dataset.id);
    if (it) {
      try {
        it.completed = target.checked;
        await persistItem(it);
      } catch (error) {
        reportError("Updating item status", error);
      }
    }
  }
});

window.setFilter = (type: ItemFilter, btn: HTMLElement) => {
  currentFilter = type;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  renderItems();
};

window.renderItems = renderItems;
window.openAddModal = () => document.getElementById("addModal")?.classList.add("active");
window.closeAddModal = () => document.getElementById("addModal")?.classList.remove("active");

window.saveNewItem = async () => {
  const titleEl = document.getElementById("modalTitle") as HTMLInputElement;
  const typeEl = document.getElementById("modalType") as HTMLSelectElement;
  const priceEl = document.getElementById("modalPrice") as HTMLInputElement;
  const imgEl = document.getElementById("modalImg") as HTMLInputElement;
  const notesEl = document.getElementById("modalNotes") as HTMLTextAreaElement;
  const linkEl = document.getElementById("modalLink") as HTMLInputElement;

  const title = titleEl.value.trim();
  if (!title) return alert("Enter a name.");

  const rawImg = imgEl.value.trim();
  const imageUrl = safeHttpUrl(rawImg);
  const isDirectUrl = Boolean(imageUrl);
  const rawLink = linkEl.value.trim();
  const linkUrl = safeHttpUrl(rawLink);
  if (rawLink && !linkUrl) return alert("Links must start with http:// or https://.");

  const newItem: DashboardItem = {
    id: "task-" + Date.now(),
    type: (typeEl.value as "todo" | "tobuy" | "wishlist") || "wishlist",
    title,
    icon: "📦",
    img: imageUrl,
    commons_query: !isDirectUrl && rawImg ? rawImg : title,
    price_summary: priceEl.value.trim(),
    deal_alert: false,
    deal_badge: "",
    notes: notesEl.value.trim(),
    links: linkUrl ? [{ title: "Link", url: linkUrl }] : [],
    completed: false
  };

  appData.unshift(newItem);
  try {
    await persistItem(newItem);
  } catch (error) {
    appData = appData.filter((item) => item.id !== newItem.id);
    renderItems();
    reportError("Saving item", error);
    return;
  }
  renderItems();
  if (!isDirectUrl) void resolveSingleCommonsImage(newItem);
  window.closeAddModal();

  titleEl.value = "";
  priceEl.value = "";
  imgEl.value = "";
  notesEl.value = "";
  linkEl.value = "";
};

window.exportData = () => {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appData, null, 2));
  const dlAnchor = document.createElement("a");
  dlAnchor.setAttribute("href", dataStr);
  dlAnchor.setAttribute("download", `discount_maniac_wishlist_backup.json`);
  dlAnchor.click();
};

window.importData = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const imported: unknown = JSON.parse(String(e.target?.result));
      if (!Array.isArray(imported)) throw new Error("The backup must contain an array of items.");
      const normalized = imported.map(normalizeImportedItem);
      const validItems = normalized.filter((item): item is DashboardItem => item !== null);
      if (validItems.length !== normalized.length) {
        throw new Error("The backup contains an item with an invalid ID, title or category.");
      }
      appData = validItems;
      for (const item of appData) {
        try {
          await persistItem(item);
        } catch (error) {
          reportError("Importing item", error);
          return;
        }
      }
      renderItems();
      void resolveAllImages();
      alert("Data imported and synced successfully.");
    } catch (error) {
      console.error("Import failed.", error);
      alert("Could not import JSON. Check the file and console for details.");
    }
  };
  reader.readAsText(file);
};

function updateCountdowns() {
  const now = new Date();
  const targetAli = new Date("2026-11-11T00:00:00");
  const targetBF = new Date("2026-11-27T00:00:00");
  const targetCM = new Date("2026-11-30T00:00:00");

  function formatDiff(target: Date) {
    const diff = target.getTime() - now.getTime();
    if (diff <= 0) return "Started!";
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const mins = Math.floor((diff / (1000 * 60)) % 60);
    return `${days}d ${hours.toString().padStart(2, "0")}h ${mins.toString().padStart(2, "0")}m`;
  }

  const elAli = document.getElementById("timer-ali");
  const elBF = document.getElementById("timer-bf");
  const elCM = document.getElementById("timer-cm");

  if (elAli) elAli.innerText = formatDiff(targetAli);
  if (elBF) elBF.innerText = formatDiff(targetBF);
  if (elCM) elCM.innerText = formatDiff(targetCM);
}

setInterval(updateCountdowns, 60000);
updateCountdowns();
renderItems();
void initStore();