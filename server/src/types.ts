import { AppType } from "./constants";

export type ConnectAppRequest = {
  appId: string;
  appSecret: string;
  pbxBase: string;
};

export type DropRequest = {
  participantId: number;
};

export type DialingSetup = {
  sources: string;
};

export type AppStatus = {
  sorceDn: string | null;
  connected: boolean;
  keymap?: string[];
  callQueue: string[];
  currentParticipants: CallParticipant[];
  wavSource?: string;
  failedCalls?: string;
};

export type TCustomIVRConfig = {
  keyCommands: string[];
  wavSource?: string;
};

export enum CallRequestStatus {
  Failed = -1,
  Rejected = 0,
  Success = 1,
}

export interface DNInfo {
  dn?: string | null;
  type?: string | null;
  devices?: DNDevice[] | null;
  participants?: CallParticipant[] | null;
}

export interface DNDevice {
  dn?: string | null;
  device_id?: string | null;
  user_agent?: string | null;
}

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
export interface CallControlResultResponse {
  finalstatus?: CallRequestStatus;
  reason?: string | null;
  result?: CallParticipant;
  reasontext?: string | null;
}

export type WebhookEvent = {
  sequence: number;
  event: {
    event_type: EventType;
    entity: string;
    attached_data: any;
  };
};

export enum EventType {
  Upset,
  Remove,
  DTMFstring,
  PromptPlaybackFinished,
}

export type DnInfoModel = {
  dn?: string | null;
  type?: string | null;
  devices: Map<string, DNDevice>;
  participants: Map<string, CallParticipant>;
};

export type CallControl = {
  callcontrol: Map<string, DnInfoModel>;
};
