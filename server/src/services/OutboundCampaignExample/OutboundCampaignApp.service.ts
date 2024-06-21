import { Queue, determineOperation, fullInfoToObject, set } from "../../utils";
import {
  AppStatus,
  CallControl,
  CallControlParticipantAction,
  CallParticipant,
  ConnectAppRequest,
  DNDevice,
  DialingSetup,
  DnInfoModel,
  EventType,
  WebhookEvent,
} from "../../types";
import {
  AppType,
  PARTICIPANT_CONTROL_DROP,
  PARTICIPANT_STATUS_CONNECTED,
  PARTICIPANT_TYPE_UPDATE,
} from "../../constants";
import { inject, injectable, singleton } from "tsyringe";
import { ExternalApiService } from "../ExternalApi.service";
import axios from "axios";

@injectable()
@singleton()
export class OutboundCampaignService {
  private fullInfo?: CallControl;
  private sourceDn: string | null = null;

  public callQueue = new Queue<string>();
  public failedCalls: string[] = [];
  public incomingCallsParticipants: Map<number, CallParticipant> = new Map();

  public connected = false;

  constructor(
    @inject(ExternalApiService) private externalApiSvc: ExternalApiService
  ) {}

  /**
   *  App Connect to pbx method
   * @param connectConfig
   */
  public async connect(connectConfig: ConnectAppRequest, appType: AppType) {
    if (
      !connectConfig.appId ||
      !connectConfig.appSecret ||
      !connectConfig.pbxBase ||
      appType !== AppType.Campaign
    ) {
      throw new Error("Configuration is broken");
    }
    this.externalApiSvc.setup(connectConfig, appType);

    try {
      const fullInfo = await this.externalApiSvc.getFullInfo();
      this.fullInfo = fullInfoToObject(fullInfo.data);
      if (this.fullInfo.callcontrol.size > 1) {
        throw new Error(
          "More than 1 DN founded, please make sure you didn't specify DN_LSIT property for application"
        );
      }
      const thesource: DnInfoModel = this.fullInfo.callcontrol
        .values()
        .next()?.value;
      if (
        !thesource ||
        (thesource.type !== "Wivr" && thesource.type !== "Wqueue")
      ) {
        throw new Error(
          "Application binded to the wrong dn or dn is not founded, type should be Queue or Ivr"
        );
      }
      this.sourceDn = thesource.dn ?? null;
      if (!this.sourceDn) {
        throw new Error("Source DN is missing");
      }
      this.connected = true;
    } catch (err) {
      this.externalApiSvc.disconnect();
      throw err;
    }
  }
  /**
   * App disconect from pbx method
   */
  async disconenct() {
    this.externalApiSvc.disconnect();
    this.sourceDn = null;
    this.incomingCallsParticipants.clear();
    this.fullInfo?.callcontrol.clear();
    this.failedCalls = [];
    this.callQueue.clear();
    this.connected = false;
  }
  /**
   * receive app status
   * @returns
   */
  public status(): AppStatus {
    const callQueue = [];
    for (const item of this.callQueue.items) {
      if (item) {
        callQueue.push(item);
      }
    }
    const participants = this.getParticipantsOfDn(this.sourceDn);

    return {
      connected: this.connected,
      sorceDn: this.sourceDn,
      callQueue,
      currentParticipants: participants
        ? Array.from(participants.values())
        : [],
    };
  }
  /**
   * webhook event handler
   * @param webhook
   * @returns
   */
  public async webHookEventHandler(webhook: WebhookEvent) {
    if (!this.connected || !webhook?.event?.entity) {
      return;
    }
    const { dn, id, type } = determineOperation(webhook.event.entity);
    switch (webhook.event.event_type) {
      case EventType.Upset:
        {
          try {
            const request =
              await this.externalApiSvc.requestUpdatedEntityFromWebhookEvent(
                webhook
              );
            const data = request.data;
            set(this.fullInfo!, webhook.event.entity, data);
            if (dn === this.sourceDn) {
              if (type === PARTICIPANT_TYPE_UPDATE) {
                /**
                 * handle here update of participants
                 */
              }
            }
          } catch (err: unknown) {
            if (axios.isAxiosError(err)) {
              console.log(`AXIOS ERROR code: ${err.response?.status}`);
            }
          }
        }
        break;
      case EventType.Remove: {
        const removed: CallParticipant = set(
          this.fullInfo!,
          webhook.event.entity,
          undefined
        );
        if (dn === this.sourceDn) {
          if (type === PARTICIPANT_TYPE_UPDATE) {
            /**
             * handle here removed participants
             */
            if (removed.id) {
              this.incomingCallsParticipants.delete(removed.id);
              const participants = this.getParticipantsOfDn(this.sourceDn);
              if (!participants || participants?.size < 1) {
                await this.makeCallsToDst();
              }
            }
          }
        }
      }
    }
  }

  pushNumbersToQueue(str: string) {
    this.callQueue.push(str);
  }

  private getParticipantOfDnById(dn: string, id: string) {
    return this.fullInfo?.callcontrol.get(dn)?.participants.get(id);
  }

  private getParticipantsOfDn(dn?: string | null) {
    return dn ? this.fullInfo?.callcontrol.get(dn)?.participants : undefined;
  }
  /**
   * start prepare queue and start makeCalls
   * @param dialingSetup
   */
  public startDialing(dialingSetup: DialingSetup) {
    const arr = dialingSetup.sources.split(",");
    arr.forEach((destNumber) => this.pushNumbersToQueue(destNumber));
    this.makeCallsToDst();
  }

  /**
   * makes calls from call queue
   * @returns
   */
  public async makeCallsToDst() {
    if (!this.sourceDn || !this.connected) {
      throw Error("Source Dn is not defined or application is not connected");
    }
    const participants = this.getParticipantsOfDn(this.sourceDn);
    if (participants && participants.size > 0) {
      return;
    }
    if (!this.callQueue.isEmpty()) {
      if (this.callQueue.items.head !== null) {
        const source = this.fullInfo?.callcontrol.get(this.sourceDn);
        const device: DNDevice = source?.devices?.values().next().value;
        if (!device?.device_id) {
          throw new Error("Devices not found");
        }
        const destNumber = this.callQueue.getAndRemoveFromQueue();
        try {
          const response = await this.externalApiSvc.makeCallFromDevice(
            this.sourceDn,
            encodeURIComponent(device.device_id),
            destNumber!
          );
          if (response.data.result?.id) {
            this.incomingCallsParticipants.set(
              response.data.result.id,
              response.data.result
            );
          } else {
            this.failedCalls.push(destNumber!);
          }
        } catch (error: any) {
          this.failedCalls.push(destNumber!);
          throw new Error(error.message);
        }
      }
    } else {
      // queue is empty
    }
  }

  /**
   * drop call
   * @param participantId
   * @returns
   */
  public controlParticipant(
    participantId: number,
    action: CallControlParticipantAction,
    destination?: string
  ) {
    if (!this.sourceDn) {
      throw Error("Source Dn is not defined or application is not connected");
    }
    const participant = this.getParticipantOfDnById(
      this.sourceDn,
      String(participantId)
    );

    if (!participant) {
      return;
    }

    return this.externalApiSvc.controlParticipant(
      this.sourceDn,
      participant.id!,
      action,
      destination
    );
  }
}
