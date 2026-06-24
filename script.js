/* global L, Papa */

/* --------------------------------------------------------------------------
   Atlas of Dante's Divine Comedy
   This file is intentionally organized into small, named sections so a new
   coder can find and change one part without understanding the whole file.
   -------------------------------------------------------------------------- */

"use strict";

// --- 1. Shared settings and page state --------------------------------------

const CSV_PATH = "data/dante_places.csv";
const DEFAULT_VIEW = [42.2, 12.4];
const DEFAULT_ZOOM = 4;
const MIN_LABEL_ZOOM = 6;

const CANTICA_COLORS = {
  Inferno: "#741014",
  Purgatorio: "#a4542e",
  Paradiso: "#b38a18",
  Unknown: "#7d6b63"
};

let allRows = [];
let visibleMarkers = [];
let markerRecords = [];
let currentLabelMode = "symbol";
let pendingLibraryHighlight = null;

// --- 2. Leaflet map and the two CARTO basemaps ------------------------------

const map = L.map("map", {
  center: DEFAULT_VIEW,
  zoom: DEFAULT_ZOOM,
  minZoom: 2,
  maxZoom: 18,
  worldCopyJump: true,
  zoomControl: false
});

L.control.zoom({ position: "bottomright" }).addTo(map);

const tileOptions = {
  subdomains: "abcd",
  maxZoom: 20,
  attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
};

const labeledBasemap = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  tileOptions
);

const noLabelBasemap = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
  tileOptions
).addTo(map);

// A dedicated group makes removing and restoring filtered markers simple.
const markerLayer = L.layerGroup().addTo(map);

// --- 3. Defensive helpers for CSV text --------------------------------------

/**
 * Return a value even when a CSV header has odd spaces, punctuation, or case.
 * The first exact match wins; then normalized header names are compared.
 */
function getField(row, possibleNames) {
  for (const name of possibleNames) {
    if (Object.prototype.hasOwnProperty.call(row, name)) {
      return String(row[name] ?? "").trim();
    }
  }

  const normalizeHeader = (header) => String(header)
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  const normalizedNames = possibleNames.map(normalizeHeader);
  const matchingKey = Object.keys(row).find((key) => normalizedNames.includes(normalizeHeader(key)));
  return matchingKey ? String(row[matchingKey] ?? "").trim() : "";
}

/** Escape CSV text before placing it in any HTML string. */
function escapeHTML(text) {
  return String(text ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]);
}

/** Standardize spelling/capitalization; unknown values remain usable. */
function normalizeCantica(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized.startsWith("inf")) return "Inferno";
  if (normalized.startsWith("purg")) return "Purgatorio";
  if (normalized.startsWith("par")) return "Paradiso";
  return value ? String(value).trim() : "Unknown";
}

/** Convert every messy CSV row into a predictable object used by the site. */
function normalizeRow(row, index) {
  const latitudeText = getField(row, ["latitude", "lat"]);
  const longitudeText = getField(row, ["longitude", "lon", "lng"]);
  const latitude = Number.parseFloat(latitudeText);
  const longitude = Number.parseFloat(longitudeText);

  return {
    id: getField(row, ["id", "ID"]) || `row-${index + 1}`,
    rowIndex: index,
    placeName: getField(row, ["place_name", "place name", "place"]),
    cantica: normalizeCantica(getField(row, ["cantica", "Cantica"])),
    citation: getField(row, ["citation", "canto and lines", "reference"]),
    italian: getField(row, ["italian text", "italian_text", "Italian terzina", "italian"]),
    english: getField(row, [
      "english translation ( Henry Wadsworth Longfellow (English, 1867)",
      "english translation",
      "english_translation",
      "translation"
    ]),
    coordinateSource: getField(row, ["coordinate_source", "coordinate source"]),
    coordinateNotes: getField(row, ["coordinate_notes", "coordinate notes", "mapping notes"]),
    latitude,
    longitude,
    hasCoordinates: Number.isFinite(latitude)
      && Number.isFinite(longitude)
      && latitude >= -90
      && latitude <= 90
      && longitude >= -180
      && longitude <= 180
  };
}

