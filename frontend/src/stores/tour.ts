import { defineStore } from 'pinia';
import { toRaw } from 'vue';
import { tourRepository } from '@/api/storage';
import { ExhibitionStatus } from '@/types';
import type { Tour, TourDraft, TourNode, TourVersion } from '@/types';
import { createId } from '@/utils/storage';
import { buildPublishedSnapshot, validateForPublish, type PublishResult } from '@/utils/tour-publish';
import { useArtifactStore } from './artifact';
import { useExhibitionStore } from './exhibition';

/** 由节点直接构造首个线上快照（用于种子数据与旧数据迁移，不经发布校验）。 */
function snapshotFromNodes(
  name: string,
  nodes: TourNode[],
  artifactLookup: (id: string) => { name: string } | undefined,
  publishedAt: string
): TourVersion {
  return {
    version: 1,
    name,
    publishedAt,
    nodes: nodes.map((node) => ({
      ...node,
      cameraPosition: { ...node.cameraPosition },
      targetPosition: { ...node.targetPosition },
      artifactName: artifactLookup(node.artifactId)?.name ?? '已撤展展品'
    }))
  };
}

function createSeedTour(exhibitionId: string, artifacts: { id: string; name: string }[]): Tour {
  const now = new Date().toISOString();
  const draftNodes: TourNode[] = artifacts.slice(0, 3).map((artifact, index) => ({
    id: createId('tour-node'),
    artifactId: artifact.id,
    cameraPosition: { x: 4 - index * 1.5, y: 2.4, z: 5 - index },
    targetPosition: { x: 0, y: 0.2, z: 0 },
    transitionMs: 2600,
    narration: ['从器型观察手工成型痕迹。', '靠近纹样，比较线材与针法。', '改变角度查看材料反光。'][index] ?? ''
  }));

  const lookup = (id: string) => artifacts.find((artifact) => artifact.id === id);

  return {
    id: 'tour-default-route',
    exhibitionId,
    name: '材料与手势导览',
    draftNodes,
    published: snapshotFromNodes('材料与手势导览', draftNodes, lookup, now),
    createdAt: now,
    updatedAt: now
  };
}

/**
 * 兼容旧版单节点数据：旧记录只有 nodes，归一化为草稿并生成等价线上快照。
 * 旧节点通过当前校验则旧版本继续在线（撤展后仍可离线回放）；
 * 校验不通过则只保留草稿，等待修复后重新发布。
 */
function normalizeTour(record: Tour, artifactLookup: (id: string) => { id: string; name: string } | undefined): Tour {
  if (Array.isArray(record.draftNodes)) {
    const { nodes: _legacy, ...rest } = record;
    return { ...rest, nodes: undefined };
  }

  const legacyNodes = Array.isArray(record.nodes) ? record.nodes : [];
  const draftNodes = legacyNodes.map((node) => ({
    ...node,
    cameraPosition: { ...node.cameraPosition },
    targetPosition: { ...node.targetPosition }
  }));
  const { nodes: _legacy, ...rest } = record;
  const exhibitionStore = useExhibitionStore();
  const issues = validateForPublish(draftNodes, exhibitionStore.getById(record.exhibitionId), artifactLookup);

  return {
    ...rest,
    draftNodes,
    nodes: undefined,
    published:
      issues.length === 0 && draftNodes.length > 0
        ? snapshotFromNodes(record.name, draftNodes, artifactLookup, record.updatedAt)
        : record.published ?? null
  };
}

/**
 * 持久化前解除 Pinia/Vue 响应式代理并深拷贝，
 * 避免结构化克隆（structured clone）写入 reactive 代理时抛 DataCloneError。
 * 导览记录仅含字符串、数字与普通对象，JSON 往返即等价的深拷贝。
 */
function detachTour(tour: Tour): Tour {
  return JSON.parse(JSON.stringify(toRaw(tour))) as Tour;
}

