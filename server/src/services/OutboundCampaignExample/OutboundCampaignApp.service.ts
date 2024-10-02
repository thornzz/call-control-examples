import {
  Queue,
  determineOperation,
  fullInfoToObject,
  set,
  useWebsocketListeners,
} from "../../utils";
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
  WSEvent,
} from "../../types";
import { AppType, PARTICIPANT_TYPE_UPDATE } from "../../constants";
import { inject, injectable, singleton } from "tsyringe";
import { ExternalApiService } from "../ExternalApi.service";
import { BadRequest, InternalServerError } from "../../Error";

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
    try {
      if (
        !connectConfig.appId ||
        !connectConfig.appSecret ||
        !connectConfig.pbxBase ||
        appType !== AppType.Campaign
      ) {
        throw new BadRequest("App Connection configuration is broken");
      }
      await this.externalApiSvc.setup(connectConfig, appType);

      //* ws part
      if (!this.externalApiSvc.wsClient)
        throw new BadRequest("Websocket client is not initialized");

      useWebsocketListeners(
        this.externalApiSvc.wsClient,
        this.wsEventHandler,
        this.reconnectWebsocket
      );
      //* other part
      const fullInfo = await this.externalApiSvc.getFullInfo();
      console.log(fullInfo.data);
      this.fullInfo = fullInfoToObject(fullInfo.data);

      const thesource: DnInfoModel | undefined = Array.from(
        this.fullInfo.callcontrol.values()
      ).find((val) => val.type === "Wivr" || val.type === "Wqueue");
      if (!thesource) {
        throw new BadRequest(
          "Application binded to the wrong dn, dn is not founed or application hook is invalid, type should be IVR/Queue"
        );
      }

      this.sourceDn = thesource.dn ?? null;
      if (!this.sourceDn) {
        throw new BadRequest("Source DN is missing");
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
  async disconnect() {
    this.externalApiSvc.disconnect();
    this.sourceDn = null;
    this.incomingCallsParticipants.clear();
    this.fullInfo?.callcontrol.clear();
    this.failedCalls = [];
    this.callQueue.clear();
    this.externalApiSvc.wsClient?.terminate();
    this.connected = false;
  }

  private reconnectWebsocket = () => {
    if (this.connected === true && this.externalApiSvc.wsClient !== null) {
      setTimeout(() => {
        console.log("Trying to reconnect websocket...");
        if (this.externalApiSvc.wsClient) {
          this.externalApiSvc.wsClient.terminate();
        }
        this.externalApiSvc.createWs().then(() => {
          useWebsocketListeners(
            this.externalApiSvc.wsClient!,
            this.wsEventHandler,
            this.reconnectWebsocket
          );
        });
      }, 5000);
    }
  };
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
  private wsEventHandler = async (json: string) => {
    try {
      const wsEvent: WSEvent = JSON.parse(json);
      if (!this.connected || !wsEvent?.event?.entity) {
        return;
      }
      const { dn, id, type } = determineOperation(wsEvent.event.entity);
      switch (wsEvent.event.event_type) {
        case EventType.Upset:
          {
            const request =
              await this.externalApiSvc.requestUpdatedEntityFromWebhookEvent(
                wsEvent
              );
            const data = request.data;
            set(this.fullInfo!, wsEvent.event.entity, data);
            if (dn === this.sourceDn) {
              if (type === PARTICIPANT_TYPE_UPDATE) {
                /**
                 * handle here update of participants
                 */
              }
            }
          }
          break;
        case EventType.Remove: {
          const removed: CallParticipant = set(
            this.fullInfo!,
            wsEvent.event.entity,
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
    } catch (error) {}
  };

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
      throw new InternalServerError(
        "Source Dn is not defined or application is not connected"
      );
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
          throw new BadRequest("Devices not found");
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
          throw new BadRequest(error.message);
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
      throw new InternalServerError(
        "Source Dn is not defined or application is not connected"
      );
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
