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
 * Configuration interface for the audit log client
 */
export interface AuditLogConfig {
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
  };
  // Crypto configuration
  crypto: {
    algorithm?: string;
    hashAlgorithm?: string;
    privateKey: string;
    publicKey: string;
  };
  // Application settings
  application?: {
    maxBulkEvents?: number;
    createEventTimeout?: number;
  };
  // Optional additional configuration
  partitionDays?: number;
  sealAfterDays?: number;
  wormEnabled?: boolean;
  wormStoragePath?: string;
  validation?: {
    validateOnQuery?: boolean;
    scheduledValidationInterval?: number;
  };
  // Default context (optional)
  context?: {
    projectId?: string;
    environmentId?: string;
  };
}

/**
 * Factory function to create and initialize the audit log client
 * @param config Configuration for the audit log
 * @returns Initialized AuditLogClient
 * @throws Error if required configuration is missing
 */
export function createAuditLogClient(config: AuditLogConfig): AuditLogClient {
  // Validate required configuration
  validateConfig(config);
  
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
  
  // Create the client
  const client = new AuditLogClient(eventService);
  
  // Set default context if provided
  if (config.context?.projectId && config.context?.environmentId) {
    client.setContext(config.context.projectId, config.context.environmentId);
  }
  
  return client;
}

/**
 * Validates the provided configuration
 * @param config Configuration to validate
 * @throws Error if required configuration is missing
 */
function validateConfig(config: AuditLogConfig): void {
  // Check if database config exists
  if (!config.database) {
    throw new Error('Database configuration is required');
  }
  
  // Check required database properties
  const requiredDbProps = ['host', 'port', 'user', 'database'];
  for (const prop of requiredDbProps) {
    if (!config.database[prop as keyof typeof config.database]) {
      throw new Error(`Database.${prop} is required`);
    }
  }
  
  // Check if crypto config exists
  if (!config.crypto) {
    throw new Error('Crypto configuration is required');
  }
  
  // Check required crypto properties
  if (!config.crypto.privateKey) {
    throw new Error('Crypto.privateKey is required');
  }
  
  if (!config.crypto.publicKey) {
    throw new Error('Crypto.publicKey is required');
  }
}

/**
 * Database configuration interface for initialization
 */
export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean;
}

/**
 * Initialize the database schema required for the audit log
 * @param config Database configuration
 * @returns Promise that resolves when initialization is complete
 */
export async function initializeDatabase(config: DatabaseConfig): Promise<void> {
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
