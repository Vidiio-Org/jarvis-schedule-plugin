export interface FakeBridgeOptions {
  port?: number;
  token?: string;
  workspaces?: Array<{ id: string; name: string; path: string }>;
  squads?: Array<{ id: string; name: string; description?: string; agents?: unknown[]; modelPool?: string[]; agentModels?: Record<string, string> }>;
  /** Finish every created mission automatically after this many ms. */
  autoFinishMs?: number;
  /** Emulate an old Bridge: no `models` in the catalog, modelPool/agentModels ignored. */
  legacy?: boolean;
  models?: Array<{ id: string; label: string; adapter: string; tier?: string; cost?: string }>;
  maestros?: Array<{ id: string; label: string; available: boolean }>;
  /** Attachment pantry capacity before the oldest id is evicted (default 500). */
  attachmentRegistryMax?: number;
}

export interface FakeRequest {
  method: string;
  path: string;
  body: any;
  authorized: boolean;
}

export interface FakeBridge {
  state: any;
  token: string;
  port: number;
  url: string;
  missions: any[];
  requests: FakeRequest[];
  createRequests: FakeRequest[];
  uploadRequests: FakeRequest[];
  attachments: Array<{ id: string; name: string; mime: string; size: number; data: string }>;
  finishMission(
    id: string,
    opts?: {
      status?: 'done' | 'failed' | 'aborted';
      summary?: string;
      usd?: number;
      tasks?: Array<{ title: string; status?: string; result?: string | null }>;
      cards?: Array<{ title: string; description?: string; docs?: string }>;
    }
  ): any;
  publish(id: string): void;
  dropSseClients(): void;
  stop(): Promise<void>;
}

export function startFakeBridge(options?: FakeBridgeOptions): Promise<FakeBridge>;
