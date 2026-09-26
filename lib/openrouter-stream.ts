import type { CompletionPayload } from './openrouter';

export type StreamParseResult = {
  content: string;
  payload: CompletionPayload;
};

export class NeedMarkerBuffer {
  private pending = '';

  constructor(private readonly emit: (text: string) => void) {}

  push(text: string) {
    this.pending += text;
    const marker = this.pending.search(/\[NEED(?:\s*:\s*workout)?/i);
    if (marker >= 0) {
      const prefix = this.pending.slice(0, marker);
      if (prefix) this.emit(prefix);
      const complete = this.pending.match(
        /\[NEED:\s*workout\s+20\d{2}-\d{2}-\d{2}\]/i,
      );
      this.pending = complete
        ? this.pending.slice(marker + complete[0].length)
        : this.pending.slice(marker);
      return;
    }
    const safeLength = Math.max(0, this.pending.length - 40);
    if (safeLength) {
      this.emit(this.pending.slice(0, safeLength));
      this.pending = this.pending.slice(safeLength);
    }
  }

  reset() {
    this.pending = '';
  }

  flush() {
    const text = this.pending.replace(
      /\[NEED:\s*workout\s+20\d{2}-\d{2}-\d{2}\]/gi,
      '',
    );
    if (text) this.emit(text);
    this.pending = '';
  }
}

type StreamChunk = {
  id?: string | null;
  model?: string | null;
  provider?: string | null;
  choices?: Array<{
    finish_reason?: string | null;
    native_finish_reason?: string | null;
    delta?: {
      content?: string | null;
      reasoning?: string | null;
      refusal?: string | null;
    };
    message?: { refusal?: string | null };
  }>;
  usage?: CompletionPayload['usage'];
};

export async function parseOpenRouterStream(
  stream: ReadableStream<Uint8Array>,
  onDelta?: (text: string) => void,
): Promise<StreamParseResult> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let streamId: string | null = null;
  let streamModel: string | null = null;
  let streamProvider: string | null = null;
  let finishReason: string | null = null;
  let nativeFinishReason: string | null = null;
  let streamUsage: CompletionPayload['usage'] = null;
  let refusal: string | null = null;
  let done = false;
  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) return;
    const data = trimmed.startsWith('data:')
      ? trimmed.slice('data:'.length).trim()
      : '';
    if (!data || data === '[DONE]') {
      if (data === '[DONE]') done = true;
      return;
    }
    let chunk: StreamChunk;
    try {
      chunk = JSON.parse(data) as StreamChunk;
    } catch {
      return;
    }
    if (chunk.id) streamId = chunk.id;
    if (chunk.model) streamModel = chunk.model;
    if (chunk.provider) streamProvider = chunk.provider;
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (choice?.native_finish_reason)
      nativeFinishReason = choice.native_finish_reason;
    if (chunk.usage) streamUsage = chunk.usage;
    const delta = choice?.delta?.content;
    if (typeof delta === 'string' && delta) {
      content += delta;
      onDelta?.(delta);
    }
    const chunkRefusal = choice?.delta?.refusal ?? choice?.message?.refusal;
    if (typeof chunkRefusal === 'string' && chunkRefusal.trim())
      refusal = chunkRefusal;
  };
  while (!done) {
    const result = await reader.read();
    if (result.done) {
      buffer += decoder.decode();
      break;
    }
    buffer += decoder.decode(result.value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) consumeLine(line);
  }
  if (buffer) consumeLine(buffer);
  return {
    content: content.trim(),
    payload: {
      id: streamId,
      model: streamModel,
      provider: streamProvider,
      choices: [
        {
          finish_reason: finishReason,
          native_finish_reason: nativeFinishReason,
          message: { content: content.trim(), refusal },
        },
      ],
      usage: streamUsage,
    },
  };
}