function textWithLineBreaks(text, fallback = "Not provided") {
  const safeText = escapeHTML(text || fallback);
  return safeText.replace(/\r?\n/g, "<br>");
}

function canticaColor(cantica) {
  return CANTICA_COLORS[cantica] || CANTICA_COLORS.Unknown;
}

// --- 4. Popup cards ---------------------------------------------------------

/** Create one safely escaped literary popup card. */
function createPopupHTML(row) {
  const mappingParts = [];
  if (row.coordinateSource) {
    mappingParts.push(`<strong>Coordinate source:</strong> ${textWithLineBreaks(row.coordinateSource)}`);
  }
  if (row.coordinateNotes) {
    mappingParts.push(`<strong>Notes:</strong> ${textWithLineBreaks(row.coordinateNotes)}`);
  }

  return `
    <article class="popup-card">
      <h3>${escapeHTML(row.placeName || "Unnamed place")}</h3>
      <p class="popup-meta"><strong>Cantica:</strong> ${escapeHTML(row.cantica)}<br><strong>Citation:</strong> ${escapeHTML(row.citation || "Not provided")}</p>
      <span class="popup-text-label">Italian</span>
      <p class="popup-quotation italian">“${textWithLineBreaks(row.italian)}”</p>
      <span class="popup-text-label">English</span>
      <p class="popup-quotation">“${textWithLineBreaks(row.english)}”</p>
      ${mappingParts.length ? `<div class="popup-mapping"><span class="popup-text-label">Mapping</span>${mappingParts.join("<br>")}</div>` : ""}
      <button class="popup-library-link" type="button" data-row-index="${row.rowIndex}">Explore in Library →</button>
    </article>
  `;
}

/** Rows at the same coordinates are all listed in the popup, so none is lost. */
function createSharedPopupHTML(rowsAtLocation) {
  const note = rowsAtLocation.length > 1
    ? `<p class="shared-location-note">${rowsAtLocation.length} mentions share this mapped location</p>`
    : "";
  return note + rowsAtLocation.map(createPopupHTML).join("");
}

// --- 5. Markers and filtering ----------------------------------------------

function buildMarkers() {
  markerLayer.clearLayers();
  markerRecords = [];

  const rowsByCoordinates = new Map();
  allRows.filter((row) => row.hasCoordinates).forEach((row) => {
    const key = `${row.latitude.toFixed(6)},${row.longitude.toFixed(6)}`;
    if (!rowsByCoordinates.has(key)) rowsByCoordinates.set(key, []);
    rowsByCoordinates.get(key).push(row);
  });

  allRows.filter((row) => row.hasCoordinates).forEach((row) => {
    const key = `${row.latitude.toFixed(6)},${row.longitude.toFixed(6)}`;
    const rowsAtLocation = rowsByCoordinates.get(key);
    const color = canticaColor(row.cantica);
    const marker = L.circleMarker([row.latitude, row.longitude], {
      radius: 4.3,
      color,
      weight: 1.2,
      opacity: 0.74,
      fillColor: color,
      fillOpacity: 0.62,
      className: "dante-dot"
    });

    marker.bindPopup(createSharedPopupHTML(rowsAtLocation), {
      maxWidth: 370,
      minWidth: 280,
      autoPanPadding: [28, 28]
    });

    marker.bindTooltip(escapeHTML(row.placeName || "Unnamed place"), {
      permanent: true,
      direction: "right",
      offset: [6, 0],
      className: "dante-label",
      opacity: 1
    });

    markerRecords.push({ row, marker });
  });

  applyCanticaFilter();
}

/** Apply the selected cantica to the map and update the result count. */
function applyCanticaFilter() {
  const selectedCantica = document.getElementById("mapCanticaFilter").value;
  markerLayer.clearLayers();

  const matchingRecords = markerRecords.filter(({ row }) => (
    selectedCantica === "all" || row.cantica === selectedCantica
  ));

  matchingRecords.forEach(({ marker }) => marker.addTo(markerLayer));
  visibleMarkers = matchingRecords;

  const count = matchingRecords.length;
  document.getElementById("resultCount").textContent = `Showing ${count} mapped ${count === 1 ? "mention" : "mentions"}`;
  updateMarkerLabelVisibility();
}

