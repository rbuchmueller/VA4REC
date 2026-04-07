const width = 800;
const height = 600;

const svg = d3.select("#plot")
  .attr("viewBox", `0 0 ${width} ${height}`);

const tooltip = d3.select("body")
  .append("div")
  .attr("class", "tooltip")
  .style("opacity", 0);

let USERS, POSITIONS, METRICS, DRIFT;

Promise.all([
  d3.json("data/users.json"),
  d3.json("data/user_positions_pca.json"),
  d3.json("data/user_metrics.json"),
  d3.json("data/user_drift.json"),
]).then(([users, positions, metrics, drift]) => {
  USERS = users;
  POSITIONS = positions;
  METRICS = metrics;
  DRIFT = drift;

  initCountryFilter();
  draw(1);
});

function initCountryFilter() {
  const countries = [...new Set(USERS.map(d => d.country).filter(d => d))];

  const sel = d3.select("#country_filter");

  countries.forEach(c => {
    sel.append("option").attr("value", c).text(c);
  });
}

function draw(iteration) {

  d3.select("#iter_val").text(iteration);

  const countryFilter = d3.select("#country_filter").property("value");
  const colorMode = d3.select("#color_mode").property("value");

  const pos = POSITIONS.filter(d => d.iteration === iteration);

  const metricMap = new Map();
  METRICS
    .filter(d => d.iteration === iteration)
    .forEach(d => metricMap.set(d.user_id, d));

  const driftMap = new Map();
  DRIFT.forEach(d => driftMap.set(d.user_id, d));

  const data = pos.map(p => {
    const m = metricMap.get(p.user_id) || {};
    const d = driftMap.get(p.user_id) || {};
    const u = USERS.find(x => x.user_id === p.user_id) || {};

    return { ...p, ...m, ...d, ...u };
  });

  const filtered = countryFilter === "ALL"
    ? data
    : data.filter(d => d.country === countryFilter);

  const x = d3.scaleLinear()
    .domain(d3.extent(filtered, d => d.x))
    .range([40, width - 40]);

  const y = d3.scaleLinear()
    .domain(d3.extent(filtered, d => d.y))
    .range([height - 40, 40]);

  const color = d3.scaleSequential(d3.interpolateViridis)
    .domain(d3.extent(filtered, d => d[colorMode] || 0));

  const sel = svg.selectAll("circle")
    .data(filtered, d => d.user_id);

  sel.enter()
    .append("circle")
    .merge(sel)
    .attr("cx", d => x(d.x))
    .attr("cy", d => y(d.y))
    .attr("r", 4)
    .attr("fill", d => color(d[colorMode] || 0))
    .attr("opacity", 0.85)

    .on("mouseover", (event, d) => {
      tooltip.style("opacity", 1)
        .html(`
          user: ${d.user_id}<br>
          country: ${d.country || "-"}<br>
          drift: ${d.drift_l2_1_to_5?.toFixed(3)}
        `)
        .style("left", (event.pageX + 5) + "px")
        .style("top", (event.pageY + 5) + "px");
    })

    .on("mouseout", () => tooltip.style("opacity", 0))

    .on("click", (event, d) => showDetails(d.user_id));

  sel.exit().remove();
}

function showDetails(userId) {

  const user = USERS.find(d => d.user_id === userId) || {};
  const drift = DRIFT.find(d => d.user_id === userId) || {};

  d3.select("#details").html(`
    <b>User ${userId}</b><br>
    Country: ${user.country || "-"}<br>
    Activity: ${user.n_input_interactions || "-"}<br>
    Drift: ${drift.drift_l2_1_to_5?.toFixed(3)}
  `);

  drawTimeline(userId);
}

function drawTimeline(userId) {

  const svg = d3.select("#timeline");
  svg.selectAll("*").remove();

  const data = METRICS
    .filter(d => d.user_id === userId)
    .sort((a,b) => a.iteration - b.iteration);

  const x = d3.scaleLinear()
    .domain(d3.extent(data, d => d.iteration))
    .range([20, 230]);

  const y = d3.scaleLinear()
    .domain([0, 1])
    .range([130, 10]);

  const line = d3.line()
    .x(d => x(d.iteration))
    .y(d => y(d.us_proportion || 0));

  svg.append("path")
    .datum(data)
    .attr("fill", "none")
    .attr("stroke", "#333")
    .attr("stroke-width", 2)
    .attr("d", line);
}

d3.select("#iter").on("input", function() {
  draw(+this.value);
});

d3.select("#color_mode").on("change", function() {
  draw(+d3.select("#iter").property("value"));
});

d3.select("#country_filter").on("change", function() {
  draw(+d3.select("#iter").property("value"));
});