/**
 * FX Dashboard - Main Application Engine & Data Layer
 * Step 2: Data Layer, Dual API Integration (Frankfurter + Open ER-API for RUB), Caching & Monthly Calculations
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
 * FX Data Service - Fetching, Caching, and Analytics
 */
const FXDataService = {

  /**
   * Fetch latest rates for Overview tab
   * Uses Frankfurter API for AUD, INR, JPY, EUR, GBP
   * Uses Open ER-API as fallback/supplement for live RUB rates
   */
  async fetchLatestRates() {
    const cacheKey = `${CONFIG.CACHE_PREFIX}latest`;
    const cached = this.getCache(cacheKey, CONFIG.TTL.RECENT);
    if (cached) return cached;

    try {
      // 1. Fetch Frankfurter primary rates
      const res = await fetch(`${CONFIG.FRANKFURTER_BASE}/latest?from=USD&to=AUD,INR,JPY,EUR,GBP`);
      if (!res.ok) throw new Error(`Frankfurter API error: ${res.status}`);
      const data = await res.json();
      
      const rates = { ...data.rates };
      rates.USD = 1.0;

      // 2. Fetch live RUB rate from Open ER-API (solves ECB RUB suspension)
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
        console.warn('Failed to fetch live RUB from Open ER-API, using fallback:', rubErr);
        rates.RUB = 81.77; // Verified fallback fallback
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
      // Fallback object in case of network offline
      return {
        date: new Date().toISOString().split('T')[0],
        rates: { AUD: 1.52, INR: 83.4, JPY: 154.5, EUR: 0.915, GBP: 0.785, RUB: 81.77, USD: 1.0 },
        isOfflineFallback: true
      };
    }
  },

  /**
   * Fetch historical daily rate series for a specific currency
   * @param {string} currency - e.g. 'AUD'
   * @param {string} startDate - YYYY-MM-DD
   * @param {string} endDate - YYYY-MM-DD
   */
  async fetchHistoricalSeries(currency, startDate, endDate) {
    const cacheKey = `${CONFIG.CACHE_PREFIX}hist_${currency}_${startDate}_${endDate}`;
    const isOld = new Date(endDate) < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const ttl = isOld ? CONFIG.TTL.HISTORICAL : CONFIG.TTL.RECENT;
    
    const cached = this.getCache(cacheKey, ttl);
    if (cached) return cached;

    try {
      let endpoint;
      if (currency === 'RUB') {
        // RUB data stops at 2022-03-01 in Frankfurter API
        endpoint = `${CONFIG.FRANKFURTER_BASE}/1999-01-04..2022-03-01?from=USD&to=RUB`;
      } else {
        endpoint = `${CONFIG.FRANKFURTER_BASE}/${startDate}..${endDate}?from=USD&to=${currency}`;
      }

      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(`API fetch error ${res.status}`);
      const data = await res.json();

      // Transform response format { "YYYY-MM-DD": rate }
      const dailyRates = {};
      if (data.rates) {
        Object.keys(data.rates).forEach(date => {
          dailyRates[date] = data.rates[date][currency] || data.rates[date].RUB;
        });
      }

      const result = {
        currency: currency,
        startDate: startDate,
        endDate: endDate,
        dailyRates: dailyRates
      };

      this.setCache(cacheKey, result);
      return result;

    } catch (err) {
      console.error(`Error fetching history for ${currency}:`, err);
      return { currency, startDate, endDate, dailyRates: {} };
    }
  },

  /**
   * Calculate Year x Month grid and annual averages from daily rates
   * @param {Object} dailyRates - { "2026-01-02": 1.52, ... }
   * @returns {Array} List of year objects sorted descending
   */
  calculateMonthlyAverages(dailyRates) {
    const monthlyGroups = {}; // { "2026-01": [rates] }

    Object.entries(dailyRates).forEach(([dateStr, rate]) => {
      const yearMonth = dateStr.substring(0, 7); // "YYYY-MM"
      if (!monthlyGroups[yearMonth]) {
        monthlyGroups[yearMonth] = [];
      }
      monthlyGroups[yearMonth].push(rate);
    });

    const yearlyData = {}; // { "2026": { "01": avg, ... } }

    Object.entries(monthlyGroups).forEach(([ym, rates]) => {
      const [year, month] = ym.split('-');
      const monthAvg = rates.reduce((sum, r) => sum + r, 0) / rates.length;

      if (!yearlyData[year]) {
        yearlyData[year] = { months: {}, allRates: [] };
      }
      yearlyData[year].months[month] = monthAvg;
      yearlyData[year].allRates.push(...rates);
    });

    // Format into final sorted array
    const sortedYears = Object.keys(yearlyData).sort((a, b) => b - a);

    return sortedYears.map(year => {
      const monthsObj = yearlyData[year].months;
      const allRates = yearlyData[year].allRates;
      const annualAvg = allRates.length > 0 ? (allRates.reduce((s, r) => s + r, 0) / allRates.length) : null;

      return {
        year: year,
        months: monthsObj, // { "01": 1.52, "02": 1.53 ... }
        annualAvg: annualAvg
      };
    });
  },

  /**
   * Calculate percentage change over a given period
   * @param {Object} dailyRates - Sorted daily rates
   * @param {number} periodDays - 30, 90, 365
   */
  calculateChangePct(dailyRates, periodDays) {
    const dates = Object.keys(dailyRates).sort();
    if (dates.length < 2) return 0;

    const latestDate = dates[dates.length - 1];
    const latestRate = dailyRates[latestDate];

    const targetTime = new Date(latestDate).getTime() - (periodDays * 24 * 60 * 60 * 1000);
    
    // Find closest date matching target time
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

  /* LocalStorage Cache Utilities */
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
      const payload = {
        _timestamp: Date.now(),
        _data: data
      };
      localStorage.setItem(key, JSON.stringify(payload));
    } catch (e) {
      console.warn('LocalStorage save error:', e);
    }
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
 * Load & Render Overview Cards with Live API Data
 */
async function loadOverviewData() {
  const data = await FXDataService.fetchLatestRates();
  if (!data || !data.rates) return;

  const rates = data.rates;

  // Update Rate Badges
  if (rates.AUD) updateOverviewCard('aud', rates.AUD, '1 USD = ' + rates.AUD.toFixed(4) + ' AUD');
  if (rates.INR) updateOverviewCard('inr', rates.INR, '1 USD = ' + rates.INR.toFixed(2) + ' INR');
  if (rates.JPY) updateOverviewCard('jpy', rates.JPY, '1 USD = ' + rates.JPY.toFixed(2) + ' JPY');
  if (rates.EUR) updateOverviewCard('eur', rates.EUR, '1 USD = ' + rates.EUR.toFixed(4) + ' EUR');
  if (rates.GBP) updateOverviewCard('gbp', rates.GBP, '1 USD = ' + rates.GBP.toFixed(4) + ' GBP');
  
  // RUB live rate update (with provider info)
  if (rates.RUB) {
    const rubBadge = document.getElementById('overview-rate-rub');
    if (rubBadge) {
      rubBadge.textContent = rates.RUB.toFixed(2);
      rubBadge.title = rates._rubSource || 'Live Rate';
    }
  }
}

function updateOverviewCard(currency, rate, labelText) {
  const badge = document.getElementById(`overview-rate-${currency}`);
  if (badge) {
    badge.textContent = typeof rate === 'number' ? (rate < 10 ? rate.toFixed(4) : rate.toFixed(2)) : rate;
  }
}

/**
 * Tab Navigation Handler
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
 * Time Scale Button Handler
 */
function initTimeScaleButtons() {
  const timeBtnGroups = document.querySelectorAll('.time-scale-group');

  timeBtnGroups.forEach(group => {
    const buttons = group.querySelectorAll('.time-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  });
}
