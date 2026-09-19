import { defineStore } from 'pinia';
import { tourRepository } from '@/api/storage';
import type { PublishedTourVersion, Tour, TourDraft, TourIssue, TourNode } from '@/types';
import { cloneNodes, validateTourDraft } from '@/utils/tour-publish';
import { createId } from '@/utils/storage';
import { useArtifactStore } from './artifact';
import { useExhibitionStore } from './exhibition';

/** 历史版本（草稿/线上未分离）迁移：旧线上内容同时作为草稿和已发布快照保留。 */
function normalizeTour(record: Record<string, unknown> & Partial<Tour>): Tour {
  if (Array.isArray(record.draftNodes)) {
    return record as Tour;
  }

  const now = new Date().toISOString();
  const legacyNodes = cloneNodes((record.nodes as TourNode[] | undefined) ?? []);
  return {
    id: record.id as string,
    exhibitionId: record.exhibitionId as string,
    draftName: (record.name as string | undefined) ?? '未命名导览',
    draftNodes: legacyNodes,
    published: {
      version: 1,
      name: (record.name as string | undefined) ?? '未命名导览',
      nodes: cloneNodes(legacyNodes),
      publishedAt: (record.updatedAt as string | undefined) ?? now
    },
    createdAt: (record.createdAt as string | undefined) ?? now,
    updatedAt: (record.updatedAt as string | undefined) ?? now
  };
}

function createSeedTour(exhibitionId: string, artifactIds: string[]): Tour {
  const now = new Date().toISOString();
  const nodes: TourNode[] = artifactIds.slice(0, 3).map((artifactId, index) => ({
    id: createId('tour-node'),
    artifactId,
    cameraPosition: { x: 4 - index * 1.5, y: 2.4, z: 5 - index },
    targetPosition: { x: 0, y: 0.2, z: 0 },
    transitionMs: 2600,
    narration: ['从器型观察手工成型痕迹。', '靠近纹样，比较线材与针法。', '改变角度查看材料反光。'][index] ?? ''
  }));

  return {
    id: 'tour-default-route',
    exhibitionId,
    draftName: '材料与手势导览',
    draftNodes: nodes,
    published: { version: 1, name: '材料与手势导览', nodes: cloneNodes(nodes), publishedAt: now },
    createdAt: now,
    updatedAt: now
  };
}

export interface PublishTourResult {
  ok: boolean;
  issues: TourIssue[];
  published?: PublishedTourVersion;
}

export const useTourStore = defineStore('tour', {
  state: () => ({
    tours: [] as Tour[],
    loaded: false
  }),
  getters: {
    getById: (state) => (id: string) => state.tours.find((tour) => tour.id === id),
    byExhibitionId: (state) => (exhibitionId: string) =>
      state.tours.filter((tour) => tour.exhibitionId === exhibitionId),
    /** 线上导览（已发布快照），自动导览只能读取它。 */
    publishedForExhibition:
      (state) =>
      (exhibitionId: string): PublishedTourVersion | undefined =>
        state.tours.find((tour) => tour.exhibitionId === exhibitionId)?.published
  },
  actions: {
    async load() {
      const records = await tourRepository.list();
      if (records.length === 0) {
        const exhibitionStore = useExhibitionStore();
        const artifactStore = useArtifactStore();
        const exhibition = exhibitionStore.exhibitions[0];
        if (exhibition) {
          const seed = createSeedTour(exhibition.id, artifactStore.artifacts.map((artifact) => artifact.id));
          await tourRepository.save(seed);
          this.tours = [seed];
        }
      } else {
        const migrated = records.map((record) => normalizeTour(record as Record<string, unknown> & Partial<Tour>));
        await tourRepository.saveMany(migrated);
        this.tours = migrated;
      }
      this.loaded = true;
    },
    async createTour(draft: TourDraft) {
      const now = new Date().toISOString();
      const tour: Tour = {
        ...draft,
        draftNodes: cloneNodes(draft.draftNodes),
        id: createId('tour'),
        published: undefined,
        createdAt: now,
        updatedAt: now
      };
      this.tours.unshift(tour);
      await tourRepository.save(tour);
      return tour;
    },
    async updateDraft(id: string, patch: Partial<Pick<Tour, 'draftName' | 'draftNodes'>>) {
      const current = this.getById(id);
      if (!current) return;
      const updated: Tour = { ...current, ...patch, updatedAt: new Date().toISOString() };
      this.tours = this.tours.map((tour) => (tour.id === id ? updated : tour));
      await tourRepository.save(updated);
    },
    async renameDraft(id: string, name: string) {
      await this.updateDraft(id, { draftName: name });
    },
    async deleteTour(id: string) {
      this.tours = this.tours.filter((tour) => tour.id !== id);
      await tourRepository.remove(id);
    },
    // —— 以下动作只改写草稿，线上快照保持不变 ——
    async addNode(tourId: string, node: Omit<TourNode, 'id'>) {
      const current = this.getById(tourId);
      if (!current) return;
      await this.updateDraft(tourId, {
        draftNodes: [...current.draftNodes, { ...node, id: createId('tour-node') }]
      });
    },
    async updateNode(tourId: string, nodeId: string, patch: Partial<Omit<TourNode, 'id'>>) {
      const current = this.getById(tourId);
      if (!current) return;
      await this.updateDraft(tourId, {
        draftNodes: current.draftNodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node))
      });
    },
    async reorderNodes(tourId: string, nodes: TourNode[]) {
      await this.updateDraft(tourId, { draftNodes: nodes });
    },
    async removeNode(tourId: string, nodeId: string) {
      const current = this.getById(tourId);
      if (!current) return;
      await this.updateDraft(tourId, { draftNodes: current.draftNodes.filter((node) => node.id !== nodeId) });
    },
    /**
     * 发布闭环：一次性校验整条草稿，任一异常则整体不发布、线上旧版本继续播放；
     * 校验通过才生成不可变快照并原子落库，播放中的旧版本不被后续编辑影响。
     */
    async publishTour(tourId: string): Promise<PublishTourResult> {
      const current = this.getById(tourId);
      if (!current) {
        return {
          ok: false,
          issues: [{ code: 'exhibition_missing', message: '导览不存在，无法发布。' }]
        };
      }

      const exhibitionStore = useExhibitionStore();
      const artifactStore = useArtifactStore();
      const exhibition = exhibitionStore.getById(current.exhibitionId);
      const exhibitionArtifactIds = new Set(exhibition?.artifactIds ?? []);

      const issues = validateTourDraft(
        { name: current.draftName, nodes: current.draftNodes },
        {
          exhibitionExists: Boolean(exhibition),
          artifactExists: (artifactId) => Boolean(artifactStore.getById(artifactId)),
          isArtifactInExhibition: (artifactId) => exhibitionArtifactIds.has(artifactId),
          getArtifactName: (artifactId) => artifactStore.getById(artifactId)?.name
        }
      );

      if (issues.length > 0) {
        return { ok: false, issues };
      }

      const published: PublishedTourVersion = {
        version: (current.published?.version ?? 0) + 1,
        name: current.draftName.trim(),
        nodes: cloneNodes(current.draftNodes),
        publishedAt: new Date().toISOString()
      };
      const updated: Tour = { ...current, published, updatedAt: new Date().toISOString() };
      this.tours = this.tours.map((tour) => (tour.id === tourId ? updated : tour));
      await tourRepository.save(updated);
      return { ok: true, issues: [], published };
    }
  }
});
