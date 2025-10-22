/**
 * Charts module responsible for lazy-loading Chart.js and rendering visuals.
 */

const BUCKET_COLORS = {
  Necessities: "#34C759",
  Leisure: "#FF9500",
  Savings: "#5AC8FA",
  Uncategorized: "#8E8E93",
};

let ChartCtor = null;
let loadPromise = null;
let donutChart = null;
let categoryChart = null;
let elements = null;

function ensureElements() {
  if (elements) return elements;
  const container = document.getElementById("dashboardCharts");
  if (!container) {
    elements = null;
    return null;
  }

  container.innerHTML = `
    <section class="chart-card" data-chart="bucket">
      <div class="panel-heading">
        <h3>Bucket mix</h3>
      </div>
      <div class="chart-card__canvas">
        <canvas aria-label="Current month spending by bucket"></canvas>
        <p class="chart-card__empty" hidden>No spending yet this month.</p>
      </div>
    </section>
    <section class="chart-card" data-chart="category">
      <div class="panel-heading">
        <h3>Spending by category</h3>
      </div>
      <div class="chart-card__canvas">
        <canvas aria-label="Current month spending by category"></canvas>
        <p class="chart-card__empty" hidden>No category spending yet.</p>
      </div>
    </section>
  `;

  const [bucketCard, categoryCard] = container.querySelectorAll(".chart-card");
  elements = {
    container,
    bucketCard,
    bucketCanvas: bucketCard.querySelector("canvas"),
    bucketEmpty: bucketCard.querySelector(".chart-card__empty"),
    categoryCard,
    categoryCanvas: categoryCard.querySelector("canvas"),
    categoryEmpty: categoryCard.querySelector(".chart-card__empty"),
  };
  return elements;
}

function ensureFormatter(settings) {
  try {
    return new Intl.NumberFormat(settings.locale || "en-US", {
      style: "currency",
      currency: settings.currency || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch (error) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}

async function ensureChartJs() {
  if (ChartCtor) return ChartCtor;
  if (!loadPromise) {
    loadPromise = import(
      "https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"
    ).then((module) => module.Chart);
  }
  ChartCtor = await loadPromise;
  return ChartCtor;
}

const Charts = {
  init() {
    ensureElements();
  },

  async updateDashboard({ totals, categories, settings }) {
    const els = ensureElements();
    if (!els) return;

    const formatter = ensureFormatter(settings || {});
    await ensureChartJs();

    this.renderBucketChart(totals, formatter);
    this.renderCategoryChart(categories, formatter, settings);
  },

  renderBucketChart(totals, formatter) {
    const els = elements;
    if (!els) return;
    const bucketData = Object.entries(totals.buckets || {}).filter(
      ([, data]) => data.spent_cents > 0
    );

    if (!bucketData.length) {
      els.bucketEmpty.hidden = false;
      els.bucketCanvas.hidden = true;
      if (donutChart) {
        donutChart.destroy();
        donutChart = null;
      }
      return;
    }

    els.bucketEmpty.hidden = true;
    els.bucketCanvas.hidden = false;

    const labels = bucketData.map(([bucket]) => bucket);
    const values = bucketData.map(([, data]) => data.spent_cents / 100);
    const backgroundColor = labels.map(
      (bucket) => BUCKET_COLORS[bucket] || "#8E8E93"
    );

    const data = {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor,
          borderWidth: 0,
        },
      ],
    };

    if (!donutChart) {
      donutChart = new ChartCtor(els.bucketCanvas.getContext("2d"), {
        type: "doughnut",
        data,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "65%",
          plugins: {
            legend: {
              position: "bottom",
              labels: {
                usePointStyle: true,
              },
            },
            tooltip: {
              callbacks: {
                label(context) {
                  const label = context.label || "";
                  const value =
                    typeof context.parsed === "number" ? context.parsed : 0;
                  return `${label}: ${formatter.format(value)}`;
                },
              },
            },
          },
        },
      });
    } else {
      donutChart.data = data;
      donutChart.update();
    }
  },

  renderCategoryChart(categories, formatter, settings) {
    const els = elements;
    if (!els) return;

    const shouldShow =
      Boolean(settings?.showAdvancedCharts) &&
      Array.isArray(categories) &&
      categories.length > 0;

    if (!shouldShow) {
      els.categoryCard.classList.add("chart-card--hidden");
      if (categoryChart) {
        categoryChart.destroy();
        categoryChart = null;
      }
      return;
    }

    els.categoryCard.classList.remove("chart-card--hidden");
    const visibleCategories = categories.filter(
      (entry) => entry.spent_cents > 0
    );

    if (!visibleCategories.length) {
      els.categoryEmpty.hidden = false;
      els.categoryCanvas.hidden = true;
      if (categoryChart) {
        categoryChart.destroy();
        categoryChart = null;
      }
      return;
    }

    els.categoryEmpty.hidden = true;
    els.categoryCanvas.hidden = false;

    const labels = visibleCategories.map((entry) => {
      const label = entry.name || "Uncategorized";
      return label.length > 12 ? `${label.slice(0, 11)}…` : label;
    });
    const values = visibleCategories.map(
      (entry) => entry.spent_cents / 100
    );
    const backgroundColor = visibleCategories.map((entry) =>
      BUCKET_COLORS[entry.bucket] || "#8E8E93"
    );

    const data = {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor,
          borderRadius: 6,
          barThickness: 20,
        },
      ],
    };

    const options = {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: {
            callback(value) {
              return formatter.format(Number(value));
            },
          },
          grid: {
            color: "rgba(142, 142, 147, 0.2)",
          },
        },
        y: {
          grid: {
            display: false,
          },
          ticks: {
            color: "inherit",
          },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            label(context) {
              const label = context.label || "";
              const value =
                typeof context.parsed.x === "number"
                  ? context.parsed.x
                  : context.parsed;
              return `${label}: ${formatter.format(value)}`;
            },
          },
        },
      },
    };

    if (!categoryChart) {
      categoryChart = new ChartCtor(els.categoryCanvas.getContext("2d"), {
        type: "bar",
        data,
        options,
      });
    } else {
      categoryChart.data = data;
      categoryChart.options = options;
      categoryChart.update();
    }
  },
};

export { Charts };
