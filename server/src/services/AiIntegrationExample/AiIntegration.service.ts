import { injectable, singleton } from 'tsyringe';
import OpenAI from 'openai';
import { toFile } from 'openai/uploads';
import * as chalk from 'chalk';
import { Writable } from 'stream';

const TARGET_SAMPLE_RATE = 8000;
const TARGET_CHANNELS = 1;
const BYTES_PER_SAMPLE = 2; // 16-bit PCM

type StreamingResult = {
  results: Array<{
    alternatives: Array<{ transcript: string }>;
    isFinal: boolean;
  }>;
};

interface RecognizeStreamOptions {
  openai: OpenAI;
  model: string;
  sampleRate: number;
  minChunkDurationMs?: number;
  flushIntervalMs?: number;
  silenceDurationMs?: number;
}

interface PausableStream {
  pause(): void;
  resume(): void;
  isPaused(): boolean;
}

@injectable()
@singleton()
export class AiIntegrationService {
  private openaiClient?: OpenAI;

  private readonly ttsModel = process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts';
  private readonly sttModel = process.env.OPENAI_STT_MODEL ?? 'gpt-4o-mini-transcribe';
  private readonly llmModel = process.env.OPENAI_LLM_MODEL ?? 'gpt-4o-mini';
  private readonly ttsVoice = process.env.OPENAI_TTS_VOICE ?? 'alloy';
  private readonly llmMaxOutputTokens = Number(process.env.OPENAI_LLM_MAX_TOKENS ?? '256');
  private readonly llmSystemPrompt =
    process.env.OPENAI_LLM_SYSTEM_PROMPT ??
    'Sen, 3CX IVR aramalarında görev yapan, kısa ve net cevaplar veren yardımsever bir asistansın. Her zaman Türkçe yanıt ver.';
  private readonly sttMinChunkDurationMs = Number(process.env.OPENAI_STT_MIN_CHUNK_MS ?? '1600');
  private readonly sttFlushIntervalMs = Number(process.env.OPENAI_STT_FLUSH_INTERVAL_MS ?? '2400');
  private readonly sttSilenceDurationMs = Number(process.env.OPENAI_STT_SILENCE_DURATION_MS ?? '2500');

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      console.warn(
        chalk.yellow(
          '⚠️  OPENAI_API_KEY is not set. AI features will fail until the key is provided.',
        ),
      );
    }
  }

  public async createSpeech(input: string): Promise<Buffer | null> {
    try {
      const client = this.getClient();
      const response = await client.audio.speech.create({
        model: this.ttsModel,
        voice: this.ttsVoice,
        input,
        response_format: 'wav',
      });

      const wavBuffer = Buffer.from(await response.arrayBuffer());
      return this.preparePcmBufferFromWav(wavBuffer);
    } catch (error) {
      console.error(chalk.red('❌ OpenAI Text to Speech error:'), error);
      return null;
    }
  }

  public createRecognizeStream(): PausableStream & Writable {
    const client = this.getClient();
    return new OpenAIRecognizeStream({
      openai: client,
      model: this.sttModel,
      sampleRate: TARGET_SAMPLE_RATE,
      minChunkDurationMs: this.sttMinChunkDurationMs,
      flushIntervalMs: this.sttFlushIntervalMs,
      silenceDurationMs: this.sttSilenceDurationMs,
    });
  }

  public async createChatCompletion(
    prompt: string,
    conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<string | null> {
    try {
      const client = this.getClient();

      // Build messages with conversation history
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: this.llmSystemPrompt },
      ];

      // Add conversation history if available
      if (conversationHistory && conversationHistory.length > 0) {
        messages.push(...conversationHistory);
      }

      // Add current user prompt
      messages.push({ role: 'user', content: prompt });

      const response = await client.responses.create({
        model: this.llmModel,
        input: messages,
        max_output_tokens: this.llmMaxOutputTokens,
        temperature: 0.6,
      });

      const answer = response.output_text?.trim();
      return answer && answer.length > 0 ? answer : null;
    } catch (error) {
      console.error(chalk.red('❌ OpenAI LLM error:'), error);
      return null;
    }
  }

  private getClient(): OpenAI {
    if (this.openaiClient) {
      return this.openaiClient;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required for AI features.');
    }

    this.openaiClient = new OpenAI({ apiKey });
    return this.openaiClient;
  }

  private preparePcmBufferFromWav(wavBuffer: Buffer): Buffer {
    const { samples, sampleRate, channels } = parseWav(wavBuffer);
    const monoSamples = downmixToMono(samples, channels);
    const resampled = resampleLinear(monoSamples, sampleRate, TARGET_SAMPLE_RATE);
    return int16SamplesToBuffer(resampled);
  }
}

