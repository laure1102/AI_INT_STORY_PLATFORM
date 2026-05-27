<script setup lang="ts">
import type { StoryRolesFile } from "@story-mgr/core"
import type { StoryAssetMetadata } from "@story-mgr/shared"

type RoleGenderMode = "common" | "male" | "female"

interface RoleDraft {
  draftKey: string
  descr: string
  img: string
  img_female: string
  img_male: string
  import: boolean
  name: string
  prompt: string
  qufen_xingbie: boolean
  selected: boolean
  xingge: string
}

interface RoleAssetState {
  error: string | null
  loading: boolean
  meta: StoryAssetMetadata | null
}

interface RolePromptState {
  error: string | null
  loading: boolean
}

interface RoleImageTask {
  mode: RoleGenderMode
  role: RoleDraft
}

const props = defineProps<{
  roles: StoryRolesFile
  saving: boolean
  storyId: string
  storyTitle?: string
}>()

const emit = defineEmits<{
  close: []
  save: [roles: StoryRolesFile]
}>()

const {
  compressRoleImage,
  generateRoleImage,
  generateRolePrompt,
  getStoryAssetMeta,
  getStoryAssetUrl
} = useStoryApi()

const draft = reactive({
  aiGlobalPrompt: "",
  imageSize: "1536x1024",
  compressQualityText: "60",
  roles: [] as RoleDraft[]
})

const assetStates = reactive<Record<string, RoleAssetState>>({})
const promptStates = reactive<Record<string, RolePromptState>>({})
const promptEditorState = reactive<{
  roleKey: string | null
  value: string
}>({
  roleKey: null,
  value: ""
})
const batchState = reactive({
  compressing: false,
  generatingCommonImages: false,
  generatingFemaleImages: false,
  generatingMaleImages: false,
  generatingPrompts: false,
  compressDone: 0,
  compressTotal: 0,
  commonImageDone: 0,
  commonImageTotal: 0,
  femaleImageDone: 0,
  femaleImageTotal: 0,
  maleImageDone: 0,
  maleImageTotal: 0,
  promptDone: 0,
  promptTotal: 0
})

let draftKeySeed = 0

function createDraftKey(prefix: string) {
  draftKeySeed += 1
  return `${prefix}-${draftKeySeed}`
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value : ""
}

