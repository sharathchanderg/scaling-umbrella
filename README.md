I can see you're looking at an audit log system that uses both project IDs and environment IDs for token authorization and event tracking. Based on the code files you've shared, I'll explain where tokens are created and the purpose of both project ID and environment ID in this audit logging system.

## Where Tokens Are Created

While the provided code doesn't explicitly show the token creation endpoint, we can infer this from the database schema and authentication logic:

1. Tokens are stored in the `api_tokens` table with the following key fields:
   - `id`: Primary key
   - `project_id`: References a specific project
   - `environment_id`: References a specific environment within that project
   - `token`: The actual token value (must be unique)
   - `display_name`: Human-readable name
   - `expires_at`: Expiration timestamp
   - `is_active`: Boolean flag for token status

2. The authentication middleware (`authenticate` function) validates tokens by checking:
   - Token existence in the `api_tokens` table
   - Token expiration date is in the future
   - Token is active (`is_active = TRUE`)

3. A token creation endpoint would likely insert a new record into this table with a generated token value, associating it with a specific project and environment.

## Purpose of Project ID and Environment ID

This system uses a hierarchical structure similar to BoxyHQ's audit logs:

### Project ID
- Represents the top-level organizational unit (likely a customer or tenant)
- Acts as a namespace to completely isolate audit events between different organizations
- Enables multi-tenancy where each customer's audit logs are separated

### Environment ID
- Represents different environments within the same project (like development, staging, production)
- Allows for separation of audit events by environment while still belonging to the same project
- Enables more granular access control and data segregation

This dual-identifier approach provides several benefits:

1. **Multi-tenancy**: Complete isolation between different customers/organizations
2. **Environment Segregation**: Ability to keep production audit logs separate from development/testing
3. **Access Control**: Tokens can be scoped to specific project+environment combinations
4. **Data Integrity**: The blockchain verification is performed at the project+environment level

In the audit log architecture, all events are stored with both identifiers, forming blockchain-like chains of events per project+environment combination. This ensures data integrity while maintaining proper isolation.

The authentication middleware extracts both IDs from valid tokens and attaches them to the request object, which later endpoints use to:

1. Authorize access to specific audit logs
2. Filter queries to only return relevant events
3. Maintain proper data segregation

This follows standard multi-tenant SaaS patterns where you want to isolate customer data while providing flexible environment management within each customer account.

Yes, you're correct to point out that this system uses a single database for all projects and environments - it's a multi-tenant architecture that shares the same database infrastructure.

Rather than creating separate databases for each customer (tenant), this system implements a "logical separation" approach where:

1. All audit logs from all customers (projects) and their environments are stored in the same physical database tables
2. Data is segregated logically using the `project_id` and `environment_id` columns as filters

This approach has several key implications:

## Benefits of Shared Database with Logical Separation

1. **Resource Efficiency**: More efficient use of database resources compared to maintaining separate databases per tenant
2. **Operational Simplicity**: Easier to manage, backup, and scale a single database than many separate ones
3. **Consistent Schema**: Schema changes and migrations only need to be applied once
4. **Centralized Monitoring**: Simplified database monitoring and performance tuning

## Security and Isolation Mechanisms

The system maintains security and isolation through:

1. **Authentication**: The authentication middleware enforces that tokens can only access their specific project and environment data
2. **Query Filtering**: All database queries include `project_id` and `environment_id` conditions to filter results (visible in the `getEvents` method and elsewhere)
3. **Access Control**: Middleware functions like `validateProjectAccess` ensure users can only access authorized projects
4. **Blockchain Integrity**: The blockchain integrity verification works per project+environment, maintaining data integrity separately for each

## Potential Concerns

This shared database approach does create some potential concerns:

1. **Noisy Neighbor Issues**: Heavy usage by one tenant could impact performance for others
2. **Security Risk**: A bug in query filters could potentially expose data across tenants
3. **Scale Limitations**: Eventually very large customers might need to be migrated to their own infrastructure

The code shows some mitigations for these concerns:

- Careful query optimization with indexes on `project_id` and `environment_id`
- Transaction isolation to prevent data corruption
- Proper parameter binding to prevent SQL injection

import { Request } from 'express';

// Authentication related types
export interface AuthToken {
  projectId: string;
  environmentId: string;
  isAdmin: boolean;
}

export interface AuthRequest extends Request {
  token?: AuthToken;
}

// Project (Organization) types
export interface Project {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectDto {
  name: string;
}

// Environment types
export interface Environment {
  id: string;
  projectId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEnvironmentDto {
  name: string;
}

// API Token types
export interface ApiToken {
  id: string;
  projectId: string;
  environmentId: string;
  token: string;
  displayName: string;
  createdAt: Date;
  expiresAt: Date | null;
  isActive: boolean;
}

export interface CreateApiTokenDto {
  projectId: string;
  environmentId: string;
  displayName: string;
  expiresAt?: Date | null;
}

export interface ApiTokenResponse {
  id: string;
  projectId: string;
  environmentId: string;
  token: string; // Only returned when first created
  displayName: string;
  createdAt: Date;
  expiresAt: Date | null;
  isActive: boolean;
}

// src/services/projectService.ts - Project/organization management

import { Pool } from 'pg';
import { nanoid } from 'nanoid';
import { Project, CreateProjectDto } from '../types';
import logger from '../utils/logger';

class ProjectService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Create a new project (organization)
   */
  async createProject(data: CreateProjectDto): Promise<Project> {
    const id = `proj_${nanoid(16)}`;
    
    try {
      const query = `
        INSERT INTO projects (id, name)
        VALUES ($1, $2)
        RETURNING id, name, created_at as "createdAt", updated_at as "updatedAt"
      `;
      
      const result = await this.pool.query(query, [id, data.name]);
      const project = result.rows[0];
      
      logger.info('Project created successfully', { projectId: id });
      
      return project;
    } catch (error) {
      logger.error('Error creating project', { error, name: data.name });
      throw error;
    }
  }

