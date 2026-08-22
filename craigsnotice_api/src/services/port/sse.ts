/**
 * Port's POST /v1/agent/:id/invoke replies with text/event-stream, not JSON.
 * The answer arrives as a run of `event: execution` frames whose data lines
 * are chunks of the agent's reply, newlines escaped as \n because an SSE data
 * line cannot contain a raw newline.
 */
export interface SseFrame {
  event: string;
  data: string;
}

export const parseSseFrames = (body: string): SseFrame[] => {
  const frames: SseFrame[] = [];

  for (const block of body.split("\n\n")) {
    let event: string | null = null;
    const dataLines: string[] = [];

    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
    }

    if (event !== null) frames.push({ event, data: dataLines.join("\n") });
  }

  return frames;
};

const unescape = (s: string): string =>
  s.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"');

/** Concatenates every execution chunk into the agent's full reply. */
export const executionText = (body: string): string =>
  unescape(
    parseSseFrames(body)
      .filter((f) => f.event === "execution")
      .map((f) => f.data)
      .join("")
  );

export class AgentStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentStreamError";
  }
}

/**
 * Agents wrap JSON in a markdown fence often enough that stripping it is part
 * of the contract, not a workaround.
 */
export const extractJsonObject = (text: string): unknown => {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? trimmed).trim();

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new AgentStreamError(
      `agent reply contained no JSON object: ${trimmed.slice(0, 120)}`
    );
  }

  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (err) {
    throw new AgentStreamError(
      `agent reply was not valid JSON: ${(err as Error).message}`
    );
  }
};