function sanitizeNameInput(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function parseCompressQualityInput(value: unknown) {
  const trimmed = String(value ?? "").trim()
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : null
}

function getNextDefaultName() {
  const usedNames = new Set(draft.roles.map((role) => role.name.trim()).filter(Boolean))

  let index = draft.roles.length + 1
  let candidate = `role_${index}`

  while (usedNames.has(candidate)) {
    index += 1
    candidate = `role_${index}`
  }

  return candidate
}

function createEmptyAssetState(): RoleAssetState {
  return {
    error: null,
    loading: false,
    meta: null
  }
}

function createEmptyPromptState(): RolePromptState {
  return {
    error: null,
    loading: false
  }
}

function getAssetStateKey(draftKey: string, mode: RoleGenderMode) {
  return `${draftKey}:${mode}`
}

function getPromptStateKey(draftKey: string) {
  return `${draftKey}:prompt`
}

function initializeAssetState(role: RoleDraft) {
  assetStates[getAssetStateKey(role.draftKey, "common")] = createEmptyAssetState()
  assetStates[getAssetStateKey(role.draftKey, "male")] = createEmptyAssetState()
  assetStates[getAssetStateKey(role.draftKey, "female")] = createEmptyAssetState()
}

function initializePromptState(role: RoleDraft) {
  promptStates[getPromptStateKey(role.draftKey)] = createEmptyPromptState()
}

function clearAssetState(role: RoleDraft) {
  delete assetStates[getAssetStateKey(role.draftKey, "common")]
  delete assetStates[getAssetStateKey(role.draftKey, "male")]
  delete assetStates[getAssetStateKey(role.draftKey, "female")]
}

function clearPromptState(role: RoleDraft) {
  delete promptStates[getPromptStateKey(role.draftKey)]
}

function resetAssetStates() {
  for (const key of Object.keys(assetStates)) {
    delete assetStates[key]
  }
}

function resetPromptStates() {
  for (const key of Object.keys(promptStates)) {
    delete promptStates[key]
  }
}

function getAssetState(role: RoleDraft, mode: RoleGenderMode) {
  return assetStates[getAssetStateKey(role.draftKey, mode)]
}

function getPromptState(role: RoleDraft) {
  return promptStates[getPromptStateKey(role.draftKey)]
}

function cloneRole(role: StoryRolesFile["roles"][number]): RoleDraft {
  const draftRole: RoleDraft = {
    draftKey: createDraftKey("role"),
    descr: normalizeText(role.descr),
    img: normalizeText(role.img),
    img_female: normalizeText(role.img_female),
    img_male: normalizeText(role.img_male),
    import: Boolean(role.import),
    name: normalizeText(role.name),
    prompt: normalizeText(role.prompt),
    qufen_xingbie: Boolean(role.qufen_xingbie),
    selected: false,
    xingge: normalizeText(role.xingge)
  }

  initializeAssetState(draftRole)
  initializePromptState(draftRole)
  return draftRole
}

function formatBytes(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
  return `${(sizeBytes / 1024 / 1024).toFixed(2)} MB`
}

function formatAssetMeta(meta: StoryAssetMetadata | null) {
  if (!meta) return ""

  const dimensions =
    typeof meta.width === "number" && typeof meta.height === "number"
      ? `${meta.width} x ${meta.height}`
      : "尺寸未知"

  return `${dimensions} / ${formatBytes(meta.sizeBytes)}`
}

function formatErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function getAssetPath(role: RoleDraft, mode: RoleGenderMode) {
  if (mode === "male") return role.img_male.trim()
  if (mode === "female") return role.img_female.trim()
  return role.img.trim()
}

function setAssetPath(role: RoleDraft, mode: RoleGenderMode, assetPath: string) {
  if (mode === "male") {
    role.img_male = assetPath
    return
  }

  if (mode === "female") {
    role.img_female = assetPath
    return
  }

  role.img = assetPath
}

function getAssetLabel(mode: RoleGenderMode) {
  if (mode === "male") return "男图"
  if (mode === "female") return "女图"
  return "通用图"
}

function getAssetUrl(role: RoleDraft, mode: RoleGenderMode) {
  const assetPath = getAssetPath(role, mode)
  return assetPath ? getStoryAssetUrl(props.storyId, assetPath) : ""
}

async function loadAssetMeta(role: RoleDraft, mode: RoleGenderMode) {
  const state = getAssetState(role, mode)
  const assetPath = getAssetPath(role, mode)

  state.error = null

  if (!assetPath) {
    state.loading = false
    state.meta = null
    return
  }

  state.loading = true

  try {
    const asset = await getStoryAssetMeta(props.storyId, assetPath)

    if (getAssetPath(role, mode) === assetPath) {
      state.meta = asset
      state.error = null
    }
  } catch (error) {
    if (getAssetPath(role, mode) === assetPath) {
      state.meta = null
      state.error = formatErrorMessage(error, "读取图片信息失败。")
    }
  } finally {
    if (getAssetPath(role, mode) === assetPath) {
      state.loading = false
    }
  }
}

async function hydrateAssetMeta() {
  const tasks = draft.roles.flatMap((role) => [
    loadAssetMeta(role, "common"),
    loadAssetMeta(role, "male"),
    loadAssetMeta(role, "female")
  ])

  await Promise.allSettled(tasks)
}

function syncDraft(roles: StoryRolesFile) {
  resetAssetStates()
  resetPromptStates()
  draft.aiGlobalPrompt = normalizeText(roles.ai.global_prompt)
  draft.imageSize = normalizeText(roles.ai.image_size) || "1536x1024"
  draft.compressQualityText = String(roles.ai.compress_quality ?? 60)
  draft.roles = roles.roles.map(cloneRole)
  void hydrateAssetMeta()
}

const roleCount = computed(() => draft.roles.length)
const selectedCount = computed(() => draft.roles.filter((role) => role.selected).length)
const allSelected = computed({
  get: () => draft.roles.length > 0 && selectedCount.value === draft.roles.length,
  set: (checked: boolean) => {
    for (const role of draft.roles) {
      role.selected = checked
    }
  }
})

const duplicateNames = computed(() => {
  const counts = new Map<string, number>()

  for (const role of draft.roles) {
    const normalizedName = sanitizeNameInput(role.name)
    if (!normalizedName) continue
    counts.set(normalizedName, (counts.get(normalizedName) ?? 0) + 1)
  }

  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([name]) => name)
  )
})

const hasInvalidDraft = computed(() => {
  if (!draft.imageSize.trim()) return true
  if (parseCompressQualityInput(draft.compressQualityText) === null) return true

  return (
    draft.roles.some((role) => !sanitizeNameInput(role.name)) ||
    duplicateNames.value.size > 0
  )
})

