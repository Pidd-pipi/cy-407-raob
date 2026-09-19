<template>
  <section class="tour-timeline">
    <header>
      <h3>导览时间轴</h3>
      <small>{{ nodes.length }} 个节点</small>
    </header>
    <div class="timeline-track">
      <button
        v-for="(node, index) in nodes"
        :key="node.id"
        type="button"
        class="timeline-node"
        :class="{ active: node.id === selectedNodeId, invalid: issueMessages(node.id).length > 0 }"
        @click="$emit('select', node.id)"
      >
        <span>{{ index + 1 }}</span>
        <div class="node-title">
          <strong>{{ artifactName(node.artifactId) }}</strong>
          <small v-for="message in issueMessages(node.id)" :key="message" class="node-issue">{{ message }}</small>
        </div>
        <small>{{ Math.round(node.transitionMs / 100) / 10 }}s</small>
        <div class="node-actions" @click.stop>
          <n-button size="tiny" quaternary :disabled="index === 0" @click="move(index, -1)">前移</n-button>
          <n-button size="tiny" quaternary :disabled="index === nodes.length - 1" @click="move(index, 1)">后移</n-button>
          <n-button size="tiny" quaternary type="error" @click="$emit('remove', node.id)">删除</n-button>
        </div>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Artifact, TourIssue, TourNode } from '@/types';

const props = defineProps<{
  nodes: TourNode[];
  artifacts: Artifact[];
  selectedNodeId?: string;
  issues?: TourIssue[];
}>();

const emit = defineEmits<{
  select: [nodeId: string];
  reorder: [nodes: TourNode[]];
  remove: [nodeId: string];
}>();

const issuesByNode = computed(() => {
  const map = new Map<string, string[]>();
  for (const issue of props.issues ?? []) {
    if (!issue.nodeId) continue;
    const list = map.get(issue.nodeId) ?? [];
    list.push(issue.message.replace(/^第 \d+ 个节点：?/, ''));
    map.set(issue.nodeId, list);
  }
  return map;
});

function issueMessages(nodeId: string): string[] {
  return issuesByNode.value.get(nodeId) ?? [];
}

function artifactName(id: string) {
  return props.artifacts.find((artifact) => artifact.id === id)?.name ?? '未选择展品';
}

function move(index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= props.nodes.length) return;
  const next = [...props.nodes];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  emit('reorder', next);
}
</script>

<style scoped>
.tour-timeline {
  display: grid;
  gap: 14px;
}

header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

h3,
small {
  margin: 0;
}

header small {
  color: rgba(31, 46, 41, 0.6);
}

.timeline-track {
  display: grid;
  gap: 10px;
}

.timeline-node {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto auto;
  gap: 12px;
  align-items: center;
  width: 100%;
  padding: 12px;
  color: var(--museum-ink);
  text-align: left;
  background: #fbf5e8;
  border: 1px solid rgba(23, 63, 53, 0.14);
  border-radius: 8px;
  cursor: pointer;
}

.timeline-node.active {
  border-color: var(--museum-brass);
  box-shadow: inset 4px 0 0 var(--museum-brass);
}

.timeline-node > span {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  color: #fbf5e8;
  background: var(--museum-green);
  border-radius: 50%;
  font-weight: 800;
}

.timeline-node strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-title {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.node-issue {
  color: #bb4d3e;
  font-size: 11px;
  line-height: 1.35;
}

.timeline-node.invalid {
  border-color: rgba(187, 77, 62, 0.55);
  background: rgba(187, 77, 62, 0.06);
}

.node-actions {
  display: flex;
  gap: 4px;
}

@media (max-width: 760px) {
  .timeline-node {
    grid-template-columns: 34px minmax(0, 1fr);
  }

  .node-actions {
    grid-column: 1 / -1;
  }
}
</style>
