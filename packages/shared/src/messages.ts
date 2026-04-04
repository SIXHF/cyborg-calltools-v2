import { z } from 'zod';

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
  sipUser: z.string().optional(),
  account: z.string().optional(),
});

export const GetCallerIdMessage = z.object({
  cmd: z.literal('get_callerid'),
  sipUser: z.string().optional(),
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

export const UploadAudioMessage = z.object({
  cmd: z.literal('upload_audio'),
  filename: z.string().min(1).max(128),
  data: z.string(), // base64 encoded
});

export const ListAudioMessage = z.object({
  cmd: z.literal('list_audio'),
});

export const PlayAudioMessage = z.object({
  cmd: z.literal('play_audio'),
  channel: z.string().min(1),
  filename: z.string().min(1),
});

export const StopAudioMessage = z.object({
  cmd: z.literal('stop_audio'),
});

export const DeleteAudioMessage = z.object({
  cmd: z.literal('delete_audio'),
  filename: z.string().min(1).max(128),
});

export const CnamLookupMessage = z.object({
  cmd: z.literal('cnam_lookup'),
  number: z.string().min(1).max(20),
});

export const GetCdrMessage = z.object({
  cmd: z.literal('get_cdr'),
  page: z.number().int().min(1).default(1),
  perPage: z.number().int().min(1).max(50).default(25),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  targetSip: z.string().optional(),
});

export const TransferCallMessage = z.object({
  cmd: z.literal('transfer_call'),
  channel: z.string().min(1),
  destination: z.string().min(1).max(64),
  transferType: z.enum(['blind', 'attended']).default('blind'),
});

export const CreatePaymentMessage = z.object({
  cmd: z.literal('create_payment'),
  amount: z.number().min(50).max(10000),
});

export const GetBalanceMessage = z.object({
  cmd: z.literal('get_balance'),
});

export const GetRefillHistoryMessage = z.object({
  cmd: z.literal('get_refill_history'),
  page: z.number().int().min(1).default(1),
  perPage: z.number().int().min(1).max(50).default(25),
});

export const GetUsersOverviewMessage = z.object({
  cmd: z.literal('get_users_overview'),
});

export const GetPermissionsMessage = z.object({
  cmd: z.literal('get_permissions'),
});

export const GetSessionsMessage = z.object({
  cmd: z.literal('get_sessions'),
});

// MOH commands
export const GetMohMessage = z.object({ cmd: z.literal('get_moh'), targetSip: z.string().optional() });
export const SetMohMessage = z.object({ cmd: z.literal('set_moh'), targetSip: z.string(), filename: z.string().optional(), useDefault: z.boolean().optional() });
export const UploadMohMessage = z.object({ cmd: z.literal('upload_moh'), targetSip: z.string(), filename: z.string(), data: z.string() });
export const DeleteMohMessage = z.object({ cmd: z.literal('delete_moh'), targetSip: z.string(), filename: z.string() });

// Admin IP restrictions
export const AdminGetIpRestrictionsMessage = z.object({ cmd: z.literal('admin_get_ip_restrictions') });
export const AdminSetIpRestrictionsMessage = z.object({ cmd: z.literal('admin_set_ip_restrictions'), targetType: z.enum(['users', 'sip_users']), targetName: z.string(), ips: z.array(z.string()) });

// Admin rate limits
export const AdminGetRateLimitsMessage = z.object({ cmd: z.literal('admin_get_rate_limits') });
export const AdminSetRateLimitWhitelistMessage = z.object({ cmd: z.literal('admin_set_rate_limit_whitelist'), action: z.enum(['add', 'remove']), ip: z.string() });

export const SetGlobalSettingsMessage = z.object({
  cmd: z.literal('set_global_settings'),
  key: z.string().min(1),
  value: z.boolean(),
});

export const GetAuditLogMessage = z.object({
  cmd: z.literal('get_audit_log'),
  actor: z.string().optional(),
  action: z.string().optional(),
});

export const AddCreditMessage = z.object({
  cmd: z.literal('add_credit'),
  targetUserId: z.number().int(),
  amount: z.number(),
  note: z.string().min(1).max(200),
});

export const GetChannelsMessage = z.object({
  cmd: z.literal('get_channels'),
  targetSip: z.string().optional(),
});

export const GetSipInfoMessage = z.object({
  cmd: z.literal('get_sip_info'),
});

export const GetStatsMessage = z.object({
  cmd: z.literal('get_stats'),
});

// Admin commands
export const AdminSetPermissionsMessage = z.object({
  cmd: z.literal('admin_set_permissions'),
  target: z.string().min(1),
  permissions: z.record(z.union([z.boolean(), z.string()])),
});

export const AdminForceLogoutMessage = z.object({
  cmd: z.literal('admin_force_logout'),
  targetToken: z.string().min(1).max(64),
});

export const AdminBroadcastMessage = z.object({
  cmd: z.literal('admin_broadcast'),
  message: z.string().min(1).max(500),
  color: z.enum(['orange', 'red', 'green']).optional(),
  targets: z.array(z.string()).optional(),
});

export const GetSipUsageMessage = z.object({
  cmd: z.literal('get_sip_usage'),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export const AdminClearRateLimitMessage = z.object({
  cmd: z.literal('admin_clear_rate_limit'),
  ip: z.string().min(1),
});

export const AdminApproveAudioMessage = z.object({
  cmd: z.literal('admin_approve_audio'),
  filename: z.string().min(1),
  action: z.enum(['approve', 'reject']),
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
  ListAudioMessage,
  UploadAudioMessage,
  PlayAudioMessage,
  StopAudioMessage,
  DeleteAudioMessage,
  CnamLookupMessage,
  TransferCallMessage,
  CreatePaymentMessage,
  GetChannelsMessage,
  GetSipInfoMessage,
  GetCdrMessage,
  GetBalanceMessage,
  GetRefillHistoryMessage,
  GetUsersOverviewMessage,
  GetPermissionsMessage,
  GetSessionsMessage,
  GetMohMessage,
  SetMohMessage,
  UploadMohMessage,
  DeleteMohMessage,
  AdminGetIpRestrictionsMessage,
  AdminSetIpRestrictionsMessage,
  AdminGetRateLimitsMessage,
  AdminSetRateLimitWhitelistMessage,
  SetGlobalSettingsMessage,
  GetAuditLogMessage,
  AddCreditMessage,
  GetStatsMessage,
  AdminSetPermissionsMessage,
  AdminForceLogoutMessage,
  AdminBroadcastMessage,
  AdminClearRateLimitMessage,
  AdminApproveAudioMessage,
  GetSipUsageMessage,
]);

export type ClientMessageType = z.infer<typeof ClientMessage>;

// ── Server → Client Messages ────────────────────────────────────────

export type ServerMessage =
  | { type: 'auth_ok'; token: string; username: string; role: string; version: string; permissions: Record<string, boolean>; sipUsers: string[]; sipGroups?: Array<{ account: string; sipUsers: string[] }> }
  | { type: 'auth_error'; message: string }
  | { type: 'resume_ok'; username: string; role: string }
  | { type: 'resume_failed'; reason: string }
  | { type: 'channel_update'; channels: Record<string, unknown>[] }
  | { type: 'dtmf_start'; channel: string; sipUser: string }
  | { type: 'dtmf_digit'; channel: string; digit: string; direction: string }
  | { type: 'dtmf_done'; channel: string }
  | { type: 'transcript_start'; channel: string }
  | { type: 'transcript_update'; channel: string; speaker: string; text: string; isFinal: boolean }
  | { type: 'transcript_done'; channel: string }
  | { type: 'audio_list'; files: Array<{ name: string; size: number; status: string; uploaded_by?: string; uploaded_at?: string }> }
  | { type: 'audio_uploaded'; name: string; status: string; files: Array<{ name: string; size: number; status: string; uploaded_by?: string; uploaded_at?: string }> }
  | { type: 'audio_deleted'; name: string; files: Array<{ name: string; size: number; status: string; uploaded_by?: string; uploaded_at?: string }> }
  | { type: 'audio_playing'; file: string; callee: string }
  | { type: 'audio_stopped'; file: string | null; reason: string }
  | { type: 'audio_stream'; channel: string; data: string }
  | { type: 'cnam_result'; number: string; name: string; carrier?: string; lineType?: string; state?: string; city?: string }
  | { type: 'fraud_result'; number: string; score: number; riskLevel: string; flags: string[] }
  | { type: 'cdr_result'; records: Record<string, unknown>[]; total: number; page?: number; perPage?: number }
  | { type: 'stats_result'; data: Record<string, unknown> }
  | { type: 'sip_user_switched'; sipUser: string; permissions: Record<string, boolean>; callerid: string; tollfreeBlocked: boolean }
  | { type: 'callerid_info'; sipUser: string; callerid: string }
  | { type: 'callerid_updated'; sipUser: string; callerid: string }
  | { type: 'cnam_update'; cnam_map: Record<string, any> }
  | { type: 'callerid_blocked'; sipUser: string; reason: string }
  | { type: 'call_originated'; sipUser: string; destination: string }
  | { type: 'online_users'; users: { username: string; role: string; sipUser?: string; ip?: string; connectedAt?: number }[] }
  | { type: 'admin_broadcast'; message: string; from: string; color?: 'orange' | 'red' | 'green' }
  | { type: 'sip_usage_result'; stats: Array<{ sipUser: string; answered: number; failed: number; total: number; minutes: number; cost: number; asr: number }>; totals: { answered: number; failed: number; total: number; minutes: number; cost: number } }
  | { type: 'permissions_updated'; permissions: Record<string, boolean> }
  | { type: 'permissions_data'; config: Record<string, unknown> }
  | { type: 'billing_update'; balance: number; currency: string }
  | { type: 'refill_history'; records: Record<string, unknown>[]; total: number; page: number; perPage: number }
  | { type: 'users_overview'; users: Record<string, unknown>[] }
  | { type: 'payment_created'; payment_url: string; order_id: string; amount: string }
  | { type: 'transfer_initiated'; channel: string; destination: string; transferType: string }
  | { type: 'audit_log'; lines: string[] }
  | { type: 'sip_info'; extensions: Array<{ name: string; callerid: string; host: string; codecs: string; secret: string; registered: boolean }> }
  | { type: 'moh_info'; using_default: boolean; moh_class: string; files: Array<{ name: string; size: number }> }
  | { type: 'moh_updated'; using_default: boolean; moh_class: string; files: Array<{ name: string; size: number }> }
  | { type: 'ip_restrictions_list'; restrictions: Record<string, any> }
  | { type: 'ip_restrictions_updated'; targetType: string; targetName: string; ips: string[] }
  | { type: 'rate_limits_list'; rateLimits: any[]; whitelist: string[]; maxAttempts: number; windowSeconds: number }
  | { type: 'rate_limit_cleared'; rateKey: string; clearAll: boolean }
  | { type: 'rate_whitelist_updated'; whitelist: string[] }
  | { type: 'transcript_started'; channel: string; callerName: string; calleeName: string; backend: string }
  | { type: 'transcript_stopped'; lines: any[] }
  | { type: 'transcript_slots'; active: number; max: number }
  | { type: 'error'; message: string; code?: string }
  | { type: 'pong' };
