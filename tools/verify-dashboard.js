/**
 * FX Dashboard Automated QA Verification Script
 * Validates HTML DOM structure, element IDs, tab configurations, and JS syntax integrity.
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Running FX Dashboard Automated QA Verification...\n');

let errors = 0;
let warnings = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
  } else {
    console.log(`  ❌ FAIL: ${message}`);
    errors++;
  }
}

function warn(condition, message) {
  if (!condition) {
    console.log(`  ⚠️ WARN: ${message}`);
    warnings++;
  }
}

const basePath = path.join(__dirname, '..');
const htmlPath = path.join(basePath, 'index.html');
const cssPath = path.join(basePath, 'style.css');
const jsPath = path.join(basePath, 'app.js');

// 1. File existence checks
assert(fs.existsSync(htmlPath), 'index.html exists');
assert(fs.existsSync(cssPath), 'style.css exists');
assert(fs.existsSync(jsPath), 'app.js exists');

if (!fs.existsSync(htmlPath) || !fs.existsSync(jsPath)) {
  console.error('\n❌ Critical files missing. Aborting QA scan.');
  process.exit(1);
}

const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const jsContent = fs.readFileSync(jsPath, 'utf8');

// 2. Tab Navigation Checks
console.log('\n--- 1. Tab & Panel Structure Checks ---');
const requiredTabs = ['overview', 'aud', 'inr', 'jpy', 'eur', 'gbp', 'rub', 'krw'];
requiredTabs.forEach(tab => {
  assert(htmlContent.includes(`data-tab="${tab}"`), `Tab button data-tab="${tab}" exists`);
  assert(htmlContent.includes(`id="panel-${tab}"`), `Panel section id="panel-${tab}" exists`);
});

// 3. Overview Currency Cards & Rate Badges
console.log('\n--- 2. Overview Card & Rate Badge Checks ---');
const overviewCards = ['aud', 'inr', 'jpy', 'eur', 'gbp', 'rub', 'krw'];
overviewCards.forEach(c => {
  assert(htmlContent.includes(`id="overview-rate-${c}"`), `Overview rate badge id="overview-rate-${c}" exists`);
  assert(htmlContent.includes(`id="sparkline-${c}"`), `Sparkline container id="sparkline-${c}" exists`);
});

// 4. Custom Period Calculators & Tables
console.log('\n--- 3. Calculator Inputs & Table Bodies ---');
const currencies = ['aud', 'inr', 'jpy', 'eur', 'gbp', 'rub', 'krw'];
currencies.forEach(c => {
  assert(htmlContent.includes(`id="calc-start-${c}"`), `Start date input id="calc-start-${c}" exists`);
  assert(htmlContent.includes(`id="calc-end-${c}"`), `End date input id="calc-end-${c}" exists`);
  assert(htmlContent.includes(`id="calc-result-${c}"`), `Result display id="calc-result-${c}" exists`);
  assert(htmlContent.includes(`id="table-${c}-body"`), `Table body id="table-${c}-body" exists`);
});

// 5. Special German Competitor Analysis in AUD Tab
console.log('\n--- 4. German Competitor (EUR/AUD) Special Features ---');
assert(htmlContent.includes('id="table-aud-eur-body"'), 'EUR/AUD competitor table body id="table-aud-eur-body" exists');
assert(htmlContent.includes('id="chart-aud-comp-placeholder"'), 'Competitor chart container exists');

// 6. JavaScript Functions & Handlers Check
console.log('\n--- 5. JavaScript Logic & Event Handlers ---');
assert(jsContent.includes('function initCardDragAndDrop'), 'Drag and drop card reordering function exists');
assert(jsContent.includes('function renderAudCompetitorChart'), 'AUD competitor chart function exists');
assert(jsContent.includes('function renderEurAudMonthlyTable'), 'EUR/AUD competitor table function exists');
assert(jsContent.includes('fetchRateForDate'), 'Historical date rate fetcher exists');

// 7. JS Syntax Validation
console.log('\n--- 6. JavaScript Syntax Integrity Scan ---');
try {
  new Function(jsContent);
  console.log('  ✅ PASS: app.js contains valid JavaScript syntax without parse errors.');
} catch (e) {
  console.log(`  ❌ FAIL: app.js syntax error: ${e.message}`);
  errors++;
}

console.log(`\n========================================`);
console.log(`QA SCAN COMPLETE: ${errors} Error(s), ${warnings} Warning(s)`);
console.log(`========================================\n`);

if (errors > 0) {
  process.exit(1);
} else {
  console.log('🎉 All automated checks passed clean!');
}
