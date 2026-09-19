<template>
  <section class="camera-setter">
    <header>
      <h3>相机与讲解</h3>
      <small v-if="node">节点 {{ node.id.slice(-6) }}</small>
    </header>
    <n-empty v-if="!node" description="选择时间轴节点后编辑相机位置" />
    <n-form v-else label-placement="top" :show-feedback="false" class="setter-form">
      <n-alert v-if="nodeIssues.length" type="error" :show-icon="false" class="node-alert">
        <div v-for="issue in nodeIssues" :key="issue.code + (issue.nodeId ?? '')">{{ issue.message }}</div>
      </n-alert>
      <n-form-item label="展品">
        <n-select v-model:value="draft.artifactId" :options="artifactOptions" />
      </n-form-item>
      <div class="vector-grid">
        <n-form-item label="相机 X">
          <n-input-number v-model:value="draft.cameraPosition.x" :step="0.1" />
        </n-form-item>
        <n-form-item label="相机 Y">
          <n-input-number v-model:value="draft.cameraPosition.y" :step="0.1" />
        </n-form-item>
        <n-form-item label="相机 Z">
          <n-input-number v-model:value="draft.cameraPosition.z" :step="0.1" />
        </n-form-item>
      </div>
      <div class="vector-grid">
        <n-form-item label="目标 X">
          <n-input-number v-model:value="draft.targetPosition.x" :step="0.1" />
        </n-form-item>
        <n-form-item label="目标 Y">
          <n-input-number v-model:value="draft.targetPosition.y" :step="0.1" />
        </n-form-item>
        <n-form-item label="目标 Z">
          <n-input-number v-model:value="draft.targetPosition.z" :step="0.1" />
        </n-form-item>
      </div>
      <n-form-item label="过渡时长（毫秒）">
        <n-input-number v-model:value="draft.transitionMs" :min="300" :step="100" />
      </n-form-item>
      <n-form-item label="讲解文字">
        <n-input v-model:value="draft.narration" type="textarea" :autosize="{ minRows: 4, maxRows: 7 }" />
      </n-form-item>
      <n-button type="primary" @click="save">保存节点</n-button>
    </n-form>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import type { Artifact, TourIssue, TourNode } from '@/types';

const props = defineProps<{
  node?: TourNode;
  artifacts: Artifact[];
  inExhibitionArtifactIds?: string[];
  issues?: TourIssue[];
}>();

const emit = defineEmits<{
  update: [patch: Omit<TourNode, 'id'>];
}>();

const draft = reactive<Omit<TourNode, 'id'>>({
  artifactId: '',
  cameraPosition: { x: 3, y: 2, z: 5 },
  targetPosition: { x: 0, y: 0, z: 0 },
  transitionMs: 2200,
  narration: ''
});

const nodeIssues = computed(() =>
  (props.issues ?? []).filter((issue) => issue.nodeId && issue.nodeId === props.node?.id)
);

const artifactOptions = computed(() => {
  const inExhibition = new Set(props.inExhibitionArtifactIds ?? props.artifacts.map((artifact) => artifact.id));
  const options = props.artifacts
    .filter((artifact) => inExhibition.has(artifact.id))
    .map((artifact) => ({ label: artifact.name, value: artifact.id }));
  // 草稿节点引用了已退出展览的展品：保留选项以便查看，但明确标注，发布仍会被拦截。
  const selected = props.artifacts.find((artifact) => artifact.id === draft.artifactId);
  if (selected && !inExhibition.has(selected.id)) {
    options.unshift({ label: `${selected.name}（已退出展览）`, value: selected.id });
  }
  return options;
});

watch(
  () => props.node,
  (node) => {
    if (!node) return;
    draft.artifactId = node.artifactId;
    draft.cameraPosition = { ...node.cameraPosition };
    draft.targetPosition = { ...node.targetPosition };
    draft.transitionMs = node.transitionMs;
    draft.narration = node.narration;
  },
  { immediate: true }
);

function save() {
  emit('update', {
    artifactId: draft.artifactId,
    cameraPosition: { ...draft.cameraPosition },
    targetPosition: { ...draft.targetPosition },
    transitionMs: draft.transitionMs,
    narration: draft.narration
  });
}
</script>

<style scoped>
.camera-setter {
  display: grid;
  gap: 14px;
  padding: 18px;
  background: #fbf5e8;
  border: 1px solid rgba(23, 63, 53, 0.14);
  border-radius: 8px;
}

header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

h3,
small {
  margin: 0;
}

small {
  color: rgba(31, 46, 41, 0.58);
}

.setter-form {
  display: grid;
  gap: 10px;
}

.node-alert {
  line-height: 1.5;
}

.vector-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

@media (max-width: 680px) {
  .vector-grid {
    grid-template-columns: 1fr;
  }
}
</style>
