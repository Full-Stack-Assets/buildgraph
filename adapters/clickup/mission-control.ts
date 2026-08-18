import type { ClickUpClient } from "./client.js";
import type { IdempotencyStore } from "./idempotency.js";
import type { BoundedAsyncQueue } from "./queue.js";
import type { ClickUpRateLimitSnapshot } from "./types.js";

export const MISSION_CONTROL_LANES = [
  "command_queue",
  "canonical_registry",
  "integration_registry",
  "runtime_agent_work",
  "approvals_policy_gates",
  "exceptions_blockers",
  "evidence_verification",
  "event_fabric_automations",
  "durable_workflows",
  "observability_health",
  "routing_reputation_experiments",
  "autonomous_domain_loops"
] as const;

export type MissionControlLane = typeof MISSION_CONTROL_LANES[number];

export type MissionControlConfig = {
  workspaceId: string;
  lists: Record<MissionControlLane, string>;
};

export type ClickUpMissionControlOptions = {
  client: ClickUpClient;
  config: MissionControlConfig;
  idempotencyStore: IdempotencyStore;
  queue: BoundedAsyncQueue;
  pendingLeaseMs?: number;
  now?: () => number;
};

export type CreateWorkItemInput = {
  lane: MissionControlLane;
  name: string;
  description?: string;
  status?: string;
  priority?: number;
  dueDateMs?: number;
  approvalRecordReference?: string;
  idempotencyKey: string;
};

export type UpdateWorkItemInput = {
  taskId: string;
  name?: string;
  description?: string;
  status?: string;
  priority?: number;
  dueDateMs?: number;
  approvalRecordReference?: string;
  idempotencyKey: string;
};

export type AddCommentInput = {
  taskId: string;
  commentText: string;
  idempotencyKey: string;
};

export type CreatedWorkItem = {
  action: "created";
  taskId: string;
  taskUrl?: string;
};

export type UpdatedWorkItem = {
  action: "updated";
  taskId: string;
  taskUrl?: string;
};

export type AddedComment = {
  action: "commented";
  taskId: string;
  commentId: string;
};

export type MissionControlHealth = {
  workspaceId: string;
  queue: {
    active: number;
    pending: number;
  };
  rateLimit: ClickUpRateLimitSnapshot | null;
  lastError: string | null;
};

export type MissionControlConnectionVerification = {
  authorized: true;
  userId: string;
  workspaceId: string;
  spaceCount: number;
};

type ClickUpTaskResponse = {
  id?: string | number;
  url?: string;
  [key: string]: unknown;
};

type ClickUpCommentResponse = {
  id?: string | number;
  [key: string]: unknown;
};

