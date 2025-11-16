import type { WebviewMessage, ExtensionMessage } from '../common/ipc';
import type { InstallationWithUpdate } from '../../models/types';

const vscode = acquireVsCodeApi();

let installations: InstallationWithUpdate[] = [];

// DOM Elements
let installedContainer: HTMLElement;
let groupBySelect: HTMLSelectElement;

function init() {
  installedContainer = document.getElementById('installedContainer') as HTMLElement;
  groupBySelect = document.getElementById('groupBy') as HTMLSelectElement;

  groupBySelect.addEventListener('change', renderInstallations);

  // Load installed artifacts
  sendMessage({ type: 'getInstalled' });
}

function renderInstallations() {
  const groupBy = groupBySelect.value;

  if (installations.length === 0) {
    installedContainer.innerHTML = '<div class="no-results">No artifacts installed</div>';
    return;
  }

  if (groupBy === 'type') {
    renderByType();
  } else {
    renderByDate();
  }
}

function renderByType() {
  const grouped = installations.reduce((acc, inst) => {
    const type = inst.artifact?.type || 'unknown';
    if (!acc[type]) acc[type] = [];
    acc[type].push(inst);
    return acc;
  }, {} as Record<string, InstallationWithUpdate[]>);

  installedContainer.innerHTML = '';

  Object.entries(grouped).forEach(([type, items]) => {
    const section = document.createElement('div');
    section.className = 'installed-section';

    const typeLabel = type.charAt(0).toUpperCase() + type.slice(1) + 's';
    section.innerHTML = `<h3>${typeLabel} (${items.length})</h3>`;

    items.forEach(inst => {
      section.appendChild(createInstallationCard(inst));
    });

    installedContainer.appendChild(section);
  });
}

function renderByDate() {
  installedContainer.innerHTML = '';

  installations.forEach(inst => {
    installedContainer.appendChild(createInstallationCard(inst));
  });
}

function createInstallationCard(inst: InstallationWithUpdate): HTMLElement {
  const card = document.createElement('div');
  card.className = 'installation-card';

  const artifact = inst.artifact;
  const hasUpdate = inst.updateAvailable;

  card.innerHTML = `
    <div class="installation-header">
      <h4>${artifact ? escapeHtml(artifact.name) : inst.artifactId}</h4>
      ${hasUpdate ? '<span class="badge-update">Update Available</span>' : ''}
    </div>
    <div class="installation-meta">
      <span>v${inst.version}</span>
      ${inst.newVersion ? `<span class="new-version">→ v${inst.newVersion}</span>` : ''}
      <span class="catalog-name">${inst.catalogId}</span>
    </div>
    <div class="installation-info">
      <div>Installed: ${formatDate(inst.installedAt)}</div>
      ${inst.lastUsed ? `<div>Last used: ${formatDate(inst.lastUsed)}</div>` : '<div>Never used</div>'}
    </div>
    <div class="installation-actions">
      ${hasUpdate ? '<button class="btn-primary" data-action="update">Update</button>' : ''}
      <button class="btn-secondary" data-action="details">Details</button>
      <button class="btn-danger" data-action="uninstall">Uninstall</button>
    </div>
  `;

  card.querySelector('[data-action="update"]')?.addEventListener('click', () => {
    sendMessage({ type: 'update', catalogId: inst.catalogId, artifactId: inst.artifactId });
  });

  card.querySelector('[data-action="details"]')?.addEventListener('click', () => {
    if (inst.artifact) {
      sendMessage({ type: 'preview', catalogId: inst.catalogId, artifactId: inst.artifactId });
    } else {
      showDetails(inst);
    }
  });

  card.querySelector('[data-action="uninstall"]')?.addEventListener('click', () => {
    sendMessage({ type: 'uninstall', catalogId: inst.catalogId, artifactId: inst.artifactId });
  });

  return card;
}

function showDetails(inst: InstallationWithUpdate) {
  sendMessage({ type: 'showInstallationDetails', installation: inst });
}

// Message handling
window.addEventListener('message', (event) => {
  const message: ExtensionMessage = event.data;

  switch (message.type) {
    case 'installedArtifacts':
      installations = message.artifacts;
      renderInstallations();
      break;
    case 'installResult':
      // Refresh list
      sendMessage({ type: 'getInstalled' });
      break;
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
  const date = toDate(value);
  if (!date) return 'Unknown';

  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function formatDateTime(value: Date | string): string {
  const date = toDate(value);
  return date ? date.toLocaleString() : 'Unknown';
}

function toDate(value: Date | string): Date | null {
  if (value instanceof Date) {
    return value;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

