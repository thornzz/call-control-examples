import {
  AppStatus,
  CallControl,
  CallControlParticipantAction,
  ExtendedParticipant,
  ConnectAppRequest,
  DNDevice,
  DialingSetup,
  DnInfoModel,
  EventType,
  TCustomIVRConfig,
  WSEvent,
  TFailedCall,
  StreamMode,
} from '../../types';
import { inject, injectable, singleton } from 'tsyringe';
import * as fs from 'fs';
import {
  CancelationToken,
  Queue,
  determineOperation,
  fullInfoToObject,
  getParticipantUpdatePath,
  set,
  useWebsocketListeners,
  writeSlicedAudioStream,
} from '../../utils';
import {
  AppType,
  CAMPAIGN_SOURCE_BUSY,
  NO_SOURCE_OR_DISCONNECTED,
  PARTICIPANT_CONTROL_DROP,
  PARTICIPANT_CONTROL_ROUTE_TO,
  PARTICIPANT_STATUS_CONNECTED,
  PARTICIPANT_TYPE_UPDATE,
  UNKNOWN_CALL_ERROR,
  WS_CLOSE_REASON_TERMINATE,
} from '../../constants';
import * as path from 'path';
import axios from 'axios';
import { ExternalApiService } from '../ExternalApi.service';
import { BadRequest, InternalServerError } from '../../Error';
import { WebSocket } from 'ws';
import { AiIntegrationService } from '../AiIntegrationExample/AiIntegration.service';

@injectable()
@singleton()
export class CustomIVRAppService {
  private fullInfo?: CallControl;
  private sourceDn: string | null = null;

  private config: TCustomIVRConfig | null = null;
  public callQueue = new Queue<string>();

  public incomingCallsParticipants: Map<number, ExtendedParticipant> = new Map();
  public failedCalls: TFailedCall[] = [];

  constructor(
    @inject(ExternalApiService) private externalApiSvc: ExternalApiService,
    @inject(AiIntegrationService) private aiSvc: AiIntegrationService,
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
        throw new BadRequest('App Connection configuration is broken');
      }
      await this.externalApiSvc.setup(connectConfig, appType);
      if (!this.externalApiSvc.wsClient)
        throw new BadRequest('Websocket client is not initialized');

      useWebsocketListeners(
        this.externalApiSvc.wsClient,
        this.wsEventHandler,
        this.onReconnectWs,
        this.externalApiSvc.restoreTries,
      );

      const fullInfo = await this.externalApiSvc.getFullInfo();
      this.fullInfo = fullInfoToObject(fullInfo.data);
      const thesource: DnInfoModel | undefined = Array.from(
        this.fullInfo.callcontrol.values(),
      ).find((val) => val.type === 'Wroutepoint');

