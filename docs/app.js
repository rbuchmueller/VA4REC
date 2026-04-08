const PANEL_W = 320;
const PANEL_H = 260;
const MARGIN = { top: 8, right: 8, bottom: 8, left: 8 };

const tooltip = d3.select("body")
  .append("div")
  .attr("class", "tooltip")
  .style("opacity", 0);

let USERS = [];
let POSITIONS = [];
let METRICS = [];
let DRIFT = [];
let RECOMMENDATIONS = [];

let ITEMS = [];
let ITEM_POSITIONS = [];
let ITEM_METRICS = [];

let iterations = [];
let selectedUserId = null;
let selectedItemId = null;

let globalX;
let globalY;
let globalItemX;
let globalItemY;

const GROUP_STORAGE_KEY = "recsys_country_groups_v1";
let COUNTRY_GROUPS = {};
let activeGroupName = "NONE";

// linked brushing state
let selectedUsers = new Set();
let selectedItems = new Set();
let linkIteration = null;
let lastBrushSource = null;

const USER_BRUSHES = new Map();
const ITEM_BRUSHES = new Map();

let brushModeActive = false;

Promise.all([
  d3.json("data/users.json"),
  d3.json("data/user_positions_pca.json"),
  d3.json("data/user_metrics.json"),
  d3.json("data/user_drift.json"),
  d3.json("data/user_recommendations.json").catch(() => []),
  d3.json("data/items.json"),
  d3.json("data/item_positions_pca.json"),
  d3.json("data/item_metrics.json")
]).then(([
  users,
  positions,
  metrics,
  drift,
  recommendations,
  items,
  itemPositions,
  itemMetrics
]) => {
  USERS = users;
  POSITIONS = positions;
  METRICS = metrics;
  DRIFT = drift;
  RECOMMENDATIONS = recommendations;

  ITEMS = items;
  ITEM_POSITIONS = itemPositions;
  ITEM_METRICS = itemMetrics;

  iterations = [...new Set(
    POSITIONS.map(d => +d.iteration).concat(ITEM_POSITIONS.map(d => +d.iteration))
  )].sort((a, b) => a - b);

  loadGroupsFromStorage();
  initControls();
  initBrushKeyboardMode();
  buildSharedScales();
  buildSmallMultiples();
  buildItemSmallMultiples();
  updateAll();
});

// --------------------------------------------------
// storage
// --------------------------------------------------
function loadGroupsFromStorage() {
  try {
    const raw = localStorage.getItem(GROUP_STORAGE_KEY);
    COUNTRY_GROUPS = raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.warn("Could not load saved groups.", err);
    COUNTRY_GROUPS = {};
  }
}

function saveGroupsToStorage() {
  try {
    localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(COUNTRY_GROUPS));
  } catch (err) {
    console.warn("Could not save groups.", err);
  }
}

// --------------------------------------------------
// controls
// --------------------------------------------------
function initControls() {
  const countries = getAllCountries();
  const countrySelect = d3.select("#country_highlight");

  countries.forEach(c => {
    countrySelect.append("option").attr("value", c).text(c);
  });

  populateGroupDropdown();
  buildGroupCountryChecklist();

  const iterMin = d3.min(iterations);
  const iterMax = d3.max(iterations);

  d3.select("#selected_iteration")
    .attr("min", iterMin)
    .attr("max", iterMax)
    .property("value", iterMin);

  d3.select("#selected_iteration_value").text(iterMin);

  const opacitySlider = d3.select("#opacity_nonselected");
  if (!opacitySlider.empty()) {
    d3.select("#opacity_nonselected_value").text(opacitySlider.property("value"));
  }

  d3.select("#color_mode").on("change", updateAll);
  d3.select("#country_highlight").on("change", updateAll);
  d3.select("#size_mode").on("change", updateAll);

  if (!d3.select("#item_color_mode").empty()) {
    d3.select("#item_color_mode").on("change", updateAll);
  }

  if (!d3.select("#item_size_mode").empty()) {
    d3.select("#item_size_mode").on("change", updateAll);
  }

  if (!opacitySlider.empty()) {
    opacitySlider.on("input", function() {
      d3.select("#opacity_nonselected_value").text(+this.value);
      updateAll();
    });
  }

  d3.select("#selected_iteration").on("input", function() {
    d3.select("#selected_iteration_value").text(+this.value);

    if (selectedUserId !== null) {
      renderUserDetails(selectedUserId);
      renderRecommendations(selectedUserId);
    }

    if (selectedItemId !== null) {
      renderItemDetails(selectedItemId);
    }
  });

  if (!d3.select("#group_highlight").empty()) {
    d3.select("#group_highlight").on("change", function() {
      activeGroupName = this.value;
      updateBuilderDeleteButtonState();
      updateAll();
    });
  }

  if (!d3.select("#open_group_builder").empty()) {
    d3.select("#open_group_builder").on("click", openGroupBuilder);
  }

  if (!d3.select("#cancel_group_btn").empty()) {
    d3.select("#cancel_group_btn").on("click", closeGroupBuilder);
  }

  if (!d3.select("#save_group_btn").empty()) {
    d3.select("#save_group_btn").on("click", saveCurrentGroupFromBuilder);
  }

  if (!d3.select("#delete_group_btn").empty()) {
    d3.select("#delete_group_btn").on("click", deleteActiveGroup);
  }

  if (!d3.select("#clear_link_selection").empty()) {
    d3.select("#clear_link_selection").on("click", function() {
      clearLinkedSelection();
      updateAll();
    });
  }

  updateBuilderDeleteButtonState();
  updateLinkStatus();
}

