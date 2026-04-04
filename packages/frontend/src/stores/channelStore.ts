import { create } from 'zustand';
import type { Channel } from '@calltools/shared';

/** Extended channel with V1-compatible fields */
export interface ExtendedChannel extends Omit<Channel, 'callerName' | 'calleeName'> {
  rawState?: string;
  rawData?: string;
  context?: string;
  application?: string;
  // CNAM enrichment (added async via cnam_update)
  callerName?: string;
  calleeName?: string;
  callerCarrier?: string;
  calleeCarrier?: string;
  callerState?: string;
  calleeState?: string;
  fraudScore?: number;
  // Cost data
  callCost?: number;
  callRate?: number;
  userBalance?: number;
}

interface ChannelStoreState {
  channels: ExtendedChannel[];
  selectedChannel: string | null;

  setChannels: (channels: ExtendedChannel[]) => void;
  selectChannel: (id: string | null) => void;
  mergeChannelData: (updates: Partial<Record<string, Partial<ExtendedChannel>>>) => void;
  setCnamMap: (cnamMap: Record<string, any>) => void;
  setCostMap: (costMap: Record<string, any>) => void;
}

export const useChannelStore = create<ChannelStoreState>((set, get) => ({
  channels: [],
  selectedChannel: null,

  setChannels: (channels) => {
    // Carry over CNAM/cost data from previous channels
    const prev = get().channels;
    if (prev.length > 0 && channels.length > 0) {
      const prevByNum: Record<string, Partial<ExtendedChannel>> = {};
      const prevByCh: Record<string, Partial<ExtendedChannel>> = {};
      for (const ch of prev) {
        if (ch.callerNum) {
          prevByNum[ch.callerNum] = {
            callerName: ch.callerName,
            callerCarrier: ch.callerCarrier,
            callerState: ch.callerState,
            fraudScore: ch.fraudScore,
          };
        }
        if (ch.calleeNum) {
          prevByNum[ch.calleeNum] = {
            ...prevByNum[ch.calleeNum],
            calleeName: ch.calleeName,
            calleeCarrier: ch.calleeCarrier,
            calleeState: ch.calleeState,
          };
        }
        if (ch.id && ch.callCost !== undefined) {
          prevByCh[ch.id] = { callCost: ch.callCost, callRate: ch.callRate, userBalance: ch.userBalance };
        }
      }
      for (const ch of channels) {
        const numData = prevByNum[ch.callerNum];
        if (numData) {
          if (numData.callerName && !ch.callerName) ch.callerName = numData.callerName;
          if (numData.callerCarrier && !ch.callerCarrier) ch.callerCarrier = numData.callerCarrier;
          if (numData.callerState && !ch.callerState) ch.callerState = numData.callerState;
          if (numData.fraudScore !== undefined && ch.fraudScore === undefined) ch.fraudScore = numData.fraudScore;
        }
        const extData = prevByNum[ch.calleeNum];
        if (extData) {
          if (extData.calleeName && !ch.calleeName) ch.calleeName = extData.calleeName;
          if (extData.calleeCarrier && !ch.calleeCarrier) ch.calleeCarrier = extData.calleeCarrier;
          if (extData.calleeState && !ch.calleeState) ch.calleeState = extData.calleeState;
        }
        const costData = prevByCh[ch.id];
        if (costData && ch.callCost === undefined) {
          ch.callCost = costData.callCost;
          ch.callRate = costData.callRate;
          ch.userBalance = costData.userBalance;
        }
      }
    }
    set({ channels });
  },

  selectChannel: (id) => set({ selectedChannel: id }),

  mergeChannelData: (updates) => {
    set((state) => ({
      channels: state.channels.map(ch => {
        const update = updates[ch.callerNum] || updates[ch.calleeNum] || updates[ch.id];
        if (update) return { ...ch, ...update };
        return ch;
      }),
    }));
  },

  setCnamMap: (cnamMap) => {
    set((state) => ({
      channels: state.channels.map(ch => {
        const callerData = cnamMap[ch.callerNum];
        const calleeData = cnamMap[ch.calleeNum];
        const updates: Partial<ExtendedChannel> = {};
        if (callerData) {
          if (callerData.name) updates.callerName = callerData.name;
          if (callerData.carrier) updates.callerCarrier = callerData.carrier;
          if (callerData.state) updates.callerState = callerData.state;
          if (callerData.fraud_score !== undefined) updates.fraudScore = callerData.fraud_score;
        }
        if (calleeData) {
          if (calleeData.name) updates.calleeName = calleeData.name;
          if (calleeData.carrier) updates.calleeCarrier = calleeData.carrier;
          if (calleeData.state) updates.calleeState = calleeData.state;
        }
        return Object.keys(updates).length > 0 ? { ...ch, ...updates } : ch;
      }),
    }));
  },

  setCostMap: (costMap) => {
    set((state) => ({
      channels: state.channels.map(ch => {
        const cost = costMap[ch.id];
        if (cost) {
          return { ...ch, callCost: cost.cost, callRate: cost.rate, userBalance: cost.balance };
        }
        return ch;
      }),
    }));
  },
}));
