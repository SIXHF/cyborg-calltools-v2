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

export const SetCallerIdMessage = z.object({
  cmd: z.literal('set_callerid'),
  sipUser: z.string().min(1),
  callerid: z.string().min(1).max(20),
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

export const PlayAudioMessage = z.object({
  cmd: z.literal('play_audio'),
  channel: z.string().min(1),
  filename: z.string().min(1),
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

export const GetStatsMessage = z.object({
  cmd: z.literal('get_stats'),
});

// Admin commands
export const AdminSetPermissionsMessage = z.object({
  cmd: z.literal('admin_set_permissions'),
  target: z.string().min(1),
  permissions: z.record(z.boolean()),
});

export const AdminForceLogoutMessage = z.object({
  cmd: z.literal('admin_force_logout'),
  targetToken: z.string().min(1).max(64),
});

export const AdminBroadcastMessage = z.object({
  cmd: z.literal('admin_broadcast'),
  message: z.string().min(1).max(500),
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
  SetCallerIdMessage,
  OriginateCallMessage,
  UploadAudioMessage,
  PlayAudioMessage,
  CnamLookupMessage,
  TransferCallMessage,
  CreatePaymentMessage,
  GetChannelsMessage,
  GetCdrMessage,
  GetBalanceMessage,
  GetRefillHistoryMessage,
  GetUsersOverviewMessage,
  GetPermissionsMessage,
  GetSessionsMessage,
  GetAuditLogMessage,
  AddCreditMessage,
  GetStatsMessage,
  AdminSetPermissionsMessage,
  AdminForceLogoutMessage,
  AdminBroadcastMessage,
  AdminClearRateLimitMessage,
  AdminApproveAudioMessage,
]);

export type ClientMessageType = z.infer<typeof ClientMessage>;

// ── Server → Client Messages ────────────────────────────────────────

export type ServerMessage =
  | { type: 'auth_ok'; token: string; username: string; role: string; version: string; permissions: Record<string, boolean>; sipUsers: string[] }
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
  | { type: 'audio_stream'; channel: string; data: string }
  | { type: 'cnam_result'; number: string; name: string; carrier?: string; lineType?: string }
  | { type: 'fraud_result'; number: string; score: number; riskLevel: string; flags: string[] }
  | { type: 'cdr_result'; records: Record<string, unknown>[]; total: number; page?: number; perPage?: number }
  | { type: 'stats_result'; data: Record<string, unknown> }
  | { type: 'callerid_updated'; sipUser: string; callerid: string }
  | { type: 'callerid_blocked'; sipUser: string; reason: string }
  | { type: 'call_originated'; sipUser: string; destination: string }
  | { type: 'online_users'; users: { username: string; role: string; sipUser?: string; ip?: string; connectedAt?: number }[] }
  | { type: 'admin_broadcast'; message: string; from: string }
  | { type: 'permissions_updated'; permissions: Record<string, boolean> }
  | { type: 'permissions_data'; config: Record<string, unknown> }
  | { type: 'billing_update'; balance: number; currency: string }
  | { type: 'refill_history'; records: Record<string, unknown>[]; total: number; page: number; perPage: number }
  | { type: 'users_overview'; users: Record<string, unknown>[] }
  | { type: 'error'; message: string; code?: string }
  | { type: 'pong' };