function getAllCountries() {
  return [...new Set(USERS.map(d => d.country).filter(Boolean))].sort((a, b) => d3.ascending(a, b));
}

function populateGroupDropdown() {
  const select = d3.select("#group_highlight");
  if (select.empty()) return;

  select.selectAll("*").remove();

  select.append("option")
    .attr("value", "NONE")
    .text("None");

  Object.keys(COUNTRY_GROUPS)
    .sort((a, b) => d3.ascending(a, b))
    .forEach(name => {
      select.append("option")
        .attr("value", name)
        .text(name);
    });

  if (!(activeGroupName in COUNTRY_GROUPS)) {
    activeGroupName = "NONE";
  }

  select.property("value", activeGroupName);
}

function buildGroupCountryChecklist() {
  const box = d3.select("#group_country_list");
  if (box.empty()) return;

  const countries = getAllCountries();
  box.selectAll("*").remove();

  const rows = box.selectAll(".country-check-row")
    .data(countries)
    .enter()
    .append("label")
    .attr("class", "country-check-row");

  rows.append("input")
    .attr("type", "checkbox")
    .attr("value", d => d);

  rows.append("span")
    .text(d => d);
}

function openGroupBuilder() {
  const builder = d3.select("#group_builder");
  if (builder.empty()) return;

  builder.classed("hidden", false);

  const groupName = activeGroupName !== "NONE" ? activeGroupName : "";
  d3.select("#group_name").property("value", groupName);

  const selectedCountries = activeGroupName !== "NONE" && COUNTRY_GROUPS[activeGroupName]
    ? new Set(COUNTRY_GROUPS[activeGroupName])
    : new Set();

  d3.select("#group_country_list")
    .selectAll('input[type="checkbox"]')
    .property("checked", function() {
      return selectedCountries.has(this.value);
    });

  updateBuilderDeleteButtonState();
}

function closeGroupBuilder() {
  const builder = d3.select("#group_builder");
  if (!builder.empty()) {
    builder.classed("hidden", true);
  }
}

function updateBuilderDeleteButtonState() {
  const btn = d3.select("#delete_group_btn");
  if (btn.empty()) return;

  const deletable = activeGroupName !== "NONE" && !!COUNTRY_GROUPS[activeGroupName];
  btn.property("disabled", !deletable);
}

function getBuilderSelectedCountries() {
  const selected = [];
  const list = d3.select("#group_country_list");
  if (list.empty()) return selected;

  list.selectAll('input[type="checkbox"]')
    .each(function() {
      if (this.checked) selected.push(this.value);
    });

  return selected;
}

function saveCurrentGroupFromBuilder() {
  const nameInput = d3.select("#group_name");
  if (nameInput.empty()) return;

  const name = nameInput.property("value").trim();
  const countries = getBuilderSelectedCountries();

  if (!name) {
    alert("Please provide a group name.");
    return;
  }

  if (!countries.length) {
    alert("Please select at least one country.");
    return;
  }

  COUNTRY_GROUPS[name] = countries.sort((a, b) => d3.ascending(a, b));
  activeGroupName = name;

  saveGroupsToStorage();
  populateGroupDropdown();
  updateBuilderDeleteButtonState();
  closeGroupBuilder();
  updateAll();
}

function deleteActiveGroup() {
  if (activeGroupName === "NONE") return;
  if (!(activeGroupName in COUNTRY_GROUPS)) return;

  delete COUNTRY_GROUPS[activeGroupName];
  activeGroupName = "NONE";

  saveGroupsToStorage();
  populateGroupDropdown();
  updateBuilderDeleteButtonState();
  openGroupBuilder();
  updateAll();
}

// --------------------------------------------------
// brush mode
// --------------------------------------------------
function initBrushKeyboardMode() {
  window.addEventListener("keydown", (event) => {
    if (event.key === "Shift") {
      brushModeActive = true;
      updateBrushInteractivity();
    }
  });

  window.addEventListener("keyup", (event) => {
    if (event.key === "Shift") {
      brushModeActive = false;
      updateBrushInteractivity();
    }
  });

  window.addEventListener("blur", () => {
    brushModeActive = false;
    updateBrushInteractivity();
  });
}

