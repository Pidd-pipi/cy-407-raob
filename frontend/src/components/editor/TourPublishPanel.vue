<template>
  <section class="panel-surface publish-panel">
    <header>
      <div>
        <h3>发布闭环</h3>
        <small>编辑只进入草稿；校验通过后整体发布，线上旧版本在此之前继续播放。</small>
      </div>
      <n-tag v-if="published" type="success" :bordered="false" size="small">
        线上 v{{ published.version }}
      </n-tag>
      <n-tag v-else type="warning" :bordered="false" size="small">从未发布</n-tag>
    </header>

    <dl v-if="published" class="version-meta">
      <div>
        <dt>线上名称</dt>
        <dd>{{ published.name }}</dd>
      </div>
      <div>
        <dt>线上节点</dt>
        <dd>{{ published.nodes.length }} 站</dd>
      </div>
      <div>
        <dt>发布时间</dt>
        <dd>{{ formatTime(published.publishedAt) }}</dd>
      </div>
    </dl>

    <div class="block">
      <strong>草稿与线上差异</strong>
      <n-empty v-if="diffs.length === 0" description="草稿与线上版本一致，没有未发布修改。" size="small" />
      <ul v-else class="diff-list">
        <li v-for="(entry, index) in diffs" :key="`${entry.kind}-${entry.nodeId ?? index}`" :class="entry.kind">
          <n-tag size="tiny" :bordered="false" :type="diffTagType(entry.kind)">{{ diffLabel(entry.kind) }}</n-tag>
          <span class="diff-text">{{ entry.label }}<small v-if="entry.detail">：{{ entry.detail }}</small></span>
        </li>
      </ul>
    </div>

    <div class="block">
      <strong>发布校验</strong>
      <n-empty v-if="issues.length === 0" description="草稿校验通过，可以发布。" size="small" />
      <ul v-else class="issue-list">
        <li v-for="(issue, index) in issues" :key="issue.nodeId ?? issue.code + index">
          <n-icon size="14" color="#bb4d3e"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.2v4.2M8 11v.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></n-icon>
          <span>{{ issue.message }}</span>
        </li>
      </ul>
    </div>

    <n-button type="primary" block :disabled="issues.length > 0" :loading="publishing" @click="publish">
      {{ published ? `发布新版本（当前线上 v${published.version}）` : '首次发布导览' }}
    </n-button>
    <p v-if="issues.length > 0" class="block-tip">存在 {{ issues.length }} 项异常，整条路线不会发布，线上旧版本继续播放。</p>
    <p v-else class="block-tip">发布成功后自动导览立即改用新快照；正在播放的版本不受后续编辑影响。</p>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useMessage } from 'naive-ui';
import type { TourDiffEntry, TourDiffKind, TourIssue, PublishedTourVersion } from '@/types';
import { useTourStore } from '@/stores/tour';

const props = defineProps<{
  tourId: string;
  published?: PublishedTourVersion;
  diffs: TourDiffEntry[];
  issues: TourIssue[];
}>();

const tourStore = useTourStore();
const message = useMessage();
const publishing = ref(false);

const diffLabels: Record<TourDiffKind, string> = {
  added: '新增',
  removed: '删除',
  moved: '调序',
  modified: '修改',
  name: '改名'
};

const diffTagType = (kind: TourDiffKind) =>
  kind === 'added' ? 'success' : kind === 'removed' ? 'error' : kind === 'name' ? 'info' : 'warning';
const diffLabel = (kind: TourDiffKind) => diffLabels[kind];

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

async function publish() {
  publishing.value = true;
  try {
    const result = await tourStore.publishTour(props.tourId);
    if (result.ok) {
      message.success(`发布成功，自动导览已切换到 v${result.published?.version} 快照`);
    } else {
      message.error(`发布失败：共 ${result.issues.length} 项异常，线上旧版本继续播放`);
    }
  } finally {
    publishing.value = false;
  }
}
</script>

<style scoped>
.publish-panel {
  display: grid;
  gap: 14px;
  padding: 18px;
}

.publish-panel header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.publish-panel h3,
.publish-panel small {
  margin: 0;
}

.publish-panel small {
  display: block;
  margin-top: 4px;
  color: rgba(31, 46, 41, 0.58);
  line-height: 1.5;
}

.version-meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.version-meta div {
  padding: 10px;
  background: rgba(250, 246, 236, 0.74);
  border: 1px solid rgba(23, 63, 53, 0.12);
  border-radius: 6px;
}

.version-meta dt {
  color: rgba(31, 46, 41, 0.58);
  font-size: 12px;
}

.version-meta dd {
  margin: 4px 0 0;
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.block {
  display: grid;
  gap: 8px;
}

.block > strong {
  font-size: 14px;
}

.diff-list,
.issue-list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.diff-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  font-size: 13px;
  background: rgba(250, 246, 236, 0.74);
  border: 1px solid rgba(23, 63, 53, 0.1);
  border-radius: 6px;
}

.diff-text small {
  color: rgba(31, 46, 41, 0.62);
}

.issue-list li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 9px;
  font-size: 13px;
  color: #8a372b;
  background: rgba(187, 77, 62, 0.08);
  border: 1px solid rgba(187, 77, 62, 0.25);
  border-radius: 6px;
}

.block-tip {
  margin: 0;
  color: rgba(31, 46, 41, 0.58);
  font-size: 12px;
  line-height: 1.5;
}

@media (max-width: 760px) {
  .version-meta {
    grid-template-columns: 1fr;
  }
}
</style>
