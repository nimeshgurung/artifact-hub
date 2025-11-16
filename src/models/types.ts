import { z } from 'zod';

// ============================================================================
// Zod Schemas for Validation
// ============================================================================

export const AuthorSchema = z.object({
  name: z.string(),
  email: z.string().email().optional(),
  url: z.string().url().optional(),
});

export const RepositorySchema = z.object({
  type: z.string(),
  url: z.string().url(),
  branch: z.string().optional(),
});

export const CompatibilitySchema = z.object({
  vscode: z.string().optional(),
  copilot: z.string().optional(),
}).optional();

export const ArtifactTypeSchema = z.enum(['chatmode', 'instructions', 'prompt', 'task', 'profile']);

export const DifficultySchema = z.string().optional();

export const ArtifactMetadataSchema = z.object({
  downloads: z.number().optional(),
  rating: z.number().min(0).max(5).optional(),
  lastUpdated: z.string().datetime().optional(),
  featured: z.boolean().optional(),
});

export const ArtifactSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  type: ArtifactTypeSchema,
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  path: z.string(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  author: AuthorSchema.optional(),
  category: z.string(),
  tags: z.array(z.string()).min(1).max(20),
  keywords: z.array(z.string()).optional(),
  language: z.array(z.string()).optional(),
  framework: z.array(z.string()).optional(),
  useCase: z.array(z.string()).optional(),
  difficulty: DifficultySchema.optional(),
  estimatedTime: z.string().optional(),
  compatibility: CompatibilitySchema.optional(),
  dependencies: z.array(z.string()).default([]),
  supportingFiles: z.array(z.string()).optional(),
  metadata: z.record(z.any()).optional(),
});

export const CatalogMetadataSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  author: AuthorSchema,
  repository: RepositorySchema,
  license: z.string(),
  homepage: z.string().url().optional(),
  icon: z.string().optional(),
  tags: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
});

export const ProfileArtifactRefSchema = z.object({
  catalogId: z.string(),
  artifactId: z.string(),
  version: z.string().optional(),
});

export const ProfileSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  description: z.string().optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  artifacts: z.array(ProfileArtifactRefSchema),
});

export const CatalogSchema = z.object({
  $schema: z.string().url().optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  catalog: CatalogMetadataSchema,
  artifacts: z.array(ArtifactSchema),
  profiles: z.array(ProfileSchema).optional(),
});

// ============================================================================
// TypeScript Types (inferred from schemas)
// ============================================================================

export type Author = z.infer<typeof AuthorSchema>;
export type Repository = z.infer<typeof RepositorySchema>;
export type Compatibility = z.infer<typeof CompatibilitySchema>;
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;
export type Difficulty = z.infer<typeof DifficultySchema>;
export type ArtifactMetadata = z.infer<typeof ArtifactMetadataSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type CatalogMetadata = z.infer<typeof CatalogMetadataSchema>;
export type ProfileArtifactRef = z.infer<typeof ProfileArtifactRefSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type Catalog = z.infer<typeof CatalogSchema>;

// ============================================================================
// Additional Application Types
// ============================================================================

export interface ArtifactWithSource extends Artifact {
  catalogId: string;
  sourceUrl: string;
  installed?: boolean;
}

export type AuthType = 'none' | 'bearer' | 'basic' | 'env';

export interface AuthConfig {
  type: AuthType;
  token?: string;
  username?: string;
  password?: string;
}

export interface CatalogRepoConfig {
  id: string;
  url: string;
  enabled: boolean;
  auth?: AuthConfig;
}

export interface CatalogRecord {
  id: string;
  url: string;
  enabled: boolean;
  metadata: CatalogMetadata;
  lastFetched: Date | null;
  status: 'healthy' | 'error' | 'updating';
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  artifactCount: number;
}

export interface Installation {
  id: number;
  artifactId: string;
  catalogId: string;
  version: string;
  installedPath: string;
  installedAt: Date;
  lastUsed: Date | null;
}

export interface InstallationWithUpdate extends Installation {
  updateAvailable: boolean;
  newVersion: string | null;
  artifact: ArtifactWithSource | null;
}

export interface SearchQuery {
  query?: string;
  type?: ArtifactType[];
  language?: string[];
  framework?: string[];
  category?: string[];
  difficulty?: Difficulty[];
  catalog?: string[];
  tags?: string[];
  sortBy?: 'relevance' | 'rating' | 'downloads' | 'updated';
  page?: number;
  pageSize?: number;
}

export interface SearchResult {
  artifacts: ArtifactWithSource[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ConflictResolution {
  action: 'keep' | 'replace' | 'rename';
  newName?: string;
}

export interface InstallResult {
  success: boolean;
  artifact: ArtifactWithSource;
  path: string;
  error?: string;
}

export interface UpdateInfo {
  installation: Installation;
  latestVersion: string;
  changelog?: string;
}

