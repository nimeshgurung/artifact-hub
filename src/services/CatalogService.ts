import * as vscode from 'vscode';
import type Database from 'better-sqlite3';
import type { DatabaseService } from '../storage/Database';
import type { HttpClient } from './HttpClient';
import type { UrlResolver } from './UrlResolver';
import type { AuthService } from './AuthService';
import type {
  Catalog,
  CatalogRepoConfig,
  CatalogRecord,
  AuthConfig,
} from '../models/types';
import type { CatalogRow } from '../storage/types';
import { CatalogSchema } from '../models/types';
import { ZodError } from 'zod';

export class CatalogService {
  constructor(
    private db: DatabaseService,
    private http: HttpClient,
    private urlResolver: UrlResolver,
    private authService: AuthService
  ) {}

  async addCatalog(config: CatalogRepoConfig): Promise<void> {
    const auth = await this.authService.resolveAuth(config.id, config.auth);

    // Fetch and validate catalog
    const catalog = await this.fetchCatalog(config.url, auth);

    // Store in database
    this.db.transaction((db) => {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO catalogs (id, url, enabled, metadata, status, last_fetched, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `);

      stmt.run(
        config.id,
        config.url,
        config.enabled ? 1 : 0,
        JSON.stringify(catalog.catalog),
        'healthy',
      );

      // Index artifacts
      this.indexArtifacts(db, config.id, catalog);
    });
  }

  async removeCatalog(catalogId: string): Promise<void> {
    const catalog = this.getCatalog(catalogId);
    if (!catalog) {
      throw new Error(`Catalog ${catalogId} not found`);
    }

    // Get all installations from this catalog
    const installations = this.db.getDb().prepare(`
      SELECT installed_path FROM installations WHERE catalog_id = ?
    `).all(catalogId) as Array<{ installed_path: string }>;

    // Confirm deletion if there are installed artifacts
    if (installations.length > 0) {
      const confirm = await vscode.window.showWarningMessage(
        `This will remove ${installations.length} installed artifact(s) from "${catalog.metadata.name}". Continue?`,
        { modal: true },
        'Remove'
      );

      if (confirm !== 'Remove') {
        return;
      }

      // Delete all installed files
      for (const installation of installations) {
        try {
          await vscode.workspace.fs.delete(vscode.Uri.file(installation.installed_path), { recursive: true });
        } catch (err) {
          console.error(`Failed to delete ${installation.installed_path}:`, err);
          // Continue with other files
        }
      }
    }

    // Delete from database (CASCADE will handle artifacts and installations)
    this.db.getDb().prepare('DELETE FROM catalogs WHERE id = ?').run(catalogId);
  }

  async updateCatalog(catalogId: string, updates: Partial<CatalogRepoConfig>): Promise<void> {
    const current = this.getCatalog(catalogId);
    if (!current) {
      throw new Error(`Catalog ${catalogId} not found`);
    }

    const db = this.db.getDb();

    if (updates.enabled !== undefined) {
      db.prepare('UPDATE catalogs SET enabled = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(updates.enabled ? 1 : 0, catalogId);
    }

    if (updates.url) {
      db.prepare('UPDATE catalogs SET url = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(updates.url, catalogId);
    }
  }

  async refreshCatalog(catalogId: string, config: CatalogRepoConfig): Promise<void> {
    const db = this.db.getDb();

    try {
      // Update status to updating
      db.prepare('UPDATE catalogs SET status = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run('updating', catalogId);

      const auth = await this.authService.resolveAuth(config.id, config.auth);
      const catalog = await this.fetchCatalog(config.url, auth);

      // Update catalog in transaction
      this.db.transaction((db) => {
        // Update catalog metadata
        db.prepare(`
          UPDATE catalogs
          SET metadata = ?, status = ?, last_fetched = datetime('now'), error = NULL, updated_at = datetime('now')
          WHERE id = ?
        `).run(JSON.stringify(catalog.catalog), 'healthy', catalogId);

        // Delete old artifacts
        db.prepare('DELETE FROM artifacts WHERE catalog_id = ?').run(catalogId);

        // Index new artifacts
        this.indexArtifacts(db, catalogId, catalog);
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      db.prepare('UPDATE catalogs SET status = ?, error = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run('error', error, catalogId);
      throw err;
    }
  }

  async refreshAll(configs: CatalogRepoConfig[]): Promise<void> {
    const enabledConfigs = configs.filter(c => c.enabled);

    for (const config of enabledConfigs) {
      try {
        await this.refreshCatalog(config.id, config);
      } catch (err) {
        console.error(`Failed to refresh catalog ${config.id}:`, err);
        // Continue with other catalogs
      }
    }
  }

  getCatalog(catalogId: string): CatalogRecord | null {
    const row = this.db.getDb().prepare(`
      SELECT id, url, enabled, metadata, last_fetched, status, error, created_at, updated_at
      FROM catalogs WHERE id = ?
    `).get(catalogId) as CatalogRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      url: row.url,
      enabled: Boolean(row.enabled),
      metadata: JSON.parse(row.metadata),
      lastFetched: row.last_fetched ? new Date(row.last_fetched) : null,
      status: row.status as CatalogRecord['status'],
      error: row.error,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      artifactCount: this.getArtifactCount(row.id),
    };
  }

  getAllCatalogs(): CatalogRecord[] {
    const rows = this.db.getDb().prepare(`
      SELECT id, url, enabled, metadata, last_fetched, status, error, created_at, updated_at
      FROM catalogs
      ORDER BY created_at ASC
    `).all() as CatalogRow[];

    return rows.map(row => ({
      id: row.id,
      url: row.url,
      enabled: Boolean(row.enabled),
      metadata: JSON.parse(row.metadata),
      lastFetched: row.last_fetched ? new Date(row.last_fetched) : null,
      status: row.status as CatalogRecord['status'],
      error: row.error,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      artifactCount: this.getArtifactCount(row.id),
    }));
  }

  getArtifactCount(catalogId: string): number {
    const result = this.db.getDb().prepare(
      'SELECT COUNT(*) as count FROM artifacts WHERE catalog_id = ?'
    ).get(catalogId) as { count: number };

    return result.count;
  }

  private async fetchCatalog(url: string, auth?: AuthConfig): Promise<Catalog> {
    try {
      const data = await this.http.fetchJson<unknown>(url, { auth });
      return CatalogSchema.parse(data);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(`Invalid catalog format: ${err.errors.map(e => e.message).join(', ')}`);
      }
      throw err;
    }
  }

  private indexArtifacts(db: Database.Database, catalogId: string, catalog: Catalog): void {
    const stmt = db.prepare(`
      INSERT INTO artifacts (
        id, catalog_id, type, name, description, path, version, category,
        tags, keywords, language, framework, use_case, difficulty,
        source_url, metadata, author, compatibility, dependencies, supporting_files, estimated_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const artifact of catalog.artifacts) {
      const sourceUrl = this.urlResolver.resolveArtifactUrl(catalog.catalog, artifact);

      stmt.run(
        artifact.id,
        catalogId,
        artifact.type,
        artifact.name,
        artifact.description,
        artifact.path,
        artifact.version,
        artifact.category,
        JSON.stringify(artifact.tags),
        JSON.stringify(artifact.keywords || []),
        JSON.stringify(artifact.language || []),
        JSON.stringify(artifact.framework || []),
        JSON.stringify(artifact.useCase || []),
        artifact.difficulty || null,
        sourceUrl,
        JSON.stringify(artifact.metadata || {}),
        JSON.stringify(artifact.author || null),
        JSON.stringify(artifact.compatibility || null),
        JSON.stringify(artifact.dependencies || []),
        JSON.stringify(artifact.supportingFiles || []),
        artifact.estimatedTime || null
      );
    }
  }
}

