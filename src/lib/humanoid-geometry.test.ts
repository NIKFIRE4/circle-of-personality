import { describe, expect, it } from "vitest";

import { createHumanoidGeometry } from "./humanoid-geometry";

function topologyOf(index: ArrayLike<number>) {
  const edgeUse = new Map<string, number>();
  const neighbors = new Map<number, Set<number>>();

  const addEdge = (from: number, to: number) => {
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    const key = `${low}:${high}`;

    edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);

    if (!neighbors.has(from)) neighbors.set(from, new Set());
    if (!neighbors.has(to)) neighbors.set(to, new Set());
    neighbors.get(from)?.add(to);
    neighbors.get(to)?.add(from);
  };

  for (let offset = 0; offset < index.length; offset += 3) {
    const a = index[offset];
    const b = index[offset + 1];
    const c = index[offset + 2];

    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }

  const firstVertex = neighbors.keys().next().value as number | undefined;
  const visited = new Set<number>();
  const pending = firstVertex === undefined ? [] : [firstVertex];

  while (pending.length > 0) {
    const vertex = pending.pop();
    if (vertex === undefined || visited.has(vertex)) continue;

    visited.add(vertex);
    for (const neighbor of neighbors.get(vertex) ?? []) {
      if (!visited.has(neighbor)) pending.push(neighbor);
    }
  }

  return {
    connectedVertices: visited.size,
    edgeUse,
    vertexCount: neighbors.size,
  };
}

describe("humanoid geometry", () => {
  it("keeps shoulders, pelvis and limbs in one closed surface", () => {
    const geometry = createHumanoidGeometry();
    const index = geometry.getIndex();

    expect(index).not.toBeNull();
    expect(index?.count).toBeGreaterThan(1_000);

    const topology = topologyOf(index?.array ?? []);

    expect(topology.vertexCount).toBeGreaterThan(500);
    expect(topology.connectedVertices).toBe(topology.vertexCount);
    expect([...topology.edgeUse.values()].every((uses) => uses === 2)).toBe(true);

    geometry.dispose();
  });

  it("retains an upright adult silhouette", () => {
    const geometry = createHumanoidGeometry();
    geometry.computeBoundingBox();

    const bounds = geometry.boundingBox;
    const width = bounds ? bounds.max.x - bounds.min.x : 0;
    const height = bounds ? bounds.max.y - bounds.min.y : 0;
    const depth = bounds ? bounds.max.z - bounds.min.z : 0;

    expect(height / width).toBeGreaterThan(1.7);
    expect(width / depth).toBeGreaterThan(2.5);

    geometry.dispose();
  });
});
