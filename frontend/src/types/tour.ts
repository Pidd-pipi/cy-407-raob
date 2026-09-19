import type { Vector3Tuple } from './annotation';

export interface TourNode {
  id: string;
  artifactId: string;
  cameraPosition: Vector3Tuple;
  targetPosition: Vector3Tuple;
  transitionMs: number;
  narration: string;
}

/**
 * 已发布快照中的节点。发布瞬间深拷贝自草稿，并冗余展品名称，
 * 使线上版本在展品退出展览甚至被删除后仍可离线回放。
 */
export interface PublishedTourNode extends TourNode {
  artifactName: string;
}

/** 导览的一次不可变线上发布版本。 */
export interface TourVersion {
  version: number;
  name: string;
  nodes: PublishedTourNode[];
  publishedAt: string;
}

export interface Tour {
  id: string;
  exhibitionId: string;
  name: string;
  /** 编辑中的节点与顺序，仅属于草稿，不影响线上播放。 */
  draftNodes: TourNode[];
  /** 当前线上版本；发布成功时整体替换，校验失败或从未发布时保持原样。 */
  published: TourVersion | null;
  createdAt: string;
  updatedAt: string;
  /** @deprecated 旧数据迁移前的线上节点，加载后立即归一化到 draftNodes/published。 */
  nodes?: TourNode[];
}

export type TourDraft = Pick<Tour, 'exhibitionId' | 'name' | 'draftNodes'>;