  /**
   * Get a project by ID
   */
  async getProjectById(id: string): Promise<Project | null> {
    try {
      const query = `
        SELECT 
          id, 
          name, 
          created_at as "createdAt", 
          updated_at as "updatedAt"
        FROM projects
        WHERE id = $1
      `;
      
      const result = await this.pool.query(query, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error fetching project', { error, projectId: id });
      throw error;
    }
  }

  /**
   * List all projects
   */
  async listProjects(): Promise<Project[]> {
    try {
      const query = `
        SELECT 
          id, 
          name, 
          created_at as "createdAt", 
          updated_at as "updatedAt"
        FROM projects
        ORDER BY created_at DESC
      `;
      
      const result = await this.pool.query(query);
      
      return result.rows;
    } catch (error) {
      logger.error('Error listing projects', { error });
      throw error;
    }
  }

  /**
   * Update a project
   */
  async updateProject(id: string, data: Partial<CreateProjectDto>): Promise<Project | null> {
    try {
      const query = `
        UPDATE projects
        SET 
          name = COALESCE($2, name),
          updated_at = NOW()
        WHERE id = $1
        RETURNING id, name, created_at as "createdAt", updated_at as "updatedAt"
      `;
      
      const result = await this.pool.query(query, [id, data.name]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      logger.info('Project updated successfully', { projectId: id });
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating project', { error, projectId: id });
      throw error;
    }
  }

  /**
   * Delete a project (and all related environments and tokens)
   */
  async deleteProject(id: string): Promise<boolean> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Delete tokens first (foreign key constraint)
      await client.query(`
        DELETE FROM api_tokens
        WHERE project_id = $1
      `, [id]);
      
      // Delete environments
      await client.query(`
        DELETE FROM environments
        WHERE project_id = $1
      `, [id]);
      
      // Delete project
      const result = await client.query(`
        DELETE FROM projects
        WHERE id = $1
        RETURNING id
      `, [id]);
      
      await client.query('COMMIT');
      
      logger.info('Project deleted successfully', { projectId: id });
      
      return result.rows.length > 0;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error deleting project', { error, projectId: id });
      throw error;
    } finally {
      client.release();
    }
  }
}

export default ProjectService;

// src/services/environmentService.ts - Environment management

import { Pool } from 'pg';
import { nanoid } from 'nanoid';
import { Environment, CreateEnvironmentDto } from '../types';
import logger from '../utils/logger';

class EnvironmentService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Create a new environment within a project
   */
  async createEnvironment(projectId: string, data: CreateEnvironmentDto): Promise<Environment> {
    const id = `env_${nanoid(16)}`;
    
    try {
      const query = `
        INSERT INTO environments (id, project_id, name)
        VALUES ($1, $2, $3)
        RETURNING id, project_id as "projectId", name, created_at as "createdAt", updated_at as "updatedAt"
      `;
      
      const result = await this.pool.query(query, [id, projectId, data.name]);
      const environment = result.rows[0];
      
      logger.info('Environment created successfully', { 
        environmentId: id,
        projectId
      });
      
      return environment;
    } catch (error) {
      logger.error('Error creating environment', { 
        error, 
        projectId,
        name: data.name
      });
      throw error;
    }
  }

  /**
   * Get all environments for a project
   */
  async getEnvironmentsByProjectId(projectId: string): Promise<Environment[]> {
    try {
      const query = `
        SELECT 
          id, 
          project_id as "projectId", 
          name, 
          created_at as "createdAt", 
          updated_at as "updatedAt"
        FROM environments
        WHERE project_id = $1
        ORDER BY created_at ASC
      `;
      
      const result = await this.pool.query(query, [projectId]);
      
      return result.rows;
    } catch (error) {
      logger.error('Error fetching environments', { 
        error, 
        projectId
      });
      throw error;
    }
  }

  /**
   * Get environment by ID
   */
  async getEnvironmentById(id: string): Promise<Environment | null> {
    try {
      const query = `
        SELECT 
          id, 
          project_id as "projectId", 
          name, 
          created_at as "createdAt", 
          updated_at as "updatedAt"
        FROM environments
        WHERE id = $1
      `;
      
      const result = await this.pool.query(query, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error fetching environment', { 
        error, 
        environmentId: id
      });
      throw error;
    }
  }

  /**
   * Update an environment
   */
  async updateEnvironment(id: string, data: Partial<CreateEnvironmentDto>): Promise<Environment | null> {
    try {
      const query = `
        UPDATE environments
        SET 
          name = COALESCE($2, name),
          updated_at = NOW()
        WHERE id = $1
        RETURNING id, project_id as "projectId", name, created_at as "createdAt", updated_at as "updatedAt"
      `;
      
      const result = await this.pool.query(query, [id, data.name]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      logger.info('Environment updated successfully', { environmentId: id });
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating environment', { 
        error, 
        environmentId: id
      });
      throw error;
    }
  }

  /**
   * Delete an environment (and all related tokens)
   */
  async deleteEnvironment(id: string): Promise<boolean> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Delete tokens first (foreign key constraint)
      await client.query(`
        DELETE FROM api_tokens
        WHERE environment_id = $1
      `, [id]);
      
      // Delete environment
      const result = await client.query(`
        DELETE FROM environments
        WHERE id = $1
        RETURNING id
      `, [id]);
      
      await client.query('COMMIT');
      
      logger.info('Environment deleted successfully', { environmentId: id });
      
      return result.rows.length > 0;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error deleting environment', { 
        error, 
        environmentId: id
      });
      throw error;
    } finally {
      client.release();
    }
  }
}

