/**
 * FX Dashboard - Main Application Engine
 * Step 1: Tab Navigation & Routing Setup
 */

document.addEventListener('DOMContentLoaded', () => {
  initTabNavigation();
  initTimeScaleButtons();
});

/**
 * Tab Navigation Handler
 */
function initTabNavigation() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  function activateTab(tabId) {
    if (!tabId) tabId = 'overview';
    
    // Update Tab Buttons
    tabButtons.forEach(btn => {
      if (btn.dataset.tab === tabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Update Panels
    tabPanels.forEach(panel => {
      if (panel.id === `panel-${tabId}`) {
        panel.classList.remove('panel-hidden');
      } else {
        panel.classList.add('panel-hidden');
      }
    });

    // Update URL hash without scroll jumping
    history.replaceState(null, null, `#${tabId}`);
  }

  // Add click listeners to tab buttons
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;
      activateTab(targetTab);
    });
  });

  // Handle URL hash on load
  const initialHash = window.location.hash.replace('#', '');
  if (initialHash && document.getElementById(`panel-${initialHash}`)) {
    activateTab(initialHash);
  } else {
    activateTab('overview');
  }

  // Handle browser back/forward buttons
  window.addEventListener('popstate', () => {
    const currentHash = window.location.hash.replace('#', '');
    if (currentHash && document.getElementById(`panel-${currentHash}`)) {
      activateTab(currentHash);
    }
  });
}

/**
 * Time Scale Button Handler Stubs
 */
function initTimeScaleButtons() {
  const timeBtnGroups = document.querySelectorAll('.time-scale-group');

  timeBtnGroups.forEach(group => {
    const buttons = group.querySelectorAll('.time-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        console.log(`Selected time scale: ${btn.dataset.scale} for ${group.dataset.currency || 'chart'}`);
      });
    });
  });
}