function updateBrushInteractivity() {
  // user brushes
  d3.selectAll(".brush-layer .overlay")
    .style("pointer-events", brushModeActive ? "all" : "none")
    .style("cursor", brushModeActive ? "crosshair" : "default");

  d3.selectAll(".brush-layer .selection")
    .style("pointer-events", "none");

  d3.selectAll(".brush-layer .handle")
    .style("pointer-events", "none");

  // item brushes
  d3.selectAll(".item-brush-layer .overlay")
    .style("pointer-events", brushModeActive ? "all" : "none")
    .style("cursor", brushModeActive ? "crosshair" : "default");

  d3.selectAll(".item-brush-layer .selection")
    .style("pointer-events", "none");

  d3.selectAll(".item-brush-layer .handle")
    .style("pointer-events", "none");
}
// --------------------------------------------------
// scales
// --------------------------------------------------
function buildSharedScales() {
  const xExtent = d3.extent(POSITIONS, d => +d.x);
  const yExtent = d3.extent(POSITIONS, d => +d.y);

  globalX = d3.scaleLinear()
    .domain(padExtent(xExtent, 0.05))
    .range([MARGIN.left, PANEL_W - MARGIN.right]);

  globalY = d3.scaleLinear()
    .domain(padExtent(yExtent, 0.05))
    .range([PANEL_H - MARGIN.bottom, MARGIN.top]);

  const itemXExtent = d3.extent(ITEM_POSITIONS, d => +d.x);
  const itemYExtent = d3.extent(ITEM_POSITIONS, d => +d.y);

  globalItemX = d3.scaleLinear()
    .domain(padExtent(itemXExtent, 0.05))
    .range([MARGIN.left, PANEL_W - MARGIN.right]);

  globalItemY = d3.scaleLinear()
    .domain(padExtent(itemYExtent, 0.05))
    .range([PANEL_H - MARGIN.bottom, MARGIN.top]);
}

function padExtent(ext, frac = 0.05) {
  const [a, b] = ext;
  const d = b - a || 1;
  return [a - d * frac, b + d * frac];
}

// --------------------------------------------------
// layout
// --------------------------------------------------
function buildSmallMultiples() {
  USER_BRUSHES.clear();

  const container = d3.select("#small_multiples");
  container.selectAll("*").remove();

  const cards = container.selectAll(".plot-card")
    .data(iterations)
    .enter()
    .append("div")
    .attr("class", "plot-card");

  cards.append("div")
    .attr("class", "plot-title")
    .text(d => `Iteration ${d}`);

  cards.append("svg")
    .attr("class", "plot-svg")
    .attr("data-iteration", d => d)
    .attr("viewBox", `0 0 ${PANEL_W} ${PANEL_H}`);

  cards.each(function(iteration) {
    const svg = d3.select(this).select("svg");
    svg.append("g").attr("class", "points-layer");
    svg.append("g").attr("class", "brush-layer");

    const brush = d3.brush()
      .filter((event) => brushModeActive && event.shiftKey && event.button === 0)
      .extent([[MARGIN.left, MARGIN.top], [PANEL_W - MARGIN.right, PANEL_H - MARGIN.bottom]])
      .on("end", (event) => handleUserBrush(event, iteration));

    USER_BRUSHES.set(+iteration, brush);
    svg.select(".brush-layer").call(brush);
  });

  updateBrushInteractivity();
}

function buildItemSmallMultiples() {
  ITEM_BRUSHES.clear();

  const container = d3.select("#item_small_multiples");
  if (container.empty()) return;

  container.selectAll("*").remove();

  const cards = container.selectAll(".plot-card")
    .data(iterations)
    .enter()
    .append("div")
    .attr("class", "plot-card");

  cards.append("div")
    .attr("class", "plot-title")
    .text(d => `Iteration ${d}`);

  cards.append("svg")
    .attr("class", "plot-svg")
    .attr("data-item-iteration", d => d)
    .attr("viewBox", `0 0 ${PANEL_W} ${PANEL_H}`);

  cards.each(function(iteration) {
    const svg = d3.select(this).select("svg");
    svg.append("g").attr("class", "item-points-layer");
    svg.append("g").attr("class", "item-brush-layer");

    const brush = d3.brush()
      .filter((event) => brushModeActive && event.shiftKey && event.button === 0)
      .extent([[MARGIN.left, MARGIN.top], [PANEL_W - MARGIN.right, PANEL_H - MARGIN.bottom]])
      .on("end", (event) => handleItemBrush(event, iteration));

    ITEM_BRUSHES.set(+iteration, brush);
    svg.select(".item-brush-layer").call(brush);
  });

  updateBrushInteractivity();
}

// --------------------------------------------------
// update
// --------------------------------------------------
function updateAll() {
  const colorMode = d3.select("#color_mode").property("value");
  const countryHighlight = d3.select("#country_highlight").property("value");
  const sizeMode = d3.select("#size_mode").property("value");
  const contextOpacity = !d3.select("#opacity_nonselected").empty()
    ? +d3.select("#opacity_nonselected").property("value")
    : 0.20;

  const itemColorMode = !d3.select("#item_color_mode").empty()
    ? d3.select("#item_color_mode").property("value")
    : "n_recommended";

  const itemSizeMode = !d3.select("#item_size_mode").empty()
    ? d3.select("#item_size_mode").property("value")
    : "constant";

  const mergedUsers = buildMergedData();
  const mergedItems = buildMergedItemData();

  const userColorScale = buildColorScale(mergedUsers, colorMode);
  const userSizeScale = buildSizeScale(mergedUsers, sizeMode);

  const itemColorScale = buildItemColorScale(mergedItems, itemColorMode);
  const itemSizeScale = buildItemSizeScale(mergedItems, itemSizeMode);

  drawColorbar(userColorScale, colorMode);
  drawItemColorbar(itemColorScale, itemColorMode);

  iterations.forEach(iteration => {
    const userData = mergedUsers.filter(d => +d.iteration === +iteration);
    drawIterationPanel(iteration, userData, userColorScale, userSizeScale, colorMode, countryHighlight, contextOpacity);

    const itemData = mergedItems.filter(d => +d.iteration === +iteration);
    drawItemIterationPanel(iteration, itemData, itemColorScale, itemSizeScale, itemColorMode, contextOpacity);
  });

  if (selectedUserId !== null) {
    renderUserDetails(selectedUserId);
    renderRecommendations(selectedUserId);
  }

  if (selectedItemId !== null) {
    renderItemDetails(selectedItemId);
  }

  updateLinkStatus();
}

