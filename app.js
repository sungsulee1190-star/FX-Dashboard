/**
 * FX Dashboard - Main Application Engine & Data Layer
 * Step 3: Interactive Chart.js Line Charts, AUD Competitor Comparison Overlay, Overview Sparklines & Time Scale Controls
 */

// Global App Configuration
const CONFIG = {
  FRANKFURTER_BASE: 'https://api.frankfurter.dev/v1',
  OPEN_ER_API_BASE: 'https://open.er-api.com/v6/latest/USD',
  CACHE_PREFIX: 'fx_cache_v1_',
  TTL: {
    RECENT: 6 * 60 * 60 * 1000,      // 6 Hours
    HISTORICAL: 30 * 24 * 60 * 60 * 1000, // 30 Days
    LIVE_RUB: 12 * 60 * 60 * 1000     // 12 Hours
  }
};

/**
 * Chart Registry to prevent canvas reuse bugs
 */
const ChartManager = {
  instances: {},

  get(canvasId) {
    return this.instances[canvasId];
  },

  destroy(canvasId) {
    if (this.instances[canvasId]) {
      this.instances[canvasId].destroy();
      delete this.instances[canvasId];
    }
  },

  register(canvasId, chartInstance) {
    this.destroy(canvasId);
    this.instances[canvasId] = chartInstance;
  }
};

/**
 * FX Data Service - Fetching, Caching, and Analytics
 */