export default EnvironmentService;

// src/services/tokenService.ts - API Token management

import { Pool } from 'pg';
import { nanoid } from 'nanoid';
import { ApiToken, ApiTokenResponse, CreateApiTokenDto } from '../types';
import logger from '../utils/logger';
import crypto from 'crypto';

class TokenService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Generate a secure, random API token
   */
  private generateToken(): string {
    // Generate a secure random token with 48 bytes of entropy
    // Format: aud_[24 characters of base64url]
    const randomBytes = crypto.randomBytes(36);
    return `aud_${randomBytes.toString('base64url')}`;
  }

  /**
   * Create a new API token
   */
  async createToken(data: CreateApiTokenDto): Promise<ApiTokenResponse> {
    const id = `tok_${nanoid(16)}`;
    const token = this.generateToken();
    
    try {
      const query = `
        INSERT INTO api_tokens (
          id, 
          project_id, 
          environment_id, 
          token, 
          display_name, 
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING 
          id, 
          project_id as "projectId", 
          environment_id as "environmentId", 
          display_name as "displayName", 
          created_at as "createdAt", 
          expires_at as "expiresAt", 
          is_active as "isActive"
      `;
      
      const result = await this.pool.query(query, [
        id,
        data.projectId,
        data.environmentId,
        token,
        data.displayName,
        data.expiresAt || null
      ]);
      
      const apiToken: ApiTokenResponse = {
        ...result.rows[0],
        token // Include the token in the response, but only on creation
      };
      
      logger.info('API token created successfully', { 
        tokenId: id,
        projectId: data.projectId,
        environmentId: data.environmentId
      });
      
      return apiToken;
    } catch (error) {
      logger.error('Error creating API token', { 
        error, 
        projectId: data.projectId,
        environmentId: data.environmentId
      });
      throw error;
    }
  }

  /**
   * List tokens for a specific project and environment
   */
  async listTokens(projectId: string, environmentId?: string): Promise<ApiToken[]> {
    try {
      let query = `
        SELECT 
          id, 
          project_id as "projectId", 
          environment_id as "environmentId", 
          display_name as "displayName", 
          created_at as "createdAt", 
          expires_at as "expiresAt", 
          is_active as "isActive"
        FROM api_tokens
        WHERE project_id = $1
      `;
      
      const params = [projectId];
      
      if (environmentId) {
        query += ` AND environment_id = $2`;
        params.push(environmentId);
      }
      
      query += ` ORDER BY created_at DESC`;
      
      const result = await this.pool.query(query, params);
      
      return result.rows;
    } catch (error) {
      logger.error('Error listing API tokens', { 
        error, 
        projectId,
        environmentId
      });
      throw error;
    }
  }

  /**
   * Get token by ID
   */
  async getTokenById(id: string): Promise<ApiToken | null> {
    try {
      const query = `
        SELECT 
          id, 
          project_id as "projectId", 
          environment_id as "environmentId", 
          display_name as "displayName", 
          created_at as "createdAt", 
          expires_at as "expiresAt", 
          is_active as "isActive"
        FROM api_tokens
        WHERE id = $1
      `;
      
      const result = await this.pool.query(query, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error fetching API token', { 
        error, 
        tokenId: id
      });
      throw error;
    }
  }

  /**
   * Revoke (deactivate) a token
   */
  async revokeToken(id: string): Promise<boolean> {
    try {
      const query = `
        UPDATE api_tokens
        SET is_active = false
        WHERE id = $1
        RETURNING id
      `;
      
      const result = await this.pool.query(query, [id]);
      
      const success = result.rows.length > 0;
      
      if (success) {
        logger.info('API token revoked successfully', { tokenId: id });
      }
      
      return success;
    } catch (error) {
      logger.error('Error revoking API token', { 
        error, 
        tokenId: id
      });
      throw error;
    }
  }

  /**
   * Delete a token permanently
   */
  async deleteToken(id: string): Promise<boolean> {
    try {
      const query = `
        DELETE FROM api_tokens
        WHERE id = $1
        RETURNING id
      `;
      
      const result = await this.pool.query(query, [id]);
      
      const success = result.rows.length > 0;
      
      if (success) {
        logger.info('API token deleted successfully', { tokenId: id });
      }
      
      return success;
    } catch (error) {
      logger.error('Error deleting API token', { 
        error, 
        tokenId: id
      });
      throw error;
    }
  }
}

export default TokenService;

// src/controllers/projectController.ts - Project API endpoints

import { Request, Response } from 'express';
import { AuthRequest, CreateProjectDto } from '../types';
import ProjectService from '../services/projectService';
import Database from '../db';
import logger from '../utils/logger';

class ProjectController {
  private projectService: ProjectService;
  
  constructor() {
    const db = Database.getInstance();
    this.projectService = new ProjectService(db);
  }
  