type ClickUpAuthorizedUserResponse = {
  user?: {
    id?: string | number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type ClickUpSpacesResponse = {
  spaces?: unknown[];
  [key: string]: unknown;
};

const PROTECTED_STATUSES = new Set([
  "approved",
  "approval",
  "release",
  "released",
  "release ready",
  "ready for release",
  "complete",
  "completed",
  "closed",
  "done"
]);
const DEFAULT_PENDING_LEASE_MS = 15 * 60 * 1000;

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown ClickUp adapter error";
}

function isProtectedStatus(status: string): boolean {
  return PROTECTED_STATUSES.has(status.trim().toLowerCase().replaceAll("_", " ").replaceAll("-", " "));
}

function assertApprovalForStatus(status: string | undefined, approvalRecordReference: string | undefined): void {
  if (status !== undefined && isProtectedStatus(status)) {
    if (approvalRecordReference === undefined || approvalRecordReference.trim() === "") {
      throw new Error("approval record reference required for protected status transition");
    }
  }
}

function normalizedTaskId(response: ClickUpTaskResponse, fallback: string): string {
  if (response.id === undefined || response.id === null) {
    return fallback;
  }
  return String(response.id);
}

export class ClickUpMissionControl {
  readonly #client: ClickUpClient;
  readonly #config: MissionControlConfig;
  readonly #idempotencyStore: IdempotencyStore;
  readonly #queue: BoundedAsyncQueue;
  readonly #pendingLeaseMs: number;
  readonly #now: () => number;
  #lastError: string | null = null;

  constructor(options: ClickUpMissionControlOptions) {
    requireNonEmpty(options.config.workspaceId, "ClickUp workspace ID");
    for (const lane of MISSION_CONTROL_LANES) {
      requireNonEmpty(options.config.lists[lane], `ClickUp list ID for ${lane}`);
    }

    const pendingLeaseMs = options.pendingLeaseMs ?? DEFAULT_PENDING_LEASE_MS;
    if (!Number.isFinite(pendingLeaseMs) || pendingLeaseMs <= 0) {
      throw new Error("pending mutation lease must be greater than zero milliseconds");
    }

    this.#client = options.client;
    this.#config = options.config;
    this.#idempotencyStore = options.idempotencyStore;
    this.#queue = options.queue;
    this.#pendingLeaseMs = pendingLeaseMs;
    this.#now = options.now ?? Date.now;
  }

  async verifyConnection(): Promise<MissionControlConnectionVerification> {
    try {
      const userResponse = await this.#client.request<ClickUpAuthorizedUserResponse>("GET", "/user");
      const userId = userResponse.user?.id;
      if (userId === undefined || userId === null) {
        throw new Error("ClickUp authorized user response did not include a user ID");
      }

      const workspaceId = this.#config.workspaceId;
      const spacesResponse = await this.#client.request<ClickUpSpacesResponse>(
        "GET",
        `/team/${encodeURIComponent(workspaceId)}/space?archived=false`
      );
      const spaces = Array.isArray(spacesResponse.spaces) ? spacesResponse.spaces : [];
      this.#lastError = null;

      return {
        authorized: true,
        userId: String(userId),
        workspaceId,
        spaceCount: spaces.length
      };
    } catch (error) {
      this.#lastError = errorMessage(error);
      throw error;
    }
  }

  async createWorkItem(input: CreateWorkItemInput): Promise<CreatedWorkItem> {
    const listId = this.#resolveLane(input.lane);
    const name = requireNonEmpty(input.name, "work item name");
    assertApprovalForStatus(input.status, input.approvalRecordReference);

    const body: Record<string, unknown> = { name };
    if (input.description !== undefined) body.description = input.description;
    if (input.status !== undefined) body.status = input.status;
    if (input.priority !== undefined) body.priority = input.priority;
    if (input.dueDateMs !== undefined) body.due_date = input.dueDateMs;

    return await this.#mutate(input.idempotencyKey, async () => {
      const response = await this.#client.request<ClickUpTaskResponse>(
        "POST",
        `/list/${encodeURIComponent(listId)}/task`,
        body
      );
      const result: CreatedWorkItem = {
        action: "created",
        taskId: normalizedTaskId(response, "unknown")
      };
      if (response.url !== undefined) result.taskUrl = response.url;
      return result;
    });
  }

  async updateWorkItem(input: UpdateWorkItemInput): Promise<UpdatedWorkItem> {
    const taskId = requireNonEmpty(input.taskId, "ClickUp task ID");
    assertApprovalForStatus(input.status, input.approvalRecordReference);

    const body: Record<string, unknown> = {};
    if (input.name !== undefined) body.name = input.name;
    if (input.description !== undefined) body.description = input.description;
    if (input.status !== undefined) body.status = input.status;
    if (input.priority !== undefined) body.priority = input.priority;
    if (input.dueDateMs !== undefined) body.due_date = input.dueDateMs;
    if (Object.keys(body).length === 0) {
      throw new Error("at least one ClickUp task field must be updated");
    }

    return await this.#mutate(input.idempotencyKey, async () => {
      const response = await this.#client.request<ClickUpTaskResponse>(
        "PUT",
        `/task/${encodeURIComponent(taskId)}`,
        body
      );
      const result: UpdatedWorkItem = {
        action: "updated",
        taskId: normalizedTaskId(response, taskId)
      };
      if (response.url !== undefined) result.taskUrl = response.url;
      return result;
    });
  }

  async addComment(input: AddCommentInput): Promise<AddedComment> {
    const taskId = requireNonEmpty(input.taskId, "ClickUp task ID");
    const commentText = requireNonEmpty(input.commentText, "comment text");

    return await this.#mutate(input.idempotencyKey, async () => {
      const response = await this.#client.request<ClickUpCommentResponse>(
        "POST",
        `/task/${encodeURIComponent(taskId)}/comment`,
        {
          comment_text: commentText,
          notify_all: false
        }
      );
      if (response.id === undefined || response.id === null) {
        throw new Error("ClickUp comment response did not include an ID");
      }
      return {
        action: "commented",
        taskId,
        commentId: String(response.id)
      };
    });
  }

  async getTask(taskId: string): Promise<ClickUpTaskResponse> {
    const normalizedId = requireNonEmpty(taskId, "ClickUp task ID");
    try {
      const response = await this.#client.request<ClickUpTaskResponse>(
        "GET",
        `/task/${encodeURIComponent(normalizedId)}`
      );
      this.#lastError = null;
      return response;
    } catch (error) {
      this.#lastError = errorMessage(error);
      throw error;
    }
  }

  health(): MissionControlHealth {
    return {
      workspaceId: this.#config.workspaceId,
      queue: {
        active: this.#queue.active,
        pending: this.#queue.pending
      },
      rateLimit: this.#client.rateLimitSnapshot,
      lastError: this.#lastError
    };
  }

  #resolveLane(lane: MissionControlLane): string {
    if (!MISSION_CONTROL_LANES.includes(lane)) {
      throw new Error(`unknown Mission Control lane: ${String(lane)}`);
    }
    const listId = this.#config.lists[lane];
    return requireNonEmpty(listId, `ClickUp list ID for ${lane}`);
  }

  async #mutate<T>(idempotencyKey: string, operation: () => Promise<T>): Promise<T> {
    const key = requireNonEmpty(idempotencyKey, "idempotency key");
    const existing = await this.#idempotencyStore.get(key);
    if (existing?.state === "completed") {
      return existing.result as T;
    }
    if (existing?.state === "pending") {
      const startedAtMs = Date.parse(existing.startedAt);
      if (!Number.isFinite(startedAtMs) || this.#now() - startedAtMs < this.#pendingLeaseMs) {
        throw new Error(`idempotency key is already in progress: ${key}`);
      }
      await this.#idempotencyStore.release(key);
    }

    await this.#idempotencyStore.begin(key);
    try {
      const result = await this.#queue.enqueue(async () => {
        const value = await operation();
        await this.#idempotencyStore.complete(key, value);
        return value;
      });
      this.#lastError = null;
      return result;
    } catch (error) {
      await this.#idempotencyStore.release(key);
      this.#lastError = errorMessage(error);
      throw error;
    }
  }
}