const FXDataService = {

  async fetchLatestRates() {
    const cacheKey = `${CONFIG.CACHE_PREFIX}latest`;
    const cached = this.getCache(cacheKey, CONFIG.TTL.RECENT);
    if (cached) return cached;

    try {
      const res = await fetch(`${CONFIG.FRANKFURTER_BASE}/latest?from=USD&to=AUD,INR,JPY,EUR,GBP`);
      if (!res.ok) throw new Error(`Frankfurter API error: ${res.status}`);
      const data = await res.json();
      
      const rates = { ...data.rates, USD: 1.0 };

      try {
        const rubRes = await fetch(CONFIG.OPEN_ER_API_BASE);
        if (rubRes.ok) {
          const rubData = await rubRes.json();
          if (rubData && rubData.rates && rubData.rates.RUB) {
            rates.RUB = rubData.rates.RUB;
            rates._rubSource = 'Open ExchangeRate API (Live)';
          }
        }
      } catch (rubErr) {
        rates.RUB = 81.77;
        rates._rubSource = 'Static Fallback';
      }

      const result = {
        date: data.date,
        rates: rates,
        timestamp: Date.now()
      };

      this.setCache(cacheKey, result);
      return result;

    } catch (err) {
      console.error('Error fetching latest rates:', err);
      return {
        date: new Date().toISOString().split('T')[0],
        rates: { AUD: 1.418, INR: 83.4, JPY: 157.9, EUR: 0.866, GBP: 0.742, RUB: 81.77, USD: 1.0 },
        isOfflineFallback: true
      };
    }
  },

  async fetchHistoricalSeries(currency, startDate, endDate) {
    const cacheKey = `${CONFIG.CACHE_PREFIX}hist_${currency}_${startDate}_${endDate}`;
    const isOld = new Date(endDate) < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const ttl = isOld ? CONFIG.TTL.HISTORICAL : CONFIG.TTL.RECENT;
    
    const cached = this.getCache(cacheKey, ttl);
    if (cached) return cached;

    try {
      let endpoint;
      if (currency === 'RUB') {
        endpoint = `${CONFIG.FRANKFURTER_BASE}/1999-01-04..2022-03-01?from=USD&to=RUB`;
      } else {
        endpoint = `${CONFIG.FRANKFURTER_BASE}/${startDate}..${endDate}?from=USD&to=${currency}`;
      }

      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(`API fetch error ${res.status}`);
      const data = await res.json();

      const dailyRates = {};
      if (data.rates) {
        Object.keys(data.rates).sort().forEach(date => {
          dailyRates[date] = data.rates[date][currency] || data.rates[date].RUB;
        });
      }

      const result = { currency, startDate, endDate, dailyRates };
      this.setCache(cacheKey, result);
      return result;

    } catch (err) {
      console.error(`Error fetching history for ${currency}:`, err);
      return { currency, startDate, endDate, dailyRates: {} };
    }
  },

  async fetchEurAudComparison(startDate, endDate) {
    const cacheKey = `${CONFIG.CACHE_PREFIX}comp_aud_${startDate}_${endDate}`;
    const cached = this.getCache(cacheKey, CONFIG.TTL.RECENT);
    if (cached) return cached;

    try {
      const [usdRes, eurRes] = await Promise.all([
        fetch(`${CONFIG.FRANKFURTER_BASE}/${startDate}..${endDate}?from=USD&to=AUD`),
        fetch(`${CONFIG.FRANKFURTER_BASE}/${startDate}..${endDate}?from=EUR&to=AUD`)
      ]);

      const usdData = await usdRes.json();
      const eurData = await eurRes.json();

      const combined = {};
      if (usdData.rates) {
        Object.keys(usdData.rates).forEach(d => {
          combined[d] = {
            usdAud: usdData.rates[d].AUD,
            eurAud: eurData.rates[d] ? eurData.rates[d].AUD : null
          };
        });
      }

      this.setCache(cacheKey, combined);
      return combined;
    } catch (err) {
      console.error('Error fetching EUR/AUD comparison data:', err);
      return {};
    }
  },

  calculateMonthlyAverages(dailyRates) {
    const monthlyGroups = {};
    Object.entries(dailyRates).forEach(([dateStr, rate]) => {
      const yearMonth = dateStr.substring(0, 7);
      if (!monthlyGroups[yearMonth]) monthlyGroups[yearMonth] = [];
      monthlyGroups[yearMonth].push(rate);
    });

    const yearlyData = {};
    Object.entries(monthlyGroups).forEach(([ym, rates]) => {
      const [year, month] = ym.split('-');
      const monthAvg = rates.reduce((sum, r) => sum + r, 0) / rates.length;

      if (!yearlyData[year]) yearlyData[year] = { months: {}, allRates: [] };
      yearlyData[year].months[month] = monthAvg;
      yearlyData[year].allRates.push(...rates);
    });

    const sortedYears = Object.keys(yearlyData).sort((a, b) => b - a);

    return sortedYears.map(year => {
      const monthsObj = yearlyData[year].months;
      const allRates = yearlyData[year].allRates;
      const annualAvg = allRates.length > 0 ? (allRates.reduce((s, r) => s + r, 0) / allRates.length) : null;

      return { year, months: monthsObj, annualAvg };
    });
  },

  calculateChangePct(dailyRates, periodDays) {
    const dates = Object.keys(dailyRates).sort();
    if (dates.length < 2) return 0;

    const latestDate = dates[dates.length - 1];
    const latestRate = dailyRates[latestDate];

    const targetTime = new Date(latestDate).getTime() - (periodDays * 24 * 60 * 60 * 1000);
    
    let closestDate = dates[0];
    let minDiff = Math.abs(new Date(dates[0]).getTime() - targetTime);

    for (let i = 1; i < dates.length; i++) {
      const diff = Math.abs(new Date(dates[i]).getTime() - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        closestDate = dates[i];
      }
    }

    const pastRate = dailyRates[closestDate];
    if (!pastRate || pastRate === 0) return 0;

    const pct = ((latestRate - pastRate) / pastRate) * 100;
    return parseFloat(pct.toFixed(2));
  },

  getStartDateForScale(scaleStr) {
    const now = new Date();
    switch (scaleStr) {
      case '6M': now.setMonth(now.getMonth() - 6); break;
      case '1Y': now.setFullYear(now.getFullYear() - 1); break;
      case '2Y': now.setFullYear(now.getFullYear() - 2); break;
      case '3Y': now.setFullYear(now.getFullYear() - 3); break;
      case '5Y': now.setFullYear(now.getFullYear() - 5); break;
      case 'MAX': return '1999-01-04';
      default: now.setFullYear(now.getFullYear() - 1);
    }
    return now.toISOString().split('T')[0];
  },

  getCache(key, maxAgeMs) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed._timestamp > maxAgeMs) {
        localStorage.removeItem(key);
        return null;
      }
      return parsed._data;
    } catch (e) {
      return null;
    }
  },

  setCache(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ _timestamp: Date.now(), _data: data }));
    } catch (e) {}
  }
};