      if (!thesource) {
        throw new BadRequest(
          'Application bound to the wrong dn, dn is not found or application hook is invalid, type should be Extension',
        );
      }
      this.sourceDn = thesource.dn ?? null;
      if (!this.sourceDn) {
        throw new BadRequest('Source DN is missing');
      }
      this.externalApiSvc.connected = true;
    } catch (e) {
      this.externalApiSvc.disconnect();
      throw e;
    }
  }

  private onReconnectWs = () => {
    this.externalApiSvc
      .reconnectWs()
      .then((ws) => {
        useWebsocketListeners(
          ws,
          this.wsEventHandler,
          this.onReconnectWs,
          this.externalApiSvc.restoreTries,
        );
      })
      .catch((reason) => {
        if (reason === WS_CLOSE_REASON_TERMINATE) {
          this.disconnect();
        }
      });
  };

  /**
   * Disconnect application
   */
  async disconnect() {
    for (const part of this.getParticipantsOfDn(this.sourceDn!)?.values() ?? []) {
      if (part.streamCancelationToken) {
        await this.gratefulShutDownStream(part.id!);
      }
    }
    this.externalApiSvc.disconnect();
    this.config = null;
    this.sourceDn = null;
    this.fullInfo?.callcontrol.clear();
    this.failedCalls = [];
    this.callQueue.clear();
    this.externalApiSvc.wsClient?.terminate();
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
      connected: this.externalApiSvc.connected,
      sorceDn: this.sourceDn,
      keymap: this.config?.keyCommands,
      callQueue,
      wavSource: this.config?.wavSource,
      failedCalls: this.failedCalls,
      currentParticipants: participants
        ? Array.from(participants.values()).map((participant) => ({
            ...participant,
            streamCancelationToken: undefined,
            flushChunksToken: undefined,
            recognizeStream: undefined,
            dtmfHandlingInProcess: undefined,
            stream: undefined,
          }))
        : [],
      wsConnected: this.externalApiSvc.wsClient?.readyState !== WebSocket.CLOSED,
      aiModeOn: this.config?.aiModeOn,
    };
  }
  /**
   * Ivr config update
   * prompt, dtmf values
   * @param config
   */
  public setup(config: Record<string, unknown>) {
    this.config = config as TCustomIVRConfig;
  }
  /**
   * event handler for incoming webhooks from PBX
   * @param wsEvent
   * @returns
   */
  public wsEventHandler = (json: string) => {
    try {
      const wsEvent: WSEvent = JSON.parse(json);
      if (!this.externalApiSvc.connected || !wsEvent?.event?.entity) {
        return;
      }
      const { dn, id, type } = determineOperation(wsEvent.event.entity);
      switch (wsEvent.event.event_type) {
        case EventType.Upset:
          {
            this.externalApiSvc
              .requestUpdatedEntityFromWebhookEvent(wsEvent)
              .then((res) => {
                const data = res.data;
                this.updateParticipant(parseFloat(id), data, wsEvent.event.entity);
                if (dn === this.sourceDn) {
                  if (type === PARTICIPANT_TYPE_UPDATE) {
                    /**
                     * handle here updated participants
                     */
                    const participant = this.getParticipantOfDnById(dn, parseFloat(id));
                    if (!participant || !this.externalApiSvc.connected) {
                      return;
                    }
                    if (participant.status === PARTICIPANT_STATUS_CONNECTED) {
                      if (this.config?.aiModeOn) {
                        this.handleAIStreams(participant.id!);
                      } else {
                        this.handleParticipantPromptStream(participant.id!);
                      }
                    }
                  }
                }
              })
              .catch((err) => {
                if (axios.isAxiosError(err)) {
                  console.error(`AXIOS ERROR code: ${err.response?.status}`);
                } else console.error('Unknown error', err);
              });
          }
          break;
        case EventType.DTMFstring:
          {
            if (dn === this.sourceDn) {
              if (type === PARTICIPANT_TYPE_UPDATE) {
                /**
                 * handle here recieved DTMF strings
                 */
                const participant = this.getParticipantOfDnById(dn, parseFloat(id));
                if (
                  this.externalApiSvc.connected &&
                  participant &&
                  typeof wsEvent.event?.attached_data?.dtmf_input === 'string' &&
                  !participant.dtmfHandlingInProcess
                ) {
                  this.handleDTMFInput(
                    participant.id!,
                    wsEvent.event.attached_data.dtmf_input,
                  ).catch((e) => console.error(e));
                }
              }
            }
          }
          break;
        case EventType.Remove: {
          if (dn === this.sourceDn) {
            if (type === PARTICIPANT_TYPE_UPDATE) {
              /**
               * handle here removed participants
               */
              const idNumeric = parseFloat(id);
              if (idNumeric) {
                this.gratefulShutDownStream(idNumeric).finally(() => {
                  set(this.fullInfo!, wsEvent.event.entity, undefined);
                  const participants = this.getParticipantsOfDn(this.sourceDn);
                  if (!participants || participants?.size < 1) {
                    this.makeCallsToDst();
                  }
                });
              }
            }
          }
        }
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        console.error(`AXIOS ERROR code: ${err.response?.status}`);
      } else console.error('Unknown error', err);
    }
  };

  private getParticipantOfDnById(dn: string, id: number) {
    return this.fullInfo?.callcontrol.get(dn)?.participants.get(String(id));
  }

  private getParticipantOfTheSourceDnById(id: number) {
    if (!this.sourceDn) return undefined;
    return this.getParticipantOfDnById(this.sourceDn, id);
  }

  private getParticipantsOfDn(dn?: string | null) {
    return dn ? this.fullInfo?.callcontrol.get(dn)?.participants : undefined;
  }

  private updateParticipant(
    participantId: number,
    newData: Partial<ExtendedParticipant>,
    whookEventEntity?: string,
  ): ExtendedParticipant | undefined {
    if (!this.fullInfo || !this.sourceDn) throw Error('Full Info is missing');
    const exParticipant = this.getParticipantOfTheSourceDnById(participantId);

    if (!exParticipant) {
      return set(this.fullInfo, whookEventEntity!, newData);
    } else {
      return set<ExtendedParticipant>(
        this.fullInfo,
        getParticipantUpdatePath(participantId, this.sourceDn),
        {
          ...exParticipant,
          ...newData,
        },
      );
    }
  }
  /**
   * Starts handling stream for participant
   * getting audio stream from participant + post stream from file
   * @param participant
   * @returns
   */
  public async handleParticipantPromptStream(participantId: number) {
    if (!this.config) {
      return;
    }
    const participant = this.getParticipantOfTheSourceDnById(participantId);

    if (participant !== undefined && this.sourceDn && participant.id && !participant.stream) {
      try {
        const outputStream = new TransformStream();
        const outputWriter = outputStream.writable.getWriter();

        const updated = this.updateParticipant(participant.id, {
          stream: outputWriter,
          streamCancelationToken: new CancelationToken(),
        });

        const postAudio = this.externalApiSvc.postAudioStream(
          this.sourceDn,
          participant.id,
          outputStream.readable,
          updated!.streamCancelationToken!,
        );
        const getAudio = this.externalApiSvc
          .getAudioStream(this.sourceDn, participant.id)
          .then((response) => {
            response.data.on('close', () => {
              this.gratefulShutDownStream(participant.id!);
            });
          });
        this.startStreamFromFile('output.wav', participant.id!);
        return Promise.all([getAudio, postAudio]).catch(() => {
          this.gratefulShutDownStream(participant.id!);
        });
      } catch {
        this.gratefulShutDownStream(participant.id!);
      }
    }
  }

  public handleAIStreams(participantId: number) {
    if (!this.config) {
      return;
    }

    const participant = this.getParticipantOfTheSourceDnById(participantId);
    if (participant !== undefined && this.sourceDn && participant.id && !participant.stream) {
      try {
        const outputStream = new TransformStream();
        const outputWriter = outputStream.writable.getWriter();
        const recognizeStream = this.aiSvc.createRecognizeStream();

        const updated = this.updateParticipant(participant.id, {
          stream: outputWriter,
          streamCancelationToken: new CancelationToken(),
          flushChunksToken: new CancelationToken(),
          recognizeStream,
        });

        const postAudio = this.externalApiSvc.postAudioStream(
          this.sourceDn,
          participant.id,
          outputStream.readable,
          updated!.streamCancelationToken!,
        );

        const getAudio = this.externalApiSvc
          .getAudioStream(this.sourceDn, participant.id)
          .then((response) => {
            let chunks: Buffer[] = [];
            response.data.on('data', (chunk: Buffer) => {
              if (chunks.length < 50) {
                chunks.push(chunk);
              } else {
                const bigBuff = Buffer.concat(chunks);
                if (!recognizeStream.destroyed) {
                  recognizeStream.write(bigBuff);
                }
                chunks = [];
              }
            });
            response.data.on('close', () => {
              this.gratefulShutDownStream(participant.id!);
            });
          })
          .catch((err) => console.error('speech api error', err));

        recognizeStream.on('error', (error) => {
          console.error('❌ Google Speech API Stream Error:', error);
          recognizeStream.destroy();
        });
        recognizeStream.on('data', async (stream) => {
          let transcription = '';
          if (stream.results[0] && stream.results[0].alternatives[0]) {
            transcription = stream.results[0].alternatives[0].transcript;
          }

          if (stream.results[0]?.isFinal && transcription.length) {
            if (this.config!.aiStreamMode === StreamMode.AiChat) {
              const responseChat = this.aiSvc.createChatCompletion();

              responseChat
                .sendMessage(transcription)
                .then(async (response) => {
                  const parts = response.response.candidates?.[0].content.parts;
                  if (parts) {
                    let str = '';
                    for (const part of parts) {
                      if (part.text?.length) {
                        const replaced = part.text.replace(/\*+/gm, '');
                        str += ' ' + replaced;
                      }
                      if (str.length) {
                        const participant = this.getParticipantOfTheSourceDnById(participantId);
                        if (participant?.flushChunksToken) {
                          participant?.flushChunksToken.emit('cancel');
                          const response = await this.aiSvc.createSpeech(str);
                          const arr = response?.[0].audioContent;
                          if (arr) {
                            try {
                              await writeSlicedAudioStream(
                                arr as Uint8Array,
                                outputWriter,
                                participant?.flushChunksToken,
                              );
                            } catch (err) {
                              console.error(err);
                            }
                          }
                        }
                      }
                    }
                  }
                })
                .catch((err) => console.error('vertex ai error', err));
            } else if (this.config!.aiStreamMode === StreamMode.Echo) {
              if (transcription.length) {
                const response = await this.aiSvc.createSpeech(transcription);
                const arr = response?.[0].audioContent;
                const participant = this.getParticipantOfTheSourceDnById(participantId);

                if (arr && participant?.flushChunksToken) {
                  try {
                    await writeSlicedAudioStream(
                      arr as Uint8Array,
                      outputWriter,
                      participant.flushChunksToken,
                    );
                  } catch (err) {
                    console.error(err);
                  }
                }
              }
            }
          }
        });

        return Promise.all([getAudio, postAudio]).catch(() => {
          this.gratefulShutDownStream(participantId);
        });
      } catch (e) {
        console.error(e);
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
    isLoop = false,
  ) {
    const participant = this.getParticipantOfTheSourceDnById(participantId);
    if (!participant) return;

    if (participant.stream !== undefined) {
      let participantUpd = participant;

      if (needRefrsh || !participant.flushChunksToken) {
        // * interrupt chunked stream
        participant.flushChunksToken?.emit('cancel');

        participantUpd = this.updateParticipant(participant.id!, {
          flushChunksToken: new CancelationToken(),
        })!;
      }

      const readable = fs.createReadStream(path.resolve(__dirname, '../../../', 'public', wavPath));
      const chunks: Buffer[] = [];
      readable.on('data', async (chunk: Buffer) => {
        chunks.push(chunk);
      });
      readable.on('end', async () => {
        try {
          if (isLoop) {
            // Repeat stream from audio file
            while (true) {
              await writeSlicedAudioStream(
                Buffer.concat(chunks),
                participantUpd.stream!,
                participantUpd.flushChunksToken!,
              );
            }
          } else {
            await writeSlicedAudioStream(
              Buffer.concat(chunks),
              participantUpd.stream!,
              participantUpd.flushChunksToken!,
            );
          }
        } catch {}
      });
    }
  }
  /**
   * Stop writing to writeable stream and Shutdown all streams for participant
   * @param participantId
   */
  private gratefulShutDownStream(participantId: number) {
    const participant = this.getParticipantOfTheSourceDnById(participantId);
    if (participant?.recognizeStream) {
      participant.recognizeStream.destroy();
    }
    if (participant?.streamCancelationToken || participant?.flushChunksToken) {
      participant.flushChunksToken?.emit('cancel'); // FLush chunk writer
      participant.streamCancelationToken?.emit('cancel'); // Cancel Request
      if (participant.stream) {
        return participant.stream
          .close()
          .catch((e) => console.error(e))
          .finally(() => {
            this.updateParticipant(participant.id!, {
              stream: undefined,
              streamCancelationToken: undefined,
              flushChunksToken: undefined,
            });
          });
      }
    }
    return Promise.resolve();
  }
  /**
   * handles incoming dtmfs from participant
   * @param participant
   * @param dtmfCode
   */
  public async handleDTMFInput(participantId: number, dtmfCode: string) {
    if (!this.config || !this.sourceDn) {
      throw new BadRequest('Config is missing');
    }
    const participant = this.getParticipantOfTheSourceDnById(participantId);
    if (!participant) return;

    const redirectionNumber = this.config?.keyCommands[parseFloat(dtmfCode)];
    if (redirectionNumber) {
      try {
        // TODO -
        this.startStreamFromFile('USProgresstone.wav', participant.id!, true, true);
        await this.externalApiSvc.controlParticipant(
          this.sourceDn,
          participant.id!,
          PARTICIPANT_CONTROL_ROUTE_TO,
          redirectionNumber,
        );
        // SUCCESS
        this.gratefulShutDownStream(participant.id!);
        await this.externalApiSvc.controlParticipant(
          this.sourceDn,
          participant.id!,
          PARTICIPANT_CONTROL_DROP,
        );
      } catch {
        // CANCEL CURRENT SLICED STREAM
        participant.flushChunksToken?.emit('cancel');
        // START AGAIN
        this.startStreamFromFile('output.wav', participant.id!, true);
      }
    } else {
      throw new BadRequest('Redirection Number is not defined');
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
    const arr = dialingSetup.sources
      .split(',')
      .map((num) => num.trim())
      .filter((numb) => {
        return !!numb;
      });
    arr.forEach((destNumber) => this.pushNumbersToQueue(destNumber));
    this.makeCallsToDst();
  }
  /**
   * makes calls from call queue
   * @returns
   */
  public async makeCallsToDst() {
    if (!this.callQueue.isEmpty()) {
      if (this.callQueue.items.head !== null) {
        const destNumber = this.callQueue.getAndRemoveFromQueue();

        if (!this.sourceDn || !this.externalApiSvc.connected) {
          if (destNumber)
            this.failedCalls.push({
              callerId: destNumber,
              reason: NO_SOURCE_OR_DISCONNECTED,
            });
          return;
        }
        const participants = this.getParticipantsOfDn(this.sourceDn);
        if (participants && participants.size > 0) {
          if (destNumber)
            this.failedCalls.push({
              callerId: destNumber,
              reason: CAMPAIGN_SOURCE_BUSY,
            });
          return;
        }

        try {
          const source = this.fullInfo?.callcontrol.get(this.sourceDn);
          const device: DNDevice | undefined = source?.devices?.values().next().value;
          if (!device?.device_id) {
            throw new BadRequest('Devices not found');
          }
          const response = await this.externalApiSvc.makeCallFromDevice(
            this.sourceDn,
            encodeURIComponent(device.device_id),
            destNumber!,
          );
          if (!response.data.result?.id) {
            this.failedCalls.push({
              callerId: destNumber!,
              reason: response?.data?.reasontext || UNKNOWN_CALL_ERROR,
            });
          }
        } catch (error: unknown) {
          if (axios.isAxiosError(error)) {
            this.failedCalls.push({
              callerId: destNumber!,
              reason: error.response?.data.reasontext || UNKNOWN_CALL_ERROR,
            });
          } else {
            this.failedCalls.push({
              callerId: destNumber!,
              reason: UNKNOWN_CALL_ERROR,
            });
          }
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
    destination?: string,
  ) {
    if (!this.sourceDn) {
      throw new InternalServerError('Source Dn is not defined or application is not connected');
    }
    const participant = this.getParticipantOfDnById(this.sourceDn, participantId);

    if (!participant) {
      return;
    }
    return this.externalApiSvc.controlParticipant(
      this.sourceDn,
      participant.id!,
      action,
      destination,
    );
  }
}
