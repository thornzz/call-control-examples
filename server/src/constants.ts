export const PARTICIPANT_TYPE_UPDATE = 'participants'

export enum AppType {
    CustomIvr,
    Campaign,
    Dialer,
}

export const PARTICIPANT_STATUS_CONNECTED = 'Connected'
export const PARTICIPANT_STATUS_DIALING = 'Dialing'

// methods of call control participant
export const PARTICIPANT_CONTROL_DROP = 'drop'
export const PARTICIPANT_CONTROL_ANSWER = 'answer'
export const PARTICIPANT_CONTROL_DIVERT = 'divert'
export const PARTICIPANT_CONTROL_ROUTE_TO = 'routeto'
export const PARTICIPANT_CONTROL_TRANSFER_TO = 'transferto'
export const PARTICIPANT_CONTROL_ATTACH_DATA = 'attach_participant_data'

export const UNREGISTERED_DEVICE_ID = 'not_registered_dev'

export const BAD_REQUEST = 'Bad Request'
export const INTERNAL_SERVER_ERROR = 'Internal Server Error'
export const NOT_FOUND = 'Not Found'
