<template>
  <section v-if="tour" class="tour-page">
    <div class="page-head">
      <div>
        <h1>导览编辑</h1>
        <p>节点与顺序仅保存在草稿中；发布时整单校验，通过后生成线上快照，展厅自动导览随即切换。</p>
      </div>
      <div class="tour-actions">
        <n-input v-model:value="tourName" placeholder="导览名称" />
        <n-button type="primary" @click="saveTourName">保存名称</n-button>
        <n-button secondary @click="addNode">添加节点</n-button>
      </div>
    </div>

    <section class="panel-surface publish-panel">
      <header class="publish-head">
        <div class="version-state">
          <n-tag :type="tour.published ? 'success' : 'default'" size="large" :bordered="false">
            {{ tour.published ? `线上 v${tour.published.version}` : '线上无版本' }}
          </n-tag>
          <div v-if="tour.published" class="version-meta">
            <span>{{ tour.published.nodes.length }} 站 · 发布于 {{ formatTime(tour.published.publishedAt) }}</span>
            <small>已发布快照与草稿隔离，继续编辑不影响展厅播放。</small>
          </div>
          <div v-else class="version-meta">
            <small>尚未发布过，展厅自动导览在首次发布成功后可用。</small>
          </div>
        </div>
        <div class="publish-actions">
          <n-button v-if="tour.published" :disabled="!diff.hasChanges" @click="confirmDiscard">
            放弃草稿改动
          </n-button>
          <n-button type="primary" :loading="publishing" @click="publish">发布路线</n-button>
        </div>
      </header>

      <n-alert v-if="publishIssues.length > 0" type="error" title="发布未通过，线上旧版本继续播放" class="publish-alert">
        <ul class="issue-list">
          <li v-for="(issue, index) in publishIssues" :key="index">
            <button v-if="issue.nodeId" type="button" class="issue-link" @click="selectedNodeId = issue.nodeId">
              {{ issue.message }}
            </button>
            <span v-else>{{ issue.message }}</span>
          </li>
        </ul>
      </n-alert>

      <div class="diff-strip">
        <template v-if="!tour.published">
          <n-tag :type="diff.hasChanges ? 'warning' : 'default'" :bordered="false">
            {{ tour.draftNodes.length }} 个草稿节点待首次发布
          </n-tag>
        </template>
        <template v-else-if="diff.hasChanges">
          <n-tag v-if="diff.nameChanged" type="warning" :bordered="false">名称已修改</n-tag>
          <n-tag v-if="diff.addedCount > 0" type="success" :bordered="false">新增 {{ diff.addedCount }} 站</n-tag>
          <n-tag v-if="diff.removedCount > 0" type="error" :bordered="false">删除 {{ diff.removedCount }} 站</n-tag>
          <n-tag v-if="diff.reordered" type="warning" :bordered="false">顺序已调整</n-tag>
          <n-tag v-if="modifiedNodes.length > 0" type="warning" :bordered="false">
            {{ modifiedNodes.length }} 站内容已修改
          </n-tag>
        </template>
        <n-tag v-else type="success" :bordered="false">草稿与线上一致</n-tag>
        <n-tag v-if="inactiveNodeIds.length > 0" type="warning" :bordered="false">
          {{ inactiveNodeIds.length }} 站展品已退出展览，草稿保留但不可发布
        </n-tag>
        <n-tag v-if="tour.published" :bordered="false">线上版本可随时离线回放</n-tag>
      </div>

      <ul v-if="modifiedNodes.length > 0" class="modified-list">
        <li v-for="item in modifiedNodes" :key="item.nodeId">
          <strong>{{ item.draftArtifactName }}</strong>
          <span v-if="item.draftArtifactName !== item.onlineArtifactName">展品：{{ item.onlineArtifactName }} → {{ item.draftArtifactName }}</span>
          <span v-if="item.cameraChanged">相机/目标已改</span>
          <span v-if="item.draftTransitionMs !== item.onlineTransitionMs">
            时长：{{ item.onlineTransitionMs }}ms → {{ item.draftTransitionMs }}ms
          </span>
          <span v-if="item.narrationChanged">讲解文字已改</span>
        </li>
      </ul>
    </section>

    <div class="tour-grid">
      <section class="panel-surface timeline-panel">
        <div class="tour-meta">
          <strong>{{ exhibition?.title ?? '未绑定展览' }}</strong>
          <span>{{ tour.draftNodes.length }} 个草稿节点</span>
        </div>
        <TourTimeline
          :nodes="tour.draftNodes"
          :artifacts="artifactStore.artifacts"
          :selected-node-id="selectedNodeId"
          :inactive-artifact-ids="inactiveArtifactIds"
          :issue-node-ids="issueNodeIds"
          @select="selectedNodeId = $event"
          @reorder="tourStore.reorderNodes(tour.id, $event)"
          @remove="removeNode"
        />
      </section>

      <CameraSetter :node="selectedNode" :artifacts="artifactStore.artifacts" @update="updateNode" />
    </div>
  </section>
  <n-result v-else status="404" title="导览不存在" description="请先在展览管理中保留至少一个展览和导览。" />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMessage, useDialog } from 'naive-ui';
