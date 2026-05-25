<script setup lang="ts">
import type { StorySummary } from "@story-mgr/core"
import StoryList from "./StoryList.vue"

const { listStories } = useStoryApi()

const stories = ref<StorySummary[]>([])
const selectedStoryId = shallowRef<string | null>(null)
const isLoading = shallowRef(true)
const errorMessage = shallowRef<string | null>(null)

async function loadStories() {
  isLoading.value = true
  errorMessage.value = null

  try {
    stories.value = await listStories()
    selectedStoryId.value = stories.value[0]?.id ?? null
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "加载故事列表失败。"
  } finally {
    isLoading.value = false
  }
}

const selectedStory = computed(() => {
  return stories.value.find((story) => story.id === selectedStoryId.value) ?? null
})

onMounted(() => {
  void loadStories()
})
</script>

<template>
  <main class="page-shell fade-up">
    <section class="hero">
      <div class="hero__content">
        <span class="eyebrow">Story Manager</span>
        <h1 class="hero__title">游戏网状剧情事件编辑器</h1>
        <p class="hero__copy">
          先把故事拆成 Git 友好的 JSON5 文件，再用 Nuxt 编辑器和 Koa 文件服务把读写链路跑通。
        </p>
      </div>
      <div class="hero__status glass-panel">
        <div class="pill">
          <span class="status-dot" />
          当前骨架：Nuxt + Koa2 + JSON5
        </div>
        <p class="hero__status-copy muted">
          当前示例故事已经接入，后续我们可以在这套骨架上继续设计剧情事件 DSL 和图编辑器。
        </p>
      </div>
    </section>

    <section class="workspace glass-panel">
      <div class="workspace__sidebar">
        <div class="workspace__header">
          <h2 class="section-title">故事列表</h2>
          <button class="btn-secondary" type="button" @click="loadStories">
            刷新
          </button>
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
            {{ selectedStory.description || "这一条故事还没有写简介。" }}
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
          还没有读到故事目录，你可以先保留示例，后面再继续扩展。
        </div>
      </div>
    </section>
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