// --------------------------------------------------
// merging
// --------------------------------------------------
function buildMergedData() {
  const userMap = new Map(USERS.map(d => [+d.user_id, d]));
  const driftMap = new Map(DRIFT.map(d => [+d.user_id, d]));

  const metricMap = new Map();
  METRICS.forEach(d => {
    metricMap.set(`${+d.user_id}__${+d.iteration}`, d);
  });

  return POSITIONS.map(p => {
    const uid = +p.user_id;
    const it = +p.iteration;
    return {
      ...p,
      ...userMap.get(uid),
      ...driftMap.get(uid),
      ...metricMap.get(`${uid}__${it}`)
    };
  });
}

function buildMergedItemData() {
  const itemMap = new Map(ITEMS.map(d => [+d.item_id, d]));

  const itemMetricMap = new Map();
  ITEM_METRICS.forEach(d => {
    itemMetricMap.set(`${+d.item_id}__${+d.iteration}`, d);
  });

  return ITEM_POSITIONS.map(p => {
    const iid = +p.item_id;
    const it = +p.iteration;
    return {
      ...p,
      ...itemMap.get(iid),
      ...itemMetricMap.get(`${iid}__${it}`)
    };
  });
}

// --------------------------------------------------
// scales / encodings
// --------------------------------------------------
function buildColorScale(data, colorMode) {
  const col = resolveColorColumn(colorMode);
  const vals = data
    .map(d => safeNumber(d[col]))
    .filter(v => Number.isFinite(v));

  const extent = d3.extent(vals.length ? vals : [0, 1]);

  return d3.scaleSequential(d3.interpolateViridis)
    .domain(extent[0] === extent[1] ? [extent[0], extent[0] + 1e-6] : extent);
}

function buildSizeScale(data, sizeMode) {
  if (sizeMode === "constant") {
    return () => 3.6;
  }

  const col = resolveSizeColumn(sizeMode);
  const vals = data
    .map(d => safeNumber(d[col]))
    .filter(v => Number.isFinite(v));

  const extent = d3.extent(vals.length ? vals : [0, 1]);

  return d3.scaleSqrt()
    .domain(extent[0] === extent[1] ? [extent[0], extent[0] + 1e-6] : extent)
    .range([2.5, 7.0]);
}

function buildItemColorScale(data, colorMode) {
  const vals = data
    .map(d => safeNumber(d[colorMode]))
    .filter(v => Number.isFinite(v));

  const extent = d3.extent(vals.length ? vals : [0, 1]);

  return d3.scaleSequential(d3.interpolatePlasma)
    .domain(extent[0] === extent[1] ? [extent[0], extent[0] + 1e-6] : extent);
}

function buildItemSizeScale(data, sizeMode) {
  if (sizeMode === "constant") {
    return () => 3.2;
  }

  const vals = data
    .map(d => safeNumber(d[sizeMode]))
    .filter(v => Number.isFinite(v));

  const extent = d3.extent(vals.length ? vals : [0, 1]);

  return d3.scaleSqrt()
    .domain(extent[0] === extent[1] ? [extent[0], extent[0] + 1e-6] : extent)
    .range([2.0, 7.0]);
}

function resolveColorColumn(mode) {
  if (mode === "drift") {
    const driftKey = Object.keys(DRIFT[0] || {}).find(k => k.startsWith("drift_l2_"));
    return driftKey || "drift";
  }
  return mode;
}

function resolveSizeColumn(mode) {
  if (mode === "drift") {
    const driftKey = Object.keys(DRIFT[0] || {}).find(k => k.startsWith("drift_l2_"));
    return driftKey || "drift";
  }
  return mode;
}

function safeNumber(v) {
  const n = +v;
  return Number.isFinite(n) ? n : NaN;
}

// --------------------------------------------------
// groups
// --------------------------------------------------
function isInActiveGroup(d) {
  if (activeGroupName === "NONE") return false;
  const countries = COUNTRY_GROUPS[activeGroupName] || [];
  return countries.includes(d.country);
}

// --------------------------------------------------
// linking logic
// --------------------------------------------------
function isLinkActive() {
  return selectedUsers.size > 0 || selectedItems.size > 0;
}

function extractRecommendationItemId(r) {
  if (r.item_id !== undefined && r.item_id !== null) return +r.item_id;
  if (r.recommended_item_id !== undefined && r.recommended_item_id !== null) return +r.recommended_item_id;
  if (r.track_id !== undefined && r.track_id !== null) return +r.track_id;
  return null;
}