/** Fly to and open one marker from the currently visible set. */
function openRandomLocation() {
  if (!visibleMarkers.length) return;
  const chosen = visibleMarkers[Math.floor(Math.random() * visibleMarkers.length)];
  const destinationZoom = Math.max(map.getZoom(), 7);
  // Wait for the flight to finish before opening, so Leaflet can keep the
  // entire literary card inside the visible map.
  map.once("moveend", () => chosen.marker.openPopup());
  map.flyTo(chosen.marker.getLatLng(), destinationZoom, { duration: 1.1 });
}

// --- 6. Label modes and basemap switching ----------------------------------

function updateMarkerLabelVisibility() {
  const mapElement = document.getElementById("map");
  const showsDanteLabels = currentLabelMode === "symbol" || currentLabelMode === "both";
  mapElement.classList.toggle("labels-hidden", !showsDanteLabels);
  mapElement.classList.toggle("labels-too-wide", map.getZoom() < MIN_LABEL_ZOOM);
}

/** Switch between Dante labels, CARTO labels, both label sets, or no labels. */
function setLabelMode(mode) {
  if (!["symbol", "basemap", "both", "off"].includes(mode)) return;
  currentLabelMode = mode;

  const showsBasemapLabels = mode === "basemap" || mode === "both";
  if (showsBasemapLabels) {
    if (map.hasLayer(noLabelBasemap)) map.removeLayer(noLabelBasemap);
    if (!map.hasLayer(labeledBasemap)) labeledBasemap.addTo(map);
  } else {
    if (map.hasLayer(labeledBasemap)) map.removeLayer(labeledBasemap);
    if (!map.hasLayer(noLabelBasemap)) noLabelBasemap.addTo(map);
  }

  // Keep dots and popups above the newly added tile layer.
  markerLayer.bringToFront?.();

  document.querySelectorAll("[data-label-mode]").forEach((button) => {
    const isSelected = button.dataset.labelMode === mode;
    button.classList.toggle("is-active", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });
  updateMarkerLabelVisibility();
}

// --- 7. Library cards and searching ----------------------------------------

function searchableText(row) {
  return [row.placeName, row.citation, row.italian, row.english]
    .join(" ")
    .toLocaleLowerCase();
}

function createLibraryCardHTML(row) {
  const mappingDetails = [
    row.coordinateSource ? `<strong>Coordinate source:</strong> ${textWithLineBreaks(row.coordinateSource)}` : "",
    row.coordinateNotes ? `<strong>Notes:</strong> ${textWithLineBreaks(row.coordinateNotes)}` : ""
  ].filter(Boolean).join("<br>");

  return `
    <article class="library-card" id="library-row-${row.rowIndex}" data-row-index="${row.rowIndex}" style="--cantica-color: ${canticaColor(row.cantica)}">
      <h3>${escapeHTML(row.placeName || "Unnamed place")}</h3>
      <p class="card-meta">${escapeHTML(row.cantica)} · ${escapeHTML(row.citation || "Citation not provided")}</p>
      <blockquote class="italian">${textWithLineBreaks(row.italian)}</blockquote>
      <blockquote>${textWithLineBreaks(row.english)}</blockquote>
      ${mappingDetails ? `<p class="card-mapping">${mappingDetails}</p>` : ""}
      ${row.hasCoordinates ? "" : '<span class="library-only">Library only · Not plotted</span>'}
    </article>
  `;
}

/** Render all matching CSV rows, including future rows without coordinates. */
function renderLibrary() {
  const query = document.getElementById("librarySearch").value.trim().toLocaleLowerCase();
  const selectedCantica = document.getElementById("libraryCanticaFilter").value;
  const matchingRows = allRows.filter((row) => {
    const matchesCantica = selectedCantica === "all" || row.cantica === selectedCantica;
    const matchesQuery = !query || searchableText(row).includes(query);
    return matchesCantica && matchesQuery;
  });

  const cards = document.getElementById("libraryCards");
  cards.innerHTML = matchingRows.length
    ? matchingRows.map(createLibraryCardHTML).join("")
    : '<p class="library-empty">No passages match this search.</p>';

  document.getElementById("libraryCount").textContent = `${matchingRows.length} ${matchingRows.length === 1 ? "passage" : "passages"}`;

  if (pendingLibraryHighlight !== null) {
    const card = document.getElementById(`library-row-${pendingLibraryHighlight}`);
    if (card) {
      card.classList.add("is-highlighted");
      window.setTimeout(() => card.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
      window.setTimeout(() => card.classList.remove("is-highlighted"), 3600);
    }
    pendingLibraryHighlight = null;
  }
}

// --- 8. Sidebar tabs and small-screen drawer -------------------------------

function activateTab(tabName) {
  document.querySelectorAll(".tab-button").forEach((button) => {
    const isActive = button.dataset.tab === tabName;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    const isActive = panel.id === `${tabName}Panel`;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  });

  if (tabName === "library") renderLibrary();
  document.querySelector(".sidebar-content").scrollTop = 0;
}

function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  const button = document.getElementById("mobileToggle");
  button.setAttribute("aria-expanded", String(!collapsed));
  button.setAttribute("aria-label", collapsed ? "Open navigation" : "Close navigation");
  button.querySelector("span").textContent = collapsed ? "☰" : "×";
  window.setTimeout(() => map.invalidateSize(), 250);
}

// --- 9. Load data with Papa Parse ------------------------------------------

function loadCSV() {
  Papa.parse(CSV_PATH, {
    download: true,
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim().replace(/^\uFEFF/, ""),
    complete(results) {
      if (results.errors.some((error) => error.type === "Delimiter" || error.type === "Quotes")) {
        console.warn("Some CSV rows may need attention:", results.errors);
      }

      allRows = results.data
        .map(normalizeRow)
        .filter((row) => row.id || row.placeName || row.italian || row.english);

      buildMarkers();
      renderLibrary();
    },
    error(error) {
      console.error("CSV load error:", error);
      document.getElementById("dataError").hidden = false;
      document.getElementById("resultCount").textContent = "No map data loaded";
      document.getElementById("libraryCount").textContent = "No library data loaded";
    }
  });
}

// --- 10. Event listeners ----------------------------------------------------

document.getElementById("applyFilterButton").addEventListener("click", applyCanticaFilter);
document.getElementById("mapCanticaFilter").addEventListener("change", applyCanticaFilter);
document.getElementById("randomButton").addEventListener("click", openRandomLocation);
document.getElementById("librarySearch").addEventListener("input", renderLibrary);
document.getElementById("libraryCanticaFilter").addEventListener("change", renderLibrary);
document.getElementById("mobileToggle").addEventListener("click", () => {
  setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"));
});

document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.tab));
});