/**
 * UI Renderer & DOM Controllers
 */
document.addEventListener('DOMContentLoaded', () => {
  initTabNavigation();
  initTimeScaleButtons();
  loadOverviewData();
});

/**
 * Load Overview Cards + Mini Sparkline Charts
 */
async function loadOverviewData() {
  const data = await FXDataService.fetchLatestRates();
  if (!data || !data.rates) return;

  const rates = data.rates;

  const currencies = ['aud', 'inr', 'jpy', 'eur', 'gbp'];
  currencies.forEach(c => {
    const r = rates[c.toUpperCase()];
    if (r) updateOverviewCard(c, r);
  });
  
  if (rates.RUB) {
    const rubBadge = document.getElementById('overview-rate-rub');
    if (rubBadge) {
      rubBadge.textContent = rates.RUB.toFixed(2);
      rubBadge.title = rates._rubSource || 'Live Rate';
    }
  }

  // Render Mini Sparkline Charts
  renderOverviewSparklines();
}

function updateOverviewCard(currency, rate) {
  const badge = document.getElementById(`overview-rate-${currency}`);
  if (badge) {
    badge.textContent = rate < 10 ? rate.toFixed(4) : rate.toFixed(2);
  }
}

/**
 * Render Mini Sparklines in Overview Cards
 */
async function renderOverviewSparklines() {
  const startDate = FXDataService.getStartDateForScale('6M');
  const endDate = new Date().toISOString().split('T')[0];

  const currencies = ['AUD', 'INR', 'JPY', 'EUR', 'GBP'];

  currencies.forEach(async (curr) => {
    const container = document.getElementById(`sparkline-${curr.toLowerCase()}`);
    if (!container) return;

    container.innerHTML = `<canvas id="canvas-spark-${curr.toLowerCase()}"></canvas>`;
    const canvas = document.getElementById(`canvas-spark-${curr.toLowerCase()}`);

    const histData = await FXDataService.fetchHistoricalSeries(curr, startDate, endDate);
    const daily = histData.dailyRates || {};
    const labels = Object.keys(daily).sort();
    const values = labels.map(d => daily[d]);

    if (values.length === 0) return;

    const firstVal = values[0];
    const lastVal = values[values.length - 1];
    const isUp = lastVal >= firstVal;

    const ctx = canvas.getContext('2d');
    ChartManager.register(`canvas-spark-${curr.toLowerCase()}`, new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          borderColor: isUp ? '#16a34a' : '#dc2626',
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          tension: 0.2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } }
      }
    }));
  });
}

/**
 * Render Main Currency Chart (Chart.js Line Chart)
 */
