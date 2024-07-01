import {
  APP_TYPE_CUSTOM_IVR,
  APP_TYPE_DIALER,
  APP_TYPE_OUTBOUND_CAMPAIGN,
} from "./constants";
import {
  AppStatus,
  CallControlParticipantAction,
  ConnectFormProps,
} from "./types";

export const getStatusFunc = (appType: ConnectFormProps["appType"]) => {
  const getStatus = async () => {
    const enumered = getEnumeredType(appType);
    if (enumered === undefined) {
      return;
    }
    const response: Promise<AppStatus> = fetch(
      `${import.meta.env.VITE_SERVER_BASE}/api/status?appId=${enumered}`,
      {
        method: "GET",
      }
    )
      .then((res) => res.json())
      .catch((err) => console.log(err));
    return (await response) || null;
  };

  return getStatus;
};

export function getEnumeredType(type: ConnectFormProps["appType"]) {
  switch (type) {
    case APP_TYPE_CUSTOM_IVR:
      return "0";
    case APP_TYPE_OUTBOUND_CAMPAIGN:
      return "1";
    case APP_TYPE_DIALER:
      return "2";
    default:
      return undefined;
  }
}

export function controlParticipantRequest(
  appType: ConnectFormProps["appType"],
  action: CallControlParticipantAction,
  participantId?: number,
  destination?: string
): Promise<Response> | undefined {
  const enumeredType = getEnumeredType(appType);
  if (enumeredType === undefined || !participantId) {
    return;
  }
  return fetch(
    `${import.meta.env.VITE_SERVER_BASE}/api/controlcall?appId=${enumeredType}`,
    {
      method: "POST",
      body: JSON.stringify({
        participantId: participantId,
        action,
        destination,
      }),
      headers: {
        "Content-type": "application/json",
      },
    }
  );
}

export function makeCallRequest(
  appType: ConnectFormProps["appType"],
  sources?: string
): Promise<Response> | undefined {
  const enumeredType = getEnumeredType(appType);
  if (enumeredType === undefined || !sources) {
    throw Error("source is empty or request addresed to nowhere");
  }

  return fetch(
    `${import.meta.env.VITE_SERVER_BASE}/api/dialing?appId=${enumeredType}`,
    {
      method: "POST",
      body: JSON.stringify({
        sources: sources,
      }),
      headers: {
        "Content-type": "application/json",
      },
    }
  );
}

export enum DialerState {
  Idle,
  Dialing,
  Ringing,
  Connected,
}
