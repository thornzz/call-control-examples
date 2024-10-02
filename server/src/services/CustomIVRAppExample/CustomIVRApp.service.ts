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
  TCustomIVRConfig,
  WSEvent,
} from "../../types";
import { inject, injectable, singleton } from "tsyringe";
import * as fs from "fs";
import {
  CancelationToken,
  Queue,
  determineOperation,
  fullInfoToObject,
  set,
  useWebsocketListeners,
  writeSlicedAudioStream,
} from "../../utils";
import {
  AppType,
  PARTICIPANT_CONTROL_DROP,
  PARTICIPANT_CONTROL_ROUTE_TO,
  PARTICIPANT_STATUS_CONNECTED,
  PARTICIPANT_TYPE_UPDATE,
} from "../../constants";
import * as path from "path";
import axios from "axios";
import { ExternalApiService } from "../ExternalApi.service";
import { BadRequest, InternalServerError } from "../../Error";

@injectable()
@singleton()
export class CustomIVRAppService {
  private fullInfo?: CallControl;
  private sourceDn: string | null = null;

  private config: TCustomIVRConfig | null = null;
  public callQueue = new Queue<string>();

  /** To prevent extra stream request for participant if it already in proccess */
  public streamEstablishedCallsParticipants = new Map<
    number,
    WritableStreamDefaultWriter<any>
  >();
  /** To prevent extra dtmf handling for participant */
  public dtmfHandlingInProcessParticipants = new Map<number, CallParticipant>();

  public connected = false;
  token: CancelationToken = new CancelationToken();