const hasBatchSelection = computed(() => selectedCount.value > 0)
const isBatchRunning = computed(
  () =>
    batchState.generatingPrompts ||
    batchState.generatingCommonImages ||
    batchState.generatingMaleImages ||
    batchState.generatingFemaleImages ||
    batchState.compressing
)
const canBatchGeneratePrompts = computed(
  () =>
    hasBatchSelection.value &&
    !isBatchRunning.value &&
    draft.roles.some((role) => role.selected && role.descr.trim())
)
const canBatchGenerateCommonImages = computed(
  () =>
    hasBatchSelection.value &&
    !isBatchRunning.value &&
    draft.imageSize.trim().length > 0 &&
    draft.roles.some((role) => role.selected && !role.qufen_xingbie && role.prompt.trim())
)
const canBatchGenerateMaleImages = computed(
  () =>
    hasBatchSelection.value &&
    !isBatchRunning.value &&
    draft.imageSize.trim().length > 0 &&
    draft.roles.some((role) => role.selected && role.qufen_xingbie && role.prompt.trim())
)
const canBatchGenerateFemaleImages = computed(
  () =>
    hasBatchSelection.value &&
    !isBatchRunning.value &&
    draft.imageSize.trim().length > 0 &&
    draft.roles.some((role) => role.selected && role.qufen_xingbie && role.prompt.trim())
)
const canBatchCompressImages = computed(
  () =>
    hasBatchSelection.value &&
    !isBatchRunning.value &&
    draft.roles.some(
      (role) =>
        role.selected &&
        (role.img.trim() || role.img_male.trim() || role.img_female.trim())
    )
)

function addRole() {
  const role: RoleDraft = {
    draftKey: createDraftKey("role"),
    descr: "",
    img: "",
    img_female: "",
    img_male: "",
    import: false,
    name: getNextDefaultName(),
    prompt: "",
    qufen_xingbie: false,
    selected: false,
    xingge: ""
  }

  initializeAssetState(role)
  initializePromptState(role)
  draft.roles.push(role)
}

function removeRole(index: number) {
  const role = draft.roles[index]
  if (!role) return
  clearAssetState(role)
  clearPromptState(role)
  draft.roles.splice(index, 1)
}

function getSelectedRoles() {
  return draft.roles.filter((role) => role.selected)
}

function openPromptEditor(role: RoleDraft) {
  promptEditorState.roleKey = role.draftKey
  promptEditorState.value = role.prompt
}

function closePromptEditor() {
  promptEditorState.roleKey = null
  promptEditorState.value = ""
}

function savePromptEditor() {
  const role = draft.roles.find((currentRole) => currentRole.draftKey === promptEditorState.roleKey)

  if (role) {
    role.prompt = promptEditorState.value.trim()
  }

  closePromptEditor()
}

function getPromptPreview(prompt: string) {
  const trimmedPrompt = prompt.trim()
  return trimmedPrompt ? trimmedPrompt.slice(0, 48) : "编辑提示词"
}

function getRoleImageTargetName(role: RoleDraft, mode: RoleGenderMode) {
  const baseName = sanitizeNameInput(role.name) || "role"

  if (mode === "male") return `${baseName}_male`
  if (mode === "female") return `${baseName}_female`
  return baseName
}

async function handleGeneratePrompt(role: RoleDraft) {
  const state = getPromptState(role)
  state.error = null
  state.loading = true

  try {
    role.prompt = await generateRolePrompt(props.storyId, {
      descr: role.descr,
      import: role.import,
      qufenXingbie: role.qufen_xingbie,
      roleName: role.name,
      storyTitle: props.storyTitle,
      xingge: role.xingge
    })
  } catch (error) {
    state.error = formatErrorMessage(error, "生成提示词失败。")
  } finally {
    state.loading = false
  }
}

async function handleGenerateImage(role: RoleDraft, mode: RoleGenderMode) {
  const state = getAssetState(role, mode)
  state.error = null
  state.loading = true

  try {
    const asset = await generateRoleImage(props.storyId, {
      gender: mode,
      globalPrompt: draft.aiGlobalPrompt,
      imageSize: draft.imageSize.trim(),
      prompt: role.prompt,
      targetName: getRoleImageTargetName(role, mode)
    })

    setAssetPath(role, mode, asset.assetPath)
    state.meta = asset
  } catch (error) {
    state.error = formatErrorMessage(error, `生成${getAssetLabel(mode)}失败。`)
  } finally {
    state.loading = false
  }
}

