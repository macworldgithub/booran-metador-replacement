import { BadGatewayException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { StoreService } from '../database/store.service';
import type { PortalActor } from '../conversations/conversations.service';
import { sanitizeLiveLeads } from './live-leads';

export const connectionStates = ['disconnected', 'connecting', 'connected', 'login_required', 'error'] as const;
export interface ConnectionStatus {
  state: typeof connectionStates[number];
  operation: 'login' | 'check' | 'read' | null;
  lastCheckedAt: string | null;
  lastConnectedAt: string | null;
  errorCode: string | null;
  message: string;
  interactiveLoginEnabled: boolean;
  sessionExpiresAt: string | null;
  rooftops: { id: string; name: string; verified: boolean }[];
}
const roofs = [
  ['cranbourne_kia', 'Cranbourne Kia'],
  ['cranbourne_mg', 'Cranbourne MG'],
  ['geely_cranbourne', 'Geely Cranbourne'],
];

// Whitelist response fields; browser storage and arbitrary upstream data cannot cross this boundary.
export function sanitizeConnection(value: unknown): ConnectionStatus {
  const data = value as Partial<ConnectionStatus> | null;
  const validDate = (value: unknown) => value === null || typeof value === 'string' && Number.isFinite(Date.parse(value));
  if (!data || !connectionStates.includes(data.state!) ||
    ![null, 'login', 'check', 'read'].includes(data.operation!) ||
    !validDate(data.lastCheckedAt) || !validDate(data.lastConnectedAt) || !validDate(data.sessionExpiresAt) ||
    typeof data.message !== 'string' || data.message.length > 500 ||
    !(data.errorCode === null || typeof data.errorCode === 'string' && /^[a-z_]{1,60}$/.test(data.errorCode)) ||
    typeof data.interactiveLoginEnabled !== 'boolean' || !Array.isArray(data.rooftops) ||
    data.rooftops.length !== roofs.length || roofs.some(([id, name]) =>
      !data.rooftops!.some(roof => roof.id === id && roof.name === name && typeof roof.verified === 'boolean')))
    throw new BadGatewayException('Invalid DealerSocket connector response');
  return {
    state: data.state!, operation: data.operation!, lastCheckedAt: data.lastCheckedAt!,
    lastConnectedAt: data.lastConnectedAt!, sessionExpiresAt: data.sessionExpiresAt!,
    errorCode: data.errorCode!, message: data.message, interactiveLoginEnabled: data.interactiveLoginEnabled,
    rooftops: roofs.map(([id, name]) => ({ id, name, verified: data.rooftops!.find(roof => roof.id === id)!.verified })),
  };
}

@Injectable()
export class DealerSocketService {
  constructor(private readonly store: StoreService) {}

  async request(action: 'status' | 'check' | 'login/start', actor?: PortalActor): Promise<ConnectionStatus>;
  async request(action: 'leads/status' | 'leads/read', actor: PortalActor): Promise<ReturnType<typeof sanitizeLiveLeads>>;
  async request(action: 'status' | 'check' | 'login/start' | 'leads/status' | 'leads/read', actor?: PortalActor) {
    const base = process.env.DEALERSOCKET_CONNECTOR_URL || 'http://127.0.0.1:8000';
    const key = process.env.DEALERSOCKET_CONNECTOR_KEY || '';
    if (key.length < 32) throw new ServiceUnavailableException('DealerSocket connector is not configured');
    // Configuration is server-side only. No user-supplied URLs, paths or credentials are accepted.
    let target: URL;
    try { target = new URL(base); }
    catch { throw new ServiceUnavailableException('Invalid DealerSocket connector configuration'); }
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash)
      throw new ServiceUnavailableException('Invalid DealerSocket connector configuration');
    if (target.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname))
      throw new ServiceUnavailableException('Remote DealerSocket connectors require HTTPS');
    const read = ['status','leads/status'].includes(action);
    if (!read) await this.store.audit(action === 'leads/read' ? 'dealersocket_snapshot_requested' : 'dealersocket_session_requested', actor, { action });
    try {
      const result = await axios.request<unknown>({
        url: `${base.replace(/\/$/, '')}/dealersocket/${action}`,
        method: read ? 'GET' : 'POST',
        ...(action === 'leads/read' ? { data: { maxRecords: 1000, detailLimit: 200 } } : {}),
        headers: { 'X-Connector-Key': key, Accept: 'application/json' },
        timeout: 10000, maxRedirects: 0, maxContentLength: action.startsWith('leads/') ? 8 * 1024 * 1024 : 65536,
      });
      return action.startsWith('leads/') ? sanitizeLiveLeads(result.data, actor!) : sanitizeConnection(result.data);
    } catch (error: unknown) {
      if (error instanceof BadGatewayException) throw error;
      if (axios.isAxiosError(error) && error.response?.status === 409)
        throw new ConflictException('The DealerSocket browser is busy. Wait for the current operation to finish.');
      // Never forward Axios errors, request headers, session tokens or upstream error bodies.
      throw new ServiceUnavailableException('DealerSocket connector is unavailable. Check the automation PC and connector configuration.');
    }
  }
}
