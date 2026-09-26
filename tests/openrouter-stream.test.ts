import { describe, expect, it } from 'vitest';

import {
  NeedMarkerBuffer,
  parseOpenRouterStream,
} from '../lib/openrouter-stream';

describe('OpenRouter stream parser', () => {
  it('accumulates content, ignores comments/reasoning, and preserves UTF-8 boundaries', async () => {
    const source = [
      ': OPENROUTER PROCESSING\n\n',
      'data: {"id":"gen-1","choices":[{"delta":{"reasoning":"thinking"}}]}\n\n',
      'data: {"id":"gen-1","provider":"test","choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"id":"gen-1","choices":[{"delta":{"content":"🌟"}}]}\n\n',
      'data: {"id":"gen-1","choices":[{"finish_reason":"stop","native_finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const bytes = new TextEncoder().encode(source);
    const chunks = [
      bytes.slice(0, 137),
      bytes.slice(137, 139),
      bytes.slice(139),
    ];
    const deltas: string[] = [];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    const result = await parseOpenRouterStream(stream, (delta) =>
      deltas.push(delta),
    );
    expect(result.content).toBe('Hello 🌟');
    expect(deltas.join('')).toBe('Hello 🌟');
    expect(result.payload.provider).toBe('test');
    expect(result.payload.choices?.[0]?.finish_reason).toBe('stop');
    expect(result.payload.usage?.completion_tokens).toBe(2);
  });

  it('suppresses a NEED marker split across deltas', () => {
    const visible: string[] = [];
    const buffer = new NeedMarkerBuffer((text) => visible.push(text));
    buffer.push('Before [NE');
    buffer.push('ED: workout 2026-09-14] after');
    buffer.flush();
    expect(visible.join('')).toBe('Before  after');
  });
});
