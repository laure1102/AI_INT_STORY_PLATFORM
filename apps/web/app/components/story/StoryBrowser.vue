<script setup lang="ts">
import type { AppSettingsFile, StorySummary } from "@story-mgr/core"
import AppSettingsDialog from "./AppSettingsDialog.vue"
import StoryBrowserSettingsBar from "./StoryBrowserSettingsBar.vue"
import StoryList from "./StoryList.vue"

const { getAppSettings, listStories, saveAppSettings } = useStoryApi()

const stories = ref<StorySummary[]>([])
const appSettings = ref<AppSettingsFile | null>(null)
const selectedStoryId = shallowRef<string | null>(null)
const isLoading = shallowRef(true)
const isSavingSettings = shallowRef(false)
const isSettingsDialogOpen = shallowRef(false)
const errorMessage = shallowRef<string | null>(null)

async function loadStories() {
  isLoading.value = true
  errorMessage.value = null

  try {
    const [storyList, settings] = await Promise.all([listStories(), getAppSettings()])
    stories.value = storyList
    appSettings.value = settings
    selectedStoryId.value = storyList[0]?.id ?? null
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "加载故事列表失败。"
  } finally {
    isLoading.value = false
  }
}

const selectedStory = computed(() => {
  return stories.value.find((story) => story.id === selectedStoryId.value) ?? null
})

function openSettingsDialog() {
  if (!appSettings.value) {
    return
  }

  isSettingsDialogOpen.value = true
}

function closeSettingsDialog() {
  isSettingsDialogOpen.value = false
}

async function handleSaveSettings(settings: AppSettingsFile) {
  isSavingSettings.value = true
  errorMessage.value = null

  try {
    appSettings.value = await saveAppSettings(settings)
    isSettingsDialogOpen.value = false
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存设置失败。"
  } finally {
    isSavingSettings.value = false
  }
}

onMounted(() => {
  void loadStories()
})
</script>

<template>
  <main class="page-shell fade-up">
    <StoryBrowserSettingsBar @open-settings="openSettingsDialog" />

    <section class="hero">
      <div class="hero__content">
        <span class="eyebrow">Story Manager</span>
        <h1 class="hero__title">游戏网状剧情事件编辑器</h1>
        <p class="hero__copy">
          用 Git 友好的 JSON5 管理剧情数据，结合 Nuxt 编辑器与 Koa 文件服务，把故事内容、地点素材和 AI 工作流统一收进一个项目里。
        </p>
      </div>

      <div class="hero__status glass-panel">
        <div class="pill">
          <span class="status-dot" />
          当前骨架：Nuxt + Koa2 + JSON5
        </div>
        <p class="hero__status-copy muted">
          现在已经支持故事浏览、事件图谱编辑、全局变量、场景和地点配置，后续可以继续扩展角色与更细的剧情 DSL。
        </p>
      </div>
    </section>

    <section class="workspace glass-panel">
      <div class="workspace__sidebar">
        <div class="workspace__header">
          <h2 class="section-title">故事列表</h2>
          <button class="btn-secondary" type="button" @click="loadStories">刷新</button>
        </div>

        <p v-if="isLoading" class="muted">正在读取 `data/stories` ...</p>
        <p v-else-if="errorMessage" class="workspace__error">{{ errorMessage }}</p>
        <StoryList
          v-else
          :stories="stories"
          :selected-story-id="selectedStoryId"
          @select="selectedStoryId = $event"
        />
      </div>

      <div class="workspace__detail">
        <template v-if="selectedStory">
          <div class="workspace__detail-head">
            <div>
              <p class="eyebrow">Selected Story</p>
              <h2 class="workspace__detail-title">{{ selectedStory.title }}</h2>
            </div>

            <NuxtLink class="btn-primary" :to="`/editor/${selectedStory.id}`">
              打开编辑器
            </NuxtLink>
          </div>

          <p class="workspace__detail-copy">
            {{ selectedStory.description || "这条故事还没有填写简介。" }}
          </p>

          <div class="workspace__stats">
            <div class="workspace__stat-card">
              <span class="workspace__stat-label">事件数量</span>
              <strong class="workspace__stat-value">{{ selectedStory.eventCount }}</strong>
            </div>

            <div class="workspace__stat-card">
              <span class="workspace__stat-label">最后同步</span>
              <strong class="workspace__stat-value">
                {{ selectedStory.updatedAt || "读取 story.json5 时间" }}
              </strong>
            </div>
          </div>
        </template>

        <div v-else class="workspace__empty">
          还没有读取到故事目录，可以先保留示例故事，后续再继续扩展。
        </div>
      </div>
    </section>

    <AppSettingsDialog
      v-if="appSettings && isSettingsDialogOpen"
      :saving="isSavingSettings"
      :settings="appSettings"
      @close="closeSettingsDialog"
      @save="handleSaveSettings"
    />
  </main>
</template>

<style scoped>
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(320px, 0.9fr);
  gap: 24px;
  margin-bottom: 24px;
}

.hero__content {
  padding: 18px 6px 18px 0;
}

.hero__title {
  margin: 16px 0 14px;
  font-family: "Space Grotesk", sans-serif;
  font-size: clamp(2.4rem, 5vw, 4.4rem);
  line-height: 0.94;
}

.hero__copy {
  max-width: 58ch;
  margin: 0;
  color: var(--text-muted);
  font-size: 1.05rem;
  line-height: 1.8;
}

.hero__status {
  display: grid;
  gap: 18px;
  align-content: start;
  padding: 22px;
}

.hero__status-copy {
  margin: 0;
  line-height: 1.8;
}

.workspace {
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  gap: 22px;
  padding: 22px;
}

.workspace__sidebar,
.workspace__detail {
  min-width: 0;
}

.workspace__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.workspace__error {
  margin: 0;
  color: var(--warning);
}

.workspace__detail {
  padding: 8px 8px 8px 10px;
}

.workspace__detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.workspace__detail-title {
  margin: 10px 0 0;
  font-family: "Space Grotesk", sans-serif;
  font-size: 2rem;
}

.workspace__detail-copy {
  max-width: 60ch;
  margin: 18px 0 26px;
  color: var(--text-muted);
  line-height: 1.8;
}

.workspace__stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.workspace__stat-card {
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.04);
}

.workspace__stat-label {
  display: block;
  color: var(--text-muted);
  font-size: 0.9rem;
}

.workspace__stat-value {
  display: block;
  margin-top: 10px;
  font-family: "Space Grotesk", sans-serif;
  font-size: 1.4rem;
}

.workspace__empty {
  display: grid;
  place-items: center;
  min-height: 220px;
  border: 1px dashed var(--line);
  border-radius: 18px;
  color: var(--text-muted);
}

@media (max-width: 900px) {
  .hero,
  .workspace {
    grid-template-columns: 1fr;
  }

  .workspace__stats {
    grid-template-columns: 1fr;
  }
}
</style>