function linkedItemsFromUsers(userIds, iteration) {
  const out = new Set();
  if (!RECOMMENDATIONS.length) return out;

  RECOMMENDATIONS.forEach(r => {
    if (+r.iteration !== +iteration) return;
    if (!userIds.includes(+r.user_id)) return;

    const itemId = extractRecommendationItemId(r);
    if (itemId !== null) out.add(itemId);
  });

  return out;
}

function linkedUsersFromItems(itemIds, iteration) {
  const out = new Set();
  if (!RECOMMENDATIONS.length) return out;

  RECOMMENDATIONS.forEach(r => {
    if (+r.iteration !== +iteration) return;

    const itemId = extractRecommendationItemId(r);
    if (itemId === null) return;
    if (!itemIds.includes(itemId)) return;

    out.add(+r.user_id);
  });

  return out;
}

function handleUserBrush(event, iteration) {
  if (!event.selection) {
    if (lastBrushSource === "users" && linkIteration === +iteration) {
      clearLinkedSelection();
      updateAll();
    }
    return;
  }

  const [[x0, y0], [x1, y1]] = event.selection;

  const userData = buildMergedData().filter(d => +d.iteration === +iteration);
  const brushedUserIds = userData
    .filter(d => {
      const x = globalX(+d.x);
      const y = globalY(+d.y);
      return x0 <= x && x <= x1 && y0 <= y && y <= y1;
    })
    .map(d => +d.user_id);

  selectedUsers = new Set(brushedUserIds);
  selectedItems = linkedItemsFromUsers(brushedUserIds, iteration);
  linkIteration = +iteration;
  lastBrushSource = "users";

  clearOtherBrushes("users", iteration);
  updateAll();
}

function handleItemBrush(event, iteration) {
  if (!event.selection) {
    if (lastBrushSource === "items" && linkIteration === +iteration) {
      clearLinkedSelection();
      updateAll();
    }
    return;
  }

  const [[x0, y0], [x1, y1]] = event.selection;

  const itemData = buildMergedItemData().filter(d => +d.iteration === +iteration);
  const brushedItemIds = itemData
    .filter(d => {
      const x = globalItemX(+d.x);
      const y = globalItemY(+d.y);
      return x0 <= x && x <= x1 && y0 <= y && y <= y1;
    })
    .map(d => +d.item_id);

  selectedItems = new Set(brushedItemIds);
  selectedUsers = linkedUsersFromItems(brushedItemIds, iteration);
  linkIteration = +iteration;
  lastBrushSource = "items";

  clearOtherBrushes("items", iteration);
  updateAll();
}

function clearOtherBrushes(source, keepIteration) {
  if (source === "users") {
    ITEM_BRUSHES.forEach((brush, iteration) => {
      const svg = d3.select(`svg[data-item-iteration="${iteration}"]`);
      if (!svg.empty()) {
        svg.select(".item-brush-layer").call(brush.move, null);
      }
    });

    USER_BRUSHES.forEach((brush, iteration) => {
      if (+iteration === +keepIteration) return;
      const svg = d3.select(`svg[data-iteration="${iteration}"]`);
      if (!svg.empty()) {
        svg.select(".brush-layer").call(brush.move, null);
      }
    });
  } else if (source === "items") {
    USER_BRUSHES.forEach((brush, iteration) => {
      const svg = d3.select(`svg[data-iteration="${iteration}"]`);
      if (!svg.empty()) {
        svg.select(".brush-layer").call(brush.move, null);
      }
    });

    ITEM_BRUSHES.forEach((brush, iteration) => {
      if (+iteration === +keepIteration) return;
      const svg = d3.select(`svg[data-item-iteration="${iteration}"]`);
      if (!svg.empty()) {
        svg.select(".item-brush-layer").call(brush.move, null);
      }
    });
  }
}

function clearLinkedSelection() {
  selectedUsers = new Set();
  selectedItems = new Set();
  linkIteration = null;
  lastBrushSource = null;

  USER_BRUSHES.forEach((brush, iteration) => {
    const svg = d3.select(`svg[data-iteration="${iteration}"]`);
    if (!svg.empty()) {
      svg.select(".brush-layer").call(brush.move, null);
    }
  });

  ITEM_BRUSHES.forEach((brush, iteration) => {
    const svg = d3.select(`svg[data-item-iteration="${iteration}"]`);
    if (!svg.empty()) {
      svg.select(".item-brush-layer").call(brush.move, null);
    }
  });
}

