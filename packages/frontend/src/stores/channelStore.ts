import { create } from 'zustand';
import type { Channel } from '@calltools/shared';

interface ChannelState {
  channels: Channel[];
  selectedChannel: string | null;

  setChannels: (channels: Channel[]) => void;
  selectChannel: (id: string | null) => void;
}

export const useChannelStore = create<ChannelState>((set) => ({
  channels: [],
  selectedChannel: null,

  setChannels: (channels) => set({ channels }),
  selectChannel: (id) => set({ selectedChannel: id }),
}));