  /**
   * Create a new project
   */
  async createProject(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data: CreateProjectDto = req.body;
      
      if (!data.name) {
        res.status(400).json({ message: 'Project name is required' });
        return;
      }
      
      const project = await this.projectService.createProject(data);
      
      res.status(201).json(project);
    } catch (error) {
      logger.error('Error in createProject controller', { error });
      res.status(500).json({ message: 'Failed to create project' });
    }
  }
  
  /**
   * Get all projects
   */
  async listProjects(req: AuthRequest, res: Response): Promise<void> {
    try {
      const projects = await this.projectService.listProjects();
      
      res.status(200).json({ projects });
    } catch (error) {
      logger.error('Error in listProjects controller', { error });
      res.status(500).json({ message: 'Failed to list projects' });
    }
  }
  
  /**
   * Get a project by ID
   */
  async getProject(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { projectId } = req.params;
      
      const project = await this.projectService.getProjectById(projectId);
      
      if (!project) {
        res.status(404).json({ message: 'Project not found' });
        return;
      }
      
      res.status(200).json(project);
    } catch (error) {
      logger.error('Error in getProject controller', { 
        error, 
        projectId: req.params.projectId 
      });
      res.status(500).json({ message: 'Failed to get project' });
    }
  }
  
  /**
   * Update a project
   */
  async updateProject(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { projectId } = req.params;
      const data: Partial<CreateProjectDto> = req.body;
      
      const project = await this.projectService.updateProject(projectId, data);
      
      if (!project) {
        res.status(404).json({ message: 'Project not found' });
        return;
      }
      
      res.status(200).json(project);
    } catch (error) {
      logger.error('Error in updateProject controller', { 
        error, 
        projectId: req.params.projectId 
      });
      res.status(500).json({ message: 'Failed to update project' });
    }
  }
  
  /**
   * Delete a project
   */
  async deleteProject(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { projectId } = req.params;
      
      const success = await this.projectService.deleteProject(projectId);
      
      if (!success) {
        res.status(404).json({ message: 'Project not found' });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      logger.error('Error in deleteProject controller', { 
        error, 
        projectId: req.params.projectId 
      });
      res.status(500).json({ message: 'Failed to delete project' });
    }
  }
}

export default new ProjectController();

// src/controllers/environmentController.ts - Environment API endpoints

import { Request, Response } from 'express';
import { AuthRequest, CreateEnvironmentDto } from '../types';
import EnvironmentService from '../services/environmentService';
import Database from '../db';
import logger from '../utils/logger';

class EnvironmentController {
  private environmentService: EnvironmentService;
  
  constructor() {
    const db = Database.getInstance();
    this.environmentService = new EnvironmentService(db);
  }
  
  /**
   * Create a new environment
   */
  async createEnvironment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { projectId } = req.params;
      const data: CreateEnvironmentDto = req.body;
      
      if (!data.name) {
        res.status(400).json({ message: 'Environment name is required' });
        return;
      }
      
      const environment = await this.environmentService.createEnvironment(projectId, data);
      
      res.status(201).json(environment);
    } catch (error) {
      logger.error('Error in createEnvironment controller', { 
        error,
        projectId: req.params.projectId
      });
      res.status(500).json({ message: 'Failed to create environment' });
    }
  }
  
  /**
   * Get all environments for a project
   */
  async listEnvironments(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { projectId } = req.params;
      
      const environments = await this.environmentService.getEnvironmentsByProjectId(projectId);
      
      res.status(200).json({ environments });
    } catch (error) {
      logger.error('Error in listEnvironments controller', { 
        error,
        projectId: req.params.projectId
      });
      res.status(500).json({ message: 'Failed to list environments' });
    }
  }
  
  /**
   * Get environment by ID
   */
  async getEnvironment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { environmentId } = req.params;
      
      const environment = await this.environmentService.getEnvironmentById(environmentId);
      
      if (!environment) {
        res.status(404).json({ message: 'Environment not found' });
        return;
      }
      
      res.status(200).json(environment);
    } catch (error) {
      logger.error('Error in getEnvironment controller', { 
        error,
        environmentId: req.params.environmentId
      });
      res.status(500).json({ message: 'Failed to get environment' });
    }
  }
  
  /**
   * Update an environment
   */
  async updateEnvironment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { environmentId } = req.params;
      const data: Partial<CreateEnvironmentDto> = req.body;
      
      const environment = await this.environmentService.updateEnvironment(environmentId, data);
      
      if (!environment) {
        res.status(404).json({ message: 'Environment not found' });
        return;
      }
      
      res.status(200).json(environment);
    } catch (error) {
      logger.error('Error in updateEnvironment controller', { 
        error,
        environmentId: req.params.environmentId
      });
      res.status(500).json({ message: 'Failed to update environment' });
    }
  }
  
  /**
   * Delete an environment
   */
  async deleteEnvironment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { environmentId } = req.params;
      
      const success = await this.environmentService.deleteEnvironment(environmentId);
      
      if (!success) {
        res.status(404).json({ message: 'Environment not found' });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      logger.error('Error in deleteEnvironment controller', { 
        error,
        environmentId: req.params.environmentId
      });
      res.status(500).json({ message: 'Failed to delete environment' });
    }
  }
}

export default new EnvironmentController();

// src/controllers/tokenController.ts - API Token endpoints

import { Request, Response } from 'express';
import { AuthRequest, CreateApiTokenDto } from '../types';
import TokenService from '../services/tokenService';
import Database from '../db';
import logger from '../utils/logger';

