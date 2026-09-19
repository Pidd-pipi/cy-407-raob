import type { Artifact, Exhibition, PublishedTourNode, Tour, TourNode, TourVersion } from '@/types';

/** 相机位置与目标点被视为重合的最小距离（场景单位）。 */
export const CAMERA_TARGET_EPSILON = 0.001;

export interface PublishIssue {
  nodeId?: string;
  message: string;
}

export interface PublishResult {
  ok: boolean;
  issues: PublishIssue[];
  version?: TourVersion;
}

/**
 * 发布前整单校验：任一节点异常即拒绝整条路线，返回全部问题供页面展示。
 * - 展览仍存在且处于已发布状态；
 * - 至少存在一个节点；
 * - 节点绑定的展品仍属于当前展览且展品资料存在；
 * - 相机位置与目标点不重合。
 */
export function validateForPublish(
  draftNodes: TourNode[],
  exhibition: Exhibition | undefined,
  artifactLookup: (id: string) => Pick<Artifact, 'id' | 'name'> | undefined
): PublishIssue[] {
  const issues: PublishIssue[] = [];

  if (!exhibition) {
    issues.push({ message: '绑定的展览不存在，无法发布。' });
    return issues;
  }
  if (exhibition.status !== 'published') {
    issues.push({ message: '展览尚未发布，请先在展览管理中发布展览。' });
  }
  if (draftNodes.length === 0) {
    issues.push({ message: '路线为空，请至少添加一个导览节点。' });
  }

  const activeIds = new Set(exhibition.artifactIds);
  draftNodes.forEach((node, index) => {
    const label = `第 ${index + 1} 站`;
    const artifact = artifactLookup(node.artifactId);
    if (!node.artifactId || !artifact) {
      issues.push({ nodeId: node.id, message: `${label}：绑定的展品不存在。` });
    } else if (!activeIds.has(node.artifactId)) {
      issues.push({ nodeId: node.id, message: `${label}：展品「${artifact.name}」已退出当前展览。` });
    }

    const dx = node.cameraPosition.x - node.targetPosition.x;
    const dy = node.cameraPosition.y - node.targetPosition.y;
    const dz = node.cameraPosition.z - node.targetPosition.z;
    if (Math.hypot(dx, dy, dz) < CAMERA_TARGET_EPSILON) {
      issues.push({ nodeId: node.id, message: `${label}：相机位置与目标点重合，无法构成镜头。` });
    }
  });

  return issues;
}

/**
 * 由草稿构建不可变线上快照：深拷贝节点并冗余展品名称，
 * 快照与草稿从此互不影响，后续编辑、撤展都不会改动它。
 */
export function buildPublishedSnapshot(tour: Tour, artifactLookup: (id: string) => Artifact | undefined, previous: TourVersion | null): TourVersion {
  const nodes: PublishedTourNode[] = tour.draftNodes.map((node) => ({
    ...node,
    cameraPosition: { ...node.cameraPosition },
    targetPosition: { ...node.targetPosition },
    artifactName: artifactLookup(node.artifactId)?.name ?? '已撤展展品'
  }));

  return {
    version: (previous?.version ?? 0) + 1,
    name: tour.name,
    nodes,
    publishedAt: new Date().toISOString()
  };
}

export interface NodeDiff {
  nodeId: string;
  draftArtifactName: string;
  onlineArtifactName: string;
  draftTransitionMs: number;
  onlineTransitionMs: number;
  narrationChanged: boolean;
  cameraChanged: boolean;
  changed: boolean;
}

export type TourDiffKind = 'added' | 'removed' | 'reordered' | 'modified' | 'unchanged';

export interface TourDiffEntry {
  kind: TourDiffKind;
  /** 草稿中的序号（从 0 开始），仅删除项为空。 */
  draftIndex?: number;
  /** 线上版本中的序号（从 0 开始），仅新增项为空。 */
  onlineIndex?: number;
  draftNode?: TourNode;
  onlineNode?: PublishedTourNode;
}

export interface TourDiff {
  /** 是否存在任何未发布差异（名称、节点集合、顺序或字段变化）。 */
  hasChanges: boolean;
  nameChanged: boolean;
  entries: TourDiffEntry[];
  nodeDiffs: NodeDiff[];
  addedCount: number;
  removedCount: number;
  reordered: boolean;
}

function sameVector(a: TourNode['cameraPosition'], b: TourNode['cameraPosition']): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

/**
 * 对比草稿与当前线上版本，供编辑页展示差异。
 * 以节点 id 匹配：线上独有为已删除、草稿独有为新增；
 * 共有节点按线上顺序比较位置判断是否调序，再逐字段比较内容。
 */
export function diffTour(tour: Tour, artifactLookup: (id: string) => Artifact | undefined): TourDiff {
  const online = tour.published;
  const draft = tour.draftNodes;
  const onlineNodes = online?.nodes ?? [];

  const onlineById = new Map(onlineNodes.map((node) => [node.id, node]));
  const draftById = new Map(draft.map((node) => [node.id, node]));

  const entries: TourDiffEntry[] = [];
  let addedCount = 0;
  let removedCount = 0;
  let reordered = false;

  draft.forEach((node, draftIndex) => {
    const onlineNode = onlineById.get(node.id);
    if (!onlineNode) {
      addedCount += 1;
      entries.push({ kind: 'added', draftIndex, draftNode: node });
      return;
    }
    const onlineIndex = onlineNodes.indexOf(onlineNode);
    let kind: TourDiffKind = 'unchanged';
    if (onlineIndex !== draftIndex) {
      kind = 'reordered';
      reordered = true;
    }
    entries.push({ kind, draftIndex, onlineIndex, draftNode: node, onlineNode });
  });

  onlineNodes.forEach((node, onlineIndex) => {
    if (!draftById.has(node.id)) {
      removedCount += 1;
      entries.push({ kind: 'removed', onlineIndex, onlineNode: node });
    }
  });

  const nodeDiffs: NodeDiff[] = draft
    .map((node) => {
      const onlineNode = onlineById.get(node.id);
      if (!onlineNode) return null;
      const cameraChanged =
        !sameVector(node.cameraPosition, onlineNode.cameraPosition) || !sameVector(node.targetPosition, onlineNode.targetPosition);
      const narrationChanged = node.narration !== onlineNode.narration;
      const changed =
        node.artifactId !== onlineNode.artifactId ||
        cameraChanged ||
        narrationChanged ||
        node.transitionMs !== onlineNode.transitionMs;
      return {
        nodeId: node.id,
        draftArtifactName: artifactLookup(node.artifactId)?.name ?? '未选择展品',
        onlineArtifactName: onlineNode.artifactName,
        draftTransitionMs: node.transitionMs,
        onlineTransitionMs: onlineNode.transitionMs,
        narrationChanged,
        cameraChanged,
        changed
      };
    })
    .filter((item): item is NodeDiff => item !== null);

  const nameChanged = online ? tour.name !== online.name : draft.length > 0 || tour.name.trim().length > 0;
  const hasChanges =
    nameChanged || addedCount > 0 || removedCount > 0 || reordered || nodeDiffs.some((item) => item.changed);

  return { hasChanges, nameChanged, entries, nodeDiffs, addedCount, removedCount, reordered };
}
