<template>
  <section v-if="exhibition" class="gallery-page">
    <div class="page-head">
      <div>
        <h1>{{ exhibition.title }}</h1>
        <p>{{ exhibition.intro }}</p>
      </div>
      <div class="gallery-actions">
        <n-tag :bordered="false">{{ exhibition.curator }}</n-tag>
        <n-tooltip :disabled="Boolean(publishedTour)" trigger="hover">
          <template #trigger>
        <n-button secondary :disabled="!publishedTour" @click="toggleTour">
          {{ isTouring ? '暂停导览' : '自动导览' }}
        </n-button>
          </template>
          该展览的导览尚未发布，暂不能自动导览
        </n-tooltip>
      </div>
    </div>

    <SceneCanvas @ready="onSceneReady">
      <div class="scene-hint">
        <strong>拖拽旋转 / 滚轮缩放 / 点击展品</strong>
        <span v-if="activeNarration">{{ activeNarration }}</span>
      </div>
      <div class="artifact-strip">
        <button
          v-for="artifact in artifacts"
          :key="artifact.id"
          type="button"
          :class="{ active: artifact.id === selectedArtifactId }"
          @click="selectedArtifactId = artifact.id"
        >
          {{ artifact.name }}
        </button>
      </div>
      <ArtifactPanel
        :artifact="selectedArtifact"
        :annotations="selectedArtifact ? annotationStore.byArtifactId(selectedArtifact.id) : []"
        @close="selectedArtifactId = undefined"
      />
    </SceneCanvas>
  </section>
  <n-result v-else status="404" title="展览不存在" description="请先在展览管理中创建或发布展览。" />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import * as THREE from 'three';
import SceneCanvas from '@/components/common/SceneCanvas.vue';
import ArtifactPanel from '@/components/viewer/ArtifactPanel.vue';
import { useThreeScene } from '@/hooks/useThreeScene';
import { useAnnotationStore } from '@/stores/annotation';
import { useArtifactStore } from '@/stores/artifact';
import { useExhibitionStore } from '@/stores/exhibition';
import { useTourStore } from '@/stores/tour';
import type { Artifact, PublishedTourVersion } from '@/types';
import { CraftCategory } from '@/types';
import { createGalleryHall, createArtifactFallback, loadArtifactObject } from '@/utils/model-loader';
import { disposeObject3D } from '@/utils/renderer';
import { createTourPlayer, type TourPlayerControls } from '@/utils/tour-player';

const route = useRoute();
const artifactStore = useArtifactStore();
const exhibitionStore = useExhibitionStore();
const annotationStore = useAnnotationStore();
const tourStore = useTourStore();

const containerRef = ref<HTMLElement | null>(null);
const selectedArtifactId = ref<string | undefined>();
const activeNarration = ref('');
const isTouring = ref(false);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const three = useThreeScene(containerRef, { cameraPosition: [5.5, 3.4, 8.2] });

let sceneRoot: THREE.Group | null = null;
let player: TourPlayerControls | null = null;

const exhibition = computed(() => {
  const id = String(route.params.id ?? '');
  return exhibitionStore.getById(id) ?? exhibitionStore.exhibitions[0];
});

const selectedArtifact = computed(() => artifactStore.getById(selectedArtifactId.value ?? ''));

// 展线条展示当前展览内的展品。
const artifacts = computed<Artifact[]>(() => {
  const ids = exhibition.value?.artifactIds ?? [];
  return ids.map((id) => artifactStore.getById(id)).filter((artifact): artifact is Artifact => Boolean(artifact));
});

// 自动导览只读取已发布快照；草稿编辑与后续重新发布都不会改动它。
const publishedTour = computed<PublishedTourVersion | undefined>(() =>
  exhibition.value ? tourStore.publishedForExhibition(exhibition.value.id) : undefined
);

// 场景展品 = 展览当前展品 ∪ 已发布导览快照引用的展品，
// 保证展品退出展览（甚至从展品库删除）后，已发布版本仍可离线回放。
const sceneArtifacts = computed<Artifact[]>(() => {
  const map = new Map<string, Artifact>();
  for (const artifact of artifacts.value) {
    map.set(artifact.id, artifact);
  }
  for (const node of publishedTour.value?.nodes ?? []) {
    const artifact = artifactStore.getById(node.artifactId);
    if (artifact && !map.has(node.artifactId)) map.set(node.artifactId, artifact);
  }
  return [...map.values()];
});

const sceneKey = computed(
  () =>
    `${three.ready.value}-${exhibition.value?.id}-${publishedTour.value?.version ?? 'none'}-${sceneArtifacts.value
      .map((item) => item.id)
      .join('|')}`
);