class TokenController {
  private tokenService: TokenService;
  
  constructor() {
    const db = Database.getInstance();
    this.tokenService = new TokenService(db);
  }
  
  /**
   * Create a new API token
   */
  async createToken(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { projectId, environmentId } = req.params;
      const data: CreateApiTokenDto = {
        ...req.body,
        projectId,
        environmentId
      };
      
      if (!data.displayName) {
        res.status(400).json({ message: 'Token display name is required' });
        return;
      }
      
      const token = await this.tokenService.createToken(data);
      
      res.status(201).json(token);
    } catch (error) {
      logger.error('Error in createToken controller', { 
        error,
        projectId: req.params.projectId,
        environmentId: req.params.environmentId
      });
      res.status(500).json({ message: 'Failed to create API token' });
    }
  }
  
  /**
   * List all tokens for a project/environment
   */
  async listTokens(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { projectId, environmentId } = req.params;
      
      const tokens = await this.tokenService.listTokens(projectId, environmentId);
      
      res.status(200).json({ tokens });
    } catch (error) {
      logger.error('Error in listTokens controller', { 
        error,
        projectId: req.params.projectId,
        environmentId: req.params.environmentId
      });
      res.status(500).json({ message: 'Failed to list API tokens' });
    }
  }
  
  /**
   * Get token by ID
   */
  async getToken(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { tokenId } = req.params;
      
      const token = await this.tokenService.getTokenById(tokenId);
      
      if (!token) {
        res.status(404).json({ message: 'API token not found' });
        return;
      }
      
      res.status(200).json(token);
    } catch (error) {
      logger.error('Error in getToken controller', { 
        error,
        tokenId: req.params.tokenId
      });
      res.status(500).json({ message: 'Failed to get API token' });
    }
  }
  
  /**
   * Revoke (deactivate) a token
   */
  async revokeToken(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { tokenId } = req.params;
      
      const success = await this.tokenService.revokeToken(tokenId);
      
      if (!success) {
        res.status(404).json({ message: 'API token not found' });
        return;
      }
      
      res.status(200).json({ message: 'API token revoked successfully' });
    } catch (error) {
      logger.error('Error in revokeToken controller', { 
        error,
        tokenId: req.params.tokenId
      });
      res.status(500).json({ message: 'Failed to revoke API token' });
    }
  }
  
  /**
   * Delete a token
   */
  async deleteToken(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { tokenId } = req.params;
      
      const success = await this.tokenService.deleteToken(tokenId);
      
      if (!success) {
        res.status(404).json({ message: 'API token not found' });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      logger.error('Error in deleteToken controller', { 
        error,
        tokenId: req.params.tokenId
      });
      res.status(500).json({ message: 'Failed to delete API token' });
    }
  }
}

export default new TokenController();

// src/routes/projectRoutes.ts - Project route definitions

import { Router } from 'express';
import projectController from '../controllers/projectController';
import auth from '../middlewares/auth';

const router = Router();

// Require admin permissions for all project operations
router.use(auth.authenticate);
router.use(auth.requireAdmin);

// Project CRUD routes
router.post('/', projectController.createProject.bind(projectController));
router.get('/', projectController.listProjects.bind(projectController));
router.get('/:projectId', projectController.getProject.bind(projectController));
router.put('/:projectId', projectController.updateProject.bind(projectController));
router.delete('/:projectId', projectController.deleteProject.bind(projectController));

export default router;

// src/routes/environmentRoutes.ts - Environment route definitions

import { Router } from 'express';
import environmentController from '../controllers/environmentController';
import auth from '../middlewares/auth';

const router = Router({ mergeParams: true });

// Authentication and project access validation
router.use(auth.authenticate);
router.use(auth.validateProjectAccess);

// Environment CRUD routes
router.post('/', environmentController.createEnvironment.bind(environmentController));
router.get('/', environmentController.listEnvironments.bind(environmentController));
router.get('/:environmentId', environmentController.getEnvironment.bind(environmentController));
router.put('/:environmentId', environmentController.updateEnvironment.bind(environmentController));
router.delete('/:environmentId', environmentController.deleteEnvironment.bind(environmentController));

export default router;

// src/routes/tokenRoutes.ts - Token route definitions

import { Router } from 'express';
import tokenController from '../controllers/tokenController';
import auth from '../middlewares/auth';

const router = Router({ mergeParams: true });

// Authentication and project access validation
router.use(auth.authenticate);
router.use(auth.validateProjectAccess);

// Token CRUD routes
router.post('/', tokenController.createToken.bind(tokenController));
router.get('/', tokenController.listTokens.bind(tokenController));
router.ge

import { Request, Response, NextFunction } from 'express';
import { AuthRequest, AuthToken } from '../types';
import Database from '../db';
import logger from '../utils/logger';

/**
 * Authentication middleware that validates API tokens
 */
