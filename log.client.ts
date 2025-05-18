// src/client/audit-log.client.ts

import { EventService } from '../services/event.service';
import { 
  CreateEventRequest, 
  Event, 
  EventQuery, 
  EventQueryResult, 
  ValidationResult 
} from '../types';

/**
 * Main client class for the audit log package
 * Provides the public API for consumers to interact with audit logging functionality
 */
export class AuditLogClient {
  private projectId: string | null = null;
  private environmentId: string | null = null;

  /**
   * Creates a new AuditLogClient instance
   * @param eventService The EventService to handle event operations
   */
  constructor(private readonly eventService: EventService) {}

  /**
   * Sets the default context (project and environment) for audit events
   * @param projectId The project identifier
   * @param environmentId The environment identifier
   */
  setContext(projectId: string, environmentId: string): void {
    this.projectId = projectId;
    this.environmentId = environmentId;
  }

  /**
   * Creates a new audit event
   * @param event The event data to create
   * @returns Promise resolving to the created event
   * @throws Error if context hasn't been set or event creation fails
   */
  async createEvent(event: CreateEventRequest): Promise<Event> {
    this.validateContext();
    
    // Apply context to the event
    const eventWithContext = {
      ...event,
      project_id: event.project_id || this.projectId!,
      environment_id: event.environment_id || this.environmentId!
    };
    
    return this.eventService.createEvent(eventWithContext);
  }

  /**
   * Creates multiple audit events in a single transaction
   * @param events Array of event data to create
   * @returns Promise resolving to an array of created events
   * @throws Error if context hasn't been set or bulk creation fails
   */
  async createEvents(events: CreateEventRequest[]): Promise<Event[]> {
    this.validateContext();
    
    // Apply context to all events
    const eventsWithContext = events.map(event => ({
      ...event,
      project_id: event.project_id || this.projectId!,
      environment_id: event.environment_id || this.environmentId!
    }));
    
    return this.eventService.createEvents(eventsWithContext);
  }

  /**
   * Queries audit events based on search criteria
   * @param query The query parameters
   * @returns Promise resolving to query results with pagination
   */
  async queryEvents(query: EventQuery): Promise<EventQueryResult> {
    this.validateContext();
    
    // Apply context to the query if not explicitly provided
    const queryWithContext = {
      ...query,
      project_id: query.project_id || this.projectId!,
      environment_id: query.environment_id || this.environmentId!
    };
    
    return this.eventService.queryEvents(queryWithContext);
  }

  /**
   * Retrieves a single event by its ID
   * @param eventId The UUID of the event to retrieve
   * @returns Promise resolving to the event if found, null otherwise
   */
  async getEvent(eventId: string): Promise<Event | null> {
    this.validateContext();
    return this.eventService.getEvent(eventId, this.projectId!, this.environmentId!);
  }

  /**
   * Validates the integrity of events in a specified time range
   * @param startTime Start of time range to validate
   * @param endTime End of time range to validate
   * @returns Promise resolving to validation results
   */
  async validateEvents(startTime: Date, endTime: Date): Promise<ValidationResult> {
    this.validateContext();
    return this.eventService.validateEvents(
      this.projectId!,
      this.environmentId!,
      startTime,
      endTime
    );
  }

  /**
   * Seals events up to a specified time, preventing further modifications
   * @param upToTime The time up to which events should be sealed
   * @returns Promise resolving to the number of sealed events
   */
  async sealEvents(upToTime: Date): Promise<number> {
    this.validateContext();
    return this.eventService.sealEvents(
      this.projectId!,
      this.environmentId!,
      upToTime
    );
  }

  /**
   * Exports events to WORM storage for additional tamper protection
   * @param startTime Start of time range to export
   * @param endTime End of time range to export
   * @returns Promise resolving to the number of exported events
   */
  async exportToWorm(startTime: Date, endTime: Date): Promise<number> {
    this.validateContext();
    return this.eventService.exportToWorm(
      this.projectId!,
      this.environmentId!,
      startTime,
      endTime
    );
  }

  /**
   * Closes all connections and resources used by the client
   * Should be called during application shutdown
   */
  async close(): Promise<void> {
    await this.eventService.close();
  }

  /**
   * Validates that context has been set
   * @throws Error if context hasn't been set
   * @private
   */
  private validateContext(): void {
    if (!this.projectId || !this.environmentId) {
      throw new Error('Context not set. Call setContext() before performing operations.');
    }
  }
}
