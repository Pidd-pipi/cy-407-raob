import type { Vector3Tuple } from './annotation';

export interface TourNode {
  id: string;
  artifactId: string;
  cameraPosition: Vector3Tuple;
  targetPosition: Vector3Tuple;
  transitionMs: number;
  narration: string;
}

/** 已发布导览的不可变快照，发布后不再受展品/草稿变化影响。 */
export interface PublishedTourVersion {
  version: number;
  name: string;
  nodes: TourNode[];
  publishedAt: string;
}

/**
 * 导览实体：
 * - draftName / draftNodes 为编辑中的草稿，修改即时保存，但不影响线上。
 * - published 为线上快照，仅在发布成功时整体替换；为空表示从未发布。
 */
export interface Tour {
  id: string;
  exhibitionId: string;
  draftName: string;
  draftNodes: TourNode[];
  published?: PublishedTourVersion;
  createdAt: string;
  updatedAt: string;
}

export type TourDraft = Pick<Tour, 'exhibitionId' | 'draftName' | 'draftNodes'>;

/** 发布校验问题码。 */
export type TourIssueCode =
  | 'exhibition_missing'
  | 'no_nodes'
  | 'artifact_not_in_exhibition'
  | 'artifact_missing'
  | 'camera_target_coincident';

export interface TourIssue {
  code: TourIssueCode;
  nodeId?: string;
  message: string;
}

/** 草稿与线上快照的差异项。 */
export type TourDiffKind = 'added' | 'removed' | 'moved' | 'modified' | 'name';

export interface TourDiffEntry {
  kind: TourDiffKind;
  nodeId?: string;
  label: string;
  detail?: string;
}