async function handleCompressImage(role: RoleDraft, mode: RoleGenderMode) {
  const state = getAssetState(role, mode)
  const sourcePath = getAssetPath(role, mode)

  state.error = null
  state.loading = true

  try {
    const asset = await compressRoleImage(props.storyId, {
      quality: parseCompressQualityInput(draft.compressQualityText) ?? 60,
      sourcePath,
      targetName: getRoleImageTargetName(role, mode)
    })

    setAssetPath(role, mode, asset.assetPath)
    state.meta = asset
  } catch (error) {
    state.error = formatErrorMessage(error, `压缩${getAssetLabel(mode)}失败。`)
  } finally {
    state.loading = false
  }
}

async function handleBatchGeneratePrompts() {
  const roles = getSelectedRoles().filter((role) => role.descr.trim())
  if (!roles.length) return

  batchState.generatingPrompts = true
  batchState.promptDone = 0
  batchState.promptTotal = roles.length

  try {
    for (const role of roles) {
      await handleGeneratePrompt(role)
      batchState.promptDone += 1
    }
  } finally {
    batchState.generatingPrompts = false
  }
}

async function handleBatchGenerateImages(mode: RoleGenderMode) {
  const roles = getSelectedRoles().filter(
    (role) =>
      role.prompt.trim() &&
      (mode === "common" ? !role.qufen_xingbie : role.qufen_xingbie)
  )

  if (!roles.length || !draft.imageSize.trim()) return

  if (mode === "common") {
    batchState.generatingCommonImages = true
    batchState.commonImageDone = 0
    batchState.commonImageTotal = roles.length
  } else if (mode === "male") {
    batchState.generatingMaleImages = true
    batchState.maleImageDone = 0
    batchState.maleImageTotal = roles.length
  } else {
    batchState.generatingFemaleImages = true
    batchState.femaleImageDone = 0
    batchState.femaleImageTotal = roles.length
  }

  try {
    for (const role of roles) {
      await handleGenerateImage(role, mode)

      if (mode === "common") {
        batchState.commonImageDone += 1
      } else if (mode === "male") {
        batchState.maleImageDone += 1
      } else {
        batchState.femaleImageDone += 1
      }
    }
  } finally {
    if (mode === "common") {
      batchState.generatingCommonImages = false
    } else if (mode === "male") {
      batchState.generatingMaleImages = false
    } else {
      batchState.generatingFemaleImages = false
    }
  }
}

async function handleBatchCompressImages() {
  const roleTasks: RoleImageTask[] = []

  for (const role of getSelectedRoles()) {
    if (role.qufen_xingbie) {
      if (role.img_male.trim()) {
        roleTasks.push({ role, mode: "male" })
      }

      if (role.img_female.trim()) {
        roleTasks.push({ role, mode: "female" })
      }

      continue
    }

    if (role.img.trim()) {
      roleTasks.push({ role, mode: "common" })
    }
  }

  if (!roleTasks.length) return

  batchState.compressing = true
  batchState.compressDone = 0
  batchState.compressTotal = roleTasks.length

  try {
    for (const task of roleTasks) {
      await handleCompressImage(task.role, task.mode)
      batchState.compressDone += 1
    }
  } finally {
    batchState.compressing = false
  }
}

function submitDraft() {
  emit("save", {
    ai: {
      compress_quality: parseCompressQualityInput(draft.compressQualityText) ?? 60,
      global_prompt: draft.aiGlobalPrompt.trim(),
      image_size: draft.imageSize.trim()
    },
    roles: draft.roles.map((role) => {
      const normalizedName = sanitizeNameInput(role.name)
      const isSplitByGender = role.qufen_xingbie

      return {
        descr: role.descr.trim(),
        img: isSplitByGender ? "" : role.img.trim(),
        img_female: isSplitByGender ? role.img_female.trim() : "",
        img_male: isSplitByGender ? role.img_male.trim() : "",
        import: role.import,
        name: normalizedName,
        prompt: role.prompt.trim(),
        qufen_xingbie: isSplitByGender,
        xingge: role.xingge.trim()
      }
    })
  })
}

watch(
  () => props.roles,
  (roles) => {
    syncDraft(roles)
  },
  { immediate: true }
)
</script>

