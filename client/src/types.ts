export type AppStatus = {
  sorceDn: string | null;
  connected: boolean;
  keymap?: string[];
  callQueue: string[];
  currentParticipants: CallParticipant[];
  wavSource?: string;
};

export interface CallParticipant {
  id?: number;
  status?: string | null;
  party_caller_name?: string | null;
  party_dn?: string | null;
  party_caller_id?: string | null;
  device_id?: string | null;
  party_dn_type?: string | null;
  direct_control?: boolean;
  callid?: number;
  legid?: number;
  dn?: string | null;
}