function onSceneReady(element: HTMLElement) {
  containerRef.value = element;
  element.addEventListener('click', handleSceneClick);
}

async function rebuildScene() {
  if (!three.ready.value || !three.scene.value || !exhibition.value) return;
  if (sceneRoot) {
    three.scene.value.remove(sceneRoot);
    disposeObject3D(sceneRoot);
  }

  const root = createGalleryHall(exhibition.value.themeColor);
  const spacing = 4.1;
  await Promise.all(
    sceneArtifacts.value.map(async (artifact, index) => {
      const object = await loadArtifactObject(artifact);
      object.position.set((index - (sceneArtifacts.value.length - 1) / 2) * spacing, 0, index % 2 === 0 ? -1.35 : 1.2);
      object.rotation.y = index % 2 === 0 ? 0.16 : -0.24;
      object.userData.artifactId = artifact.id;
      root.add(object);
    })
  );

  // 快照引用但已从展品库删除的展品：用占位展牌保证已发布版本回放画面完整。
  const missingIds = [...new Set((publishedTour.value?.nodes ?? []).map((node) => node.artifactId))].filter(
    (id) => !artifactStore.getById(id)
  );
  missingIds.forEach((artifactId, missingIndex) => {
    const stub: Artifact = {
      id: artifactId,
      name: '已撤展展品',
      description: '',
      author: '',
      category: CraftCategory.Pottery,
      dimensions: '',
      year: 0,
      material: '',
      images: [],
      imageFileIds: [],
      createdAt: '',
      updatedAt: ''
    };
    const object = createArtifactFallback(stub);
    object.position.set((missingIndex - (missingIds.length - 1) / 2) * spacing, 0, 3.6);
    object.userData.artifactId = artifactId;
    root.add(object);
  });

  sceneRoot = root;
  three.scene.value.add(root);
  if (!selectedArtifactId.value && artifacts.value[0]) {
    selectedArtifactId.value = artifacts.value[0].id;
  }
  three.render();
}

function findArtifactId(object: THREE.Object3D | null): string | undefined {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (typeof current.userData.artifactId === 'string') return current.userData.artifactId;
    current = current.parent;
  }
  return undefined;
}

function handleSceneClick(event: MouseEvent) {
  if (!three.camera.value || !sceneRoot || !three.renderer.value) return;
  const rect = three.renderer.value.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, three.camera.value);
  const hit = raycaster.intersectObjects(sceneRoot.children, true)[0];
  const artifactId = findArtifactId(hit?.object ?? null);
  if (artifactId) {
    selectedArtifactId.value = artifactId;
  }
}

function toggleTour() {
  if (isTouring.value) {
    player?.pause();
    isTouring.value = false;
    return;
  }
  if (!three.camera.value || !three.controls.value || !publishedTour.value) return;
  // 取下当前快照：播放期间即使重新发布，本次播放仍沿用这一份节点数组。
  const snapshot = publishedTour.value;
  player?.stop();
  player = createTourPlayer(three.camera.value, three.controls.value, snapshot.nodes, (node) => {
    selectedArtifactId.value = node.artifactId;
    activeNarration.value = node.narration;
  });
  player.play();
  isTouring.value = true;
}

watch(sceneKey, () => void rebuildScene(), { immediate: true });

onBeforeUnmount(() => {
  player?.stop();
  if (containerRef.value) {
    containerRef.value.removeEventListener('click', handleSceneClick);
  }
});
</script>

<style scoped>
.gallery-page {
  display: grid;
  gap: 18px;
}

.gallery-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
}

.scene-hint {
  position: absolute;
  top: 16px;
  left: 16px;
  display: grid;
  max-width: min(440px, calc(100% - 32px));
  gap: 4px;
  padding: 10px 12px;
  color: var(--museum-ink);
  background: rgba(251, 245, 232, 0.88);
  border: 1px solid rgba(23, 63, 53, 0.14);
  border-radius: 8px;
}

.scene-hint strong {
  font-size: 13px;
}

.scene-hint span {
  color: rgba(31, 46, 41, 0.68);
  font-size: 13px;
  line-height: 1.45;
}

.artifact-strip {
  position: absolute;
  right: 20px;
  bottom: 20px;
  left: 20px;
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.artifact-strip button {
  flex: 0 0 auto;
  padding: 9px 12px;
  color: var(--museum-ink);
  background: rgba(251, 245, 232, 0.88);
  border: 1px solid rgba(23, 63, 53, 0.14);
  border-radius: 999px;
  cursor: pointer;
}

.artifact-strip button.active {
  color: #fbf5e8;
  background: var(--museum-green);
}
</style>
