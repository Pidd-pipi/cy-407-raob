# 工艺品3D展示画廊

沉浸式 3D 虚拟展厅，用于展示非遗手工艺品的立体细节、标注信息和自定义导览路线，所有数据保存在浏览器本地。

## 功能列表

- 3D 展厅：Three.js 渲染展厅空间，支持拖拽旋转、滚轮缩放、点击展品查看详情。
- 展品详情：独立 360° 模型查看器，右侧信息面板展示作者、工艺、材质、尺寸和标注。
- 展览管理：创建、编辑、删除展览，调整展品顺序，设置主题色并发布。
- 导览编辑：时间轴式节点编辑，配置展品、相机位置、目标点、过渡时长和讲解文字。
- 发布闭环：节点与顺序编辑只进入草稿（即时落库，刷新不丢）；发布时一次性校验「节点仍属于当前展览、展品仍存在、相机与目标点不重合」，任一异常则整条路线不发布，线上旧版本继续播放；校验通过生成不可变版本快照，自动导览立即切换，播放中的版本与后续编辑互相隔离。展品退出展览后草稿保留但禁止发布，已发布版本仍可离线回放。编辑页实时展示草稿与线上差异。
- 展品库：网格/列表视图切换，维护展品资料，上传本地图片和 GLB/GLTF 模型。
- 本地持久化：IndexedDB 保存四类业务实体，File API + Blob 保存图片和 3D 模型文件。
- Three.js 生命周期：统一 renderer 管理、动画循环和组件卸载资源释放。

## 快速启动

```bash
cd frontend
npm install
npm run dev
npm run build
npm run preview
```

开发服务器端口固定为 `28313`。

## 技术栈

| 分类 | 技术 |
| --- | --- |
| 前端框架 | Vue 3 + TypeScript |
| UI 组件库 | Naive UI |
| 构建工具 | Vite |
| 状态管理 | Pinia |
| 3D 引擎 | Three.js |
| 本地存储 | IndexedDB、File API、idb |
| 辅助依赖 | @vueuse/core、@types/three |

## 目录结构

```text
frontend/src/
├── api/           # storage.ts：IndexedDB 数据层仓库
├── stores/        # artifact.ts, exhibition.ts, annotation.ts, tour.ts
├── types/         # artifact.ts, exhibition.ts, annotation.ts, tour.ts, enums.ts
├── components/
│   ├── common/    # SceneCanvas, ArtifactCard, InfoPanel, FileUploader, ExhibitionCard
│   ├── viewer/    # ModelViewer, AnnotationRenderer, CameraControls, ArtifactPanel
│   └── editor/    # ArtifactPicker, TourTimeline, CameraSetter
├── hooks/         # useThreeScene, useIndexedDB, useAnimationLoop
├── pages/         # Gallery, ArtifactDetail, ExhibitionManage, TourEditor, ArtifactManage
├── router/
├── styles/
└── utils/         # storage.ts, renderer.ts, model-loader.ts, tour-player.ts, tour-publish.ts
```

## 导览发布闭环

| 关注点 | 行为 |
| --- | --- |
| 草稿 | `Tour.draftName` / `Tour.draftNodes`，节点增删、调序、改名均即时写入 IndexedDB，不触碰线上 |
| 发布校验 | `utils/tour-publish.ts` 的 `validateTourDraft` 一次性返回全部问题（空路线、展品缺失、已退出展览、相机/目标点重合） |
| 原子发布 | 存在任一问题则整体不发布；通过后 `published` 整体替换为新版本快照（版本号自增） |
| 播放隔离 | 展厅只读取已发布快照，`createTourPlayer` 启动时取当前快照节点数组，重新发布或继续编辑都不影响正在播放的路线 |
| 下线展品 | 草稿引用已退出展览的展品时节点标红且无法发布；快照内展品即使退出展览或从库删除，线上版本仍可回放（已删除展品以占位展牌呈现） |
| 差异展示 | `diffTourDraft` 计算改名/新增/删除/调序/修改五类差异，编辑页实时显示，刷新后状态以 IndexedDB 为准保持一致 |
| 数据迁移 | 旧版 `Tour`（`name` + `nodes` 单份数据）加载时自动迁移为草稿 + v1 已发布快照，保证既有线上导览不中断 |

## 3D功能截图占位

> 启动后访问 `http://localhost:28313/exhibitions/exhibition-heritage-hall`，在此处替换为展厅截图。

```text
[ 3D 展厅截图占位 ]
```

## License

MIT