document.querySelectorAll("[data-label-mode]").forEach((button) => {
  button.addEventListener("click", () => setLabelMode(button.dataset.labelMode));
});

document.querySelectorAll("[data-about-link]").forEach((button) => {
  button.addEventListener("click", () => activateTab("about"));
});

document.addEventListener("click", (event) => {
  const libraryLink = event.target.closest(".popup-library-link");
  if (!libraryLink) return;
  pendingLibraryHighlight = Number(libraryLink.dataset.rowIndex);
  activateTab("library");
  if (window.matchMedia("(max-width: 760px)").matches) setSidebarCollapsed(false);
});

map.on("zoomend", updateMarkerLabelVisibility);

// Welcome screen: localStorage lets it appear once, but the site still works
// in privacy modes where storage may be unavailable.
const welcomeModal = document.getElementById("welcomeModal");
try {
  if (localStorage.getItem("dante-atlas-welcomed") === "yes") {
    welcomeModal.classList.add("is-closed");
  }
} catch (error) {
  console.info("Welcome preference could not be read.");
}

document.getElementById("startExploring").addEventListener("click", () => {
  welcomeModal.classList.add("is-closed");
  try {
    localStorage.setItem("dante-atlas-welcomed", "yes");
  } catch (error) {
    console.info("Welcome preference could not be saved.");
  }
});

// Start in Symbol mode (Dante labels + a no-label basemap), then load the CSV.
setLabelMode("symbol");
loadCSV();