  public incomingCallsParticipants: Map<number, CallParticipant> = new Map();
  public failedCalls: string[] = [];

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
        connectConfig.appId === undefined ||
        connectConfig.appSecret === undefined ||
        connectConfig.pbxBase === undefined ||
        appType !== AppType.CustomIvr
      ) {
        throw new BadRequest("App Connection configuration is broken");
      }
      await this.externalApiSvc.setup(connectConfig, appType);
      //* ws part
      if (!this.externalApiSvc.wsClient)
        throw new BadRequest("Websocket client is not initialized");

      useWebsocketListeners(this.externalApiSvc.wsClient, this.wsEventHandler);
      //* other part
      const fullInfo = await this.externalApiSvc.getFullInfo();
      this.fullInfo = fullInfoToObject(fullInfo.data);
      const thesource: DnInfoModel | undefined = Array.from(
        this.fullInfo.callcontrol.values()
      ).find((val) => val.type === "Wroutepoint");

      if (!thesource) {
        throw new BadRequest(
          "Application binded to the wrong dn, dn is not founed or application hook is invalid, type should be Extension"
        );
      }
      this.sourceDn = thesource.dn ?? null;
      if (!this.sourceDn) {
        throw new BadRequest("Source DN is missing");
      }
      this.connected = true;
    } catch (e) {
      this.externalApiSvc.disconnect();
      throw e;
    }
  }

  /**
   * Disconnect application
   */
  async disconenct() {
    for (const [key, val] of this.streamEstablishedCallsParticipants) {
      this.gratefulShutDownStream(key);
    }
    this.externalApiSvc.disconnect();
    this.config = null;
    this.sourceDn = null;
    this.incomingCallsParticipants.clear();
    this.dtmfHandlingInProcessParticipants.clear();
    this.fullInfo?.callcontrol.clear();
    this.failedCalls = [];
    this.callQueue.clear();
    this.externalApiSvc.wsClient?.close();
    this.connected = false;
  }
  /**
   * App status
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
      keymap: this.config?.keyCommands,
      callQueue,
      wavSource: this.config?.wavSource,
      currentParticipants: participants
        ? Array.from(participants.values())
        : [],
    };
  }
  /**
   * Ivr config update
   * prompt, dtmf values
   * @param config
   */
  public setup(config: Record<string, any>) {
    this.config = config as TCustomIVRConfig;
  }
  /**
   * event handler for incoming webhooks from PBX
   * @param wsEvent
   * @returns
   */
  public wsEventHandler = async (json: string) => {
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
                 * handle here updated participants
                 */
                const participant = this.getParticipantOfDnById(dn, id);
                if (!participant || !this.connected) {
                  return;
                }
                if (participant.status === PARTICIPANT_STATUS_CONNECTED) {
                  await this.handleParticipantPromptStream(participant);
                }
              }
            }
          }
          break;
        case EventType.DTMFstring:
          {
            if (dn === this.sourceDn) {
              if (type === PARTICIPANT_TYPE_UPDATE) {
                /**
                 * handle here recieved DTMF strings
                 */
                const participant = this.getParticipantOfDnById(dn, id);
                if (
                  this.connected &&
                  participant &&
                  typeof wsEvent.event?.attached_data?.dtmf_input ===
                    "string" &&
                  this.streamEstablishedCallsParticipants.has(
                    participant.id!
                  ) &&
                  !this.dtmfHandlingInProcessParticipants.has(participant.id!)
                ) {
                  await this.handleDTMFInput(
                    participant,
                    wsEvent.event.attached_data.dtmf_input
                  );
                }
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
              if (removed?.id) {
                this.incomingCallsParticipants.delete(removed.id);
                this.gratefulShutDownStream(removed.id);
                const participants = this.getParticipantsOfDn(this.sourceDn);
                if (!participants || participants?.size < 1) {
                  await this.makeCallsToDst();
                }
              }
            }
          }
        }
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        console.log(`AXIOS ERROR code: ${err.response?.status}`);
      } else console.log("Unknown error", err);
    }
  };

  private getParticipantOfDnById(dn: string, id: string) {
    return this.fullInfo?.callcontrol.get(dn)?.participants.get(id);
  }

  private getParticipantsOfDn(dn?: string | null) {
    return dn ? this.fullInfo?.callcontrol.get(dn)?.participants : undefined;
  }

  /**
   * Starts handling stream for participant
   * getting audio stream from participant + post stream from file
   * @param participant
   * @returns
   */
  public async handleParticipantPromptStream(participant: CallParticipant) {
    if (!this.config) {
      throw new BadRequest("Config is missing");
    }

    if (
      this.sourceDn &&
      participant.id &&
      !this.streamEstablishedCallsParticipants.has(participant.id)
    ) {
      try {
        const outputStream = new TransformStream();
        const outputWriter = outputStream.writable.getWriter();
        this.streamEstablishedCallsParticipants.set(
          participant.id,
          outputWriter
        );

        const postAudio = this.externalApiSvc.postAudioStream(
          this.sourceDn,
          participant.id,
          outputStream.readable
        );
        const getAudio = this.externalApiSvc
          .getAudioStream(this.sourceDn, participant.id)
          .then((response) => {
            response.data.on("close", () => {
              this.gratefulShutDownStream(participant.id!);
            });
          });
        this.startStreamFromFile("output.wav", participant.id!);
        return Promise.all([getAudio, postAudio]).catch(() => {
          this.gratefulShutDownStream(participant.id!);
        });
      } catch (e) {
        this.gratefulShutDownStream(participant.id!);
      }
    }
  }
  /**
   * Writing from file to writeable stream
   * @param wavPath
   * @param participantId
   * @param needRefrsh
   * @param isLoop
   */
  private startStreamFromFile(
    wavPath: string,
    participantId: number,
    needRefrsh = false,
    isLoop = false
  ) {
    const outputWriter =
      this.streamEstablishedCallsParticipants.get(participantId);
    if (outputWriter) {
      if (needRefrsh) {
        this.token.emit("cancel");
      }
      const readable = fs.createReadStream(
        path.resolve(__dirname, "../../../", "public", wavPath)
      );
      const chunks: Buffer[] = [];
      readable.on("data", async (chunk: Buffer) => {
        chunks.push(chunk);
      });
      readable.on("end", async () => {
        try {
          if (isLoop) {
            // Repeat stream from audio file
            while (true) {
              await writeSlicedAudioStream(
                Buffer.concat(chunks),
                outputWriter,
                this.token
              );
            }
          } else {
            await writeSlicedAudioStream(
              Buffer.concat(chunks),
              outputWriter,
              this.token
            );
          }
        } catch (err) {}
      });
    }
  }
  /**
   * Stop writing to writeable stream and Shutdown all streams for participant
   * @param participantId
   */
  private gratefulShutDownStream(participantId: number) {
    const stream = this.streamEstablishedCallsParticipants.get(participantId);
    if (stream) {
      this.token.emit("cancel");
      stream
        .close()
        .catch((e) => console.log(e))
        .finally(() => {
          this.externalApiSvc.abortRequest();
          this.streamEstablishedCallsParticipants.delete(participantId);
        });
    }
  }
  /**
   * handles incoming dtmfs from participant
   * @param participant
   * @param dtmfCode
   */
  public async handleDTMFInput(participant: CallParticipant, dtmfCode: string) {
    if (!this.config || !this.sourceDn) {
      throw new BadRequest("Config is missing");
    }
    console.log(this.config.keyCommands, dtmfCode);
    const redirectionNumber = this.config?.keyCommands[parseFloat(dtmfCode)];
    if (redirectionNumber) {
      try {
        this.dtmfHandlingInProcessParticipants.set(
          participant.id!,
          participant
        );
        // TODO -
        this.startStreamFromFile(
          "USProgresstone.wav",
          participant.id!,
          true,
          true
        );
        await this.externalApiSvc.controlParticipant(
          this.sourceDn,
          participant.id!,
          PARTICIPANT_CONTROL_ROUTE_TO,
          redirectionNumber
        );
        // SUCCESS
        this.gratefulShutDownStream(participant.id!);
        await this.externalApiSvc.controlParticipant(
          this.sourceDn,
          participant.id!,
          PARTICIPANT_CONTROL_DROP
        );
      } catch (err) {
        // CANCEL CURRENT STREAM
        this.token.emit("cancel");
        // START AGAIN
        this.startStreamFromFile("output.wav", participant.id!, true);
      } finally {
        // participant dtmf operation handled with success/error, we can proceed with new dtmf
        this.dtmfHandlingInProcessParticipants.delete(participant.id!);
      }
    } else {
      throw new BadRequest("Redirection Number is not defined");
    }
  }
  /**
   * push number to call queue for campaign
   * @param str
   */
  pushNumbersToQueue(str: string) {
    this.callQueue.push(str);
  }
  /**
   *  start prepare queue and start makeCalls
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
      this.connected = true;
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
        } catch (error) {
          this.failedCalls.push(destNumber!);
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