class OpenAIRecognizeStream extends Writable implements PausableStream {
  private readonly openai: OpenAI;
  private readonly model: string;
  private readonly sampleRate: number;
  private readonly minChunkBytes: number;
  private readonly flushIntervalMs: number;
  private readonly silenceThreshold = 0.01; // Energy threshold for silence detection
  private silenceDurationMs: number; // Configurable silence duration

  private buffers: Buffer[] = [];
  private bufferLength = 0;
  private flushTimer: NodeJS.Timeout | null = null;
  private processing = false;
  private pendingForceFlush = false;
  private paused = false;
  private pausedBuffers: Buffer[] = [];
  private lastSpeechTime = Date.now();
  private silenceDetected = false;

  constructor(options: RecognizeStreamOptions) {
    super();
    this.openai = options.openai;
    this.model = options.model;
    this.sampleRate = options.sampleRate;
    const minDuration = options.minChunkDurationMs ?? 1200;
    this.flushIntervalMs = options.flushIntervalMs ?? 1800;
    this.silenceDurationMs = options.silenceDurationMs ?? 2500; // Default 2.5 seconds
    this.minChunkBytes = Math.max(
      this.sampleRate * BYTES_PER_SAMPLE * TARGET_CHANNELS * (minDuration / 1000),
      this.sampleRate * BYTES_PER_SAMPLE,
    );
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (this.destroyed) {
      callback();
      return;
    }

    if (!Buffer.isBuffer(chunk)) {
      this.emit('error', new Error('Chunk must be a Buffer containing PCM audio data.'));
      callback();
      return;
    }

    if (this.paused) {
      this.pausedBuffers.push(chunk);
      callback();
      return;
    }

    // Calculate chunk energy to detect speech vs silence
    const chunkEnergy = this.calculateAudioEnergy(chunk);
    const isSpeech = chunkEnergy > this.silenceThreshold;

    if (isSpeech) {
      // Speech detected, reset silence timer
      this.lastSpeechTime = Date.now();
      this.silenceDetected = false;
    } else {
      // Silence detected, check if it's been long enough
      const silenceDuration = Date.now() - this.lastSpeechTime;
      if (silenceDuration >= this.silenceDurationMs && this.bufferLength >= this.minChunkBytes) {
        // Enough silence after speech, flush now (end of utterance)
        if (!this.silenceDetected) {
          this.silenceDetected = true;
          console.log(chalk.cyan(`🔇 End of speech detected (${silenceDuration}ms silence), flushing...`));
          void this.flush(false);
          callback();
          return;
        }
      }
    }

    this.buffers.push(chunk);
    this.bufferLength += chunk.length;

    // Fallback: if buffer gets too large, flush anyway
    if (this.bufferLength >= this.minChunkBytes * 3) {
      console.log(chalk.yellow('⚠️  Buffer too large, force flushing...'));
      void this.flush(false);
    } else {
      this.scheduleFlush();
    }

    callback();
  }

  pause(): void {
    this.paused = true;
    this.clearFlushTimer();
    this.pausedBuffers = []; // Discard buffered data from AI's voice output
    console.log(chalk.cyan('⏸️  STT stream PAUSED'));
  }

  resume(): void {
    this.paused = false;
    this.pausedBuffers = [];
    this.buffers = [];
    this.bufferLength = 0;
    console.log(chalk.cyan('▶️  STT stream RESUMED'));
  }

  isPaused(): boolean {
    return this.paused;
  }

  override _final(callback: (error?: Error | null) => void): void {
    void this.flush(true).finally(() => callback());
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    const flushPromise = this.flush(true);
    flushPromise
      .catch((err) => {
        if (err) {
          this.emit('error', err);
        }
      })
      .finally(() => {
        this.clearFlushTimer();
        callback(error ?? undefined);
      });
  }

