import type { Blueprint, PortClient } from "./client";

export interface RecordedUpsert {
  blueprint: string;
  identifier: string;
  title: string;
  properties: Record<string, unknown>;
  relations: Record<string, string>;
}

export interface FakePort extends PortClient {
  readonly upserts: RecordedUpsert[];
  readonly patches: Array<{
    blueprint: string;
    identifier: string;
    properties: Record<string, unknown>;
  }>;
  readonly invocations: Array<{ agentId: string; payload: unknown }>;
  readonly blueprints: Blueprint[];
  /** Set what the next invokeAgent returns; pass an Error to make it throw. */
  respondWith(value: unknown): void;
}

export const createFakePort = (): FakePort => {
  const upserts: RecordedUpsert[] = [];
  const patches: FakePort["patches"] = [];
  const invocations: FakePort["invocations"] = [];
  const blueprints: Blueprint[] = [];

  let next: unknown = {
    isGoodDeal: false,
    score: 0,
    reasoning: "default fake verdict",
    priceVsMedian: 0,
  };

  return {
    upserts,
    patches,
    invocations,
    blueprints,

    respondWith(value) {
      next = value;
    },

    async upsertEntity(blueprint, identifier, title, properties, relations) {
      upserts.push({
        blueprint,
        identifier,
        title,
        properties,
        relations: relations ?? {},
      });
    },

    async patchEntity(blueprint, identifier, properties) {
      patches.push({ blueprint, identifier, properties });
    },

    async invokeAgent(agentId, payload) {
      invocations.push({ agentId, payload });
      if (next instanceof Error) throw next;
      return next;
    },

    async upsertBlueprint(blueprint) {
      blueprints.push(blueprint);
    },
  };
};
