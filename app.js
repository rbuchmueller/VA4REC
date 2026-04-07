const width = 800;
const height = 600;

const svg = d3.select("#plot");

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

  draw(1);
});

function draw(iteration) {
  d3.select("#iter_val").text(iteration);

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
    return {
      ...p,
      ...m,
      ...d
    };
  });

  const x = d3.scaleLinear()
    .domain(d3.extent(data, d => d.x))
    .range([40, width - 40]);

  const y = d3.scaleLinear()
    .domain(d3.extent(data, d => d.y))
    .range([height - 40, 40]);

  const colorMode = d3.select("#color_mode").property("value");

  const values = data.map(d => d[colorMode] || 0);
  const color = d3.scaleSequential(d3.interpolateViridis)
    .domain(d3.extent(values));

  const sel = svg.selectAll("circle")
    .data(data, d => d.user_id);

  sel.enter()
    .append("circle")
    .merge(sel)
    .attr("cx", d => x(d.x))
    .attr("cy", d => y(d.y))
    .attr("r", 4)
    .attr("fill", d => color(d[colorMode] || 0))
    .attr("opacity", 0.8);

  sel.exit().remove();
}

d3.select("#iter").on("input", function() {
  draw(+this.value);
});

d3.select("#color_mode").on("change", function() {
  const iter = +d3.select("#iter").property("value");
  draw(iter);
});