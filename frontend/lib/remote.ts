import api from '@/lib/api';

// Shared frontend contract for phone pairing / remote control and the
// published live song. The control window (laptop) holds a lease and long-polls
// for commands; a paired phone submits commands with its X-Pair-Token.

// ===== Types =====

export type RemoteCommandType =
  | 'song.live' | 'song.next' | 'song.prev' | 'song.clear'
  | 'queue.add' | 'queue.remove'
  | 'bible.send' | 'bible.step' | 'bible.clear'
  | 'display.scroll' | 'display.zoom';

export interface RemoteCommand { seq: number; id: string; type: RemoteCommandType; args: any; age_ms: number; from: string }
export interface RemotePair { id: number; label: string; username: string; role: string; created_at: string; last_seen_at: string }
export interface RemoteCodeInfo { code: string; expires_at: number }
export interface ControlPollResponse { commands: RemoteCommand[]; pairs: RemotePair[]; code: RemoteCodeInfo | null; notice: string; queue_version: number; live_updated_at: number }
export interface RemoteCapabilities { songs: boolean; display: boolean; wall: boolean }
export interface PairStatus { paired: boolean; control_online: boolean; control_label: string; capabilities: RemoteCapabilities }
export interface ClaimResponse { pair_token: string; control_label: string; capabilities: RemoteCapabilities }
export type CommandStatus = 'done' | 'error' | 'offline' | 'timeout';
export interface CommandResult { status: CommandStatus; message?: string }
export interface LiveSongInfo { id: string; title: string; language: string }
export interface LiveSongState { version: number; song: LiveSongInfo | null; cleared: boolean; source: { role: string; username: string } | null; updated_at: number; queue_version: number }
export interface PanelResult { ok: boolean; message?: string }
// Empty object ({}) when there is no fresh ping for this account.
export interface SongPing { id?: string; song_id?: string; title?: string; from_role?: string; from_user?: string; created_at?: number }

// ===== Id helpers =====

// Backend validates ids against ^[A-Za-z0-9_-]{16,64}$.
function randomId(prefix: string, bytes = 16): string {
  const buf = new Uint8Array(bytes);
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c?.getRandomValues) {
    c.getRandomValues(buf);
  } else {
    for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  let hex = '';
  for (let i = 0; i < buf.length; i++) hex += buf[i].toString(16).padStart(2, '0');
  return `${prefix}${hex}`;
}

// sessionStorage: survives a reload of the same tab, but a new tab gets its own.
const CONTROL_ID_KEY = 'sat-control-id';

export function resetControlId(): string {
  const id = randomId('ctl_');
  if (typeof window !== 'undefined') {
    try { sessionStorage.setItem(CONTROL_ID_KEY, id); } catch {}
  }
  return id;
}

export function getControlId(): string {
  if (typeof window !== 'undefined') {
    try {
      const existing = sessionStorage.getItem(CONTROL_ID_KEY);
      if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
    } catch {}
  }
  return resetControlId();
}

export function newLease(): string {
  return randomId('lease_');
}

export function newCommandId(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return randomId('cmd_', 12);
}

// ===== Pair token (phone side, localStorage) =====

export const PAIR_KEY = 'sat-pair';

export function getPairToken(): string | null {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(PAIR_KEY); } catch { return null; }
}

export function setPairToken(t: string): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(PAIR_KEY, t); } catch {}
}

export function clearPairToken(): void {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(PAIR_KEY); } catch {}
}

function pairHeaders(token: string) {
  return { 'X-Pair-Token': token };
}

// ===== Error helpers =====

export function errorCode(err: any): string | undefined {
  return err?.response?.data?.code;
}

export function httpStatus(err: any): number | undefined {
  return err?.response?.status;
}

// ===== API clients =====

const LONG_POLL_TIMEOUT = 25000;
const SUBMIT_TIMEOUT = 9000;

export const remoteApi = {
  issueCode: async (controlId: string, lease: string, rotate = false): Promise<RemoteCodeInfo> => {
    const response = await api.post<RemoteCodeInfo>('/remote/control/code', { control_id: controlId, lease, rotate });
    return response.data;
  },

  cancelCode: async (controlId: string, lease: string): Promise<void> => {
    await api.delete('/remote/control/code', { params: { control_id: controlId, lease } });
  },

  poll: async (controlId: string, lease: string, wait: number, signal?: AbortSignal): Promise<ControlPollResponse> => {
    const response = await api.get<ControlPollResponse>('/remote/control/poll', {
      params: { control_id: controlId, lease, wait },
      timeout: LONG_POLL_TIMEOUT,
      signal,
    });
    return response.data;
  },

  ack: async (controlId: string, lease: string, seq: number, ok: boolean, message?: string): Promise<void> => {
    await api.post('/remote/control/ack', { control_id: controlId, lease, seq, ok, message });
  },

  unpairPhone: async (controlId: string, lease: string, pairId: number): Promise<void> => {
    await api.delete(`/remote/control/pairs/${pairId}`, { params: { control_id: controlId, lease } });
  },

  claim: async (code: string, label?: string): Promise<ClaimResponse> => {
    const response = await api.post<ClaimResponse>('/remote/pair', { code, label });
    return response.data;
  },

  unpair: async (token: string): Promise<void> => {
    await api.delete('/remote/pair', { headers: pairHeaders(token) });
  },

  status: async (token: string, signal?: AbortSignal): Promise<PairStatus> => {
    const response = await api.get<PairStatus>('/remote/pair/status', { headers: pairHeaders(token), signal });
    return response.data;
  },

  submit: async (token: string, cmd: { id: string; type: RemoteCommandType; args?: any }): Promise<CommandResult> => {
    const response = await api.post<CommandResult>('/remote/commands', cmd, {
      headers: pairHeaders(token),
      timeout: SUBMIT_TIMEOUT,
    });
    return response.data;
  },
};

export const liveSongApi = {
  publish: async (
    body: { song_id: string; title: string; language: string } | { cleared: true }
  ): Promise<LiveSongState> => {
    const response = await api.post<LiveSongState>('/live/song', body);
    return response.data;
  },

  state: async (since: number, wait: number, signal?: AbortSignal): Promise<LiveSongState> => {
    const response = await api.get<LiveSongState>('/live/state', {
      params: { since, wait },
      timeout: LONG_POLL_TIMEOUT,
      signal,
    });
    return response.data;
  },
};

// Phone viewer -> other accounts' control windows: "look at this song".
export const songPingApi = {
  send: async (songId: string, title: string): Promise<SongPing> =>
    (await api.post<SongPing>('/live/song-ping', { song_id: songId, title })).data,
  latest: async (): Promise<SongPing> => (await api.get<SongPing>('/live/song-ping')).data,
};