  private scheduleFlush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    this.flushTimer = setTimeout(() => {
      void this.flush(false);
    }, this.flushIntervalMs);
  }

  private clearFlushTimer() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private async flush(force: boolean): Promise<void> {
    if (this.processing) {
      if (force) {
        this.pendingForceFlush = true;
      }
      return;
    }

    if (!force && this.bufferLength < this.minChunkBytes) {
      return;
    }

    this.clearFlushTimer();

    const combined = Buffer.concat(this.buffers);
    this.buffers = [];
    this.bufferLength = 0;

    if (!combined.length) {
      return;
    }

    // CRITICAL: Check audio energy to prevent Whisper hallucinations from silence/noise
    const audioEnergy = this.calculateAudioEnergy(combined);
    const ENERGY_THRESHOLD = 0.01; // Minimum energy threshold for real speech

    if (audioEnergy < ENERGY_THRESHOLD) {
      console.log(
        chalk.gray(`🔇 Skipping STT: audio energy too low (${audioEnergy.toFixed(4)} < ${ENERGY_THRESHOLD})`),
      );
      return;
    }

    this.processing = true;
    try {
      const wavBuffer = pcmToWav(combined, this.sampleRate, TARGET_CHANNELS);
      const file = await toFile(wavBuffer, `ivr-segment-${Date.now()}.wav`, {
        type: 'audio/wav',
      });

      const response = await this.openai.audio.transcriptions.create({
        model: this.model,
        file,
        response_format: 'json',
        language: 'tr',
      });

      const transcript = response.text?.trim();

      // Validate transcript to prevent Whisper hallucinations
      if (transcript && this.isValidTranscript(transcript)) {
        console.log(chalk.magenta(`🎤 Audio energy: ${audioEnergy.toFixed(4)}`));
        const payload: StreamingResult = {
          results: [
            {
              alternatives: [{ transcript }],
              isFinal: true,
            },
          ],
        };
        this.emit('data', payload);
      } else if (transcript) {
        console.log(
          chalk.yellow(`⚠️  Discarding suspicious transcript (possible hallucination): "${transcript}"`),
        );
      }
    } catch (error) {
      this.emit('error', error as Error);
    } finally {
      this.processing = false;

      if (this.pendingForceFlush) {
        this.pendingForceFlush = false;
        await this.flush(true);
      }
    }
  }

  private calculateAudioEnergy(buffer: Buffer): number {
    // Calculate RMS (Root Mean Square) energy of audio
    let sum = 0;
    const samples = buffer.length / BYTES_PER_SAMPLE;

    for (let i = 0; i < buffer.length; i += BYTES_PER_SAMPLE) {
      const sample = buffer.readInt16LE(i) / 32768.0; // Normalize to -1.0 to 1.0
      sum += sample * sample;
    }

    return Math.sqrt(sum / samples);
  }

  private isValidTranscript(transcript: string): boolean {
    // Filter out common Whisper hallucinations
    const hallucinations = [
      'thank you',
      'thanks for watching',
      'copyright',
      'subtitles',
      'subscribe',
      'like and subscribe',
      'altyazı',
      'teşekkürler',
      'abone ol',
    ];

    const lowerTranscript = transcript.toLowerCase();

    // Check for hallucination patterns
    for (const pattern of hallucinations) {
      if (lowerTranscript.includes(pattern)) {
        return false;
      }
    }

    // Minimum length check (very short transcripts from silence are suspicious)
    if (transcript.length < 3) {
      return false;
    }

    return true;
  }
}