export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      res.status(401).json({ message: 'Authorization header missing' });
      return;
    }
    
    // Extract token from Authorization header
    // Format: "token=YOUR_TOKEN_HERE" or "Bearer YOUR_TOKEN_HERE"
    let token: string;
    if (authHeader.startsWith('token=')) {
      token = authHeader.substring(6);
    } else if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      res.status(401).json({ message: 'Invalid authorization format' });
      return;
    }
    
    if (!token) {
      res.status(401).json({ message: 'No token provided' });
      return;
    }
    
    // Get database instance
    const db = Database.getInstance({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'audit_logs',
    });
    
    // Check if token exists and is valid
    const result = await db.query(`
      SELECT 
        api_tokens.id,
        api_tokens.project_id as "projectId",
        api_tokens.environment_id as "environmentId",
        api_tokens.is_active
      FROM api_tokens
      WHERE token = $1 AND expires_at > NOW() AND is_active = TRUE
    `, [token]);
    
    if (result.rows.length === 0) {
      res.status(401).json({ message: 'Invalid or expired token' });
      return;
    }
    
    const tokenData = result.rows[0];
    
    // Add token data to request object
    req.token = {
      projectId: tokenData.projectId,
      environmentId: tokenData.environmentId,
      isAdmin: false
    };
    
    next();
    
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(500).json({ message: 'Authentication failed' });
  }
}

/**
 * Middleware to check if the user has admin access
 */
export function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.token || !req.token.isAdmin) {
    res.status(403).json({ message: 'Admin access required' });
    return;
  }
  
  next();
}

/**
 * Middleware to validate project access
 */
export function validateProjectAccess(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  const projectId = req.params.projectId;
  
  if (!req.token || req.token.projectId !== projectId) {
    res.status(403).json({ message: 'Insufficient permissions for this project' });
    return;
  }
  
  next();
}

export default {
  authenticate,
  requireAdmin,
  validateProjectAccess,
};


==================================================================================================================================================================================================================

/**
 * Main entry point for the audit-log package
 * Exports everything needed for consumers to use the package
 */

// src/index.ts

// Import core classes and types
import { Database } from './database/database';
import { CryptoService } from './services/crypto.service';
import { EventRepository } from './repository/event.repository';
import { EventService } from './services/event.service';
import { AuditLogClient } from './client/audit-log.client';

// Import and re-export all types for consumers
export * from './types';

// Export the core classes
export {
  Database,
  CryptoService,
  EventRepository,
  EventService,
  AuditLogClient
};

/**
 * Factory function to create and initialize the audit log client
 * @param config Configuration for the audit log
 * @returns Initialized AuditLogClient
 */
export function createAuditLogClient(config: {
  // Database configuration
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    ssl?: boolean;
    poolSize?: number;
    idleTimeoutMillis?: number;
    debug?: boolean;
  },
  // Crypto configuration
  crypto: {
    algorithm?: string;
    hashAlgorithm?: string;
    privateKey: string;
    publicKey: string;
  },
  // Application settings
  application?: {
    maxBulkEvents?: number;
    createEventTimeout?: number;
  },
  // Optional additional configuration
  partitionDays?: number;
  sealAfterDays?: number;
  wormEnabled?: boolean;
  wormStoragePath?: string;
  validation?: {
    validateOnQuery?: boolean;
    scheduledValidationInterval?: number;
  }
}): AuditLogClient {
  // Initialize database connection
  const database = Database.getInstance(config.database);
  
  // Initialize crypto service with default algorithm if not specified
  const cryptoService = new CryptoService({
    algorithm: config.crypto.algorithm || 'RSA-SHA256',
    hashAlgorithm: config.crypto.hashAlgorithm || 'sha256',
    privateKey: config.crypto.privateKey,
    publicKey: config.crypto.publicKey
  });
  
  // Initialize event repository
  const eventRepository = new EventRepository(database.getPool());
  
  // Initialize event service with application settings
  const eventService = new EventService(
    eventRepository,
    cryptoService,
    config.application?.maxBulkEvents || 1000,
    config.application?.createEventTimeout || 5000
  );
  
  // Return the client
  return new AuditLogClient(eventService);
}

/**
 * Initialize the database schema required for the audit log
 * @param config Database configuration
 * @returns Promise that resolves when initialization is complete
 */
export async function initializeDatabase(config: {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean;
}): Promise<void> {
  const database = Database.getInstance(config);
  
  // Create required tables if they don't exist
  await database.query(`
    -- Create audit_events table if it doesn't exist
    CREATE TABLE IF NOT EXISTS audit_events (
      id UUID PRIMARY KEY,
      action VARCHAR(255) NOT NULL,
      crud VARCHAR(10) NOT NULL,
      group_id VARCHAR(255),
      group_name VARCHAR(255),
      actor_id VARCHAR(255),
      actor_name VARCHAR(255),
      actor_href VARCHAR(1024),
      target_id VARCHAR(255),
      target_name VARCHAR(255),
      target_href VARCHAR(1024),
      target_type VARCHAR(255),
      source_ip VARCHAR(50),
      description TEXT,
      is_anonymous BOOLEAN DEFAULT FALSE,
      is_failure BOOLEAN DEFAULT FALSE,
      component VARCHAR(255),
      version VARCHAR(50),
      external_id VARCHAR(255),
      fields JSONB,
      metadata JSONB,
      created_at TIMESTAMP NOT NULL,
      received_at TIMESTAMP NOT NULL,
      project_id VARCHAR(255) NOT NULL,
      environment_id VARCHAR(255) NOT NULL,
      hash VARCHAR(128) NOT NULL,
      previous_hash VARCHAR(128),
      signature TEXT NOT NULL,
      actor_fields JSONB,
      target_fields JSONB
    );

    -- Create indexes for efficient querying if they don't exist
    CREATE INDEX IF NOT EXISTS idx_audit_events_project_env ON audit_events(project_id, environment_id);
    CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_events_actor_id ON audit_events(actor_id);
    CREATE INDEX IF NOT EXISTS idx_audit_events_target_id ON audit_events(target_id);
    CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action);

    -- Create tables for resilience
    CREATE TABLE IF NOT EXISTS ingest_task (
      id UUID PRIMARY KEY,
      original_event JSONB NOT NULL,
      project_id VARCHAR(255) NOT NULL,
      environment_id VARCHAR(255) NOT NULL,
      new_event_id UUID NOT NULL,
      received TIMESTAMP NOT NULL,
      processed BOOLEAN DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS backlog (
      id SERIAL PRIMARY KEY,
      project_id VARCHAR(255) NOT NULL,
      environment_id VARCHAR(255) NOT NULL,
      new_event_id UUID NOT NULL,
      received TIMESTAMP NOT NULL,
      original_event JSONB NOT NULL,
      processed BOOLEAN DEFAULT FALSE,
      attempts INTEGER DEFAULT 0,
      last_attempt TIMESTAMP
    );
  `);
}