import CameraSetter from '@/components/editor/CameraSetter.vue';
import TourTimeline from '@/components/editor/TourTimeline.vue';
import { useArtifactStore } from '@/stores/artifact';
import { useExhibitionStore } from '@/stores/exhibition';
import { useTourStore } from '@/stores/tour';
import type { TourNode } from '@/types';
import { diffTour, type PublishIssue } from '@/utils/tour-publish';

const route = useRoute();
const router = useRouter();
const message = useMessage();
const dialog = useDialog();
const artifactStore = useArtifactStore();
const exhibitionStore = useExhibitionStore();
const tourStore = useTourStore();

const selectedNodeId = ref('');
const tourName = ref('');
const publishIssues = ref<PublishIssue[]>([]);
const publishing = ref(false);

const tour = computed(() => {
  const id = String(route.params.id ?? '');
  return tourStore.getById(id) ?? tourStore.tours[0];
});

const exhibition = computed(() => (tour.value ? exhibitionStore.getById(tour.value.exhibitionId) : undefined));
const selectedNode = computed(() => tour.value?.draftNodes.find((node) => node.id === selectedNodeId.value));

const diff = computed(() =>
  tour.value ? diffTour(tour.value, (id) => artifactStore.getById(id)) : {
    hasChanges: false,
    nameChanged: false,
    entries: [],
    nodeDiffs: [],
    addedCount: 0,
    removedCount: 0,
    reordered: false
  }
);

const modifiedNodes = computed(() => diff.value.nodeDiffs.filter((item) => item.changed));

/** 展品已退出当前展览（或已被删除）的草稿节点。 */
const inactiveNodeIds = computed(() => {
  if (!tour.value || !exhibition.value) return [] as string[];
  const activeIds = new Set(exhibition.value.artifactIds);
  return tour.value.draftNodes
    .filter((node) => !artifactStore.getById(node.artifactId) || !activeIds.has(node.artifactId))
    .map((node) => node.id);
});

const inactiveArtifactIds = computed(() => {
  if (!tour.value || !exhibition.value) return [] as string[];
  const activeIds = new Set(exhibition.value.artifactIds);
  return [
    ...new Set(
      tour.value.draftNodes
        .filter((node) => !artifactStore.getById(node.artifactId) || !activeIds.has(node.artifactId))
        .map((node) => node.artifactId)
    )
  ];
});

const issueNodeIds = computed(() => publishIssues.value.map((issue) => issue.nodeId).filter((id): id is string => Boolean(id)));

// 只在切换导览时重置编辑状态，节点保存产生的新对象不应打断当前选择。
watch(
  () => tour.value?.id,
  (id) => {
    if (!id || !tour.value) return;
    tourName.value = tour.value.name;
    selectedNodeId.value = tour.value.draftNodes[0]?.id ?? '';
    publishIssues.value = [];
    if (route.params.id !== id) {
      void router.replace(`/manage/tours/${id}`);
    }
  },
  { immediate: true }
);

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

