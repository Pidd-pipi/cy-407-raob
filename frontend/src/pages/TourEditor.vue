<template>
  <section v-if="tour" class="tour-page">
    <div class="page-head">
      <div>
        <h1>导览编辑</h1>
        <p>编辑中的节点与顺序只进入草稿；发布时一次性校验，异常则整条路线不发布，线上旧版本继续播放。</p>
      </div>
      <div class="tour-actions">
        <n-input v-model:value="tourName" placeholder="导览名称" @change="saveTourName" />
        <n-button type="primary" @click="saveTourName">保存名称</n-button>
        <n-button secondary @click="addNode">添加节点</n-button>
      </div>
    </div>

    <div class="tour-grid">
      <section class="panel-surface timeline-panel">
        <div class="tour-meta">
          <div>
            <strong>{{ exhibition?.title ?? '未绑定展览' }}</strong>
            <span>{{ tour.draftNodes.length }} 个草稿节点</span>
          </div>
          <n-tag v-if="tour.published" type="success" :bordered="false">
            线上 v{{ tour.published.version }} · {{ tour.published.nodes.length }} 站 ·
            {{ formatTime(tour.published.publishedAt) }}
          </n-tag>
          <n-tag v-else type="warning" :bordered="false">尚未发布</n-tag>
        </div>
        <n-alert v-if="!exhibition" type="error" :show-icon="false" title="绑定的展览不存在">
          草稿已保留，但无法发布；已发布版本仍可在展厅离线回放。
        </n-alert>
        <TourTimeline
          :nodes="tour.draftNodes"
          :artifacts="artifactStore.artifacts"
          :selected-node-id="selectedNodeId"
          :issues="issues"
          @select="selectedNodeId = $event"
          @reorder="tourStore.reorderNodes(tour.id, $event)"
          @remove="removeNode"
        />
      </section>

      <CameraSetter
        :node="selectedNode"
        :artifacts="artifactStore.artifacts"
        :in-exhibition-artifact-ids="exhibition?.artifactIds ?? []"
        :issues="issues"
        @update="updateNode"
      />
    </div>

    <TourPublishPanel :tour-id="tour.id" :published="tour.published" :diffs="diffs" :issues="issues" />
  </section>
  <n-result v-else status="404" title="导览不存在" description="请先在展览管理中保留至少一个展览和导览。" />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMessage } from 'naive-ui';
import CameraSetter from '@/components/editor/CameraSetter.vue';
import TourTimeline from '@/components/editor/TourTimeline.vue';
import TourPublishPanel from '@/components/editor/TourPublishPanel.vue';
import { useArtifactStore } from '@/stores/artifact';
import { useExhibitionStore } from '@/stores/exhibition';
import { useTourStore } from '@/stores/tour';
import type { TourNode } from '@/types';
import { diffTourDraft, validateTourDraft } from '@/utils/tour-publish';

const route = useRoute();
const router = useRouter();
const message = useMessage();
const artifactStore = useArtifactStore();
const exhibitionStore = useExhibitionStore();
const tourStore = useTourStore();

const selectedNodeId = ref('');
const tourName = ref('');

const tour = computed(() => {
  const id = String(route.params.id ?? '');
  return tourStore.getById(id) ?? tourStore.tours[0];
});

const exhibition = computed(() => (tour.value ? exhibitionStore.getById(tour.value.exhibitionId) : undefined));
const selectedNode = computed(() => tour.value?.draftNodes.find((node) => node.id === selectedNodeId.value));

const issues = computed(() => {
  if (!tour.value || !exhibition.value) return [];
  const exhibitionArtifactIds = new Set(exhibition.value.artifactIds);
  return validateTourDraft(
    { name: tour.value.draftName, nodes: tour.value.draftNodes },
    {
      exhibitionExists: Boolean(exhibition.value),
      artifactExists: (artifactId) => Boolean(artifactStore.getById(artifactId)),
      isArtifactInExhibition: (artifactId) => exhibitionArtifactIds.has(artifactId),
      getArtifactName: (artifactId) => artifactStore.getById(artifactId)?.name
    }
  );
});

const diffs = computed(() => (tour.value ? diffTourDraft(tour.value) : []));

watch(
  tour,
  (value) => {
    if (!value) return;
    tourName.value = value.draftName;
    selectedNodeId.value = value.draftNodes[0]?.id ?? '';
    if (route.params.id !== value.id) {
      void router.replace(`/manage/tours/${value.id}`);
    }
  },
  { immediate: true }
);

watch(
  () => tour.value?.draftNodes.map((node) => node.id).join('|'),
  () => {
    if (!tour.value) return;
    if (!tour.value.draftNodes.some((node) => node.id === selectedNodeId.value)) {
      selectedNodeId.value = tour.value.draftNodes[0]?.id ?? '';
    }
  }
);

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

async function saveTourName() {
  if (!tour.value || !tourName.value.trim() || tourName.value === tour.value.draftName) return;
  await tourStore.renameDraft(tour.value.id, tourName.value.trim());
  message.success('名称已保存到草稿');
}

async function addNode() {
  if (!tour.value) return;
  const defaultArtifactId =
    exhibition.value?.artifactIds.find((id) => artifactStore.getById(id)) ?? artifactStore.artifacts[0]?.id;
  if (!defaultArtifactId) return;
  await tourStore.addNode(tour.value.id, {
    artifactId: defaultArtifactId,
    cameraPosition: { x: 3.4, y: 2.2, z: 5 },
    targetPosition: { x: 0, y: 0, z: 0 },
    transitionMs: 2200,
    narration: '补充这一站的工艺讲解。'
  });
  const updated = tourStore.getById(tour.value.id);
  selectedNodeId.value = updated?.draftNodes[updated.draftNodes.length - 1]?.id ?? '';
  message.success('节点已加入草稿（未发布前不影响线上导览）');
}

async function updateNode(patch: Omit<TourNode, 'id'>) {
  if (!tour.value || !selectedNodeId.value) return;
  await tourStore.updateNode(tour.value.id, selectedNodeId.value, patch);
  message.success('节点修改已保存到草稿');
}

async function removeNode(nodeId: string) {
  if (!tour.value) return;
  await tourStore.removeNode(tour.value.id, nodeId);
  selectedNodeId.value = tour.value.draftNodes.find((node) => node.id !== nodeId)?.id ?? '';
  message.success('节点已从草稿删除（线上版本保留到下次发布）');
}
</script>

<style scoped>
.tour-page {
  display: grid;
  gap: 18px;
}

.tour-actions {
  display: grid;
  grid-template-columns: minmax(180px, 280px) auto auto;
  gap: 10px;
}

.tour-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(360px, 0.46fr);
  gap: 18px;
  align-items: start;
}

.timeline-panel {
  display: grid;
  gap: 16px;
  padding: 20px;
}

.tour-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.tour-meta strong {
  display: block;
  font-family: var(--font-display);
  font-size: 26px;
}

.tour-meta span {
  color: rgba(31, 46, 41, 0.62);
}

@media (max-width: 980px) {
  .tour-grid,
  .tour-actions {
    grid-template-columns: 1fr;
  }
}
</style>