/**
 * Example usage of the audit-log package in another codebase
 */

// Import the package in your application
import { createAuditLogClient, initializeDatabase, AuditLogClient, CreateEventRequest } from 'audit-log-package';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Initialize the audit log client with configuration
 * You can do this during your application startup
 */
async function setupAuditLog(): Promise<AuditLogClient> {
  try {
    // Step 1: Initialize database schema if needed
    // This is typically done once during application deployment
    // or first run, not on every startup
    if (process.env.INIT_DB === 'true') {
      await initializeDatabase({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'audit_logs',
        ssl: process.env.DB_SSL === 'true'
      });
      console.log('Database schema initialized successfully');
    }
    
    // Step 2: Create and configure the audit log client
    const auditLogClient = createAuditLogClient({
      // Database configuration
      database: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'audit_logs',
        ssl: process.env.DB_SSL === 'true',
        // Optional database settings
        poolSize: parseInt(process.env.DB_POOL_SIZE || '20'),
        idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
        debug: process.env.DB_DEBUG === 'true'
      },
      
      // Cryptographic settings (required)
      crypto: {
        privateKey: process.env.CRYPTO_PRIVATE_KEY || '', // Required
        publicKey: process.env.CRYPTO_PUBLIC_KEY || '',   // Required
        algorithm: process.env.CRYPTO_ALGORITHM || 'RSA-SHA256',
        hashAlgorithm: process.env.CRYPTO_HASH_ALGORITHM || 'sha256'
      },
      
      // Application settings
      application: {
        maxBulkEvents: parseInt(process.env.MAX_BULK_EVENTS || '1000'),
        createEventTimeout: parseInt(process.env.CREATE_EVENT_TIMEOUT || '5000')
      },
      
      // Optional additional settings
      partitionDays: parseInt(process.env.PARTITION_DAYS || '7'),
      sealAfterDays: parseInt(process.env.SEAL_AFTER_DAYS || '30'),
      wormEnabled: process.env.WORM_ENABLED === 'true',
      wormStoragePath: process.env.WORM_STORAGE_PATH || './worm-storage',
      validation: {
        validateOnQuery: process.env.VALIDATE_ON_QUERY === 'true',
        scheduledValidationInterval: parseInt(process.env.VALIDATION_INTERVAL || '86400')
      }
    });
    
    // Step 3: Set default project and environment
    auditLogClient.setContext(
      process.env.PROJECT_ID || 'default-project',
      process.env.ENVIRONMENT || 'development'
    );
    
    console.log('Audit log client initialized successfully');
    return auditLogClient;
    
  } catch (error) {
    console.error('Failed to initialize audit log:', error);
    throw error;
  }
}

/**
 * Example function that uses the audit log client in an Express middleware
 */
export function createAuditMiddleware(auditLogClient: AuditLogClient) {
  return async (req: any, res: any, next: any) => {
    // Save the original end function
    const originalEnd = res.end;
    
    // Override the end function to log after response is sent
    res.end = async function(...args: any[]) {
      // Call the original end function
      originalEnd.apply(res, args);
      
      try {
        // Create the audit event
        const event: CreateEventRequest = {
          action: `api.${req.method.toLowerCase()}`,
          crud: mapMethodToCrud(req.method),
          actor: {
            id: req.user?.id || 'anonymous',
            name: req.user?.name || 'Anonymous User'
          },
          target: {
            id: req.originalUrl,
            name: `API Endpoint: ${req.originalUrl}`,
            type: 'endpoint'
          },
          source_ip: req.ip,
          description: `${req.method} request to ${req.originalUrl}`,
          is_anonymous: !req.user,
          is_failure: res.statusCode >= 400,
          component: 'api',
          version: process.env.API_VERSION || '1.0',
          fields: {
            statusCode: res.statusCode,
            method: req.method,
            path: req.path,
            query: req.query
          }
        };
        
        await auditLogClient.createEvent(event);
      } catch (error) {
        // Don't let audit logging errors affect the API response
        console.error('Failed to create audit log:', error);
      }
    };
    
    next();
  };
}

/**
 * Map HTTP method to CRUD operation
 */
function mapMethodToCrud(method: string): 'create' | 'read' | 'update' | 'delete' {
  switch (method.toUpperCase()) {
    case 'POST':
      return 'create';
    case 'GET':
      return 'read';
    case 'PUT':
    case 'PATCH':
      return 'update';
    case 'DELETE':
      return 'delete';
    default:
      return 'read';
  }
}

/**
 * Example usage in an Express application
 */
