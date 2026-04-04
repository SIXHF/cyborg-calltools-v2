import { z } from 'zod';

// SIP Usage data types
export interface SipUsageEntry {
  sip_user: string;
  total_calls: number;
  answered: number;
  failed: number;
  total_seconds: number;
  cost: number;
  success_rate: number;
}

export interface SipUsageTotals {
  total_calls: number;
  answered: number;
  failed: number;
  total_seconds: number;
  total_cost: number;
}

export interface TopDestination {
  number: string;
  calls: number;
  seconds: number;
  cost: number;
}

// ── Client → Server Messages ────────────────────────────────────────

export const LoginMessage = z.object({
  cmd: z.literal('login'),
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

export const ResumeMessage = z.object({
  cmd: z.literal('resume'),
  token: z.string().length(64),
});

export const LogoutMessage = z.object({
  cmd: z.literal('logout'),
});

export const StartListeningMessage = z.object({
  cmd: z.literal('start_listening'),
  channel: z.string().min(1),
});

export const StopListeningMessage = z.object({
  cmd: z.literal('stop_listening'),
  channel: z.string().min(1),
});

export const StartTranscriptMessage = z.object({
  cmd: z.literal('start_transcript'),
  channel: z.string().min(1),
});

export const StopTranscriptMessage = z.object({
  cmd: z.literal('stop_transcript'),
  channel: z.string().min(1),
});

export const SwitchSipUserMessage = z.object({
  cmd: z.literal('switch_sip_user'),
  sipUser: z.string(),
  account: z.string().optional(),
});

export const GetCallerIdMessage = z.object({
  cmd: z.literal('get_callerid'),
  sipUser: z.string().min(1),
});

export const SetCallerIdMessage = z.object({
  cmd: z.literal('set_callerid'),
  sipUser: z.string().min(1),
  callerid: z.string().max(20),
});

export const OriginateCallMessage = z.object({
  cmd: z.literal('originate_call'),
  sipUser: z.string().min(1),
  destination: z.string().min(1).max(20),
});

export const TransferCallMessage = z.object({
  cmd: z.literal('transfer_call'),
  channel: z.string().min(1),
  destination: z.string().min(1),
  transferType: z.enum(['blind', 'attended']).optional(),
});

export const UploadAudioMessage = z.object({
  cmd: z.literal('upload_audio'),
  filename: z.string().min(1).max(128),
  data: z.string(), // base64 encoded
});

export const PlayAudioMessage = z.object({
  cmd: z.literal('play_audio'),
  channel: z.string().min(1),
  filename: z.string().min(1),
});

export const ListAudioMessage = z.object({
  cmd: z.literal('list_audio'),
});

export const StopAudioMessage = z.object({
  cmd: z.literal('stop_audio'),
});

export const DeleteAudioMessage = z.object({
  cmd: z.literal('delete_audio'),
  filename: z.string().min(1),
});

export const CnamLookupMessage = z.object({
  cmd: z.literal('cnam_lookup'),
  number: z.string().min(1).max(20),
});

export const GetChannelsMessage = z.object({
  cmd: z.literal('get_channels'),
  targetSip: z.string().optional(),
});

export const GetCdrMessage = z.object({
  cmd: z.literal('get_cdr'),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  targetSip: z.string().optional(),
});

export const GetBalanceMessage = z.object({
  cmd: z.literal('get_balance'),
});

export const GetRefillHistoryMessage = z.object({
  cmd: z.literal('get_refill_history'),
  page: z.number().int().min(1).optional(),
  perPage: z.number().int().min(1).max(100).optional(),
  filterUserId: z.number().optional(),
});

export const CreatePaymentMessage = z.object({
  cmd: z.literal('create_payment'),
  amount: z.number().min(1),
});

export const GetStatsMessage = z.object({
  cmd: z.literal('get_stats'),
});

export const GetSipUsageMessage = z.object({
  cmd: z.literal('get_sip_usage'),
  target_account: z.string().optional(),
  target_sip: z.string().optional(),
});

export const GetSipInfoMessage = z.object({
  cmd: z.literal('get_sip_info'),
  targetSip: z.string().optional(),
});

// MOH commands
export const GetMohMessage = z.object({
  cmd: z.literal('get_moh'),
  targetSip: z.string().optional(),
});

export const SetMohMessage = z.object({
  cmd: z.literal('set_moh'),
  targetSip: z.string().optional(),
  filename: z.string().optional(),
  useDefault: z.boolean().optional(),
});

export const UploadMohMessage = z.object({
  cmd: z.literal('upload_moh'),
  targetSip: z.string().optional(),
  filename: z.string().min(1).max(128),
  data: z.string(), // base64 encoded
});

export const DeleteMohMessage = z.object({
  cmd: z.literal('delete_moh'),
  targetSip: z.string().optional(),
  filename: z.string().min(1),
});

export const PingMessage = z.object({
  cmd: z.literal('ping'),
});

// Admin commands
export const GetUsersOverviewMessage = z.object({
  cmd: z.literal('get_users_overview'),
  includeAll: z.boolean().optional(),
});

export const GetPermissionsMessage = z.object({
  cmd: z.literal('get_permissions'),
});

export const GetSessionsMessage = z.object({
  cmd: z.literal('get_sessions'),
});

export const GetAuditLogMessage = z.object({
  cmd: z.literal('get_audit_log'),
  actor: z.string().optional(),
  action: z.string().optional(),
});

export const AddCreditMessage = z.object({
  cmd: z.literal('add_credit'),
  targetUserId: z.number(),
  amount: z.number(),
  note: z.string().optional(),
});

export const SetGlobalSettingsMessage = z.object({
  cmd: z.literal('set_global_settings'),
  key: z.string().min(1),
  value: z.unknown(),
});

export const AdminSetPermissionsMessage = z.object({
  cmd: z.literal('admin_set_permissions'),
  target: z.string().min(1),
  permissions: z.record(z.boolean()),
});

export const AdminForceLogoutMessage = z.object({
  cmd: z.literal('admin_force_logout'),
  targetToken: z.string().min(8),
});

export const AdminBroadcastMessage = z.object({
  cmd: z.literal('admin_broadcast'),
  message: z.string().min(1).max(500),
  color: z.enum(['orange', 'red', 'green']).optional(),
  targets: z.array(z.string()).optional(),
});

export const AdminClearRateLimitMessage = z.object({
  cmd: z.literal('admin_clear_rate_limit'),
  ip: z.string().optional(),
  rateKey: z.string().optional(),
  clearAll: z.boolean().optional(),
});

export const AdminApproveAudioMessage = z.object({
  cmd: z.literal('admin_approve_audio'),
  filename: z.string().min(1),
  action: z.enum(['approve', 'reject']),
});

export const AdminGetIpRestrictionsMessage = z.object({
  cmd: z.literal('admin_get_ip_restrictions'),
});

export const AdminSetIpRestrictionsMessage = z.object({
  cmd: z.literal('admin_set_ip_restrictions'),
  targetType: z.string().min(1),
  targetName: z.string().min(1),
  ips: z.array(z.string()),
});

export const AdminGetRateLimitsMessage = z.object({
  cmd: z.literal('admin_get_rate_limits'),
});

export const AdminSetRateLimitWhitelistMessage = z.object({
  cmd: z.literal('admin_set_rate_limit_whitelist'),
  action: z.enum(['add', 'remove']),
  ip: z.string().min(1),
});

/** Union of all client → server messages */
export const ClientMessage = z.discriminatedUnion('cmd', [
  LoginMessage,
  ResumeMessage,
  LogoutMessage,
  StartListeningMessage,
  StopListeningMessage,
  StartTranscriptMessage,
  StopTranscriptMessage,
  SwitchSipUserMessage,
  GetCallerIdMessage,
  SetCallerIdMessage,
  OriginateCallMessage,
  TransferCallMessage,
  UploadAudioMessage,
  PlayAudioMessage,
  ListAudioMessage,
  StopAudioMessage,
  DeleteAudioMessage,
  CnamLookupMessage,
  GetChannelsMessage,
  GetCdrMessage,
  GetBalanceMessage,
  GetRefillHistoryMessage,
  CreatePaymentMessage,
  GetStatsMessage,
  GetSipUsageMessage,
  GetSipInfoMessage,
  GetMohMessage,
  SetMohMessage,
  UploadMohMessage,
  DeleteMohMessage,
  PingMessage,
  GetUsersOverviewMessage,
  GetPermissionsMessage,
  GetSessionsMessage,
  GetAuditLogMessage,
  AddCreditMessage,
  SetGlobalSettingsMessage,
  AdminSetPermissionsMessage,
  AdminForceLogoutMessage,
  AdminBroadcastMessage,
  AdminClearRateLimitMessage,
  AdminApproveAudioMessage,
  AdminGetIpRestrictionsMessage,
  AdminSetIpRestrictionsMessage,
  AdminGetRateLimitsMessage,
  AdminSetRateLimitWhitelistMessage,
]);

export type ClientMessageType = z.infer<typeof ClientMessage>;

// ── Server → Client Messages ────────────────────────────────────────

export type ServerMessage =
  | { type: 'auth_ok'; token: string; username: string; role: string; version: string; permissions: Record<string, boolean>; sipUsers: string[]; sipGroups?: any[] }
  | { type: 'auth_error'; message: string }
  | { type: 'resume_ok'; username: string; role: string }
  | { type: 'resume_failed'; reason: string }
  | { type: 'channel_update'; channels: Record<string, unknown>[] }
  | { type: 'cnam_update'; cnam_map: Record<string, any>; cost_map?: Record<string, any> }
  | { type: 'dtmf_start'; channel: string; sipUser: string }
  | { type: 'dtmf_digit'; channel: string; digit: string; direction: string }
  | { type: 'dtmf_done'; channel: string }
  | { type: 'transcript_start'; channel: string }
  | { type: 'transcript_update'; channel: string; speaker: string; text: string; isFinal: boolean }
  | { type: 'transcript_done'; channel: string }
  | { type: 'audio_stream'; channel: string; data: string }
  | { type: 'cnam_result'; number: string; name: string; carrier?: string; lineType?: string }
  | { type: 'fraud_result'; number: string; score: number; riskLevel: string; flags: string[] }
  | { type: 'cdr_result'; records: Record<string, unknown>[]; total: number }
  | { type: 'stats_result'; data: Record<string, unknown> }
  | { type: 'callerid_result'; sipUser: string; callerid: string; tollfreeBlocked?: boolean }
  | { type: 'callerid_updated'; sipUser: string; callerid: string }
  | { type: 'callerid_blocked'; sipUser: string; reason: string }
  | { type: 'call_originated'; sipUser: string; destination: string }
  | { type: 'call_transferred'; channel: string; destination: string; transferType: string }
  | { type: 'online_users'; users: { username: string; role: string; sipUser?: string }[] }
  | { type: 'admin_broadcast'; message: string; from: string }
  | { type: 'permissions_updated'; permissions: Record<string, boolean> }
  | { type: 'permissions_data'; data: any }
  | { type: 'sessions_data'; sessions: any[] }
  | { type: 'users_overview'; users: any[] }
  | { type: 'audit_log'; entries: any[] }
  | { type: 'billing_update'; balance: number; currency: string }
  | { type: 'refill_history'; records: any[]; total: number; page: number; perPage: number }
  | { type: 'payment_created'; paymentUrl: string; orderId: string }
  | { type: 'sip_user_switched'; sipUser: string; permissions: Record<string, boolean>; callerid: string; tollfreeBlocked: boolean }
  | { type: 'sip_info'; extensions: any[] }
  | { type: 'sip_usage_data'; sip_usage: SipUsageEntry[]; totals: SipUsageTotals; hourly: number[]; top_destinations: TopDestination[]; shift_start: string; timestamp?: number }
  | { type: 'audio_list'; files: any[] }
  | { type: 'audio_uploaded'; name: string; status?: string; files: any[] }
  | { type: 'audio_playing'; channel: string; filename: string }
  | { type: 'audio_stopped'; channel?: string }
  | { type: 'audio_deleted'; name: string; files: any[] }
  | { type: 'moh_data'; currentMoh: string; files: string[]; isDefault: boolean }
  | { type: 'moh_updated'; filename?: string; isDefault?: boolean }
  | { type: 'moh_uploaded'; filename: string; files: string[] }
  | { type: 'moh_deleted'; filename: string; files: string[] }
  | { type: 'ip_restrictions'; data: any }
  | { type: 'rate_limits'; data: any }
  | { type: 'global_settings_updated'; key: string; value: any }
  | { type: 'credit_added'; targetUserId: number; newBalance: number }
  | { type: 'error'; message: string; code?: string }
  | { type: 'pong' };
