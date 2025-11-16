import type { WebviewMessage, ExtensionMessage } from '../common/ipc';
import type { CatalogRecord } from '../../models/types';

const vscode = acquireVsCodeApi();

let catalogs: CatalogRecord[] = [];

// DOM Elements
let catalogsContainer: HTMLElement;
let addBtn: HTMLButtonElement;
let refreshAllBtn: HTMLButtonElement;

function init() {
  catalogsContainer = document.getElementById('catalogsContainer') as HTMLElement;
  addBtn = document.getElementById('addCatalog') as HTMLButtonElement;
  refreshAllBtn = document.getElementById('refreshAll') as HTMLButtonElement;

  addBtn.addEventListener('click', () => {
    sendMessage({ type: 'openAddRepository' });
  });
  refreshAllBtn.addEventListener('click', () => {
    sendMessage({ type: 'refreshAllCatalogs' });
  });

  // Load catalogs
  sendMessage({ type: 'getCatalogs' });
}

function renderCatalogs() {
  if (catalogs.length === 0) {
    catalogsContainer.innerHTML = '<div class="no-results">No repositories configured</div>';
    return;
  }

  catalogsContainer.innerHTML = '';

  catalogs.forEach(catalog => {
    catalogsContainer.appendChild(createCatalogCard(catalog));
  });
}

function createCatalogCard(catalog: CatalogRecord): HTMLElement {
  const card = document.createElement('div');
  card.className = 'catalog-card';

  const artifactCount = typeof catalog.artifactCount === 'number' ? catalog.artifactCount : 0;
  const statusPills = [createStatusPill(catalog.status)];
  if (!catalog.enabled) {
    statusPills.push('<span class="status-pill status-disabled">Disabled</span>');
  }

  card.innerHTML = `
    <div class="catalog-header">
      <div class="catalog-title">
        <h3>${escapeHtml(catalog.metadata.name)}</h3>
        <div class="catalog-status">
          ${statusPills.join('')}
        </div>
      </div>
    </div>
    <div class="catalog-url">${escapeHtml(catalog.url)}</div>
    <p class="catalog-description">${escapeHtml(catalog.metadata.description)}</p>
    <div class="catalog-meta">
      <span>${artifactCount} artifacts</span>
      ${catalog.lastFetched ? `<span>Last synced: ${formatDate(catalog.lastFetched)}</span>` : '<span>Never synced</span>'}
    </div>
    ${catalog.error ? `<div class="catalog-error">Error: ${escapeHtml(catalog.error)}</div>` : ''}
    <div class="catalog-actions">
      <button class="btn-secondary" data-action="refresh">Refresh</button>
      <button class="btn-danger" data-action="remove">Remove</button>
    </div>
  `;

  card.querySelector('[data-action="refresh"]')?.addEventListener('click', () => {
    sendMessage({ type: 'refreshCatalog', catalogId: catalog.id });
  });

  card.querySelector('[data-action="remove"]')?.addEventListener('click', () => {
    sendMessage({ type: 'removeCatalog', catalogId: catalog.id });
  });

  return card;
}

// Message handling
window.addEventListener('message', (event) => {
  const message: ExtensionMessage = event.data;

  switch (message.type) {
    case 'catalogs':
      catalogs = message.catalogs;
      renderCatalogs();
      break;
    case 'catalogAdded':
      catalogs.push(message.catalog);
      renderCatalogs();
      break;
    case 'catalogRemoved':
      catalogs = catalogs.filter(c => c.id !== message.catalogId);
      renderCatalogs();
      break;
    case 'catalogUpdated': {
      const index = catalogs.findIndex(c => c.id === message.catalog.id);
      if (index !== -1) {
        catalogs[index] = message.catalog;
        renderCatalogs();
      }
      break;
    }
  }
});

function sendMessage(message: WebviewMessage) {
  vscode.postMessage(message);
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return 'Invalid date';
  }
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  return date.toLocaleString();
}

function createStatusPill(status: CatalogRecord['status']): string {
  const label = getStatusLabel(status);
  const statusClass = getStatusClass(status);
  return `<span class="status-pill ${statusClass}">${label}</span>`;
}

function getStatusLabel(status: CatalogRecord['status']): string {
  switch (status) {
    case 'healthy':
      return 'Healthy';
    case 'updating':
      return 'Syncing';
    case 'error':
      return 'Error';
    default:
      return 'Unknown';
  }
}

function getStatusClass(status: CatalogRecord['status']): string {
  switch (status) {
    case 'healthy':
      return 'status-healthy';
    case 'updating':
      return 'status-updating';
    case 'error':
      return 'status-error';
    default:
      return 'status-unknown';
  }
}

// Initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