// --------------------------------------------------
// user drawing
// --------------------------------------------------
function drawIterationPanel(iteration, data, colorScale, sizeScale, colorMode, countryHighlight, contextOpacity) {
  const svg = d3.select(`svg[data-iteration="${iteration}"]`);
  const layer = svg.select(".points-layer");

  const colorCol = resolveColorColumn(colorMode);
  const sizeCol = resolveSizeColumn(d3.select("#size_mode").property("value"));

  const sel = layer.selectAll("circle")
    .data(data, d => +d.user_id);

  sel.enter()
    .append("circle")
    .merge(sel)
    .attr("cx", d => globalX(+d.x))
    .attr("cy", d => globalY(+d.y))
    .attr("r", d => sizeScale(safeNumber(d[sizeCol]) || 0))
    .attr("fill", d => colorScale(safeNumber(d[colorCol]) || 0))
    .attr("opacity", d => {
      if (isLinkActive()) {
        return selectedUsers.has(+d.user_id) ? 0.98 : contextOpacity;
      }

      if (countryHighlight === "ALL" && activeGroupName === "NONE") return 0.82;

      const inCountry = d.country === countryHighlight;
      const inGroup = isInActiveGroup(d);

      return (inCountry || inGroup) ? 0.95 : contextOpacity;
    })
    .attr("stroke", d => {
      const inCountry = d.country === countryHighlight;
      const inGroup = isInActiveGroup(d);

      if (selectedUserId !== null && +d.user_id === +selectedUserId) return "#111111";
      if (isLinkActive() && selectedUsers.has(+d.user_id)) return "#111111";
      if (!isLinkActive() && (inCountry || inGroup)) return "#111111";
      return "none";
    })
    .attr("stroke-width", d => {
      const inCountry = d.country === countryHighlight;
      const inGroup = isInActiveGroup(d);

      if (selectedUserId !== null && +d.user_id === +selectedUserId) return 1.8;
      if (isLinkActive() && selectedUsers.has(+d.user_id)) return 1.4;
      if (!isLinkActive() && (inCountry || inGroup)) return 1.1;
      return 0;
    })
    .on("mouseover", function(event, d) {
      tooltip.style("opacity", 1)
        .html(buildTooltipHtml(d, colorCol))
        .style("left", `${event.pageX + 10}px`)
        .style("top", `${event.pageY + 10}px`);
    })
    .on("mouseout", function() {
      tooltip.style("opacity", 0);
    })
    .on("click", function(event, d) {
      selectedUserId = +d.user_id;
      renderUserDetails(selectedUserId);
      renderRecommendations(selectedUserId);
      updateAll();
    });

  sel.exit().remove();
}

function buildTooltipHtml(d, colorCol) {
  const groupNames = Object.entries(COUNTRY_GROUPS)
    .filter(([_, countries]) => countries.includes(d.country))
    .map(([name]) => name);

  return `
    <div><b>User ${d.user_id}</b></div>
    <div>Country: ${d.country ?? "-"}</div>
    <div>Activity: ${fmt(d.n_input_interactions)}</div>
    <div>${prettyLabel(colorCol)}: ${fmt(d[colorCol])}</div>
    <div>Groups: ${groupNames.length ? groupNames.join(", ") : "-"}</div>
  `;
}

// --------------------------------------------------
// item drawing
// --------------------------------------------------
function drawItemIterationPanel(iteration, data, colorScale, sizeScale, colorMode, contextOpacity) {
  const svg = d3.select(`svg[data-item-iteration="${iteration}"]`);
  if (svg.empty()) return;

  const layer = svg.select(".item-points-layer");

  const sizeMode = !d3.select("#item_size_mode").empty()
    ? d3.select("#item_size_mode").property("value")
    : "constant";

  const sel = layer.selectAll("circle")
    .data(data, d => +d.item_id);

  sel.enter()
    .append("circle")
    .merge(sel)
    .attr("cx", d => globalItemX(+d.x))
    .attr("cy", d => globalItemY(+d.y))
    .attr("r", d => sizeScale(safeNumber(d[sizeMode]) || 0))
    .attr("fill", d => colorScale(safeNumber(d[colorMode]) || 0))
    .attr("opacity", d => {
      if (isLinkActive()) {
        return selectedItems.has(+d.item_id) ? 0.98 : contextOpacity;
      }
      return 0.82;
    })
    .attr("stroke", d => {
      if (selectedItemId !== null && +d.item_id === +selectedItemId) return "#111111";
      if (isLinkActive() && selectedItems.has(+d.item_id)) return "#111111";
      return "none";
    })
    .attr("stroke-width", d => {
      if (selectedItemId !== null && +d.item_id === +selectedItemId) return 1.8;
      if (isLinkActive() && selectedItems.has(+d.item_id)) return 1.4;
      return 0;
    })
    .on("mouseover", function(event, d) {
      tooltip.style("opacity", 1)
        .html(`
          <div><b>Item ${d.item_id}</b></div>
          <div>Artist: ${d.artist ?? "-"}</div>
          <div>Title: ${d.title ?? "-"}</div>
          <div>Country: ${d.artist_country ?? "-"}</div>
          <div>${prettyItemLabel(colorMode)}: ${fmt(d[colorMode])}</div>
        `)
        .style("left", `${event.pageX + 10}px`)
        .style("top", `${event.pageY + 10}px`);
    })
    .on("mouseout", function() {
      tooltip.style("opacity", 0);
    })
    .on("click", function(event, d) {
      selectedItemId = +d.item_id;
      renderItemDetails(selectedItemId);
      updateAll();
    });

  sel.exit().remove();
}