export const useTourStore = defineStore('tour', {
  state: () => ({
    tours: [] as Tour[],
    loaded: false
  }),
  getters: {
    getById: (state) => (id: string) => state.tours.find((tour) => tour.id === id),
    byExhibitionId: (state) => (exhibitionId: string) => state.tours.filter((tour) => tour.exhibitionId === exhibitionId)
  },
  actions: {
    async load() {
      const records = await tourRepository.list();
      const artifactStore = useArtifactStore();
      const artifactLookup = (id: string) => artifactStore.getById(id);
      if (records.length === 0) {
        const exhibitionStore = useExhibitionStore();
        const exhibition = exhibitionStore.exhibitions[0];
        if (exhibition) {
          const seed = createSeedTour(exhibition.id, artifactStore.artifacts);
          await tourRepository.save(seed);
          this.tours = [seed];
        }
      } else {
        const normalized = records.map((record) => normalizeTour(record, artifactLookup));
        const changed = normalized.some((tour, index) => tour !== records[index]);
        this.tours = normalized;
        if (changed) {
          await tourRepository.saveMany(normalized);
        }
      }
      this.loaded = true;
    },
    async createTour(draft: TourDraft) {
      const now = new Date().toISOString();
      const tour: Tour = {
        ...draft,
        draftNodes: draft.draftNodes.map((node) => ({ ...node })),
        published: null,
        id: createId('tour'),
        createdAt: now,
        updatedAt: now
      };
      this.tours.unshift(tour);
      await tourRepository.save(detachTour(tour));
      return tour;
    },
    /** 仅更新草稿相关字段，线上快照永不被编辑动作改写。 */
    async updateTour(id: string, patch: Partial<TourDraft>) {
      const current = this.getById(id);
      if (!current) return;
      const updated: Tour = { ...current, ...patch, updatedAt: new Date().toISOString() };
      this.tours = this.tours.map((tour) => (tour.id === id ? updated : tour));
      await tourRepository.save(detachTour(updated));
    },
    async deleteTour(id: string) {
      this.tours = this.tours.filter((tour) => tour.id !== id);
      await tourRepository.remove(id);
    },
    async addNode(tourId: string, node: Omit<TourNode, 'id'>) {
      const current = this.getById(tourId);
      if (!current) return;
      await this.updateTour(tourId, {
        draftNodes: [...current.draftNodes, { ...node, id: createId('tour-node') }]
      });
    },
    async updateNode(tourId: string, nodeId: string, patch: Partial<Omit<TourNode, 'id'>>) {
      const current = this.getById(tourId);
      if (!current) return;
      await this.updateTour(tourId, {
        draftNodes: current.draftNodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node))
      });
    },
    async reorderNodes(tourId: string, nodes: TourNode[]) {
      await this.updateTour(tourId, { draftNodes: nodes });
    },
    async removeNode(tourId: string, nodeId: string) {
      const current = this.getById(tourId);
      if (!current) return;
      await this.updateTour(tourId, { draftNodes: current.draftNodes.filter((node) => node.id !== nodeId) });
    },
    /** 放弃未发布修改，用线上快照重置草稿；无线上版本时不处理。 */
    async discardDraft(tourId: string) {
      const current = this.getById(tourId);
      if (!current?.published) return;
      const draftNodes: TourNode[] = current.published.nodes.map(({ artifactName: _artifactName, ...node }) => ({
        ...node,
        cameraPosition: { ...node.cameraPosition },
        targetPosition: { ...node.targetPosition }
      }));
      await this.updateTour(tourId, { name: current.published.name, draftNodes });
    },
    /**
     * 发布导览：对当前草稿做整单校验，任一异常则整条路线不发布，
     * 已发布的线上旧版本原样保留并继续播放。校验通过才原子替换快照。
     */
    async publishTour(tourId: string): Promise<PublishResult> {
      const current = this.getById(tourId);
      if (!current) {
        return { ok: false, issues: [{ message: '导览不存在，无法发布。' }] };
      }

      const exhibitionStore = useExhibitionStore();
      const artifactStore = useArtifactStore();
      const exhibition = exhibitionStore.getById(current.exhibitionId);
      const issues = validateForPublish(current.draftNodes, exhibition, (id) => artifactStore.getById(id));

      if (issues.length > 0) {
        return { ok: false, issues };
      }

      const published = buildPublishedSnapshot(current, (id) => artifactStore.getById(id), current.published);
      const updated: Tour = { ...current, published, updatedAt: new Date().toISOString() };
      this.tours = this.tours.map((tour) => (tour.id === tourId ? updated : tour));
      await tourRepository.save(detachTour(updated));
      return { ok: true, issues: [], version: published };
    },
    /** 导览是否可发布：展品退出展览后草稿保留但不可发布。 */
    canPublish(tour: Tour): boolean {
      const exhibitionStore = useExhibitionStore();
      const artifactStore = useArtifactStore();
      const exhibition = exhibitionStore.getById(tour.exhibitionId);
      if (!exhibition || exhibition.status !== ExhibitionStatus.Published) return false;
      const activeIds = new Set(exhibition.artifactIds);
      return (
        tour.draftNodes.length > 0 &&
        tour.draftNodes.every((node) => {
          const artifact = artifactStore.getById(node.artifactId);
          if (!artifact || !activeIds.has(node.artifactId)) return false;
          const dx = node.cameraPosition.x - node.targetPosition.x;
          const dy = node.cameraPosition.y - node.targetPosition.y;
          const dz = node.cameraPosition.z - node.targetPosition.z;
          return Math.hypot(dx, dy, dz) > 0.001;
        })
      );
    }
  }
});
