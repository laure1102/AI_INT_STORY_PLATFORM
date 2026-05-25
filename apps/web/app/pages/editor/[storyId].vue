<script setup lang="ts">
import StoryEditorShell from "~/components/story/StoryEditorShell.vue"

const route = useRoute()
const storyId = computed(() => String(route.params.storyId ?? ""))

useHead({
  title: computed(() => `Editor - ${storyId.value || "Story"}`)
})
</script>

<template>
  <StoryEditorShell :story-id="storyId" />
</template>
