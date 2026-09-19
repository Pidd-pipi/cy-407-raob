import type { Tour, TourDiffEntry, TourIssue, TourNode } from '@/types';

/** 相机与目标点重合判定阈值，小于该距离视为重合。 */
export const CAMERA_TARGET_EPSILON = 1e-6;

export interface TourValidationContext {
  exhibitionExists: boolean;
  artifactExists: (artifactId: string) => boolean;
  isArtifactInExhibition: (artifactId: string) => boolean;
  getArtifactName?: (artifactId: string) => string | undefined;
}

function isFiniteVector(node: TourNode): boolean {
  return [node.cameraPosition, node.targetPosition].every((vector) =>
    [vector.x, vector.y, vector.z].every((axis) => typeof axis === 'number' && Number.isFinite(axis))
  );
}

function distanceSquared(node: TourNode): number {
  const dx = node.cameraPosition.x - node.targetPosition.x;
  const dy = node.cameraPosition.y - node.targetPosition.y;
  const dz = node.cameraPosition.z - node.targetPosition.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * 发布前一次性校验整条草稿：
 * 节点必须仍属于当前展览、展品必须存在、相机与目标点不得重合。
 * 任一问题都应阻止整条路线发布，由调用方保证线上旧版本继续播放。
 */
export function validateTourDraft(
  draft: { name?: string; nodes: TourNode[] },
  context: TourValidationContext
): TourIssue[] {
  const issues: TourIssue[] = [];
  const nameOf = (id: string) => context.getArtifactName?.(id) ?? '未命名展品';

  if (!context.exhibitionExists) {
    issues.push({ code: 'exhibition_missing', message: '绑定的展览不存在，无法发布导览。' });
  }

  if (draft.nodes.length === 0) {
    issues.push({ code: 'no_nodes', message: '导览至少需要一个节点才能发布。' });
    return issues;
  }

  draft.nodes.forEach((node, index) => {
    const prefix = `第 ${index + 1} 个节点`;

    if (!isFiniteVector(node)) {
      issues.push({
        code: 'camera_target_coincident',
        nodeId: node.id,
        message: `${prefix}：相机位置或目标点坐标不完整。`
      });
    } else if (distanceSquared(node) < CAMERA_TARGET_EPSILON * CAMERA_TARGET_EPSILON) {
      issues.push({
        code: 'camera_target_coincident',
        nodeId: node.id,
        message: `${prefix}：相机位置与目标点重合，无法构成有效取景。`
      });
    }

    if (!node.artifactId || !context.artifactExists(node.artifactId)) {
      issues.push({
        code: 'artifact_missing',
        nodeId: node.id,
        message: `${prefix}：绑定的展品已从展品库删除，无法发布。`
      });
    } else if (!context.isArtifactInExhibition(node.artifactId)) {
      issues.push({
        code: 'artifact_not_in_exhibition',
        nodeId: node.id,
        message: `${prefix}：展品「${nameOf(node.artifactId)}」已退出当前展览，无法发布。`
      });
    }
  });

  return issues;
}

const NODE_FIELD_LABELS: Array<{ key: 'artifactId' | 'cameraPosition' | 'targetPosition' | 'transitionMs' | 'narration'; label: string }> = [
  { key: 'artifactId', label: '展品' },
  { key: 'cameraPosition', label: '相机位置' },
  { key: 'targetPosition', label: '目标点' },
  { key: 'transitionMs', label: '过渡时长' },
  { key: 'narration', label: '讲解文字' }
];

function changedFields(draftNode: TourNode, liveNode: TourNode): string[] {
  return NODE_FIELD_LABELS.filter(({ key }) => {
    if (key === 'cameraPosition' || key === 'targetPosition') {
      const draftVector = draftNode[key];
      const liveVector = liveNode[key];
      return (['x', 'y', 'z'] as const).some((axis) => draftVector[axis] !== liveVector[axis]);
    }
    return draftNode[key] !== liveNode[key];
  }).map(({ label }) => label);
}

/** 比较编辑草稿与线上快照，供编辑页展示差异。 */
export function diffTourDraft(tour: Tour): TourDiffEntry[] {
  const entries: TourDiffEntry[] = [];
  const published = tour.published;

  if (!published) {
    entries.push({ kind: 'added', label: '尚未发布过线上版本，发布后将首次上线。' });
    return entries;
  }

  if (tour.draftName.trim() !== published.name) {
    entries.push({
      kind: 'name',
      label: `导览名称`,
      detail: `线上「${published.name}」 → 草稿「${tour.draftName.trim()}」`
    });
  }

  const liveIndex = new Map(published.nodes.map((node, index) => [node.id, index]));
  const draftIndex = new Map(tour.draftNodes.map((node, index) => [node.id, index]));
  const liveById = new Map(published.nodes.map((node) => [node.id, node]));

  tour.draftNodes.forEach((node, index) => {
    if (!liveIndex.has(node.id)) {
      entries.push({ kind: 'added', nodeId: node.id, label: `新增第 ${index + 1} 个节点（展品 ${node.artifactId}）` });
      return;
    }
    const liveNode = liveById.get(node.id)!;
    if (liveIndex.get(node.id) !== index) {
      entries.push({
        kind: 'moved',
        nodeId: node.id,
        label: `节点顺序调整`,
        detail: `线上第 ${(liveIndex.get(node.id) ?? 0) + 1} 站 → 草稿第 ${index + 1} 站`
      });
    }
    const fields = changedFields(node, liveNode);
    if (fields.length > 0) {
      entries.push({ kind: 'modified', nodeId: node.id, label: `第 ${index + 1} 个节点已修改`, detail: fields.join('、') });
    }
  });

  published.nodes.forEach((node, index) => {
    if (!draftIndex.has(node.id)) {
      entries.push({ kind: 'removed', nodeId: node.id, label: `删除线上第 ${index + 1} 个节点（展品 ${node.artifactId}）` });
    }
  });

  return entries;
}

/** 草稿与线上快照是否存在任何差异（决定刷新后是否仍显示"有未发布修改"）。 */
export function isDraftDirty(tour: Tour): boolean {
  return diffTourDraft(tour).length > 0;
}

export function cloneNodes(nodes: TourNode[]): TourNode[] {
  return nodes.map((node) => ({
    ...node,
    cameraPosition: { ...node.cameraPosition },
    targetPosition: { ...node.targetPosition }
  }));
}
