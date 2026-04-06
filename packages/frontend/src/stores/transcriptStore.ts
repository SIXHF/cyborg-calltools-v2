import { create } from 'zustand';
import type { TranscriptSegment } from '@calltools/shared';

interface TranscriptState {
  segments: TranscriptSegment[];
  partials: { caller: string; callee: string };
  isActive: boolean;
  channel: string | null;

  addSegment: (segment: TranscriptSegment) => void;
  updatePartial: (speaker: 'caller' | 'callee', text: string) => void;
  setActive: (active: boolean) => void;
  setChannel: (channel: string | null) => void;
  clear: () => void;
}

export const useTranscriptStore = create<TranscriptState>((set) => ({
  segments: [],
  partials: { caller: '', callee: '' },
  isActive: false,
  channel: null,

  addSegment: (segment) =>
    set((s) => ({
      segments: [...s.segments, segment],
      partials: { ...s.partials, [segment.speaker]: '' },
    })),

  updatePartial: (speaker, text) =>
    set((s) => ({
      partials: { ...s.partials, [speaker]: text },
    })),

  setActive: (active) => set({ isActive: active }),

  setChannel: (channel) => set({ channel }),

  clear: () => set({ segments: [], partials: { caller: '', callee: '' }, isActive: false, channel: null }),
}));
