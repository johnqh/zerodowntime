import {
  trace,
  context,
  SpanStatusCode,
  type AttributeValue,
  type Span,
} from "@opentelemetry/api";

export const tracer = trace.getTracer("craigsnotice-api");

/**
 * Records the exception and marks the span errored before rethrowing, so a
 * failure is diagnosable in SigNoz rather than a silent gap in the trace.
 */
export const withSpan = async <T>(
  name: string,
  attrs: Record<string, AttributeValue>,
  fn: (span: Span) => Promise<T>
): Promise<T> => {
  const span = tracer.startSpan(name, { attributes: attrs });
  try {
    return await context.with(trace.setSpan(context.active(), span), () =>
      fn(span)
    );
  } catch (err) {
    span.recordException(err as Error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: (err as Error).message,
    });
    throw err;
  } finally {
    span.end();
  }
};