<template>
  <Teleport to="body">
    <div class="roles-dialog">
      <section class="roles-dialog__panel glass-panel">
        <div class="roles-dialog__header">
          <div>
            <span class="eyebrow">角色</span>
            <h2 class="roles-dialog__title">角色设置</h2>
          </div>

          <div class="roles-dialog__actions">
            <button class="btn-secondary" type="button" @click="emit('close')">关闭</button>
            <button
              class="btn-primary"
              type="button"
              :disabled="saving || hasInvalidDraft"
              @click="submitDraft"
            >
              {{ saving ? "保存中..." : "保存" }}
            </button>
          </div>
        </div>

        <div class="roles-dialog__body">
          <section class="roles-dialog__config">
            <div class="roles-dialog__config-head">
              <h3 class="roles-dialog__config-title">角色 AI 工具配置</h3>
            </div>

            <div class="roles-dialog__config-grid">
              <label class="roles-dialog__field">
                <span class="roles-dialog__label">图片尺寸</span>
                <input
                  v-model="draft.imageSize"
                  class="text-input"
                  type="text"
                  placeholder="1536x1024"
                />
              </label>

              <label class="roles-dialog__field">
                <span class="roles-dialog__label">压缩质量</span>
                <input
                  v-model="draft.compressQualityText"
                  class="text-input"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  placeholder="60"
                />
              </label>

              <label class="roles-dialog__field roles-dialog__field--wide">
                <span class="roles-dialog__label">整体提示词</span>
                <textarea
                  v-model="draft.aiGlobalPrompt"
                  class="text-input roles-dialog__textarea"
                  rows="3"
                  placeholder="统一风格、时代背景、镜头语言、材质倾向等"
                />
              </label>
            </div>
          </section>

          <div class="roles-dialog__toolbar">
            <div class="roles-dialog__count">
              当前角色数：{{ roleCount }}，已选择：{{ selectedCount }}
            </div>

            <div class="roles-dialog__batch-actions">
              <label class="roles-dialog__select-all">
                <input v-model="allSelected" type="checkbox" />
                <span>全选</span>
              </label>

              <button
                class="btn-secondary roles-dialog__row-button"
                type="button"
                :disabled="!canBatchGeneratePrompts"
                @click="handleBatchGeneratePrompts"
              >
                {{
                  batchState.generatingPrompts
                    ? `批量生成中 ${batchState.promptDone}/${batchState.promptTotal}`
                    : "批量生成提示词"
                }}
              </button>

              <button
                class="btn-secondary roles-dialog__row-button"
                type="button"
                :disabled="!canBatchGenerateCommonImages"
                @click="handleBatchGenerateImages('common')"
              >
                {{
                  batchState.generatingCommonImages
                    ? `通用图生成中 ${batchState.commonImageDone}/${batchState.commonImageTotal}`
                    : "批量生成通用图"
                }}
              </button>

              <button
                class="btn-secondary roles-dialog__row-button"
                type="button"
                :disabled="!canBatchGenerateMaleImages"
                @click="handleBatchGenerateImages('male')"
              >
                {{
                  batchState.generatingMaleImages
                    ? `男图生成中 ${batchState.maleImageDone}/${batchState.maleImageTotal}`
                    : "批量生成男图"
                }}
              </button>

              <button
                class="btn-secondary roles-dialog__row-button"
                type="button"
                :disabled="!canBatchGenerateFemaleImages"
                @click="handleBatchGenerateImages('female')"
              >
                {{
                  batchState.generatingFemaleImages
                    ? `女图生成中 ${batchState.femaleImageDone}/${batchState.femaleImageTotal}`
                    : "批量生成女图"
                }}
              </button>

              <button
                class="btn-secondary roles-dialog__row-button"
                type="button"
                :disabled="!canBatchCompressImages"
                @click="handleBatchCompressImages"
              >
                {{
                  batchState.compressing
                    ? `批量压缩中 ${batchState.compressDone}/${batchState.compressTotal}`
                    : "批量压缩图片"
                }}
              </button>
            </div>
          </div>

          <div v-if="duplicateNames.size" class="roles-dialog__warning">
            角色名称不能重复，请检查 `name`。
          </div>

          <div class="roles-dialog__table-wrap">
            <table class="roles-dialog__table">
              <thead>
                <tr>
                  <th class="roles-dialog__select-col">选择</th>
                  <th>名称</th>
                  <th>描述</th>
                  <th>性格</th>
                  <th>重要角色</th>
                  <th>区分性别</th>
                  <th>提示词</th>
                  <th>图片</th>
                  <th>AI 操作</th>
                  <th class="roles-dialog__actions-col">操作</th>
                </tr>
              </thead>
              <tbody v-if="draft.roles.length">
                <tr v-for="(role, index) in draft.roles" :key="role.draftKey">
                  <td class="roles-dialog__select-col">
                    <input v-model="role.selected" type="checkbox" />
                  </td>
                  <td>
                    <input
                      v-model="role.name"
                      class="text-input roles-dialog__cell-input"
                      type="text"
                      placeholder="suanming_xiansheng"
                    />
                  </td>
                  <td>
                    <textarea
                      v-model="role.descr"
                      class="text-input roles-dialog__textarea roles-dialog__textarea--cell"
                      rows="3"
                      placeholder="算命先生，长衫，手持签筒，江湖感"
                    />
                  </td>
                  <td>
                    <textarea
                      v-model="role.xingge"
                      class="text-input roles-dialog__textarea roles-dialog__textarea--cell"
                      rows="3"
                      placeholder="神秘，圆滑，洞察人心"
                    />
                  </td>
                  <td>
                    <select v-model="role.import" class="text-input roles-dialog__select">
                      <option :value="false">否</option>
                      <option :value="true">是</option>
                    </select>
                  </td>
                  <td>
                    <select v-model="role.qufen_xingbie" class="text-input roles-dialog__select">
                      <option :value="false">否</option>
                      <option :value="true">是</option>
                    </select>
                  </td>
                  <td>
                    <div class="roles-dialog__prompt-cell">
                      <button
                        class="roles-dialog__prompt-link"
                        type="button"
                        @click="openPromptEditor(role)"
                      >
                        {{ getPromptPreview(role.prompt) }}
                      </button>
                      <span v-if="getPromptState(role).loading" class="roles-dialog__prompt-status">
                        生成中...
                      </span>
                      <span v-if="getPromptState(role).error" class="roles-dialog__prompt-error">
                        {{ getPromptState(role).error }}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div v-if="role.qufen_xingbie" class="roles-dialog__asset-group">
                      <div class="roles-dialog__asset-card">
                        <span class="roles-dialog__asset-title">男图</span>
                        <a
                          v-if="role.img_male"
                          class="roles-dialog__asset-link"
                          :href="getAssetUrl(role, 'male')"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {{ role.img_male }}
                        </a>
                        <span v-else class="roles-dialog__asset-empty">未生成图片</span>
                        <span
                          v-if="formatAssetMeta(getAssetState(role, 'male').meta)"
                          class="roles-dialog__asset-meta"
                        >
                          {{ formatAssetMeta(getAssetState(role, 'male').meta) }}
                        </span>
                        <span v-if="getAssetState(role, 'male').loading" class="roles-dialog__asset-status">
                          处理中...
                        </span>
                        <span v-if="getAssetState(role, 'male').error" class="roles-dialog__asset-error">
                          {{ getAssetState(role, 'male').error }}
                        </span>
                      </div>

                      <div class="roles-dialog__asset-card">
                        <span class="roles-dialog__asset-title">女图</span>
                        <a
                          v-if="role.img_female"
                          class="roles-dialog__asset-link"
                          :href="getAssetUrl(role, 'female')"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {{ role.img_female }}
                        </a>
                        <span v-else class="roles-dialog__asset-empty">未生成图片</span>
                        <span
                          v-if="formatAssetMeta(getAssetState(role, 'female').meta)"
                          class="roles-dialog__asset-meta"
                        >
                          {{ formatAssetMeta(getAssetState(role, 'female').meta) }}
                        </span>
                        <span v-if="getAssetState(role, 'female').loading" class="roles-dialog__asset-status">
                          处理中...
                        </span>
                        <span v-if="getAssetState(role, 'female').error" class="roles-dialog__asset-error">
                          {{ getAssetState(role, 'female').error }}
                        </span>
                      </div>
                    </div>

                    <div v-else class="roles-dialog__asset-cell">
                      <a
                        v-if="role.img"
                        class="roles-dialog__asset-link"
                        :href="getAssetUrl(role, 'common')"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {{ role.img }}
                      </a>
                      <span v-else class="roles-dialog__asset-empty">未生成图片</span>
                      <span
                        v-if="formatAssetMeta(getAssetState(role, 'common').meta)"
                        class="roles-dialog__asset-meta"
                      >
                        {{ formatAssetMeta(getAssetState(role, 'common').meta) }}
                      </span>
                      <span v-if="getAssetState(role, 'common').loading" class="roles-dialog__asset-status">
                        处理中...
                      </span>
                      <span v-if="getAssetState(role, 'common').error" class="roles-dialog__asset-error">
                        {{ getAssetState(role, 'common').error }}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div class="roles-dialog__action-stack">
                      <button
                        class="btn-secondary roles-dialog__row-button"
                        type="button"
                        :disabled="getPromptState(role).loading || !role.descr.trim()"
                        @click="handleGeneratePrompt(role)"
                      >
                        生成提示词
                      </button>

                      <template v-if="role.qufen_xingbie">
                        <button
                          class="btn-secondary roles-dialog__row-button"
                          type="button"
                          :disabled="getAssetState(role, 'male').loading || !role.prompt.trim() || !draft.imageSize.trim()"
                          @click="handleGenerateImage(role, 'male')"
                        >
                          生成男图
                        </button>
                        <button
                          class="btn-secondary roles-dialog__row-button"
                          type="button"
                          :disabled="getAssetState(role, 'female').loading || !role.prompt.trim() || !draft.imageSize.trim()"
                          @click="handleGenerateImage(role, 'female')"
                        >
                          生成女图
                        </button>
                        <button
                          class="btn-secondary roles-dialog__row-button"
                          type="button"
                          :disabled="getAssetState(role, 'male').loading || !role.img_male.trim()"
                          @click="handleCompressImage(role, 'male')"
                        >
                          压缩男图
                        </button>
                        <button
                          class="btn-secondary roles-dialog__row-button"
                          type="button"
                          :disabled="getAssetState(role, 'female').loading || !role.img_female.trim()"
                          @click="handleCompressImage(role, 'female')"
                        >
                          压缩女图
                        </button>
                      </template>

                      <template v-else>
                        <button
                          class="btn-secondary roles-dialog__row-button"
                          type="button"
                          :disabled="getAssetState(role, 'common').loading || !role.prompt.trim() || !draft.imageSize.trim()"
                          @click="handleGenerateImage(role, 'common')"
                        >
                          生成图片
                        </button>
                        <button
                          class="btn-secondary roles-dialog__row-button"
                          type="button"
                          :disabled="getAssetState(role, 'common').loading || !role.img.trim()"
                          @click="handleCompressImage(role, 'common')"
                        >
                          压缩图片
                        </button>
                      </template>
                    </div>
                  </td>
                  <td class="roles-dialog__actions-col">
                    <button
                      class="btn-secondary roles-dialog__row-button"
                      type="button"
                      @click="removeRole(index)"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>

            <div v-if="!draft.roles.length" class="roles-dialog__empty">
              还没有角色，先添加一行。
            </div>
          </div>

          <div class="roles-dialog__footer">
            <button class="btn-secondary roles-dialog__row-add" type="button" @click="addRole">
              + 添加角色
            </button>
          </div>
        </div>

        <div class="roles-dialog__actions roles-dialog__actions--footer">
          <button class="btn-secondary" type="button" @click="emit('close')">关闭</button>
          <button
            class="btn-primary"
            type="button"
            :disabled="saving || hasInvalidDraft"
            @click="submitDraft"
          >
            {{ saving ? "保存中..." : "保存" }}
          </button>
        </div>
      </section>
    </div>

    <div v-if="promptEditorState.roleKey" class="roles-dialog__prompt-modal">
      <section class="roles-dialog__prompt-panel glass-panel">
        <div class="roles-dialog__prompt-head">
          <h3 class="roles-dialog__prompt-title">编辑提示词</h3>
          <button class="btn-secondary" type="button" @click="closePromptEditor">关闭</button>
        </div>

        <textarea
          v-model="promptEditorState.value"
          class="text-input roles-dialog__prompt-textarea"
          rows="10"
          placeholder="这里填写或修改当前角色的最终提示词"
        />

        <div class="roles-dialog__actions roles-dialog__actions--footer">
          <button class="btn-secondary" type="button" @click="closePromptEditor">取消</button>
          <button class="btn-primary" type="button" @click="savePromptEditor">保存提示词</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.roles-dialog {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(2, 8, 16, 0.72);
}