async function setupExampleApp() {
  // Initialize the audit log client
  const auditLogClient = await setupAuditLog();
  
  // Create Express app
  const express = require('express');
  const app = express();
  
  // Add audit log middleware to all routes
  app.use(createAuditMiddleware(auditLogClient));
  
  // Your route handlers
  app.get('/users/:id', (req: any, res: any) => {
    // Your handler logic
    res.json({ id: req.params.id, name: 'Example User' });
  });
  
  // Example of manually logging an event
  app.post('/login', async (req: any, res: any) => {
    // Authentication logic
    const user = { id: '123', name: 'Example User' };
    
    try {
      // Manually log the login event
      await auditLogClient.createEvent({
        action: 'user.login',
        crud: 'read',
        actor: {
          id: user.id,
          name: user.name
        },
        source_ip: req.ip,
        description: 'User logged in successfully',
        component: 'authentication'
      });
      
      // Send response
      res.json({ success: true, user });
    } catch (error) {
      console.error('Login or audit log failed:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });
  
  // Start server
  app.listen(3000, () => {
    console.log('Server started on port 3000');
  });
  
  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully');
    
    // Close database connections
    await auditLogClient.close();
    
    process.exit(0);
  });
}

// Run the example
setupExampleApp().catch(console.error);

{
  "name": "audit-log-package",
  "version": "1.0.0",
  "description": "Secure, tamper-evident audit logging system with blockchain-style verification",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "lint": "eslint src/**/*.ts",
    "prepare": "npm run build"
  },
  "keywords": [
    "audit",
    "logging",
    "security",
    "immutable",
    "tamper-evident"
  ],
  "author": "Your Name",
  "license": "MIT",
  "devDependencies": {
    "@types/jest": "^29.5.1",
    "@types/node": "^18.16.0",
    "@types/pg": "^8.6.6",
    "@typescript-eslint/eslint-plugin": "^5.59.1",
    "@typescript-eslint/parser": "^5.59.1",
    "eslint": "^8.39.0",
    "jest": "^29.5.0",
    "ts-jest": "^29.1.0",
    "typescript": "^5.0.4"
  },
  "dependencies": {
    "crypto": "^1.0.1",
    "pg": "^8.11.0",
    "pg-format": "^1.0.4",
    "uuid": "^9.0.0"
  },
  "engines": {
    "node": ">=16.0.0"
  },
  "files": [
    "dist",
    "LICENSE",
    "README.md"
  ]
}


====================== 
How to Use the Audit Log Package in Your Project
The package has been designed to be easily integrated into any TypeScript/JavaScript application. Here's how to use it:
1. Installation
First, you would install the package from npm:
npm install audit-log-package

2. Initialization
In your application's startup code, you'll need to initialize the audit log client with your configuration:
import { createAuditLogClient } from 'audit-log-package';

// Create the client with your configuration
const auditLogClient = createAuditLogClient({
  // Database connection details
  database: {
    host: process.env.AUDIT_DB_HOST || 'localhost',
    port: parseInt(process.env.AUDIT_DB_PORT || '5432'),
    user: process.env.AUDIT_DB_USER || 'postgres',
    password: process.env.AUDIT_DB_PASSWORD || '',
    database: process.env.AUDIT_DB_NAME || 'audit_logs'
  },
  
  // Cryptographic keys for signing and verifying audit entries
  crypto: {
    privateKey: process.env.AUDIT_PRIVATE_KEY || '',
    publicKey: process.env.AUDIT_PUBLIC_KEY || ''
  }
});

// Set the default project and environment context
auditLogClient.setContext('your-project-id', 'production');


3. Creating Audit Events
You can now create audit events throughout your application:
typescript// Log a user action
await auditLogClient.createEvent({
  action: 'user.create',
  crud: 'create',
  actor: {
    id: 'admin-123',
    name: 'Administrator'
  },
  target: {
    id: 'user-456',
    name: 'John Doe',
    type: 'user'
  },
  description: 'Created a new user account'
});
4. Bulk Event Creation
For high-throughput applications, you can create multiple events at once:
typescriptawait auditLogClient.createEvents({
  events: [
    {
      action: 'document.view',
      crud: 'read',
      actor: { id: 'user-123' },
      target: { id: 'doc-456', type: 'document' }
    },
    {
      action: 'document.download',
      crud: 'read',
      actor: { id: 'user-123' },
      target: { id: 'doc-456', type: 'document' }
    }
  ]
});
5. Database Setup
Before using the package for the first time, you'll need to initialize the database schema:
typescriptimport { initializeDatabase } from 'audit-log-package';

// Run this during application deployment or first run
await initializeDatabase({
  host: process.env.AUDIT_DB_HOST || 'localhost',
  port: parseInt(process.env.AUDIT_DB_PORT || '5432'),
  user: process.env.AUDIT_DB_USER || 'postgres',
  password: process.env.AUDIT_DB_PASSWORD || '',
  database: process.env.AUDIT_DB_NAME || 'audit_logs'
});
6. Cleanup
When your application is shutting down, close the database connections:
typescript// In your shutdown handler
process.on('SIGTERM', async () => {
  await auditLogClient.close();
  process.exit(0);
});
Key Features

Configuration Flexibility: All settings can be passed during initialization
Project/Environment Context: Set default context once and use throughout your app
Resilient Event Storage: Failed events are stored in a backlog
Cryptographic Verification: Events are cryptographically signed and chained
Database Connection Management: Connection pooling for optimal performance

The main package entry point (index.ts) exports everything you need, and the configuration options provide flexibility for different deployment environments. You can store sensitive information like database credentials and crypto keys in environment variables for security.


