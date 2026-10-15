// Explicit synthetic road links between the mapped Surabaya SITS nodes.
export const CITY3D_ROAD_TOPOLOGY = Object.freeze([
  Object.freeze(['node-jemursari', 'node-wonokromo']),
  Object.freeze(['node-wonokromo', 'node-darmo']),
  Object.freeze(['node-darmo', 'node-tunjungan']),
  Object.freeze(['node-tunjungan', 'node-kertajaya']),
  Object.freeze(['node-kertajaya', 'node-merr']),
  Object.freeze(['node-wonokromo', 'node-sungkono'])
]);

export function resolveCity3DRoadTopology(nodes, topology = CITY3D_ROAD_TOPOLOGY) {
  const byId = new Map(nodes.map((node) => [String(node.id), node]));
  const seen = new Set();
  const adjacency = new Map(nodes.map((node) => [String(node.id), new Set()]));
  const edges = topology.map(([fromId, toId]) => {
    const from = byId.get(String(fromId)), to = byId.get(String(toId));
    if (!from || !to || from === to) throw new Error(`Invalid City3D road link: ${fromId} → ${toId}`);
    const key = [String(fromId), String(toId)].sort().join('::');
    if (seen.has(key)) throw new Error(`Duplicate City3D road link: ${key}`);
    seen.add(key); adjacency.get(String(fromId)).add(String(toId)); adjacency.get(String(toId)).add(String(fromId));
    return { a: from, b: to, key };
  });
  if (nodes.length) {
    const visited = new Set();
    const pending = [String(nodes[0].id)];
    while (pending.length) {
      const id = pending.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      for (const adjacent of adjacency.get(id) || []) if (!visited.has(adjacent)) pending.push(adjacent);
    }
    if (visited.size !== nodes.length) throw new Error(`City3D road topology is disconnected: ${nodes.filter((node) => !visited.has(String(node.id))).map((node) => node.id).join(', ')}`);
  }
  return edges;
}