// --------------------------------------------------
// right panel
// --------------------------------------------------
function renderUserDetails(userId) {
  const user = USERS.find(d => +d.user_id === +userId) || {};
  const drift = DRIFT.find(d => +d.user_id === +userId) || {};
  const inspectionIteration = +d3.select("#selected_iteration").property("value");
  const metric = METRICS.find(d => +d.user_id === +userId && +d.iteration === inspectionIteration) || {};

  const driftKey = Object.keys(drift).find(k => k.startsWith("drift_l2_"));
  const cosKey = Object.keys(drift).find(k => k.startsWith("cosine_similarity_"));

  const groupNames = Object.entries(COUNTRY_GROUPS)
    .filter(([_, countries]) => countries.includes(user.country))
    .map(([name]) => name);

  d3.select("#details").html(`
    <div><b>User ${userId}</b></div>
    <div>Country: ${user.country ?? "-"}</div>
    <div>Groups: ${groupNames.length ? groupNames.join(", ") : "-"}</div>
    <div>Gender: ${user.gender ?? "-"}</div>
    <div>Age: ${user.age ?? "-"}</div>
    <div>Activity: ${fmt(user.n_input_interactions)}</div>
    <div>NDCG@10: ${fmt(user.ndcg_at_10)}</div>
    <div>Drift: ${driftKey ? fmt(drift[driftKey]) : "-"}</div>
    <div>Cosine similarity: ${cosKey ? fmt(drift[cosKey]) : "-"}</div>
    <div>Inspection iteration: ${inspectionIteration}</div>
    <div>US proportion: ${fmt(metric.us_proportion)}</div>
    <div>Local proportion: ${fmt(metric.local_proportion)}</div>
    <div>Popularity bias: ${fmt(metric.bin_jsd)}</div>
  `);

  drawTimeline(userId);
}

function drawTimeline(userId) {
  const svg = d3.select("#timeline");
  svg.selectAll("*").remove();

  const W = 300;
  const H = 190;
  const m = { top: 12, right: 16, bottom: 28, left: 38 };

  const data = METRICS
    .filter(d => +d.user_id === +userId)
    .sort((a, b) => +a.iteration - +b.iteration);

  if (!data.length) {
    svg.append("text")
      .attr("x", 16)
      .attr("y", 24)
      .text("No temporal metrics available.");
    return;
  }

  const inspectionMetric = d3.select("#color_mode").property("value");
  const yCol = inspectionMetric === "drift" ? "us_proportion" : inspectionMetric;

  const x = d3.scaleLinear()
    .domain(d3.extent(data, d => +d.iteration))
    .range([m.left, W - m.right]);

  const vals = data.map(d => safeNumber(d[yCol])).filter(v => Number.isFinite(v));
  const yExtent = vals.length ? d3.extent(vals) : [0, 1];
  const y = d3.scaleLinear()
    .domain(padExtent(yExtent, 0.1))
    .range([H - m.bottom, m.top]);

  const line = d3.line()
    .x(d => x(+d.iteration))
    .y(d => y(safeNumber(d[yCol]) || 0));

  svg.append("g")
    .attr("class", "timeline-axis")
    .attr("transform", `translate(0,${H - m.bottom})`)
    .call(d3.axisBottom(x).ticks(data.length).tickFormat(d3.format("d")));

  svg.append("g")
    .attr("class", "timeline-axis")
    .attr("transform", `translate(${m.left},0)`)
    .call(d3.axisLeft(y).ticks(4));

  svg.append("text")
    .attr("x", W / 2)
    .attr("y", H - 4)
    .attr("text-anchor", "middle")
    .attr("class", "timeline-label")
    .text("Iteration");

  svg.append("text")
    .attr("transform", `translate(12,${H / 2}) rotate(-90)`)
    .attr("text-anchor", "middle")
    .attr("class", "timeline-label")
    .text(prettyLabel(yCol));

  svg.append("path")
    .datum(data)
    .attr("fill", "none")
    .attr("stroke", "#1f2937")
    .attr("stroke-width", 2)
    .attr("d", line);

  svg.selectAll(".timeline-point")
    .data(data)
    .enter()
    .append("circle")
    .attr("class", "timeline-point")
    .attr("cx", d => x(+d.iteration))
    .attr("cy", d => y(safeNumber(d[yCol]) || 0))
    .attr("r", 3.4)
    .attr("fill", "#111827");
}

function renderRecommendations(userId) {
  const box = d3.select("#recommendations");
  const inspectionIteration = +d3.select("#selected_iteration").property("value");

  if (!RECOMMENDATIONS.length) {
    box.text("No recommendation export loaded.");
    return;
  }

  const recs = RECOMMENDATIONS
    .filter(d => +d.user_id === +userId && +d.iteration === inspectionIteration)
    .sort((a, b) => (+a.rank || 9999) - (+b.rank || 9999));

  if (!recs.length) {
    box.text("No recommendations for selected user/iteration.");
    return;
  }

  box.html("");
  recs.forEach(r => {
    box.append("div")
      .attr("class", "rec-item")
      .html(`
        <span class="rec-rank">#${r.rank ?? "-"}</span>
        ${r.title ?? "unknown title"}<br>
        <span>${r.artist ?? "-"}</span><br>
        <span>Country: ${r.artist_country ?? "-"}</span>
        ${r.accepted ? "<br><b>Accepted</b>" : ""}
      `);
  });
}

