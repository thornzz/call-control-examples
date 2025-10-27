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
import * as chalk from 'chalk';

const PCM_SAMPLE_RATE = 8000;
const PCM_BYTES_PER_SAMPLE = 2;
const RESPONSE_PADDING_MS = 750;

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
        await this.gracefulShutdownStream(part.id!);
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
      aiStreamMode: this.config?.aiStreamMode,
    };
  }
  /**
   * Ivr config update
   * prompt, dtmf values
   * @param config
   */
  public setup(config: Record<string, unknown>) {
    this.config = {
      ...config,
      aiStreamMode: Number(config.aiStreamMode),
    } as TCustomIVRConfig;
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
                  console.error(chalk.red(`❌ AXIOS ERROR code: ${err.response?.status}`));
                } else console.error(chalk.red('❌ Unknown error', err));
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
                  ).catch((e) => console.error(chalk.red('🚨', e)));
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
                this.gracefulShutdownStream(idNumeric).finally(() => {
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
        console.error(chalk.red(`❌AXIOS ERROR code: ${err.response?.status}`));
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

  private normalizeText(value: string) {
    return value
      .toLocaleLowerCase('tr-TR')
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private tokensSimilarityRatio(a: string, b: string) {
    const tokensA = a.split(' ').filter(Boolean);
    const tokensB = b.split(' ').filter(Boolean);
    if (!tokensA.length || !tokensB.length) return 0;

    const counter = new Map<string, number>();
    for (const token of tokensB) {
      counter.set(token, (counter.get(token) ?? 0) + 1);
    }

    let overlap = 0;
    for (const token of tokensA) {
      const current = counter.get(token) ?? 0;
      if (current > 0) {
        overlap += 1;
        counter.set(token, current - 1);
      }
    }

    return overlap / Math.min(tokensA.length, tokensB.length);
  }

  private shouldIgnoreTranscription(normalizedTranscription: string, participant: ExtendedParticipant) {
    if (!normalizedTranscription) {
      return true;
    }

    if (participant.ignoreTranscriptsUntil && Date.now() < participant.ignoreTranscriptsUntil) {
      return true;
    }

    const lastNormalized = participant.lastAiResponseNormalized;
    if (!lastNormalized) {
      return false;
    }

    if (participant.lastAiResponseAt && Date.now() - participant.lastAiResponseAt > 10000) {
      return false;
    }

    if (normalizedTranscription === lastNormalized) {
      return true;
    }

    const tokensCurrent = normalizedTranscription.split(' ').filter(Boolean);
    const tokensLast = lastNormalized.split(' ').filter(Boolean);

    if (tokensCurrent.length >= 3 && tokensLast.length >= 3) {
      const minLen = Math.min(normalizedTranscription.length, lastNormalized.length);
      if (minLen >= 12) {
        if (
          lastNormalized.includes(normalizedTranscription) ||
          normalizedTranscription.includes(lastNormalized)
        ) {
          return true;
        }
      }

      const ratio = this.tokensSimilarityRatio(normalizedTranscription, lastNormalized);
      if (ratio >= 0.8) {
        return true;
      }
    }

    return false;
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
    if (!participant || !this.sourceDn || !participant.id || participant.stream !== undefined)
      return;

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
            this.gracefulShutdownStream(participant.id!);
          });
        });
      this.startStreamFromFile('output.wav', participant.id!);
      return Promise.all([getAudio, postAudio]).catch(() => {
        this.gracefulShutdownStream(participant.id!);
      });
    } catch {
      this.gracefulShutdownStream(participant.id!);
    }
  }
  private async processTranscription(chunk: any, participantId: number) {
    const transcription = chunk.results?.[0]?.alternatives?.[0]?.transcript ?? '';
    const isFinal = chunk.results?.[0]?.isFinal;

    if (!isFinal) {
      return;
    }

    const participant = this.getParticipantOfTheSourceDnById(participantId);
    if (!participant) {
      return;
    }

    // Prevent concurrent processing of transcriptions
    if (participant.processingTranscription) {
      console.log(chalk.yellow('⚠️  Already processing transcription, skipping'));
      return;
    }

    const normalized = this.normalizeText(transcription);
    console.log(chalk.yellow(`📝 Transcription received: "${transcription}" (normalized: "${normalized}")`));
    
    if (!normalized) {
      console.log(chalk.yellow('⚠️  Normalized transcription is empty, skipping'));
      return;
    }

    if (this.shouldIgnoreTranscription(normalized, participant)) {
      console.log(chalk.yellow(`⚠️  Ignoring duplicate/similar transcription: "${normalized}"`));
      return;
    }

    // Mark as processing
    this.updateParticipant(participantId, {
      processingTranscription: true,
      lastAiResponse: undefined,
      lastAiResponseNormalized: undefined,
      ignoreTranscriptsUntil: undefined,
    });

    const trimmed = transcription.trim();
    console.log(chalk.green(`✅ Processing transcription: "${trimmed}"`));
    
    try {
      if (this.config!.aiStreamMode === StreamMode.AiChat) {
        await this.handleAiChatMode(participantId, trimmed);
      } else if (this.config!.aiStreamMode === StreamMode.Echo) {
        await this.handleEchoMode(participantId, trimmed);
      }
    } finally {
      // Mark processing as complete
      this.updateParticipant(participantId, {
        processingTranscription: false,
      });
    }
  }

  private async streamOutgoingAudio(participantId: number, recognizeStream: any) {
    try {
      const response = await this.externalApiSvc.getAudioStream(this.sourceDn!, participantId);
      let chunks: Buffer[] = [];

      const handleDataChunk = (chunk: Buffer) => {
        // Check if stream is currently paused
        const isStreamPaused = 'isPaused' in recognizeStream && recognizeStream.isPaused();

        if (isStreamPaused) {
          // Stream is paused, discard all incoming audio to prevent AI voice echo
          // This prevents the AI's TTS output from being transcribed back
          return;
        }

        // Send audio directly to STT stream
        // Energy-based filtering happens in OpenAIRecognizeStream
        chunks.push(chunk);
        if (chunks.length >= 50) {
          recognizeStream.write(Buffer.concat(chunks));
          chunks = [];
        }
      };

      response.data.on('data', handleDataChunk);
      response.data.on('close', () => this.gracefulShutdownStream(participantId));
      response.data.on('error', (err: Error) => {
        console.error(chalk.red('❌ Audio stream error:'), err);
        this.gracefulShutdownStream(participantId);
      });
    } catch (err) {
      console.error(chalk.red('❌ OpenAI speech stream error:'), err);
    }
  }

  private async handleAiChatMode(participantId: number, transcription: string) {
    const participant = this.getParticipantOfTheSourceDnById(participantId);

    try {
      // CRITICAL: Pause STT stream IMMEDIATELY to prevent re-processing AI's voice output
      if (participant?.recognizeStream && 'pause' in participant.recognizeStream) {
        console.log(chalk.cyan('⏸️  PAUSING STT stream before AI processing...'));
        (participant.recognizeStream as any).pause();
      } else {
        console.log(chalk.yellow('⚠️  recognizeStream not available for pause'));
      }

      console.info(chalk.cyan('🤖 Sending to LLM:'), chalk.blue(transcription));
      const responseText = await this.aiSvc.createChatCompletion(transcription);

      if (responseText) {
        console.info(chalk.green('🌞 LLM Response:'), chalk.blue(responseText));
      }

      if (!responseText || !participant?.flushChunksToken) {
        console.log(chalk.yellow('⚠️  No response from LLM or missing flush token, resuming STT...'));
        if (participant?.recognizeStream && 'resume' in participant.recognizeStream) {
          (participant.recognizeStream as any).resume();
        }
        return;
      }

      // Cancel any ongoing audio playback
      participant.flushChunksToken.emit('cancel');

      const normalizedResponse = this.normalizeText(responseText);
      this.updateParticipant(participantId, {
        lastAiResponse: responseText,
        lastAiResponseNormalized: normalizedResponse,
        lastAiResponseAt: Date.now(),
      });

      console.info(chalk.cyan('💬 Generating TTS audio...'));
      const audioResponse = await this.aiSvc.createSpeech(responseText);
      console.info(chalk.green('✅ TTS audio generated'));

      if (!audioResponse) {
        console.log(chalk.yellow('⚠️  No audio response received, resuming STT...'));
        const resumeParticipant = this.getParticipantOfTheSourceDnById(participantId);
        if (resumeParticipant?.recognizeStream && 'resume' in resumeParticipant.recognizeStream) {
          (resumeParticipant.recognizeStream as any).resume();
        }
        return;
      }

      // Send audio while STT is still paused
      await this.sendAudioToStream(audioResponse, participantId);

      console.info(chalk.green('✅ TTS audio buffer sent'));

      // CONVERSATIONAL MODE: Resume immediately for natural interaction
      // Trust energy-based filtering to handle echo/overlap
      // No waiting - this creates a real-time conversation feel
      console.info(chalk.cyan('⚡ Resuming STT immediately for conversational response...'));

      const updatedParticipant = this.getParticipantOfTheSourceDnById(participantId);
      if (updatedParticipant?.recognizeStream && 'resume' in updatedParticipant.recognizeStream) {
        console.log(chalk.cyan('▶️  RESUMING STT stream (ready for user speech)...'));
        (updatedParticipant.recognizeStream as any).resume();
      }
    } catch (err) {
      console.error(chalk.red('❌ OpenAI Chat error:'), err);
      // Always resume STT on error
      const updatedParticipant = this.getParticipantOfTheSourceDnById(participantId);
      if (updatedParticipant?.recognizeStream && 'resume' in updatedParticipant.recognizeStream) {
        console.log(chalk.cyan('▶️  RESUMING STT stream after error...'));
        (updatedParticipant.recognizeStream as any).resume();
      }
    }
  }

  private async handleEchoMode(participantId: number, transcription: string) {
    const participant = this.getParticipantOfTheSourceDnById(participantId);

    try {
      // CRITICAL: Pause STT stream IMMEDIATELY to prevent re-processing AI's voice output
      if (participant?.recognizeStream && 'pause' in participant.recognizeStream) {
        console.log(chalk.cyan('⏸️  PAUSING STT stream before Echo TTS...'));
        (participant.recognizeStream as any).pause();
      } else {
        console.log(chalk.yellow('⚠️  recognizeStream not available for pause'));
      }

      if (!participant?.flushChunksToken) {
        console.log(chalk.yellow('⚠️  Missing flush token, resuming STT...'));
        if (participant?.recognizeStream && 'resume' in participant.recognizeStream) {
          (participant.recognizeStream as any).resume();
        }
        return;
      }

      // Cancel any ongoing audio playback
      participant.flushChunksToken.emit('cancel');

      const normalizedResponse = this.normalizeText(transcription);
      this.updateParticipant(participantId, {
        lastAiResponse: transcription,
        lastAiResponseNormalized: normalizedResponse,
        lastAiResponseAt: Date.now(),
      });

      console.info(chalk.cyan('💬 Generating Echo TTS audio...'));
      const audioResponse = await this.aiSvc.createSpeech(transcription);
      console.info(chalk.green('✅ Echo TTS audio generated'));

      if (!audioResponse) {
        console.log(chalk.yellow('⚠️  No audio response received, resuming STT...'));
        const resumeParticipant = this.getParticipantOfTheSourceDnById(participantId);
        if (resumeParticipant?.recognizeStream && 'resume' in resumeParticipant.recognizeStream) {
          (resumeParticipant.recognizeStream as any).resume();
        }
        return;
      }

      // Send audio while STT is still paused
      await this.sendAudioToStream(audioResponse, participantId);

      console.info(chalk.green('✅ Echo TTS audio buffer sent'));

      // CONVERSATIONAL MODE: Resume immediately for natural interaction
      // Trust energy-based filtering to handle echo/overlap
      // No waiting - this creates a real-time conversation feel
      console.info(chalk.cyan('⚡ Resuming STT immediately for conversational response...'));

      const updatedParticipant = this.getParticipantOfTheSourceDnById(participantId);
      if (updatedParticipant?.recognizeStream && 'resume' in updatedParticipant.recognizeStream) {
        console.log(chalk.cyan('▶️  RESUMING STT stream (ready for user speech)...'));
        (updatedParticipant.recognizeStream as any).resume();
      }
    } catch (err) {
      console.error(chalk.red('❌ Error in Echo mode create speech:'), err);
      // Always resume STT on error
      const updatedParticipant = this.getParticipantOfTheSourceDnById(participantId);
      if (updatedParticipant?.recognizeStream && 'resume' in updatedParticipant.recognizeStream) {
        console.log(chalk.cyan('▶️  RESUMING STT stream after error...'));
        (updatedParticipant.recognizeStream as any).resume();
      }
    }
  }

  private async sendAudioToStream(audioResponse: Buffer | null, participantId: number) {
    const participant = this.getParticipantOfTheSourceDnById(participantId);
    if (!audioResponse || !participant?.flushChunksToken || !participant.stream) {
      return;
    }

    console.warn(chalk.green('✅ Audio response received'));
    try {
      const estimatedDurationMs = Math.ceil(
        (audioResponse.length / (PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE)) * 1000,
      );
      const updatedParticipant =
        this.updateParticipant(participantId, {
          ignoreTranscriptsUntil: Date.now() + estimatedDurationMs + RESPONSE_PADDING_MS,
        }) ?? participant;

      await writeSlicedAudioStream(
        audioResponse,
        updatedParticipant.stream!,
        updatedParticipant.flushChunksToken!,
      );
    } catch (err) {
      if (err) {
        console.warn(chalk.yellow('🤚 Sliced audio stream has been stopped...'), err);
      } else {
        console.warn(chalk.yellow('🤚 Sliced audio stream has been stopped...'));
      }
    }
  }

  private initializeStreams(participanId: number) {
    const outputStream = new TransformStream();
    const outputWriter = outputStream.writable.getWriter();
    const recognizeStream = this.aiSvc.createRecognizeStream();

    const updatedParticipant = this.updateParticipant(participanId, {
      stream: outputWriter,
      streamCancelationToken: new CancelationToken(),
      flushChunksToken: new CancelationToken(),
      recognizeStream,
    });

    if (!updatedParticipant) return { updatedParticipant: undefined, outputStream: undefined };

    recognizeStream.on('error', (error) => {
      console.error(chalk.red('❌ OpenAI Speech Stream Error:'), error);
      recognizeStream.destroy();
    });

    recognizeStream.on('data', async (chunk) => {
      await this.processTranscription(chunk, participanId);
    });

    return { updatedParticipant, outputStream };
  }

  public handleAIStreams(participantId: number) {
    if (!this.config) return;

    const participant = this.getParticipantOfTheSourceDnById(participantId);
    if (!participant || !this.sourceDn || !participant.id || participant.stream !== undefined)
      return;

    try {
      const { updatedParticipant, outputStream } = this.initializeStreams(participantId);

      if (!updatedParticipant || !outputStream) {
        console.error(chalk.red('❌ Cannot proceed with the stream, participant is missing'));
        return;
      }

      const audioStreamingTasks = [
        this.streamOutgoingAudio(participant.id, updatedParticipant.recognizeStream),
        this.externalApiSvc.postAudioStream(
          this.sourceDn,
          participant.id,
          outputStream.readable,
          updatedParticipant.streamCancelationToken!,
        ),
      ];

      return Promise.all(audioStreamingTasks).catch(() => {
        this.gracefulShutdownStream(participant.id!);
      });
    } catch (error) {
      console.error(chalk.red('❌ Error handling AI streams:', error));
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
  private gracefulShutdownStream(participantId: number) {
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
          .catch((e) => console.error(chalk.red(e)))
          .finally(() => {
            this.updateParticipant(participant.id!, {
              stream: undefined,
              streamCancelationToken: undefined,
              flushChunksToken: undefined,
            });
          });
      }
    }
    console.warn(chalk.yellow('✅ Streams have been gracefully ended'));
    return Promise.resolve();
  }
  /**
   * handles incoming dtmfs from participant
   * @param participant
   * @param dtmfCode
   */
  public async handleDTMFInput(participantId: number, dtmfCode: string) {
    if (!this.config || !this.sourceDn) {
      throw new BadRequest(chalk.red('❌ Config is missing'));
    }
    const participant = this.getParticipantOfTheSourceDnById(participantId);
    if (!participant) return;

    const redirectionNumber = this.config?.keyCommands[parseFloat(dtmfCode)];
    if (redirectionNumber) {
      try {
        this.startStreamFromFile('USProgresstone.wav', participant.id!, true, true);
        await this.externalApiSvc.controlParticipant(
          this.sourceDn,
          participant.id!,
          PARTICIPANT_CONTROL_ROUTE_TO,
          redirectionNumber,
        );
        // SUCCESS
        this.gracefulShutdownStream(participant.id!);
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
    arr.forEach((destNumber) => this.callQueue.enqueue(destNumber));
    this.makeCallsToDst();
  }
  /**
   * makes calls from call queue
   * @returns
   */
  public async makeCallsToDst() {
    if (!this.callQueue.isEmpty()) {
      if (this.callQueue.items.head !== null) {
        const destNumber = this.callQueue.dequeue();

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
