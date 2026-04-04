/** User roles in the system */
export type UserRole = 'admin' | 'user' | 'sip_user';

/** Authentication state for a connected client */
export interface AuthState {
  token: string;
  username: string;
  role: UserRole;
  sipUser?: string;
  userId?: number;
  ip: string;
  connectedAt: number;
}

/** Active call channel from Asterisk AMI */
export interface Channel {
  id: string;
  callerNum: string;
  calleeNum: string;
  callerName: string;
  calleeName: string;
  state: ChannelState;
  direction: 'inbound' | 'outbound' | 'internal';
  duration: number;
  sipUser: string;
  trunk: string;
  startTime: number;
  bridgedTo?: string;
}

export type ChannelState =
  | 'ringing'
  | 'answered'
  | 'hold'
  | 'transfer'
  | 'hangup';

/** DTMF capture event */
export interface DtmfEvent {
  channel: string;
  digit: string;
  direction: 'caller' | 'callee';
  timestamp: number;
}

/** Transcript segment */
export interface TranscriptSegment {
  speaker: 'caller' | 'callee';
  text: string;
  timestamp: number;
  isFinal: boolean;
}

/** Permission flags for a user/SIP extension */
export interface Permissions {
  dtmf: boolean;
  transcript: boolean;
  audio_player: boolean;
  caller_id: boolean;
  moh: boolean;
  quick_dial: boolean;
  cdr: boolean;
  billing: boolean;
  allow_tollfree_callerid: boolean;
  cnam_lookup: boolean;
  bin_lookup: boolean;
  call_cost: boolean;
}

/** Default permissions (all enabled) */
export const DEFAULT_PERMISSIONS: Permissions = {
  dtmf: true,
  transcript: true,
  audio_player: true,
  caller_id: true,
  moh: true,
  quick_dial: true,
  cdr: true,
  billing: true,
  allow_tollfree_callerid: true,
  cnam_lookup: true,
  bin_lookup: true,
  call_cost: false,
};

/** Audio file metadata */
export interface AudioFile {
  id: string;
  filename: string;
  uploadedBy: string;
  uploadedAt: number;
  status: 'pending' | 'approved' | 'rejected';
  approvedBy?: string;
}

/** CNAM lookup result */
export interface CnamResult {
  number: string;
  name: string;
  carrier?: string;
  type?: string;
}

/** Fraud score result */
export interface FraudResult {
  number: string;
  score: number;
  riskLevel: 'low' | 'medium' | 'high';
  flags: string[];
}

/** Call detail record */
export interface CallRecord {
  id: number;
  userId: number;
  sipUser: string;
  callerNum: string;
  calleeNum: string;
  startTime: number;
  duration: number;
  billSeconds: number;
  cost: number;
  destination: string;
  status: 'answered' | 'noanswer' | 'busy' | 'failed';
}

/** Server version info sent on auth_ok */
export interface ServerInfo {
  version: string;
  features: string[];
}
