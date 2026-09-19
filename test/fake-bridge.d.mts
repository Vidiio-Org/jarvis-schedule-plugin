export interface FakeBridgeOptions {
  port?: number;
  token?: string;
  workspaces?: Array<{ id: string; name: string; path: string }>;
  squads?: Array<{ id: string; name: string; description?: string; agents?: unknown[] }>;
  /** Finish every created mission automatically after this many ms. */
  autoFinishMs?: number;
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