async function saveTourName() {
  if (!tour.value || !tourName.value.trim()) return;
  await tourStore.updateTour(tour.value.id, { name: tourName.value.trim() });
  message.success('名称已保存到草稿');
}

async function addNode() {
  if (!tour.value || !artifactStore.artifacts[0]) return;
  await tourStore.addNode(tour.value.id, {
    artifactId: artifactStore.artifacts[0].id,
    cameraPosition: { x: 3.4, y: 2.2, z: 5 },
    targetPosition: { x: 0, y: 0, z: 0 },
    transitionMs: 2200,
    narration: '补充这一站的工艺讲解。'
  });
  const updated = tourStore.getById(tour.value.id);
  selectedNodeId.value = updated?.draftNodes[updated.draftNodes.length - 1]?.id ?? '';
  publishIssues.value = [];
  message.success('节点已加入草稿');
}

async function updateNode(patch: Omit<TourNode, 'id'>) {
  if (!tour.value || !selectedNodeId.value) return;
  await tourStore.updateNode(tour.value.id, selectedNodeId.value, patch);
  publishIssues.value = publishIssues.value.filter((issue) => issue.nodeId !== selectedNodeId.value);
  message.success('节点已保存到草稿');
}

async function removeNode(nodeId: string) {
  if (!tour.value) return;
  await tourStore.removeNode(tour.value.id, nodeId);
  if (selectedNodeId.value === nodeId) {
    selectedNodeId.value = tour.value.draftNodes.find((node) => node.id !== nodeId)?.id ?? '';
  }
  publishIssues.value = publishIssues.value.filter((issue) => issue.nodeId !== nodeId);
  message.success('节点已从草稿删除');
}

async function publish() {
  if (!tour.value) return;
  publishing.value = true;
  try {
    const result = await tourStore.publishTour(tour.value.id);
    if (result.ok && result.version) {
      publishIssues.value = [];
      message.success(`已发布 v${result.version.version}，展厅自动导览已切换到新快照`);
    } else {
      publishIssues.value = result.issues;
      message.error('校验未通过，整条路线未发布，线上旧版本继续播放');
    }
  } finally {
    publishing.value = false;
  }
}

function confirmDiscard() {
  if (!tour.value?.published) return;
  dialog.warning({
    title: '放弃未发布的草稿改动？',
    content: `将用线上 v${tour.value.published.version} 的快照覆盖当前草稿，该操作不可撤销。`,
    positiveText: '放弃改动',
    negativeText: '取消',
    onPositiveClick: async () => {
      if (!tour.value) return;
      await tourStore.discardDraft(tour.value.id);
      tourName.value = tour.value.name;
      publishIssues.value = [];
      message.success('草稿已恢复为线上版本');
    }
  });
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

.publish-panel {
  display: grid;
  gap: 14px;
  padding: 18px 20px;
}

.publish-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.version-state {
  display: flex;
  align-items: center;
  gap: 14px;
}

.version-meta {
  display: grid;
  gap: 2px;
  color: rgba(31, 46, 41, 0.68);
  font-size: 13px;
}

.version-meta small {
  color: rgba(31, 46, 41, 0.52);
}

.publish-actions {
  display: flex;
  gap: 10px;
}

.publish-alert :deep(ul) {
  margin: 0;
  padding-left: 18px;
}

.issue-list {
  margin: 0;
  padding-left: 18px;
}

.issue-link {
  padding: 0;
  color: inherit;
  text-decoration: underline;
  background: none;
  border: 0;
  cursor: pointer;
}

.diff-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.modified-list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 12px 14px;
  list-style: none;
  background: rgba(157, 123, 54, 0.08);
  border-radius: 6px;
}

.modified-list li {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: baseline;
  font-size: 13px;
}

.modified-list strong {
  color: var(--museum-green);
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
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.tour-meta strong {
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