async function renderCurrencyTabChart(currency, scale = '1Y') {
  const canvasId = `chart-canvas-${currency.toLowerCase()}`;
  const placeholderId = currency === 'AUD' ? 'chart-aud-placeholder' : `panel-${currency.toLowerCase()}`;
  
  let placeholder = document.getElementById(placeholderId);
  if (currency !== 'AUD') {
    const wrapper = document.querySelector(`#panel-${currency.toLowerCase()} .chart-wrapper`);
    if (wrapper) placeholder = wrapper;
  } else {
    const wrapper = document.querySelector('#chart-aud-placeholder').parentNode;
    if (wrapper) placeholder = wrapper;
  }

  if (placeholder) {
    placeholder.innerHTML = `<canvas id="${canvasId}"></canvas>`;
  }

  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const startDate = FXDataService.getStartDateForScale(scale);
  const endDate = new Date().toISOString().split('T')[0];

  const hist = await FXDataService.fetchHistoricalSeries(currency, startDate, endDate);
  const daily = hist.dailyRates || {};
  const labels = Object.keys(daily).sort();
  const values = labels.map(d => daily[d]);

  const ctx = canvas.getContext('2d');

  ChartManager.register(canvasId, new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: `1 USD = ${currency}`,
        data: values,
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37, 99, 235, 0.08)',
        borderWidth: 2,
        fill: true,
        tension: 0.1,
        pointRadius: values.length > 100 ? 0 : 2,
        pointHoverRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top' },
        tooltip: {
          callbacks: {
            label: (ctx) => `Rate: ${ctx.parsed.y.toFixed(4)} ${currency}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: 10 }
        },
        y: {
          grid: { color: '#f1f5f9' },
          ticks: {
            callback: (val) => val.toFixed(currency === 'JPY' || currency === 'INR' || currency === 'RUB' ? 2 : 4)
          }
        }
      }
    }
  }));
}

/**
 * Render AUD Competitor Comparison Chart (USD/AUD vs EUR/AUD Overlay)
 */
async function renderAudCompetitorChart(scale = '1Y') {
  const container = document.getElementById('chart-aud-comp-placeholder');
  if (!container) return;

  const wrapper = container.parentNode;
  wrapper.innerHTML = `<canvas id="canvas-aud-competitor"></canvas>`;
  const canvas = document.getElementById('canvas-aud-competitor');

  const startDate = FXDataService.getStartDateForScale(scale);
  const endDate = new Date().toISOString().split('T')[0];

  const combined = await FXDataService.fetchEurAudComparison(startDate, endDate);
  const dates = Object.keys(combined).sort();

  const usdAudValues = dates.map(d => combined[d].usdAud);
  const eurAudValues = dates.map(d => combined[d].eurAud);

  const ctx = canvas.getContext('2d');

  ChartManager.register('canvas-aud-competitor', new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [
        {
          label: "Peter's Rate: USD / AUD (Left Axis)",
          data: usdAudValues,
          borderColor: '#2563eb', // Blue
          backgroundColor: 'transparent',
          borderWidth: 2,
          yAxisID: 'yUsd',
          tension: 0.1,
          pointRadius: 0
        },
        {
          label: "German Competitor: EUR / AUD (Right Axis)",
          data: eurAudValues,
          borderColor: '#dc2626', // Red
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [4, 4],
          yAxisID: 'yEur',
          tension: 0.1,
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top' },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y ? ctx.parsed.y.toFixed(4) : 'N/A'}`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
        yUsd: {
          type: 'linear',
          display: true,
          position: 'left',
          title: { display: true, text: 'USD / AUD Rate', color: '#2563eb' },
          grid: { color: '#f1f5f9' }
        },
        yEur: {
          type: 'linear',
          display: true,
          position: 'right',
          title: { display: true, text: 'EUR / AUD Rate', color: '#dc2626' },
          grid: { drawOnChartArea: false }
        }
      }
    }
  }));
}

/**
 * Tab Navigation & Lazy Chart Loading
 */
function initTabNavigation() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  function activateTab(tabId) {
    if (!tabId) tabId = 'overview';
    
    tabButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    tabPanels.forEach(panel => {
      panel.classList.toggle('panel-hidden', panel.id !== `panel-${tabId}`);
    });

    history.replaceState(null, null, `#${tabId}`);

    // Trigger Chart Render for Active Currency Tab
    const currUpper = tabId.toUpperCase();
    if (['AUD', 'INR', 'JPY', 'EUR', 'GBP', 'RUB'].includes(currUpper)) {
      renderCurrencyTabChart(currUpper, '1Y');
      if (currUpper === 'AUD') {
        renderAudCompetitorChart('1Y');
      }
    }
  }

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });

  const initialHash = window.location.hash.replace('#', '');
  if (initialHash && document.getElementById(`panel-${initialHash}`)) {
    activateTab(initialHash);
  } else {
    activateTab('overview');
  }

  window.addEventListener('popstate', () => {
    const currentHash = window.location.hash.replace('#', '');
    if (currentHash && document.getElementById(`panel-${currentHash}`)) {
      activateTab(currentHash);
    }
  });
}

/**
 * Time Scale Button Controller
 */
function initTimeScaleButtons() {
  const timeBtnGroups = document.querySelectorAll('.time-scale-group');

  timeBtnGroups.forEach(group => {
    const currency = group.dataset.currency;
    const buttons = group.querySelectorAll('.time-btn');

    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const scale = btn.dataset.scale;
        if (currency) {
          renderCurrencyTabChart(currency, scale);
          if (currency === 'AUD') {
            renderAudCompetitorChart(scale);
          }
        }
      });
    });
  });
}