.roles-dialog__panel {
  width: min(1560px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  padding: 20px;
  overflow: auto;
  border-radius: 22px;
}

.roles-dialog__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.roles-dialog__title,
.roles-dialog__config-title,
.roles-dialog__prompt-title {
  margin: 10px 0 0;
  font-family: "Space Grotesk", sans-serif;
  font-size: 1.4rem;
  line-height: 1.1;
}

.roles-dialog__body {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.roles-dialog__config {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
}

.roles-dialog__config-grid {
  display: grid;
  grid-template-columns: minmax(220px, 260px) minmax(220px, 260px);
  gap: 12px;
}

.roles-dialog__field {
  display: grid;
  gap: 6px;
}

.roles-dialog__field--wide {
  grid-column: 1 / -1;
  min-width: 0;
}

.roles-dialog__label,
.roles-dialog__count {
  font-size: 0.82rem;
  color: var(--text-muted);
}

.roles-dialog__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.roles-dialog__batch-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.roles-dialog__select-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  color: var(--text-muted);
}

.roles-dialog__warning {
  color: var(--warning);
  font-size: 0.82rem;
}

.roles-dialog__select,
.roles-dialog__textarea {
  resize: vertical;
}

.roles-dialog__textarea--cell {
  min-height: 82px;
}

.roles-dialog__table-wrap {
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
}

.roles-dialog__table {
  width: 100%;
  min-width: 1560px;
  border-collapse: collapse;
}

.roles-dialog__table th,
.roles-dialog__table td {
  padding: 8px;
  border-bottom: 1px solid rgba(186, 220, 255, 0.12);
  text-align: left;
  vertical-align: top;
}

.roles-dialog__table th {
  position: sticky;
  top: 0;
  background: rgba(9, 19, 30, 0.92);
  font-size: 0.82rem;
  color: var(--text-muted);
}

.roles-dialog__select-col {
  width: 56px;
  text-align: center;
}

.roles-dialog__actions-col {
  width: 96px;
}

.roles-dialog__cell-input {
  min-width: 0;
}

.roles-dialog__prompt-cell {
  display: grid;
  gap: 6px;
}

.roles-dialog__prompt-link {
  padding: 0;
  color: var(--accent);
  background: transparent;
  border: 0;
  text-align: left;
  word-break: break-all;
  font-size: 0.8rem;
}

.roles-dialog__prompt-status,
.roles-dialog__prompt-error {
  font-size: 0.76rem;
  line-height: 1.3;
}

.roles-dialog__prompt-status {
  color: var(--text-muted);
}

.roles-dialog__prompt-error {
  color: var(--warning);
}

.roles-dialog__asset-group {
  display: grid;
  gap: 10px;
}

.roles-dialog__asset-card,
.roles-dialog__asset-cell,
.roles-dialog__action-stack {
  display: grid;
  gap: 6px;
}

.roles-dialog__asset-title {
  font-size: 0.76rem;
  color: var(--text-muted);
}

.roles-dialog__asset-link,
.roles-dialog__asset-empty,
.roles-dialog__asset-meta,
.roles-dialog__asset-status,
.roles-dialog__asset-error {
  min-width: 0;
  font-size: 0.78rem;
  line-height: 1.3;
}

.roles-dialog__asset-link {
  color: var(--accent);
  text-decoration: none;
  word-break: break-all;
}

.roles-dialog__asset-empty,
.roles-dialog__asset-meta,
.roles-dialog__asset-status {
  color: var(--text-muted);
}

.roles-dialog__asset-error {
  color: var(--warning);
}

.roles-dialog__actions {
  display: flex;
  gap: 8px;
}

.roles-dialog__row-add,
.roles-dialog__row-button {
  min-height: 30px;
  padding: 0 12px;
  border-radius: 10px;
  font-size: 0.8rem;
}

.roles-dialog__empty {
  padding: 16px;
  color: var(--text-muted);
  font-size: 0.84rem;
}

.roles-dialog__footer {
  display: flex;
  justify-content: flex-start;
}

.roles-dialog__actions--footer {
  margin-top: 16px;
  justify-content: flex-end;
}

.roles-dialog__prompt-modal {
  position: fixed;
  inset: 0;
  z-index: 61;
  display: grid;
  place-items: center;
  padding: 20px;
  pointer-events: none;
}

.roles-dialog__prompt-panel {
  width: min(880px, calc(100vw - 48px));
  padding: 18px;
  border-radius: 20px;
  pointer-events: auto;
}

.roles-dialog__prompt-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.roles-dialog__prompt-textarea {
  width: 100%;
  min-height: 240px;
  margin-top: 14px;
  resize: vertical;
}

@media (max-width: 900px) {
  .roles-dialog__header,
  .roles-dialog__actions,
  .roles-dialog__config-grid,
  .roles-dialog__prompt-head {
    grid-template-columns: 1fr;
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
