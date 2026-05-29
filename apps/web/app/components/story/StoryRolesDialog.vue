<script setup lang="ts">
import type {
  StoryImportantRoleDefinition,
  StoryNormalRoleDefinition,
  StoryRolesFile
} from "@story-mgr/core"
import type { StoryAssetMetadata } from "@story-mgr/shared"

type RolesTab = "normal" | "important"
type ImportantRoleImageMode = "common" | "male" | "female"
type ImageVariant = "raw" | "compress1" | "compress2"

interface RoleAiDraft {
  compressQuality1Text: string
  compressQuality2Text: string
  globalPrompt: string
  imageHeightText: string
  imageWidthText: string
}

interface NormalRoleDraft {
  draftKey: string
  descr: string
  img_compress_1: string
  img_compress_2: string
  img_raw: string
  name: string
  prompt: string
  selected: boolean
  zhiye: string
}

interface ImportantRoleDraft {
  draftKey: string
  descr: string
  descr_female: string
  descr_male: string
  img_compress_1: string
  img_compress_2: string
  img_female_compress_1: string
  img_female_compress_2: string
  img_female_raw: string
  img_male_compress_1: string
  img_male_compress_2: string
  img_male_raw: string
  img_raw: string
  name: string
  prompt: string
  prompt_female: string
  prompt_male: string
  qufen_xingbie: boolean
  selected: boolean
  xingge: string
  zhiye: string
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

interface ImagePreviewState {
  path: string
  title: string
  url: string
}

interface ImportantRoleImageTask {
  mode: ImportantRoleImageMode
  role: ImportantRoleDraft
}

const imageVariants: ImageVariant[] = ["raw", "compress1", "compress2"]

const props = defineProps<{
  roles: StoryRolesFile
  saveSuccessMessage?: string | null
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

const activeTab = shallowRef<RolesTab>("normal")

function createRoleAiDraft(): RoleAiDraft {
  return {
    compressQuality1Text: "60",
    compressQuality2Text: "30",
    globalPrompt: "",
    imageHeightText: "1024",
    imageWidthText: "1536"
  }
}

const draft = reactive({
  importantAi: createRoleAiDraft(),
  importantRoles: [] as ImportantRoleDraft[],
  normalAi: createRoleAiDraft(),
  normalRoles: [] as NormalRoleDraft[]
})

const assetStates = reactive<Record<string, RoleAssetState>>({})
const promptStates = reactive<Record<string, RolePromptState>>({})
const promptEditorState = reactive<{
  mode: ImportantRoleImageMode
  roleKey: string | null
  value: string
}>({
  mode: "common",
  roleKey: null,
  value: ""
})
const imagePreviewState = reactive<ImagePreviewState>({
  path: "",
  title: "",
  url: ""
})
const batchState = reactive({
  commonImageDone: 0,
  commonImageTotal: 0,
  compress1Done: 0,
  compress1Total: 0,
  compress2Done: 0,
  compress2Total: 0,
  compressing1: false,
  compressing2: false,
  femaleImageDone: 0,
  femaleImageTotal: 0,
  generatingCommonImages: false,
  generatingFemaleImages: false,
  generatingMaleImages: false,
  generatingPrompts: false,
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

function parseImageDimensionInput(value: unknown) {
  const trimmed = String(value ?? "").trim()
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null
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

function getPromptStateKey(draftKey: string) {
  return `${draftKey}:prompt`
}

function getAssetStateKey(
  draftKey: string,
  mode: ImportantRoleImageMode = "common",
  variant: ImageVariant = "raw"
) {
  return `${draftKey}:${mode}:${variant}`
}

function initializeNormalRoleState(role: NormalRoleDraft) {
  for (const variant of imageVariants) {
    assetStates[getAssetStateKey(role.draftKey, "common", variant)] = createEmptyAssetState()
  }

  promptStates[getPromptStateKey(role.draftKey)] = createEmptyPromptState()
}

function initializeImportantRoleState(role: ImportantRoleDraft) {
  for (const mode of ["common", "male", "female"] as ImportantRoleImageMode[]) {
    for (const variant of imageVariants) {
      assetStates[getAssetStateKey(role.draftKey, mode, variant)] = createEmptyAssetState()
    }
  }

  promptStates[getPromptStateKey(role.draftKey)] = createEmptyPromptState()
}

function clearRoleState(draftKey: string) {
  delete promptStates[getPromptStateKey(draftKey)]

  for (const mode of ["common", "male", "female"] as ImportantRoleImageMode[]) {
    for (const variant of imageVariants) {
      delete assetStates[getAssetStateKey(draftKey, mode, variant)]
    }
  }
}

function resetStates() {
  for (const key of Object.keys(assetStates)) {
    delete assetStates[key]
  }

  for (const key of Object.keys(promptStates)) {
    delete promptStates[key]
  }
}

function getPromptState(draftKey: string) {
  return promptStates[getPromptStateKey(draftKey)]
}

function getAssetState(
  draftKey: string,
  mode: ImportantRoleImageMode = "common",
  variant: ImageVariant = "raw"
) {
  return assetStates[getAssetStateKey(draftKey, mode, variant)]
}

function cloneNormalRole(role: StoryNormalRoleDefinition): NormalRoleDraft {
  const draftRole: NormalRoleDraft = {
    descr: normalizeText(role.descr),
    draftKey: createDraftKey("normal-role"),
    img_compress_1: normalizeText(role.img_compress_1),
    img_compress_2: normalizeText(role.img_compress_2),
    img_raw: normalizeText(role.img_raw),
    name: normalizeText(role.name),
    prompt: normalizeText(role.prompt),
    selected: false,
    zhiye: normalizeText(role.zhiye)
  }

  initializeNormalRoleState(draftRole)
  return draftRole
}

function cloneImportantRole(role: StoryImportantRoleDefinition): ImportantRoleDraft {
  const draftRole: ImportantRoleDraft = {
    descr: normalizeText(role.descr),
    descr_female: normalizeText(role.descr_female),
    descr_male: normalizeText(role.descr_male),
    draftKey: createDraftKey("important-role"),
    img_compress_1: normalizeText(role.img_compress_1),
    img_compress_2: normalizeText(role.img_compress_2),
    img_female_compress_1: normalizeText(role.img_female_compress_1),
    img_female_compress_2: normalizeText(role.img_female_compress_2),
    img_female_raw: normalizeText(role.img_female_raw),
    img_male_compress_1: normalizeText(role.img_male_compress_1),
    img_male_compress_2: normalizeText(role.img_male_compress_2),
    img_male_raw: normalizeText(role.img_male_raw),
    img_raw: normalizeText(role.img_raw),
    name: normalizeText(role.name),
    prompt: normalizeText(role.prompt),
    prompt_female: normalizeText(role.prompt_female),
    prompt_male: normalizeText(role.prompt_male),
    qufen_xingbie: Boolean(role.qufen_xingbie),
    selected: false,
    xingge: normalizeText(role.xingge),
    zhiye: normalizeText(role.zhiye)
  }

  initializeImportantRoleState(draftRole)
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
  if (error && typeof error === "object") {
    const responseError = error as {
      data?: {
        error?: {
          message?: string
        }
      }
      message?: string
      statusMessage?: string
    }

    const apiMessage = responseError.data?.error?.message?.trim()

    if (apiMessage) {
      return apiMessage
    }

    if (typeof responseError.message === "string" && responseError.message.trim()) {
      return responseError.message
    }

    if (typeof responseError.statusMessage === "string" && responseError.statusMessage.trim()) {
      return responseError.statusMessage
    }
  }

  return error instanceof Error ? error.message : fallback
}

function getPromptPreview(prompt: string) {
  const trimmedPrompt = prompt.trim()
  return trimmedPrompt ? trimmedPrompt.slice(0, 48) : "编辑提示词"
}

function applyRoleAiDraft(
  target: RoleAiDraft,
  source: {
    compress_quality_1?: number
    compress_quality_2?: number
    global_prompt?: string
    height?: number
    width?: number
  }
) {
  target.globalPrompt = normalizeText(source.global_prompt)
  target.imageWidthText = String(source.width ?? 1536)
  target.imageHeightText = String(source.height ?? 1024)
  target.compressQuality1Text = String(source.compress_quality_1 ?? 60)
  target.compressQuality2Text = String(source.compress_quality_2 ?? 30)
}

function getActiveAiDraft() {
  return activeTab.value === "normal" ? draft.normalAi : draft.importantAi
}

function syncDraft(roles: StoryRolesFile) {
  resetStates()
  applyRoleAiDraft(draft.normalAi, roles.normal.ai)
  applyRoleAiDraft(draft.importantAi, roles.important.ai)
  draft.normalRoles = roles.normal.roles.map(cloneNormalRole)
  draft.importantRoles = roles.important.roles.map(cloneImportantRole)
  void hydrateAssetMeta()
}

async function loadAssetMeta(
  draftKey: string,
  assetPath: string,
  mode: ImportantRoleImageMode = "common",
  variant: ImageVariant = "raw"
) {
  const state = getAssetState(draftKey, mode, variant)
  const trimmedPath = assetPath.trim()

  state.error = null

  if (!trimmedPath) {
    state.loading = false
    state.meta = null
    return
  }

  state.loading = true

  try {
    const asset = await getStoryAssetMeta(props.storyId, trimmedPath)
    state.meta = asset
  } catch (error) {
    state.meta = null
    state.error = formatErrorMessage(error, "读取图片信息失败。")
  } finally {
    state.loading = false
  }
}

async function hydrateAssetMeta() {
  const tasks: Promise<void>[] = []

  for (const role of draft.normalRoles) {
    for (const variant of imageVariants) {
      tasks.push(loadAssetMeta(role.draftKey, getNormalAssetPath(role, variant), "common", variant))
    }
  }

  for (const role of draft.importantRoles) {
    if (role.qufen_xingbie) {
      for (const variant of imageVariants) {
        tasks.push(loadAssetMeta(role.draftKey, getImportantAssetPath(role, "male", variant), "male", variant))
        tasks.push(loadAssetMeta(role.draftKey, getImportantAssetPath(role, "female", variant), "female", variant))
      }
      continue
    }

    for (const variant of imageVariants) {
      tasks.push(loadAssetMeta(role.draftKey, getImportantAssetPath(role, "common", variant), "common", variant))
    }
  }

  await Promise.allSettled(tasks)
}

function getImageVariantLabel(variant: ImageVariant) {
  if (variant === "raw") return "原图"
  if (variant === "compress1") return "压缩图1"
  return "压缩图2"
}

function getRoleImageModeLabel(mode: ImportantRoleImageMode) {
  if (mode === "male") return "男图"
  if (mode === "female") return "女图"
  return "通用图"
}

function getImagePreviewTitle(
  name: string,
  variant: ImageVariant,
  mode?: ImportantRoleImageMode
) {
  const trimmedName = name.trim() || "角色"
  const suffix = mode ? `${getRoleImageModeLabel(mode)} ${getImageVariantLabel(variant)}` : getImageVariantLabel(variant)
  return `${trimmedName} ${suffix}`
}

function getNormalAssetPath(role: NormalRoleDraft, variant: ImageVariant) {
  if (variant === "compress1") return role.img_compress_1.trim()
  if (variant === "compress2") return role.img_compress_2.trim()
  return role.img_raw.trim()
}

function setNormalAssetPath(role: NormalRoleDraft, variant: ImageVariant, assetPath: string) {
  if (variant === "compress1") {
    role.img_compress_1 = assetPath
    return
  }

  if (variant === "compress2") {
    role.img_compress_2 = assetPath
    return
  }

  role.img_raw = assetPath
}

function getNormalAssetUrl(role: NormalRoleDraft, variant: ImageVariant) {
  const assetPath = getNormalAssetPath(role, variant)
  return assetPath ? getStoryAssetUrl(props.storyId, assetPath) : ""
}

function getImportantAssetPath(
  role: ImportantRoleDraft,
  mode: ImportantRoleImageMode,
  variant: ImageVariant
) {
  if (mode === "male") {
    if (variant === "compress1") return role.img_male_compress_1.trim()
    if (variant === "compress2") return role.img_male_compress_2.trim()
    return role.img_male_raw.trim()
  }

  if (mode === "female") {
    if (variant === "compress1") return role.img_female_compress_1.trim()
    if (variant === "compress2") return role.img_female_compress_2.trim()
    return role.img_female_raw.trim()
  }

  if (variant === "compress1") return role.img_compress_1.trim()
  if (variant === "compress2") return role.img_compress_2.trim()
  return role.img_raw.trim()
}

function setImportantAssetPath(
  role: ImportantRoleDraft,
  mode: ImportantRoleImageMode,
  variant: ImageVariant,
  assetPath: string
) {
  if (mode === "male") {
    if (variant === "compress1") {
      role.img_male_compress_1 = assetPath
      return
    }

    if (variant === "compress2") {
      role.img_male_compress_2 = assetPath
      return
    }

    role.img_male_raw = assetPath
    return
  }

  if (mode === "female") {
    if (variant === "compress1") {
      role.img_female_compress_1 = assetPath
      return
    }

    if (variant === "compress2") {
      role.img_female_compress_2 = assetPath
      return
    }

    role.img_female_raw = assetPath
    return
  }

  if (variant === "compress1") {
    role.img_compress_1 = assetPath
    return
  }

  if (variant === "compress2") {
    role.img_compress_2 = assetPath
    return
  }

  role.img_raw = assetPath
}

function getImportantAssetUrl(
  role: ImportantRoleDraft,
  mode: ImportantRoleImageMode,
  variant: ImageVariant
) {
  const assetPath = getImportantAssetPath(role, mode, variant)
  return assetPath ? getStoryAssetUrl(props.storyId, assetPath) : ""
}

function openImagePreview(title: string, assetPath: string) {
  const trimmedPath = assetPath.trim()

  if (!trimmedPath) return

  imagePreviewState.path = trimmedPath
  imagePreviewState.title = title
  imagePreviewState.url = getStoryAssetUrl(props.storyId, trimmedPath)
}

function closeImagePreview() {
  imagePreviewState.path = ""
  imagePreviewState.title = ""
  imagePreviewState.url = ""
}

function getImportantRolePrompt(role: ImportantRoleDraft, mode: ImportantRoleImageMode) {
  if (mode === "male") return role.prompt_male.trim()
  if (mode === "female") return role.prompt_female.trim()
  return role.prompt.trim()
}

function setImportantRolePrompt(
  role: ImportantRoleDraft,
  mode: ImportantRoleImageMode,
  prompt: string
) {
  if (mode === "male") {
    role.prompt_male = prompt
    return
  }

  if (mode === "female") {
    role.prompt_female = prompt
    return
  }

  role.prompt = prompt
}

function getNextDefaultName(target: RolesTab) {
  const source = target === "normal" ? draft.normalRoles : draft.importantRoles
  const prefix = target === "normal" ? "normal_role" : "important_role"
  const usedNames = new Set(source.map((role) => role.name.trim()).filter(Boolean))

  let index = source.length + 1
  let candidate = `${prefix}_${index}`

  while (usedNames.has(candidate)) {
    index += 1
    candidate = `${prefix}_${index}`
  }

  return candidate
}

function addNormalRole() {
  const role: NormalRoleDraft = {
    descr: "",
    draftKey: createDraftKey("normal-role"),
    img_compress_1: "",
    img_compress_2: "",
    img_raw: "",
    name: getNextDefaultName("normal"),
    prompt: "",
    selected: false,
    zhiye: ""
  }

  initializeNormalRoleState(role)
  draft.normalRoles.push(role)
}

function addImportantRole() {
  const role: ImportantRoleDraft = {
    descr: "",
    descr_female: "",
    descr_male: "",
    draftKey: createDraftKey("important-role"),
    img_compress_1: "",
    img_compress_2: "",
    img_female_compress_1: "",
    img_female_compress_2: "",
    img_female_raw: "",
    img_male_compress_1: "",
    img_male_compress_2: "",
    img_male_raw: "",
    img_raw: "",
    name: getNextDefaultName("important"),
    prompt: "",
    prompt_female: "",
    prompt_male: "",
    qufen_xingbie: false,
    selected: false,
    xingge: "",
    zhiye: ""
  }

  initializeImportantRoleState(role)
  draft.importantRoles.push(role)
}

function removeNormalRole(index: number) {
  const role = draft.normalRoles[index]
  if (!role) return
  clearRoleState(role.draftKey)
  draft.normalRoles.splice(index, 1)
}

function removeImportantRole(index: number) {
  const role = draft.importantRoles[index]
  if (!role) return
  clearRoleState(role.draftKey)
  draft.importantRoles.splice(index, 1)
}

function openPromptEditor(
  draftKey: string,
  prompt: string,
  mode: ImportantRoleImageMode = "common"
) {
  promptEditorState.mode = mode
  promptEditorState.roleKey = draftKey
  promptEditorState.value = prompt
}

function closePromptEditor() {
  promptEditorState.mode = "common"
  promptEditorState.roleKey = null
  promptEditorState.value = ""
}

function savePromptEditor() {
  if (!promptEditorState.roleKey) {
    closePromptEditor()
    return
  }

  const normalRole = draft.normalRoles.find((role) => role.draftKey === promptEditorState.roleKey)
  if (normalRole) {
    normalRole.prompt = promptEditorState.value.trim()
    closePromptEditor()
    return
  }

  const importantRole = draft.importantRoles.find(
    (role) => role.draftKey === promptEditorState.roleKey
  )
  if (importantRole) {
    setImportantRolePrompt(importantRole, promptEditorState.mode, promptEditorState.value.trim())
  }

  closePromptEditor()
}

const normalRoleCount = computed(() => draft.normalRoles.length)
const importantRoleCount = computed(() => draft.importantRoles.length)

const activeRoleCount = computed(() =>
  activeTab.value === "normal" ? normalRoleCount.value : importantRoleCount.value
)

const activeSelectedCount = computed(() =>
  activeTab.value === "normal"
    ? draft.normalRoles.filter((role) => role.selected).length
    : draft.importantRoles.filter((role) => role.selected).length
)

const allSelected = computed({
  get: () => activeRoleCount.value > 0 && activeSelectedCount.value === activeRoleCount.value,
  set: (checked: boolean) => {
    const source = activeTab.value === "normal" ? draft.normalRoles : draft.importantRoles
    for (const role of source) {
      role.selected = checked
    }
  }
})

const hasInvalidDraft = computed(() => {
  if (parseImageDimensionInput(draft.normalAi.imageWidthText) === null) return true
  if (parseImageDimensionInput(draft.normalAi.imageHeightText) === null) return true
  if (parseImageDimensionInput(draft.importantAi.imageWidthText) === null) return true
  if (parseImageDimensionInput(draft.importantAi.imageHeightText) === null) return true
  if (parseCompressQualityInput(draft.normalAi.compressQuality1Text) === null) return true
  if (parseCompressQualityInput(draft.normalAi.compressQuality2Text) === null) return true
  if (parseCompressQualityInput(draft.importantAi.compressQuality1Text) === null) return true
  if (parseCompressQualityInput(draft.importantAi.compressQuality2Text) === null) return true

  return (
    [...draft.normalRoles, ...draft.importantRoles].some((role) => !sanitizeNameInput(role.name))
  )
})

const hasActiveSelection = computed(() => activeSelectedCount.value > 0)
const isBatchRunning = computed(
  () =>
    batchState.generatingPrompts
    || batchState.generatingCommonImages
    || batchState.generatingMaleImages
    || batchState.generatingFemaleImages
    || batchState.compressing1
    || batchState.compressing2
)

const canBatchGeneratePrompts = computed(() => {
  if (!hasActiveSelection.value || isBatchRunning.value) {
    return false
  }

  return activeTab.value === "normal"
    ? draft.normalRoles.some((role) => role.selected && role.descr.trim())
    : draft.importantRoles.some(
        (role) =>
          role.selected
          && (role.qufen_xingbie
            ? role.descr_male.trim() || role.descr_female.trim()
            : role.descr.trim())
      )
})

const canBatchGenerateImages = computed(() => {
  const activeAiDraft = getActiveAiDraft()
  if (
    !hasActiveSelection.value
    || isBatchRunning.value
    || parseImageDimensionInput(activeAiDraft.imageWidthText) === null
    || parseImageDimensionInput(activeAiDraft.imageHeightText) === null
  ) {
    return false
  }

  return activeTab.value === "normal"
    ? draft.normalRoles.some((role) => role.selected && role.prompt.trim())
    : draft.importantRoles.some(
        (role) => role.selected && !role.qufen_xingbie && role.prompt.trim()
      )
})

const canBatchGenerateMaleImages = computed(() => {
  if (
    activeTab.value !== "important"
    || !hasActiveSelection.value
    || isBatchRunning.value
    || parseImageDimensionInput(draft.importantAi.imageWidthText) === null
    || parseImageDimensionInput(draft.importantAi.imageHeightText) === null
  ) {
    return false
  }

  return draft.importantRoles.some(
    (role) => role.selected && role.qufen_xingbie && role.prompt_male.trim()
  )
})

const canBatchGenerateFemaleImages = computed(() => {
  if (
    activeTab.value !== "important"
    || !hasActiveSelection.value
    || isBatchRunning.value
    || parseImageDimensionInput(draft.importantAi.imageWidthText) === null
    || parseImageDimensionInput(draft.importantAi.imageHeightText) === null
  ) {
    return false
  }

  return draft.importantRoles.some(
    (role) => role.selected && role.qufen_xingbie && role.prompt_female.trim()
  )
})

function hasNormalRawAsset(role: NormalRoleDraft) {
  return role.img_raw.trim().length > 0
}

function hasImportantRawAsset(role: ImportantRoleDraft) {
  if (role.qufen_xingbie) {
    return Boolean(role.img_male_raw.trim() || role.img_female_raw.trim())
  }

  return role.img_raw.trim().length > 0
}

const canBatchCompressImages1 = computed(() => {
  if (!hasActiveSelection.value || isBatchRunning.value) {
    return false
  }

  return activeTab.value === "normal"
    ? draft.normalRoles.some((role) => role.selected && hasNormalRawAsset(role))
    : draft.importantRoles.some((role) => role.selected && hasImportantRawAsset(role))
})

const canBatchCompressImages2 = computed(() => {
  if (!hasActiveSelection.value || isBatchRunning.value) {
    return false
  }

  return activeTab.value === "normal"
    ? draft.normalRoles.some((role) => role.selected && hasNormalRawAsset(role))
    : draft.importantRoles.some((role) => role.selected && hasImportantRawAsset(role))
})

async function handleGenerateNormalPrompt(role: NormalRoleDraft) {
  const state = getPromptState(role.draftKey)
  state.error = null
  state.loading = true

  try {
    role.prompt = await generateRolePrompt(props.storyId, {
      descr: role.descr,
      gender: "common",
      important: false,
      qufenXingbie: false,
      roleName: role.name,
      storyTitle: props.storyTitle
    })
  } catch (error) {
    state.error = formatErrorMessage(error, "生成提示词失败。")
  } finally {
    state.loading = false
  }
}

async function handleGenerateImportantPrompt(role: ImportantRoleDraft) {
  const state = getPromptState(role.draftKey)
  state.error = null
  state.loading = true

  try {
    if (role.qufen_xingbie) {
      const maleDescr = role.descr_male.trim()
      const femaleDescr = role.descr_female.trim()

      const [malePrompt, femalePrompt] = await Promise.all([
        maleDescr
          ? generateRolePrompt(props.storyId, {
              descr: maleDescr,
              gender: "male",
              important: true,
              qufenXingbie: true,
              roleName: role.name,
              storyTitle: props.storyTitle,
              xingge: role.xingge
            })
          : Promise.resolve(""),
        femaleDescr
          ? generateRolePrompt(props.storyId, {
              descr: femaleDescr,
              gender: "female",
              important: true,
              qufenXingbie: true,
              roleName: role.name,
              storyTitle: props.storyTitle,
              xingge: role.xingge
            })
          : Promise.resolve("")
      ])

      role.prompt = ""
      role.prompt_male = malePrompt
      role.prompt_female = femalePrompt
      return
    }

    role.prompt = await generateRolePrompt(props.storyId, {
      descr: role.descr,
      gender: "common",
      important: true,
      qufenXingbie: false,
      roleName: role.name,
      storyTitle: props.storyTitle,
      xingge: role.xingge
    })
    role.prompt_male = ""
    role.prompt_female = ""
  } catch (error) {
    state.error = formatErrorMessage(error, "生成提示词失败。")
  } finally {
    state.loading = false
  }
}

async function handleGenerateNormalImage(role: NormalRoleDraft) {
  const state = getAssetState(role.draftKey, "common", "raw")
  state.error = null
  state.loading = true
  const aiDraft = draft.normalAi

  try {
    const asset = await generateRoleImage(props.storyId, {
      gender: "common",
      globalPrompt: aiDraft.globalPrompt,
      width: parseImageDimensionInput(aiDraft.imageWidthText) ?? 1536,
      height: parseImageDimensionInput(aiDraft.imageHeightText) ?? 1024,
      prompt: role.prompt,
      targetName: sanitizeNameInput(role.name) || "normal_role"
    })

    setNormalAssetPath(role, "raw", asset.assetPath)
    state.meta = asset
  } catch (error) {
    state.error = formatErrorMessage(error, "生成图片失败。")
  } finally {
    state.loading = false
  }
}

async function handleCompressNormalImage(role: NormalRoleDraft, slot: 1 | 2) {
  const variant: ImageVariant = slot === 1 ? "compress1" : "compress2"
  const state = getAssetState(role.draftKey, "common", variant)
  state.error = null
  state.loading = true
  const aiDraft = draft.normalAi

  try {
    const asset = await compressRoleImage(props.storyId, {
      quality:
        parseCompressQualityInput(
          slot === 1 ? aiDraft.compressQuality1Text : aiDraft.compressQuality2Text
        ) ?? (slot === 1 ? 60 : 30),
      slot,
      sourcePath: role.img_raw,
      targetName: sanitizeNameInput(role.name) || "normal_role"
    })

    setNormalAssetPath(role, variant, asset.assetPath)
    state.meta = asset
  } catch (error) {
    state.error = formatErrorMessage(error, `压缩图片${slot}失败。`)
  } finally {
    state.loading = false
  }
}

function getImportantImageTargetName(role: ImportantRoleDraft, mode: ImportantRoleImageMode) {
  const baseName = sanitizeNameInput(role.name) || "important_role"
  if (mode === "male") return `${baseName}_male`
  if (mode === "female") return `${baseName}_female`
  return baseName
}

async function handleGenerateImportantImage(
  role: ImportantRoleDraft,
  mode: ImportantRoleImageMode
) {
  const state = getAssetState(role.draftKey, mode, "raw")
  state.error = null
  state.loading = true
  const aiDraft = draft.importantAi

  try {
    const asset = await generateRoleImage(props.storyId, {
      gender: mode,
      globalPrompt: aiDraft.globalPrompt,
      width: parseImageDimensionInput(aiDraft.imageWidthText) ?? 1536,
      height: parseImageDimensionInput(aiDraft.imageHeightText) ?? 1024,
      prompt: getImportantRolePrompt(role, mode),
      targetName: getImportantImageTargetName(role, mode)
    })

    setImportantAssetPath(role, mode, "raw", asset.assetPath)
    state.meta = asset
  } catch (error) {
    state.error = formatErrorMessage(error, `生成${getRoleImageModeLabel(mode)}失败。`)
  } finally {
    state.loading = false
  }
}

async function handleCompressImportantImage(
  role: ImportantRoleDraft,
  mode: ImportantRoleImageMode,
  slot: 1 | 2
) {
  const variant: ImageVariant = slot === 1 ? "compress1" : "compress2"
  const state = getAssetState(role.draftKey, mode, variant)
  state.error = null
  state.loading = true
  const aiDraft = draft.importantAi

  try {
    const asset = await compressRoleImage(props.storyId, {
      quality:
        parseCompressQualityInput(
          slot === 1 ? aiDraft.compressQuality1Text : aiDraft.compressQuality2Text
        ) ?? (slot === 1 ? 60 : 30),
      slot,
      sourcePath: getImportantAssetPath(role, mode, "raw"),
      targetName: getImportantImageTargetName(role, mode)
    })

    setImportantAssetPath(role, mode, variant, asset.assetPath)
    state.meta = asset
  } catch (error) {
    state.error = formatErrorMessage(error, `压缩${getRoleImageModeLabel(mode)}${slot}失败。`)
  } finally {
    state.loading = false
  }
}

async function handleBatchGeneratePrompts() {
  if (activeTab.value === "normal") {
    const roles = draft.normalRoles.filter((role) => role.selected && role.descr.trim())
    if (!roles.length) return

    batchState.generatingPrompts = true
    batchState.promptDone = 0
    batchState.promptTotal = roles.length

    try {
      for (const role of roles) {
        await handleGenerateNormalPrompt(role)
        batchState.promptDone += 1
      }
    } finally {
      batchState.generatingPrompts = false
    }

    return
  }

  const roles = draft.importantRoles.filter(
    (role) =>
      role.selected
      && (role.qufen_xingbie
        ? role.descr_male.trim() || role.descr_female.trim()
        : role.descr.trim())
  )
  if (!roles.length) return

  batchState.generatingPrompts = true
  batchState.promptDone = 0
  batchState.promptTotal = roles.length

  try {
    for (const role of roles) {
      await handleGenerateImportantPrompt(role)
      batchState.promptDone += 1
    }
  } finally {
    batchState.generatingPrompts = false
  }
}

async function handleBatchGenerateImages(mode: ImportantRoleImageMode = "common") {
  if (activeTab.value === "normal") {
    const roles = draft.normalRoles.filter((role) => role.selected && role.prompt.trim())
    if (
      !roles.length
      || parseImageDimensionInput(draft.normalAi.imageWidthText) === null
      || parseImageDimensionInput(draft.normalAi.imageHeightText) === null
    ) {
      return
    }

    batchState.generatingCommonImages = true
    batchState.commonImageDone = 0
    batchState.commonImageTotal = roles.length

    try {
      for (const role of roles) {
        await handleGenerateNormalImage(role)
        batchState.commonImageDone += 1
      }
    } finally {
      batchState.generatingCommonImages = false
    }

    return
  }

  const roles = draft.importantRoles.filter((role) => {
    if (!role.selected) return false
    if (mode === "common") return !role.qufen_xingbie && role.prompt.trim()
    if (mode === "male") return role.qufen_xingbie && role.prompt_male.trim()
    return role.qufen_xingbie && role.prompt_female.trim()
  })

  if (
    !roles.length
    || parseImageDimensionInput(draft.importantAi.imageWidthText) === null
    || parseImageDimensionInput(draft.importantAi.imageHeightText) === null
  ) {
    return
  }

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
      await handleGenerateImportantImage(role, mode)

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

async function handleBatchCompressImages(slot: 1 | 2) {
  if (activeTab.value === "normal") {
    const roles = draft.normalRoles.filter((role) => role.selected && role.img_raw.trim())
    if (!roles.length) return

    if (slot === 1) {
      batchState.compressing1 = true
      batchState.compress1Done = 0
      batchState.compress1Total = roles.length
    } else {
      batchState.compressing2 = true
      batchState.compress2Done = 0
      batchState.compress2Total = roles.length
    }

    try {
      for (const role of roles) {
        await handleCompressNormalImage(role, slot)
        if (slot === 1) {
          batchState.compress1Done += 1
        } else {
          batchState.compress2Done += 1
        }
      }
    } finally {
      if (slot === 1) {
        batchState.compressing1 = false
      } else {
        batchState.compressing2 = false
      }
    }

    return
  }

  const tasks: ImportantRoleImageTask[] = []

  for (const role of draft.importantRoles.filter((item) => item.selected)) {
    if (role.qufen_xingbie) {
      if (role.img_male_raw.trim()) {
        tasks.push({ mode: "male", role })
      }

      if (role.img_female_raw.trim()) {
        tasks.push({ mode: "female", role })
      }
      continue
    }

    if (role.img_raw.trim()) {
      tasks.push({ mode: "common", role })
    }
  }

  if (!tasks.length) return

  if (slot === 1) {
    batchState.compressing1 = true
    batchState.compress1Done = 0
    batchState.compress1Total = tasks.length
  } else {
    batchState.compressing2 = true
    batchState.compress2Done = 0
    batchState.compress2Total = tasks.length
  }

  try {
    for (const task of tasks) {
      await handleCompressImportantImage(task.role, task.mode, slot)
      if (slot === 1) {
        batchState.compress1Done += 1
      } else {
        batchState.compress2Done += 1
      }
    }
  } finally {
    if (slot === 1) {
      batchState.compressing1 = false
    } else {
      batchState.compressing2 = false
    }
  }
}

function submitDraft() {
  emit("save", {
    important: {
      ai: {
        compress_quality_1: parseCompressQualityInput(draft.importantAi.compressQuality1Text) ?? 60,
        compress_quality_2: parseCompressQualityInput(draft.importantAi.compressQuality2Text) ?? 30,
        global_prompt: draft.importantAi.globalPrompt.trim(),
        height: parseImageDimensionInput(draft.importantAi.imageHeightText) ?? 1024,
        width: parseImageDimensionInput(draft.importantAi.imageWidthText) ?? 1536
      },
      roles: draft.importantRoles.map((role) => {
        const isSplitByGender = role.qufen_xingbie

        return {
          descr: isSplitByGender ? "" : role.descr.trim(),
          descr_female: isSplitByGender ? role.descr_female.trim() : "",
          descr_male: isSplitByGender ? role.descr_male.trim() : "",
          img_compress_1: isSplitByGender ? "" : role.img_compress_1.trim(),
          img_compress_2: isSplitByGender ? "" : role.img_compress_2.trim(),
          img_female_compress_1: isSplitByGender ? role.img_female_compress_1.trim() : "",
          img_female_compress_2: isSplitByGender ? role.img_female_compress_2.trim() : "",
          img_female_raw: isSplitByGender ? role.img_female_raw.trim() : "",
          img_male_compress_1: isSplitByGender ? role.img_male_compress_1.trim() : "",
          img_male_compress_2: isSplitByGender ? role.img_male_compress_2.trim() : "",
          img_male_raw: isSplitByGender ? role.img_male_raw.trim() : "",
          img_raw: isSplitByGender ? "" : role.img_raw.trim(),
          name: sanitizeNameInput(role.name),
          prompt: isSplitByGender ? "" : role.prompt.trim(),
          prompt_female: isSplitByGender ? role.prompt_female.trim() : "",
          prompt_male: isSplitByGender ? role.prompt_male.trim() : "",
          qufen_xingbie: isSplitByGender,
          xingge: role.xingge.trim(),
          zhiye: role.zhiye.trim()
        }
      })
    },
    normal: {
      ai: {
        compress_quality_1: parseCompressQualityInput(draft.normalAi.compressQuality1Text) ?? 60,
        compress_quality_2: parseCompressQualityInput(draft.normalAi.compressQuality2Text) ?? 30,
        global_prompt: draft.normalAi.globalPrompt.trim(),
        height: parseImageDimensionInput(draft.normalAi.imageHeightText) ?? 1024,
        width: parseImageDimensionInput(draft.normalAi.imageWidthText) ?? 1536
      },
      roles: draft.normalRoles.map((role) => ({
        descr: role.descr.trim(),
        img_compress_1: role.img_compress_1.trim(),
        img_compress_2: role.img_compress_2.trim(),
        img_raw: role.img_raw.trim(),
        name: sanitizeNameInput(role.name),
        prompt: role.prompt.trim(),
        zhiye: role.zhiye.trim()
      }))
    }
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
            <button class="btn-primary" type="button" :disabled="saving || hasInvalidDraft" @click="submitDraft">
              {{ saving ? "保存中..." : "保存" }}
            </button>
          </div>
        </div>

        <div class="roles-dialog__body">
          <div v-if="props.saveSuccessMessage" class="roles-dialog__success">
            {{ props.saveSuccessMessage }}
          </div>

          <div class="roles-dialog__tabs">
            <button
              class="roles-dialog__tab"
              :class="{ 'roles-dialog__tab--active': activeTab === 'normal' }"
              type="button"
              @click="activeTab = 'normal'"
            >
              普通角色（{{ normalRoleCount }}）
            </button>
            <button
              class="roles-dialog__tab"
              :class="{ 'roles-dialog__tab--active': activeTab === 'important' }"
              type="button"
              @click="activeTab = 'important'"
            >
              重要角色（{{ importantRoleCount }}）
            </button>
          </div>

          <div class="roles-dialog__toolbar">
            <div class="roles-dialog__count">
              当前{{ activeTab === "normal" ? "普通角色" : "重要角色" }}数量：{{ activeRoleCount }}，已选择：{{ activeSelectedCount }}
            </div>

            <div class="roles-dialog__batch-actions">
              <label class="roles-dialog__select-all">
                <input v-model="allSelected" type="checkbox" />
                <span>全选</span>
              </label>

              <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="!canBatchGeneratePrompts" @click="handleBatchGeneratePrompts">
                {{
                  batchState.generatingPrompts
                    ? `批量生成中 ${batchState.promptDone}/${batchState.promptTotal}`
                    : "批量生成提示词"
                }}
              </button>

              <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="!canBatchGenerateImages" @click="handleBatchGenerateImages('common')">
                {{
                  batchState.generatingCommonImages
                    ? `批量生图中 ${batchState.commonImageDone}/${batchState.commonImageTotal}`
                    : "批量生成通用原图"
                }}
              </button>

              <button
                v-if="activeTab === 'important'"
                class="btn-secondary roles-dialog__row-button"
                type="button"
                :disabled="!canBatchGenerateMaleImages"
                @click="handleBatchGenerateImages('male')"
              >
                {{
                  batchState.generatingMaleImages
                    ? `男图生成中 ${batchState.maleImageDone}/${batchState.maleImageTotal}`
                    : "批量生成男原图"
                }}
              </button>

              <button
                v-if="activeTab === 'important'"
                class="btn-secondary roles-dialog__row-button"
                type="button"
                :disabled="!canBatchGenerateFemaleImages"
                @click="handleBatchGenerateImages('female')"
              >
                {{
                  batchState.generatingFemaleImages
                    ? `女图生成中 ${batchState.femaleImageDone}/${batchState.femaleImageTotal}`
                    : "批量生成女原图"
                }}
              </button>

              <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="!canBatchCompressImages1" @click="handleBatchCompressImages(1)">
                {{
                  batchState.compressing1
                    ? `批量压缩1中 ${batchState.compress1Done}/${batchState.compress1Total}`
                    : "批量压缩到1"
                }}
              </button>

              <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="!canBatchCompressImages2" @click="handleBatchCompressImages(2)">
                {{
                  batchState.compressing2
                    ? `批量压缩2中 ${batchState.compress2Done}/${batchState.compress2Total}`
                    : "批量压缩到2"
                }}
              </button>
            </div>
          </div>

          <div v-if="activeTab === 'normal'" class="roles-dialog__section">
            <section class="roles-dialog__config">
              <div class="roles-dialog__config-head">
                <h3 class="roles-dialog__config-title">普通角色 AI 工具配置</h3>
              </div>

              <div class="roles-dialog__config-grid">
                <label class="roles-dialog__field">
                  <span class="roles-dialog__label">图片宽度</span>
                  <input v-model="draft.normalAi.imageWidthText" class="text-input" type="number" min="1" step="1" placeholder="1536" />
                </label>

                <label class="roles-dialog__field">
                  <span class="roles-dialog__label">图片高度</span>
                  <input v-model="draft.normalAi.imageHeightText" class="text-input" type="number" min="1" step="1" placeholder="1024" />
                </label>

                <label class="roles-dialog__field">
                  <span class="roles-dialog__label">压缩质量1</span>
                  <input
                    v-model="draft.normalAi.compressQuality1Text"
                    class="text-input"
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    placeholder="60"
                  />
                </label>

                <label class="roles-dialog__field">
                  <span class="roles-dialog__label">压缩质量2</span>
                  <input
                    v-model="draft.normalAi.compressQuality2Text"
                    class="text-input"
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    placeholder="30"
                  />
                </label>

                <label class="roles-dialog__field roles-dialog__field--wide">
                  <span class="roles-dialog__label">整体提示词</span>
                  <textarea
                    v-model="draft.normalAi.globalPrompt"
                    class="text-input roles-dialog__textarea"
                    rows="3"
                    placeholder="统一风格、时代背景、镜头语言、材质倾向等"
                  />
                </label>
              </div>
            </section>

            <div class="roles-dialog__table-wrap">
              <table class="roles-dialog__table">
                <thead>
                  <tr>
                    <th class="roles-dialog__select-col">选择</th>
                    <th>名称</th>
                    <th>职业</th>
                    <th>描述</th>
                    <th>提示词</th>
                    <th>图片</th>
                    <th>AI 操作</th>
                    <th class="roles-dialog__actions-col">操作</th>
                  </tr>
                </thead>
                <tbody v-if="draft.normalRoles.length">
                  <tr v-for="(role, index) in draft.normalRoles" :key="role.draftKey">
                    <td class="roles-dialog__select-col">
                      <input v-model="role.selected" type="checkbox" />
                    </td>
                    <td>
                      <input v-model="role.name" class="text-input roles-dialog__cell-input" type="text" placeholder="villager_old_man" />
                    </td>
                    <td>
                      <input v-model="role.zhiye" class="text-input roles-dialog__cell-input" type="text" placeholder="算命先生" />
                    </td>
                    <td>
                      <textarea
                        v-model="role.descr"
                        class="text-input roles-dialog__textarea roles-dialog__textarea--cell"
                        rows="3"
                        placeholder="普通路人，朴素布衣，生活气息"
                      />
                    </td>
                    <td>
                      <div class="roles-dialog__prompt-cell">
                        <button class="roles-dialog__prompt-link" type="button" @click="openPromptEditor(role.draftKey, role.prompt)">
                          {{ getPromptPreview(role.prompt) }}
                        </button>
                        <span v-if="getPromptState(role.draftKey).loading" class="roles-dialog__prompt-status">生成中...</span>
                        <span v-if="getPromptState(role.draftKey).error" class="roles-dialog__prompt-error">
                          {{ getPromptState(role.draftKey).error }}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div class="roles-dialog__asset-grid">
                        <div v-for="variant in imageVariants" :key="variant" class="roles-dialog__asset-card">
                          <span class="roles-dialog__asset-title">{{ getImageVariantLabel(variant) }}</span>
                          <button
                            v-if="variant === 'raw' && getNormalAssetPath(role, variant)"
                            class="roles-dialog__asset-thumb-button"
                            type="button"
                            @click="openImagePreview(getImagePreviewTitle(role.name, variant), getNormalAssetPath(role, variant))"
                          >
                            <img
                              class="roles-dialog__asset-thumb"
                              :src="getNormalAssetUrl(role, variant)"
                              :alt="`${role.name || '角色'} ${getImageVariantLabel(variant)} 缩略图`"
                              loading="lazy"
                            />
                          </button>
                          <a v-if="getNormalAssetPath(role, variant)" class="roles-dialog__asset-link" :href="getNormalAssetUrl(role, variant)" target="_blank" rel="noreferrer">
                            {{ getNormalAssetPath(role, variant) }}
                          </a>
                          <span v-else class="roles-dialog__asset-empty">暂无图片</span>
                          <span v-if="formatAssetMeta(getAssetState(role.draftKey, 'common', variant).meta)" class="roles-dialog__asset-meta">
                            {{ formatAssetMeta(getAssetState(role.draftKey, 'common', variant).meta) }}
                          </span>
                          <span v-if="getAssetState(role.draftKey, 'common', variant).loading" class="roles-dialog__asset-status">处理中...</span>
                          <span v-if="getAssetState(role.draftKey, 'common', variant).error" class="roles-dialog__asset-error">
                            {{ getAssetState(role.draftKey, 'common', variant).error }}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div class="roles-dialog__action-stack">
                        <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getPromptState(role.draftKey).loading || !role.descr.trim()" @click="handleGenerateNormalPrompt(role)">
                          生成提示词
                        </button>
                        <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getAssetState(role.draftKey, 'common', 'raw').loading || !role.prompt.trim() || parseImageDimensionInput(draft.normalAi.imageWidthText) === null || parseImageDimensionInput(draft.normalAi.imageHeightText) === null" @click="handleGenerateNormalImage(role)">
                          生成原图
                        </button>
                        <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getAssetState(role.draftKey, 'common', 'compress1').loading || !role.img_raw.trim()" @click="handleCompressNormalImage(role, 1)">
                          压缩到1
                        </button>
                        <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getAssetState(role.draftKey, 'common', 'compress2').loading || !role.img_raw.trim()" @click="handleCompressNormalImage(role, 2)">
                          压缩到2
                        </button>
                      </div>
                    </td>
                    <td class="roles-dialog__actions-col">
                      <button class="btn-secondary roles-dialog__row-button" type="button" @click="removeNormalRole(index)">删除</button>
                    </td>
                  </tr>
                </tbody>
              </table>

              <div v-if="!draft.normalRoles.length" class="roles-dialog__empty">
                还没有普通角色，先添加一行。
              </div>
            </div>
          </div>

          <div v-else class="roles-dialog__section">
            <section class="roles-dialog__config">
              <div class="roles-dialog__config-head">
                <h3 class="roles-dialog__config-title">重要角色 AI 工具配置</h3>
              </div>

              <div class="roles-dialog__config-grid">
                <label class="roles-dialog__field">
                  <span class="roles-dialog__label">图片宽度</span>
                  <input v-model="draft.importantAi.imageWidthText" class="text-input" type="number" min="1" step="1" placeholder="1536" />
                </label>

                <label class="roles-dialog__field">
                  <span class="roles-dialog__label">图片高度</span>
                  <input v-model="draft.importantAi.imageHeightText" class="text-input" type="number" min="1" step="1" placeholder="1024" />
                </label>

                <label class="roles-dialog__field">
                  <span class="roles-dialog__label">压缩质量1</span>
                  <input
                    v-model="draft.importantAi.compressQuality1Text"
                    class="text-input"
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    placeholder="60"
                  />
                </label>

                <label class="roles-dialog__field">
                  <span class="roles-dialog__label">压缩质量2</span>
                  <input
                    v-model="draft.importantAi.compressQuality2Text"
                    class="text-input"
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    placeholder="30"
                  />
                </label>

                <label class="roles-dialog__field roles-dialog__field--wide">
                  <span class="roles-dialog__label">整体提示词</span>
                  <textarea
                    v-model="draft.importantAi.globalPrompt"
                    class="text-input roles-dialog__textarea"
                    rows="3"
                    placeholder="统一风格、时代背景、镜头语言、材质倾向等"
                  />
                </label>
              </div>
            </section>

            <div class="roles-dialog__table-wrap">
              <table class="roles-dialog__table">
                <thead>
                  <tr>
                    <th class="roles-dialog__select-col">选择</th>
                    <th>名称</th>
                    <th>职业</th>
                    <th>描述</th>
                    <th>性格</th>
                    <th>区分性别</th>
                    <th>提示词</th>
                    <th>图片</th>
                    <th>AI 操作</th>
                    <th class="roles-dialog__actions-col">操作</th>
                  </tr>
                </thead>
                <tbody v-if="draft.importantRoles.length">
                  <tr v-for="(role, index) in draft.importantRoles" :key="role.draftKey">
                    <td class="roles-dialog__select-col">
                      <input v-model="role.selected" type="checkbox" />
                    </td>
                    <td>
                      <input v-model="role.name" class="text-input roles-dialog__cell-input" type="text" placeholder="suanming_xiansheng" />
                    </td>
                    <td>
                      <input v-model="role.zhiye" class="text-input roles-dialog__cell-input" type="text" placeholder="县长" />
                    </td>
                    <td>
                      <div v-if="role.qufen_xingbie" class="roles-dialog__asset-group roles-dialog__asset-group--images">
                        <div class="roles-dialog__asset-card">
                          <span class="roles-dialog__asset-title">男描述</span>
                          <textarea
                            v-model="role.descr_male"
                            class="text-input roles-dialog__textarea roles-dialog__textarea--cell"
                            rows="3"
                            placeholder="男性角色描述"
                          />
                        </div>
                        <div class="roles-dialog__asset-card">
                          <span class="roles-dialog__asset-title">女描述</span>
                          <textarea
                            v-model="role.descr_female"
                            class="text-input roles-dialog__textarea roles-dialog__textarea--cell"
                            rows="3"
                            placeholder="女性角色描述"
                          />
                        </div>
                      </div>
                      <textarea
                        v-else
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
                      <select v-model="role.qufen_xingbie" class="text-input roles-dialog__select">
                        <option :value="false">否</option>
                        <option :value="true">是</option>
                      </select>
                    </td>
                    <td>
                      <div v-if="role.qufen_xingbie" class="roles-dialog__asset-group roles-dialog__asset-group--images">
                        <div class="roles-dialog__asset-card">
                          <span class="roles-dialog__asset-title">男提示词</span>
                          <button class="roles-dialog__prompt-link" type="button" @click="openPromptEditor(role.draftKey, role.prompt_male, 'male')">
                            {{ getPromptPreview(role.prompt_male) }}
                          </button>
                        </div>
                        <div class="roles-dialog__asset-card">
                          <span class="roles-dialog__asset-title">女提示词</span>
                          <button class="roles-dialog__prompt-link" type="button" @click="openPromptEditor(role.draftKey, role.prompt_female, 'female')">
                            {{ getPromptPreview(role.prompt_female) }}
                          </button>
                        </div>
                      </div>
                      <div v-else class="roles-dialog__prompt-cell">
                        <button class="roles-dialog__prompt-link" type="button" @click="openPromptEditor(role.draftKey, role.prompt)">
                          {{ getPromptPreview(role.prompt) }}
                        </button>
                      </div>
                      <div class="roles-dialog__prompt-cell">
                        <span v-if="getPromptState(role.draftKey).loading" class="roles-dialog__prompt-status">生成中...</span>
                        <span v-if="getPromptState(role.draftKey).error" class="roles-dialog__prompt-error">
                          {{ getPromptState(role.draftKey).error }}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div v-if="role.qufen_xingbie" class="roles-dialog__asset-group roles-dialog__asset-group--images">
                        <div class="roles-dialog__asset-set">
                          <span class="roles-dialog__asset-set-title">男图</span>
                          <div class="roles-dialog__asset-grid">
                            <div v-for="variant in imageVariants" :key="`male-${variant}`" class="roles-dialog__asset-card">
                              <span class="roles-dialog__asset-title">{{ getImageVariantLabel(variant) }}</span>
                              <button
                                v-if="variant === 'raw' && getImportantAssetPath(role, 'male', variant)"
                                class="roles-dialog__asset-thumb-button"
                                type="button"
                                @click="openImagePreview(getImagePreviewTitle(role.name, variant, 'male'), getImportantAssetPath(role, 'male', variant))"
                              >
                                <img
                                  class="roles-dialog__asset-thumb"
                                  :src="getImportantAssetUrl(role, 'male', variant)"
                                  :alt="`${role.name || '角色'} 男图 ${getImageVariantLabel(variant)} 缩略图`"
                                  loading="lazy"
                                />
                              </button>
                              <a v-if="getImportantAssetPath(role, 'male', variant)" class="roles-dialog__asset-link" :href="getImportantAssetUrl(role, 'male', variant)" target="_blank" rel="noreferrer">
                                {{ getImportantAssetPath(role, 'male', variant) }}
                              </a>
                              <span v-else class="roles-dialog__asset-empty">暂无图片</span>
                              <span v-if="formatAssetMeta(getAssetState(role.draftKey, 'male', variant).meta)" class="roles-dialog__asset-meta">
                                {{ formatAssetMeta(getAssetState(role.draftKey, 'male', variant).meta) }}
                              </span>
                              <span v-if="getAssetState(role.draftKey, 'male', variant).loading" class="roles-dialog__asset-status">处理中...</span>
                              <span v-if="getAssetState(role.draftKey, 'male', variant).error" class="roles-dialog__asset-error">
                                {{ getAssetState(role.draftKey, 'male', variant).error }}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div class="roles-dialog__asset-set">
                          <span class="roles-dialog__asset-set-title">女图</span>
                          <div class="roles-dialog__asset-grid">
                            <div v-for="variant in imageVariants" :key="`female-${variant}`" class="roles-dialog__asset-card">
                              <span class="roles-dialog__asset-title">{{ getImageVariantLabel(variant) }}</span>
                              <button
                                v-if="variant === 'raw' && getImportantAssetPath(role, 'female', variant)"
                                class="roles-dialog__asset-thumb-button"
                                type="button"
                                @click="openImagePreview(getImagePreviewTitle(role.name, variant, 'female'), getImportantAssetPath(role, 'female', variant))"
                              >
                                <img
                                  class="roles-dialog__asset-thumb"
                                  :src="getImportantAssetUrl(role, 'female', variant)"
                                  :alt="`${role.name || '角色'} 女图 ${getImageVariantLabel(variant)} 缩略图`"
                                  loading="lazy"
                                />
                              </button>
                              <a v-if="getImportantAssetPath(role, 'female', variant)" class="roles-dialog__asset-link" :href="getImportantAssetUrl(role, 'female', variant)" target="_blank" rel="noreferrer">
                                {{ getImportantAssetPath(role, 'female', variant) }}
                              </a>
                              <span v-else class="roles-dialog__asset-empty">暂无图片</span>
                              <span v-if="formatAssetMeta(getAssetState(role.draftKey, 'female', variant).meta)" class="roles-dialog__asset-meta">
                                {{ formatAssetMeta(getAssetState(role.draftKey, 'female', variant).meta) }}
                              </span>
                              <span v-if="getAssetState(role.draftKey, 'female', variant).loading" class="roles-dialog__asset-status">处理中...</span>
                              <span v-if="getAssetState(role.draftKey, 'female', variant).error" class="roles-dialog__asset-error">
                                {{ getAssetState(role.draftKey, 'female', variant).error }}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div v-else class="roles-dialog__asset-set">
                        <span class="roles-dialog__asset-set-title">通用图</span>
                        <div class="roles-dialog__asset-grid">
                          <div v-for="variant in imageVariants" :key="`common-${variant}`" class="roles-dialog__asset-card">
                            <span class="roles-dialog__asset-title">{{ getImageVariantLabel(variant) }}</span>
                            <button
                              v-if="variant === 'raw' && getImportantAssetPath(role, 'common', variant)"
                              class="roles-dialog__asset-thumb-button"
                              type="button"
                              @click="openImagePreview(getImagePreviewTitle(role.name, variant, 'common'), getImportantAssetPath(role, 'common', variant))"
                            >
                              <img
                                class="roles-dialog__asset-thumb"
                                :src="getImportantAssetUrl(role, 'common', variant)"
                                :alt="`${role.name || '角色'} 通用图 ${getImageVariantLabel(variant)} 缩略图`"
                                loading="lazy"
                              />
                            </button>
                            <a v-if="getImportantAssetPath(role, 'common', variant)" class="roles-dialog__asset-link" :href="getImportantAssetUrl(role, 'common', variant)" target="_blank" rel="noreferrer">
                              {{ getImportantAssetPath(role, 'common', variant) }}
                            </a>
                            <span v-else class="roles-dialog__asset-empty">暂无图片</span>
                            <span v-if="formatAssetMeta(getAssetState(role.draftKey, 'common', variant).meta)" class="roles-dialog__asset-meta">
                              {{ formatAssetMeta(getAssetState(role.draftKey, 'common', variant).meta) }}
                            </span>
                            <span v-if="getAssetState(role.draftKey, 'common', variant).loading" class="roles-dialog__asset-status">处理中...</span>
                            <span v-if="getAssetState(role.draftKey, 'common', variant).error" class="roles-dialog__asset-error">
                              {{ getAssetState(role.draftKey, 'common', variant).error }}
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div class="roles-dialog__action-stack">
                        <button
                          class="btn-secondary roles-dialog__row-button"
                          type="button"
                          :disabled="getPromptState(role.draftKey).loading || (role.qufen_xingbie ? (!role.descr_male.trim() && !role.descr_female.trim()) : !role.descr.trim())"
                          @click="handleGenerateImportantPrompt(role)"
                        >
                          生成提示词
                        </button>

                        <template v-if="role.qufen_xingbie">
                          <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getAssetState(role.draftKey, 'male', 'raw').loading || !role.prompt_male.trim() || parseImageDimensionInput(draft.importantAi.imageWidthText) === null || parseImageDimensionInput(draft.importantAi.imageHeightText) === null" @click="handleGenerateImportantImage(role, 'male')">
                            生成男原图
                          </button>
                          <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getAssetState(role.draftKey, 'female', 'raw').loading || !role.prompt_female.trim() || parseImageDimensionInput(draft.importantAi.imageWidthText) === null || parseImageDimensionInput(draft.importantAi.imageHeightText) === null" @click="handleGenerateImportantImage(role, 'female')">
                            生成女原图
                          </button>
                          <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getAssetState(role.draftKey, 'male', 'compress1').loading || !role.img_male_raw.trim()" @click="handleCompressImportantImage(role, 'male', 1)">
                            男图压缩到1
                          </button>
                          <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getAssetState(role.draftKey, 'male', 'compress2').loading || !role.img_male_raw.trim()" @click="handleCompressImportantImage(role, 'male', 2)">
                            男图压缩到2
                          </button>
                          <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getAssetState(role.draftKey, 'female', 'compress1').loading || !role.img_female_raw.trim()" @click="handleCompressImportantImage(role, 'female', 1)">
                            女图压缩到1
                          </button>
                          <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getAssetState(role.draftKey, 'female', 'compress2').loading || !role.img_female_raw.trim()" @click="handleCompressImportantImage(role, 'female', 2)">
                            女图压缩到2
                          </button>
                        </template>

                        <template v-else>
                          <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getAssetState(role.draftKey, 'common', 'raw').loading || !role.prompt.trim() || parseImageDimensionInput(draft.importantAi.imageWidthText) === null || parseImageDimensionInput(draft.importantAi.imageHeightText) === null" @click="handleGenerateImportantImage(role, 'common')">
                            生成通用原图
                          </button>
                          <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getAssetState(role.draftKey, 'common', 'compress1').loading || !role.img_raw.trim()" @click="handleCompressImportantImage(role, 'common', 1)">
                            压缩到1
                          </button>
                          <button class="btn-secondary roles-dialog__row-button" type="button" :disabled="getAssetState(role.draftKey, 'common', 'compress2').loading || !role.img_raw.trim()" @click="handleCompressImportantImage(role, 'common', 2)">
                            压缩到2
                          </button>
                        </template>
                      </div>
                    </td>
                    <td class="roles-dialog__actions-col">
                      <button class="btn-secondary roles-dialog__row-button" type="button" @click="removeImportantRole(index)">删除</button>
                    </td>
                  </tr>
                </tbody>
              </table>

              <div v-if="!draft.importantRoles.length" class="roles-dialog__empty">
                还没有重要角色，先添加一行。
              </div>
            </div>
          </div>

          <div class="roles-dialog__footer">
            <button
              class="btn-secondary roles-dialog__row-add"
              type="button"
              @click="activeTab === 'normal' ? addNormalRole() : addImportantRole()"
            >
              + 添加{{ activeTab === "normal" ? "普通角色" : "重要角色" }}
            </button>
          </div>
        </div>

        <div class="roles-dialog__actions roles-dialog__actions--footer">
          <button class="btn-secondary" type="button" @click="emit('close')">关闭</button>
          <button class="btn-primary" type="button" :disabled="saving || hasInvalidDraft" @click="submitDraft">
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

    <div
      v-if="imagePreviewState.url"
      class="roles-dialog__image-modal"
      @click.self="closeImagePreview"
    >
      <section class="roles-dialog__image-panel glass-panel">
        <div class="roles-dialog__image-head">
          <div class="roles-dialog__image-copy">
            <h3 class="roles-dialog__image-title">{{ imagePreviewState.title }}</h3>
            <span class="roles-dialog__image-path">{{ imagePreviewState.path }}</span>
          </div>
          <button class="btn-secondary" type="button" @click="closeImagePreview">关闭</button>
        </div>

        <div class="roles-dialog__image-frame">
          <img
            class="roles-dialog__image-full"
            :src="imagePreviewState.url"
            :alt="imagePreviewState.title"
          />
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
  width: min(1760px, calc(100vw - 24px));
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

.roles-dialog__body,
.roles-dialog__section {
  display: grid;
  gap: 12px;
}

.roles-dialog__body {
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
  grid-template-columns:
    minmax(180px, 220px)
    minmax(180px, 220px)
    minmax(180px, 220px)
    minmax(180px, 220px)
    minmax(0, 1fr);
  gap: 12px;
}

.roles-dialog__field {
  display: grid;
  gap: 6px;
}

.roles-dialog__field--wide {
  min-width: 0;
}

.roles-dialog__label,
.roles-dialog__count {
  font-size: 0.82rem;
  color: var(--text-muted);
}

.roles-dialog__tabs {
  display: flex;
  gap: 8px;
}

.roles-dialog__tab {
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-muted);
  font-size: 0.82rem;
}

.roles-dialog__tab--active {
  border-color: rgba(124, 227, 195, 0.45);
  color: var(--text);
  background: rgba(124, 227, 195, 0.12);
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

.roles-dialog__success {
  color: var(--accent);
  font-size: 0.84rem;
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
  min-width: 1600px;
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

.roles-dialog__asset-group,
.roles-dialog__asset-set,
.roles-dialog__asset-card,
.roles-dialog__action-stack {
  display: grid;
  gap: 6px;
}

.roles-dialog__asset-group--images {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
}

.roles-dialog__asset-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.roles-dialog__asset-set-title,
.roles-dialog__asset-title {
  font-size: 0.76rem;
  color: var(--text-muted);
}

.roles-dialog__asset-thumb-button {
  justify-self: start;
  width: 88px;
  aspect-ratio: 1;
  padding: 0;
  overflow: hidden;
  border: 1px solid rgba(186, 220, 255, 0.18);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  cursor: zoom-in;
}

.roles-dialog__asset-thumb {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
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

.roles-dialog__image-modal {
  position: fixed;
  inset: 0;
  z-index: 62;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(2, 8, 16, 0.82);
}

.roles-dialog__image-panel {
  width: min(1120px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
  padding: 18px;
  overflow: auto;
  border-radius: 20px;
}

.roles-dialog__image-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.roles-dialog__image-copy {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.roles-dialog__image-title {
  margin: 0;
  font-family: "Space Grotesk", sans-serif;
  font-size: 1.1rem;
  line-height: 1.2;
}

.roles-dialog__image-path {
  min-width: 0;
  color: var(--text-muted);
  font-size: 0.78rem;
  line-height: 1.4;
  word-break: break-all;
}

.roles-dialog__image-frame {
  display: grid;
  place-items: center;
  margin-top: 14px;
  padding: 12px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.03);
}

.roles-dialog__image-full {
  display: block;
  max-width: 100%;
  max-height: calc(100vh - 220px);
  object-fit: contain;
}

@media (max-width: 900px) {
  .roles-dialog__header,
  .roles-dialog__actions,
  .roles-dialog__config-grid,
  .roles-dialog__prompt-head,
  .roles-dialog__tabs,
  .roles-dialog__image-head {
    grid-template-columns: 1fr;
    flex-direction: column;
    align-items: stretch;
  }

  .roles-dialog__asset-grid {
    grid-template-columns: 1fr;
  }

  .roles-dialog__asset-group--images {
    grid-template-columns: 1fr;
  }
}
</style>
