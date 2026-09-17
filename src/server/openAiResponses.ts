export type OpenAiResponsePayload = {
  output_text?: unknown;
  output?: Array<{ content?: Array<{ type?: string; text?: unknown }> }>;
};

export function readOpenAiOutputText(payload: OpenAiResponsePayload): string {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
  return (payload.output || [])
    .flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text' && typeof item.text === 'string')
    .map(item => String(item.text))
    .join('\n')
    .trim();
}