function parseWav(buffer: Buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Provided audio is not a valid WAV file.');
  }

  let offset = 12;
  let fmt: {
    audioFormat: number;
    channels: number;
    sampleRate: number;
    bitsPerSample: number;
  } | null = null;
  let dataOffset = -1;
  let dataLength = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const nextChunkStart = offset + 8 + chunkSize + (chunkSize % 2);

    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: buffer.readUInt16LE(offset + 8),
        channels: buffer.readUInt16LE(offset + 10),
        sampleRate: buffer.readUInt32LE(offset + 12),
        bitsPerSample: buffer.readUInt16LE(offset + 22),
      };
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataLength = chunkSize;
      break;
    }

    offset = nextChunkStart;
  }

  if (!fmt || fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) {
    throw new Error('Unsupported WAV format. Expected 16-bit PCM audio.');
  }
  if (dataOffset < 0) {
    throw new Error('WAV file is missing data chunk.');
  }

  // Handle invalid chunk sizes from OpenAI TTS (0xFFFFFFFF or larger than buffer)
  const maxAvailable = buffer.length - dataOffset;
  if (maxAvailable <= 0) {
    throw new Error('WAV data chunk is empty or malformed.');
  }

  // If chunk size is invalid (too large or 0xFFFFFFFF), use actual buffer size
  const actualDataLength = (dataLength > maxAvailable || dataLength === 0xFFFFFFFF)
    ? maxAvailable
    : Math.min(dataLength, maxAvailable);

  const usableLength = actualDataLength - (actualDataLength % BYTES_PER_SAMPLE);

  if (dataLength === 0xFFFFFFFF || dataLength > maxAvailable) {
    console.warn(
      chalk.yellow(
        `⚠️  WAV data chunk has invalid size (${dataLength}), using actual buffer size: ${usableLength} bytes`,
      ),
    );
  }

  const samplesCount = usableLength / BYTES_PER_SAMPLE;
  const samples = new Int16Array(samplesCount);

  for (let i = 0; i < samplesCount; i++) {
    const byteOffset = dataOffset + i * BYTES_PER_SAMPLE;
    samples[i] = buffer.readInt16LE(byteOffset);
  }

  return {
    samples,
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
  };
}

function downmixToMono(samples: Int16Array, channels: number): Int16Array {
  if (channels === 1) {
    return samples;
  }

  const frameCount = samples.length / channels;
  const mono = new Int16Array(frameCount);

  for (let frame = 0; frame < frameCount; frame++) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) {
      sum += samples[frame * channels + channel];
    }
    mono[frame] = Math.round(sum / channels);
  }

  return mono;
}

function resampleLinear(samples: Int16Array, sourceRate: number, targetRate: number): Int16Array {
  if (sourceRate === targetRate) {
    return samples;
  }
  if (samples.length === 0) {
    return samples;
  }

  const resultLength = Math.max(1, Math.round((samples.length * targetRate) / sourceRate));
  const result = new Int16Array(resultLength);

  if (resultLength === 1 || samples.length === 1) {
    result[0] = samples[0];
    return result;
  }

  const scale = (samples.length - 1) / (resultLength - 1);
  for (let i = 0; i < resultLength; i++) {
    const position = i * scale;
    const leftIndex = Math.floor(position);
    const rightIndex = Math.min(samples.length - 1, leftIndex + 1);
    const fraction = position - leftIndex;

    const interpolated =
      samples[leftIndex] + (samples[rightIndex] - samples[leftIndex]) * fraction;
    result[i] = clampToInt16(interpolated);
  }

  return result;
}

function clampToInt16(value: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(value)));
}

function int16SamplesToBuffer(samples: Int16Array): Buffer {
  const buffer = Buffer.alloc(samples.length * BYTES_PER_SAMPLE);
  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(samples[i], i * BYTES_PER_SAMPLE);
  }
  return buffer;
}

function pcmToWav(pcmBuffer: Buffer, sampleRate: number, channels: number): Buffer {
  const dataLength = pcmBuffer.length;
  const chunkSize = 36 + dataLength;
  const byteRate = sampleRate * channels * BYTES_PER_SAMPLE;
  const blockAlign = channels * BYTES_PER_SAMPLE;

  const wavBuffer = Buffer.alloc(44 + dataLength);

  wavBuffer.write('RIFF', 0);
  wavBuffer.writeUInt32LE(chunkSize, 4);
  wavBuffer.write('WAVE', 8);

  wavBuffer.write('fmt ', 12);
  wavBuffer.writeUInt32LE(16, 16); // Subchunk1Size for PCM
  wavBuffer.writeUInt16LE(1, 20); // PCM format
  wavBuffer.writeUInt16LE(channels, 22);
  wavBuffer.writeUInt32LE(sampleRate, 24);
  wavBuffer.writeUInt32LE(byteRate, 28);
  wavBuffer.writeUInt16LE(blockAlign, 32);
  wavBuffer.writeUInt16LE(16, 34); // bits per sample

  wavBuffer.write('data', 36);
  wavBuffer.writeUInt32LE(dataLength, 40);
  pcmBuffer.copy(wavBuffer, 44);

  return wavBuffer;
}