function renderItemDetails(itemId) {
  const box = d3.select("#item_details");
  if (box.empty()) return;

  const item = ITEMS.find(d => +d.item_id === +itemId) || {};
  const inspectionIteration = +d3.select("#selected_iteration").property("value");
  const metric = ITEM_METRICS.find(d => +d.item_id === +itemId && +d.iteration === inspectionIteration) || {};

  box.html(`
    <div><b>Item ${itemId}</b></div>
    <div>Artist: ${item.artist ?? "-"}</div>
    <div>Title: ${item.title ?? "-"}</div>
    <div>Artist country: ${item.artist_country ?? "-"}</div>
    <div>Artist gender: ${item.artist_gender ?? "-"}</div>
    <div>Interactions: ${fmt(item.n_input_interactions)}</div>
    <div>Inspection iteration: ${inspectionIteration}</div>
    <div>Recommended: ${fmt(metric.n_recommended)}</div>
    <div>Accepted: ${fmt(metric.n_accepted)}</div>
  `);
}

// --------------------------------------------------
// colorbars
// --------------------------------------------------
function drawColorbar(colorScale, colorMode) {
  const svg = d3.select("#colorbar");
  svg.selectAll("*").remove();

  const x0 = 10;
  const y0 = 16;
  const bw = 150;
  const bh = 10;

  const defs = svg.append("defs");
  const grad = defs.append("linearGradient")
    .attr("id", "cb-grad")
    .attr("x1", "0%")
    .attr("x2", "100%");

  d3.range(0, 1.01, 0.05).forEach(t => {
    grad.append("stop")
      .attr("offset", `${t * 100}%`)
      .attr("stop-color", colorScale(colorScale.domain()[0] + t * (colorScale.domain()[1] - colorScale.domain()[0])));
  });

  svg.append("rect")
    .attr("x", x0)
    .attr("y", y0)
    .attr("width", bw)
    .attr("height", bh)
    .attr("rx", 2)
    .attr("fill", "url(#cb-grad)")
    .attr("stroke", "#d4d8de");

  const x = d3.scaleLinear()
    .domain(colorScale.domain())
    .range([x0, x0 + bw]);

  svg.append("g")
    .attr("transform", `translate(0,${y0 + bh})`)
    .call(d3.axisBottom(x).ticks(4))
    .selectAll("text")
    .style("font-size", "10px")
    .style("fill", "#6b7280");

  svg.append("text")
    .attr("x", x0)
    .attr("y", 10)
    .attr("font-size", 11)
    .attr("font-weight", 500)
    .attr("fill", "#374151")
    .text(prettyLabel(resolveColorColumn(colorMode)));
}

function drawItemColorbar(colorScale, colorMode) {
  const svg = d3.select("#item_colorbar");
  if (svg.empty()) return;

  svg.selectAll("*").remove();

  const x0 = 10;
  const y0 = 16;
  const bw = 150;
  const bh = 10;

  const defs = svg.append("defs");
  const grad = defs.append("linearGradient")
    .attr("id", "item-cb-grad")
    .attr("x1", "0%")
    .attr("x2", "100%");

  d3.range(0, 1.01, 0.05).forEach(t => {
    grad.append("stop")
      .attr("offset", `${t * 100}%`)
      .attr("stop-color", colorScale(colorScale.domain()[0] + t * (colorScale.domain()[1] - colorScale.domain()[0])));
  });

  svg.append("rect")
    .attr("x", x0)
    .attr("y", y0)
    .attr("width", bw)
    .attr("height", bh)
    .attr("rx", 2)
    .attr("fill", "url(#item-cb-grad)")
    .attr("stroke", "#d4d8de");

  const x = d3.scaleLinear()
    .domain(colorScale.domain())
    .range([x0, x0 + bw]);

  svg.append("g")
    .attr("transform", `translate(0,${y0 + bh})`)
    .call(d3.axisBottom(x).ticks(4))
    .selectAll("text")
    .style("font-size", "10px")
    .style("fill", "#6b7280");

  svg.append("text")
    .attr("x", x0)
    .attr("y", 10)
    .attr("font-size", 11)
    .attr("font-weight", 500)
    .attr("fill", "#374151")
    .text(prettyItemLabel(colorMode));
}

// --------------------------------------------------
// linked selection status
// --------------------------------------------------
function updateLinkStatus() {
  const box = d3.select("#link_status");
  if (box.empty()) return;

  if (!isLinkActive()) {
    box.html("No active linked brush. Hold Shift and drag to brush.");
    return;
  }

  box.html(`
    <div><b>Linked selection</b></div>
    <div>Source: ${lastBrushSource ?? "-"}</div>
    <div>Origin iteration: ${linkIteration}</div>
    <div>Users: ${selectedUsers.size}</div>
    <div>Items: ${selectedItems.size}</div>
    <div>Propagation: highlighted across all iterations</div>
  `);
}

// --------------------------------------------------
// labels / formatting
// --------------------------------------------------
function prettyLabel(key) {
  const map = {
    drift: "Drift",
    us_proportion: "US proportion",
    local_proportion: "Local proportion",
    bin_jsd: "Popularity bias",
    n_input_interactions: "Activity",
    ndcg_at_10: "NDCG@10"
  };
  return map[key] || key;
}

function prettyItemLabel(key) {
  const map = {
    n_recommended: "Recommended count",
    n_accepted: "Accepted count",
    n_input_interactions: "Item interactions"
  };
  return map[key] || key;
}

function fmt(v) {
  const n = +v;
  return Number.isFinite(n) ? n.toFixed(3) : "-";
}